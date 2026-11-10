# Arrimo Famille : comptes créés par les proches (10 novembre 2026)

Décision de Moustafa (10 nov. 2026) : un proche peut créer son compte lui-même, puis demander à être rattaché à un résident (CHSLD ; les mêmes écrans serviront aux RPA, RI, RTF et maisons des aînés quand ces types seront ouverts). Démo et recette seulement, comme tout le portail.

## Règles appliquées
1. **Compte** : courriel + mot de passe robuste, avis de confidentialité accepté, courriel confirmé par lien (24 h, usage unique, empreinte seulement). Blocage après 5 échecs (15 min). Mot de passe oublié par lien (1 h). Au plus 3 courriels par heure et par compte ; au plus 20 appels par 15 min et par adresse IP.
2. **Demande** : établissement (seulement ceux qui ont activé le portail), prénom et nom du proche, téléphone facultatif, nom du résident, lien, représentant légal ou non, code facultatif, déclaration de consentement.
3. **Rien n'est visible avant la validation.** Réponse identique (contenu et durée) que le résident existe ou non ; aucune recherche de résident côté proche ; aucun rapprochement automatique sans code. Inscription et mot de passe oublié : même réponse, que le courriel soit inscrit ou non ; le titulaire est prévenu par courriel.
4. **File « Demandes de rattachement »** à l'accueil de l'établissement, pour les rôles qui invitent déjà les proches (coordination, administration de l'établissement, gestion). Le personnel choisit le résident, la méthode de vérification d'identité (obligatoire), le consentement (résident, représentant légal, mandataire, tuteur, curateur ; par qui, à quelle date), les autorisations et une date de fin. Refus sans motif visible.
5. **Code de rattachement** créé sur la fiche du résident : 8 caractères, 14 jours, usage unique, montré une seule fois. Il ne donne aucun accès ; il désigne le résident au personnel. 5 codes erronés par 24 h, ensuite les codes sont ignorés sans le dire.
6. **Plusieurs résidents, plusieurs établissements** : une session étanche par lien. Au plus 5 demandes en attente et 10 par jour.
7. **Retrait** : par l'établissement (révocation immédiate, existante), par le proche (« Ne plus suivre »), suppression du compte par le proche (accès coupés, demandes retirées, courriel effacé).
8. **Journal immuable** : création, confirmation, demande, décision, vérification, consentement, code, réinitialisation, suppression ; jamais de nom ni de courriel.
9. **Minimisation** : demandes sans réponse expirées à 30 jours ; demandes refusées, retirées ou expirées supprimées à 90 jours ; comptes jamais confirmés supprimés à 7 jours.
10. **Invitation par l'établissement** : inchangée. Si le courriel a déjà un compte, l'invitation s'y rattache avec le mot de passe du compte. Un compte jamais confirmé (créé par un tiers) est repris par la personne invitée.

## Fichiers
`src/proches-comptes.js` · tables `proches_comptes`, `proches_comptes_sessions`, `proches_codes_rattachement`, `proches_demandes_rattachement`, `proches_consentements` (`db/schema.sql`) · `public/proches.js` (écrans du proche) · `public/chsld.js` (file et code) · tests dans `tests/chsld.test.cjs` (« Arrimo Famille : compte créé par le proche… » et « écrans Arrimo Famille… »).

## Limites
- Les courriels exigent un transport SMTP configuré ; sans lui, l'inscription répond « envoi indisponible ».
- Pas de conformité déclarée : la Loi 25 demande encore une validation juridique de l'avis, du consentement et des durées avant tout vrai établissement.
