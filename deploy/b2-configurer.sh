#!/usr/bin/env bash
# Copie externe des sauvegardes vers Backblaze B2 (rclone), pour chaque environnement installé sur ce serveur.
# La clé d'application est saisie dans une invite masquée : elle n'apparaît ni à l'écran, ni dans l'historique, ni dans la liste des processus.
# Elle est gardée dans /root/.config/rclone/rclone.conf (droits 600, root seulement).
# Usage (en root) : arrimo-b2-configurer [bucket]        (par défaut : arrimo-sauvegardes)
# Ensuite, chaque sauvegarde de nuit est copiée dans b2-arrimo:<bucket>/<environnement>/ (demo, recette, sh).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Lancez cette commande en root."; exit 1; }
BUCKET="${1:-arrimo-sauvegardes}"
DISTANT=b2-arrimo
CONF=/root/.config/rclone/rclone.conf

echo "Collez les deux valeurs affichées par Backblaze. Rien ne s'affichera pendant la saisie : c'est normal."
read -r -s -p "keyID : " ID; echo
read -r -s -p "applicationKey : " CLE; echo
ID="${ID//[[:space:]]/}"; CLE="${CLE//[[:space:]]/}"
[ -n "$ID" ] && [ -n "$CLE" ] || { echo "Valeur vide : rien n'est modifié."; exit 1; }

umask 077
mkdir -p "$(dirname "$CONF")"
NOUVEAU=$(mktemp)
# Ancienne section b2-arrimo retirée, nouvelle ajoutée (printf est interne au shell : la clé ne passe pas sur une ligne de commande)
if [ -f "$CONF" ]; then awk -v s="[$DISTANT]" '$0==s{saute=1;next} /^\[/{saute=0} !saute' "$CONF" > "$NOUVEAU"; fi
printf '[%s]\ntype = b2\naccount = %s\nkey = %s\n\n' "$DISTANT" "$ID" "$CLE" >> "$NOUVEAU"
unset ID CLE
echo "Vérification de l'accès au bucket $BUCKET…"
TEST="test-acces-$(date -u +%Y%m%dT%H%M%SZ).txt"
if ! echo "test d'accès Arrimo" | RCLONE_CONFIG="$NOUVEAU" rclone rcat "$DISTANT:$BUCKET/$TEST" 2>/dev/null \
   || ! RCLONE_CONFIG="$NOUVEAU" rclone lsf "$DISTANT:$BUCKET/$TEST" 2>/dev/null | grep -q "$TEST"; then
  rm -f "$NOUVEAU"
  echo "ÉCHEC : cette clé ne permet pas d'écrire dans le bucket $BUCKET. Rien n'est modifié. Vérifiez la clé et le nom du bucket, puis relancez."
  exit 1
fi
RCLONE_CONFIG="$NOUVEAU" rclone deletefile "$DISTANT:$BUCKET/$TEST" 2>/dev/null || true
mv "$NOUVEAU" "$CONF"; chmod 600 "$CONF"
echo "   Accès en écriture vérifié."

# Chaque environnement de ce serveur envoie ses sauvegardes dans son propre dossier
for D in /opt/arrimo /opt/arrimo-recette /opt/arrimo-sh; do
  [ -f "$D/.env" ] || continue
  E=$(grep '^ARRIMO_ENV=' "$D/.env" | cut -d= -f2-)
  [ -n "$E" ] || continue
  V="$DISTANT:$BUCKET/$E"
  if grep -q '^SAUVEGARDE_DISTANTE=' "$D/.env"; then sed -i "s|^SAUVEGARDE_DISTANTE=.*|SAUVEGARDE_DISTANTE=$V|" "$D/.env"; else printf 'SAUVEGARDE_DISTANTE=%s\n' "$V" >> "$D/.env"; fi
  echo "   $E : sauvegardes copiées dans $V"
done
echo "Terminé. La clé n'a été ni affichée ni enregistrée ailleurs que dans $CONF."
