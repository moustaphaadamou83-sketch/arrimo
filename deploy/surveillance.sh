#!/usr/bin/env bash
# Surveillance simple : appelle /api/sante et écrit dans le journal système en cas d'échec.
# Lancé toutes les 5 minutes par le timer arrimo-surveillance. Voir : journalctl -t arrimo-surveillance
# URL à surveiller : ARRIMO_URL_SANTE (par défaut, le service local).
set -uo pipefail
URL="${ARRIMO_URL_SANTE:-http://127.0.0.1:3010/api/sante}"
ETAT=/run/arrimo-surveillance.echec

REPONSE=$(curl -sS --max-time 10 "$URL" 2>&1)
if printf '%s' "$REPONSE" | grep -q '"etat":"ok"'; then
  if [ -f "$ETAT" ]; then
    logger -t arrimo-surveillance -p user.notice "Rétabli : $URL répond de nouveau (panne depuis $(cat "$ETAT"))"
    rm -f "$ETAT"
  fi
  exit 0
fi
[ -f "$ETAT" ] || date -u +%Y-%m-%dT%H:%M:%SZ > "$ETAT"
logger -t arrimo-surveillance -p user.err "ÉCHEC : $URL ne répond pas correctement : $(printf '%s' "$REPONSE" | head -c 200)"
exit 1
