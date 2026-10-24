# Arrimo — rapport de déploiement et de démonstration finale (25 octobre 2026)

## Versions réellement déployées
| Environnement | Version active | Précédente (retour arrière) | État |
|---|---|---|---|
| demo.arrimo.senseafri.com (démo A/B/C) | `arrimo-fin-2ed912745f6338e185c8c31bd0cb97385a9fce1d` | `arrimo-audit-9a67e96…` | **Déployée** le 24 oct. 23 h 56, santé OK |
| arrimo.senseafri.com (principal) | `arrimo-audit-9a67e96…` (inchangée) | `f6db0e021698` | **En attente** : déploiement réservé à votre approbation |
| sh.arrimo.senseafri.com (SH) | inchangée | — | Aucune modification nécessaire |

Code : branche `finalisation-27oct` (/root/arrimo-sh-erp), archive et empreinte sha256 dans /root/arrimo-sh-erp-releases.

## Phase 1 — démo A/B/C
- Sauvegardes : `/var/backups/arrimo-finalisation-…-20261024T215416Z.dump` et `…T215610Z.dump` (juste avant la bascule), lisibles (`pg_restore --list`), **restauration réelle testée** sur une copie.
- Migration répétée deux fois sur une copie restaurée : données identiques ; droits du rôle applicatif vérifiés.
- Déploiement : schéma appliqué, comptages et empreintes identiques avant/après, bascule atomique, santé OK, jeu pédiatrique ajouté (centre pédiatrique, unités pédiatriques de C, noms A/B alignés, congé de MED-204A).
- Données fictives existantes conservées. Remarque : l'état actuel de A (54 lits libres sur 56) vient de 129 actions faites avec le compte hopital.a le 24 oct. vers 21 h, **avant** le déploiement (déjà présent dans la sauvegarde) ; ce n'est pas un effet de la mise à jour.

## Phase 4 — parcours manuel dans le navigateur (21/21, 0 erreur JavaScript)
Code réellement déployé, exécuté sur une **copie de la base publique** (mots de passe de test sur la copie seulement ; aucun compte public modifié). Captures : `captures-pub/`.

| | Étape | Preuve |
|---|---|---|
| ✔ | Arrivée aux urgences de B, patient fictif placé sur civière avec demande de lit | P-01004 sur URG-03 |
| ✔ | Admissions : lit adapté assigné (lit réservé) | MED-207B |
| ✔ | Lits : admission depuis la fiche Lit → demande admise, lit occupé, civière au nettoyage | {"statut":"admise","etat":"occupe","civ":"nettoyage"} |
| ✔ | Nettoyage : civière nettoyée, de nouveau libre | URG-03 |
| ✔ | Congé de MED-204A confirmé depuis la fiche Lit | Sun Oct 25 2026 19:00:00 GMT+0100 (Central European Standard Time) |
| ✔ | Congés et alertes : MED-204A listé « Confirmé » demain, avec disponibilité estimée | MED-204A — Médecine 204 Occupé 25 oct., 14 h 00 Confirmé — Oui 25 oct., 14 h 45 estimation : congé confirmé + durée cible de nettoyage Saisie Arrimo 24 oct., 17 h 58 · Coordination Hôpital A |
| ✔ | OG retrouve le congé confirmé de MED-204A | OG / Lit MED-204A (Médecine, chambre 204) : occupé depuis 0 min · patient P-99508. / • Congé confirmé pour demain à 14 h 00. |
| ✔ | NSA : désignation (orientation réadaptation) visible dans l’onglet NSA | SI-104 |
| ✔ | Transfert A → B demandé depuis Réseau, lit de B réservé | TR-00066 |
| ✔ | Transfert TR-00066 accepté, chambre prête, transport, départ, reçu ; lit de B occupé | {"statut":"recu","etat":"occupe"} |
| ✔ | B refuse TR-00067 avec un motif | TR-00067 |
| ✔ | OG explique le refus de B et la proposition | Établissement proposé maintenant : Hôpital C — Sainte-Aurore — Recommandé : le plus proche avec un lit adapté. / • Hôpital C — Sainte-Aurore — rang 1 (proposé) : 1 lit(s) confirmé(s), niveau vert, 10 min de route (7.2 km |
| ✔ | Nouvelle demande vers C (TR-00068) acceptée par C | TR-00068 |
| ✔ | Recherche pédiatrique : lits adultes écartés et expliqués | Lits écartés : 6 pour le groupe d’âge |
| ✔ | Soins intensifs pédiatriques : seul le centre pédiatrique est proposé | Centre pédiatrique des Érables (fictif) Recommandé |
| ✔ | OG : « Quel est l’état actuel de mon hôpital ? » | Hôpital A — Val-des-Pins est au niveau ORANGE (pression 4 % : lits occupés + patients en attente, rapportés aux lits en service). / • Lits : 54 libres (0 confirmés), 0 réservés, 2 occupés, 0 en nettoyage, 0 hors service. |
| ✔ | OG : « Quels lits vont se libérer aujourd’hui ? » | Aucun congé enregistré aujourd’hui. Un lit n’apparaît ici que si un congé a été saisi. /  |
| ✔ | OG : « Quelles alertes bloquent le fonctionnement de notre unité ? » | Alertes actives (58), les plus bloquantes d’abord : / • [jaune] Civière URG-03 — P-32533 présent depuis 38 h 13, sans demande de lit. |
| ✔ | OG : « Est-ce qu’on sera saturés ce soir ? » | Non, probablement pas d’ici 4 h. Prévision par type d’unité : / • Soins intensifs : 8 lits libres prévus (± 1) |
| ✔ | OG : « Combien de civières sont occupées dans le corridor ? » | Urgence de Hôpital A — Val-des-Pins : 22 civières occupées sur 17 en service (129 %), dont 6 en corridor ; 1 civières libres, 0 en nettoyage. / 4 patients depuis plus de 24 h, 0 depuis plus de 48 h ; 0 ont une demande de |
| ✔ | OG : « Quelles demandes de transfert attendent une réponse ? » | Aucune demande reçue en attente de votre réponse. / Aucune de vos demandes n’attend de réponse. |

## Phase 2 — Arrimo principal (préparé, répété, non déployé)
- Compatibilité : tables détenues par le rôle `arrimo` ; le script applique désormais le schéma avec ce rôle pour que la remise à zéro nocturne puisse supprimer et recréer les nouvelles tables.
- Répétition sur copie restaurée : migration ×2, données identiques ; nouvelles tables détenues par `arrimo` ; **remise à zéro nocturne avec le nouveau code réussie** (20 hôpitaux, 754 lits, 60 transferts, 27 tables) — elle exige le routeur OSRM, ajouté par l'étape 01.
- Deux commandes à lancer ensemble (voir le message), avant 04:00 de préférence.

## Phase 3 — SH
SH ne code pas les colonnes des lits ni les catégories : modèles et imports passent par l'API de l'environnement Arrimo visé. Après le déploiement d'Arrimo principal, SH prend en charge sans modification `groupe_age`, les civières d'isolement, pédiatriques et les fauteuils, ainsi que l'activation des spécialités et modules (routes API ; pas encore d'écran dédié dans la console).

## Tests
API 81/81 · scénarios A/B/C 7/7 (38 étapes) · démo A/B/C 4/4 · parcours navigateur 21/21 · OG 22 questions sans échec.

## Limitations restantes
OG en langage libre en français seulement ; pas d'écran SH pour modules/spécialités ; aucune intégration hospitalière réelle ; compatibilité clinique à valider ; mots de passe publics non connus de Claude (vérification connectée faite sur copie) ; démo A/B/C actuellement peu chargée à A (voir remise à neuf facultative).
