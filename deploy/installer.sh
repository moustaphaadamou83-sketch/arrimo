#!/usr/bin/env bash
# Installe Arrimo sur un serveur Ubuntu (22.04 ou 24.04), derrière Nginx en HTTPS.
# Usage (en root, depuis le dossier qui contient arrimo.zip) :
#   bash installer.sh arrimo.mondomaine.com          démonstration Hôpital X / Hôpital Y
#   SCENARIO=reseau bash installer.sh ...            démonstration réseau de 6 établissements
# Avant : créer chez Namecheap un enregistrement DNS A « arrimo » vers l'adresse IP du serveur.
set -euo pipefail

DOMAINE="${1:-}"
PORT="${PORT:-3010}"
DOSSIER=/opt/arrimo
ARCHIVE="${ARCHIVE:-arrimo.zip}"
SCENARIO="${SCENARIO:-deux}"

[ "$(id -u)" -eq 0 ] || { echo "Lancez ce script en root (sudo)."; exit 1; }
[ -n "$DOMAINE" ] || { echo "Usage : bash installer.sh arrimo.mondomaine.com"; exit 1; }
[ -f "$ARCHIVE" ] || { echo "Archive $ARCHIVE introuvable dans $(pwd)."; exit 1; }
if ! systemctl list-unit-files arrimo.service >/dev/null 2>&1 && ss -ltn | grep -q ":$PORT "; then echo "Le port $PORT est déjà utilisé. Relancez avec PORT=3011 bash installer.sh $DOMAINE"; exit 1; fi

echo "== 1/7 Paquets système"
apt-get update -qq
apt-get install -y -qq curl unzip nginx postgresql certbot python3-certbot-nginx >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "   Node $(node -v)"

echo "== 2/7 Utilisateur et fichiers"
id arrimo >/dev/null 2>&1 || useradd --system --home "$DOSSIER" --shell /usr/sbin/nologin arrimo
TMP=$(mktemp -d)
unzip -q "$ARCHIVE" -d "$TMP"
mkdir -p "$DOSSIER"
cp -r "$TMP"/arrimo/. "$DOSSIER"/
rm -rf "$TMP"
cd "$DOSSIER"
npm ci --omit=dev --silent

echo "== 3/7 Base de données"
if [ ! -f "$DOSSIER/.env" ]; then
  MDP_BD=$(openssl rand -hex 24)
  sudo -u postgres psql -qc "CREATE ROLE arrimo LOGIN PASSWORD '$MDP_BD'" 2>/dev/null || sudo -u postgres psql -qc "ALTER ROLE arrimo PASSWORD '$MDP_BD'"
  sudo -u postgres psql -lqt | cut -d'|' -f1 | grep -qw arrimo || sudo -u postgres createdb -O arrimo arrimo
  MDP_DEMO="Arrimo-$(openssl rand -hex 6)"
  cat > "$DOSSIER/.env" <<ENV
DATABASE_URL=postgres://arrimo:$MDP_BD@127.0.0.1:5432/arrimo
PORT=$PORT
HOST=127.0.0.1
SH_API_KEY=$(openssl rand -hex 32)
SESSION_HEURES=12
BLOCAGES_MINUTES=15
DEMO_MOT_DE_PASSE=$MDP_DEMO
NODE_ENV=production
ARRIMO_DEMO=1
COPILOTE_IA_CLE=
ENV
  chmod 600 "$DOSSIER/.env"
  NOUVELLE_INSTALLATION=1
fi
chown -R arrimo:arrimo "$DOSSIER"

echo "== 4/7 Données de démonstration (fictives)"
if [ "${NOUVELLE_INSTALLATION:-0}" = 1 ]; then
  if [ "$SCENARIO" = reseau ]; then SCRIPT=db/seed.js; else SCRIPT=db/demo-deux.js; fi
  sudo -u arrimo bash -c "set -a; . $DOSSIER/.env; set +a; cd $DOSSIER && node $SCRIPT" | tee "$DOSSIER/acces-demo.txt"
  chmod 600 "$DOSSIER/acces-demo.txt"; chown arrimo:arrimo "$DOSSIER/acces-demo.txt"
else
  echo "   Base existante conservée (mise à jour du code seulement)."
  sudo -u arrimo bash -c "set -a; . $DOSSIER/.env; set +a; cd $DOSSIER && psql \"\$DATABASE_URL\" -q -f db/schema.sql"
fi

echo "== 5/7 Service"
cat > /etc/systemd/system/arrimo.service <<UNIT
[Unit]
Description=Arrimo (lits et transferts)
After=network.target postgresql.service

[Service]
User=arrimo
WorkingDirectory=$DOSSIER
EnvironmentFile=$DOSSIER/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now arrimo >/dev/null 2>&1
systemctl restart arrimo
sleep 2
curl -fsS "http://127.0.0.1:$PORT/" >/dev/null && echo "   Service démarré." || { echo "Le service ne répond pas : journalctl -u arrimo -n 50"; exit 1; }

echo "== 5b Sauvegardes automatiques (chaque nuit à 3 h, conservées 14 jours)"
install -m 750 "$DOSSIER/deploy/sauvegarde.sh" /usr/local/bin/arrimo-sauvegarde
install -m 750 "$DOSSIER/deploy/restaurer.sh" /usr/local/bin/arrimo-restaurer
cat > /etc/systemd/system/arrimo-sauvegarde.service <<UNIT
[Unit]
Description=Sauvegarde de la base Arrimo
[Service]
Type=oneshot
Environment=DOSSIER_APP=$DOSSIER
ExecStart=/usr/local/bin/arrimo-sauvegarde
UNIT
cat > /etc/systemd/system/arrimo-sauvegarde.timer <<UNIT
[Unit]
Description=Sauvegarde nocturne d'Arrimo
[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now arrimo-sauvegarde.timer >/dev/null 2>&1
systemctl start arrimo-sauvegarde.service && echo "   Première sauvegarde faite : $(ls -1t /var/backups/arrimo/*.dump | head -1)"

echo "== 5c Surveillance (toutes les 5 minutes, échecs dans journalctl -t arrimo-surveillance)"
install -m 750 "$DOSSIER/deploy/surveillance.sh" /usr/local/bin/arrimo-surveillance
cat > /etc/systemd/system/arrimo-surveillance.service <<UNIT
[Unit]
Description=Surveillance d'Arrimo (/api/sante)
[Service]
Type=oneshot
Environment=ARRIMO_URL_SANTE=https://$DOMAINE/api/sante
ExecStart=/usr/local/bin/arrimo-surveillance
UNIT
cat > /etc/systemd/system/arrimo-surveillance.timer <<UNIT
[Unit]
Description=Surveillance d'Arrimo toutes les 5 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now arrimo-surveillance.timer >/dev/null 2>&1

echo "== 6/7 Nginx"
echo 'limit_req_zone $binary_remote_addr zone=arrimo_connexion:10m rate=10r/m;' > /etc/nginx/conf.d/arrimo-limites.conf
cat > /etc/nginx/sites-available/arrimo <<NGINX
server {
    listen 80;
    server_name $DOMAINE;
    client_max_body_size 1m;
    add_header Strict-Transport-Security "max-age=31536000" always;
    location = /api/connexion { limit_req zone=arrimo_connexion burst=5 nodelay; proxy_pass http://127.0.0.1:$PORT; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; }
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/arrimo /etc/nginx/sites-enabled/arrimo
nginx -t -q && systemctl reload nginx

echo "== 7/7 Certificat HTTPS"
if certbot --nginx -d "$DOMAINE" --non-interactive --agree-tos --register-unsafely-without-email --redirect -q; then
  echo "   HTTPS actif."
else
  echo "   Certificat non obtenu : vérifiez que le DNS de $DOMAINE pointe vers ce serveur, puis relancez :"
  echo "   certbot --nginx -d $DOMAINE --redirect"
fi

echo
echo "Arrimo est en ligne : https://$DOMAINE"
echo "Comptes et clés de démonstration : $DOSSIER/acces-demo.txt (à conserver, puis supprimer du serveur)"
echo "Journaux : journalctl -u arrimo -f      Redémarrer : systemctl restart arrimo"
echo "Sauvegardes : /var/backups/arrimo (chaque nuit à 3 h). Restaurer : arrimo-restaurer <fichier.dump>"
echo "État du service : curl -s https://$DOMAINE/api/sante"
echo "Remettre la démo à zéro avant une présentation :"
echo "  sudo -u arrimo bash -c 'set -a; . $DOSSIER/.env; set +a; cd $DOSSIER && npm run -s demo:reset' > $DOSSIER/acces-demo.txt"
