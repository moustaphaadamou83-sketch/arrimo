# Rapport des cahiers du 6 novembre 2026

Résultats de recette et état de publication : complétés à la fin de la recette finale.

| Lot | Livré | Fichiers principaux | Migration | Retour arrière |
|---|---|---|---|---|
| Transferts multiples | Hôpital A → B, hospitalisations successives | `src/chsld.js`, `src/liaison-chsld.js` | type `transfert_hopital` | release précédente ; contrainte élargie sans effet sur l'ancien code |
| Nettoyage intelligent | Précautions, protocoles, habilitations, équipements, contrôle | `src/nettoyage-securise.js`, `src/regles.js` (garde) | 5 tables, 2 colonnes | idem : tables additives |
| Évaluations fictives | Démo seulement, activées par établissement | `src/evaluations-fictives.js` | 2 tables, 2 colonnes | idem |
| Catégories pour aînés | CHSLD privé, maison des aînés, RPA, RI, RTF, maison de retraite | `src/sh/types-etablissement-migrations.js` | SH 40 à 42 | idem |
| Numérisation | Registre et import CSV vérifié | `src/evenements.js` | 2 tables | idem |
| Proches | Visites, activités, PWA | `src/portail-proches.js`, `public/proches*`, `public/sw-proches.js` | 2 tables | idem |
| OG | Statut et liste des transferts d'hôpital | `src/og-liaison.js` | aucune | idem |

## Bloqué ou non construit
- **Soutien à domicile :** sans chambres, le modèle CHSLD ne convient pas ; périmètre à définir.
- **PDF, fax, reconnaissance de texte :** étude seulement (`docs/ETUDE_NUMERISATION_2026-11-06.md`).
- **Espace résident :** étude seulement (`docs/ETUDE_ESPACE_RESIDENT_2026-11-06.md`).
- **Conformité :** aucune déclaration ; Loi 25, hébergement et test d'intrusion restent à faire.

## Limites
- Catégories pour aînés : elles utilisent les écrans CHSLD, avec leur nom affiché ; l'écran n'est pas encore adapté à chacune.
- Évaluations : le texte libre reste de la responsabilité du personnel ; données fictives en démo seulement.
- PWA : essayée aux formats d'écran dans Chromium, pas sur un vrai iPhone ou Android.
