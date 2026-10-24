#!/usr/bin/env bash
# Restaure un dump uniquement dans une base vide arrimo_restore_* sur boucle locale ou réseau privé.
# N'émet aucune commande DROP et n'utilise jamais pg_restore --clean/--create.
set -euo pipefail
umask 077
BACKUP="${1:?Usage: restaurer-isolee.sh DOSSIER_SAUVEGARDE postgresql://.../arrimo_restore_nom}"
DEST_URL="${2:?URL base vide arrimo_restore_* requise}"
[ -d "$BACKUP" ] && { [ -r "$BACKUP/database.dump" ] || [ -r "$BACKUP/arrimo.dump" ]; } || { echo "Dossier de sauvegarde incomplet : dump absent." >&2; exit 1; }
(cd "$BACKUP" && sha256sum -c SHA256SUMS >/dev/null)
DUMP="$BACKUP/database.dump"
[ -r "$DUMP" ] || DUMP="$BACKUP/arrimo.dump"
pg_restore --list "$DUMP" >/dev/null
DB_NAME="$(psql "$DEST_URL" -X -Atqc 'SELECT current_database()')"
case "$DB_NAME" in arrimo_restore_*) ;; *) echo "Refus: la base cible doit porter un nom arrimo_restore_* (aucune commande exécutée)." >&2; exit 1 ;; esac
DB_ADDR="$(psql "$DEST_URL" -X -Atqc 'SELECT coalesce(inet_server_addr()::text, chr(108)||chr(111)||chr(99)||chr(97)||chr(108))')"
case "$DB_ADDR" in
  local|127.*|::1|10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*) ;;
  *) echo "Refus: restauration autorisée uniquement sur boucle locale ou hôte RFC1918 ($DB_ADDR refusé)." >&2; exit 1 ;;
esac
TABLES="$(psql "$DEST_URL" -X -Atqc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname <> \$\$pg_catalog\$\$ AND n.nspname <> \$\$information_schema\$\$ AND c.relkind IN (\$\$r\$\$,\$\$p\$\$)")"
[ "$TABLES" = 0 ] || { echo "Refus: la base cible contient déjà des tables; rien n'a été écrasé." >&2; exit 1; }
pg_restore --no-owner --exit-on-error --dbname="$DEST_URL" "$DUMP"
TABLES_AFTER="$(psql "$DEST_URL" -X -Atqc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname <> \$\$pg_catalog\$\$ AND n.nspname <> \$\$information_schema\$\$ AND c.relkind IN (\$\$r\$\$,\$\$p\$\$)")"
[ "$TABLES_AFTER" -gt 0 ] || { echo "Restauration incomplète: aucune table restaurée." >&2; exit 1; }
echo "Restauration isolée vérifiée dans $DB_NAME ($TABLES_AFTER tables); la base source et le schéma public n'ont pas été touchés."
