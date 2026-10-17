#!/usr/bin/env bash
# Installe ou met à jour Arrimo sur un serveur Ubuntu (22.04 ou 24.04), derrière Nginx en HTTPS.
# Le même code et le même installateur pour les trois environnements ; seul le fichier .env diffère.
# Usage (en root, depuis le dossier qui contient arrimo.zip) :
#   bash installer.sh arrimo.senseafri.com                          démonstration (données fictives, réseau de 20 hôpitaux)
#   ARRIMO_ENV=recette bash installer.sh arrimo.senseafri.com       recette, sur recette.arrimo.senseafri.com (données de test)
#   ARRIMO_ENV=production CONFIRMER_HEBERGEMENT_CANADA=oui \
#     PREMIER_COMPTE=courriel@exemple.ca PREMIER_NOM="Nom" bash installer.sh arrimo.ca     production (serveur hébergé au Canada)
#   ARRIMO_ENV=sh PREMIER_COMPTE=courriel PREMIER_NOM="Nom" bash installer.sh arrimo.senseafri.com
#                                                                   console SH, sur sh.arrimo.senseafri.com (reliée aux environnements de ce serveur)
# L'argument est le domaine d'Arrimo, le seul réglage de domaine : il est gardé dans .env (ARRIMO_DOMAINE).
# Pour changer de domaine plus tard (ex. arrimo.ca), relancer l'installateur avec le nouveau domaine.
# Avant : un enregistrement DNS de l'hôte (voir la fin du script) vers l'adresse IP du serveur.
#   SCENARIO=six : ancienne démonstration à 6 établissements (démo seulement).
set -euo pipefail

DOMAINE="${1:-}"
ARCHIVE="${ARCHIVE:-arrimo.zip}"
SCENARIO="${SCENARIO:-demo}"
[ "$(id -u)" -eq 0 ] || { echo "Lancez ce script en root (sudo)."; exit 1; }
[ -n "$DOMAINE" ] || { echo "Usage : bash installer.sh <domaine d'Arrimo>   (ex. arrimo.senseafri.com)"; exit 1; }
[ -f "$ARCHIVE" ] || { echo "Archive $ARCHIVE introuvable dans $(pwd)."; exit 1; }
ICI="$(cd "$(dirname "$0")" && pwd)"
# Noms de l'environnement : dossier, service, utilisateur, base, port, hôte (deploy/noms.sh, aussi dans l'archive)
if [ -f "$ICI/noms.sh" ]; then . "$ICI/noms.sh"; else TMPN=$(mktemp -d); unzip -q -o "$ARCHIVE" 'arrimo/deploy/noms.sh' -d "$TMPN"; . "$TMPN/arrimo/deploy/noms.sh"; rm -rf "$TMPN"; fi

# Garde-fous
if [ "$ARRIMO_ENV" = production ]; then
  [ "${CONFIRMER_HEBERGEMENT_CANADA:-}" = oui ] || { echo "Production refusée : confirmez que ce serveur est hébergé au Canada (CONFIRMER_HEBERGEMENT_CANADA=oui) et que l'évaluation Loi 25 est faite."; exit 1; }
fi
if [ -f "$DOSSIER/.env" ] && grep -q '^ARRIMO_ENV=' "$DOSSIER/.env" && ! grep -q "^ARRIMO_ENV=$ARRIMO_ENV\$" "$DOSSIER/.env"; then
  echo "$DOSSIER contient un autre environnement ($(grep '^ARRIMO_ENV=' "$DOSSIER/.env")). Rien n'est modifié."; exit 1
fi
if ! systemctl list-unit-files "$NOM.service" >/dev/null 2>&1 && ss -ltn | grep -q ":$PORT "; then
  echo "Le port $PORT est déjà utilisé. Relancez avec PORT=<autre port>."; exit 1
fi
echo "Environnement : $ARRIMO_ENV · hôte https://$HOTE · dossier $DOSSIER · service $NOM · base $BASE · port $PORT"

echo "== 1/7 Paquets système"
apt-get update -qq
apt-get install -y -qq curl unzip nginx postgresql certbot python3-certbot-nginx >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "   Node $(node -v)"

echo "== 2/7 Utilisateur et fichiers"
id "$UTILISATEUR" >/dev/null 2>&1 || useradd --system --home "$DOSSIER" --shell /usr/sbin/nologin "$UTILISATEUR"
TMP=$(mktemp -d)
unzip -q "$ARCHIVE" -d "$TMP"
mkdir -p "$DOSSIER"
cp -r "$TMP"/arrimo/. "$DOSSIER"/
rm -rf "$TMP"
cd "$DOSSIER"
npm ci --omit=dev --silent

# Écrit ou remplace une variable du fichier .env
regler() { if grep -q "^$1=" "$DOSSIER/.env"; then sed -i "s|^$1=.*|$1=$2|" "$DOSSIER/.env"; else printf '%s=%s\n' "$1" "$2" >> "$DOSSIER/.env"; fi; }

echo "== 3/7 Base de données"
if [ ! -f "$DOSSIER/.env" ]; then
  MDP_BD=$(openssl rand -hex 24)
  sudo -u postgres psql -qc "CREATE ROLE $BASE LOGIN PASSWORD '$MDP_BD'" 2>/dev/null || sudo -u postgres psql -qc "ALTER ROLE $BASE PASSWORD '$MDP_BD'"
  sudo -u postgres psql -lqt | cut -d'|' -f1 | grep -qw "$BASE" || sudo -u postgres createdb -O "$BASE" "$BASE"
  cat > "$DOSSIER/.env" <<ENV
DATABASE_URL=postgres://$BASE:$MDP_BD@127.0.0.1:5432/$BASE
PORT=$PORT
HOST=127.0.0.1
SESSION_HEURES=12
BLOCAGES_MINUTES=15
NODE_ENV=production
COPILOTE_IA_CLE=
ENV
  [ "$ARRIMO_ENV" != sh ] && printf 'SH_API_KEY=%s\n' "$(openssl rand -hex 32)" >> "$DOSSIER/.env"
  [ "$ARRIMO_ENV" = demo ] && printf 'DEMO_MOT_DE_PASSE=Arrimo-%s\nARRIMO_DEMO=1\n' "$(openssl rand -hex 6)" >> "$DOSSIER/.env"
  NOUVELLE_INSTALLATION=1
fi
# Environnement et domaine : les deux réglages qui décident de tout le reste
regler ARRIMO_ENV "$ARRIMO_ENV"
regler ARRIMO_DOMAINE "$DOMAINE"
# Console SH : reliée aux environnements installés sur ce serveur (adresse locale, clé de service, adresse publique)
if [ "$ARRIMO_ENV" = sh ]; then
  valeur() { grep "^$2=" "$1" | head -1 | cut -d= -f2-; }
  for ENV_DOSSIER in /opt/arrimo /opt/arrimo-recette; do
    [ -f "$ENV_DOSSIER/.env" ] || continue
    E_ENV=$(valeur "$ENV_DOSSIER/.env" ARRIMO_ENV); E_CLE=$(valeur "$ENV_DOSSIER/.env" SH_API_KEY); E_PORT=$(valeur "$ENV_DOSSIER/.env" PORT)
    [ -n "$E_ENV" ] && [ -n "$E_CLE" ] || continue
    if [ "$E_ENV" = recette ]; then E_HOTE="recette.$DOMAINE"; else E_HOTE="$DOMAINE"; fi
    P="SH_ENV_$(printf '%s' "$E_ENV" | tr '[:lower:]' '[:upper:]')"
    regler "${P}_URL" "http://127.0.0.1:${E_PORT:-3010}"; regler "${P}_CLE" "$E_CLE"; regler "${P}_PUBLIC" "https://$E_HOTE"
    echo "   Console reliée à : $E_ENV (https://$E_HOTE)"
  done
fi
chmod 600 "$DOSSIER/.env"
chown -R "$UTILISATEUR:$UTILISATEUR" "$DOSSIER"

echo "== 4/7 Données"
if [ "${NOUVELLE_INSTALLATION:-0}" = 1 ] && [ "$ARRIMO_ENV" = demo ]; then
  if [ "$SCENARIO" = six ]; then SCRIPT=db/seed.js; else SCRIPT=db/demo-reseau.js; fi
  sudo -u "$UTILISATEUR" bash -c "set -a; . $DOSSIER/.env; set +a; cd $DOSSIER && node $SCRIPT" > "$DOSSIER/acces-demo.txt"
  chmod 600 "$DOSSIER/acces-demo.txt"; chown "$UTILISATEUR:$UTILISATEUR" "$DOSSIER/acces-demo.txt"
  echo "   Démonstration créée (accès dans $DOSSIER/acces-demo.txt)."
else
  if [ "$ARRIMO_ENV" = sh ]; then SCHEMA=db/sh-schema.sql; else SCHEMA=db/schema.sql; fi
  sudo -u "$UTILISATEUR" bash -c "set -a; . $DOSSIER/.env; set +a; cd $DOSSIER && psql \"\$DATABASE_URL\" -q -f $SCHEMA" >/dev/null
  if [ "${NOUVELLE_INSTALLATION:-0}" = 1 ]; then
    echo "   Base vide (aucune donnée de démonstration en $ARRIMO_ENV)."
    if [ -n "${PREMIER_COMPTE:-}" ]; then
      if [ "$ARRIMO_ENV" = sh ]; then SCRIPT_COMPTE=db/sh-premier-compte.js; else SCRIPT_COMPTE=db/premier-compte.js; fi
      sudo -u "$UTILISATEUR" bash -c "set -a; . $DOSSIER/.env; set +a; cd $DOSSIER && node $SCRIPT_COMPTE '$PREMIER_COMPTE' '${PREMIER_NOM:-Gestionnaire}'" > "$DOSSIER/premier-compte.txt"
      chmod 600 "$DOSSIER/premier-compte.txt"; chown "$UTILISATEUR:$UTILISATEUR" "$DOSSIER/premier-compte.txt"
      echo "   Premier compte créé : mot de passe temporaire dans $DOSSIER/premier-compte.txt (à récupérer, puis à supprimer)."
    fi
  else
    echo "   Base existante conservée (schéma mis à jour)."
  fi
fi

echo "== 5/7 Service"
if [ "$ARRIMO_ENV" = sh ]; then DEMARRAGE=src/sh/server.js; DESCRIPTION="Console SH d'Arrimo"; else DEMARRAGE=src/server.js; DESCRIPTION="Arrimo $ARRIMO_ENV (lits et transferts)"; fi
cat > "/etc/systemd/system/$NOM.service" <<UNIT
[Unit]
Description=$DESCRIPTION
After=network.target postgresql.service

[Service]
User=$UTILISATEUR
WorkingDirectory=$DOSSIER
EnvironmentFile=$DOSSIER/.env
ExecStart=/usr/bin/node $DEMARRAGE
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now "$NOM" >/dev/null 2>&1
systemctl restart "$NOM"
sleep 2
curl -fsS "http://127.0.0.1:$PORT/" >/dev/null && echo "   Service démarré." || { echo "Le service ne répond pas : journalctl -u $NOM -n 50"; exit 1; }

echo "== 5b Sauvegardes automatiques (chaque nuit à 3 h, conservées 14 jours, dans $SAUVEGARDES)"
mkdir -p /usr/local/lib/arrimo
install -m 750 "$DOSSIER/deploy/sauvegarde.sh" /usr/local/lib/arrimo/sauvegarde.sh
install -m 750 "$DOSSIER/deploy/restaurer.sh" /usr/local/lib/arrimo/restaurer.sh
install -m 750 "$DOSSIER/deploy/surveillance.sh" /usr/local/lib/arrimo/surveillance.sh
install -m 750 "$DOSSIER/deploy/lien.sh" /usr/local/lib/arrimo/lien.sh
install -m 750 "$DOSSIER/deploy/b2-configurer.sh" /usr/local/bin/arrimo-b2-configurer
printf '#!/usr/bin/env bash\nDOSSIER_APP=%s SAUVEGARDE_DOSSIER=%s exec /usr/local/lib/arrimo/sauvegarde.sh "$@"\n' "$DOSSIER" "$SAUVEGARDES" > "/usr/local/bin/$NOM-sauvegarde"
printf '#!/usr/bin/env bash\nDOSSIER_APP=%s SERVICE=%s exec /usr/local/lib/arrimo/restaurer.sh "$@"\n' "$DOSSIER" "$NOM" > "/usr/local/bin/$NOM-restaurer"
chmod 750 "/usr/local/bin/$NOM-sauvegarde" "/usr/local/bin/$NOM-restaurer"
# Lien propre d'un hôpital (<sous-domaine>.<hôte>) : certificat HTTPS, voir deploy/lien.sh
if [ "$ARRIMO_ENV" != sh ]; then
  printf '#!/usr/bin/env bash\nHOTE=%s SITE=%s exec /usr/local/lib/arrimo/lien.sh "$@"\n' "$HOTE" "/etc/nginx/sites-available/$NOM" > "/usr/local/bin/$NOM-lien"; chmod 750 "/usr/local/bin/$NOM-lien"
fi
cat > "/etc/systemd/system/$NOM-sauvegarde.service" <<UNIT
[Unit]
Description=Sauvegarde de la base Arrimo ($ARRIMO_ENV)
[Service]
Type=oneshot
ExecStart=/usr/local/bin/$NOM-sauvegarde
UNIT
cat > "/etc/systemd/system/$NOM-sauvegarde.timer" <<UNIT
[Unit]
Description=Sauvegarde nocturne d'Arrimo ($ARRIMO_ENV)
[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now "$NOM-sauvegarde.timer" >/dev/null 2>&1
systemctl start "$NOM-sauvegarde.service" && echo "   Première sauvegarde faite : $(ls -1t "$SAUVEGARDES"/*.dump | head -1)"

echo "== 5c Surveillance (toutes les 5 minutes, échecs dans journalctl -t $NOM-surveillance)"
cat > "/etc/systemd/system/$NOM-surveillance.service" <<UNIT
[Unit]
Description=Surveillance d'Arrimo $ARRIMO_ENV (/api/sante)
[Service]
Type=oneshot
Environment=ARRIMO_URL_SANTE=https://$HOTE/api/sante
Environment=SURVEILLANCE_NOM=$NOM-surveillance
ExecStart=/usr/local/lib/arrimo/surveillance.sh
UNIT
cat > "/etc/systemd/system/$NOM-surveillance.timer" <<UNIT
[Unit]
Description=Surveillance d'Arrimo $ARRIMO_ENV toutes les 5 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now "$NOM-surveillance.timer" >/dev/null 2>&1

echo "== 5d Remise à zéro de nuit (démonstration seulement)"
if [ "$ARRIMO_ENV" = demo ]; then
  cat > /etc/systemd/system/arrimo-demo-nuit.service <<UNIT
[Unit]
Description=Remise à zéro nocturne de la démonstration Arrimo
After=postgresql.service
[Service]
Type=oneshot
User=$UTILISATEUR
WorkingDirectory=$DOSSIER
EnvironmentFile=$DOSSIER/.env
ExecStart=/usr/bin/node db/reset.js demo --silencieux
UNIT
  cat > /etc/systemd/system/arrimo-demo-nuit.timer <<UNIT
[Unit]
Description=Remise à zéro de la démonstration Arrimo chaque nuit à 4 h
[Timer]
OnCalendar=*-*-* 04:00:00
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now arrimo-demo-nuit.timer >/dev/null 2>&1
  echo "   Timer arrimo-demo-nuit actif."
else
  echo "   $ARRIMO_ENV : pas de remise à zéro automatique."
fi

echo "== 6/7 Nginx"
# Noms servis : l'hôte et les liens propres des hôpitaux déjà ajoutés au certificat (<nom>-lien). Jamais de nom générique (*.hôte) :
# certbot pourrait alors installer le certificat d'un autre environnement dans ce site.
NOMS_CERT=$(certbot certificates --cert-name "$HOTE" 2>/dev/null | sed -n 's/^ *Domains: //p')
NOMS_NGINX=$(printf '%s\n' "$HOTE" $NOMS_CERT | awk 'NF && !vu[$0]++' | paste -sd' ' -)
echo 'limit_req_zone $binary_remote_addr zone=arrimo_connexion:10m rate=10r/m;' > /etc/nginx/conf.d/arrimo-limites.conf
cat > "/etc/nginx/sites-available/$NOM" <<NGINX
server {
    listen 80;
    server_name $NOMS_NGINX;
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
ln -sf "/etc/nginx/sites-available/$NOM" "/etc/nginx/sites-enabled/$NOM"
nginx -t -q && systemctl reload nginx

echo "== 7/7 Certificat HTTPS"
# Garde les noms déjà couverts (liens propres des hôpitaux ajoutés par <nom>-lien)
LISTE_CERT=$(printf '%s' "$NOMS_NGINX" | tr ' ' ',')
if certbot --nginx --cert-name "$HOTE" -d "$LISTE_CERT" --expand --non-interactive --agree-tos --register-unsafely-without-email --redirect -q; then
  echo "   HTTPS actif."
else
  echo "   Certificat non obtenu : vérifiez que le DNS de $HOTE pointe vers ce serveur, puis relancez :"
  echo "   certbot --nginx -d $HOTE --redirect"
fi

echo
echo "Arrimo ($ARRIMO_ENV) est en ligne : https://$HOTE"
echo "Journaux : journalctl -u $NOM -f      Redémarrer : systemctl restart $NOM"
echo "Sauvegardes : $SAUVEGARDES (chaque nuit à 3 h). Sauvegarder maintenant : $NOM-sauvegarde. Restaurer : $NOM-restaurer <fichier.dump>"
echo "État du service : curl -s https://$HOTE/api/sante"
[ "$ARRIMO_ENV" != sh ] && echo "Lien propre d'un hôpital (après son DNS) : $NOM-lien <sous-domaine>"
if [ "$ARRIMO_ENV" = demo ]; then
  echo "Remettre la démo à zéro : systemctl start arrimo-demo-nuit.service"
fi
