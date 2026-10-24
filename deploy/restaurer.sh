#!/usr/bin/env bash
# Fail closed : une restauration directe détruirait les écritures postérieures
# à la sauvegarde. Le retour arrière applicatif doit conserver la base migrée.
set -euo pipefail
echo "Restauration directe de base désactivée : aucune commande n'a été exécutée."
echo "Ne pas restaurer un dump sur la base active. Basculer le code vers la release précédente"
echo "en conservant la base additive migrée; les migrations ne doivent pas supprimer de colonnes."
echo "En cas de corruption de la base, restaurer le dump dans une nouvelle base isolée,"
echo "valider intégrité/comptes/historique, puis préparer une bascule coordonnée sans perdre les écritures récentes."
exit 2
