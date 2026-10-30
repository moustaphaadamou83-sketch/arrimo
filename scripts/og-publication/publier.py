#!/usr/bin/env python3
"""À exécuter depuis le terminal SSH réel ; aucune migration ou restauration publique."""
import argparse
import datetime
import fcntl
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import urllib.parse
import urllib.request

ICI = Path(__file__).resolve().parent
CIBLES = {
    'demo': ('/opt/arrimo-demo', 'arrimo-public-demo', 'https://demo.arrimo.senseafri.com'),
    'principal': ('/opt/arrimo', 'arrimo', 'https://arrimo.senseafri.com'),
}
FICHIERS_OG = ('src/og-outils.js', 'src/copilote.js', 'src/og-suivi.js', 'public/app.js', 'public/i18n/fr.js', 'public/i18n/en.js')
NODE = '/opt/arrimo-runtime/node-v24.22.1/bin/node'
class Refus(RuntimeError): pass

def exiger(ok, motif):
    if not ok: raise Refus(motif)

def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def lire_env(p, *, systemd=False):
    resultat = {}
    for numero, ligne in enumerate(Path(p).read_text().splitlines(), 1):
        ligne = ligne.strip()
        if not ligne or ligne.startswith('#'): continue
        if ligne.startswith('export '): ligne = ligne[7:]
        k, sep, v = ligne.partition('=')
        exiger(sep and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', k), 'Configuration non littérale')
        exiger(not any(x in v for x in ('`','$(', '${')), 'Configuration évaluée refusée')
        if systemd and not v.lstrip().startswith(('"', "'")):
            # EnvironmentFile conserve les espaces intérieurs non cités.
            # Les formes complexes restent refusées, sans jamais évaluer le fichier.
            exiger(not any(c in v for c in ('\\', '"', "'")),
                   f'Configuration systemd complexe refusée : {p}:{numero} ({k})')
            resultat[k] = v.strip()
        else:
            mots = shlex.split(v, comments=not systemd)
            exiger(len(mots) <= 1, f'Configuration ambiguë : {p}:{numero} ({k})')
            resultat[k] = mots[0] if mots else ''
    return resultat

def base_locale(url):
    u = urllib.parse.urlsplit(url); q = urllib.parse.parse_qs(u.query, strict_parsing=True)
    exiger(u.scheme in ('postgres','postgresql') and u.hostname in (None,'localhost','127.0.0.1','::1'), 'PostgreSQL distant refusé')
    exiger(set(q) <= {'host','sslmode','application_name'} and all(len(v)==1 for v in q.values()), 'Options PostgreSQL refusées')
    exiger(q.get('host',[u.hostname or '/var/run/postgresql'])[0] in ('localhost','127.0.0.1','::1','/var/run/postgresql'), 'Socket PostgreSQL refusé')
    nom = urllib.parse.unquote(u.path[1:]); exiger(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',nom), 'Nom de base refusé')
    return nom

def url_copie(url, nom):
    exiger(re.fullmatch(r'arrimo_publication_restore_og_[a-z0-9_]+',nom) and len(nom)<=63, 'Nom de copie refusé')
    base_locale(url); u=urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((u.scheme,u.netloc,'/'+nom,u.query,''))

def courant(root):
    p=Path(root)/'current'; exiger(p.is_symlink(), 'current doit être un lien')
    rel=os.readlink(p); exiger(re.fullmatch(r'releases/[A-Za-z0-9._-]+',rel), 'Lien current hors périmètre')
    cible=Path(root)/rel
    exiger(cible.is_dir() and not cible.is_symlink() and cible.resolve().parent == (Path(root)/'releases').resolve(), 'Release hors périmètre')
    return rel

def extraire(archive, sortie):
    with tarfile.open(archive) as t:
        for m in t.getmembers():
            p=Path(m.name)
            exiger(not p.is_absolute() and '..' not in p.parts and (m.isfile() or m.isdir()), 'Archive avec lien ou chemin interdit')
        t.extractall(sortie, filter='data')

def tap_valide(b):
    def n(k):
        x=re.search(rb'^# '+k.encode()+rb' (\d+)\s*$',b,re.M)
        return int(x[1]) if x else None
    return n('tests') is not None and n('tests')>0 and n('pass')==n('tests') and all(n(k)==0 for k in ('fail','skipped','cancelled')) and not re.search(rb'^# Subtest: tests/\S+\.(?:js|cjs)\s*$',b,re.M)

def contenu(root):
    res={}
    for dossier in ('src','public','public-sh','db'):
        for p in sorted((Path(root)/dossier).rglob('*')):
            if p.is_file():
                exiger(not p.is_symlink(), 'Lien source non attendu')
                res[str(p.relative_to(root))]=sha(p)
    res['package-lock.json']=sha(Path(root)/'package-lock.json')
    return res

def verifier_perimetre_runtime(base,candidat):
    changements={p for p in set(base)|set(candidat) if base.get(p)!=candidat.get(p)}
    exiger(bool(changements) and changements<=set(FICHIERS_OG) and not (set(base)-set(candidat)), 'Runtime hors périmètre')
    return changements

class Publication:
    def __init__(self, args):
        self.args=args; self.id=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'_'+secrets.token_hex(4)
        self.out=Path('/root')/('arrimo-og-publication-'+self.id); self.out.mkdir(mode=0o700)
        self.rapport={'statut':'preparation','publication_verifiee':False,'environnements':{},'etapes':[],'bases_isolees':[]}
        self.env={'PATH':str(Path(NODE).parent)+':/usr/bin:/bin','LANG':'C.UTF-8','HOME':'/root'}
        if os.environ.get('PLAYWRIGHT_BROWSERS_PATH'): self.env['PLAYWRIGHT_BROWSERS_PATH']=os.environ['PLAYWRIGHT_BROWSERS_PATH']
        self.infos={}; self.sessions={}; self.modifies=[]; self.secrets=[]; self.sauver()
    def sauver(self):
        p=self.out/'rapport.json.tmp'; p.write_text(json.dumps(self.rapport,ensure_ascii=False,indent=2)+'\n');p.chmod(0o600);os.replace(p,self.out/'rapport.json')
    def run(self, nom, argv, *, entree=None, env=None, cwd=None, prive=False, timeout=1800):
        try:
            r=subprocess.run(argv,input=entree,capture_output=True,env=env or self.env,cwd=cwd or self.code,timeout=timeout)
        except subprocess.TimeoutExpired: raise Refus(nom+' : délai dépassé') from None
        if prive:
            # Les sorties peuvent contenir des secrets ; garder uniquement le diagnostic
            # structuré du vérificateur OG, jamais ses réponses ni son entrée privée.
            diagnostic=re.search(rb'VERIFICATION_OG_ECHOUEE [A-Za-z0-9_= .:-]+',r.stderr)
            if diagnostic:
                p=self.out/(nom+'.log');p.write_bytes(diagnostic[0]+b'\n');p.chmod(0o600)
        else:
            texte=(r.stdout+r.stderr).decode(errors='replace')
            for secret in self.secrets:
                if secret: texte=texte.replace(secret,'[SECRET]')
            texte=re.sub(r'postgres(?:ql)?://\S+','[URL SQL MASQUÉE]',texte)
            (self.out/(nom+'.log')).write_text(texte)
        self.rapport['etapes'].append({'nom':nom,'reussi':r.returncode==0});self.sauver()
        print(nom+(' RÉUSSI' if r.returncode==0 else ' ÉCHEC'),flush=True)
        exiger(r.returncode==0, nom+' : arrêt ; consulter le journal privé')
        return r.stdout
    def worker(self, nom, p, nouveau=False):
        script=self.code/('scripts/og-publication/verifier.cjs' if nouveau else 'scripts/publication/controle.cjs')
        return json.loads(self.run(nom,[NODE,str(script)],entree=json.dumps(p).encode(),prive=True))
    def pg(self, nom, t, operation, **kw):
        url=kw.pop('url',self.infos[t]['env']['DATABASE_URL'])
        return self.worker(nom,{'operation':operation,'url':url,'nom':base_locale(url),**kw})
    def http(self, base, chemin):
        req=urllib.request.Request(base+chemin,headers={'Cache-Control':'no-cache'})
        with urllib.request.urlopen(req,timeout=30) as r:
            exiger(r.status==200 and r.url==base+chemin, 'Redirection ou statut public inattendu')
            return json.loads(r.read())
    def charger(self):
        self.manifest=json.loads((ICI/'manifest.json').read_text())
        exiger(sha(ICI/'candidat.tar.gz')==self.manifest['archive_sha256'], 'Archive altérée')
        self.code=self.out/'candidat';self.code.mkdir();extraire(ICI/'candidat.tar.gz',self.code)
        exiger(contenu(self.code)==self.manifest['candidat'], 'Sources candidates altérées')
        deps=Path(self.args.dependances).resolve()
        exiger(deps.is_dir() and (deps/'pg').is_dir() and (deps/'playwright').is_dir(), 'Dépendances de recette absentes')
        exiger(sha(deps.parent/'package-lock.json')==sha(self.code/'package-lock.json'), 'Dépendances non alignées sur package-lock.json')
        (self.code/'node_modules').symlink_to(deps,target_is_directory=True)
        self.rapport['archive_sha256']=self.manifest['archive_sha256'];self.sauver()
    def inventaire(self):
        bases=[]
        for t in self.args.cibles.split(','):
            root,service,base=CIBLES[t]; root=Path(root)
            e={'publie':False,'statut':'inventaire'};self.rapport['environnements'][t]=e;self.sauver()
            env=lire_env(root/'shared/.env')
            # Aucun accès à une base ou service de Production après ce contrôle.
            if env.get('ARRIMO_ENV')!='demo' or env.get('ARRIMO_DEMO')!='1':
                e.update(statut='exclu_hors_demo',motif='ARRIMO_ENV=demo et ARRIMO_DEMO=1 requis');self.sauver();continue
            unite=self.run('service-'+t,['systemctl','show',service+'.service','--property=ActiveState,User,Group,WorkingDirectory,ExecStart,EnvironmentFiles,Environment','--no-pager'],prive=True).decode()
            props=dict(x.split('=',1) for x in unite.splitlines() if '=' in x)
            fichiers=[]
            for ligne in unite.splitlines():
                if ligne.startswith('EnvironmentFiles='):
                    fichiers.extend(re.findall(r'(/[^ ]+) \(ignore_errors=(?:yes|no)\)',ligne.split('=',1)[1]))
            exiger(fichiers and Path(fichiers[0])==root/'shared/.env', 'Fichiers systemd inattendus : '+t)
            for f in fichiers:
                exiger(Path(f).resolve().parent==(root/'shared').resolve(), 'Drop-in hors configuration partagée')
                env.update(lire_env(f, systemd=True))
            exiger(not props.get('Environment'), 'Environment systemd direct : analyse manuelle requise')
            exiger(env.get('ARRIMO_ENV')=='demo' and env.get('ARRIMO_DEMO')=='1', 'Configuration effective non Démo')
            exiger(props.get('ActiveState')=='active' and props.get('WorkingDirectory')==str(root/'current'), 'Service non actif ou chemin inattendu')
            exiger(NODE in props.get('ExecStart','') and 'src/server.js' in props['ExecStart'], 'Runtime ou point d’entrée inattendu')
            exiger(props.get('User') not in ('',None,'root'), 'Compte applicatif dédié requis')
            exiger(env.get('HOST','127.0.0.1')=='127.0.0.1','Écoute locale requise')
            port=int(env['PORT']);exiger(1024<=port<=65535,'Port refusé')
            url=env['DATABASE_URL']; nom=base_locale(url);bases.append(nom)
            self.secrets += [v for k,v in env.items() if any(m in k for m in ('URL','KEY','CLE','SECRET','PASSWORD','PASSE'))]
            rel=courant(root)
            exiger(contenu(root/rel)==self.manifest['baseline'], 'Code hébergé différent de la référence testée : '+t)
            public=self.http(base,'/api/public');exiger(public.get('demo') is True and public.get('environnement')=='demo','API publique non Démo')
            local=self.http('http://127.0.0.1:'+str(port),'/api/public');exiger(local.get('demo') is True and local.get('environnement')=='demo','API locale non Démo')
            self.infos[t]={'root':root,'service':service,'base':base,'env':env,'ancien':rel,'port':port,'user':props['User'],'group':props.get('Group') or props['User']}
            ident=self.pg('base-'+t,t,'identite');self.infos[t]['role']=ident['role']
            sante=self.http(base,'/api/sante');exiger(sante.get('etat')=='ok' and sante.get('base')=='ok','Santé dégradée')
            e.update(statut='demo_identifiee',base=nom,release_avant=rel,sante_avant=sante,service_actif=True);self.sauver()
        exiger(len(set(bases))==len(bases), 'Bases partagées entre cibles : arrêt')
        exiger(self.infos,'Aucune cible Démo éligible')
        # SH n’embarque pas le moteur hospitalier : pas de redémarrage ni d’écriture SH.
        self.rapport['environnements']['sh']={'publie':False,'statut':'console_distincte_non_modifiee','verification':'non_effectuee','motif':'OG est fourni par les API hospitalières ciblées ; aucun correctif SH requis'}
        self.sauver()
    def verifier_sh(self, phase):
        e=self.rapport['environnements']['sh']
        env=lire_env('/opt/arrimo-sh/shared/.env')
        exiger(env.get('ARRIMO_ENV')=='sh','Configuration SH inattendue')
        liaison=env.get('SH_ENV_DEMO_URL','').rstrip('/')
        cible=next((t for t,i in self.infos.items() if liaison=='http://127.0.0.1:'+str(i['port']) and env.get('SH_ENV_DEMO_PUBLIC','').rstrip('/')==i['base']),None)
        if not cible:
            e.update(statut='liaison_demo_hors_cibles_eligibles',verification='non_effectuee',motif='La liaison Démo SH ne correspond pas à une cible confirmée Démo ; aucun appel à cette liaison')
            self.sauver();return
        actif=self.run('service-sh-'+phase,['systemctl','is-active','arrimo-sh.service'],prive=True).decode().strip()
        exiger(actif=='active','Console SH non active')
        s=self.http('https://sh.arrimo.senseafri.com','/api/sante');exiger(s.get('etat')=='ok' and s.get('base')=='ok','Santé SH en échec')
        cible_public=self.http(self.infos[cible]['base'],'/api/public');exiger(cible_public.get('environnement')=='demo','Liaison SH hors Démo')
        e.update(statut='console_inchangee_liaison_demo_verifiee',verification=phase,cible_og=cible,sante=s,motif='Pas de moteur OG hospitalier dans la console ; seule la liaison Démo a été contrôlée')
        self.sauver()
    def comptes(self):
        donnees=dict(getattr(self,'identifiants',{}))
        if self.args.acces:
            p=Path(self.args.acces);exiger(p.is_file() and p.stat().st_uid==0 and not p.stat().st_mode&0o077,'Fichier accès root privé 0600 requis');donnees=json.loads(p.read_text())
        for t,i in self.infos.items():
            comptes=donnees.get(t)
            if not comptes:
                exiger(sys.stdin.isatty(),'Accès manquants : fournir --acces ou lancer dans un terminal interactif')
                mdp=getpass.getpass('Mot de passe commun des comptes Démo A/B/C et coordination régionale — '+t+' : ')
                comptes=[{'nom':n,'email':('reseau@demo.arrimo' if n=='reseau' else 'hopital.'+n+'@demo.arrimo'),'password':mdp,'code':code} for n,code in [('a','HX'),('b','HY'),('c','HC'),('reseau','HX')]]
            if not hasattr(self,'identifiants'):self.identifiants={}
            self.identifiants[t]=comptes
            exiger({c['nom'] for c in comptes}=={'a','b','c','reseau'} and len(comptes)==4,'Comptes A/B/C et coordination régionale requis')
            self.sessions[t]=[]
            for c in comptes:
                exiger(c.get('password') and c.get('email') and c.get('code'),'Email, password et code requis')
                self.secrets.append(c['password'])
                r=self.worker('connexion-'+t+'-'+c['nom'],{'operation':'connexion','base':i['base'],'email':c['email'],'password':c['password']})
                if r.get('etape')=='2fa':
                    exiger(sys.stdin.isatty(),'MFA requis : lancer dans un terminal interactif')
                    otp=getpass.getpass('Code MFA de '+c['email']+' : ')
                    r=self.worker('mfa-'+t+'-'+c['nom'],{'operation':'connexion','base':i['base'],'jeton':r['jeton'],'otp':otp})
                token=r.get('token','');exiger(re.fullmatch(r'[a-f0-9]{64}',token),'Session non obtenue')
                session={'nom':c['nom'],'code':c['code'],'token':token};self.sessions[t].append(session)
                self.secrets.append(token)
                droit=self.worker('droits-'+t+'-'+c['nom'],{'operation':'acces','type':'demo','base':i['base'],'token':token})
                if c['nom']=='reseau':
                    exiger(droit['gestionnaire'] and droit['role']=='gestionnaire' and len(droit['etablissements'])>=3,'Coordination régionale habilitée requise')
                else:
                    exiger(not droit['gestionnaire'] and len(droit['etablissements'])==1,'Compte hospitalier isolé requis')
                    session['etablissement_id']=droit['etablissements'][0]
            hopitaux=[c for c in self.sessions[t] if c['nom']!='reseau']
            exiger(len({c['etablissement_id'] for c in hopitaux})==3,'Trois établissements hospitaliers distincts requis')
    def maintenance(self, nom, sql):
        return self.run(nom,['/usr/sbin/runuser','-u','postgres','--','psql','-X','-w','-v','ON_ERROR_STOP=1','-d','postgres'],entree=sql.encode(),prive=True)
    def sauvegarde(self,t):
        i=self.infos[t]; d=self.out/('sauvegarde-'+t);d.mkdir(mode=0o700)
        snap=self.pg('sauvegarde-'+t,t,'sauvegarde',dump=str(d/'database.dump'))
        self.run('controle-dump-'+t,['pg_restore','--list',str(d/'database.dump')],prive=True)
        shutil.copy2(i['root']/'shared/.env',d/'configuration.env')
        (d/'unite.systemd').write_bytes(self.run('sauvegarde-unite-'+t,['systemctl','cat',i['service']+'.service'],prive=True))
        shutil.copytree(i['root']/'shared',d/'configuration-partagee',symlinks=True)
        with tarfile.open(d/'release.tar.gz','w:gz',dereference=False) as tar:
            tar.add(i['root']/i['ancien'],arcname='release')
        (d/'SHA256SUMS.json').write_text(json.dumps({str(p.relative_to(d)):sha(p) for p in d.rglob('*') if p.is_file() and not p.is_symlink()},indent=2))
        role=i['role'];exiger(re.fullmatch(r'[a-z_][a-z0-9_]*',role),'Rôle SQL refusé')
        nom='arrimo_publication_restore_og_'+t+'_'+self.id.rsplit('_',1)[1]
        self.maintenance('creer-copie-'+t,f'CREATE DATABASE "{nom}" OWNER "{role}" TEMPLATE template0;\nREVOKE CONNECT ON DATABASE "{nom}" FROM PUBLIC;\n')
        self.rapport['bases_isolees'].append(nom);self.sauver()
        url=url_copie(i['env']['DATABASE_URL'],nom);u=urllib.parse.urlsplit(url);q=urllib.parse.parse_qs(u.query)
        env=dict(self.env,PGDATABASE=nom,PGHOST=q.get('host',[u.hostname or '/var/run/postgresql'])[0],PGPORT=str(u.port or 5432),PGUSER=urllib.parse.unquote(u.username or role),PGCONNECT_TIMEOUT='10')
        if u.password:env['PGPASSWORD']=urllib.parse.unquote(u.password)
        if 'sslmode' in q:env['PGSSLMODE']=q['sslmode'][0]
        self.run('restaurer-copie-'+t,['pg_restore','--dbname='+nom,'--exit-on-error','--no-owner','--no-acl',str(d/'database.dump')],env=env,prive=True)
        apres=self.pg('integrite-restauration-'+t,t,'empreintes',url=url,colonnes=snap['colonnes'])
        exiger(apres['contenu']==snap['contenu'],'Restauration non identique')
        self.rapport['environnements'][t].update(sauvegarde=str(d),restauration_verifiee=True,copie=nom);self.sauver()
        verif=self.worker('og-copie-'+t,{'code':str(self.code),'url':url,'nom':nom,'copie':True,'comptes':self.sessions[t],'suivi_reel':True},nouveau=True)
        self.rapport['environnements'][t]['suivi_copie']=verif
        apres=self.pg('copie-non-modifiee-'+t,t,'empreintes',url=url,colonnes=snap['colonnes'])
        exiger(apres['contenu']==snap['contenu'],'Le contrôle OG a modifié la copie')
        self.rapport['environnements'][t]['og_copie_verifie']=True;self.sauver()
    def recette(self):
        # Code sans secrets et dépendances accessibles à postgres ; aucune permission serveur élargie.
        stage=Path('/var/tmp')/('arrimo-og-recette-'+self.id);stage.mkdir(mode=0o755)
        code=stage/'application';shutil.copytree(self.code,code,symlinks=False,ignore=shutil.ignore_patterns('node_modules'))
        shutil.copytree(self.code/'node_modules',code/'node_modules',symlinks=False)
        for p in [stage,*stage.rglob('*')]:
            if not p.is_symlink():shutil.chown(p,user='postgres',group='postgres');p.chmod(0o700 if p.is_dir() else (0o700 if p.stat().st_mode&0o111 else 0o600))
        self.rapport['recette_dossier']=str(stage);self.sauver()
        env=dict(self.env,HOME=str(stage),TMPDIR=str(stage),ARRIMO_ENV='demo',ARRIMO_DEMO='1')
        # Cache privé de recette : seulement les révisions correspondant au lock courant.
        exiger(shutil.disk_usage('/var/tmp').free > 2_000_000_000, 'Au moins 2 Go libres requis pour la recette isolée')
        cache=Path(self.env.get('PLAYWRIGHT_BROWSERS_PATH','/root/.cache/ms-playwright'))
        navigateurs=stage/'navigateurs';navigateurs.mkdir(mode=0o700);shutil.chown(navigateurs,user='postgres',group='postgres')
        revisions=json.loads((code/'node_modules/playwright-core/browsers.json').read_text())['browsers']
        for b in revisions:
            if b['name'] not in ('chromium','chromium-headless-shell','ffmpeg'):continue
            nom=b['name'].replace('-','_')+'-'+b['revision']
            if (cache/nom).is_dir():shutil.copytree(cache/nom,navigateurs/nom,symlinks=False)
        for p in navigateurs.rglob('*'):
            if not p.is_symlink():shutil.chown(p,user='postgres',group='postgres')
        env['PLAYWRIGHT_BROWSERS_PATH']=str(navigateurs)
        self.env['PLAYWRIGHT_BROWSERS_PATH']=str(navigateurs)
        def commande(nom,argv,env=env):
            return self.run(nom,['/usr/sbin/runuser','-u','postgres','--',*argv],env=env,cwd=code)
        commande('runtime-reel',[NODE,'scripts/verifier-runtime-tests.cjs'])
        # Installation utilisateur bornée des seuls binaires navigateur, sans --with-deps.
        commande('chromium-version-requise',[NODE,'node_modules/playwright/cli.js','install','chromium'])
        commande('chromium-reel',[NODE,'-e',"require('playwright').chromium.launch({headless:true}).then(b=>b.close()).catch(()=>process.exitCode=1)"])
        spec=importlib.util.spec_from_file_location('suites',self.code/'scripts/recette-serveur-arrimo.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        suites=[*module.SUITES,('og-postgres','arrimo_og_test_','OG_TEST_DATABASE_URL',['tests/og-postgres.test.cjs']),
                ('og-suivi-postgres','arrimo_og_suivi_test_','OG_SUIVI_TEST_DATABASE_URL',['tests/og-suivi-postgres.test.cjs'])]
        self.rapport['recette_suites']=[]
        for nom,prefixe,variable,fichiers in suites:
            base=prefixe+secrets.token_hex(7);exiger(re.fullmatch(r'arrimo_[a-z0-9_]+',base) and len(base)<=63,'Nom de recette invalide')
            self.maintenance('creer-'+nom,f'CREATE DATABASE "{base}" TEMPLATE template0;\nREVOKE CONNECT ON DATABASE "{base}" FROM PUBLIC;\n')
            self.rapport['bases_isolees'].append(base);self.sauver()
            url='postgresql://postgres@127.0.0.1/'+base+'?host=/var/run/postgresql'
            e=module.environnement_suite(dict(env,**{variable:url}),nom)
            texte=commande('recette-'+nom,[NODE,'--test','--test-concurrency=1','--test-reporter=tap',*fichiers],env=e)
            exiger(tap_valide(texte),'Résultat TAP absent, incomplet ou ignoré : '+nom)
            self.rapport['recette_suites'].append({'suite':nom,'reussie':True,'tests':int(re.search(rb'^# tests (\d+)',texte,re.M)[1])});self.sauver()
        exiger(contenu(code)==self.manifest['candidat'],'Sources modifiées par les tests')
        self.run('exercice-rollback',['bash',str(self.code/'deploy/test-releases.sh')])
        self.rapport['recette_integree_verifiee']=True;self.sauver()
    def preparer_release(self,t):
        i=self.infos[t];root=i['root'];exiger(courant(root)==i['ancien'],'Release modifiée pendant la recette')
        exiger(contenu(root/i['ancien'])==self.manifest['baseline'],'Sources hébergées modifiées pendant la recette')
        rid='arrimo-og-'+self.id;dest=root/'releases'/rid;exiger(not dest.exists(),'Release déjà présente')
        shutil.copytree(root/i['ancien'],dest,symlinks=True,ignore=shutil.ignore_patterns('node_modules'))
        for rel in FICHIERS_OG:
            p=dest/rel
            if p.exists():p.chmod(0o640)
            shutil.copyfile(self.code/rel,p);p.chmod(0o640)
        (dest/'node_modules').symlink_to((root/i['ancien']/'node_modules').resolve(),target_is_directory=True)
        marker=dest/'.arrimo-release'
        if marker.exists():marker.chmod(0o640)
        marker.write_text('commit='+self.manifest['commit_base']+'\nog_archive_sha256='+self.manifest['archive_sha256']+'\n')
        for p in [dest,*dest.rglob('*')]:
            if not p.is_symlink():shutil.chown(p,user='root',group=i['group']);p.chmod(0o750 if p.is_dir() else (0o750 if p.stat().st_mode&0o111 else 0o640))
        exiger(contenu(dest)==self.manifest['candidat'],'Release différente du code testé')
        i['candidate']=rid
        self.run('lecture-runtime-'+t,['/usr/sbin/runuser','-u',i['user'],'--',NODE,'-e',"require(process.argv[1]+'/src/og-outils');require(process.argv[1]+'/src/copilote')",str(dest)],cwd=dest)
        rollback=self.out/('retour-'+t+'.sh')
        rollback.write_text('#!/bin/bash\nset -euo pipefail\n'+shlex.join(['python3',str(ICI/'publier.py'),'--retour',str(self.out/'rapport.json'),'--cible-retour',t])+'\n');rollback.chmod(0o700)
        self.rapport['environnements'][t].update(release_candidate='releases/'+rid,retour_arriere=str(rollback));self.sauver()
    def activer(self,t):
        i=self.infos[t];e=self.rapport['environnements'][t]
        exiger(courant(i['root'])==i['ancien'],'Pointeur modifié avant bascule')
        # Enregistrer AVANT le restart pour assurer un rollback même si celui-ci échoue.
        self.modifies.append(t);e['statut']='bascule_en_cours';self.sauver()
        self.run('bascule-'+t,['bash',str(self.code/'deploy/releases.sh'),'activate',str(i['root']),i['candidate'],i['service']+'.service','http://127.0.0.1:'+str(i['port'])+'/api/sante'])
        exiger(courant(i['root'])=='releases/'+i['candidate'],'Pointeur candidat non actif')
        exiger(contenu(i['root']/courant(i['root']))==self.manifest['candidat'],'Empreinte active incorrecte')
        sante=self.http(i['base'],'/api/sante');exiger(sante.get('etat')=='ok' and sante.get('base')=='ok','Santé après publication en échec')
        verif=self.worker('og-public-'+t,{'code':str(self.code),'url':i['env']['DATABASE_URL'],'nom':base_locale(i['env']['DATABASE_URL']),'base':i['base'],'copie':False,'comptes':self.sessions[t],'suivi_reel':True},nouveau=True)
        e.update(statut='publie_et_verifie',publie=True,sante_apres=sante,verification_og=verif,release_active=courant(i['root']));self.sauver()
    def revenir(self,t):
        i=self.infos[t];e=self.rapport['environnements'][t];rel=courant(i['root'])
        exiger(rel in (i['ancien'],'releases/'+i['candidate']),'Pointeur modifié par un tiers : arrêt du rollback')
        if rel!=i['ancien']:
            self.run('retour-'+t,['bash',str(self.code/'deploy/releases.sh'),'activate',str(i['root']),Path(i['ancien']).name,i['service']+'.service','http://127.0.0.1:'+str(i['port'])+'/api/sante'])
        else:self.run('ancien-service-'+t,['systemctl','start',i['service']+'.service'])
        s=self.http(i['base'],'/api/sante');exiger(s.get('etat')=='ok' and s.get('base')=='ok','Ancienne release non saine')
        e.update(statut='retour_arriere_verifie',publie=False,release_active=courant(i['root']),sante_retour=s);self.sauver()
    def fermer(self):
        for t,comptes in self.sessions.items():
            for c in comptes:
                try:
                    req=urllib.request.Request(self.infos[t]['base']+'/api/deconnexion',data=b'{}',headers={'Authorization':'Bearer '+c['token'],'Content-Type':'application/json'},method='POST')
                    with urllib.request.urlopen(req,timeout=15) as r:exiger(r.status==200,'Déconnexion refusée')
                except Exception:
                    self.rapport['environnements'][t]['sessions_test_a_fermer']=True
        self.sauver()
    def executer(self):
        self.charger();self.inventaire();self.verifier_sh('avant')
        if self.args.audit:
            self.rapport['statut']='audit_sans_publication';self.sauver();return
        self.maintenance('postgres-maintenance','SELECT 1;\n')
        self.run('tests-locaux',[NODE,'scripts/test-vnext-local.cjs',str(self.out/'tests-locaux.json')])
        tests=json.loads((self.out/'tests-locaux.json').read_text())['total'];exiger(tests['reussis']>=152 and not any(tests[k] for k in ('echecs','ignores','annules')),'Tests locaux incomplets')
        self.comptes()
        for t in self.infos:self.sauvegarde(t)
        self.recette()
        # Renouveler normalement les sessions après la recette évite un recalage au restart
        # et assure une durée de validité suffisante, sans fabriquer de jeton.
        self.fermer();self.comptes()
        for t in self.infos:self.preparer_release(t)
        for t in self.infos:self.activer(t)
        self.verifier_sh('apres')
        self.rapport.update(statut='publication_verifiee',publication_verifiee=True);self.sauver()

def retour(args):
    p=Path(args.retour).resolve();exiger(p.name=='rapport.json' and p.parent.name.startswith('arrimo-og-publication-'),'Rapport de publication attendu')
    r=json.loads(p.read_text());t=args.cible_retour;exiger(t in CIBLES,'Cible de retour requise')
    e=r['environnements'][t];root,service,base=CIBLES[t];env=lire_env(Path(root)/'shared/.env')
    exiger(env.get('ARRIMO_ENV')=='demo' and env.get('ARRIMO_DEMO')=='1','Retour limité à la Démo')
    retour_env={'PATH':str(Path(NODE).parent)+':/usr/bin:/bin','LANG':'C.UTF-8','HOME':'/root'}
    unite=subprocess.run(['systemctl','show',service+'.service','--property=WorkingDirectory,ExecStart,EnvironmentFiles,Environment','--no-pager'],capture_output=True,check=True,timeout=30,env=retour_env).stdout.decode()
    props=dict(l.split('=',1) for l in unite.splitlines() if '=' in l)
    exiger(not props.get('Environment') and props.get('WorkingDirectory')==str(Path(root)/'current') and NODE in props.get('ExecStart',''), 'Configuration de retour inattendue')
    fichiers=[]
    for ligne in unite.splitlines():
        if ligne.startswith('EnvironmentFiles='):fichiers.extend(re.findall(r'(/[^ ]+) \(ignore_errors=(?:yes|no)\)',ligne.split('=',1)[1]))
    exiger(fichiers and Path(fichiers[0])==Path(root)/'shared/.env','Configuration de retour incomplète')
    for f in fichiers:
        exiger(Path(f).resolve().parent==(Path(root)/'shared').resolve(),'Configuration de retour hors périmètre')
        env.update(lire_env(f, systemd=True))
    exiger(env.get('ARRIMO_ENV')=='demo' and env.get('ARRIMO_DEMO')=='1','Retour refusé hors Démo effective')
    with urllib.request.urlopen(base+'/api/public',timeout=30) as rep:public=json.loads(rep.read())
    exiger(public.get('demo') is True and public.get('environnement')=='demo','API publique hors Démo')
    exiger(courant(root)==e['release_candidate'],'Le candidat ne correspond plus au pointeur actif')
    exiger(re.fullmatch(r'releases/[A-Za-z0-9._-]+',e['release_avant']),'Ancienne release refusée')
    # Restaurer uniquement le code, jamais les données.
    commande=['bash',str(p.parent/'candidat/deploy/releases.sh'),'activate',root,Path(e['release_avant']).name,service+'.service','http://127.0.0.1:'+str(int(env['PORT']))+'/api/sante']
    subprocess.run(commande,check=True,timeout=90,env=retour_env)
    exiger(courant(root)==e['release_avant'],'Ancien pointeur non restauré')
    req=urllib.request.Request(base+'/api/sante')
    with urllib.request.urlopen(req,timeout=30) as rep:s=json.loads(rep.read())
    exiger(s.get('etat')=='ok' and s.get('base')=='ok','Santé HTTPS du retour dégradée')
    e.update(statut='retour_arriere_verifie',publie=False,sante_retour=s,release_active=courant(root));r.update(statut='retour_arriere',publication_verifiee=False)
    p.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print('Retour applicatif vérifié ; base non restaurée.')

def main():
    a=argparse.ArgumentParser(description=__doc__);a.add_argument('--audit',action='store_true');a.add_argument('--cibles',default='demo,principal');a.add_argument('--acces');a.add_argument('--dependances',default='/root/arrimo-sh-erp/node_modules');a.add_argument('--retour');a.add_argument('--cible-retour');args=a.parse_args()
    exiger(os.geteuid()==0,'Session SSH root requise');os.umask(0o077)
    exiger(set(args.cibles.split(','))<=set(CIBLES) and args.cibles,'Cibles autorisées : demo,principal')
    with open('/root/arrimo-publication.lock','a') as verrou:
        try:fcntl.flock(verrou,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise Refus('Une publication est déjà en cours')
        if args.retour:retour(args);return 0
        pub=Publication(args);print('Rapport privé : '+str(pub.out/'rapport.json'),flush=True)
        def interruption(*_):raise KeyboardInterrupt()
        signal.signal(signal.SIGTERM,interruption);signal.signal(signal.SIGHUP,interruption)
        try:pub.executer()
        except BaseException as e:
            pub.rapport.update(statut='arrete',blocage=str(e) if isinstance(e,Refus) else type(e).__name__,publication_verifiee=False);pub.sauver()
            for t in reversed(pub.modifies):
                try:pub.revenir(t)
                except BaseException:pub.rapport['environnements'][t]['statut']='retour_a_verifier';pub.sauver()
            print('ARRÊT : '+pub.rapport['blocage'],flush=True)
        finally:pub.fermer()
        print('Résultat : '+pub.rapport['statut']+' — '+str(pub.out/'rapport.json'),flush=True)
        return 0 if pub.rapport['statut'] in ('publication_verifiee','audit_sans_publication') else 1
if __name__=='__main__':
    try:sys.exit(main())
    except (Refus,OSError,ValueError) as e:
        print('Publication refusée : '+str(e) if isinstance(e,Refus) else 'Publication refusée : configuration ou accès indisponible',file=sys.stderr);sys.exit(1)
