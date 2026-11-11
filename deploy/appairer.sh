#!/usr/bin/env bash
# Appairage d'un serveur Arrimo avec la console SH : saisie masquée du code d'appairage affiché une seule fois dans SH
# (« Ajouter un serveur »). Le serveur reçoit sa clé de service une seule fois, l'écrit dans son fichier de configuration
# (SH_API_KEY, droits conservés) puis redémarre. La clé n'est jamais affichée ni passée en argument.
# Usage (root) : arrimo-appairer   [SERVICE=arrimo] [SH_URL=https://sh.arrimo.senseafri.com]
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "À lancer en root."; exit 1; }
SERVICE="${SERVICE:-arrimo}"
ENVF="$(systemctl cat "$SERVICE" 2>/dev/null | sed -n 's/^EnvironmentFile=-\{0,1\}//p' | head -1)"
[ -n "$ENVF" ] && [ -f "$ENVF" ] || { echo "Fichier de configuration du service $SERVICE introuvable."; exit 1; }
read -r -p "Adresse de la console SH [${SH_URL:-https://sh.arrimo.senseafri.com}] : " URL; URL="${URL:-${SH_URL:-https://sh.arrimo.senseafri.com}}"
case "$URL" in https://*) ;; *) echo "L'adresse de SH doit être en HTTPS."; exit 1 ;; esac
read -r -s -p "Code d'appairage (affiché dans SH, masqué ici) : " CODE; echo
TMP=$(mktemp -d); chmod 700 "$TMP"; trap 'rm -rf "$TMP"' EXIT
python3 -c 'import json,sys;print(json.dumps({"code_appairage":sys.stdin.read().strip()}))' <<<"$CODE" > "$TMP/corps.json"; unset CODE
STATUT=$(curl -sS --max-time 20 --proto '=https' --max-redirs 0 -o "$TMP/reponse.json" -w '%{http_code}' -H 'Content-Type: application/json' \
  --data-binary @"$TMP/corps.json" "${URL%/}/api/serveurs/appairage" || echo 000)
if [ "$STATUT" != 200 ]; then
  echo "Appairage refusé ($STATUT) : $(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("erreur","réponse illisible"))' "$TMP/reponse.json" 2>/dev/null || echo 'SH injoignable')"; exit 1
fi
cp -p "$ENVF" "$ENVF.avant-appairage-$(date +%Y%m%dt%H%M)" 2>/dev/null || true
# Écrit SH_API_KEY sans l'afficher : la valeur ne passe que par des fichiers temporaires en 600
python3 - "$TMP/reponse.json" "$ENVF" <<'PY'
import json, os, sys, re
rep = json.load(open(sys.argv[1])); cle = rep.get("cle", ""); f = sys.argv[2]
if not re.fullmatch(r"[0-9a-f]{64}", cle): sys.exit("Réponse de SH inattendue : rien n'a été modifié.")
lignes = [l for l in open(f).read().splitlines() if not l.startswith("SH_API_KEY=")]
lignes.append("SH_API_KEY=" + cle)
st = os.stat(f)
with open(f, "w") as o: o.write("\n".join(lignes) + "\n")
os.chown(f, st.st_uid, st.st_gid); os.chmod(f, st.st_mode & 0o777)
print("Serveur appairé : " + rep.get("environnement", "?"))
PY
systemctl restart "$SERVICE" && echo "Service $SERVICE redémarré. Dans SH, cliquez « Vérifier » sur ce serveur pour le relier."
