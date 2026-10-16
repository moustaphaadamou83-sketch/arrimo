#!/usr/bin/env bash
# Noms propres à chaque environnement, à partir de ARRIMO_ENV et du domaine d'Arrimo (le seul réglage de domaine).
# Sourcé par installer.sh ; vérifié par tests/api.test.js.
#   ARRIMO_ENV=demo        dossier /opt/arrimo          service arrimo          base arrimo          port 3010  hôte <domaine>
#   ARRIMO_ENV=recette     dossier /opt/arrimo-recette  service arrimo-recette  base arrimo_recette  port 3011  hôte recette.<domaine>
#   ARRIMO_ENV=production  dossier /opt/arrimo          service arrimo          base arrimo          port 3010  hôte <domaine>
# Entrée : ARRIMO_ENV (demo par défaut), DOMAINE (ex. arrimo.senseafri.com, plus tard arrimo.ca), PORT facultatif.
ARRIMO_ENV="${ARRIMO_ENV:-demo}"
case "$ARRIMO_ENV" in
  demo)       SUFFIXE="";         PORT_DEFAUT=3010 ;;
  recette)    SUFFIXE="-recette"; PORT_DEFAUT=3011 ;;
  production) SUFFIXE="";         PORT_DEFAUT=3010 ;;
  *) echo "ARRIMO_ENV inconnu : « $ARRIMO_ENV » (demo, recette ou production)."; exit 1 ;;
esac
DOMAINE="$(printf '%s' "${DOMAINE:-}" | tr '[:upper:]' '[:lower:]')"
NOM="arrimo$SUFFIXE"
UTILISATEUR="$NOM"
DOSSIER="/opt/$NOM"
BASE="${NOM//-/_}"
PORT="${PORT:-$PORT_DEFAUT}"
SAUVEGARDES="/var/backups/$NOM"
if [ "$ARRIMO_ENV" = recette ]; then HOTE="recette.$DOMAINE"; else HOTE="$DOMAINE"; fi
