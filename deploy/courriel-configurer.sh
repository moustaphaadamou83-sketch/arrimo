#!/usr/bin/env bash
# Service d'envoi de courriels (ex. Amazon SES, région Canada) : saisie masquée par le propriétaire, sur le serveur seulement.
# Écrit SMTP_URL et COURRIEL_EXPEDITEUR dans le .env de chaque environnement (droits conservés, copie de l'ancien fichier),
# et le même réglage pour les alertes de surveillance (/etc/arrimo/alertes.env, 600). Redémarre les services, puis envoie
# un courriel d'essai à l'adresse des alertes. Le mot de passe n'est jamais affiché ni passé en argument.
# Usage (root) : arrimo-courriel-configurer
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "À lancer en root."; exit 1; }
ENVS=(/opt/arrimo/.env:arrimo /opt/arrimo-recette/.env:arrimo-recette /opt/arrimo-demo/shared/.env:arrimo-public-demo /opt/arrimo-sh/.env:arrimo-sh)

read -r -p "Serveur SMTP [email-smtp.ca-central-1.amazonaws.com] : " HOTE; HOTE="${HOTE:-email-smtp.ca-central-1.amazonaws.com}"
read -r -p "Port SMTPS [465] : " PORT; PORT="${PORT:-465}"
read -r -p "Utilisateur SMTP : " UTIL
read -r -s -p "Mot de passe SMTP (masqué) : " MDP; echo
read -r -p "Adresse d'expéditeur vérifiée (ex. ne-pas-repondre@arrimo.senseafri.com) : " DE
[ -n "$UTIL" ] && [ -n "$MDP" ] && [ -n "$DE" ] || { echo "Saisie incomplète : rien n'a été modifié."; exit 1; }
enc() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read(),safe=""))'; }
URL="smtps://$(printf '%s' "$UTIL" | enc):$(printf '%s' "$MDP" | enc)@$HOTE:$PORT"; unset MDP

ecrire() {   # fichier clé valeur : remplace ou ajoute, droits et propriétaire conservés
  local f="$1" k="$2" v="$3" tmp; tmp=$(mktemp); chmod 600 "$tmp"
  grep -v "^$k=" "$f" > "$tmp" || true; printf '%s=%s\n' "$k" "$v" >> "$tmp"
  cat "$tmp" > "$f"; rm -f "$tmp"
}
for x in "${ENVS[@]}"; do
  f="${x%%:*}"; svc="${x##*:}"; [ -f "$f" ] || continue
  cp -p "$f" "$f.avant-courriel-$(date +%Y%m%dt%H%M)"
  ecrire "$f" SMTP_URL "$URL"; ecrire "$f" COURRIEL_EXPEDITEUR "\"Arrimo <$DE>\""
  systemctl restart "$svc" && echo "  $svc : réglé et redémarré"
done
if [ -f /etc/arrimo/alertes.env ]; then ecrire /etc/arrimo/alertes.env ALERTE_SMTP_URL "$URL"; ecrire /etc/arrimo/alertes.env ALERTE_EXPEDITEUR "$DE"; chmod 600 /etc/arrimo/alertes.env; fi
unset URL
echo "Envoi d'un courriel d'essai à l'adresse des alertes…"
ALERTE_INTERVALLE_S=0 /usr/local/lib/arrimo/alerte.sh "Essai du service d'envoi" "Courriel d'essai : Arrimo peut envoyer des courriels (Arrimo Famille, mot de passe oublié, alertes)." \
  && echo "Vérifiez la boîte de réception (et les indésirables). Journal : journalctl -t arrimo-alerte -n 5"
