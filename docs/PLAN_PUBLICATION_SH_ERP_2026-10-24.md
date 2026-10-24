# Arrimo.SH — ERP complet : release candidate et plan de publication (24 octobre 2026)

**Statut : préparé et validé hors production. Non publié.** La production SH (`sh.arrimo.senseafri.com`, release `arrimo-9ea28cff…`, base `arrimo_sh`) n'a pas été modifiée pendant ces travaux : seul un `pg_dump` en lecture seule a été pris pour la répétition.

## Contenu de la candidate

Branche `erp-sh` du dépôt de travail `/root/arrimo-sh-erp` (base : arbre exact de la release `74b35fb`, déjà en ligne sur la démo).

| Module | État | Ce qui est livré |
|---|---|---|
| CRM | terminé | Organisations (adresse, province, courriel de facturation), contacts, opportunités, Kanban à 6 étapes (boutons corrigés), relances attribuées et notifiées, fiche organisation, création de la fiche établissement depuis le CRM |
| Projets | terminé | Projet créé à la signature (même sans fiche établissement), rattachement automatique, jalons, responsable, statut, avancement calculé, clôture refusée si tâches ouvertes |
| Tâches | terminé | Création, attribution notifiée, priorités, échéances, retards, commentaires, droits limités à ses propres tâches, tâches modèle terminées par les étapes réelles (import, comptes, modules, formation, Go Live) |
| Calendrier | terminé | Tâches, jalons, séances, relances, préavis de contrat, échéances de factures et de tickets, filtré par rôle |
| Devis et contrats | terminé | Grille tarifaire, totaux et taxes calculés par le serveur (TPS/TVQ/TVH), cycle brouillon → à approuver → approuvé → envoyé → accepté/refusé, contrat avec période, préavis, renouvellement, résiliation, signature avec pièce déposée, PDF devis et contrat |
| Facturation | terminé | Abonnements et facture de frais uniques créés à la signature, numérotation `FAC-AAAA-NNNN` sans trou, émission, paiements partiels, annulation contrôlée, PDF, revenu mensuel récurrent, export CSV |
| Support | terminé | Demandes, questions et incidents (gravité), délai de prise en charge par priorité, affectation, messages, historique des changements, résolution obligatoire, vue 360 de l'établissement |
| Personnel | terminé | Rôle **Finance** ajouté, équipes avec chef, matrice des permissions consultable, liste du personnel pour l'attribution |
| Documents | terminé (sauvegarde à brancher) | Chiffrement AES-256-GCM au repos, type vérifié par signature, 10 Mo, versions, accès par catégorie et rôle, confidentiel, intégrité vérifiée au téléchargement, journalisation |
| Hébergement | partiel | Supervision des environnements toutes les 5 min (disponibilité 24 h, latence, version, alertes de panne), établissements actifs ; l'état des sauvegardes demande le minuteur root ci-dessous |
| Rapports | terminé | Indicateurs par rôle (pipeline, conversion, contrats, facturation, implantation, formation, support), exports CSV protégés contre l'injection de formules |
| Formation | terminé | Séances datées par rôle, participants inscrits depuis les comptes Arrimo réels, présence et validation individuelles, progression dans les rapports |
| Activation | terminé | Hôpital → relier → import CSV/Excel → comptes par invitation → modules → formation → activation → Go Live (inchangé, enrichi des automatismes) |

Corrections incluses : erreurs métier CRM renvoyées en 500 au lieu de 400/409 ; boutons du Kanban qui visaient la mauvaise opportunité ; appel `/environnements` refusé pour les rôles non autorisés (erreur de console) ; sélecteur de langue invisible (variable CSS inexistante) ; dates affichées la veille (processus SH désormais en UTC, dates métier calculées dans `SH_FUSEAU`).

## Migration de base

`src/sh/erp-migrations.js`, version **6**, strictement additive (aucune table ni colonne supprimée ; la seule contrainte remplacée est la liste des rôles, élargie à `finance`). Elle s'exécute au démarrage du service, dans une transaction avec verrou consultatif, et elle est rejouable.

## Preuves (24 octobre 2026)

- Tests API existants : **72/72**. Tests ERP de bout en bout (`tests/sh-erp.test.cjs`) : **18/18**, parcours Prospect → Devis → Contrat → Projet → Tâches → Hôpital D → Import CSV et Excel → Utilisateurs → Modules → Formation → Go Live (recette vers une production de test) → Support → Facturation, et contrôles de sécurité par rôle.
- Navigateur (`tests/sh-erp.interface.spec.cjs`, Chromium, politique de sécurité appliquée) : **1/1**, 17 écrans × 3 largeurs (ordinateur, tablette, téléphone), sans débordement, contraste AA, boutons ≥ 40 px sur téléphone, aucune erreur de console.
- Suites existantes : `interface.spec.js` 7/9, `demo-trio` 2/4, `structure-ui` 0/1 — **résultats identiques sur la base 74b35fb non modifiée** (Playwright 1.49 disponible ici refuse `waitForFunction` sous la politique de sécurité ; fichier `/tmp` appartenant à un autre compte). `og.interface` non exécutée (base TCP avec mot de passe et copie de référence requises) ; aucun fichier hors `src/sh`, `public-sh` et `db/sh-*` n'a changé.
- Répétition sur copie restaurée de la production : instantané en lecture seule `/var/backups/arrimo-sh/repetition-erp-20261024T064747Z` (empreinte vérifiée), restauré dans `arrimo_restore_sh_erp_20261024t064747z`. Migration appliquée puis rejouée (`appliquee: true` puis `false`), comptes, hôpitaux, journal et empreinte des mots de passe identiques avant et après, rôle administrateur conservé. La release **actuelle** (9ea28cf) lit et écrit sur le schéma migré (10 écrans, création de devis et d'hôpital) ; la candidate lit tout, y compris un devis écrit par l'ancienne (PDF 200). Un compte fictif n'existe que dans cette copie.

## Plan de publication (à exécuter seulement après accord)

1. **Sauvegarde fraîche** de `arrimo_sh` (pg_dump custom + empreinte + `pg_restore --list`), de `/opt/arrimo-sh/shared/.env` et de l'unité systemd.
2. **Dossiers** : `install -d -o arrimo-sh -g arrimo-sh -m 700 /var/lib/arrimo-sh/documents` ; `install -d -o root -g arrimo-sh -m 750 /var/lib/arrimo-sh`.
3. **Configuration** (`/opt/arrimo-sh/shared/.env`, root:arrimo-sh 640), ajouts sans secret : `SH_DOCUMENTS_DIR=/var/lib/arrimo-sh/documents`, `SH_SAUVEGARDES_ETAT=/var/lib/arrimo-sh/etat-sauvegardes.json`, `SH_EMETTEUR_NOM`, `SH_EMETTEUR_ADRESSE`, `SH_EMETTEUR_COURRIEL`, `SH_EMETTEUR_TAXES` (numéros de TPS/TVQ réels à fournir par le propriétaire), `SH_PUBLIC_URL=https://sh.arrimo.senseafri.com`. La clé `SH_MFA_ENCRYPTION_KEY` existante chiffre aussi les documents (dérivation HKDF) : sa copie de récupération couvre les deux usages.
4. **Release** : extraire l'archive dans `/opt/arrimo-sh/releases/arrimo-erp-<sha>` (root:arrimo-sh, lecture seule), copier `node_modules` de la release active (lock identique), vérifier les empreintes.
5. **Minuteur root** pour l'état des sauvegardes (toutes les heures) : `deploy/etat-sauvegardes.sh /var/lib/arrimo-sh/etat-sauvegardes.json demo=/var/backups/arrimo recette=/var/backups/arrimo-recette sh=/var/backups/arrimo-sh`.
6. **Sauvegarde des documents** : ajouter à la sauvegarde de nuit SH une archive de `/var/lib/arrimo-sh/documents` (fichiers déjà chiffrés) et sa copie B2.
7. **Bascule** : `deploy/releases.sh activate /opt/arrimo-sh arrimo-erp-<sha> arrimo-sh http://127.0.0.1:3012/api/sante` (retour automatique si la santé échoue). La migration v6 s'applique au démarrage.
8. **Vérifications** : santé HTTPS, `sh_migrations` contient 6, compte administrateur et empreinte de mot de passe inchangés, `GET /hebergement` et `/rapports/indicateurs` par une session réelle de l'administrateur, Arrimo principal et démo A/B/C inchangés (PID et pointeurs).
9. **Retour arrière** (code seulement, aucune restauration de base) : `deploy/releases.sh rollback /opt/arrimo-sh "" arrimo-sh http://127.0.0.1:3012/api/sante`. La release 9ea28cf fonctionne sur le schéma v6 (répétition ci-dessus) ; les données ERP saisies entre-temps restent dans la base.

## Limites connues

- Pas d'envoi de courriel des factures ni de passerelle de paiement : les paiements sont saisis. Les notifications sont internes à la console (pas de courriel).
- Taux de taxes 2026 préchargés (TPS 5 %, TVQ 9,975 %, TVH 13/14/15 %) : à confirmer par la comptabilité ; la TVP de l'Ouest n'est pas appliquée.
- Signature électronique non intégrée : la pièce signée hors plateforme est déposée et liée au contrat.
- Modèle de contrat PDF à faire valider juridiquement ; numéros de taxes de l'émetteur à fournir.
- Matrice des permissions consultable mais définie par le code (non modifiable à chaud).
- Interface anglaise : onglets, titres et actions principales traduits ; certains messages dynamiques restent en français.
- Go Live vers la production : vérifié contre une production de test ; aucune production réelle n'est reliée (hébergement au Canada à venir).
