"""Préparation puis publication des services existants depuis la candidate SH testée."""
import datetime,fcntl,hashlib,importlib.util,json,os,pathlib,pwd,re,secrets,shutil,subprocess,sys,tempfile,time,urllib.request,urllib.parse
ROOT=pathlib.Path('/root/arrimo-sh-erp');NODE='/opt/arrimo-runtime/node-v24.22.1/bin/node'
spec=importlib.util.spec_from_file_location('og',ROOT/'scripts/og-publication/publier.py');og=importlib.util.module_from_spec(spec);spec.loader.exec_module(og)
INVENTAIRE=ROOT/'.local/inventaire-ecosysteme.json'
EXPECTED='14b954e019776f9a4c504dedd743eb740b67b012bec852d121659cbff8529737'
SAFE_ENV={k:v for k,v in os.environ.items() if not k.startswith('PG') and not k.endswith('DATABASE_URL')}
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def run(args,*,data=None,env=None,cwd=ROOT,timeout=180):
 r=subprocess.run(args,input=data,capture_output=True,text=True,env=env or SAFE_ENV,cwd=cwd,timeout=timeout)
 if r.returncode:raise RuntimeError(pathlib.Path(args[0]).name+' : '+re.sub(r'postgres(?:ql)?://\S+','[URL masquée]',r.stderr)[-1200:])
 return r.stdout

def save(p,d):p.write_text(json.dumps(d,indent=2,ensure_ascii=False)+'\n');p.chmod(0o600)
def worker(payload):
 if payload.get('operation')=='sauvegarde' and payload.get('nom')=='arrimo_validation_restore':
  temp=pathlib.Path(tempfile.mkdtemp(prefix='arrimo-snapshot-',dir='/var/tmp'));account=pwd.getpwnam('postgres');os.chown(temp,account.pw_uid,account.pw_gid)
  script=temp/'controle.cjs';shutil.copy2(ROOT/'scripts/publication/controle.cjs',script);os.chown(script,account.pw_uid,account.pw_gid);script.chmod(0o600)
  modules=temp/'node_modules';modules.mkdir();pending=['pg'];seen=set();installed=pathlib.Path('/opt/arrimo-demo/current/node_modules').resolve()
  while pending:
   package=pending.pop()
   if package in seen:continue
   seen.add(package);source=installed/package
   if not source.is_dir():continue
   target=modules/package;target.parent.mkdir(parents=True,exist_ok=True);shutil.copytree(source,target,symlinks=True)
   meta=json.loads((source/'package.json').read_text());pending.extend(meta.get('dependencies',{}))
  for item in [modules,*modules.rglob('*')]:
   if not item.is_symlink():os.chown(item,account.pw_uid,account.pw_gid);item.chmod(0o750 if item.is_dir() else 0o640)
  original=pathlib.Path(payload['dump']);request={**payload,'url':'postgresql:///arrimo_validation_restore?host=/var/run/postgresql','dump':str(temp/'database.dump')}
  try:
   result=json.loads(run(['runuser','-u','postgres','--','env','NODE_PATH='+str(modules),NODE,str(script)],data=json.dumps(request)))
   shutil.copy2(temp/'database.dump',original);original.chmod(0o600);return result
  finally:shutil.rmtree(temp)
 return json.loads(run([NODE,str(ROOT/'scripts/publication/controle.cjs')],data=json.dumps(payload)))
def sql(db,text):
 assert re.fullmatch('[a-z0-9_]+',db)
 return run(['runuser','-u','postgres','--','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-d',db],data=text,timeout=300)
def ident(x):return '"'+x.replace('"','""')+'"'
def lit(x):return "'"+x.replace("'","''")+"'"
def url_for(env):return env.get('SH_DATABASE_URL') or env['DATABASE_URL']
def copy_url(url,db):
 u=urllib.parse.urlsplit(url);return urllib.parse.urlunsplit((u.scheme,u.netloc,'/'+db,u.query,''))
def manifest(code):return {str(p.relative_to(code)):sha(p) for p in sorted(code.rglob('*')) if p.is_file() and not p.is_symlink()}
def fingerprint():return run([NODE,'-e',"console.log(require('./scripts/empreinte-sources.cjs').empreinteSources())"]).strip()
def health(base):
 with urllib.request.urlopen(base+'/api/sante',timeout=20) as r:d=json.load(r)
 assert d['etat']=='ok' and d['base']=='ok';return {k:d.get(k) for k in ['etat','base','version']}
def definition(db):
 q="""SELECT json_agg(row_to_json(x)) FROM(SELECT c.relname nom,json_agg(json_build_object('nom',a.attname,'type',format_type(a.atttypid,a.atttypmod)) ORDER BY a.attnum) colonnes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname='public' AND c.relkind='r' GROUP BY c.relname ORDER BY c.relname)x;"""
 return json.loads(sql(db,q))
def hospital_sql(code,definition,role):
 # Conserver les anciennes valeurs, dont les traductions NULL : aucune mise à jour de données anciennes.
 prelude='\n'.join((code/'db/migrations'/name).read_text() for name in ['20261022_capacites_og.sql','20261023_services_hospitaliers.sql','20261023_structure_hospitaliere_detaillee.sql','20261024_comptes_invitations.sql','20261025-priorites.sql','20261025-simulation.sql'])
 prelude=re.sub(r'(?m)^\s*(?:BEGIN|COMMIT);\s*$','',prelude)
 schema=prelude+'\n'+(code/'db/schema.sql').read_text()
 schema=re.sub(r'UPDATE types_unite SET nom_en = v.nom_en\n.*?types_unite.nom_en IS NULL;','-- Traductions existantes conservées.',schema,flags=re.S)
 tables={x['nom'] for x in definition}
 if 'specialites_catalogue' in tables:schema=re.sub(r'INSERT INTO specialites_catalogue .*?ON CONFLICT \(code\) DO NOTHING;','-- Catalogue existant conservé.',schema,flags=re.S)
 queries=[]
 for t in definition:
  cols=','.join(f"{ident(c['nom'])}::{c['type']} AS {ident(c['nom'])}" for c in t['colonnes'])
  q=f"SELECT json_build_object('n',count(*),'hash',md5(coalesce(string_agg(md5(row_to_json(x)::text),'' ORDER BY md5(row_to_json(x)::text)),'')))::text FROM(SELECT {cols} FROM public.{ident(t['nom'])})x"
  queries.append((t['nom'],q))
 before='\n'.join(f'INSERT INTO arrimo_garde SELECT {lit(n)},({q});' for n,q in queries)
 after='\n'.join(f"IF (SELECT valeur FROM arrimo_garde WHERE nom={lit(n)}) IS DISTINCT FROM ({q}) THEN RAISE EXCEPTION 'Anciennes données modifiées : %',{lit(n)}; END IF;" for n,q in queries)
 grant='\n'.join(f'GRANT SELECT,INSERT,UPDATE,DELETE ON public.{ident(n)} TO {ident(role)};' for n in ['services','departements','etages','specialites_catalogue','conges','patients','controles','admission_referentiels','admission_habilitations','connecteurs_simulation_config','connecteurs_correspondances','connecteurs_simulation_flux','connecteurs_simulation_evenements'] if n not in tables)
 return "BEGIN; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s'; SELECT pg_advisory_xact_lock(hashtext('arrimo-publication-ecosysteme'));\n"+'\n'.join(f'LOCK TABLE public.{ident(t["nom"])} IN SHARE ROW EXCLUSIVE MODE;' for t in definition)+"\nCREATE TEMP TABLE arrimo_garde(nom text PRIMARY KEY,valeur text) ON COMMIT DROP;\n"+before+'\n'+schema+'\n'+grant+f'\nGRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO {ident(role)};\nDO $garde$ BEGIN\n'+after+'\nEND $garde$; COMMIT;'
def owner_env(env,db):
 u=urllib.parse.urlsplit(url_for(env));e=dict(SAFE_ENV,PGHOST=u.hostname or '/var/run/postgresql',PGPORT=str(u.port or 5432),PGDATABASE=db,PGUSER=urllib.parse.unquote(u.username))
 if u.password:e['PGPASSWORD']=urllib.parse.unquote(u.password)
 return e
def base_url(d):
 return {'demo':'https://demo.arrimo.senseafri.com','principal':'https://arrimo.senseafri.com','recette':'https://recette.arrimo.senseafri.com','sh':'https://sh.arrimo.senseafri.com','sh-validation':'https://recette.arrimo.senseafri.com/sh-validation','validation':f"http://127.0.0.1:{d['port']}"}[d['nom']]
def checkpoint(folder,r):save(folder/'rapport.json',r)
def prepare(folder):
 assert fingerprint()==EXPECTED
 proof=json.loads((ROOT/'.local/raccordement-support-20261029/recette-consolidee.json').read_text());assert proof['statut']=='valide' and proof['sources_sha256']==EXPECTED
 folder.mkdir(mode=0o700,exist_ok=True);code=folder/'candidate'
 if (folder/'rapport.json').exists():
  return resume_prepare(folder,code,json.loads((folder/'rapport.json').read_text()))
 code.mkdir()
 for directory in ['src','public','public-sh','db']:shutil.copytree(ROOT/directory,code/directory)
 (code/'scripts').mkdir();shutil.copy2(ROOT/'scripts/sh-validation.cjs',code/'scripts/sh-validation.cjs')
 for f in ['package.json','package-lock.json']:shutil.copy2(ROOT/f,code/f)
 (code/'node_modules').symlink_to((ROOT/'node_modules').resolve(),target_is_directory=True)
 save(folder/'manifest.json',manifest(code))
 r={'sources_sha256':EXPECTED,'statut':'preparation','services':{},'aucune_reinitialisation':True};checkpoint(folder,r)
 return resume_prepare(folder,code,r)
def resume_prepare(folder,code,r):
 items=json.loads(INVENTAIRE.read_text())
 for d in items:
  name=d['nom']
  if r['services'].get(name,{}).get('prepare'):continue
  print('Préparation '+name,flush=True)
  root=pathlib.Path(d['root']);env=og.lire_env(d['configuration'],systemd=True)
  current=root/'current';old=current.resolve() if current.is_symlink() else root
  reuse_deps=(old/'package-lock.json').read_bytes()==(ROOT/'package-lock.json').read_bytes()
  deps=(old/'node_modules').resolve() if reuse_deps else pathlib.Path('/opt/arrimo-demo/current/node_modules').resolve()
  e={'nom':name,'base':d['base'],'ancienne_release':str(old),'legacy':not current.is_symlink(),'configuration_sha256':sha(d['configuration']),'prepare':False,'publie':False};r['services'][name]=e;checkpoint(folder,r)
  evidence=folder/name
  if evidence.exists():evidence.rename(folder/(name+'-tentative-'+secrets.token_hex(3)))
  evidence.mkdir(mode=0o700)
  shutil.copy2(d['configuration'],evidence/'configuration.env');(evidence/'configuration.env').chmod(0o600)
  (evidence/'service.txt').write_text(run(['systemctl','cat',d['service']]))
  dump=evidence/'database.dump'
  snap=worker({'operation':'sauvegarde','url':url_for(env),'nom':d['base'],'dump':str(dump)})
  dump.chmod(0o600);save(evidence/'snapshot.json',snap);run(['pg_restore','--list',str(dump)])
  db='arrimo_publication_restore_'+name.replace('-','_')+'_'+secrets.token_hex(5)
  sql('postgres',f'CREATE DATABASE {ident(db)} OWNER {ident(d["role"])} TEMPLATE template0; REVOKE CONNECT ON DATABASE {ident(db)} FROM PUBLIC;')
  run(['pg_restore','--exit-on-error','--no-owner','--no-acl','--dbname='+db,str(dump)],env=owner_env(env,db),timeout=300)
  url=copy_url(url_for(env),db)
  assert worker({'operation':'empreintes','url':url,'nom':db,'colonnes':snap['colonnes']})['contenu']==snap['contenu']
  e.update(copie=db,sauvegarde_sha256=sha(dump),restauration_identique=True)
  if name.startswith('sh'):
   owner=d['role'];role=owner+'_scope'
   status=sql('postgres',f"SELECT COALESCE((SELECT NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls FROM pg_roles WHERE rolname={lit(role)}),false)").strip()
   if status!='t':raise RuntimeError('Rôle restreint manquant ou non conforme : '+role)
   for n in [1,2]:worker({'operation':'migrer','url':url,'nom':db,'type':'sh','code':str(code),'env':env,'role':owner})
  else:
   definition_before=definition(db);ddl=hospital_sql(code,definition_before,d['role']);(evidence/'migration.sql').write_text(ddl)
   sql(db,ddl);sql(db,hospital_sql(code,definition(db),d['role']))
   if name=='demo':
    before=run([NODE,str(ROOT/'scripts/etat-abc-lot1.cjs')],env={**SAFE_ENV,'ARRIMO_ETAT_CONFIGURATION':d['configuration']});save(evidence/'scenario-abc-avant.json',json.loads(before))
  # Les clones n'ont aucun mécanisme de démarrage/simulation/supervision. Smoke lecture seule sans identité fabriquée.
  for label,path in [('ancien',old),('nouveau',code)]:
   worker({'operation':'local','type':'sh' if name.startswith('sh') else 'hospitalier','url':url,'nom':db,'code':str(path),'env':env,'comptes':[]})
  # Préparer aussi la release immuable, avant toute interruption du service.
  rid='support-'+folder.name.split('-')[-1];release=root/'releases'/rid
  release.parent.mkdir(exist_ok=True)
  if e['legacy']:
   fallback=root/'releases'/('avant-'+folder.name.split('-')[-1]);fallback.mkdir()
   for rel in ['src','public','db','package.json','package-lock.json']:
    src=old/rel
    if src.is_dir():shutil.copytree(src,fallback/rel)
    elif src.is_file():shutil.copy2(src,fallback/rel)
   (fallback/'node_modules').symlink_to((old/'node_modules').resolve(),target_is_directory=True)
   e['fallback']=str(fallback)
  shutil.copytree(code,release,ignore=shutil.ignore_patterns('node_modules'),symlinks=True)
  if reuse_deps:(release/'node_modules').symlink_to(deps,target_is_directory=True)
  else:shutil.copytree(deps,release/'node_modules',symlinks=True)
  user_line=next(x for x in d['unit'].splitlines() if x.startswith('User='));user=user_line.split('=',1)[1];gid=pwd.getpwnam(user).pw_gid
  for base in [release]+([pathlib.Path(e['fallback'])] if e['legacy'] else []):
   for p in [base,*base.rglob('*')]:
    if not p.is_symlink():os.chown(p,0,gid);p.chmod(0o750 if p.is_dir() else 0o640)
  entry=release/('src/sh/app.js' if name.startswith('sh') else 'src/app.js')
  run(['runuser','-u',user,'--',NODE,'-e','require(process.argv[1]);',str(entry)],cwd=release)
  e.update(prepare=True,migrations_copie_rejouables=True,smoke_ancien_et_nouveau=True,nouvelle_release=str(release));checkpoint(folder,r)
 assert fingerprint()==EXPECTED;r['statut']='pret_a_publier';checkpoint(folder,r);print(str(folder/'rapport.json'),flush=True)
def publish(folder):
 r=json.loads((folder/'rapport.json').read_text());assert r['statut'] in ['pret_a_publier','arrete'] and all(x['prepare'] for x in r['services'].values()) and fingerprint()==EXPECTED
 proof=json.loads((ROOT/'.local/raccordement-support-20261029/recette-consolidee.json').read_text());assert proof['statut']=='valide' and proof['sources_sha256']==EXPECTED and 'parite' in {x['suite'] for x in proof['suites']}
 code=folder/'candidate';assert manifest(code)==json.loads((folder/'manifest.json').read_text())
 items={d['nom']:d for d in json.loads(INVENTAIRE.read_text())}
 # Valider le mécanisme de bascule hors services publics.
 run(['git','diff','--exit-code','--','deploy/releases.sh','deploy/test-releases.sh']) # Mécanisme inchangé, déjà exercé lors de la livraison précédente.
 for name in ['sh-validation','validation','recette','principal','demo','sh']:
  e=r['services'][name]
  if e.get('publie'):continue
  d=items[name];root=pathlib.Path(d['root']);env=og.lire_env(d['configuration'],systemd=True);release=pathlib.Path(e['nouvelle_release'])
  assert sha(d['configuration'])==e['configuration_sha256']
  if not e['legacy']:assert (root/'current').resolve()==pathlib.Path(e['ancienne_release'])
  print('Publication '+name,flush=True);stopped=False;dropin=None
  metadata={'candidate_sources_sha256':EXPECTED,'application_sha256':hashlib.sha256(json.dumps(json.loads((folder/'manifest.json').read_text()),sort_keys=True).encode()).hexdigest(),'release':release.name}
  public_dir=release/('public-sh' if name.startswith('sh') else 'public')
  (public_dir/'version.json').write_text(json.dumps(metadata,sort_keys=True)+'\n');os.chown(public_dir/'version.json',0,release.stat().st_gid);(public_dir/'version.json').chmod(0o640)
  session_demo=None
  try:
   if name=='demo':
    account=next(a for a in json.loads(pathlib.Path('/root/.local/arrimo-publication-acces.json').read_text())['demo'] if a['nom']=='b')
    request=urllib.request.Request(base_url(d)+'/api/connexion',data=json.dumps({'email':account['email'],'mot_de_passe':account['password']}).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=20) as response:session_demo=json.load(response).get('token')
    assert session_demo,'Connexion normale B requise avant bascule'
    current=json.loads(run([NODE,str(ROOT/'scripts/etat-abc-lot1.cjs')],env={**SAFE_ENV,'ARRIMO_ETAT_CONFIGURATION':d['configuration']}))
    save(folder/name/'scenario-abc-avant-reprise.json',current)
    e['connexion_normale_B_avant_bascule']=True
   # Sauvegarde fraîche avant bascule ; celle restaurée reste conservée séparément.
   fresh=folder/name/'avant-bascule.dump';worker({'operation':'sauvegarde','url':url_for(env),'nom':d['base'],'dump':str(fresh)});fresh.chmod(0o600);run(['pg_restore','--list',str(fresh)])
   e['sauvegarde_fraiche_sha256']=sha(fresh)
   run(['systemctl','stop',d['service']]);stopped=True
   if name.startswith('sh'):
    worker({'operation':'migrer','url':url_for(env),'nom':d['base'],'type':'sh','code':str(code),'env':env,'role':d['role'],'public_autorise':True,'preuves':{'restauration':True,'migration_copie':True,'ancien_code':True}})
   else:sql(d['base'],hospital_sql(code,definition(d['base']),d['role']))
   if e['legacy']:
    (root/'current').symlink_to(pathlib.Path(e['fallback']).relative_to(root),target_is_directory=True)
    dropin=pathlib.Path('/etc/systemd/system')/(d['service']+'.service.d')/'90-release-ecosysteme.conf';dropin.parent.mkdir(exist_ok=True)
    assert not dropin.exists()
    dropin.write_text(f'[Service]\nWorkingDirectory={root}/current\nExecStart=\nExecStart={NODE} src/server.js\n')
    run(['systemctl','daemon-reload'])
   run(['bash',str(ROOT/'deploy/releases.sh'),'activate',str(root),release.name,d['service'],'http://127.0.0.1:'+d['port']+'/api/sante']);stopped=False
   e['sante']=health(base_url(d))
   with urllib.request.urlopen(base_url(d)+'/version.json',timeout=20) as response:assert json.load(response)==metadata
   e['version_application']=metadata
   folder_public='public-sh' if name.startswith('sh') else 'public'
   count=0
   for rel,digest in json.loads((folder/'manifest.json').read_text()).items():
    if rel.startswith(folder_public+'/'):
     suffix=rel[len(folder_public)+1:]
     with urllib.request.urlopen(base_url(d)+'/'+urllib.parse.quote(suffix),timeout=20) as response:assert hashlib.sha256(response.read()).hexdigest()==digest,suffix
     count+=1
   assert sha(d['configuration'])==e['configuration_sha256']
   if name=='demo':
    after=json.loads(run([NODE,str(ROOT/'scripts/etat-abc-lot1.cjs')],env={**SAFE_ENV,'ARRIMO_ETAT_CONFIGURATION':d['configuration']}))
    before=json.loads((folder/name/'scenario-abc-avant-reprise.json').read_text());assert after==before,'Scénario ABC modifié'
    save(folder/name/'scenario-abc-apres-publication.json',after)
    e['scenario_abc_et_comptes_preserves']=True
   e.pop('erreur',None);e.pop('retour_applicatif',None)
   e.update(publie=True,assets_verifies=count,configuration_preservee=True);checkpoint(folder,r)
  except BaseException as error:
   if (root/'current').is_symlink() and (root/'current').resolve()==release:
    run(['bash',str(ROOT/'deploy/releases.sh'),'rollback',str(root),'',d['service'],'http://127.0.0.1:'+d['port']+'/api/sante'])
   elif stopped:run(['systemctl','start',d['service']])
   e['erreur']=str(error);e['retour_applicatif']=True;r['statut']='arrete';checkpoint(folder,r);raise
  finally:
   if session_demo:
    request=urllib.request.Request(base_url(d)+'/api/deconnexion',method='POST',data=b'{}',headers={'Content-Type':'application/json','Authorization':'Bearer '+session_demo})
    with urllib.request.urlopen(request,timeout=20) as response:response.read()
 r.pop('patient_modifie',None);r['aucune_reinitialisation']=True
 r['statut']='publie';checkpoint(folder,r);print(str(folder/'rapport.json'),flush=True)
if __name__=='__main__':
 with open(ROOT/'.local/publication-ecosysteme.lock','a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  mode=sys.argv[1];folder=pathlib.Path(sys.argv[2])
  if mode=='preparer':prepare(folder)
  elif mode=='reverifier':
   state=json.loads((folder/'rapport.json').read_text());items={d['nom']:d for d in json.loads(INVENTAIRE.read_text())}
   for name,e in state['services'].items():
    if not name.startswith('sh'):
     print('Répétition finale '+name,flush=True);sql(e['copie'],hospital_sql(folder/'candidate',definition(e['copie']),items[name]['role']))
   print('Répétitions finales réussies',flush=True)
  elif mode=='diagnostiquer':
   state=json.loads((folder/'rapport.json').read_text());d=next(x for x in json.loads(INVENTAIRE.read_text()) if x['nom']=='demo')
   after=json.loads(run([NODE,str(ROOT/'scripts/etat-abc-lot1.cjs')],env={**SAFE_ENV,'ARRIMO_ETAT_CONFIGURATION':d['configuration']}));before=json.loads((folder/'demo/scenario-abc-avant.json').read_text());save(folder/'demo/scenario-abc-apres.json',after)
   for k in before:
    if before[k]!=after[k]:
     print(k, 'diffère')
     if isinstance(before[k],list):
      for a,b in zip(before[k],after[k]):print('champs modifiés :',[f for f in a if a.get(f)!=b.get(f)])
  else:publish(folder)
