#!/usr/bin/env bash
# État des sauvegardes lu par l'écran Hébergement de la console SH (SH_SAUVEGARDES_ETAT).
# Exécuté par root (les sauvegardes sont en 700) ; écrit un JSON sans secret, lisible par le service SH.
#   etat-sauvegardes.sh /var/lib/arrimo-sh/etat-sauvegardes.json demo=/var/backups/arrimo recette=/var/backups/arrimo-recette
# Pour chaque environnement : dernier dump, taille, date et contrôle de son empreinte SHA-256. Ne modifie aucune sauvegarde.
set -euo pipefail
SORTIE="${1:?fichier de sortie requis}"; shift
GROUPE="${ARRIMO_SH_GROUPE:-arrimo-sh}"
json_echappe() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
entrees=()
for paire in "$@"; do
  code="${paire%%=*}"; dossier="${paire#*=}"
  [[ "$code" =~ ^[a-z]+$ ]] || { echo "Code d'environnement invalide : $code" >&2; exit 64; }
  dernier="$(find "$dossier" -maxdepth 1 -type f -name '*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2- || true)"
  if [ -z "$dernier" ]; then entrees+=("\"$code\":null"); continue; fi
  taille=$(stat -c %s "$dernier"); quand=$(date -u -d "@$(stat -c %Y "$dernier")" +%Y-%m-%dT%H:%M:%SZ)
  ok=null
  if [ -f "$dernier.sha256" ]; then
    attendu=$(awk '{print $1}' "$dernier.sha256"); reel=$(sha256sum "$dernier" | awk '{print $1}')
    [ "$attendu" = "$reel" ] && ok=true || ok=false
  fi
  lisible=$(numfmt --to=iec --suffix=o "$taille" 2>/dev/null || echo "$taille o")
  entrees+=("\"$code\":{\"fichier\":\"$(json_echappe "$(basename "$dernier")")\",\"derniere\":\"$quand\",\"taille\":$taille,\"taille_lisible\":\"$lisible\",\"empreinte_ok\":$ok}")
done
tmp="$(mktemp "$(dirname "$SORTIE")/.etat.XXXXXX")"
( IFS=,; printf '{"genere_le":"%s","environnements":{%s}}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${entrees[*]}" ) > "$tmp"
chmod 640 "$tmp"; chgrp "$GROUPE" "$tmp" 2>/dev/null || true
mv -f "$tmp" "$SORTIE"
