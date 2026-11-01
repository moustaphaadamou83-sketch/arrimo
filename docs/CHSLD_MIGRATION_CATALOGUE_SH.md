# Migration SH n° 37 : catalogue des modules (1er novembre 2026)

## Pourquoi une exception au contrôle de publication
Le contrôle de publication (`scripts/publication/controle.cjs`) refuse toute modification des données existantes d'une base SH.
La migration 37 doit **ajouter** au catalogue `sh_modules_catalogue` les modules des types d'établissement (hôpital, CHSLD, optionnels) pour permettre la création des CHSLD depuis SH.
Exception autorisée par Moustafa le 1er novembre 2026, limitée ainsi :
- une seule table : `sh_modules_catalogue`, et seulement pour une base SH ;
- une **liste fermée** de 20 codes (`AJOUTS_CATALOGUE_SH`) : tout autre ajout est refusé ;
- chacune des lignes existantes doit rester identique sur toutes ses colonnes d'origine : aucune modification, suppression ni renommage ;
- toutes les autres tables, ainsi que les séquences, restent sous le contrôle strict.

Le test `tests/publication-cibles.test.cjs` vérifie que cette liste correspond exactement aux 20 nouveaux modules de `src/types-etablissement.js`.

## Les 6 modules existants (inchangés)
| Code | Nom | Dépendances |
|---|---|---|
| lits | Gestion des lits | — |
| civieres | Gestion des civières (affiché « Urgence et civières ») | — |
| transferts | Transferts interhospitaliers | lits |
| og | OG | lits, transferts |
| notifications | Notifications | — |
| rapports | Rapports et statistiques | — |

La migration leur ajoute seulement de **nouvelles colonnes** (catégorie, types, statut, ordre, nom anglais, note), sans réécrire leurs valeurs d'origine.
Une dépendance qui n'existe pas dans le catalogue d'un type d'établissement est ignorée à la lecture (`src/sh/app.js`). Par exemple, OG reste inclus pour un CHSLD sans exiger les lits ni les transferts hospitaliers.

## Les 20 modules ajoutés
| Code | Catégorie | Types | Statut | Dépendances |
|---|---|---|---|---|
| comptes | commun | hôpital, CHSLD | inclus | — |
| documents | commun | hôpital, CHSLD | inclus | — |
| support | commun | hôpital, CHSLD | inclus | — |
| journal | commun | hôpital, CHSLD | inclus | — |
| parametres | commun | hôpital, CHSLD | inclus | — |
| admissions_hopital | hôpital | hôpital | inclus | — |
| nsa | hôpital | hôpital | disponible | — |
| nettoyage | hôpital | hôpital | disponible | — |
| national | hôpital | hôpital | disponible | — |
| residents | CHSLD | CHSLD | inclus | — |
| chambres | CHSLD | CHSLD | inclus | — |
| demandes_hebergement | CHSLD | CHSLD | disponible | residents |
| entretien_chsld | CHSLD | CHSLD | disponible | — |
| taches | CHSLD | CHSLD | disponible | — |
| proches | CHSLD | CHSLD | disponible | residents |
| hospitalisations | CHSLD | CHSLD | disponible | residents |
| reseau_chsld | CHSLD | CHSLD | disponible | residents |
| portail_proches | optionnel | CHSLD | disponible (désactivé par défaut) | proches |
| messagerie_securisee | optionnel | CHSLD | disponible (désactivé par défaut) | portail_proches |
| appels_video | optionnel | CHSLD | à l'étude (jamais souscriptible) | — |

## Essais sur des copies isolées de la base SH (restaurations `arrimo_publication_restore_sh_*`)
- Premier passage : version 36 → 37 ; le catalogue passe de 6 à 26 lignes ; les 20 ajouts sont exactement ceux de la liste ; données et séquences préservées.
- Deuxième passage : aucun ajout, aucun changement (migration **idempotente**).
- Essai négatif : un module hors de la liste est **refusé** ; la transaction est annulée et la copie reste en version 36 avec 6 lignes.

## Sauvegarde et retour arrière
- Avant la migration, l'outil de publication fait une sauvegarde `pg_dump`, en vérifie l'empreinte et la restaure dans une copie isolée identique. La migration y est d'abord jouée deux fois, puis l'ancien et le nouveau code y sont essayés.
- La migration en ligne s'exécute dans une seule transaction : en cas d'échec, rien n'est modifié.
- **Retour arrière** : remettre la release précédente (`/opt/arrimo-sh/releases/correction-20261031t2045`) et restaurer la sauvegarde de préparation avec `pg_restore`. Les colonnes et lignes ajoutées n'ont aucun effet sur l'ancien code ; la restauration n'est donc nécessaire que pour revenir exactement à l'état d'avant.
