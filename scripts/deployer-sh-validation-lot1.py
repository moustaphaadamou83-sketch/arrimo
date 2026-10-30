"""Première installation SH fictive sous /sh-validation/ de la recette existante.
Ne modifie ni le service SH principal, ni sa base, ni la Démo ABC.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import time
import urllib.request

ROOT = Path('/opt/arrimo-sh-validation')
SOURCE = Path(__file__).resolve().parents[1]
USER = 'arrimo_sh_validation'
UNIT = Path('/etc/systemd/system/arrimo-sh-validation.service')
NGINX = Path('/etc/nginx/sites-available/arrimo-recette')
URL = 'https://recette.arrimo.senseafri.com/sh-validation/'
PORT = 3026

def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs)

def main():
    import sys
    reprise='--reprendre' in sys.argv
    if (ROOT.exists() or UNIT.exists()) and not reprise:
        raise RuntimeError('Installation existante : refus de remplacer une configuration sans revue.')
    with socket.socket() as s:
        s.bind(('127.0.0.1', PORT))
    original = NGINX.read_text()
    marker = '    location / {'
    if original.count(marker) != 1 or '/sh-validation/' in original:
        raise RuntimeError('Configuration recette non reconnue.')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = ROOT / 'releases' / ('lot1-' + stamp)
    shared = ROOT / 'shared'
    release.mkdir(parents=True, mode=0o755)
    shared.mkdir(mode=0o750,exist_ok=reprise)
    (shared / ('nginx-avant-' + stamp + '.conf')).write_text(original)
    if not reprise:
        run(['useradd', '--system', '--user-group', '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', USER])
    elif not UNIT.exists() or f'WorkingDirectory={ROOT}/current' not in UNIT.read_text():
        raise RuntimeError('Service existant non reconnu.')
    import pwd
    uid = pwd.getpwnam(USER).pw_uid
    gid = pwd.getpwnam(USER).pw_gid
    os.chown(shared, 0, gid)
    db = 'arrimo_sh_validation_lot1_' + stamp.lower()
    dbpassword = secrets.token_urlsafe(36)
    if not reprise:
        run(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1'], input=f"CREATE ROLE {USER} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '{dbpassword}';\n")
        run(['runuser', '-u', 'postgres', '--', 'createdb', '--owner=' + USER, db])
        run(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', f'REVOKE CONNECT ON DATABASE {db} FROM PUBLIC'])
    for name in ['src', 'public', 'public-sh', 'db']:
        shutil.copytree(SOURCE / name, release / name)
    (release / 'scripts').mkdir()
    shutil.copy2(SOURCE / 'scripts/sh-validation.cjs', release / 'scripts/sh-validation.cjs')
    for name in ['package.json', 'package-lock.json']:
        shutil.copy2(SOURCE / name, release / name)
    shutil.copytree(SOURCE / 'node_modules', release / 'node_modules', symlinks=True)
    manifest = {}
    for directory in ['src', 'public', 'public-sh', 'db', 'scripts']:
        for p in (release / directory).rglob('*'):
            if p.is_file():
                manifest[str(p.relative_to(release))] = hashlib.sha256(p.read_bytes()).hexdigest()
    (release / 'manifest-sha256.json').write_text(json.dumps(manifest, indent=2) + '\n')
    for p in release.rglob('*'):
        if not p.is_symlink():
            p.chmod(0o755 if p.is_dir() else 0o644)
    pointer=ROOT/('.current-'+stamp)
    os.symlink(str(release.relative_to(ROOT)),pointer)
    os.replace(pointer,ROOT/'current')
    for name in ['documents', 'validation']:
        d = shared / name
        d.mkdir(mode=0o700,exist_ok=reprise)
        os.chown(d, uid, gid)
    env = {
        'DATABASE_URL': f'postgres://{USER}:{dbpassword}@127.0.0.1:5432/{db}',
        'PORT': str(PORT), 'SH_VALIDATION_FICTIVE': '1', 'SH_PUBLIC_URL': URL.rstrip('/'),
        'SH_MFA_ENCRYPTION_KEY': __import__('base64').b64encode(secrets.token_bytes(32)).decode(),
        'SH_DOCUMENTS_DIR': str(shared / 'documents'),
        'SH_VALIDATION_ACCES': str(shared / 'validation/acces-validation.json'),
        'SH_VALIDATION_COURRIELS': str(shared / 'validation/courriels-simules.jsonl'),
        'SH_EMETTEUR_NOM': 'SenseAfriGroup Validation', 'NODE_ENV': 'production',
    }
    config = shared / '.env'
    if not reprise:
        config.write_text(''.join(f'{k}={v}\n' for k, v in env.items()))
    else:
        from urllib.parse import urlsplit
        existant=dict(l.split('=',1) for l in config.read_text().splitlines() if '=' in l)
        db=urlsplit(existant['DATABASE_URL']).path[1:]
        if existant.get('SH_VALIDATION_FICTIVE')!='1' or not db.startswith('arrimo_sh_validation_lot1_') or 'SMTP_URL' in existant:
            raise RuntimeError('Configuration fictive existante non reconnue.')
    config.chmod(0o640)
    os.chown(config, 0, gid)
    UNIT.write_text(f'''[Unit]
Description=Arrimo SH validation fictive lot 1
After=network.target postgresql.service
[Service]
User={USER}
Group={USER}
WorkingDirectory={ROOT}/current
EnvironmentFile={config}
ExecStart=/opt/arrimo-runtime/node-v24.22.1/bin/node scripts/sh-validation.cjs
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths={shared}
[Install]
WantedBy=multi-user.target
''')
    location = f'''    location = /sh-validation {{ return 302 /sh-validation/; }}
    location /sh-validation/ {{
        client_max_body_size 16m;
        proxy_pass http://127.0.0.1:{PORT}/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_redirect off;
    }}
'''
    try:
        run(['systemctl', 'daemon-reload'])
        run(['systemctl', 'start', 'arrimo-sh-validation'])
        for attempt in range(30):
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/api/sante', timeout=2) as r:
                    assert json.load(r)['etat'] == 'ok'
                break
            except Exception:
                if attempt == 29:
                    raise
                time.sleep(1)
        NGINX.write_text(original.replace(marker, location + marker))
        run(['nginx', '-t'])
        run(['systemctl', 'reload', 'nginx'])
        for attempt in range(10):
            try:
                with urllib.request.urlopen(URL + 'api/sante', timeout=15) as r:
                    assert json.load(r)['etat'] == 'ok'
                break
            except Exception:
                if attempt==9:
                    raise
                time.sleep(1)
        with urllib.request.urlopen(URL + 'api/connexion/configuration', timeout=15) as r:
            assert json.load(r)['validation_fictive'] is True
        report = {'url': URL, 'release': str(release), 'base_fictive': db, 'service': 'arrimo-sh-validation',
                  'sante_https': True, 'smtp_reel': False, 'cibles_hospitalieres': [],
                  'acces_prives': str(shared / 'validation/acces-validation.json'),
                  'retour_arriere': 'Restaurer la sauvegarde nginx de shared, nginx -t puis reload ; arrêter uniquement arrimo-sh-validation.',
                  'sh_principal_modifie': False, 'demo_abc_modifiee': False}
        (shared / 'deploiement.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=2))
    except Exception:
        NGINX.write_text(original)
        run(['nginx', '-t'])
        run(['systemctl', 'reload', 'nginx'])
        run(['systemctl', 'stop', 'arrimo-sh-validation'])
        raise

if __name__ == '__main__':
    main()
