# SLA contractuels et escalades — 29 octobre 2026

La migration SH **24** et la release `support-calendrier-20261029t2125` sont publiées sur les six services. Les versions, interfaces et configurations restent cohérentes. La recette finale vérifie la parité A/B, l’ERP, le portail et les horaires ouvrés; aucun SLA contractuel ni ticket de test n’a été créé dans les bases publiques.

## Fonctionnement livré

L’administration configure une version de SLA pour un établissement en choisissant explicitement un contrat signé, en vigueur et lié à cet établissement. Les quatre priorités ont chacune un délai de prise en charge, un délai de résolution et un délai d’escalade après dépassement. Le calendrier est configurable en temps continu (valeur par défaut) ou en heures ouvrées avec jours actifs, ouverture, fermeture et jours fériés. En mode ouvré, le fuseau de l’établissement est appliqué. Le délai de résolution ne peut précéder la prise en charge.

Une seule version peut être active par établissement. Chaque enregistrement crée une nouvelle version ; les anciennes règles restent immuables. Une version attendue et un verrou d’établissement protègent des modifications concurrentes. La désactivation ferme l’application aux futurs tickets sans réécrire les tickets existants.

Les nouveaux tickets internes et clients prennent le même instantané de règles et calendrier dans PostgreSQL. La modification d’un SLA ne change ni les engagements ni les échéances des tickets déjà ouverts. Un contrat expiré ou résilié ne fournit pas de SLA aux nouveaux tickets. Sans SLA applicable, le ticket conserve les délais standards de prise en charge ; aucune durée de résolution contractuelle n’est inventée.

La migration ne reprend pas automatiquement les anciens tickets. Leurs anciennes colonnes et échéances sont préservées. Un changement explicite de priorité sur un ancien ticket initialise le suivi standard. Pour un ticket suivi, la nouvelle priorité réutilise les règles de son instantané et le même point de départ. Une réouverture démarre une nouvelle génération et un nouveau délai, en conservant l’ancien historique et la version de règles initiale.

La prise en charge est explicite ou constatée lors du passage à un état de traitement. Les messages et leur mise à jour de statut sont atomiques. Une prise en charge déjà enregistrée ne peut pas être antidatée ou effacée par une mise à jour ordinaire.

## Escalades et droits

Le service SH vérifie les échéances au démarrage puis chaque minute par défaut (`SH_SLA_MINUTES`, zéro pour désactiver). Le contrôle manuel est disponible aux rôles autorisés. Le traitement travaille par lots de 100 tickets, avec verrous `SKIP LOCKED` et unicité par ticket, génération et phase. Les lignes déjà traitées sont exclues des lots suivants.

Les escalades de prise en charge et de résolution sont distinctes. Le destinataire configuré doit disposer de l’accès effectif au support de cet établissement. Ses droits sont réévalués lors de chaque escalade ; s’ils ont été retirés, le contrôle se replie sur les administrateurs actifs autorisés. Sans destinataire autorisé, aucune notification n’est envoyée et le dépassement reste éligible à un contrôle ultérieur. Les compteurs et lectures de notifications continuent d’appliquer les politiques RLS existantes.

Les escalades sont des **notifications internes** et des événements de ticket. Les rapports affichent les taux de prise en charge et de résolution avec leurs dénominateurs éligibles; l’export CSV inclut échéances, temps réalisés et respect des cibles. Les pénalités contractuelles et pauses ne sont pas implémentées. Le traitement périodique et les lots ne constituent pas une promesse de notification à la seconde exacte.

L’écran Support permet la configuration des versions, la prise en charge et le contrôle manuel des escalades. La fiche affiche les échéances distinctes et l’historique. Le portail client reçoit les échéances utiles, sans exposer les règles internes complètes ni les données financières du contrat.

## Validation et publication

- **Cinq suites PostgreSQL/API/Chromium réussies au SHA publié** : SLA (8), ERP (21), portail (12), parité réelle (8) et interface (un parcours sur ordinateur, tablette et téléphone).
- **224 tests locaux réussis**, dont trois nouvelles régressions de validation des règles.
- Les tests SLA couvrent contrats étrangers et non signés, destinataires hors périmètre, version concurrente périmée, création interne/client, conservation des instantanés, modifications directes, concurrence des contrôles, dédoublonnage, réouverture, révocation et lot de plus de 100 tickets. Les dépassements sont exercés avec une horloge de contrôle injectée au moteur de test ; l’API publique ne permet pas de fournir cette horloge.
- Le formulaire de calendrier SLA et sa traduction anglaise ont été exercés dans Chromium. Les calculs ouvrés reprennent le temps restant après fermeture et excluent les jours fériés.
- La création et la connexion du nouvel hôpital ainsi que sa parité avec B ont été rejouées avec succès.
- Le nettoyage des fixtures a été corrigé pour retirer les nouvelles tables et fonctions, après un défaut réel détecté par les réinitialisations successives. Les garde-fous des noms de bases de test restent en place.
- Sauvegardes fraîches et restaurations sur copies avant publication ; comparaison des anciennes colonnes et compteurs pendant les migrations. Santé et fichiers publics des six services vérifiés. Configurations et clés de raccordement préservées.
- Contrôle après publication : migration 24 déployée, configurations préservées et assets vérifiés sur les six services.

Empreinte commune des sources, tests et publication : `cab67d965da263bc803c1288d366380d5a296323a0efaf04b64e0bcd1ae1787e`.

Les sauvegardes fraîches, restaurations, configurations et rapport restent sous `.local/support-calendrier-release-20261029t2125/`.

## Suite

Un unique courriel SMTP de test, sans donnée métier, a été accepté par le relais et sa réception a été confirmée. Les validations vocales physiques et les fonctions avancées restantes du cahier demeurent ouvertes.

Preuves : [résumé](preuves-sla-support-20261029/resume.json), [recette intégrée](preuves-sla-support-20261029/recette-integree.json), [publication](preuves-sla-support-20261029/publication.json), [cohérence](preuves-sla-support-20261029/coherence-applicative.json), [portail public](preuves-sla-support-20261029/navigateur-public.json).
