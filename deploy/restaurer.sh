#!/usr/bin/env bash
# Restaure une sauvegarde Arrimo. ATTENTION : remplace toutes les données actuelles.
# Usage : arrimo-restaurer /var/backups/arrimo/arrimo-AAAAMMJJTHHMMSSZ.dump   (recette : arrimo-recette-restaurer …)
set -euo pipefail
FICHIER="${1:-}"
DOSSIER_APP="${DOSSIER_APP:-/opt/arrimo}"
SERVICE="${SERVICE:-arrimo}"
[ -f "$FICHIER" ] || { echo "Usage : bash restaurer.sh <fichier.dump>"; exit 1; }
if [ -f "$FICHIER.sha256" ]; then sha256sum -c "$FICHIER.sha256" >/dev/null || { echo "Fichier corrompu (somme de contrôle)."; exit 1; }; fi
set -a; . "$DOSSIER_APP/.env"; set +a
if [ "${CONFIRMER:-}" != "oui" ]; then
  read -r -p "Toutes les données actuelles seront remplacées par $FICHIER. Taper « oui » pour continuer : " r
  [ "$r" = "oui" ] || { echo "Annulé."; exit 1; }
fi
# Sauvegarde de sécurité de l'état actuel avant d'écraser
pg_dump --format=custom "$DATABASE_URL" > "/tmp/arrimo-avant-restauration-$(date +%s).dump" || true
systemctl stop "$SERVICE" 2>/dev/null || true
psql "$DATABASE_URL" -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
pg_restore --no-owner --exit-on-error -d "$DATABASE_URL" "$FICHIER"
systemctl start "$SERVICE" 2>/dev/null || true
echo "Restauration terminée depuis $FICHIER"
