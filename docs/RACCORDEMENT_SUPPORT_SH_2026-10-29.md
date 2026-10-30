# Portail support opérationnel — 29 octobre 2026

## Résultat

Le portail support est publié et raccordé aux établissements existants des deux démonstrations : **20 fiches de liaison pour l’application principale et 21 pour la Démo ABC**. La recette, actuellement vide, dispose de sa configuration distincte pour les prochains établissements créés depuis SH.

L’application principale et la Démo ABC restent deux bases indépendantes, même lorsqu’un code tel que HY existe dans les deux. SH possède désormais une cible explicite `demo_abc` en plus de `demo`. Le mode applicatif des deux démonstrations reste `demo`. Le client transmet la cible fixée dans sa configuration serveur ; un paramètre fourni par l’utilisateur ne peut pas la remplacer. Les clés support sont distinctes ; leur échange ou leur réutilisation ferme l’accès.

La migration SH **20** élargit la contrainte de cible des fiches hospitalières. Elle ne modifie aucune ancienne fiche. Les noms et pays des 41 nouvelles fiches proviennent des établissements et profils vérifiés ; les liaisons ne créent aucun établissement hospitalier, compte personnel, patient, lit ou chambre. Le raccordement écrit uniquement les fiches et traces SH. Les services conservent leur fonctionnement habituel.

Les six services existants ont été publiés sous `support-20261029t1755`. Les quatre applications hospitalières ont le même manifeste applicatif : `54b12ac67622d4811b2472d9c644f59988e46c3ee33112fcef7336c0347bc6e9`. Les autres paramètres des fichiers d’environnement ont été préservés ; seuls les paramètres préparés de raccordement et la clé API SH auparavant absente de la Démo ABC ont été ajoutés.

## Tests réellement exécutés

- **152 tests intégrés sur dix suites**, tous réussis : raccordement, portail, notifications, restauration, cycle des projets, accès, ERP, interface, parité du nouvel hôpital et API. Aucun échec, test ignoré ou annulé. Le compteur inclut les tests parents Node.
- **221 tests locaux**, tous réussis, dont quatre nouveaux contrôles de configuration des cibles.
- La création et les réponses de tickets ont été éprouvées en isolation, avec deux bases réutilisant le même code d’établissement ; les tickets, auteurs, projets et accès restent séparés.
- La révocation d’une liaison ferme l’accès ; un établissement non raccordé et une panne de service sont affichés explicitement dans l’interface FR/EN.
- Les comptes publics A, B et C se sont connectés normalement dans Chromium. Le formulaire du portail est visible dans les deux langues, la liste de tickets se lit et les accès aux établissements voisins sont refusés. **Aucun ticket de test public n’a été créé.**
- La création, l’activation et la connexion réelle du nouvel hôpital fictif ainsi que sa parité avec B ont de nouveau réussi dans la suite isolée.
- Santé et empreintes des fichiers publics vérifiées sur les six services ; cohérence locale et publique des quatre applications hospitalières confirmée.

Empreinte de sources commune aux dix suites, aux tests locaux et à la publication : `14b954e019776f9a4c504dedd743eb740b67b012bec852d121659cbff8529737`.

## Exploitation et reprise

Les sauvegardes fraîches et les copies restaurées avant livraison sont conservées sous `.local/raccordement-release-20261029t1755/`. Le plan, les configurations avant/après et les sources vérifiées restent privés sous `.local/raccordement-support-20261029/`. Une sauvegarde cohérente supplémentaire de SH et des quatre configurations modifiées a été effectuée après le raccordement ; son archive est lisible. Cette dernière archive n’a pas été restaurée à nouveau ; les restaurations de préparation l’ont été.

Les liaisons ont été inscrites dans le journal SH ; un établissement de même code dans l’autre cible n’est pas réaffecté. Aucun rôle employé n’a reçu automatiquement un périmètre supplémentaire. Les clés et sauvegardes ne sont pas publiées avec les preuves.

```bash
node scripts/verifier-coherence-applicative.cjs docs/preuves-raccordement-support-20261029/manifest-runtime.json
node scripts/recette-sh-lot1.cjs --configuration=.local/recette-isolee-20261029.env raccordement portail
```

## Suite du cahier

Cette étape clôt le raccordement du portail, pas l’ensemble du support. Restent notamment les SLA contractuels, escalades, pièces jointes, notifications par courriel, recherche de tickets SH par OG et finitions du Kanban. Les échéances standard existantes ne sont pas présentées comme des engagements contractuels validés. Les dépendances SMTP et vocales physiques restent ouvertes. Les six lots ne sont pas déclarés terminés.

Preuves : [résumé](preuves-raccordement-support-20261029/resume.json), [publication](preuves-raccordement-support-20261029/publication.json), [activation des liaisons](preuves-raccordement-support-20261029/activation.json), [contrôles publics A/B/C](preuves-raccordement-support-20261029/navigateur-public.json), [recette intégrée](preuves-raccordement-support-20261029/recette-integree.json).
