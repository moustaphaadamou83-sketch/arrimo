# Notifications courriel du support SH — 29 octobre 2026

Les événements de support alimentent maintenant une file transactionnelle : nouveau ticket client, message client, pièce jointe, réponse publique du support, changement de statut visible par le client et attribution à un membre du support. Le traitement périodique n’envoie rien sans transport actif; il reprend les erreurs avec délai progressif, jusqu’à huit tentatives. Les erreurs enregistrées sont des codes techniques seulement.

Les courriels ne contiennent que la référence, le statut et une consigne de connexion. Ils n’incluent ni sujet, ni description, ni message, ni données cliniques. Les notifications internes applicatives continuent de fonctionner indépendamment de SMTP. Le transport existant `src/courriel.js` est réutilisé. La configuration SMTP et l’expéditeur sont présents dans l’environnement SH; aucun secret n’est consigné ici.

Migration 23 : file `sh_support_courriels`, politique RLS par ticket et index de reprise. La file n’est pas exposée par l’API de l’application. À la vérification après publication, les bases SH et SH-validation sont en version 23 et leurs files sont vides.

## Tests et limites

- Recettes isolées : portail 11/11, SLA 8/8, accès 27/27, activation/parité 8/8 et raccordement 6/6, soit **60 tests intégrés réussis** sur une empreinte identique.
- Transport générique : 1/1 test sans connexion réseau.
- Le test du support utilise un transport simulé et vérifie l’absence du titre/de la description, la reprise après erreur et l’écriture dans la file.
- Après publication, un courriel de test sans donnée métier a été accepté par le relais SMTP; le destinataire autorisé a confirmé la réception.

## Publication

La release `courriels-support-20261029t1930` est publiée sur principal, ABC, recette, validation, SH et SH-validation. Tous les services sont sains après bascule; les 26 assets hospitaliers et les 14 assets SH sont vérifiés par empreinte. Les sauvegardes fraîches et restaurations de clones sont conservées dans les preuves. Les configurations d’environnement sont préservées.

Preuves : [rapport de recette](preuves-courriels-support-sh-20261029/recette-consolidee.json), [rapport de publication](preuves-courriels-support-sh-20261029/publication.json) et journaux détaillés du portail, des SLA, de l’accès, de la parité et du raccordement.

## Reste du cahier support

La recherche OG SH, la colonne « Assigné », les calendriers ouvrés et les taux de conformité SLA sont maintenant livrés; voir [la recette et la publication SLA](SLA_ESCALADES_SH_2026-10-29.md).
