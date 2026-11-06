#!/usr/bin/env bash
# Surveillance simple : appelle /api/sante et écrit dans le journal système en cas d'échec.
# Lancé toutes les 5 minutes par le timer arrimo-surveillance. Voir : journalctl -t arrimo-surveillance
# URL à surveiller : ARRIMO_URL_SANTE (par défaut, le service local).
set -uo pipefail
URL="${ARRIMO_URL_SANTE:-http://127.0.0.1:3010/api/sante}"
NOM="${SURVEILLANCE_NOM:-arrimo-surveillance}"   # un nom par environnement (ex. arrimo-recette-surveillance)
ETAT="${SURVEILLANCE_ETAT_DIR:-/run}/$NOM.echec"

# Alerte facultative : ALERTE_WEBHOOK_URL (HTTPS). Un seul message par panne et un au rétablissement, jamais à chaque passage.
# L'adresse contient souvent un secret : elle passe par l'entrée standard de curl, jamais par ses arguments.
alerter() {
  [ -n "${ALERTE_WEBHOOK_URL:-}" ] || return 0
  case "$ALERTE_WEBHOOK_URL" in
    https://*|http://127.0.0.1:*) ;;
    *) logger -t "$NOM" -p user.err "Alerte non envoyée : ALERTE_WEBHOOK_URL doit être en HTTPS."; return 0 ;;
  esac
  printf 'url = "%s"\n' "$ALERTE_WEBHOOK_URL" | curl -sS --max-time 10 -o /dev/null -K - -H 'Content-Type: application/json' -d "{\"text\":\"$1\"}" \
    || logger -t "$NOM" -p user.err "Alerte non envoyée : le service d'alerte ne répond pas."
}

REPONSE=$(curl -sS --max-time 10 "$URL" 2>&1)
if printf '%s' "$REPONSE" | grep -q '"etat":"ok"'; then
  if [ -f "$ETAT" ]; then
    logger -t "$NOM" -p user.notice "Rétabli : $URL répond de nouveau (panne depuis $(cat "$ETAT"))"
    alerter "Arrimo $NOM : rétabli"
    rm -f "$ETAT"
  fi
  exit 0
fi
if [ ! -f "$ETAT" ]; then
  date -u +%Y-%m-%dT%H:%M:%SZ > "$ETAT"
  alerter "Arrimo $NOM : panne détectée"
fi
logger -t "$NOM" -p user.err "ÉCHEC : $URL ne répond pas correctement : $(printf '%s' "$REPONSE" | head -c 200)"
exit 1
