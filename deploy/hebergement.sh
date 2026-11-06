#!/usr/bin/env bash
# Pays d'hébergement d'une production : à confirmer explicitement, serveur par serveur.
#   Canada : CONFIRMER_HEBERGEMENT_CANADA=oui (hébergement au Canada et évaluation Loi 25 faits)
#   Autre pays : PAYS_HEBERGEMENT=XX CONFIRMER_HEBERGEMENT=oui CONFIRMER_CADRE_LEGAL=oui
verifier_hebergement() {
  local pays="${PAYS_HEBERGEMENT:-}"
  if [ -z "$pays" ] && [ "${CONFIRMER_HEBERGEMENT_CANADA:-}" = oui ]; then pays=CA; fi
  if ! printf '%s' "$pays" | grep -Eq '^[A-Z]{2}$'; then
    echo "Production refusée : indiquez le pays d'hébergement (PAYS_HEBERGEMENT, code à 2 lettres) ou CONFIRMER_HEBERGEMENT_CANADA=oui."; return 1
  fi
  if [ "$pays" = CA ]; then
    if [ "${CONFIRMER_HEBERGEMENT_CANADA:-}" != oui ]; then
      echo "Production refusée : confirmez que ce serveur est hébergé au Canada et que l'évaluation Loi 25 est faite (CONFIRMER_HEBERGEMENT_CANADA=oui)."; return 1
    fi
  elif [ "${CONFIRMER_HEBERGEMENT:-}" != oui ] || [ "${CONFIRMER_CADRE_LEGAL:-}" != oui ]; then
    echo "Production refusée : confirmez que ce serveur est hébergé en $pays (CONFIRMER_HEBERGEMENT=oui) et que le cadre légal de ce pays a été vérifié (CONFIRMER_CADRE_LEGAL=oui)."; return 1
  fi
  PAYS_HEBERGEMENT="$pays"
}
