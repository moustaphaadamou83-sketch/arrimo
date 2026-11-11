#!/usr/bin/env bash
# Surveillance simple : appelle /api/sante et écrit dans le journal système en cas d'échec.
# Lancé toutes les 5 minutes par le timer arrimo-surveillance. Voir : journalctl -t arrimo-surveillance
# URL à surveiller : ARRIMO_URL_SANTE (par défaut, le service local).
set -uo pipefail
URL="${ARRIMO_URL_SANTE:-http://127.0.0.1:3010/api/sante}"
NOM="${SURVEILLANCE_NOM:-arrimo-surveillance}"   # un nom par environnement (ex. arrimo-recette-surveillance)
ETAT="${SURVEILLANCE_ETAT_DIR:-/run}/$NOM.echec"

# Alerte à un humain (deploy/alerte.sh) : courriel et/ou webhook HTTPS, réglés dans /etc/arrimo/alertes.env.
# Une panne est signalée au 2e échec de suite (10 minutes), une seule fois, puis une fois au rétablissement.
# Un schéma manquant (démo vide) répond 503 « schema_incomplet » : c'est une panne comme une autre.
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/alerte.sh
. "$ICI/alerte.sh"
export ALERTE_ETAT_DIR="${ALERTE_ETAT_DIR:-${SURVEILLANCE_ETAT_DIR:-/run}/arrimo-alertes}" ALERTE_TAG="$NOM"
SEUIL="${SURVEILLANCE_SEUIL:-2}"

REPONSE=$(curl -sS --max-time 10 "$URL" 2>&1)
if printf '%s' "$REPONSE" | grep -q '"etat":"ok"'; then
  if [ -f "$ETAT" ]; then
    logger -t "$NOM" -p user.notice "Rétabli : $URL répond de nouveau (panne depuis $(head -1 "$ETAT"))"
    [ -f "$ETAT.alerte" ] && envoyer_alerte "Arrimo $NOM : rétabli" "$URL répond de nouveau (panne depuis $(head -1 "$ETAT"))."
    rm -f "$ETAT" "$ETAT.n" "$ETAT.alerte"
  fi
  exit 0
fi
[ -f "$ETAT" ] || date -u +%Y-%m-%dT%H:%M:%SZ > "$ETAT"
N=$(( $(cat "$ETAT.n" 2>/dev/null || echo 0) + 1 )); echo "$N" > "$ETAT.n"
CAUSE="$(printf '%s' "$REPONSE" | head -c 200)"
case "$CAUSE" in *schema_incomplet*) CAUSE="la base est vide ou incomplète (schéma manquant)" ;; esac
if [ "$N" -ge "$SEUIL" ] && [ ! -f "$ETAT.alerte" ]; then
  touch "$ETAT.alerte"
  envoyer_alerte "Arrimo $NOM : panne détectée" "$URL ne répond pas correctement depuis $(head -1 "$ETAT") : $CAUSE"
fi
logger -t "$NOM" -p user.err "ÉCHEC : $URL ne répond pas correctement : $CAUSE"
exit 1
