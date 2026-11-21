#!/bin/bash
# Serveur d'audit ISOLÉ (port 3099, base audit_dsn) : configuration de la démo SANS aucun canal sortant.
set -a; . /opt/arrimo-demo/shared/.env; . /opt/arrimo-demo/shared/routeur-osrm.env; set +a
[ "$AUDIT_ENV" = pilote ] && { unset DEMO_MOT_DE_PASSE; export ARRIMO_MFA_ENCRYPTION_KEY=$(openssl rand -base64 32); }
unset SMTP_URL COPILOTE_IA_CLE COPILOTE_IA_URL SH_API_KEY SH_DATABASE_URL ARRIMO_SUPPORT_SH_URL ARRIMO_SUPPORT_CLE ARRIMO_SUPPORT_CIBLE ARRIMO_VAPID_PUBLIQUE ARRIMO_VAPID_PRIVEE ARRIMO_VAPID_SUJET SAUVEGARDE_DISTANTE
export ARRIMO_ENV=${AUDIT_ENV:-demo}
export DATABASE_URL=$(node -e "const u=new URL(process.env.DATABASE_URL);u.pathname='audit_dsn';console.log(u.toString())")
export PORT=${AUDIT_PORT:-3099} HOST=127.0.0.1
cd /root/arrimo-sh-erp && exec node src/server.js
