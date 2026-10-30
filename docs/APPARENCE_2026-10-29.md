# Apparence claire, sombre, automatique et solaire — Arrimo hospitalier et console SH — 29 octobre 2026

Exigence : cahier « Paramètres » (section Apparence : thème clair/sombre, préférences d'affichage), demande du propriétaire du 29 octobre.

## Fonctionnement

- Quatre modes par utilisateur : **Clair**, **Sombre**, **Automatique** (préférence du système d'exploitation, mise à jour en direct) et **Selon le soleil** (sombre entre le coucher et le lever du soleil).
- La préférence est **enregistrée sur le serveur** :
  - SH : `sh_utilisateurs.apparence`, migration 28, journalisée ;
  - hospitalier : `utilisateurs.apparence`, colonne ajoutée par `db/schema.sql`.
  Elle s'applique à toutes les pages du compte, sur tous ses appareils. Un cache local l'applique dès le chargement, sans éclair blanc. Les autres comptes ne changent pas.
- Mode soleil :
  - côté hôpital, il utilise les **coordonnées de l'établissement**, déjà connues : aucune géolocalisation ;
  - côté SH, il demande la position de l'appareil avec le consentement du navigateur. Elle est arrondie à environ 10 km et gardée sur l'appareil seulement. Sans position, la préférence du système s'applique.
- Le calcul solaire utilise l'équation solaire standard, sans service externe. Contrôles : Montréal 5 h 05 / 20 h 46 (21 juin) et 7 h 31 / 16 h 13 (21 décembre) ; Sydney 7 h 00 / 16 h 54 (21 juin) ; jour polaire au Svalbard.
- Où le régler :
  - hospitalier : menu Compte → Apparence ;
  - SH : Mon compte → Apparence, avec un raccourci depuis Paramètres.

## Charte

- Identité conservée : bleu-vert professionnel `#0E5E6F` pour les aplats (barre, boutons principaux), blanc, nuances de bleu foncé pour les fonds sombres (`#0B1820`, `#11222C`, `#173040`). En sombre, la couleur principale devient `#7FCBD8` pour le texte et les liens.
- Les couleurs de statut gardent leur sens (vert, ambre, rouge, bleu info), avec des nuances claires pour le texte sur fond sombre.
- Les couleurs codées en dur (style, console, Copilote, OG vocal) sont passées en jetons `--th-*` avec la couleur d'origine en repli. **Le mode clair est identique** (vérifié par comparaison des feuilles de style). Les aplats et le texte utilisent deux jetons distincts : `--principal-plein` et `--principal`.

## Limites

- Les tuiles de carte (OpenStreetMap) restent claires en mode sombre.
- Les PDF (devis, factures, rapports) restent en clair, ce qui est voulu pour l'impression.

## Validation et publication

- Recette `.local/preuves-sh-lot1/20261030001627_3d83e0/`, empreinte `3d4ce0b566f5d23d55a4813b25aed0fbc32daf0b92be4bb986a7e5b95b0f918e`, 14 suites, 187 tests, aucun échec :
  - SH : ERP 23, accès 28, interface 1 (trois largeurs, avec contrôle de contraste AA de chaque onglet en sombre), parité 8, cycle 6, restauration 1, notifications 8, portail 12, raccordement 6, SLA 8 ;
  - hospitalier : API 66, interface 12 (guide complet, anglais, console SH, et apparence sombre, automatique et soleil aux trois largeurs avec contrastes AA), structure 1, scénarios A/B/C 7.
- Corrigé en recette :
  - texte rouge des boutons de suppression illisible en sombre (jeton `--critique-lien`) ;
  - bouton « Refuser » à 4,45:1 sur téléphone après appui (défaut antérieur, état survolé) ;
  - client canadien sans province dans un test API (bloqué à raison par la fiscalité) ;
  - attentes inutiles de 30 s dans le test de la console SH ; la lenteur était antérieure à cette tranche, ce qui a été vérifié sur une copie sans les modifications.
- La recette accepte désormais un délai propre à la suite hospitalière (45 min) et un filtre de diagnostic. Un rapport filtré est marqué `diagnostic_filtre` et ne vaut jamais preuve.
- Publication `apparence-20261030t0046` sur les six services : santé `ok`, ressources vérifiées (27 et 14), configurations inchangées, scénario A/B/C préservé. Tous les comptes existants restent en « automatique ». Rapport : `.local/apparence-release-20261030t0046/rapport.json`.
