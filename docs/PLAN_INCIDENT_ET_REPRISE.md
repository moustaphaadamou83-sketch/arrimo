# Arrimo : plan d'incident et de reprise

**État : projet à valider par Moustafa, puis à faire relire par un avocat.** Il décrit ce qui existe aujourd'hui. Les délais et les personnes à compléter sont signalés. Aucune vraie donnée de patient ne doit être hébergée avant la validation de ce plan.

## 1. Responsables (à compléter)
| Rôle | Personne | Joignable |
|---|---|---|
| Responsable de l'incident | Moustafa Adamou | à compléter |
| Remplaçant | à désigner | à compléter |
| Responsable de la protection des renseignements personnels | à désigner | à compléter |
| Conseiller juridique | à désigner | à compléter |
| Contact de chaque établissement | fiche SH | fiche SH |

## 2. Niveaux
| Niveau | Exemple | Première réaction visée (à valider) |
|---|---|---|
| Critique | Fuite ou accès non autorisé, base détruite, service arrêté en production | 1 heure |
| Élevé | Fonction clé indisponible, sauvegarde en échec depuis plus d'un jour | 4 heures |
| Moyen | Défaut avec contournement | 1 jour ouvrable |
| Faible | Défaut d'affichage | Prochaine version |

## 3. Conduite d'un incident
1. **Noter** l'heure, la source et les faits, sans modifier les journaux, qui sont immuables.
2. **Contenir** : couper l'accès concerné (compte, clé de service, environnement). Un humain décide.
3. **Préserver les preuves** avant toute correction : copie de la base dans une base isolée, journaux système, `journal` et `journal_admin`.
4. **Évaluer** : quelles données, quels établissements, depuis quand.
5. **Corriger** avec un test qui prouve la correction, puis recette et publication normales.
6. **Vérifier** que le problème a disparu et remettre les accès en service.
7. **Écrire le bilan** sous 5 jours ouvrables (à valider) : cause, chronologie, mesures.

## 4. Fuite ou accès non autorisé
- Remplacer immédiatement les secrets touchés : `SH_API_KEY` et clés de SH, clés de sauvegarde, sessions, clé de chiffrement de la double authentification.
- Prévenir l'établissement concerné, qui garde ses obligations envers ses usagers.
- **Québec :** une évaluation du risque de préjudice sérieux est obligatoire. S'il existe, il faut aviser promptement la Commission d'accès à l'information et les personnes concernées, et inscrire l'incident au registre. Le partage des rôles entre Arrimo et l'établissement est **à faire confirmer par l'avocat**.
- **Autre pays :** procédure à compléter pour chaque pays avant sa mise en production, avec un conseiller local.

## 5. Reprise
| Situation | Procédure |
|---|---|
| Version défectueuse | Revenir à la release précédente, en conservant la base (`deploy/releases.sh`). La publication garde cette release prête |
| Base corrompue | Restaurer dans une base vide `arrimo_restore_*` (`deploy/restaurer-isolee.sh`), contrôler intégrité, comptes et historique, puis préparer une bascule coordonnée. `deploy/restaurer.sh` refuse volontairement toute restauration directe |
| Serveur perdu | Nouveau serveur dans le **même pays** (`deploy/installer.sh`), puis restauration depuis la copie externe |
| Lien SH coupé | Les hôpitaux continuent sur leur environnement ; SH reprend quand il le peut |

**Objectifs à valider :** reprise du service en 4 heures et perte maximale de 24 heures de données. La sauvegarde est quotidienne : promettre moins exigerait une sauvegarde continue, qui n'existe pas aujourd'hui.

**Avant la production :**
- Bucket de sauvegarde dans le pays d'hébergement.
- Exercice complet de perte de serveur, chronométré. Il n'a jamais été fait : seule une restauration de sauvegarde a été testée.
- Exercice recommencé au moins une fois par an (à valider).
- Procédure papier des établissements pendant une panne : à écrire avec eux.

## 6. Surveillance et alertes
- Chaque environnement vérifie `/api/sante` toutes les 5 minutes (`journalctl -t <nom>-surveillance`).
- **Alerte :** un message à la panne et un au rétablissement, si `ALERTE_WEBHOOK_URL` est réglée dans `/etc/arrimo/alerte.env` (root, 600). **Elle n'est pas encore réglée :** sans elle, personne n'est prévenu.
- Cette surveillance tourne sur le serveur surveillé : **elle ne voit pas la perte du serveur lui-même.** Une surveillance extérieure est à ajouter avant la production.
- Non surveillés à ce jour par une alerte : échec d'une sauvegarde, certificat proche de l'expiration, disque plein.
