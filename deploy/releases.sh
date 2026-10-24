#!/usr/bin/env bash
# Gestion des releases immuables Arrimo. Ne modifie jamais PostgreSQL.
set -euo pipefail

usage() {
  echo "Usage: $0 activate|rollback|status ROOT [RELEASE_ID] SERVICE HEALTH_URL" >&2
  exit 64
}

ACTION="${1:-}"; ROOT="${2:-}"; RELEASE_ID="${3:-}"; SERVICE="${4:-}"; HEALTH_URL="${5:-}"
[ -n "$ACTION" ] && [ -n "$ROOT" ] || usage
case "$ACTION" in activate|rollback|status) ;; *) usage ;; esac
ROOT="$(cd "$(dirname "$ROOT")" && pwd)/$(basename "$ROOT")"
RELEASES="$ROOT/releases"; CURRENT="$ROOT/current"; PREVIOUS="$ROOT/previous"
SYSTEMCTL="${ARRIMO_SYSTEMCTL_BIN:-systemctl}"; CURL="${ARRIMO_CURL_BIN:-curl}"

target_of() {
  [ -L "$1" ] || return 1
  local target
  target="$(readlink "$1")"
  case "$target" in releases/*) ;; *) return 1 ;; esac
  [ -d "$ROOT/$target" ] && [ ! -L "$ROOT/$target" ] || return 1
  printf '%s\n' "$target"
}

atomic_link() {
  local link="$1" target="$2" tmp="$ROOT/.link.$$.${RANDOM}"
  if [ -n "$target" ]; then
    ln -s "$target" "$tmp"
    # Ne jamais suivre le symlink de destination (qui pointe sur un dossier).
    # GNU mv fournit -T; BSD/macOS fournit -h. Les deux font un rename(2)
    # atomique du lien sur le même système de fichiers.
    if mv --help 2>&1 | grep -q -- '--no-target-directory'; then
      mv -Tf "$tmp" "$link"
    else
      mv -hf "$tmp" "$link"
    fi
  else
    rm -f "$link"
  fi
}

health() {
  [ -n "$HEALTH_URL" ] || { echo "URL santé requise." >&2; return 1; }
  # systemd peut avoir besoin de quelques secondes pour relancer Node et ouvrir
  # le port après la bascule. Une première connexion refusée n'est pas encore
  # une panne de la release : attendre jusqu'à 20 secondes avant le rollback.
  local tentative
  for tentative in $(seq 1 10); do
    if "$CURL" -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

restart_service() {
  [ -n "$SERVICE" ] || { echo "Service systemd requis." >&2; return 1; }
  "$SYSTEMCTL" restart "$SERVICE"
}

case "$ACTION" in
  status)
    printf 'current=%s\n' "$(target_of "$CURRENT" 2>/dev/null || echo absent)"
    printf 'previous=%s\n' "$(target_of "$PREVIOUS" 2>/dev/null || echo absent)"
    ;;
  activate)
    [[ "$RELEASE_ID" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Identifiant de release invalide." >&2; exit 64; }
    [ -d "$RELEASES/$RELEASE_ID" ] || { echo "Release introuvable." >&2; exit 1; }
    [ ! -L "$RELEASES/$RELEASE_ID" ] || { echo "Une release ne peut pas être un lien." >&2; exit 1; }
    OLD="$(target_of "$CURRENT" 2>/dev/null || true)"
    OLD_PREVIOUS="$(target_of "$PREVIOUS" 2>/dev/null || true)"
    NEW="releases/$RELEASE_ID"
    [ "$OLD" != "$NEW" ] || { echo "Cette release est déjà active."; exit 0; }
    # Sauvegarde le pointeur précédent avant la bascule; une panne entre ces étapes
    # laisse au pire PREVIOUS inchangé et CURRENT valide.
    [ -z "$OLD" ] || atomic_link "$PREVIOUS" "$OLD"
    atomic_link "$CURRENT" "$NEW"
    if restart_service && health; then
      echo "Release active: $RELEASE_ID; précédente: ${OLD:-aucune}; base inchangée."
      exit 0
    fi
    echo "Échec santé après bascule; restauration du pointeur applicatif précédent." >&2
    if [ -n "$OLD" ]; then atomic_link "$CURRENT" "$OLD"; else rm -f "$CURRENT"; fi
    if [ -n "$OLD_PREVIOUS" ]; then atomic_link "$PREVIOUS" "$OLD_PREVIOUS"; else rm -f "$PREVIOUS"; fi
    restart_service || true
    if [ -n "$OLD" ]; then health || echo "ALERTE: l'ancienne release ne répond pas à la santé." >&2; fi
    exit 1
    ;;
  rollback)
    OLD="$(target_of "$CURRENT" 2>/dev/null || true)"
    PREV="$(target_of "$PREVIOUS" 2>/dev/null || true)"
    [ -n "$OLD" ] && [ -n "$PREV" ] || { echo "Pointeurs current/previous absents ou invalides." >&2; exit 1; }
    atomic_link "$PREVIOUS" "$OLD"
    atomic_link "$CURRENT" "$PREV"
    if restart_service && health; then
      echo "Retour applicatif réussi: $PREV; base inchangée, aucune restauration SQL."
      exit 0
    fi
    echo "La release précédente échoue à la santé; réactivation de la release qui était active." >&2
    atomic_link "$CURRENT" "$OLD"; atomic_link "$PREVIOUS" "$PREV"
    restart_service || true
    exit 1
    ;;
esac
