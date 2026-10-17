#!/usr/bin/env bash
# Lien propre d'un hôpital : ajoute <sous-domaine>.<hôte> au certificat HTTPS de l'environnement.
# Le sous-domaine se règle dans la console SH ; Arrimo reconnaît l'adresse et ouvre l'établissement de l'hôpital.
# Avant : un enregistrement DNS de <sous-domaine>.<hôte> (ou un enregistrement générique *.<hôte>) vers l'adresse IP du serveur.
# Usage (en root) : arrimo-lien hopital-x        (recette : arrimo-recette-lien hopital-x)
set -euo pipefail
SD="${1:-}"
HOTE="${HOTE:?HOTE manquant (utilisez la commande <nom>-lien installée par installer.sh)}"
[[ "$SD" =~ ^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$ ]] || { echo "Sous-domaine invalide : lettres minuscules, chiffres et tirets (ex. hopital-x)."; exit 1; }
NOMS=$(certbot certificates --cert-name "$HOTE" 2>/dev/null | sed -n 's/^ *Domains: //p')
[ -n "$NOMS" ] || NOMS="$HOTE"
case " $NOMS " in *" $SD.$HOTE "*) echo "https://$SD.$HOTE est déjà couvert par le certificat."; exit 0 ;; esac
LISTE=$(printf '%s,' $NOMS "$SD.$HOTE"); LISTE=${LISTE%,}
# Le site Nginx de l'environnement sert aussi ce nom (ajouté par son nom exact, jamais par un nom générique)
SITE="${SITE:?SITE manquant}"
grep -q "server_name .*[[:space:]]$SD\.$HOTE[ ;]" "$SITE" || sed -i "s|server_name \(.*\);|server_name \1 $SD.$HOTE;|" "$SITE"
nginx -t -q && systemctl reload nginx
certbot --nginx --cert-name "$HOTE" -d "$LISTE" --expand --non-interactive --agree-tos --register-unsafely-without-email --redirect -q
echo "HTTPS actif : https://$SD.$HOTE"
