#!/usr/bin/env bash
# Teste isolé du pointeur atomique, d'une panne post-bascule, du rollback et de
# la conservation des écritures externes (aucun serveur/base réel impliqué).
set -euo pipefail
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/arrimo-release-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
ROOT="$TMP/opt/arrimo"
mkdir -p "$ROOT/releases/release-a" "$ROOT/releases/release-b"
printf 'a\n' > "$ROOT/releases/release-a/version"
printf 'b\n' > "$ROOT/releases/release-b/version"
ln -s releases/release-b "$ROOT/previous"
cat > "$TMP/systemctl" <<'MOCK'
#!/usr/bin/env bash
set -e
[ "$1" = restart ] || exit 1
exit 0
MOCK
cat > "$TMP/curl" <<'MOCK'
#!/usr/bin/env bash
set -e
if [[ "$(cat "${TEST_ROOT:?}/current/version")" == c ]]; then
  COUNT_FILE="$TEST_ROOT/transient-health-count"
  COUNT=0; [ ! -f "$COUNT_FILE" ] || COUNT=$(cat "$COUNT_FILE")
  COUNT=$((COUNT + 1)); printf '%s\n' "$COUNT" > "$COUNT_FILE"
  [ "$COUNT" -ge 3 ] || exit 7
fi
[[ "$(cat "${TEST_ROOT:?}/current/version")" == b ]] && exit 22
exit 0
MOCK
chmod +x "$TMP/systemctl" "$TMP/curl"
export TEST_ROOT="$ROOT" ARRIMO_SYSTEMCTL_BIN="$TMP/systemctl" ARRIMO_CURL_BIN="$TMP/curl"

"$DEPLOY_DIR/releases.sh" activate "$ROOT" release-a arrimo-recette http://127.0.0.1/health
[[ "$(readlink "$ROOT/current")" == releases/release-a ]]
[[ "$(readlink "$ROOT/previous")" == releases/release-b ]]
printf 'write-after-backup\n' > "$ROOT/shared-write-ledger"
if "$DEPLOY_DIR/releases.sh" activate "$ROOT" release-b arrimo-recette http://127.0.0.1/health; then
  echo "ERREUR: la panne simulée de release-b n'a pas été détectée." >&2; exit 1
fi
[[ "$(readlink "$ROOT/current")" == releases/release-a ]]
[[ "$(readlink "$ROOT/previous")" == releases/release-b ]]
[[ "$(cat "$ROOT/shared-write-ledger")" == write-after-backup ]]

# Force une bascule valable (le mock santé accepte a), écritures postérieures,
# puis rollback volontaire sans toucher aux données partagées.
mv "$ROOT/releases/release-b" "$ROOT/releases/release-c"
printf 'c\n' > "$ROOT/releases/release-c/version"
"$DEPLOY_DIR/releases.sh" activate "$ROOT" release-c arrimo-recette http://127.0.0.1/health
printf 'recent-transfer-event\n' >> "$ROOT/shared-write-ledger"
"$DEPLOY_DIR/releases.sh" rollback "$ROOT" '' arrimo-recette http://127.0.0.1/health
[[ "$(readlink "$ROOT/current")" == releases/release-a ]]
[[ "$(cat "$ROOT/shared-write-ledger")" == $'write-after-backup\nrecent-transfer-event' ]]
echo "PASS: activation atomique, panne simulée, rollback, écritures conservées, base jamais restaurée."
