#!/usr/bin/env python3
"""Configurer Gmail pour SH seulement. À lancer en root dans un terminal privé.
Le secret est stocké dans le .env serveur, hors Git ; propriétaire, groupe et mode du .env préservés.
Aucun secret dans les arguments, sorties ou exceptions. Aucun mode non interactif.
"""
import ast
import fcntl
import getpass
import json
import os
from pathlib import Path
import re
import resource
import stat
import pwd
import grp
import smtplib
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import warnings
from email.message import EmailMessage

ROOT = Path('/opt/arrimo-sh')
CONFIG = ROOT / 'shared/.env'
SERVICE = 'arrimo-sh.service'
ACCOUNT = 'senseafri61@gmail.com'


class Refus(Exception):
    pass


def require(ok, message):
    if not ok:
        raise Refus(message)


def systemctl(*args):
    result = subprocess.run(['systemctl', *args], capture_output=True, timeout=90)
    require(result.returncode == 0, 'Commande systemd SH échouée (sorties masquées).')
    return result.stdout.decode()


def parse_config(text):
    values = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        match = re.fullmatch(r'([A-Z][A-Z0-9_]*)=(.*)', line)
        require(match, 'Format .env complexe : examen manuel nécessaire.')
        key, value = match.groups()
        require(key not in values, 'Clé .env dupliquée : examen manuel nécessaire.')
        if value.startswith(('"', "'")):
            try:
                value = ast.literal_eval(value)
            except Exception:
                raise Refus('Valeur .env complexe : examen manuel nécessaire.') from None
        require(isinstance(value, str), 'Valeur .env non textuelle.')
        values[key] = value
    return values


def write_atomic(data, metadata):
    fd, name = tempfile.mkstemp(prefix='.smtp-sh-', dir=CONFIG.parent)
    try:
        # chown peut effacer les bits spéciaux : appliquer le mode ensuite.
        os.fchown(fd, metadata.st_uid, metadata.st_gid)
        os.fchmod(fd, stat.S_IMODE(metadata.st_mode))
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, CONFIG)
        directory = os.open(CONFIG.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def health(port):
    # Aucune redirection, aucun proxy, uniquement le port SH vérifié.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(f'http://127.0.0.1:{port}/api/sante', timeout=5) as response:
        data = json.load(response)
    require(data.get('etat') == 'ok' and data.get('base') == 'ok', 'Santé SH dégradée.')


def wait_health(port):
    for _ in range(30):
        try:
            systemctl('is-active', SERVICE)
            health(port)
            return
        except Exception:
            time.sleep(2)
    raise Refus('SH ne retrouve pas son état sain.')


def main():
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    require(os.geteuid() == 0, 'Exécuter avec sudo python3 dans le terminal du serveur.')
    require(sys.stdin.isatty(), 'Un terminal interactif est obligatoire.')
    require(CONFIG.resolve() == CONFIG and CONFIG.is_file(), 'Chemin de configuration inattendu ou lien symbolique.')
    require(CONFIG.stat().st_nlink == 1, 'Configuration partagée par lien physique : refus.')
    require(not CONFIG.stat().st_mode & 0o022, 'Configuration modifiable par groupe/autres : refus.')
    require(CONFIG.stat().st_uid == 0, 'Configuration non détenue par root : refus.')
    for parent in [CONFIG.parent, *CONFIG.parents]:
        require(not (parent / '.git').exists(), 'Configuration dans un dépôt Git : refus.')
    # Verrou hors du dépôt ; empêche deux exécutions simultanées de ce script.
    lock_fd = os.open('/run/lock/configurer-smtp-sh.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        configure()


def configure():
    props = dict(line.split('=', 1) for line in systemctl(
        'show', SERVICE, '--property=LoadState,ActiveState,User,Group,WorkingDirectory,ExecStart,EnvironmentFiles,Environment',
        '--no-pager').splitlines() if '=' in line)
    require(props.get('LoadState') == 'loaded' and props.get('ActiveState') == 'active', 'SH doit être chargé et actif.')
    require(props.get('User') == 'arrimo-sh', 'Compte SH inattendu.')
    # Group= vide signifie le groupe primaire de User= dans systemd.
    account = pwd.getpwnam('arrimo-sh')
    group = props.get('Group', '')
    service_gid = grp.getgrnam(group).gr_gid if group else account.pw_gid
    require(service_gid == account.pw_gid, 'Groupe SH inattendu.')
    require(props.get('WorkingDirectory') == str(ROOT / 'current'), 'Répertoire SH inattendu.')
    require('src/sh/server.js' in props.get('ExecStart', '') and 'src/server.js' not in props['ExecStart'], 'Point d’entrée SH inattendu.')
    require(props.get('EnvironmentFiles') == str(CONFIG) + ' (ignore_errors=no)', 'Fichiers d’environnement inattendus.')
    require(not re.search(r'\b(?:SMTP_URL|COURRIEL_EXPEDITEUR|ARRIMO_URL|ARRIMO_ENV|PORT|HOST)=', props.get('Environment', '')), 'Surcharge systemd incompatible.')
    metadata = CONFIG.stat()
    original = CONFIG.read_bytes()
    values = parse_config(original.decode())
    require(values.get('ARRIMO_ENV') == 'sh', 'ARRIMO_ENV doit être sh.')
    require(values.get('HOST', '127.0.0.1') == '127.0.0.1', 'Écoute SH non locale : refus.')
    require(values.get('PORT') == '3012', 'Port SH différent du port vérifié 3012 : refus.')
    public = values.get('SH_PUBLIC_URL', '').rstrip('/')
    require(public == 'https://sh.arrimo.senseafri.com', 'Adresse publique SH inattendue.')
    health(3012)
    print('Précontrôles SH réussis ; aucune modification effectuée.')
    warnings.simplefilter('error', getpass.GetPassWarning)
    password = getpass.getpass('Mot de passe d’application Google (saisie masquée) : ')
    password = password.replace(' ', '')
    require(bool(re.fullmatch('[A-Za-z0-9]{16}', password)), 'Mot de passe d’application attendu : 16 caractères.')
    # TLS avec validation du certificat et du nom d’hôte, sans débogage SMTP.
    with smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=30, context=ssl.create_default_context()) as smtp:
        smtp.login(ACCOUNT, password)
        print('Authentification Gmail sur TLS réussie.')
    smtp_url = 'smtps://' + urllib.parse.quote(ACCOUNT, safe='') + ':' + urllib.parse.quote(password, safe='') + '@smtp.gmail.com:465'
    updates = {'SMTP_URL': smtp_url, 'COURRIEL_EXPEDITEUR': f'Arrimo SH <{ACCOUNT}>', 'ARRIMO_URL': public}
    lines = [line for line in original.decode().splitlines() if line.partition('=')[0] not in updates]
    new = ('\n'.join(lines) + '\n' + '\n'.join(k + '=' + json.dumps(v) for k, v in updates.items()) + '\n').encode()
    # Sauvegarde exclusive hors Git, root seul, avant toute écriture.
    current = CONFIG.stat()
    require(CONFIG.read_bytes() == original and
            (current.st_dev, current.st_ino, current.st_uid, current.st_gid, current.st_mode) ==
            (metadata.st_dev, metadata.st_ino, metadata.st_uid, metadata.st_gid, metadata.st_mode),
            'Configuration modifiée pendant les contrôles : refus.')
    backup_dir = Path(tempfile.mkdtemp(prefix='smtp-sh-sauvegarde-', dir='/root'))
    os.chmod(backup_dir, 0o700)
    with (backup_dir / 'env.avant').open('xb') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(original)
        stream.flush()
        os.fsync(stream.fileno())
    print('Sauvegarde protégée : ' + str(backup_dir / 'env.avant'))
    changed = new != original
    if changed:
        try:
            write_atomic(new, metadata)
            systemctl('restart', SERVICE)
            wait_health(3012)
        except BaseException:
            print('Échec de configuration/redémarrage ; restauration de la sauvegarde SH.')
            try:
                write_atomic(original, metadata)
                systemctl('restart', SERVICE)
                wait_health(3012)
                print('Configuration précédente restaurée ; santé SH vérifiée.')
            except BaseException:
                print('RESTAURATION À VÉRIFIER MANUELLEMENT ; sauvegarde : ' + str(backup_dir))
            raise Refus('Configuration SMTP interrompue ; voir état de restauration ci-dessus.') from None
    print('Configuration SH en place (propriétaire, groupe et permissions préservés) ; service sain.')
    # Passage par le module courriel réellement déployé, avec secret transmis par stdin.
    node = '/opt/arrimo-runtime/node-v24.22.1/bin/node'
    code = """let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',async()=>{try{
Object.assign(process.env,JSON.parse(s));
await require('./src/courriel').envoyer({a:'senseafri61@gmail.com',sujet:'Test SMTP Arrimo SH',texte:'La configuration Gmail SMTP d’Arrimo SH fonctionne.'});
process.exit(0);}catch{process.exit(1);}});"""
    try:
        result = subprocess.run([node, '-e', code], cwd=ROOT / 'current',
                                input=json.dumps(updates).encode(), capture_output=True, timeout=60,
                                env={'PATH': '/usr/bin:/bin', 'NODE_ENV': 'production'})
        require(result.returncode == 0, 'Configuration conservée ; courriel de test en échec (détails masqués).')
        print('Courriel de test accepté par Gmail pour ' + ACCOUNT + ' (réception à vérifier dans la boîte).')
    finally:
        wait_health(3012)
        print('Vérification finale : service SH actif et base accessible.')


if __name__ == '__main__':
    try:
        main()
    except Refus as error:
        # Messages internes fixes uniquement, jamais une exception SMTP/système.
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (Exception, KeyboardInterrupt):
        # Ne jamais imprimer l’exception : elle pourrait contenir une URL ou un secret.
        print('Arrêt sans affichage des détails sensibles. Consulter les étapes ci-dessus ; si les précontrôles échouent, faire examiner la configuration.', file=sys.stderr)
        sys.exit(1)
