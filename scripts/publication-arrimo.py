#!/usr/bin/env python3
"""Publication contrôlée Arrimo : sauvegardes restaurées avant migrations et bascules."""
import argparse
import datetime
import fcntl
import getpass
import hashlib
import io
import json
import os
import pathlib
import re
import secrets
import shlex
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import time
import urllib.parse
import urllib.request
import urllib.error

RACINE = pathlib.Path(__file__).resolve().parent.parent
CANDIDAT = '98712dfb9b20c2b5ae21903a3c154da52bff5aa6'
CIBLES = [('demo', '/opt/arrimo-demo', 'arrimo-public-demo', 'demo.arrimo.senseafri.com'),
          ('principal', '/opt/arrimo', 'arrimo', 'arrimo.senseafri.com'),
          ('sh', '/opt/arrimo-sh', 'arrimo-sh', 'sh.arrimo.senseafri.com')]
NODE = '/opt/arrimo-runtime/node-v24.22.1/bin/node'


class Refus(RuntimeError):
    pass


def sha(p):
    h = hashlib.sha256()
    with pathlib.Path(p).open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''): h.update(b)
    return h.hexdigest()


def lire_env(p):
    # Configuration littérale, jamais évaluée comme script shell.
    resultat = {}
    for ligne in pathlib.Path(p).read_text().splitlines():
        ligne = ligne.strip()
        if not ligne or ligne.startswith('#'): continue
        if ligne.startswith('export '): ligne = ligne[7:]
        k, sep, valeur = ligne.partition('=')
        if not sep or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', k) or any(x in valeur for x in ['`', '$(', '${']):
            raise Refus('Configuration non littérale : contrôle manuel nécessaire')
        mots = shlex.split(valeur, comments=False)
        if len(mots) > 1 and mots[1].startswith('#'): mots = mots[:1]
        if len(mots) > 1: raise Refus('Configuration ambiguë')
        resultat[k] = mots[0] if mots else ''
    return resultat


def cible_pg(url, nom=None):
    u = urllib.parse.urlsplit(url)
    if u.scheme not in ('postgres', 'postgresql') or u.hostname not in (None, 'localhost', '127.0.0.1', '::1'):
        raise Refus('PostgreSQL doit être local')
    q = urllib.parse.parse_qs(u.query, strict_parsing=True)
    if set(q) - {'host', 'sslmode', 'application_name'} or any(len(x) != 1 for x in q.values()): raise Refus('Paramètre PostgreSQL non autorisé')
    host = q.get('host', [u.hostname or '/var/run/postgresql'])[0]
    if host not in ('localhost', '127.0.0.1', '::1', '/var/run/postgresql'): raise Refus('Socket PostgreSQL non autorisé')
    base = urllib.parse.unquote(u.path[1:])
    if not base or (nom and base != nom): raise Refus('Base PostgreSQL inattendue')
    return base


def url_copie(url, nom):
    if len(nom)>63 or not re.fullmatch(r'arrimo_publication_restore_[a-z0-9_]+', nom): raise Refus('Nom de copie refusé')
    u = urllib.parse.urlsplit(url); cible_pg(url)
    return urllib.parse.urlunsplit((u.scheme, u.netloc, '/' + nom, u.query, ''))


def cible_lien(root):
    root = pathlib.Path(root)
    if not (root / 'current').is_symlink(): raise Refus('Installation sans release immuable : arrêt')
    rel = os.readlink(root / 'current')
    if not re.fullmatch(r'releases/[A-Za-z0-9._-]+', rel) or (root / rel).is_symlink() or not (root / rel).is_dir(): raise Refus('Pointeur de release invalide')
    if (root / rel).resolve().parent != (root / 'releases').resolve(): raise Refus('Release hors périmètre')
    return rel


def verifier_preuves(root=RACINE):
    p = root / 'docs/preuves-recette-validee-20261025'
    r = json.loads((p / 'rapport-ssh.json').read_text())
    if r.get('commit') != CANDIDAT or r.get('statut') != 'copie_validee' or not r.get('copie_isolee_validee') or not r.get('sauvegarde_fictive_restauree'):
        raise Refus('Recette intégrée non validée pour le commit épinglé')
    resume = json.loads((p / 'resume.json').read_text())
    attendues = {'api','priorites-sql','interop-sql','securite-multietablissement','scenarios-abc','dashboards-abc-reseau','interface-parcours','priorites-navigateur','structure-navigateur','sh-erp','sh-navigateur','securite-xss'}
    if len(resume['suites']) != 12 or resume.get('tests_integres_reussis') != 153 or {x['suite'] for x in resume['suites']} != attendues: raise Refus('Recette incomplète')
    for x in resume['suites']:
        b = (p / (x['suite'] + '.log')).read_bytes()
        if hashlib.sha256(b).hexdigest() != x['journal_sha256']: raise Refus('Journal de recette modifié')
        compte = lambda k: re.search(rb'^# ' + k.encode() + rb' (\d+)\s*$', b, re.M)
        if not all(compte(k) for k in ['tests','pass','fail','skipped','cancelled']): raise Refus('TAP incomplet')
        if int(compte('tests')[1]) < 1 or int(compte('pass')[1]) != int(compte('tests')[1]) or any(int(compte(k)[1]) for k in ['fail','skipped','cancelled']): raise Refus('Tests en échec ou ignorés')
        if not any(e['nom'] == x['suite'] and e.get('reussi') for e in r['etapes']): raise Refus('Étape non attestée')
    return r


class Publication:
    def __init__(self, sortie):
        self.sortie = pathlib.Path(sortie); self.sortie.mkdir(mode=0o700, exist_ok=False)
        self.etat = {'commit_candidat': CANDIDAT, 'statut': 'en_cours', 'environnements': {}, 'etapes': [], 'publication_verifiee': []}
        self.environnement = {k: os.environ[k] for k in ['PATH','HOME','LANG','TZ','PLAYWRIGHT_BROWSERS_PATH'] if k in os.environ}
        self.environnement['NODE_PATH'] = str((RACINE / 'node_modules').resolve())
        self.envs = {}; self.comptes = {}; self.infos = {}; self.preparees = {}; self.active = None
        self.selection = [t for t, *_ in CIBLES]
        self.sauver()

    def sauver(self):
        tmp = self.sortie / 'rapport.json.tmp'
        with tmp.open('w') as f:
            f.write(json.dumps(self.etat, ensure_ascii=False, indent=2) + '\n');f.flush();os.fsync(f.fileno())
        tmp.chmod(0o600); os.replace(tmp, self.sortie / 'rapport.json')

    def commande(self, nom, argv, env=None, entree=None, secret=False, timeout=600):
        # Ne jamais journaliser argv, env ou les corps de connexion : URL, mots de passe et jetons privés.
        try:
            r = subprocess.run(argv, input=entree, capture_output=True, env=env or self.environnement, timeout=timeout, cwd=RACINE)
        except subprocess.TimeoutExpired:
            raise Refus(nom + ' : délai dépassé')
        if not secret:
            # Les diagnostics bruts restent privés, et ne peuvent pas être confondus avec un rapport publiable.
            # Aucun log stdout de worker/psql ne contient de ligne patient.
            texte = (r.stdout + r.stderr).decode(errors='replace')
            for e in self.envs.values():
                for k, v in e.items():
                    if v and (any(x in k for x in ['PASSWORD','PASSE','KEY','CLE','SECRET','URL']) or k.endswith('_TOKEN')):
                        texte = texte.replace(v, '[SECRET MASQUÉ]')
            texte = re.sub(r'postgres(?:ql)?://[^\s]+', '[URL MASQUÉE]', texte)
            (self.sortie / (nom + '.log')).write_text(texte)
        self.etat['etapes'].append({'nom': nom, 'reussi': r.returncode == 0}); self.sauver()
        print(nom, 'RÉUSSI' if r.returncode == 0 else 'ÉCHEC', flush=True)
        if r.returncode != 0: raise Refus(nom + ' : contrôle en échec ; consulter le journal privé')
        return r.stdout

    def worker(self, nom, payload, secret=False):
        b = self.commande(nom, [NODE, str(RACINE / 'scripts/publication/controle.cjs')], entree=json.dumps(payload).encode(), secret=secret)
        return json.loads(b)

    def pg(self, nom, type_, operation, **kw):
        url = kw.pop('url', self.envs[type_].get('SH_DATABASE_URL') if type_ == 'sh' else None) or self.envs[type_]['DATABASE_URL']
        return self.worker(nom, {'operation': operation, 'url': url, 'nom': cible_pg(url), 'type': type_, **kw})

    def http(self, base, chemin, statut=200):
        if not base.startswith('https://'): raise Refus('HTTPS public obligatoire')
        req = urllib.request.Request(base + chemin, headers={'Cache-Control':'no-cache','User-Agent':'Arrimo-publication-verification'})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                if r.status != statut or urllib.parse.urlsplit(r.url).hostname != urllib.parse.urlsplit(base).hostname: raise Refus('Réponse publique inattendue')
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == statut: return b''
            raise Refus('HTTP public refusé : ' + str(e.code)) from None

    def sante(self, t):
        base = 'https://' + self.infos[t]['hote']
        d = json.loads(self.http(base, '/api/sante'))
        if d.get('etat') != 'ok' or d.get('base') != 'ok': raise Refus('Santé publique dégradée')
        self.http(base, '/api/moi', 401)
        self.http(base, '/')
        return {k: d.get(k) for k in ['etat','base','version']}

    def inventaire(self):
        verifier_preuves()
        if subprocess.run(['git','status','--porcelain'],cwd=RACINE,capture_output=True,check=True).stdout.strip(): raise Refus('Dépôt non propre')
        for t, root, service, hote in CIBLES:
            root = pathlib.Path(root); actuel = cible_lien(root)
            env_file = root / 'shared/.env'
            if not env_file.is_file(): raise Refus('Configuration partagée absente')
            env = lire_env(env_file); self.envs[t] = env
            url = (env.get('SH_DATABASE_URL') if t == 'sh' else None) or env.get('DATABASE_URL')
            if not url: raise Refus('URL PostgreSQL manquante')
            cible_pg(url)
            if env.get('HOST', '127.0.0.1') not in ['127.0.0.1','localhost']: raise Refus('Écoute locale attendue')
            port = int(env['PORT'])
            if not 1024 <= port <= 65535: raise Refus('Port applicatif invalide')
            unite = self.commande('systemd-' + t, ['systemctl','show', service + '.service', '--property=ActiveState,User,Group,WorkingDirectory,ExecStart,EnvironmentFiles','--no-pager']).decode()
            v = dict(x.split('=',1) for x in unite.splitlines() if '=' in x)
            # systemctl show répète EnvironmentFiles une fois par fichier (unité puis drop-ins).
            fichiers = [x.split('=',1)[1].split(' (ignore_errors=')[0] for x in unite.splitlines() if x.startswith('EnvironmentFiles=')]
            if v.get('ActiveState') != 'active' or v.get('WorkingDirectory') != str(root / 'current') or not fichiers or fichiers[0] != str(env_file) or any(pathlib.Path(f).parent != root / 'shared' for f in fichiers) or NODE not in v.get('ExecStart',''):
                raise Refus('Unité systemd inattendue : ' + t)
            if v.get('User') in ('', 'root', None): raise Refus('Compte applicatif dédié requis')
            nginx = pathlib.Path('/etc/nginx/sites-available') / service
            texte = nginx.read_text()
            if hote not in texte or '127.0.0.1:' + str(port) not in texte: raise Refus('Hôte Nginx inattendu')
            self.infos[t] = {'root':root,'actuel':actuel,'service':service,'hote':hote,'port':port,'user':v['User'],'group':v.get('Group') or v['User'],'env_file':env_file,'nginx':nginx}
            identite = self.pg('postgres-' + t, t, 'identite')
            self.infos[t]['role'] = identite['role']
            self.etat['environnements'][t] = {'domaine':hote,'release_avant':actuel,'version_avant':self.version(root / actuel), 'base':identite['base'],'role':identite['role'],'sante_avant':self.sante(t),'publie':False}
            self.sauver()
        bases = [self.etat['environnements'][t]['base'] for t, *_ in CIBLES]
        if len(set(bases)) != 3: raise Refus('Les bases publiques doivent être distinctes')
        admin = os.environ.get('ARRIMO_PUBLICATION_ADMIN_URL','postgresql:///postgres?host=/var/run/postgresql')
        if cible_pg(admin) not in ['postgres','template1']: raise Refus('Base de maintenance requise')
        self.admin = admin
        # Authentification peer locale : la maintenance s'exécute sous le compte système postgres, sans changer pg_hba.
        self.commande('maintenance-postgres',['runuser','-u','postgres','--','psql','-X','-v','ON_ERROR_STOP=1','-d',cible_pg(admin),'-Atc','SELECT 1'])
        # Le contrôle Chromium n'utilise aucun profil ni compte public.
        self.commande('runtime-chromium',[NODE,'-e',"require('playwright').chromium.launch({headless:true}).then(b=>b.close()).catch(()=>process.exitCode=1)"])
        self.sauver()

    def version(self, code):
        propositions=[]
        nom=re.search(r'([a-f0-9]{40})',code.name)
        if nom:propositions.append(nom[1])
        f=code/'.arrimo-release'
        if f.is_file():
            r=re.search(r'^commit=([a-f0-9]{40})$',f.read_text(),re.M)
            if r:propositions.append(r[1])
        for commit in dict.fromkeys(propositions):
            r=subprocess.run(['git','ls-tree','-r',commit,'--','src','public','public-sh','db','package.json','package-lock.json'],cwd=RACINE,capture_output=True)
            if r.returncode or not r.stdout:continue
            conforme=True
            for ligne in r.stdout.decode().splitlines():
                meta,rel=ligne.split('\t',1);mode,genre,objet=meta.split()
                p=code/rel
                try:contenu=os.readlink(p).encode() if mode=='120000' else p.read_bytes()
                except OSError:conforme=False;break
                if hashlib.sha1(b'blob '+str(len(contenu)).encode()+b'\0'+contenu).hexdigest()!=objet:conforme=False;break
            if conforme:return commit
        # Une ancienne archive peut contenir un marqueur périmé : identifier alors le contenu réel.
        h=hashlib.sha256()
        for rel in ['src','public','public-sh','db','package.json','package-lock.json']:
            p=code/rel
            for f in sorted(([p] if p.is_file() else p.rglob('*'))):
                if f.is_file() and not f.is_symlink():h.update(str(f.relative_to(code)).encode()+b'\0'+f.read_bytes()+b'\0')
        return 'contenu_sha256:'+h.hexdigest()

    def authentifier(self):
        donnees = {}
        fichier = os.environ.get('ARRIMO_PUBLICATION_ACCES')
        if fichier:
            f = pathlib.Path(fichier)
            if f.stat().st_mode & 0o077: raise Refus('Le fichier des accès doit être privé (0600)')
            donnees = json.loads(f.read_text())
        mdp_demo = self.envs['demo'].get('DEMO_MOT_DE_PASSE')
        if not mdp_demo:
            f = RACINE / '.local/acces-demo-trio.txt'
            if f.is_file() and not f.stat().st_mode & 0o077:
                m = re.search(r'^Mot de passe commun : (.+)$',f.read_text(),re.M)
                if m: mdp_demo = m[1]
        for t in self.selection:
            comptes = donnees.get(t)
            if not comptes:
                if t == 'demo': comptes = [{'nom':n,'email':e,'password':mdp_demo} for n,e in [('a','hopital.a@demo.arrimo'),('b','hopital.b@demo.arrimo'),('c','hopital.c@demo.arrimo'),('reseau','reseau@demo.arrimo')]]
                else: comptes = [{'nom':t,'email':self.demander('Courriel du compte '+t+' autorisé pour les vérifications'), 'password':None}]
            if t == 'demo' and {c.get('nom') for c in comptes} != {'a','b','c','reseau'}: raise Refus('Quatre accès démo A/B/C/Réseau requis')
            self.comptes[t] = []
            for c in comptes:
                mdp = c.get('password') or self.demander('Mot de passe '+t+' / '+c['email'], secret=True)
                p = {'operation':'connexion','base':'https://'+self.infos[t]['hote'],'email':c['email'],'password':mdp}
                rep = self.worker('connexion-'+t+'-'+c['nom'],p,secret=True)
                if rep.get('etape') == '2fa':
                    rep = self.worker('mfa-'+t+'-'+c['nom'],{'operation':'connexion','base':p['base'],'jeton':rep['jeton'],'otp':self.demander('Code MFA actuel '+c['email'],secret=True)},secret=True)
                if not re.fullmatch(r'[a-f0-9]{64}',rep.get('token','')): raise Refus('Session autorisée manquante ou mot de passe temporaire')
                self.comptes[t].append({'nom':c['nom'],'token':rep['token']})
        # Contrôler les permissions avant toute migration ou bascule, sans fabriquer de session.
        for t, comptes in self.comptes.items():
            for c in comptes:
                r=self.worker('droits-'+t+'-'+c['nom'],{'operation':'acces','type':t,'base':'https://'+self.infos[t]['hote'],'token':c['token']},secret=True)
                if t=='demo':
                    if c['nom']=='reseau':
                        if not r['gestionnaire'] or len(r['etablissements'])<3:raise Refus('Compte réseau non autorisé')
                    elif len(r['etablissements'])!=1:raise Refus('Compte hôpital non isolé')
                    c['etablissements']=r['etablissements']
            if t=='demo':
                scopes={c['nom']:c['etablissements'][0] for c in comptes if c['nom']!='reseau'}
                if len(set(scopes.values()))!=3:raise Refus('Les comptes A/B/C doivent représenter trois établissements distincts')
                for c in comptes:
                    if c['nom']!='reseau':c['interdit']=next(e for n,e in scopes.items() if n!=c['nom'])
        # Aucun mot de passe/jeton dans le rapport. Les sessions seront fermées à la fin.

    def demander(self, libelle, secret=False):
        if not sys.stdin.isatty(): raise Refus('Accès autorisés manquants : session SSH interactive ou ARRIMO_PUBLICATION_ACCES requis')
        return getpass.getpass(libelle + ' : ') if secret else input(libelle + ' : ').strip()

    def verifier_acces_navigateurs(self):
        for t in self.selection:
            captures=self.sortie/('captures-avant-'+t);captures.mkdir(mode=0o700)
            self.worker('navigateur-avant-'+t,{'operation':'navigateur','type':t,'base':'https://'+self.infos[t]['hote'],'comptes':self.comptes[t],'captures':str(captures)})

    def preparer_code(self):
        archive = self.commande('archive-candidat',['git','archive','--format=tar',CANDIDAT],secret=True)
        code = self.sortie / 'candidat';code.mkdir()
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar: tar.extractall(code,filter='data')
        self.code = code
        self.etat['archive_sha256'] = hashlib.sha256(archive).hexdigest()
        for t, *_ in CIBLES:
            i = self.infos[t]; ancien = i['root'] / i['actuel']
            chemins = ['src/sh','src/auth.js','src/db.js','src/erreurs.js','src/courriel.js','src/totp.js','src/limites.js','src/import.js','src/configuration-operationnelle.js','public-sh','db/sh-schema.sql','package.json','package-lock.json'] if t=='sh' else ['src','public','db','package.json','package-lock.json']
            different = any(not (ancien / f.relative_to(code)).is_file() or sha(f) != sha(ancien / f.relative_to(code)) for rel in chemins for f in ([code / rel] if (code / rel).is_file() else (code / rel).rglob('*')) if f.is_file())
            self.etat['environnements'][t]['changement_necessaire'] = different
        self.sauver()

    def sauvegarder_et_restaurer(self,t):
        i = self.infos[t]; b = self.sortie / ('sauvegarde-'+t);b.mkdir(mode=0o700)
        snapshot = self.pg('sauvegarde-'+t,t,'sauvegarde',dump=str(b/'database.dump'))
        self.commande('lecture-dump-'+t,['pg_restore','--list',str(b/'database.dump')])
        shutil.copy2(i['env_file'],b/'configuration.env');(b/'configuration.env').chmod(0o600)
        shutil.copy2('/etc/systemd/system/'+i['service']+'.service',b/'service.systemd')
        (b/'service-effectif.systemd').write_bytes(self.commande('unite-effective-'+t,['systemctl','cat',i['service']+'.service'],secret=True))
        shutil.copy2(i['nginx'],b/'nginx.conf')
        # Archive de l'ancienne release, sans déréférencer les liens vers les configurations privées.
        with tarfile.open(b/'release.tar.gz','w:gz',dereference=False) as tar: tar.add(i['root']/i['actuel'],arcname='release')
        (b/'SHA256SUMS.json').write_text(json.dumps({f.name:sha(f) for f in b.iterdir() if f.is_file()},indent=2)+'\n')
        nom='arrimo_publication_restore_'+t+'_'+self.sortie.name.rsplit('-',1)[-1].lower()
        if len(nom)>63:raise Refus('Nom de copie trop long')
        if not re.fullmatch(r'[a-z_][a-z0-9_]*',i['role']):raise Refus('Rôle applicatif inattendu')
        sql='CREATE DATABASE :"cible" OWNER :"proprietaire" TEMPLATE template0;\nREVOKE CONNECT ON DATABASE :"cible" FROM PUBLIC;\n'
        self.commande('creer-copie-'+t,['runuser','-u','postgres','--','psql','-X','-v','ON_ERROR_STOP=1','-v','cible='+nom,'-v','proprietaire='+i['role'],'-d',cible_pg(self.admin)],entree=sql.encode())
        url = url_copie((self.envs[t].get('SH_DATABASE_URL') if t=='sh' else None) or self.envs[t]['DATABASE_URL'],nom)
        # Pas de --clean, --create ou restauration sur une base existante.
        u=urllib.parse.urlsplit(url);q=urllib.parse.parse_qs(u.query)
        env = dict(self.environnement, PGDATABASE=nom, PGHOST=q.get('host',[u.hostname or '/var/run/postgresql'])[0],
                   PGPORT=str(u.port or 5432),PGUSER=urllib.parse.unquote(u.username) if u.username else i['role'],PGCONNECT_TIMEOUT='10')
        if u.password:env['PGPASSWORD']=urllib.parse.unquote(u.password)
        if 'sslmode' in q:env['PGSSLMODE']=q['sslmode'][0]
        self.commande('restaurer-'+t,['pg_restore','--dbname='+nom,'--exit-on-error','--no-owner','--no-acl',str(b/'database.dump')],env=env)
        copie = self.pg('empreintes-restauration-'+t,t,'empreintes',url=url,colonnes=snapshot['colonnes'])
        if copie['contenu'] != snapshot['contenu']: raise Refus('Restauration différente du snapshot : '+t)
        for fichier, attendu in json.loads((b/'SHA256SUMS.json').read_text()).items():
            if sha(b/fichier) != attendu: raise Refus('Sauvegarde altérée')
        p = {'restauration':True,'migration_copie':False,'ancien_code':False,'copie':nom,'sauvegarde':str(b)}
        self.preparees[t]={'url':url,'preuves':p}
        for n in [1,2]: self.pg('migration-copie-'+t+'-'+str(n),t,'migrer',url=url,code=str(self.code),env=self.envs[t],role=i['role'])
        p['migration_copie']=True
        for nom_code, code in [('ancien',i['root']/i['actuel']),('candidat',self.code)]:
            self.worker('compatibilite-'+nom_code+'-'+t,{'operation':'local','type':t,'url':url,'nom':nom,'code':str(code),'env':self.envs[t],'comptes':self.comptes[t]})
        p['ancien_code']=True
        self.etat['environnements'][t]['preuves_avant_publication']=p.copy();self.sauver()

    def preparer_release(self,t):
        i=self.infos[t]; rid='arrimo-'+CANDIDAT+'-'+self.sortie.name.rsplit('_',1)[-1]; i['candidate']=rid; cible=i['root']/'releases'/rid
        if cible.exists(): raise Refus('Release candidate déjà présente : contrôler la publication précédente avant reprise')
        shutil.copytree(self.code,cible,symlinks=True)
        # Le marqueur historique du dépôt ne doit jamais attribuer une autre version à la release.
        (cible/'.arrimo-release').write_text('commit='+CANDIDAT+'\n')
        shutil.chown(cible,user=i['user'],group=i['group'])
        deps=i['root']/i['actuel']/'node_modules'
        if deps.is_dir() and sha(cible/'package-lock.json')==sha(i['root']/i['actuel']/'package-lock.json'):
            (cible/'node_modules').symlink_to(deps.resolve(),target_is_directory=True)
        else:
            for f in cible.rglob('*'):
                if not f.is_symlink():shutil.chown(f,user=i['user'],group=i['group'])
            self.commande('dependances-'+t,['runuser','-u',i['user'],'--','/usr/bin/env','PATH='+str(pathlib.Path(NODE).parent)+':/usr/bin:/bin','npm','ci','--omit=dev','--prefix',str(cible)],timeout=600)
        # Code non modifiable par le service ; dépendances historiques conservées et non purgées.
        for dossier, dirs, fichiers in os.walk(cible,followlinks=False):
            shutil.chown(dossier,user='root',group=i['group']);os.chmod(dossier,0o750)
            for nom in fichiers:
                f=pathlib.Path(dossier)/nom
                if not f.is_symlink():shutil.chown(f,user='root',group=i['group']);f.chmod(0o750 if f.stat().st_mode & 0o111 else 0o640)
        self.commande('lecture-runtime-'+t,['runuser','-u',i['user'],'--',NODE,'-e',"require(process.argv[1]+'/node_modules/pg');require(process.argv[1]+'/node_modules/express')",str(cible)])
        return rid

    def controle_public(self,t):
        sante=self.sante(t);i=self.infos[t]
        asset='sh.js' if t=='sh' else 'app.js'; rep='public-sh' if t=='sh' else 'public'
        b=self.http('https://'+i['hote'],'/'+asset+'?arrimo_release='+CANDIDAT)
        if hashlib.sha256(b).hexdigest()!=sha(self.code/rep/asset): raise Refus('Version des assets publics incorrecte')
        captures=self.sortie/('captures-'+t);captures.mkdir(exist_ok=True,mode=0o700)
        # Les requêtes et la navigation passent par une connexion normale et des rôles existants.
        r=self.worker('navigateur-public-'+t,{'operation':'navigateur','type':t,'base':'https://'+i['hote'],'comptes':self.comptes[t],'captures':str(captures)})
        return {'sante':sante,**r,'asset_sha256':hashlib.sha256(b).hexdigest()}

    def deployer(self,t):
        i=self.infos[t];e=self.etat['environnements'][t]
        if not e['changement_necessaire']:
            e['controles_publics']=self.controle_public(t);e['release_active']=i['actuel'];e['version_active']=self.version(i['root']/i['actuel']);self.sauver();return
        if not all(self.preparees[t]['preuves'].get(k) for k in ['restauration','migration_copie','ancien_code']): raise Refus('Préflight non validé')
        if cible_lien(i['root'])!=i['actuel']: raise Refus('Version changée pendant la préparation')
        rid=self.preparer_release(t);self.active=t
        e['phase']='bascule_en_cours';self.sauver()
        try:
            self.commande('arreter-'+t,['systemctl','stop',i['service']+'.service'])
            self.pg('migration-publique-'+t,t,'migrer',code=str(self.code),env=self.envs[t],role=i['role'],public_autorise=True,preuves=self.preparees[t]['preuves'])
            e['migration_publique']=True;self.sauver()
            self.commande('activer-'+t,['bash',str(RACINE/'deploy/releases.sh'),'activate',str(i['root']),rid,i['service']+'.service','http://127.0.0.1:'+str(i['port'])+'/api/sante'])
            e['controles_publics']=self.controle_public(t)
            e.update(phase='verifie',publie=True,release_active=cible_lien(i['root']),version_active=CANDIDAT)
            self.etat['publication_verifiee'].append(t);self.active=None;self.sauver()
        except BaseException:
            self.revenir(t);raise

    def revenir(self,t):
        i=self.infos[t];courante=cible_lien(i['root'])
        if courante!=i['actuel']:
            if courante!='releases/'+i.get('candidate','arrimo-'+CANDIDAT):raise Refus('Pointeur changé par un tiers : rollback automatique interdit')
            self.commande('rollback-'+t,['bash',str(RACINE/'deploy/releases.sh'),'activate',str(i['root']),pathlib.Path(i['actuel']).name,i['service']+'.service','http://127.0.0.1:'+str(i['port'])+'/api/sante'])
        else:self.commande('redemarrer-ancienne-'+t,['systemctl','start',i['service']+'.service'])
        self.etat['environnements'][t].update(publie=False,retour_applicatif=True,release_active=cible_lien(i['root']),version_active=self.version(i['root']/i['actuel']))
        self.sauver()
        for tentative in range(5):
            try:self.etat['environnements'][t]['sante_apres_retour']=self.sante(t);break
            except Exception:
                if tentative==4:raise Refus('Ancien pointeur restauré mais contrôle HTTPS toujours en échec : '+t)
                time.sleep(2)
        self.active=None;self.sauver()

    def executer(self):
        self.inventaire();self.authentifier();self.verifier_acces_navigateurs();self.preparer_code()
        # Aucun environnement public n'est migré avant préparation de TOUTES les copies concernées.
        for t in self.selection:self.sauvegarder_et_restaurer(t)
        # Exercice du mécanisme de bascule dans un dossier jetable, sans systemd public ni requête SQL.
        self.commande('exercice-rollback',['bash',str(RACINE/'deploy/test-releases.sh')],timeout=120)
        for t in self.selection:self.deployer(t)
        self.etat['statut']='publication_verifiee';self.sauver()

    def fermer(self):
        for t, comptes in self.comptes.items():
            try:self.pg('fermer-sessions-'+t,t,'fermer-sessions-test',tokens=[c['token'] for c in comptes])
            except Exception:self.etat['environnements'][t]['sessions_test_a_fermer']=True
        self.sauver()


def audit():
    verifier_preuves()
    sortie={'commit_candidat':CANDIDAT,'mode':'audit_sans_ecriture','versions_locales':[],'aucune_migration':True,'aucun_deploiement':True}
    for t, root, service, hote in CIBLES:
        rel=cible_lien(root); sortie['versions_locales'].append({'environnement':t,'domaine':hote,'release_active':rel,'version_active':Publication.version(None,pathlib.Path(root)/rel),'service':service})
    print(json.dumps(sortie,ensure_ascii=False,indent=2))


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--audit',action='store_true')
    # L'inventaire lecture seule couvre toujours les trois sites ; seules les cibles choisies sont sauvegardées et publiées.
    parser.add_argument('--cibles',default='demo,principal,sh');args=parser.parse_args()
    selection=[t for t, *_ in CIBLES if t in args.cibles.split(',')]
    if not selection or set(args.cibles.split(','))-{t for t, *_ in CIBLES}:raise Refus('Cibles inconnues')
    if args.audit:audit();return 0
    if os.geteuid()!=0:raise Refus('Session SSH root autorisée requise')
    os.umask(0o077)
    # Verrou commun avec les autres exécutions de ce lanceur, gardé jusqu'au rapport final.
    with open('/root/arrimo-publication.lock','a') as verrou:
        try:fcntl.flock(verrou,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise Refus('Une publication est déjà en cours')
        stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'_'+secrets.token_hex(4)
        pub=Publication('/root/arrimo-publication-'+stamp);pub.selection=selection;pub.etat['cibles']=selection
        print('Rapport privé : '+str(pub.sortie/'rapport.json'),flush=True)
        def interrompre(*_):raise KeyboardInterrupt()
        signal.signal(signal.SIGTERM,interrompre)
        signal.signal(signal.SIGHUP,interrompre)
        try:pub.executer()
        except BaseException as e:
            pub.etat['statut']='arrete_sans_publication_complete';pub.etat['blocage']=str(e) if isinstance(e,Refus) else type(e).__name__
            pub.sauver();print('ARRÊT : '+pub.etat['blocage'],flush=True)
        finally:pub.fermer()
        print(json.dumps(pub.etat,ensure_ascii=False,indent=2))
        return 0 if pub.etat['statut']=='publication_verifiee' else 1

if __name__=='__main__':
    try:sys.exit(main())
    except (Refus,OSError) as e:print('Publication non exécutée : '+(str(e) if isinstance(e,Refus) else type(e).__name__),file=sys.stderr);sys.exit(1)
