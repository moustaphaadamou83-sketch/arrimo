# Publication OG — A, B, C et coordination régionale

> Historique de la première publication. Le [suivi interhospitalier corrigé est publié et vérifié](PUBLICATION_OG_SUIVI_2026-10-26.md).

Périmètre confirmé par le titulaire : `hopital.a@demo.arrimo`,
`hopital.b@demo.arrimo`, `hopital.c@demo.arrimo`, `reseau@demo.arrimo`.
Aucun compte D n’est utilisé pour publier. Aucun compte hébergé, droit ou mot de passe
n’est créé ou modifié.

Le compte régional doit être gestionnaire ; ses établissements visibles sont
comparés aux établissements actifs retournés par PostgreSQL. Les comptes A/B/C
restent chacun limités à leur établissement. Le contrôle régional compare aussi
l’occupation de chaque établissement actif doté du module à PostgreSQL. La copie
de cette exécution contient 21 établissements actifs ; les comptes hospitaliers
autorisés restent A/HX, B/HY et C/HC.

Lot : `/root/arrimo-og-publication-abc-reseau-20261026`.
Archive SHA-256 : `7edbb4afa136eb5aa0f1bd54cc417c1dd44164b12e984dfaf687228f1b080860`.
Rapport privé : `/root/arrimo-og-publication-20261026T202806Z_bdad528b/rapport.json`.

Préparation réellement validée : connexions normales et droits A/B/C/réseau,
sauvegarde de Démo, restauration identique, scénarios OG sur la copie restaurée,
comparaison attestant que ces scénarios n’ont pas modifié cette copie.

Les tests PostgreSQL ciblés sur une base neuve ont également validé les comptes
autorisés, y compris la situation C sans lit occupé. Le mot de passe fourni n’est
inclus ni dans les sources, ni dans l’archive, ni dans les preuves exportées.

## Résultat final réel

**Publication effectuée et vérifiée sur https://demo.arrimo.senseafri.com.**
Le rapport indique `statut=publication_verifiee`, `publication_verifiee=true`,
`environnements.demo.statut=publie_et_verifie`.

- 152 tests locaux et 21 tests de garde-fous réussis.
- 154 tests dans les 13 suites intégrées réussis, aucun échec, ignoré ou annulé.
- Exercice de retour arrière réussi avant bascule.
- Sessions A/B/C/réseau renouvelées normalement avant publication.
- Après bascule : santé HTTPS et PostgreSQL OK ; sept scénarios OG et panneau
  navigateur validés pour chacun des quatre comptes ; périmètre régional et
  occupation des établissements autorisés comparés à PostgreSQL.
- Compte C sans lit occupé : absence de patient admis contrôlée, sans ajout de données.
- Pointeur actif et empreintes des deux fichiers runtime revérifiés après le lanceur.

La liaison SH pointe hors de la cible Démo retenue et n’a pas été appelée.
La Production n’a pas été interrogée ni modifiée. Aucune migration, remise à zéro
ou restauration SQL n’a été appliquée à la base hébergée. Les sauvegardes,
anciennes releases et bases de recette sont conservées.

Les preuves finales exportées sont dans
`docs/preuves-og-reprise-20261026/publication-abc-reseau/`.

Release active : `releases/arrimo-og-20261026T202806Z_bdad528b`.

Santé publique contrôlée à `2026-10-26T20:45:09.201Z` (UTC), latence SQL 3 ms.

Sauvegarde : `/root/arrimo-og-publication-20261026T202806Z_bdad528b/sauvegarde-demo`.

Retour applicatif préparé : `/root/arrimo-og-publication-20261026T202806Z_bdad528b/retour-demo.sh`. Ce script conserve les données métier et contrôle à nouveau le périmètre Démo.
