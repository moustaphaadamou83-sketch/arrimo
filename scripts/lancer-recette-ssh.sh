#!/usr/bin/env bash
# Une seule commande SSH : recette isolée, journaux privés, aucun déploiement.
set -u
umask 077
if [ "$(id -u)" -ne 0 ]; then
  echo 'Cette recette utilise les chemins /root existants : ouvrir la session SSH root autorisée.' >&2
  exit 1
fi
ARRIMO_RECETTE_RACINE="$(cd "$(dirname "$0")/.." && pwd)" || exit 1
cd "$ARRIMO_RECETTE_RACINE" || exit 1
export PATH="/opt/arrimo-runtime/node-v24.22.1/bin:$PATH"
export NODE_PATH="/root/arrimo-dev/node_modules"
ARRIMO_RECETTE_SORTIE="/root/arrimo-recette-ssh-$(date -u +%Y%m%dT%H%M%SZ)-$$"
printf 'Dossier de recette : %s\nJournal continu : %s.console.log\n' "$ARRIMO_RECETTE_SORTIE" "$ARRIMO_RECETTE_SORTIE"
nohup /usr/bin/python3 -u scripts/recette-serveur-arrimo.py --sortie "$ARRIMO_RECETTE_SORTIE" "$@" > "$ARRIMO_RECETTE_SORTIE.console.log" 2>&1 < /dev/null &
ARRIMO_RECETTE_PID=$!
tail --pid="$ARRIMO_RECETTE_PID" -n +1 -f "$ARRIMO_RECETTE_SORTIE.console.log"
wait "$ARRIMO_RECETTE_PID"
ARRIMO_RECETTE_CODE=$?
/usr/bin/python3 - "$ARRIMO_RECETTE_SORTIE" <<'PY'
import json, pathlib, sys
dossier = pathlib.Path(sys.argv[1])
rapport = dossier / 'rapport.json'
if not rapport.is_file():
    print('Rapport non créé : consulter le journal continu indiqué ci-dessus.')
else:
    resultat = json.loads(rapport.read_text())
    print('\n--- RAPPORT DE RECETTE ---\n' + json.dumps(resultat, ensure_ascii=False, indent=2))
    for etape in resultat.get('etapes', []):
        if not etape.get('reussi'):
            nom = etape['nom']
            if pathlib.Path(nom).name != nom:
                continue
            journal = dossier / (nom + '.log')
            if journal.is_file():
                print('\n--- ' + nom + ' : dernières lignes du journal expurgé ---')
                print('\n'.join(journal.read_text(errors='replace').splitlines()[-100:]))
PY
exit "$ARRIMO_RECETTE_CODE"
