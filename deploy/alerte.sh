#!/usr/bin/env bash
# Alerte à un humain : courriel (ALERTE_SMTP_URL + ALERTE_COURRIEL) et, facultatif, webhook HTTPS (ALERTE_WEBHOOK_URL).
# Réglages lus dans ALERTE_CONFIG (par défaut /etc/arrimo/alertes.env, root, droits 600) ; les variables déjà définies l'emportent.
# - Les secrets (adresse SMTP avec identifiants, adresse du webhook) passent par un fichier de configuration curl
#   ou par l'entrée standard, jamais par les arguments (visibles dans la liste des processus).
# - Une même alerte (même sujet) part au plus une fois par heure (ALERTE_INTERVALLE_S) ; « rétabli » part toujours.
# - Aucun renseignement de santé : seulement le nom du service, son état et l'heure.
# Usage : alerte.sh "Sujet" "Texte"   ou   source alerte.sh ; envoyer_alerte "Sujet" "Texte"
set -uo pipefail

charger_config_alerte() {
  local f="${ALERTE_CONFIG:-/etc/arrimo/alertes.env}" ligne cle val
  [ -r "$f" ] || return 0
  while IFS= read -r ligne || [ -n "$ligne" ]; do
    case "$ligne" in ''|'#'*) continue ;; esac
    cle="${ligne%%=*}"; val="${ligne#*=}"; val="${val%\"}"; val="${val#\"}"
    case "$cle" in
      ALERTE_SMTP_URL|ALERTE_COURRIEL|ALERTE_EXPEDITEUR|ALERTE_WEBHOOK_URL|ALERTE_INTERVALLE_S)
        [ -n "${!cle:-}" ] || printf -v "$cle" '%s' "$val"; export "${cle?}" ;;
    esac
  done < "$f"
}

envoyer_alerte() {
  local sujet="$1" texte="${2:-$1}" tag="${ALERTE_TAG:-arrimo-alerte}"
  charger_config_alerte
  local dossier="${ALERTE_ETAT_DIR:-/run/arrimo-alertes}" intervalle="${ALERTE_INTERVALLE_S:-3600}"
  mkdir -p "$dossier" 2>/dev/null && chmod 700 "$dossier" 2>/dev/null
  local cle; cle=$(printf '%s' "$sujet" | sha256sum | cut -c1-16)
  case "$sujet" in
    *rétabli*) ;;
    *) if [ -f "$dossier/$cle" ] && [ $(( $(date +%s) - $(cat "$dossier/$cle" 2>/dev/null || echo 0) )) -lt "$intervalle" ]; then
         logger -t "$tag" -p user.notice "Alerte déjà envoyée il y a moins de ${intervalle} s : $sujet"; return 0
       fi ;;
  esac
  date +%s > "$dossier/$cle" 2>/dev/null
  local envoye=0

  if [ -n "${ALERTE_SMTP_URL:-}" ] && [ -n "${ALERTE_COURRIEL:-}" ]; then
    case "$ALERTE_SMTP_URL" in
      smtps://*|smtp://127.0.0.1:*|smtp://*@127.0.0.1:*|smtp://localhost:*|smtp://*@localhost:*) ;;
      *) logger -t "$tag" -p user.err "Courriel d'alerte non envoyé : ALERTE_SMTP_URL doit être en smtps://"; ALERTE_SMTP_URL="" ;;
    esac
  fi
  if [ -n "${ALERTE_SMTP_URL:-}" ] && [ -n "${ALERTE_COURRIEL:-}" ]; then
    local tmp msg conf hote ident de
    tmp=$(mktemp -d) && chmod 700 "$tmp"
    msg="$tmp/message.eml"; conf="$tmp/curl.conf"
    de="${ALERTE_EXPEDITEUR:-$ALERTE_COURRIEL}"
    # smtps://utilisateur:motdepasse@hote:465 : les identifiants vont dans le fichier de configuration (600), pas dans l'URL passée à curl
    hote="${ALERTE_SMTP_URL#*://}"; ident=""
    case "$hote" in *@*) ident="${hote%@*}"; hote="${hote##*@}" ;; esac
    {
      printf 'From: Arrimo surveillance <%s>\r\nTo: <%s>\r\nSubject: =?UTF-8?B?%s?=\r\nDate: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n' \
        "$de" "$ALERTE_COURRIEL" "$(printf '[Arrimo] %s' "$sujet" | base64 -w0)" "$(LC_ALL=C date -R)"
      printf '%s\r\n\r\nServeur : %s\r\nHeure : %s\r\n\r\nMessage automatique de surveillance. Aucun renseignement de santé.\r\n' "$texte" "$(hostname)" "$(date '+%Y-%m-%d %H:%M %Z')"
    } > "$msg"
    {
      printf 'url = "%s://%s"\n' "${ALERTE_SMTP_URL%%://*}" "$hote"
      [ -n "$ident" ] && printf 'user = "%s"\n' "$(printf '%s' "$ident" | sed 's/%40/@/g')"
      printf 'mail-from = "%s"\nmail-rcpt = "%s"\nupload-file = "%s"\n' "$de" "$ALERTE_COURRIEL" "$msg"
      case "$ALERTE_SMTP_URL" in smtps://*) printf 'ssl-reqd\n' ;; esac
    } > "$conf"
    chmod 600 "$conf" "$msg"
    if curl -sS --max-time 20 -K "$conf" -o /dev/null 2>"$tmp/err"; then envoye=1
    else logger -t "$tag" -p user.err "Courriel d'alerte non envoyé : $(head -c 200 "$tmp/err" | sed 's/[^[:print:]]//g')"; fi
    rm -rf "$tmp"
  fi

  if [ -n "${ALERTE_WEBHOOK_URL:-}" ]; then
    case "$ALERTE_WEBHOOK_URL" in
      https://*|http://127.0.0.1:*)
        if printf 'url = "%s"\n' "$ALERTE_WEBHOOK_URL" | curl -sS --max-time 10 -o /dev/null -K - -H 'Content-Type: application/json' -d "{\"text\":\"$sujet\"}"; then envoye=1
        else logger -t "$tag" -p user.err "Alerte non envoyée : le service d'alerte ne répond pas."; fi ;;
      *) logger -t "$tag" -p user.err "Alerte non envoyée : ALERTE_WEBHOOK_URL doit être en HTTPS." ;;
    esac
  fi
  [ "$envoye" = 1 ] || { [ -z "${ALERTE_SMTP_URL:-}${ALERTE_WEBHOOK_URL:-}" ] && logger -t "$tag" -p user.warning "Aucun moyen d'alerte configuré : $sujet"; }
  logger -t "$tag" -p user.notice "Alerte : $sujet"
  return 0
}

# Exécuté directement : envoie l'alerte passée en arguments
if [ "${BASH_SOURCE[0]}" = "$0" ]; then envoyer_alerte "${1:?sujet requis}" "${2:-}"; fi
