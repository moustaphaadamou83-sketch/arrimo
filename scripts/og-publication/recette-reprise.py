"""Recette isolée de reprise : aucune bascule ni accès aux bases hébergées."""
import datetime
import importlib.util
import json
from pathlib import Path
import secrets

spec = importlib.util.spec_from_file_location('og', Path(__file__).with_name('publier.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
p = m.Publication.__new__(m.Publication)
p.id = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'_'+secrets.token_hex(4)
p.out = Path('/tmp')/('arrimo-og-reprise-'+p.id)
p.out.mkdir(mode=0o700)
p.code = Path(__file__).resolve().parents[2]
p.env = {'PATH': str(Path(m.NODE).parent)+':/usr/bin:/bin', 'LANG':'C.UTF-8', 'HOME':'/root'}
p.secrets = []
p.rapport = {'statut':'recette_en_cours', 'publication_verifiee':False, 'etapes':[], 'bases_isolees':[]}
p.manifest = {'candidat':m.contenu(p.code)}
p.sauver()
print(str(p.out/'rapport.json'), flush=True)
try:
    p.recette()
    p.rapport['statut']='recette_reussie'
except BaseException as e:
    p.rapport.update(statut='recette_echouee', blocage=str(e))
    raise
finally:
    p.sauver()
