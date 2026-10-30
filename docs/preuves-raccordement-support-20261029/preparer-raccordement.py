import importlib.util,pathlib,json,secrets,subprocess,hashlib,urllib.parse,os
ROOT=pathlib.Path('/root/arrimo-sh-erp');DEST=ROOT/'.local/raccordement-support-20261029';DEST.mkdir(mode=0o700,exist_ok=True)
spec=importlib.util.spec_from_file_location('og',ROOT/'scripts/og-publication/publier.py');og=importlib.util.module_from_spec(spec);spec.loader.exec_module(og)
items=[('principal','demo','/opt/arrimo/shared/.env',3010),('demo','demo_abc','/opt/arrimo-demo/shared/.env',3016),('recette','recette','/opt/arrimo-recette/.env',3011)]
shfile=pathlib.Path('/opt/arrimo-sh/shared/.env');shenv=og.lire_env(shfile,systemd=True);updates_sh={};plan={'sources':[],'configurations':[],'aucune_ecriture_publique':True}
def digest(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def proposer(file,updates,name):
 file=pathlib.Path(file);target=DEST/(name+'.env');backup=DEST/(name+'-avant.env')
 if backup.exists():assert digest(backup)==digest(file),'Configuration changée depuis la préparation'
 else:backup.write_bytes(file.read_bytes());backup.chmod(0o600)
 texte=file.read_text();lignes=texte.splitlines();reste=dict(updates)
 for i,line in enumerate(lignes):
  if '=' not in line or line.lstrip().startswith('#'):continue
  key=line.split('=',1)[0].strip().removeprefix('export ')
  if key in reste:lignes[i]=key+'='+reste.pop(key)
 lignes+=['']+[k+'='+v for k,v in reste.items()]
 target.write_text('\n'.join(lignes)+'\n');target.chmod(0o600)
 parsed=og.lire_env(target,systemd=True);original=og.lire_env(file,systemd=True)
 assert all(parsed.get(k)==v for k,v in original.items() if k not in updates)
 assert all(parsed.get(k)==v for k,v in updates.items())
 plan['configurations'].append({'nom':name,'fichier':str(file),'candidate':str(target),'avant':str(backup),'sha256_avant':digest(file),'sha256_candidate':digest(target),'cles_modifiees':list(updates)})
for nom,cible,file,port in items:
 env=og.lire_env(file,systemd=True);u=urllib.parse.urlsplit(env['DATABASE_URL']);assert u.hostname=='127.0.0.1' and (u.port or 5432)==5432
 database=u.path[1:];assert database=={'principal':'arrimo','demo':'arrimo_demo_trio_public_f6db_20261023','recette':'arrimo_recette'}[nom]
 api_key=env.get('SH_API_KEY') or secrets.token_hex(32)
 if cible in ['demo','recette']:assert shenv['SH_ENV_'+cible.upper()+'_CLE']==api_key
 cle_support=secrets.token_hex(32);updates={'ARRIMO_SUPPORT_SH_URL':'http://127.0.0.1:3012','ARRIMO_SUPPORT_CLE':cle_support,'ARRIMO_SUPPORT_CIBLE':cible}
 if not env.get('SH_API_KEY'):updates['SH_API_KEY']=api_key
 if cible=='demo_abc':updates_sh.update(SH_ENV_DEMO_ABC_URL='http://127.0.0.1:3016',SH_ENV_DEMO_ABC_CLE=api_key,SH_ENV_DEMO_ABC_PUBLIC='https://demo.arrimo.senseafri.com')
 updates_sh['SH_SUPPORT_'+cible.upper()+'_CLE']=cle_support
 r=subprocess.run(['runuser','-u','postgres','--','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-d',database,'-c',"SELECT COALESCE(json_agg(row_to_json(x)),'[]') FROM(SELECT e.id,e.code,e.nom,e.ville,e.adresse,e.config_id,e.module_actif,e.latitude,e.longitude,e.sous_domaine,c.code profil,c.fuseau FROM etablissements e JOIN config_pays c ON c.id=e.config_id WHERE e.actif ORDER BY e.code)x"],capture_output=True,text=True,check=True)
 refs=json.loads(r.stdout);mapping=json.loads(env.get('ARRIMO_PROFILS_PAYS','{}'))
 for ref in refs:
  ref['pays_code']=mapping.get(ref['profil']) or ('CA' if ref['profil']=='QC' else None);assert ref['pays_code'],'Pays non démontré pour un profil source'
 proposer(file,updates,nom)
 plan['sources'].append({'nom':nom,'cible':cible,'base':database,'port':port,'etablissements':refs,'fichier_env':file})
proposer(shfile,updates_sh,'sh')
(DEST/'plan.json').write_text(json.dumps(plan,indent=2,ensure_ascii=False)+'\n');(DEST/'plan.json').chmod(0o600)
print(json.dumps({'plan':str(DEST/'plan.json'),'hospitaux_existants_a_raccorder':{s['cible']:len(s['etablissements']) for s in plan['sources']},'cles_uniques':len({og.lire_env(c['candidate'],systemd=True).get('ARRIMO_SUPPORT_CLE') for c in plan['configurations'] if c['nom']!='sh'})==3,'aucune_ecriture_publique':True}))
