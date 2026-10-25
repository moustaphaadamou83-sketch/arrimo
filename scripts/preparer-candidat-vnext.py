#!/usr/bin/env python3
"""Prépare un artefact NON publiable et son empreinte ; aucun accès réseau ou base."""
import argparse
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile
import datetime

racine = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('destination', type=pathlib.Path)
parser.add_argument('--rapport-tests', required=True, type=pathlib.Path)
args = parser.parse_args()


def git(*arguments):
    return subprocess.run(['git', *arguments], cwd=racine, check=True, stdout=subprocess.PIPE).stdout


if git('status', '--porcelain').strip():
    raise SystemExit('Dépôt non propre : committer avant de préparer le candidat.')
chemins = []
for dossier in ['src', 'public', 'public-sh', 'db', 'scripts', 'tests']:
    chemins.extend(p.relative_to(racine).as_posix() for p in (racine / dossier).rglob('*') if p.is_file() and not p.is_symlink())
chemins.extend(p for p in ['package.json', 'package-lock.json'] if (racine / p).is_file())
hash_sources = hashlib.sha256()
for rel in sorted(chemins):
    hash_sources.update(rel.encode() + b'\0' + (racine / rel).read_bytes() + b'\0')
rapport = json.loads(args.rapport_tests.read_text())
total = rapport.get('total', {})
if rapport.get('sources_sha256') != hash_sources.hexdigest() or rapport.get('sources_modifiees'):
    raise SystemExit('Les tests locaux ne correspondent pas aux sources courantes.')
if not total.get('reussis') or any(total.get(k, 1) != 0 for k in ['echecs', 'ignores', 'annules']):
    raise SystemExit('Résultats locaux incomplets ou en échec.')
commit = git('rev-parse', 'HEAD').decode().strip()
destination = args.destination.resolve()
destination.mkdir(parents=True, exist_ok=False)  # aucun artefact antérieur écrasé
archive = destination / f'arrimo-vnext-candidat-{commit[:12]}.tar.gz'
date = datetime.datetime.now(datetime.timezone.utc).isoformat()
contenu = git('archive', '--format=tar', 'HEAD')
with tarfile.open(fileobj=io.BytesIO(contenu), mode='r:') as source, tarfile.open(archive, mode='w:gz') as sortie:
    for entree in source:
        if entree.name == '.arrimo-release':
            continue  # ne pas propager le marqueur périmé hérité des anciennes archives
        morceaux = pathlib.PurePosixPath(entree.name).parts
        if '.local' in morceaux or '.env' in morceaux:
            raise SystemExit('Fichier de configuration privé suivi dans Git : artefact refusé.')
        sortie.addfile(entree, source.extractfile(entree) if entree.isfile() else None)
    marqueur = f'commit={commit}\nbuilt_at={date}\ncandidate_only=true\n'.encode()
    entree = tarfile.TarInfo('.arrimo-release')
    entree.size = len(marqueur)
    entree.mode = 0o640
    sortie.addfile(entree, io.BytesIO(marqueur))
sha = hashlib.sha256(archive.read_bytes()).hexdigest()
(destination / (archive.name + '.sha256')).write_text(f'{sha}  {archive.name}\n')
(destination / 'tests-locaux.json').write_text(json.dumps(rapport, ensure_ascii=False, indent=2) + '\n')
manifest = {'commit': commit, 'date': date, 'artefact': archive.name, 'sha256': sha, 'sources_sha256': hash_sources.hexdigest(),
            'tests_locaux': total, 'publication_admissible': False,
            'validations_manquantes': ['Sauvegarde restaurée vérifiée', 'Migration sur copie restaurée',
                                      'Tests PostgreSQL réels et régression complète', 'Scénarios navigateur A/B/C/Réseau',
                                      'Vérification SH et HTTPS public', 'Rollback applicatif répété'],
            'deploiement_effectue': False}
(destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(manifest, ensure_ascii=False, indent=2))
