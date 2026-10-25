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
ARCHIVE_SHA=$(sha256sum "$ARCHIVE" | cut -d' ' -f1)
ICI="$(cd "$(dirname "$0")" && pwd)"
# Noms de l'environnement : dossier, service, utilisateur, base, port, hôte (deploy/noms.sh, aussi dans l'archive)
if [ -f "$ICI/noms.sh" ]; then . "$ICI/noms.sh"; else TMPN=$(mktemp -d); unzip -q -o "$ARCHIVE" 'arrimo/deploy/noms.sh' -d "$TMPN"; . "$TMPN/arrimo/deploy/noms.sh"; rm -rf "$TMPN"; fi

# Garde-fous
if [ "$ARRIMO_ENV" = production ]; then
  [ "${CONFIRMER_HEBERGEMENT_CANADA:-}" = oui ] || { echo "Production refusée : confirmez que ce serveur est hébergé au Canada (CONFIRMER_HEBERGEMENT_CANADA=oui) et que l'évaluation Loi 25 est faite."; exit 1; }
fi
ROOT_DOSSIER="$DOSSIER"
ENV_SOURCE="$ROOT_DOSSIER/shared/.env"
[ -f "$ENV_SOURCE" ] || ENV_SOURCE="$ROOT_DOSSIER/.env"
EXISTING_INSTALL=0
if [ -f "$ENV_SOURCE" ] && grep -q '^ARRIMO_ENV=' "$ENV_SOURCE" && ! grep -q "^ARRIMO_ENV=$ARRIMO_ENV\$" "$ENV_SOURCE"; then
  echo "$ENV_SOURCE contient un autre environnement ($(grep '^ARRIMO_ENV=' "$ENV_SOURCE")). Rien n'est modifié."; exit 1
fi
if [ -f "$ENV_SOURCE" ]; then
  EXISTING_INSTALL=1
  PREFLIGHT="${ARRIMO_DEPLOY_PREFLIGHT_FILE:-}"
  [ -n "$PREFLIGHT" ] && [ -r "$PREFLIGHT" ] || { echo "Mise à jour refusée: fournissez ARRIMO_DEPLOY_PREFLIGHT_FILE avec les preuves de sauvegarde/restauration et rollback isolé."; exit 1; }
  for preuve in "candidate_archive_sha256=$ARCHIVE_SHA" 'backup_restore=PASS' 'isolated_restore=PASS' 'schema_compatibility=PASS' 'rollback_drill=PASS'; do
    grep -Fxq "$preuve" "$PREFLIGHT" || { echo "Mise à jour refusée: preuve manquante dans le préflight ($preuve)."; exit 1; }
  done
  command -v pg_restore >/dev/null || { echo "Mise à jour refusée: pg_restore requis pour vérifier la sauvegarde."; exit 1; }
  BACKUP_DIR=$(sed -n 's/^backup_directory=//p' "$PREFLIGHT" | head -1)
  [ -n "$BACKUP_DIR" ] && [ -r "$BACKUP_DIR/SHA256SUMS" ] || { echo "Mise à jour refusée: sauvegarde complète référencée introuvable."; exit 1; }
  BACKUP_DUMP="$BACKUP_DIR/database.dump"
  [ -r "$BACKUP_DUMP" ] || BACKUP_DUMP="$BACKUP_DIR/arrimo.dump"
  [ -r "$BACKUP_DUMP" ] || { echo "Mise à jour refusée: dump PostgreSQL absent de la sauvegarde."; exit 1; }
  (cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS >/dev/null)
  pg_restore --list "$BACKUP_DUMP" >/dev/null
  SITE_CHECK="/etc/nginx/sites-available/$NOM"
  [ -r "$SITE_CHECK" ] && grep -F 'server_name' "$SITE_CHECK" | grep -Fq "$HOTE" && grep -Fq "proxy_pass http://127.0.0.1:$PORT;" "$SITE_CHECK" || { echo "Mise à jour refusée: site Nginx/hôte/port actuel absent ou différent."; exit 1; }
  [ -L "/etc/nginx/sites-enabled/$NOM" ] && [ "$(readlink "/etc/nginx/sites-enabled/$NOM")" = "$SITE_CHECK" ] || { echo "Mise à jour refusée: lien Nginx actif absent ou inattendu."; exit 1; }
  [ -s "/etc/letsencrypt/live/$HOTE/fullchain.pem" ] || { echo "Mise à jour refusée: certificat existant absent; ne pas lancer certbot dans une mise à jour."; exit 1; }
  systemctl list-unit-files "$NOM.service" 2>/dev/null | grep -q "$NOM.service" || { echo "Mise à jour refusée: unité systemd existante absente."; exit 1; }
fi
if ! systemctl list-unit-files "$NOM.service" >/dev/null 2>&1 && ss -ltn | grep -q ":$PORT "; then
  echo "Le port $PORT est déjà utilisé. Relancez avec PORT=<autre port>."; exit 1
fi
echo "Environnement : $ARRIMO_ENV · hôte https://$HOTE · releases sous $ROOT_DOSSIER · service $NOM · base $BASE · port $PORT"

echo "== 1/7 Paquets système"
if [ "$EXISTING_INSTALL" = 1 ]; then
  for outil in curl unzip xz nginx psql certbot systemctl ss; do
    command -v "$outil" >/dev/null || { echo "Mise à jour refusée: outil système absent ($outil); aucun paquet global n'est installé automatiquement."; exit 1; }
  done
else
  apt-get update -qq
  apt-get install -y -qq curl unzip xz-utils nginx postgresql certbot python3-certbot-nginx >/dev/null
fi

echo "== 2/7 Utilisateur et fichiers"
id "$UTILISATEUR" >/dev/null 2>&1 || useradd --system --home "$ROOT_DOSSIER" --shell /usr/sbin/nologin "$UTILISATEUR"
TMP=$(mktemp -d)
RELEASE_ID="${RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)-${ARCHIVE_SHA:0:12}}"
[[ "$RELEASE_ID" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Identifiant de release invalide."; exit 1; }
mkdir -p "$ROOT_DOSSIER/releases" "$ROOT_DOSSIER/shared"
RELEASE_DIR="$ROOT_DOSSIER/releases/$RELEASE_ID"
if [ -e "$RELEASE_DIR" ]; then
  [ -f "$RELEASE_DIR/.arrimo-release.sha256" ] && [ "$(cat "$RELEASE_DIR/.arrimo-release.sha256")" = "$ARCHIVE_SHA" ] || { echo "Release existante différente; aucun fichier écrasé."; exit 1; }
else
  STAGING="$ROOT_DOSSIER/releases/.staging-$RELEASE_ID-$$"
  mkdir -m 700 "$STAGING"
  unzip -q "$ARCHIVE" -d "$TMP"
  [ -d "$TMP/arrimo" ] || { echo "Archive invalide: dossier arrimo absent."; exit 1; }
  cp -a "$TMP/arrimo/." "$STAGING/"
  printf '%s\n' "$ARCHIVE_SHA" > "$STAGING/.arrimo-release.sha256"
  mv "$STAGING" "$RELEASE_DIR"
fi
rm -rf "$TMP"
if [ ! -f "$ROOT_DOSSIER/shared/.env" ] && [ -f "$ROOT_DOSSIER/.env" ]; then
  install -m 600 -o "$UTILISATEUR" -g "$UTILISATEUR" "$ROOT_DOSSIER/.env" "$ROOT_DOSSIER/shared/.env"
fi
DOSSIER="$RELEASE_DIR"
NODE_SHARED="$ROOT_DOSSIER/shared/.runtime"
mkdir -p "$NODE_SHARED"
ln -sfn "$ROOT_DOSSIER/shared/.env" "$DOSSIER/.env"
ln -sfn "$NODE_SHARED" "$DOSSIER/.runtime"
cd "$DOSSIER"

# Runtime Node dédié à cette application; aucune mise à jour du Node système.
NODE_VERSION=24.22.1
case "$(dpkg --print-architecture)" in
  amd64) NODE_ARCH=x64; NODE_SHA256=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6 ;;
  arm64) NODE_ARCH=arm64; NODE_SHA256=dbabf7a1cbf947e6059ffad2c27b80041db97dea1e553b62afdee7f13fca336e ;;
  *) echo "Architecture non prise en charge pour Node.js isolé."; exit 1 ;;
esac
NODE_HOME="$NODE_SHARED/node-v$NODE_VERSION"
if [ -e "$NODE_HOME" ] && { [ ! -x "$NODE_HOME/bin/node" ] || [ "$("$NODE_HOME/bin/node" -p 'process.versions.node' 2>/dev/null || true)" != "$NODE_VERSION" ]; }; then
  echo "Runtime local présent mais invalide : $NODE_HOME (aucun fichier supprimé)."; exit 1
fi
if [ ! -x "$NODE_HOME/bin/node" ]; then
  mkdir -p "$NODE_SHARED"
  TMP_NODE=$(mktemp -d "$NODE_SHARED/.node-install.XXXXXX")
  trap 'rm -rf "$TMP_NODE"' EXIT
  TARBALL="node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
  curl -fsS --retry 3 "https://nodejs.org/dist/v$NODE_VERSION/$TARBALL" -o "$TMP_NODE/$TARBALL"
  echo "$NODE_SHA256  $TMP_NODE/$TARBALL" | sha256sum -c - >/dev/null
  tar -xJf "$TMP_NODE/$TARBALL" -C "$TMP_NODE"
  mv "$TMP_NODE/node-v$NODE_VERSION-linux-$NODE_ARCH" "$NODE_HOME"
  rm -rf "$TMP_NODE"
  trap - EXIT
fi
export PATH="$NODE_HOME/bin:$PATH"
echo "   Node isolé $("$NODE_HOME/bin/node" -v)"
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
chown "$UTILISATEUR:$UTILISATEUR" "$ROOT_DOSSIER/shared/.env"

echo "== 4/7 Données"
if [ "${NOUVELLE_INSTALLATION:-0}" = 1 ] && [ "$ARRIMO_ENV" = demo ]; then
  if [ "$SCENARIO" = six ]; then SCRIPT=db/seed.js; else SCRIPT=db/demo-reseau.js; fi
  sudo -u "$UTILISATEUR" bash -c "set -a; . $DOSSIER/.env; set +a; cd $DOSSIER && node $SCRIPT" > "$DOSSIER/acces-demo.txt"
  chmod 600 "$DOSSIER/acces-demo.txt"; chown "$UTILISATEUR:$UTILISATEUR" "$DOSSIER/acces-demo.txt"
  echo "   Démonstration créée (accès dans $DOSSIER/acces-demo.txt)."
else
  if [ "$ARRIMO_ENV" = sh ]; then SCHEMA=db/sh-schema.sql; else SCHEMA=db/schema.sql; fi
  if [ "${NOUVELLE_INSTALLATION:-0}" = 1 ]; then
    sudo -u "$UTILISATEUR" bash -c "set -a; . $DOSSIER/.env; set +a; cd $DOSSIER && psql \"\$DATABASE_URL\" -q -f $SCHEMA" >/dev/null
  elif [ "$ARRIMO_ENV" = sh ]; then
    sudo -u "$UTILISATEUR" bash -c "set -a; . $DOSSIER/.env; set +a; cd $DOSSIER && psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -q -f db/sh-schema.sql" >/dev/null
  else
    # Une mise à jour ne rejoue jamais le schéma global: seule la migration
    # versionnée, additive et transactionnelle est appliquée.
    sudo -u "$UTILISATEUR" bash -c "set -a; . $DOSSIER/.env; set +a; cd $DOSSIER && psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -q -f db/migrations/20261022_capacites_og.sql" >/dev/null
    sudo -u "$UTILISATEUR" bash -c "set -a; . $DOSSIER/.env; set +a; cd $DOSSIER && psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -q -f db/migrations/20261023_services_hospitaliers.sql" >/dev/null
    sudo -u "$UTILISATEUR" bash -c "set -a; . $DOSSIER/.env; set +a; cd $DOSSIER && psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -q -f db/migrations/20261023_structure_hospitaliere_detaillee.sql" >/dev/null
    sudo -u "$UTILISATEUR" bash -c "set -a; . $DOSSIER/.env; set +a; cd $DOSSIER && psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -q -f db/migrations/20261024_comptes_invitations.sql" >/dev/null
    # Coordination : les deux migrations sont atomiques ; aucun seed ni remise à zéro.
    sudo -u "$UTILISATEUR" bash -c "set -a; . $DOSSIER/.env; set +a; cd $DOSSIER && psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -q --single-transaction -f db/migrations/20261025-priorites.sql -f db/migrations/20261025-simulation.sql" >/dev/null
  fi
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

# Première mise à jour d'une installation historique sans pointeur current :
# capturer ses fichiers avant de changer l'unité systemd, puis l'activer comme
# release précédente. Ainsi un échec du premier déploiement peut revenir au
# code historique plutôt que de laisser current absent.
if [ "$EXISTING_INSTALL" = 1 ] && [ ! -L "$ROOT_DOSSIER/current" ] && [ -f "$ROOT_DOSSIER/src/server.js" ]; then
  LEGACY_ID="legacy-$(date -u +%Y%m%dT%H%M%SZ)"
  LEGACY_STAGE="$ROOT_DOSSIER/releases/.staging-$LEGACY_ID-$$"
  mkdir -m 700 "$LEGACY_STAGE"
  tar -C "$ROOT_DOSSIER" --exclude='./releases' --exclude='./shared' --exclude='./current' --exclude='./previous' --exclude='./.env' -cf - . | tar -C "$LEGACY_STAGE" -xf -
  ln -s "$ROOT_DOSSIER/shared/.env" "$LEGACY_STAGE/.env"
  printf 'legacy_snapshot_utc=%s\n' "$(date -u +%Y%m%dT%H%M%SZ)" > "$LEGACY_STAGE/.arrimo-legacy-release"
  chown -R root:root "$LEGACY_STAGE"; chmod -R a-w "$LEGACY_STAGE"
  mv "$LEGACY_STAGE" "$ROOT_DOSSIER/releases/$LEGACY_ID"
  "$DOSSIER/deploy/releases.sh" activate "$ROOT_DOSSIER" "$LEGACY_ID" "$NOM" "http://127.0.0.1:$PORT/api/sante" || { echo "Impossible de vérifier la release historique; aucun changement d'unité systemd n'a été fait."; exit 1; }
  echo "   Ancienne installation capturée et activée comme release précédente: $LEGACY_ID."
fi

# Après les éventuelles écritures d'initialisation, rendre le code et ses
# dépendances non modifiables par le compte du service. .env et Node restent
# dans shared/ et ne font pas partie de la release.
chown -R root:root "$DOSSIER"
chmod -R a-w "$DOSSIER"

echo "== 5/7 Service"
if [ "$ARRIMO_ENV" = sh ]; then DEMARRAGE=src/sh/server.js; DESCRIPTION="Console SH d'Arrimo"; else DEMARRAGE=src/server.js; DESCRIPTION="Arrimo $ARRIMO_ENV (lits et transferts)"; fi
UNIT_TMP=$(mktemp "/etc/systemd/system/.${NOM}.service.XXXXXX")
cat > "$UNIT_TMP" <<UNIT
[Unit]
Description=$DESCRIPTION
After=network.target postgresql.service

[Service]
User=$UTILISATEUR
WorkingDirectory=$ROOT_DOSSIER/current
EnvironmentFile=$ROOT_DOSSIER/shared/.env
ExecStart=$NODE_HOME/bin/node $DEMARRAGE
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
chmod 644 "$UNIT_TMP"; mv -f "$UNIT_TMP" "/etc/systemd/system/$NOM.service"
systemctl daemon-reload
systemctl enable "$NOM" >/dev/null 2>&1
"$DOSSIER/deploy/releases.sh" activate "$ROOT_DOSSIER" "$RELEASE_ID" "$NOM" "http://127.0.0.1:$PORT/api/sante" || { echo "Bascule échouée; pointeur précédent rétabli si présent. Vérifiez journalctl -u $NOM -n 50."; exit 1; }
echo "   Release $RELEASE_ID active; release précédente conservée."

echo "== 5b Sauvegardes automatiques (chaque nuit à 3 h, conservées 14 jours, dans $SAUVEGARDES)"
mkdir -p /usr/local/lib/arrimo
install -m 750 "$DOSSIER/deploy/sauvegarde.sh" /usr/local/lib/arrimo/sauvegarde.sh
install -m 750 "$DOSSIER/deploy/sauvegarde-complete.sh" /usr/local/lib/arrimo/sauvegarde-complete.sh
install -m 750 "$DOSSIER/deploy/restaurer-isolee.sh" /usr/local/lib/arrimo/restaurer-isolee.sh
install -m 750 "$DOSSIER/deploy/restaurer.sh" /usr/local/lib/arrimo/restaurer.sh
install -m 750 "$DOSSIER/deploy/surveillance.sh" /usr/local/lib/arrimo/surveillance.sh
install -m 750 "$DOSSIER/deploy/lien.sh" /usr/local/lib/arrimo/lien.sh
install -m 750 "$DOSSIER/deploy/b2-configurer.sh" /usr/local/bin/arrimo-b2-configurer
printf '#!/usr/bin/env bash\nDOSSIER_APP=%s SAUVEGARDE_DOSSIER=%s exec /usr/local/lib/arrimo/sauvegarde.sh "$@"\n' "$DOSSIER" "$SAUVEGARDES" > "/usr/local/bin/$NOM-sauvegarde"
printf '#!/usr/bin/env bash\nexec /usr/local/lib/arrimo/sauvegarde-complete.sh "%s" "%s" "$@"\n' "$ROOT_DOSSIER" "$NOM" > "/usr/local/bin/$NOM-sauvegarde-complete"
printf '#!/usr/bin/env bash\nDOSSIER_APP=%s SERVICE=%s exec /usr/local/lib/arrimo/restaurer.sh "$@"\n' "$DOSSIER" "$NOM" > "/usr/local/bin/$NOM-restaurer"
chmod 750 "/usr/local/bin/$NOM-sauvegarde" "/usr/local/bin/$NOM-sauvegarde-complete" "/usr/local/bin/$NOM-restaurer"
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
ExecStart=$NODE_HOME/bin/node db/reset.js demo --silencieux
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
LIMITE_FILE=/etc/nginx/conf.d/arrimo-limites.conf
LIMITE_DIRECTIVE='limit_req_zone $binary_remote_addr zone=arrimo_connexion:10m rate=10r/m;'
if [ -e "$LIMITE_FILE" ]; then
  grep -Fqx "$LIMITE_DIRECTIVE" "$LIMITE_FILE" || { echo "Configuration Nginx globale existante différente; refus de l'écraser."; exit 1; }
else
  LIMITE_TMP=$(mktemp /etc/nginx/conf.d/.arrimo-limites.XXXXXX)
  printf '%s\n' "$LIMITE_DIRECTIVE" > "$LIMITE_TMP"
  chmod 644 "$LIMITE_TMP"; mv -f "$LIMITE_TMP" "$LIMITE_FILE"
fi
SITE_FILE="/etc/nginx/sites-available/$NOM"
if [ -e "$SITE_FILE" ]; then
  grep -Fq "server_name $NOMS_NGINX;" "$SITE_FILE" && grep -Fq "proxy_pass http://127.0.0.1:$PORT;" "$SITE_FILE" || { echo "Site Nginx existant différent (hôte/port); préservez-le et adaptez-le en recette avant de continuer."; exit 1; }
else
SITE_TMP=$(mktemp "/etc/nginx/sites-available/.${NOM}.XXXXXX")
cat > "$SITE_TMP" <<NGINX
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
chmod 644 "$SITE_TMP"; mv -f "$SITE_TMP" "$SITE_FILE"
fi
SITE_ENABLED="/etc/nginx/sites-enabled/$NOM"
if [ -e "$SITE_ENABLED" ] || [ -L "$SITE_ENABLED" ]; then
  [ -L "$SITE_ENABLED" ] && [ "$(readlink "$SITE_ENABLED")" = "$SITE_FILE" ] || { echo "Lien Nginx activé inattendu; refus de le remplacer."; exit 1; }
else
  ln -s "$SITE_FILE" "$SITE_ENABLED"
fi
nginx -t -q && systemctl reload nginx

echo "== 7/7 Certificat HTTPS"
# Garde les noms déjà couverts (liens propres des hôpitaux ajoutés par <nom>-lien)
LISTE_CERT=$(printf '%s' "$NOMS_NGINX" | tr ' ' ',')
if [ -s "/etc/letsencrypt/live/$HOTE/fullchain.pem" ]; then
  echo "   Certificat existant conservé; le renouvellement reste géré par certbot."
elif [ "$EXISTING_INSTALL" = 1 ]; then
  echo "   Certificat existant introuvable sur une mise à jour; aucune modification certbot automatique n'est tentée."; exit 1
elif certbot --nginx --cert-name "$HOTE" -d "$LISTE_CERT" --expand --non-interactive --agree-tos --register-unsafely-without-email --redirect -q; then
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
