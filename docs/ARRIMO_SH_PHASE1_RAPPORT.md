# Arrimo.SH — rapport phase 1

Date : 23 octobre 2026  
Branche : `codex/arrimo-sh-phase1-security`  
Base de la candidate : `f6db0e021698424d4618f851b4cc31ef17ccad59`  
Runtime de recette : Node.js `v24.14.1`

## Résultat

Le lot sécurité et préparation Go Live est implémenté dans une copie isolée. Il conserve les modules SH existants et ne modifie aucun service, base ou compte public. Aucune publication n’a été faite.

## Changements réalisés

- Ajout des rôles SH `administration`, `commercial`, `implantation`, `formation` et `support`, avec contrôle serveur par route et restrictions de champs commerciaux.
- Stockage des jetons de session et de vérification MFA sous forme d’empreintes SHA-256; chiffrement AES-256-GCM des secrets TOTP.
- Ajout d’invitations SH individuelles, à usage unique, avec expiration de 24 heures. Le destinataire choisit son mot de passe et doit activer MFA.
- Remplacement dans l’interface SH de la communication des mots de passe par des invitations, sélection de rôle et liens de récupération; les mots de passe ne sont ni affichés ni exportés.
- Passage du provisionnement des comptes hospitaliers SH aux invitations; les comptes importés restent bloqués à la connexion jusqu’à la définition du mot de passe.
- Jetons d’invitation/récupération placés dans le fragment URL (`#...`), qui n’est pas transmis au serveur. L’interface retire le jeton de l’historique dès son traitement et accepte encore les anciens liens de récupération par query string.
- Préflight Go Live en lecture seule et vérification des capacités d’invitation du serveur cible. La structure de recette est validée avant écriture. Le préflight indique explicitement quand la cible ne peut pas encore valider un import faute de tenant.
- Enregistrement de l’opération Go Live, de ses phases et résultats par type. Les imports structurels existants sont idempotents; une reprise relance les imports sans supprimer/restaurer la base. Les échecs laissent un état `interrompu`.
- Migration SH version 2 additive et rejouable. Les anciennes installations exigent `SH_INITIAL_ADMIN_EMAIL` pour attribuer le rôle d’administration à un compte existant. Les secrets TOTP déjà en clair exigent `SH_MFA_ENCRYPTION_KEY` et sont chiffrés au cours de la migration.
- Adaptation du script du premier compte SH : création par invitation, aucun mot de passe temporaire écrit dans le terminal.

## Preuves de validation

- `npm test` : **70/70 réussis** (API, SH/Go Live, courriel, routage), sur le PostgreSQL local isolé `127.0.0.1:55432`.
- `npm run test:interface` : **9/9 réussis** avant le dernier ajustement fragment; les écrans Arrimo ont passé ordinateur/tablette/téléphone et SH a passé ses trois largeurs.
- Après le changement des URL de jeton, test navigateur SH ciblé : **1/1 réussi**, parcours SH validé sur les trois largeurs.
- Parcours API C4 : premier compte invité, MFA, préparation, import des structures, génération de données fictives en recette, préflight, Go Live sur un schéma `prod_c4` jetable, invitations sans secret dans la réponse, rapport PDF et trace `termine` des cinq types.
- Vérifications supplémentaires : rôles sur routes sensibles, session stockée sous forme d’empreinte, secret TOTP chiffré, tentative de connexion hospitalière rejetée avant acceptation de l’invitation.
- Le chemin d’échec est journalisé dans le code, mais une panne injectée au milieu d’un import suivie d’une reprise n’a pas encore été testée.

Toutes les bases créées par la recette sont jetables et locales. Aucun test n’a utilisé les bases publiques.

## Configuration requise pour une recette SH

- `SH_PUBLIC_URL` : URL HTTPS de la console; boucle locale permise uniquement en test.
- `SH_MFA_ENCRYPTION_KEY` : clé base64 représentant exactement 32 octets. Elle doit être conservée dans un gestionnaire de secrets et sauvegardée avec les procédures de récupération; la perdre rend les secrets TOTP chiffrés irrécupérables.
- `SH_INITIAL_ADMIN_EMAIL` : obligatoire lors de la première migration d’une ancienne base SH contenant des membres sans rôle; la valeur doit désigner un compte existant.
- Courriel sortant opérationnel pour créer et envoyer les invitations.

Ne pas exécuter la migration sur une base publique sans sauvegarde fraîche restaurée en recette et approbation distincte. Ne jamais utiliser un dump fictif pour remplacer une base existante.

## Écarts restants et prochaine phase

Cette livraison ne prétend pas compléter tout l’ERP demandé. Elle sécurise le socle et les accès Go Live, puis prépare les phases suivantes.

1. **P0 — avant toute mise en production SH :** sauvegarde publique fraîche; restauration intégrale et vérification des comptes/historiques; fourniture et conservation de la clé MFA; vérification de l’adresse de l’administrateur initial; répétition du déploiement et rollback applicatif dans une recette représentative.
2. **P1 — prochain lot isolé :** Hôpital D de bout en bout avec un tenant préexistant préservé; tests de panne et reprise au milieu des imports; invitation réelle simulée et consommation à usage unique; installation/activation réellement isolées par tenant.
3. **P2 — modules ERP absents/partiels :** CRM et pipeline, devis/contrats, projets et tâches, annuaire employés, facturation, tickets/support, GED, rapports de direction et automatisations entre modules. Aucun de ces modules n’a été créé dans ce lot.
4. **P3 — avant pilote hospitalier :** SSO/MFA selon partenaire, exigences de conservation et d’incident, connecteur SH→Arrimo validé avec le partenaire, gouvernance, sécurité et validation métier.

Le connecteur de cette branche cible uniquement des URL définies dans la configuration SH. Aucun environnement de production n’a été ajouté ou utilisé. Les tests de Go Live sont des schémas jetables, pas une validation de production.

Le Go Live importe les fichiers dans des transactions par type, pas dans une transaction globale distribuée. Si une panne survient après certains types, le tenant et ces imports peuvent rester présents; la trace marque la phase interrompue et une relance réutilise l’import idempotent. Ce comportement doit passer le test de panne/reprise P1 avant d’autoriser un lancement public.

## Statut

**Phase 1 isolée : validée par les tests automatisés et UI.**  
**Prêt au déploiement public : non.** Les sauvegardes/restaurations publiques fraîches, la clé de chiffrement opérationnelle et un rollback public ne sont pas validés ici. Aucun déploiement n’est autorisé par ce rapport.
