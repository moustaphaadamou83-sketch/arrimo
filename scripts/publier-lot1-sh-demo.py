"""Publication ciblée : nouvelle release, sauvegarde, retour applicatif existant.
Pas de seed, reset, modification SMTP ou migration hospitalière.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from urllib.parse import urlsplit, unquote
import urllib.request

SOURCE=Path(__file__).resolve().parents[1]
NODE='/opt/arrimo-runtime/node-v24.22.1/bin/node'
TARGETS={
    'demo': {'root':'/opt/arrimo-demo','service':'arrimo-public-demo','url':'https://demo.arrimo.senseafri.com',
             'files':['src/copilote.js','src/og-suivi.js','src/og-localisation.js']},
    'sh': {'root':'/opt/arrimo-sh','service':'arrimo-sh','url':'https://sh.arrimo.senseafri.com',
           'files':['src/courriel.js'], 'dirs':['src/sh','public-sh']},
}
def run(args,**kwargs):
    r=subprocess.run(args,check=False,text=True,capture_output=True,**kwargs)
    if r.returncode:
        print(r.stdout)
        print(r.stderr)
        r.check_returncode()
    return r
def config(path):
    d={}
    for line in path.read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k,v=line.split('=',1);d[k.strip()]=v.strip().strip('\"\'')
    return d
def h(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def main(nom):
    t=TARGETS[nom];root=Path(t['root']);current=(root/'current').resolve();envfile=root/'shared/.env'
    if current.parent!=root/'releases':raise RuntimeError('Release active non reconnue')
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    preuve=SOURCE/'.local/preuves-sh-lot1'/('publication-'+nom+'-'+stamp);preuve.mkdir(mode=0o700,parents=True)
    settings=config(envfile);before_env=h(envfile);u=urlsplit(settings['DATABASE_URL'])
    if u.hostname!='127.0.0.1':raise RuntimeError('Base locale attendue')
    if nom=='sh' and u.path!='/arrimo_sh':raise RuntimeError('Base SH inattendue')
    if nom=='demo' and 'demo_trio_public' not in u.path:raise RuntimeError('Base Démo ABC inattendue')
    pg={**os.environ,'PGHOST':u.hostname,'PGPORT':str(u.port or 5432),'PGUSER':unquote(u.username),'PGPASSWORD':unquote(u.password),'PGDATABASE':u.path[1:]}
    if nom=='demo':
        preflight=run([NODE,str(SOURCE/'scripts/verifier-og-bilingue-public.cjs'),'--observer'])
        (preuve/'bilingue-avant.log').write_text(preflight.stdout+preflight.stderr)
    dump=preuve/'avant.dump'
    run(['pg_dump','--format=custom','--file='+str(dump)],env={**pg,'PGOPTIONS':'-c default_transaction_read_only=on'})
    dump.chmod(0o600);(preuve/'avant.dump.sha256').write_text(h(dump)+'  avant.dump\n')
    run(['pg_restore','--list',str(dump)])
    shutil.copy2(envfile,preuve/'configuration-avant.env');(preuve/'configuration-avant.env').chmod(0o600)
    unit=run(['systemctl','cat',t['service']]).stdout;(preuve/'service-avant.txt').write_text(unit)
    (preuve/'release-avant.txt').write_text(str(current)+'\n')
    etat=None;copie=None
    if nom=='demo':
        etat=json.loads(run([NODE,str(SOURCE/'scripts/etat-abc-lot1.cjs')],env={**os.environ,'ARRIMO_ETAT_CONFIGURATION':str(envfile)}).stdout)
        if len(etat['lit'])!=1 or etat['transfert'][0]['statut']!='recu':raise RuntimeError('Scénario ABC non conforme avant publication')
        copie='arrimo_lot1_restore_demo_'+stamp.lower()
        run(['runuser','-u','postgres','--','createdb','--owner='+unquote(u.username),copie])
        run(['runuser','-u','postgres','--','psql','-X','-q','-v','ON_ERROR_STOP=1','-d',copie,'-c',f'REVOKE CONNECT ON DATABASE {copie} FROM PUBLIC'])
        run(['pg_restore','--exit-on-error','--no-owner','--no-acl','--dbname='+copie,str(dump)],env={**pg,'PGDATABASE':copie})
        restaure=json.loads(run([NODE,str(SOURCE/'scripts/etat-abc-lot1.cjs')],env={**os.environ,'ARRIMO_ETAT_CONFIGURATION':str(envfile),'ARRIMO_ETAT_COPIE':copie}).stdout)
        if restaure!=etat:raise RuntimeError('Copie restaurée : scénario ou comptes différents')
    release=root/'releases'/('lot1-'+stamp.lower())
    shutil.copytree(current,release,symlinks=True)
    for directory in t.get('dirs',[]):
        for p in (SOURCE/directory).rglob('*'):
            if p.is_file():
                target=release/p.relative_to(SOURCE);target.parent.mkdir(exist_ok=True,parents=True);shutil.copy2(p,target)
    for rel in t['files']:shutil.copy2(SOURCE/rel,release/rel)
    gid=current.stat().st_gid
    # copytree préserve les modes, mais pas les propriétaires : tous les répertoires
    # de la NOUVELLE release doivent être traversables par le groupe du service.
    for p in release.rglob('*'):
        if not p.is_symlink():os.chown(p,0,gid);p.chmod(0o750 if p.is_dir() else 0o640)
    os.chown(release,0,gid);release.chmod(0o750)
    service_user=run(['systemctl','show',t['service'],'-p','User','--value']).stdout.strip()
    if service_user not in ['arrimo','arrimo-sh']:raise RuntimeError('Compte de service inattendu')
    app=release/('src/sh/app.js' if nom=='sh' else 'src/app.js')
    run(['runuser','-u',service_user,'--',NODE,'-e','require(process.argv[1]);',str(app)],cwd=str(release))
    migration=None
    # Vérifier le pointeur avant toute opération pour ne pas écraser une publication concurrente.
    if (root/'current').resolve()!=current:raise RuntimeError('La release active a changé pendant la préparation')
    if nom=='sh':
        run(['systemctl','stop',t['service']])
        try:
            migration=json.loads(run([NODE,str(SOURCE/'scripts/migrer-sh-lot1-public.cjs')],env={**os.environ,'SH_RECETTE_CONFIGURATION':str(envfile)}).stdout)
        except Exception:
            run(['systemctl','start',t['service']]);raise
    rapport={'cible':nom,'date':stamp,'ancienne_release':str(current),'nouvelle_release':str(release),'sauvegarde':str(dump),'copie_restauree':copie,'migration':migration}
    try:
        resultat=run(['bash',str(SOURCE/'deploy/releases.sh'),'activate',str(root),release.name,t['service'],t['url']+'/api/sante'])
        (preuve/'activation.log').write_text(resultat.stdout+resultat.stderr)
        with urllib.request.urlopen(t['url']+'/api/sante',timeout=15) as r:
            if json.load(r).get('etat')!='ok':raise RuntimeError('Santé publique incorrecte')
        if nom=='demo':
            controle=run([NODE,str(SOURCE/'scripts/verifier-og-bilingue-public.cjs')])
            (preuve/'bilingue-public.log').write_text(controle.stdout+controle.stderr)
            apres=json.loads(run([NODE,str(SOURCE/'scripts/etat-abc-lot1.cjs')],env={**os.environ,'ARRIMO_ETAT_CONFIGURATION':str(envfile)}).stdout)
            if apres!=etat:raise RuntimeError('Le scénario ABC ou les comptes ont changé')
            rapport['scenario_et_comptes_preserves']=True
        else:
            with urllib.request.urlopen(t['url']+'/api/connexion/configuration',timeout=15) as r:
                if json.load(r).get('recuperation_disponible') is not True:raise RuntimeError('SMTP existant non reconnu par la récupération SH')
            for rel in ['sh.js','erp.js','acces.js','i18n/en-lot1.js']:
                with urllib.request.urlopen(t['url']+'/'+rel,timeout=15) as r:
                    if hashlib.sha256(r.read()).hexdigest()!=h(SOURCE/'public-sh'/rel):raise RuntimeError('Asset SH inattendu : '+rel)
        if h(envfile)!=before_env:raise RuntimeError('Configuration du service modifiée de manière concurrente')
        rapport.update({'valide':True,'configuration_preservee':True,'production_hospitaliere_modifiee':False})
    except Exception:
        if (root/'current').resolve()==release:
            run(['bash',str(SOURCE/'deploy/releases.sh'),'rollback',str(root),'',t['service'],t['url']+'/api/sante'])
        rapport['valide']=False
        (preuve/'rapport.json').write_text(json.dumps(rapport,indent=2)+'\n')
        raise
    (preuve/'rapport.json').write_text(json.dumps(rapport,indent=2)+'\n')
    print(json.dumps(rapport,indent=2))
if __name__=='__main__':
    import sys
    if len(sys.argv)==3 and sys.argv[1] in TARGETS and sys.argv[2]=='--verifier':
        t=TARGETS[sys.argv[1]]
        release=sorted((Path(t['root'])/'releases').glob('lot1-*'))[-1]
        user=run(['systemctl','show',t['service'],'-p','User','--value']).stdout.strip()
        app=release/('src/sh/app.js' if sys.argv[1]=='sh' else 'src/app.js')
        print(run(['runuser','-u',user,'--',NODE,'-e','require(process.argv[1]);console.log("Import applicatif autorisé");',str(app)],cwd=str(release)).stdout)
        raise SystemExit(0)
    if len(sys.argv)!=2 or sys.argv[1] not in TARGETS:raise SystemExit('Cible explicite requise : demo ou sh')
    main(sys.argv[1])
