#!/usr/bin/env bash
# Alertes envoyées à un humain (courriel) : installe deploy/alerte.sh et deploy/surveillance.sh, relie chaque service de
# sauvegarde à l'alerte (OnFailure), crée /etc/arrimo/alertes.env (root, 600) avec le destinataire, sans aucun secret.
# Les identifiants SMTP sont saisis ensuite par le propriétaire avec : arrimo-alertes-configurer (invite masquée).
# Usage (root) : bash deploy/installer-alertes.sh destinataire@exemple.com
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "À lancer en root."; exit 1; }
DEST="${1:?destinataire requis}"
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF=/etc/arrimo/alertes.env

install -d -m 755 /usr/local/lib/arrimo
install -m 750 "$ICI/alerte.sh" /usr/local/lib/arrimo/alerte.sh
install -m 750 "$ICI/surveillance.sh" /usr/local/lib/arrimo/surveillance.sh
install -m 700 "$ICI/courriel-configurer.sh" /usr/local/bin/arrimo-courriel-configurer   # service d'envoi : Arrimo et alertes

install -d -m 700 /etc/arrimo
if [ ! -f "$CONF" ]; then printf 'ALERTE_COURRIEL=%s\n' "$DEST" > "$CONF"
else sed -i "s|^ALERTE_COURRIEL=.*|ALERTE_COURRIEL=$DEST|" "$CONF"; grep -q '^ALERTE_COURRIEL=' "$CONF" || printf 'ALERTE_COURRIEL=%s\n' "$DEST" >> "$CONF"; fi
chown root:root "$CONF"; chmod 600 "$CONF"

# Alerte d'un service en échec (sauvegarde, copie externe, remise à zéro de la démo) : arrimo-alerte@<service>
cat > /etc/systemd/system/arrimo-alerte@.service <<'UNIT'
[Unit]
Description=Alerte Arrimo : le service %i a échoué

[Service]
Type=oneshot
ExecStart=/usr/local/lib/arrimo/alerte.sh "Échec : %i" "Le service %i a échoué sur le serveur. Voir : journalctl -u %i"
UNIT

for u in /etc/systemd/system/*-sauvegarde.service /etc/systemd/system/arrimo-demo-nuit.service; do
  [ -f "$u" ] || continue
  n="$(basename "$u")"
  install -d -m 755 "/etc/systemd/system/$n.d"
  printf '[Unit]\nOnFailure=arrimo-alerte@%%n.service\n' > "/etc/systemd/system/$n.d/alerte.conf"
  echo "  $n relié à l'alerte"
done

# Saisie masquée des identifiants SMTP par le propriétaire (jamais dans le chat ni dans l'historique du terminal)
cat > /usr/local/bin/arrimo-alertes-configurer <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
CONF=/etc/arrimo/alertes.env
[ "$(id -u)" = 0 ] || { echo "À lancer en root."; exit 1; }
read -r -p "Serveur SMTP (ex. email-smtp.ca-central-1.amazonaws.com) : " HOTE
read -r -p "Port SMTPS [465] : " PORT; PORT="${PORT:-465}"
read -r -p "Utilisateur SMTP : " UTIL
read -r -s -p "Mot de passe SMTP (masqué) : " MDP; echo
read -r -p "Adresse d'expéditeur (vérifiée chez le service d'envoi) : " DE
enc() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$1"; }
TMP=$(mktemp); chmod 600 "$TMP"
grep -v -E '^(ALERTE_SMTP_URL|ALERTE_EXPEDITEUR)=' "$CONF" > "$TMP" || true
printf 'ALERTE_SMTP_URL=smtps://%s:%s@%s:%s\nALERTE_EXPEDITEUR=%s\n' "$(enc "$UTIL")" "$(enc "$MDP")" "$HOTE" "$PORT" "$DE" >> "$TMP"
install -m 600 -o root -g root "$TMP" "$CONF"; rm -f "$TMP"; unset MDP
echo "Réglage enregistré dans $CONF (600). Envoi d'un courriel d'essai…"
ALERTE_INTERVALLE_S=0 /usr/local/lib/arrimo/alerte.sh "Essai d'alerte" "Courriel d'essai : les alertes de surveillance d'Arrimo fonctionnent."
echo "Vérifiez la boîte de réception (et les indésirables). Journal : journalctl -t arrimo-alerte -n 5"
SCRIPT
chmod 700 /usr/local/bin/arrimo-alertes-configurer

systemctl daemon-reload
echo "Alertes installées. Destinataire : $DEST. Saisir les identifiants SMTP : arrimo-alertes-configurer"
