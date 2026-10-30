#!/usr/bin/env python3
"""Prépare uniquement un lot SSH sous /root ; aucun accès aux services ou aux bases."""
import hashlib
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT=Path(__file__).resolve().parent.parent
args=argparse.ArgumentParser(description=__doc__)
args.add_argument('--destination',default='/root/arrimo-og-publication-prete-20261026')
args.add_argument('--baseline-manifest',required=True,help='Manifest privé du lot déjà publié et vérifié')
options=args.parse_args()
DEST=Path(options.destination).resolve()
def digest(b):return hashlib.sha256(b).hexdigest()
spec=importlib.util.spec_from_file_location('og',ROOT/'scripts/og-publication/publier.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
DEST.mkdir(mode=0o700,exist_ok=False)
code=DEST/'sources';code.mkdir()
tracked=subprocess.run(['git','ls-files','-z'],cwd=ROOT,capture_output=True,check=True).stdout.decode().split('\0')
extras=['tests/og-correction.test.cjs','tests/og-postgres.test.cjs','tests/og_publication_test.py','docs/RAPPORT_OG_2026-10-26.md','docs/PUBLICATION_OG_SSH_2026-10-26.md',
        'tests/og-suivi-postgres.test.cjs','src/og-suivi.js',
        'docs/PUBLICATION_OG_SUIVI_2026-10-26.md',
        'scripts/og-publication/publier.py','scripts/og-publication/verifier.cjs','scripts/og-publication/recette-reprise.py','scripts/og-publication/diagnostiquer-copie.cjs','scripts/preparer-publication-og.py',
        'docs/REPRISE_OG_2026-10-26.md',
        'docs/preuves-og-20261026/tests-locaux.json','docs/preuves-og-20261026/tests-locaux.log']
extras += [str(p.relative_to(ROOT)) for p in (ROOT/'docs/preuves-og-reprise-20261026').rglob('*') if p.is_file()]
for rel in sorted(set(tracked+extras)):
    if not rel:continue
    p=ROOT/rel
    if not p.is_file():continue
    if p.is_symlink():raise ValueError('Lien inattendu dans les sources')
    q=code/rel;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q)
# Baseline déjà publiée ; elle sera comparée à tous les fichiers hébergés avant
# préparation et bascule. Aucun contenu hébergé inconnu n'est adopté comme référence.
base=json.loads(Path(options.baseline_manifest).read_text())['candidat']
candidat=m.contenu(code)
m.verifier_perimetre_runtime(base,candidat)
ancien=json.loads(subprocess.run(['git','show','HEAD:package.json'],cwd=ROOT,capture_output=True,check=True).stdout)
nouveau=json.loads((ROOT/'package.json').read_text())
if any(ancien.get(k)!=nouveau.get(k) for k in ('dependencies','devDependencies','engines')):raise ValueError('Dépendances modifiées')
with tarfile.open(DEST/'candidat.tar.gz','w:gz',dereference=False) as tar:
    for p in sorted(code.rglob('*')):
        if p.is_file():tar.add(p,arcname=str(p.relative_to(code)),recursive=False)
manifest={'archive_sha256':m.sha(DEST/'candidat.tar.gz'),'baseline':base,'candidat':candidat,'commit_base':subprocess.run(['git','rev-parse','HEAD'],cwd=ROOT,capture_output=True,check=True).stdout.decode().strip()}
(DEST/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
shutil.copy2(ROOT/'scripts/og-publication/publier.py',DEST/'publier.py')
notice=(ROOT/'docs/PUBLICATION_OG_SSH_2026-10-26.md').read_text()
notice=notice.replace('/root/arrimo-og-publication-prete-20261026',str(DEST)).replace('/root/arrimo-og-publication-abc-reseau-20261026',str(DEST))
if (ROOT/'docs/REPRISE_OG_2026-10-26.md').is_file():
    notice+='\n\n'+(ROOT/'docs/REPRISE_OG_2026-10-26.md').read_text()
(DEST/'LIRE-MOI.md').write_text(notice)
tests=subprocess.run(['python3','-m','unittest','discover','-s','tests','-p','og_publication_test.py'],cwd=ROOT,capture_output=True,check=True)
(DEST/'tests-garde-fous.log').write_bytes(tests.stdout+tests.stderr)
(DEST/'publier.sh').write_text('''#!/usr/bin/env bash
set -euo pipefail
umask 077
ARRIMO_OG_LOT="$(cd -- "$(dirname -- "$0")" && pwd)"
cd -- "$ARRIMO_OG_LOT"
sha256sum -c SHA256SUMS
exec /usr/bin/python3 -u "$ARRIMO_OG_LOT/publier.py" "$@"
''')
(DEST/'publier.sh').chmod(0o700)
(DEST/'SHA256SUMS').write_text(''.join(m.sha(DEST/f)+'  '+f+'\n' for f in ('candidat.tar.gz','manifest.json','publier.py','publier.sh','LIRE-MOI.md','tests-garde-fous.log')))
# La copie dépliée reste privée pour inspection ; aucun node_modules ni secret n’est inclus.
print(str(DEST/'publier.sh'))
print('Archive SHA-256 : '+manifest['archive_sha256'])
