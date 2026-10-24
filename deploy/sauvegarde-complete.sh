#!/usr/bin/env bash
# Sauvegarde cohérente d'une release immuable, configuration privée et snapshot PG.
# À exécuter avec accès lecture au runtime, au service systemd et à la config Nginx.
set -euo pipefail
umask 077
ROOT="${1:?Usage: sauvegarde-complete.sh ROOT SERVICE [DESTINATION]}"
SERVICE="${2:?Service systemd requis}"
DEST="${3:-/var/backups/$SERVICE/complet}"
ROOT="$(cd "$ROOT" && pwd)"
ENV_FILE="$ROOT/shared/.env"
[ -r "$ENV_FILE" ] || ENV_FILE="$ROOT/.env"
[ -r "$ENV_FILE" ] || { echo "Configuration privée absente sous $ROOT/shared/.env ou $ROOT/.env" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a
[ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL manquante." >&2; exit 1; }
command -v pg_dump >/dev/null && command -v pg_restore >/dev/null || { echo "pg_dump/pg_restore requis." >&2; exit 1; }

if [ -L "$ROOT/current" ]; then
  ACTIVE="$(readlink "$ROOT/current")"
  case "$ACTIVE" in releases/*) ;; *) echo "Pointeur current invalide." >&2; exit 1 ;; esac
  [ -d "$ROOT/$ACTIVE" ] && [ ! -L "$ROOT/$ACTIVE" ] || { echo "Release active invalide." >&2; exit 1; }
  ACTIVE_PATH="$ROOT/$ACTIVE"
  RELEASE_ID="${ACTIVE#releases/}"
  PREVIOUS="$(readlink "$ROOT/previous" 2>/dev/null || true)"
  if [ -n "$PREVIOUS" ]; then
    case "$PREVIOUS" in releases/*) ;; *) echo "Pointeur previous invalide." >&2; exit 1 ;; esac
    [ -d "$ROOT/$PREVIOUS" ] && [ ! -L "$ROOT/$PREVIOUS" ] || { echo "Release précédente invalide." >&2; exit 1; }
  fi
else
  # Première mise à jour d'une installation historique : sauvegarder la racine
  # complète (code, dépendances, releases statiques) avant de créer current.
  [ -f "$ROOT/src/server.js" ] || { echo "Aucun pointeur current ni application historique reconnue." >&2; exit 1; }
  ACTIVE="legacy-root"
  ACTIVE_PATH="$ROOT"
  RELEASE_ID="$ACTIVE"
  PREVIOUS=""
fi
SYSTEMD_FILE="/etc/systemd/system/$SERVICE.service"
NGINX_FILE="/etc/nginx/sites-available/$SERVICE"
[ -r "$SYSTEMD_FILE" ] && [ -r "$NGINX_FILE" ] || { echo "Configuration systemd ou Nginx introuvable; sauvegarde complète refusée." >&2; exit 1; }
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DEST"; chmod 700 "$DEST"
OUT="$DEST/arrimo-$STAMP"
[ ! -e "$OUT" ] || { echo "Destination déjà existante." >&2; exit 1; }
STAGE="$DEST/.stage-$STAMP-$$"; mkdir -m 700 "$STAGE"
trap 'rm -rf "$STAGE"' EXIT

pg_dump --format=custom --compress=9 --no-owner "$DATABASE_URL" > "$STAGE/database.dump"
pg_restore --list "$STAGE/database.dump" >/dev/null
if [ "$ACTIVE" = legacy-root ]; then
  tar -czf "$STAGE/release.tar.gz" -C "$ACTIVE_PATH" --exclude=./.env --exclude=./.npm .
else
  tar -czf "$STAGE/release.tar.gz" -C "$ACTIVE_PATH" --exclude=./.env .
fi
if [ -n "$PREVIOUS" ]; then tar -czf "$STAGE/previous-release.tar.gz" -C "$ROOT/$PREVIOUS" .; fi
install -m 600 "$ENV_FILE" "$STAGE/shared.env"
mkdir "$STAGE/host-config"
for f in "$SYSTEMD_FILE" "$NGINX_FILE" /etc/nginx/conf.d/arrimo-limites.conf; do
  [ ! -r "$f" ] || install -m 600 "$f" "$STAGE/host-config/$(basename "$f")"
done
if [ "$ACTIVE" = legacy-root ]; then
  [ ! -L "$ROOT/current" ] || { echo "Un pointeur current est apparu pendant la sauvegarde; résultat rejeté." >&2; exit 1; }
else
  [[ "$(readlink "$ROOT/current")" == "$ACTIVE" ]] || { echo "La release a changé pendant la sauvegarde; résultat rejeté." >&2; exit 1; }
fi
{
  printf 'created_utc=%s\nrelease_id=%s\nrelease_target=%s\nprevious_target=%s\n' "$STAMP" "$RELEASE_ID" "$ACTIVE" "${PREVIOUS:-none}"
  NODE_BIN="$ROOT/shared/.runtime/node-v24.22.1/bin/node"
  if [ -x "$NODE_BIN" ]; then printf 'node_runtime=%s\n' "$($NODE_BIN -p 'process.versions.node')"; else printf 'node_runtime=redownload-pinned-sha256\n'; fi
  printf 'database_snapshot=pg_dump_custom_consistent_snapshot\n'
  printf 'database_url=redacted\n'
} > "$STAGE/MANIFEST.txt"
(cd "$STAGE" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
mv "$STAGE" "$OUT"
trap - EXIT
chmod 700 "$OUT"
echo "Sauvegarde créée: $OUT"
echo "Vérifier sans afficher le contenu: (cd '$OUT' && shasum -a 256 -c SHA256SUMS) && pg_restore --list '$OUT/database.dump' >/dev/null"
