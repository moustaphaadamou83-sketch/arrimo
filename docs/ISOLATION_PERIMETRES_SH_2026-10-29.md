# Isolation des périmètres SH — recettes du 29 octobre 2026

Recettes rejouées sur des bases fictives neuves avec l’empreinte publiée `a8cefe3de8e536a577f2058a78401266864d83eec028673d91b3e365d8ac2a1d`.

## Résultats

- ERP : 21/21. Les routes CRM, contrats, factures, projets, documents, support, équipes et rapports respectent leurs rôles; les documents sont filtrés par catégorie et leurs fichiers chiffrés.
- Cycle projets : 6/6. Archivage en lecture seule, restauration, suppression ciblée, révocation des accès, conservation de l’établissement voisin et de l’historique.
- Notifications : 8/8. Portées pays/client/projet/hôpital, rôle personnalisé, révocation immédiate, historiques et acquittements contrôlés.
- Accès : 28/28 lors de la livraison de la migration 25, dont RLS par projet, pays, client et hôpital, accès refusés aux projets voisins et tests directs d’écriture PostgreSQL.
- Parité établissement : 8/8 lors de cette même livraison, avec connexions réelles et OG français/anglais.

Les trois nouvelles recettes ERP, cycle et notifications utilisent des bases isolées et leurs rapports indiquent `valide`, sans modification de données publiques. Les sources correspondent à la release `preferences-fuseau-20261029t2136`; il n’y avait donc pas de nouveau binaire à publier après ces contrôles.

## Limites

Ces contrôles couvrent les périmètres applicatifs et le rôle PostgreSQL restreint. Ils ne démontrent pas une séparation physique des bases entre clients ni une revue exhaustive de tous les réseaux internationaux. Les tables de comptes, invitations, catalogues globaux et supervision restent des ressources internes SH avec des routes protégées par la matrice de rôles; elles ne sont pas des données de client.

Rapports détaillés :

- `.local/preuves-sh-lot1/20261029214447_fe7dfc/rapport.json`
- `.local/preuves-sh-lot1/20261029214550_11488b/rapport.json`
- `.local/preuves-sh-lot1/20261029213606_407f43/rapport.json`
