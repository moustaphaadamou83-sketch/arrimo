#!/usr/bin/env bash
# Sauvegarde de la base Arrimo : copie compressée, horodatée, vérifiée, conservée N jours.
# Copie externe facultative avec rclone (ex. Backblaze B2) : définir SAUVEGARDE_DISTANTE=b2:mon-bucket/arrimo dans .env
set -euo pipefail
DOSSIER_APP="${DOSSIER_APP:-/opt/arrimo}"
set -a; . "$DOSSIER_APP/.env"; set +a
CIBLE="${SAUVEGARDE_DOSSIER:-/var/backups/arrimo}"
JOURS="${SAUVEGARDE_JOURS:-14}"
mkdir -p "$CIBLE"; chmod 700 "$CIBLE"
FICHIER="$CIBLE/arrimo-$(date -u +%Y%m%dT%H%M%SZ).dump"

pg_dump --format=custom --compress=9 --no-owner "$DATABASE_URL" > "$FICHIER.part"
# Vérifie que la sauvegarde est lisible avant de la garder
pg_restore --list "$FICHIER.part" > /dev/null
mv "$FICHIER.part" "$FICHIER"
chmod 600 "$FICHIER"
sha256sum "$FICHIER" > "$FICHIER.sha256"

find "$CIBLE" -name 'arrimo-*.dump*' -mtime +"$JOURS" -delete

if [ -n "${SAUVEGARDE_DISTANTE:-}" ] && command -v rclone >/dev/null; then
  rclone copy "$FICHIER" "$SAUVEGARDE_DISTANTE" && rclone copy "$FICHIER.sha256" "$SAUVEGARDE_DISTANTE"
fi
echo "Sauvegarde OK : $FICHIER ($(du -h "$FICHIER" | cut -f1))"
