# OG — recherche des tickets SH

## Fonction livrée dans le code

La console Support propose une recherche locale en lecture seule par mots clés ou référence. Elle renvoie au plus dix tickets accessibles à l’utilisateur. L’indexation PostgreSQL porte sur les champs de recherche du ticket; la synthèse retournée n’expose que sa référence, son état, sa priorité, son établissement et son responsable. Les messages, événements internes et pièces jointes ne sont jamais inclus.

La route `POST /support/og/recherche` est réservée aux rôles administration, support et implantation. La politique RLS `sh_scope_ticket` filtre les résultats selon le périmètre SH actif. La requête est paramétrée et la recherche est limitée à 160 caractères.

Cette version est une recherche et une synthèse factuelle locale. Elle n’appelle pas de modèle génératif et ne répond pas aux questions sémantiques libres. Elle n’envoie aucune donnée de ticket à un fournisseur externe.

## Vérification

Recette portail isolée du 29 octobre 2026 : 12 tests réussis, dont recherche d’un ticket par un agent du support, exclusion d’un ticket d’un autre établissement, absence d’une phrase confidentielle de la description dans la réponse, refus des recherches trop courtes et navigation navigateur bilingue existante.

Empreinte source vérifiée par la recette finale : `cab67d965da263bc803c1288d366380d5a296323a0efaf04b64e0bcd1ae1787e`.

## Publication

Inclus dans la release finale publiée le 29 octobre 2026 aux six services : `support-calendrier-20261029t2125`, empreinte candidate `cab67d965da263bc803c1288d366380d5a296323a0efaf04b64e0bcd1ae1787e`. Les six contrôles de santé API et base sont OK; configurations préservées; 26 assets vérifiés par service hospitalier et 14 assets par service SH. Rapport complet et sauvegardes : `.local/support-calendrier-release-20261029t2125/rapport.json`.
