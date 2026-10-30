import importlib.util,pathlib,subprocess,json
S=pathlib.Path('/root/arrimo-sh-erp')
spec=importlib.util.spec_from_file_location('og',S/'scripts/og-publication/publier.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
items=[('principal','/opt/arrimo','arrimo','shared/.env'),('demo','/opt/arrimo-demo','arrimo-public-demo','shared/.env'),('recette','/opt/arrimo-recette','arrimo-recette','.env'),('validation','/opt/arrimo-validation','arrimo-validation','shared/.env'),('sh','/opt/arrimo-sh','arrimo-sh','shared/.env'),('sh-validation','/opt/arrimo-sh-validation','arrimo-sh-validation','shared/.env')]
from urllib.parse import urlsplit
out=[]
for name,root,unit,file in items:
 env=m.lire_env(pathlib.Path(root)/file,systemd=True);u=urlsplit(env.get('SH_DATABASE_URL') or env['DATABASE_URL']);db=u.path[1:]
 sql="SELECT json_build_object('tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),'owners',(SELECT json_agg(DISTINCT tableowner) FROM pg_tables WHERE schemaname='public'),'profiles',(SELECT json_agg(code) FROM config_pays),'etablissements',(SELECT json_agg(json_build_object('code',code,'nom',nom)) FROM etablissements))" if not name.startswith('sh') else "SELECT json_build_object('versions',(SELECT json_agg(version ORDER BY version) FROM sh_migrations),'hopitaux',(SELECT json_agg(json_build_object('code',code_etab,'nom',nom,'environnement',environnement,'relie',relie)) FROM hopitaux),'scope_role',EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_database()||'_scope'))"
 r=subprocess.run(['runuser','-u','postgres','--','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-d',db,'-c',sql],capture_output=True,text=True)
 if r.returncode:raise RuntimeError(name+' : '+r.stderr)
 d={'nom':name,'root':root,'service':unit,'configuration':str(pathlib.Path(root)/file),'base':db,'role':u.username,'port':env['PORT'],'mode':env.get('ARRIMO_ENV'),'etat':json.loads(r.stdout),'unit':subprocess.run(['systemctl','show',unit,'-p','User,Group,WorkingDirectory,ExecStart,EnvironmentFiles'],capture_output=True,text=True).stdout}
 out.append(d)
p=S/'.local/inventaire-ecosysteme.json';p.write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n');p.chmod(0o600)
for d in out:print(json.dumps({k:v for k,v in d.items() if k!='unit'},ensure_ascii=False))
