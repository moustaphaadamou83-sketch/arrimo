import json,pathlib,hashlib,shutil,subprocess,os,secrets,urllib.request,importlib.util,time
ROOT=pathlib.Path('/root/arrimo-sh-erp');FOLDER=ROOT/'.local/raccordement-support-20261029';NODE='/opt/arrimo-runtime/node-v24.22.1/bin/node'
spec=importlib.util.spec_from_file_location('og',ROOT/'scripts/og-publication/publier.py');og=importlib.util.module_from_spec(spec);spec.loader.exec_module(og)
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def run(args,**kwargs):
 r=subprocess.run(args,capture_output=True,text=True,check=False,**kwargs)
 if r.returncode:raise RuntimeError(pathlib.Path(args[0]).name+' : '+r.stderr[-600:])
 return r.stdout

def get(url,key=None):
 req=urllib.request.Request(url,headers={'X-SH-Key':key} if key else {})
 with urllib.request.urlopen(req,timeout=15) as response:return json.load(response)
def health(port):
 for i in range(15):
  try:
   assert get('http://127.0.0.1:'+str(port)+'/api/sante')['etat']=='ok';return
  except Exception:
   if i==14:raise
   time.sleep(1)
def installer(c):
 p=pathlib.Path(c['fichier']);assert sha(p) in [c['sha256_avant'],c['sha256_candidate']];st=p.stat();tmp=p.parent/('.env-raccordement-'+secrets.token_hex(4))
 shutil.copyfile(c['candidate'],tmp);os.chown(tmp,st.st_uid,st.st_gid);tmp.chmod(st.st_mode&0o777);os.replace(tmp,p)
def main():
 publication=json.loads((ROOT/'.local/raccordement-release-20261029t1755/rapport.json').read_text());assert publication['statut']=='publie'
 plan=json.loads((FOLDER/'plan.json').read_text());cfg={c['nom']:c for c in plan['configurations']}
 for c in cfg.values():assert sha(c['fichier']) in [c['sha256_avant'],c['sha256_candidate']]
 shenv=og.lire_env(cfg['sh']['candidate'],systemd=True)
 support_keys=[shenv['SH_SUPPORT_'+s['cible'].upper()+'_CLE'] for s in plan['sources']];assert len(set(support_keys))==3
 report={'statut':'en_cours','sources':[],'ecritures_hospitalieres':False}
 changed=[]
 try:
  # La nouvelle clé ABC n'est prise en compte qu'après redémarrage de son propre service.
  installer(cfg['demo']);changed.append('demo');run(['systemctl','restart','arrimo-public-demo']);health(3016)
  installer(cfg['sh']);changed.append('sh');run(['systemctl','restart','arrimo-sh']);health(3012)
  validated=[]
  for source in plan['sources']:
   current=og.lire_env(cfg[source['nom']]['candidate'],systemd=True);key=current['SH_API_KEY'];base='http://127.0.0.1:'+str(source['port'])
   caps=get(base+'/api/sh/capacites',key);assert caps['selectionPays']
   profiles={p['id']:p for p in caps['profilsPays']};etabs=get(base+'/api/sh/etablissements',key);observed={e['code']:e for e in etabs}
   assert set(observed)=={e['code'] for e in source['etablissements']},'Liste des établissements changée'
   for e in source['etablissements']:
    actual=observed[e['code']];assert actual['nom']==e['nom'] and actual['config_id']==e['config_id'] and actual['module_actif']==e['module_actif']
    assert profiles[e['config_id']]['pays_code']==e['pays_code']
   validated.append({'cible':source['cible'],'etablissements':source['etablissements']})
  file=FOLDER/'sources-verifiees.json';file.write_text(json.dumps(validated)+'\n');file.chmod(0o600)
  raw=run([NODE,str(ROOT/'.local/raccorder-support.cjs'),str(file)],env={k:v for k,v in {**os.environ,**shenv}.items() if not k.startswith('PG')},cwd=ROOT);report['liaisons']=json.loads(raw)
  for name,service,port in [('principal','arrimo',3010),('recette','arrimo-recette',3011)]:
   installer(cfg[name]);changed.append(name);run(['systemctl','restart',service]);health(port)
  for source in plan['sources']:
   target=source['cible'];key=shenv['SH_SUPPORT_'+target.upper()+'_CLE'];n=0
   for e in source['etablissements']:
    req=urllib.request.Request('http://127.0.0.1:3012/api/portail-support/'+target+'/'+e['code']+'/configuration',headers={'X-Support-Key':key})
    with urllib.request.urlopen(req,timeout=15) as response:assert json.load(response)=={'disponible':True}
    n+=1
   report['sources'].append({'cible':target,'etablissements_raccordes':n})
  for c in cfg.values():assert sha(c['fichier'])==c['sha256_candidate']
  report.update(statut='actif',configuration_verifiee=True,cles_distinctes=True)
 except BaseException:
  # Les fiches SH vérifiées restent conservées ; les configurations initiales ferment les accès clients.
  for name in reversed(changed):
   c=cfg[name];p=pathlib.Path(c['fichier']);st=p.stat();tmp=p.parent/('.env-retour-'+secrets.token_hex(4));shutil.copyfile(c['avant'],tmp);os.chown(tmp,st.st_uid,st.st_gid);tmp.chmod(st.st_mode&0o777);os.replace(tmp,p)
   run(['systemctl','restart',{'demo':'arrimo-public-demo','principal':'arrimo','recette':'arrimo-recette','sh':'arrimo-sh'}[name]])
  report.update(statut='retour_configuration',configurations_retournees=True);raise
 finally:
  (FOLDER/'activation.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
 print(json.dumps({'statut':report['statut'],'raccordes':sum(s['etablissements_raccordes'] for s in report['sources']),'rapport':str(FOLDER/'activation.json')}))
if __name__=='__main__':main()
