# Arrimo.SH — notifications financières et pagination du portail

Cette tranche prolonge le [portail support](PORTAIL_SUPPORT_SH_2026-10-29.md). Aucun service réel, secret SMTP, profil hospitalier réel ou environnement public n'a été modifié. Les migrations décrites ci-dessous ont été appliquées aux seules bases fictives du cluster de recette.

## Résultats consolidés de la candidate figée

- **180 tests PostgreSQL/API/Chromium réussis** sur 13 suites, sans échec, annulation ou test ignoré.
- **212 tests locaux** et **75 tests Python de simulation** réussis.
- **188 fichiers JavaScript** vérifiés sans erreur de syntaxe ; `git diff --check` réussi.
- Empreinte commune aux sources, aux tests locaux et à la recette intégrée : `ff10dd1a908e84df83828bb2efe284f4f3cb3010c524c7c292020ea696005317`.
- [Résumé machine](preuves-notifications-pagination-sh-20261029/resume.json), [rapport intégré](preuves-notifications-pagination-sh-20261029/rapport-integration.json), [reproduction avant correction](preuves-notifications-pagination-sh-20261029/reproduction-avant-correction/erp.log), [empreintes des preuves](preuves-notifications-pagination-sh-20261029/empreintes.json).

Les compteurs Node incluent les tests parents. Le parcours Pilote Hôpital Test, la restauration PostgreSQL, les reprises de Go Live, les écrans aux trois largeurs et les scénarios ABC/OG ont été rejoués sur cette candidate. Le test vocal utilise toujours des moteurs simulés.

## Anomalie reproduite puis corrigée

La signature d'un contrat diffusait sa référence à tous les comptes finance, indépendamment de leur pays ou client. Une régression ajoutée au vrai parcours CRM → devis → contrat signé → facturation a reproduit la fuite : le compte « autre-client » recevait une notification alors qu'il ne devait en recevoir aucune.

Les destinataires sont maintenant sélectionnés par leurs droits effectifs : administrateurs globaux et financiers actifs affectés globalement, au pays du client ou au client lui-même. Un rôle personnalisé doit être actif et permettre la lecture des factures. Un financier affecté à un autre client, à un autre pays ou dépourvu de périmètre n'est pas destinataire.

La notification conserve l'identifiant du client. Sa lecture est réévaluée dans PostgreSQL : retirer l'affectation ou la permission de facturation masque également une notification déjà enregistrée. Les compteurs de notifications et leur marquage comme lues utilisent les mêmes politiques RLS. Les anciennes notifications financières sans identifiant client fiable sont masquées aux employés non administrateurs, plutôt que rattachées arbitrairement ou supprimées.

L'écriture passe par une fonction PostgreSQL dédiée, avec chemin de recherche fixe et droits d'exécution limités. Elle permet les notifications métier autorisées et les rappels de l'utilisateur courant ; un appel en contexte de lecture ne peut notifier un autre employé. Les services internes utilisant le propriétaire PostgreSQL conservent leur accès administratif, comme avant. Les politiques de lecture ne sont pas élargies pour permettre l'écriture.

Ces contrôles concernent les notifications de type facturation. Ils ne démontrent pas encore le respect de toutes les permissions pour chaque ancienne notification CRM, tâche, formation ou projet. La revue de ces autres flux reste à poursuivre.

## Portail client : liste complète et saisie préservée

La limite silencieuse aux 200 derniers tickets est remplacée par une pagination par identifiant, avec navigation vers les tickets plus anciens et plus récents. Le serveur conserve le filtre d'établissement et de visibilité sur chaque page, ne renvoie pas plus de 200 tickets, et fournit le prochain curseur uniquement s'il reste des résultats. Les curseurs sont validés comme entiers PostgreSQL positifs, sans arrondi JavaScript ni paramètres de requête injectés.

L'ordre par identifiant et l'index partiel correspondant évitent la pagination par décalage. Le test charge plus de 200 tickets fictifs et vérifie leur présence exactement une fois, sans ticket de l'établissement voisin. Des curseurs invalides ou répétés sont refusés.

La page conserve sa position de navigation et ses brouillons lors d'un rafraîchissement. Les réponses en cours de saisie restent dans la fiche du ticket. Les brouillons sont uniquement en mémoire, séparés par établissement et ticket, puis effacés à la déconnexion. Les réponses HTTP tardives sont ignorées si la session, l'établissement ou la requête d'affichage ont changé. Une réponse arrivée après déconnexion ne remplit plus le panneau avec des données de l'ancienne session.

Les formulaires fonctionnent aussi avec une soumission sans bouton explicite (`requestSubmit`), et les requêtes de création non JSON ne produisent pas une erreur technique du serveur.

## Migrations et validation

- **17** : sélection des destinataires financiers, périmètre client des notifications, lecture RLS et écriture contrôlée.
- **18** : index de pagination des tickets client.

La migration 17 ne remplit pas les identifiants clients des anciennes notifications à partir de leurs titres. Aucune suppression de données historiques ni migration publique n'a été exécutée. La candidate doit être livrée avec ses nouvelles fonctions PostgreSQL et l'ensemble des sources correspondantes ; le script historique de publication n'est pas utilisé.

Les régressions spécifiques couvrent le vrai envoi de notification à la signature, les refus par client/pays/rôle personnalisé, la révocation après envoi, les notifications anciennes sans client, l'écriture interdite en lecture, la pagination, la saisie FR/EN, la conservation de brouillons et une réponse réseau différée jusqu'après déconnexion.

Le rapport consolidé est valide, sans modification des sources pendant les treize suites. Les preuves des tranches précédentes restent historiques.

## Écarts encore ouverts

Restent notamment les pièces jointes, SLA contractuels, escalades, Kanban complet, OG de recherche de tickets SH et notifications de support par courriel. La confidentialité historique des autres types de notifications doit être auditée et complétée. Le change daté, les coûts/marges, les étapes détaillées des projets et plusieurs autres éléments du cahier restent ouverts dans la matrice générale.

Le microphone physique, la délivrabilité SMTP réelle, la configuration des environnements publics et le retour applicatif d'une livraison réelle n'ont pas été validés par cette tranche. Les serveurs de test sont locaux, les données sont fictives et les bases sont conservées pour inspection.

## État des environnements à la fin de cette tranche

| Environnement | État vérifié ou limite |
|---|---|
| Dépôt | Corrections et preuves présentes ; changements antérieurs préservés ; aucun commit global |
| Cluster de recette temporaire | PostgreSQL 16 dédié sur 127.0.0.1:55439 ; treize bases fictives neuves pour la recette finale, conservées |
| Serveurs HTTP de test | Fermés par les suites après exécution |
| SH, Démo ABC et environnements hospitaliers publics | Aucun déploiement, redémarrage, migration ou écriture ; santé publique non recontrôlée |
| SMTP réel | Configuration inchangée ; aucune nouvelle preuve de délivrabilité |

