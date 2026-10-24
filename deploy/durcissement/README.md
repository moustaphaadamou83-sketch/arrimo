# Durcissement de l'infrastructure — préparé par l'audit du 24 octobre 2026, NON appliqué

À exécuter seulement après accord, dans l'ordre, en vérifiant chaque service après chaque étape.

1. Sauvegarde et surveillance de la démo A/B/C (aucune aujourd'hui) :
   `install -m 755 arrimo-public-demo-sauvegarde /usr/local/bin/` puis copier les `.service`/`.timer` dans `/etc/systemd/system/`,
   `systemctl daemon-reload && systemctl enable --now arrimo-public-demo-sauvegarde.timer arrimo-public-demo-surveillance.timer`.
2. PostgreSQL : retirer la connexion par défaut de PUBLIC sur chaque base, puis la rendre au seul rôle propriétaire :
   `REVOKE CONNECT ON DATABASE arrimo, arrimo_recette, arrimo_sh, <base démo> FROM PUBLIC;` et `GRANT CONNECT ON DATABASE <base> TO <rôle>;`
3. Nginx : `server_tokens off;` dans `nginx.conf` ; retirer `add_header X-Frame-Options SAMEORIGIN` du site de démo
   (l'application envoie déjà `DENY` : deux en-têtes contradictoires) ; `nginx -t && systemctl reload nginx`.
4. Compte système dédié pour la démo publique (aujourd'hui `arrimo`, le même qu'Arrimo principal) : créer `arrimo-demo`,
   `chown root:arrimo-demo` sur `/opt/arrimo-demo` et son `.env`, `User=arrimo-demo` dans l'unité ; retirer le lien `.env`
   de `releases/legacy-f6db0e021698-independent` qui pointe vers le `.env` d'Arrimo principal.
5. Recette : la mettre à jour vers la release candidate (Node 24 ; elle tourne sur Node 18 en fin de vie avec 4 vulnérabilités hautes).
6. Alertes : la surveillance n'écrit que dans le journal système ; relier `logger -p user.err` à un courriel ou à la console SH.
