"""Actualiser seulement le service et la base fictifs de validation déjà installés."""
import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request

def main():
    root=Path('/opt/arrimo-sh-validation');source=Path(__file__).resolve().parents[1]
    avant=(root/'current').resolve();shared=root/'shared'
    env=dict(l.split('=',1) for l in (shared/'.env').read_text().splitlines() if '=' in l)
    if env.get('SH_VALIDATION_FICTIVE')!='1' or 'SMTP_URL' in env:raise RuntimeError('Validation fictive requise')
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release=root/'releases'/('lot1-presence-'+stamp)
    shutil.copytree(avant,release,symlinks=True)
    for directory in ['src/sh','public-sh']:
        for f in (source/directory).rglob('*'):
            if f.is_file():
                dest=release/f.relative_to(source);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,dest)
    shutil.copy2(source/'src/courriel.js',release/'src/courriel.js')
    for f in release.rglob('*'):
        if not f.is_symlink():f.chmod(0o755 if f.is_dir() else 0o644)
    def pointer(p):
        temp=root/('.current-'+stamp);os.symlink(str(p.relative_to(root)),temp);os.replace(temp,root/'current')
    def redemarrer():subprocess.run(['systemctl','restart','arrimo-sh-validation'],check=True)
    pointer(release)
    try:
        redemarrer()
        for n in range(20):
            try:
                with urllib.request.urlopen('https://recette.arrimo.senseafri.com/sh-validation/api/sante',timeout=5) as r:
                    assert json.load(r)['etat']=='ok'
                break
            except Exception:
                if n==19:raise
                time.sleep(1)
    except Exception:
        pointer(avant);redemarrer();raise
    print(json.dumps({'release':str(release),'url':'https://recette.arrimo.senseafri.com/sh-validation/','fictive':True,'smtp_reel':False,'sante':True}))
if __name__=='__main__':main()
