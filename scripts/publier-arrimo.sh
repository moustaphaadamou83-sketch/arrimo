#!/usr/bin/env bash
# Une seule commande SSH. Aucun changement de droits, de comptes ou de scénario.
set -euo pipefail
umask 077
ARRIMO_PUBLICATION_REPO="$(cd "$(dirname "$0")/.." && pwd)"
exec /usr/bin/python3 -u "$ARRIMO_PUBLICATION_REPO/scripts/publication-arrimo.py" "$@"
