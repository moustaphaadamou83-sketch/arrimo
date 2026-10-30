# Paramètres modifiables et suppression d'un employé — console SH, migration 29 — 30 octobre 2026

Exigences : cahier « Paramètres, administration et gestion des accès », §1 (chaque paramètre a une valeur effective, une validation et des permissions) et §6 (désactiver, archiver, supprimer), EX-426.

## Paramètres modifiables

Table `sh_parametres`, nouvelle. **Valeur effective** : celle enregistrée dans la console, sinon la configuration du déploiement, sinon la valeur par défaut. La page Paramètres indique la source de chaque valeur.

| Paramètre | Validation | Effet |
|---|---|---|
| Nom, adresse, courriel, numéros de taxes de l'émetteur | 2–160, 0–300, courriel valide, 0–200 caractères | en-tête des devis, contrats et factures PDF |
| Durée de session | entier de 1 à 12 heures | sessions ouvertes ensuite |
| Conservation avant suppression d'un compte archivé | entier de 0 à 3 650 jours | condition de la suppression définitive |

- Seule l'administration peut modifier ; chaque modification est journalisée (« Paramètre SH modifié »).
- Une clé inconnue est refusée (404). **Aucun secret n'est modifiable ni affiché** : clés, base et SMTP restent dans la configuration serveur.

## Suppression définitive d'un employé

1. **Archiver** : accès coupé, historique conservé (existait déjà).
2. **Demander la suppression** : motif d'au moins 10 caractères, compte archivé obligatoire, journalisée.
3. **Supprimer définitivement**, seulement si :
   - une demande existe ;
   - la politique de conservation est configurée ;
   - le délai depuis l'archivage est écoulé ;
   - la confirmation saisie est exactement `SUPPRIMER <courriel>`.
4. Effet de la suppression :
   - le nom, le courriel, la fonction, le mot de passe et le secret MFA sont retirés (nom « Ancien membre n° X », courriel non routable) ;
   - les sessions, liens de récupération et invitations sont révoqués ;
   - **l'identifiant est conservé**, si bien que les tâches, tickets, projets et journaux qu'il a créés restent traçables, comme l'exige le cahier ;
   - le journal n'est jamais effacé ;
   - un compte supprimé ne peut être ni restauré ni réarchivé.

## Limites

- Les autres sections du cahier (Modules, Intégrations, Projets, Documents, Notifications, Sauvegardes, OG) ont leurs écrans propres dans la console ou restent gérées par la configuration du déploiement. Elles ne sont pas encore regroupées dans Paramètres.
- La suppression vise les comptes de l'équipe SH, pas les comptes hospitaliers.

## Validation et publication

- Recette `.local/preuves-sh-lot1/20261030023418_b28f2a/`, empreinte `9a3d0369900bce6c6c327a1b52146331749b98425ed79bf4df7417273a6f232d`, 16 suites, 209 tests, aucun échec (dont OG 21 et OG base 1).
- Cas testés :
  - paramètre refusé hors administration (403), hors bornes (400), clé inconnue ou secret (404), courriel invalide ;
  - source « base » prioritaire ; durée de session de 2 h vérifiée en base sur une vraie connexion ;
  - suppression refusée sans archivage, sans demande, sans politique de conservation, avant le délai, ou avec une confirmation erronée ;
  - après suppression : données personnelles retirées, sessions révoquées, journal conservé, restauration refusée, connexion impossible.
- Corrigé en recette, hors périmètre de la tranche : une modification OG concurrente avait laissé une **erreur de syntaxe** dans `src/og-suivi.js`. Elle provoquait une erreur 500 dans le parcours OG. Elle a été bloquée avant publication et corrigée ; son test a été aligné sur la typographie française.
- Publication `parametres-20261030t0259` sur les six services : santé `ok`, ressources vérifiées, configurations inchangées, scénario A/B/C préservé, SH en version 29. Rapport : `.local/parametres-release-20261030t0259/rapport.json`.
