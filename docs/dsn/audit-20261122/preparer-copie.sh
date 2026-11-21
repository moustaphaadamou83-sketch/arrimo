#!/bin/bash
# Copie isolée : référence de la démo + migration DSN natif (garde) + rattrapage des données DSN ; serveurs 3099 (démo) et 3098 (pilote)
set -e
S=/tmp/claude-0/-root-arrimo-sh-erp/6b6e0251-b2dc-4b0f-87b9-1b3798257a55/scratchpad; O=/root/.local/arrimo-outils-sauvegarde/chantier-20261119
fuser -k 3099/tcp 3098/tcp 2>/dev/null || true; sleep 1
runuser -u postgres -- dropdb --if-exists audit_dsn; runuser -u postgres -- createdb audit_dsn
runuser -u postgres -- pg_restore --exit-on-error -d audit_dsn < /var/backups/arrimo/reference-demo-ciusss-20261122-dsn.dump >/dev/null 2>&1
. $O/droits-dsn-sync.env; bash $O/migrer-lot.sh audit_dsn demo $O/migration-dsn-sync-20261123.sql "$TABLES" "$SEQS" "$VUES" 2>&1 | grep -v NOTICE | tail -1
(set -a; . /opt/arrimo-demo/shared/.env; set +a; unset SMTP_URL; export DATABASE_URL=$(node -e "const u=new URL(process.env.DATABASE_URL);u.pathname='audit_dsn';console.log(u.toString())"); cd /root/arrimo-sh-erp; ARRIMO_ENV=demo node db/demo-dsn.js)
(setsid nohup bash $S/audit/lancer-audit.sh > $S/audit/serveur.log 2>&1 &); (AUDIT_ENV=pilote AUDIT_PORT=3098 setsid nohup bash $S/audit/lancer-audit.sh > $S/audit/serveur-pilote.log 2>&1 &)
for p in 3099 3098; do for i in $(seq 1 30); do curl -s --max-time 3 http://127.0.0.1:$p/api/sante | grep -q '"etat"' && break; sleep 2; done; done; echo "copie prête"
