# CAHIER DES CHARGES ULTIME — ARRIMO SH & OG
**SenseAfriGroup | 28 octobre 2026**

**Mission pour Codex : compléter, moderniser, implémenter, tester et déployer Arrimo SH sans reconstruire ni détruire les fonctionnalités existantes.**

## 1. Vision et objectifs

Transformer Arrimo SH en un véritable ERP de gestion et d'implantation hospitalière, inspiré des bonnes pratiques d'Odoo et des autres ERP professionnels.

Arrimo SH doit permettre à SenseAfriGroup de gérer toutes les activités nécessaires à la commercialisation, à l'installation, à la formation, au déploiement et à la maintenance d'Arrimo.

Le système doit être :

- Multi-pays et multi-clients.
- Multi-établissements et multi-projets.
- Multi-utilisateurs, avec des responsabilités individuelles.
- Modulaire et évolutif.
- Sécurisé, avec des données strictement isolées.
- Adapté aux phases Démo, Pilote et Production.
- Capable de gérer plusieurs projets simultanément.
- Accessible depuis des ordinateurs, tablettes et téléphones.
- Doté d'une interface moderne et d'un assistant IA OG.

Il ne faut pas développer un nouvel ERP à côté du SH existant. Il faut auditer les fonctionnalités actuelles, conserver celles qui fonctionnent et compléter les éléments manquants.

## 2. Architecture mondiale et séparation des données

### Structure organisationnelle

SenseAfriGroup → Pays → Clients/Réseaux hospitaliers → Établissements → Projets → Environnements.

Un client peut posséder plusieurs établissements. Un établissement peut faire l'objet de plusieurs projets successifs : pilote, extension, intégration, formation ou mise à niveau.

### Pays

Chaque pays doit posséder ses paramètres :

- Nom et code pays.
- Régions et zones administratives.
- Fuseau horaire.
- Langue et formats locaux.
- Devise et règles de facturation.
- Exigences contractuelles et réglementaires.
- Localisation des données et hébergement.
- Connecteurs hospitaliers disponibles.

Prévoir le Canada, le Togo, le Niger, le Mali, la Guinée et d'autres pays, sans activer automatiquement des clients ni supposer que les exigences juridiques sont identiques.

### Isolation technique

Les données de deux clients, deux pays ou deux environnements ne doivent pas être accessibles entre elles sans autorisation explicite.

Utiliser une architecture multi-tenant robuste, avec identification systématique du tenant, du projet et de l'environnement.

Prévoir des bases ou espaces isolés selon les exigences des déploiements, un contrôle d'accès renforcé, des sauvegardes séparées et une supervision centralisée qui ne divulgue pas de données cliniques.

Une coordination entre hôpitaux n'est possible que dans les réseaux autorisés.

## 3. Environnements Démo, Pilote et Production

### Démo

- Réservée aux données fictives.
- Sert aux présentations, scénarios de formation et tests.
- Conserve les trois établissements fictifs A, B et C.
- Conserve leurs comptes et les scénarios existants.
- Ne doit jamais accéder aux données réelles des pilotes ou de la production.

### Pilote

- Destiné aux premiers déploiements expérimentaux.
- Possède son propre espace, ses utilisateurs, ses modules et ses données.
- Peut être activé pour plusieurs établissements en parallèle.
- Doit être adapté à des pilotes utilisant uniquement des données fictives ou, si autorisé, à des pilotes contenant des données réelles.

### Production

- Environnement officiel de fonctionnement.
- Bénéficie de contrôles renforcés, de sauvegardes, de surveillance et de procédures de reprise.
- Peut accueillir plusieurs établissements indépendants ou plusieurs établissements d'un même réseau.

### Promotion Pilote → Production

Créer dans SH un parcours de promotion permettant de conserver :

- Les établissements et leurs configurations.
- Les services, chambres, lits et civières.
- Les utilisateurs et rôles approuvés.
- Les modules et paramètres.
- Les intégrations validées.
- Les procédures et formations terminées.

Ne pas reprendre tout le travail de configuration.

Ne jamais copier automatiquement les patients fictifs dans la production.

Les données réelles ne peuvent être conservées ou migrées que selon les accords et procédures autorisés.

Prévoir une validation préalable, une sauvegarde, une vérification des migrations, une bascule contrôlée et un plan de retour arrière.

## 4. Conservation obligatoire de la Démo ABC

Les trois établissements existants doivent rester disponibles :

- Hôpital A — Val-des-Pins.
- Hôpital B — Mont-Clair.
- Hôpital C — Sainte-Aurore.

Le compte de coordination régionale reste distinct d'un hôpital.

Conserver les modules, personnels fictifs, lits, civières, admissions, transferts, scénarios et accès existants.

Conserver notamment le scénario :

- Patient fictif P-43267.
- Transfert TR-00067.
- Hôpital C vers Hôpital A.
- Soins intensifs.
- Chambre 108, lit SI-108.
- Réception et admission validées.

Utiliser ce scénario comme test de non-régression pour OG et les transferts.

Ne pas créer d'Hôpital D fictif.

## 5. Tableau de bord général de SH

Créer un cockpit central professionnel affichant :

- Nombre de pays actifs.
- Clients et établissements.
- Projets en prospection, préparation, pilote, production et maintenance.
- Projets en retard.
- Déploiements imminents.
- Tâches urgentes.
- Équipes affectées.
- Formations à réaliser.
- Anomalies et tickets.
- État des environnements.
- État des intégrations.
- Abonnements et échéances contractuelles.

Prévoir des filtres par pays, client, établissement, chef de projet, statut et période.

L'administrateur général dispose d'une vision globale. Chaque autre utilisateur ne voit que les informations correspondant à ses permissions.

## 6. Module Clients et établissements

Créer un référentiel structuré :

- Clients publics ou privés.
- Réseaux hospitaliers.
- Ministères et organismes clients.
- Établissements et sites.
- Adresses et contacts.
- Pays et régions.
- Services hospitaliers.
- Chambres, lits et civières.
- Interlocuteurs techniques et fonctionnels.
- Contrats et licences.
- Projets associés.
- Historique des activations.

Chaque établissement possède un identifiant unique, un statut et un historique traçable.

Prévoir une création manuelle et une importation CSV/XLSX avec prévisualisation, validation, détection des doublons et rapport d'erreurs.

## 7. Module Projets et portefeuille de déploiement

Le SH doit gérer plusieurs projets simultanément, y compris plusieurs pilotes actifs dans un même pays.

### Fiche projet

- Référence automatique.
- Nom du projet.
- Client, établissement et pays.
- Type : pilote, implantation, extension, intégration, migration, maintenance ou mise à niveau.
- Responsable du projet.
- Membres de l'équipe.
- Date de début, date cible et jalons.
- Modules concernés.
- Environnement cible.
- Budget et coûts prévisionnels.
- Avancement.
- Risques, décisions et documents.
- Statut et historique.

### Étapes Kanban

Nouveau → Qualification → Cadrage → Préparation → Configuration → Migration → Intégrations → Formation → Tests/UAT → Prêt au lancement → Go Live → Stabilisation → Maintenance → Terminé.

Prévoir les états En attente, Suspendu, Annulé et Archivé.

L'avancement doit être calculé à partir des tâches et jalons réels, et non simulé.

Vues obligatoires : Kanban, Liste, Calendrier, Chronologie/Gantt et Tableau de bord.

## 8. Module Équipes, RH projet et responsabilités

Créer un répertoire des collaborateurs de SenseAfriGroup.

Pour chaque employé :

- Identité professionnelle.
- Courriel.
- Fonction.
- Compétences.
- Pays ou zone d'intervention.
- Statut.
- Disponibilité.
- Projets affectés.
- Permissions.

Chaque projet doit avoir un chef de projet désigné et une équipe constituée de plusieurs personnes.

Une personne peut travailler sur plusieurs projets, avec une répartition de sa charge et de ses responsabilités.

Le chef de projet peut attribuer les tâches, consulter leur avancement et signaler les blocages, dans son périmètre d'autorisation.

Ne pas confondre les utilisateurs internes SenseAfriGroup avec les employés des établissements clients.

## 9. Module Tâches

Créer une gestion des tâches de niveau ERP.

Chaque tâche doit contenir :

- Titre et description.
- Projet et établissement.
- Responsable principal.
- Collaborateurs.
- Priorité.
- Statut.
- Date d'échéance.
- Temps estimé et temps réalisé.
- Checklist et sous-tâches.
- Dépendances.
- Pièces jointes.
- Commentaires et historique.
- Critères d'acceptation.

Statuts : À faire → En cours → En validation → Terminée, avec Bloquée et Annulée.

Prévoir rappels, notifications, filtres, Kanban, calendrier et suivi des retards.

Les tâches critiques doivent pouvoir bloquer le Go Live tant qu'elles ne sont pas validées.

## 10. Module Formation et accompagnement

Permettre à SenseAfriGroup de former les employés des établissements jusqu'au Go Live.

### Fonctions

- Plan de formation par établissement.
- Sessions par date et par groupe.
- Formateur désigné.
- Employés inscrits.
- Supports pédagogiques.
- Démonstrations pratiques.
- Suivi de présence.
- Évaluations.
- Validation des acquis.
- Attestations, si utilisées.
- Retours des participants.
- État global de préparation.

Prévoir des formations distinctes pour :

- Administrateurs hospitaliers.
- Coordination des lits.
- Admissions.
- Urgences.
- Nettoyage.
- Responsables des transferts.
- Autres utilisateurs autorisés.

Un établissement ne doit pas être annoncé comme prêt à fonctionner si les formations critiques nécessaires ne sont pas validées.

## 11. Module Déploiement et Go Live

Créer un parcours d'implantation de bout en bout :

1. Cadrage du projet.
2. Recensement des établissements.
3. Collecte des services, chambres, lits et civières.
4. Configuration des modules.
5. Création des utilisateurs.
6. Configuration des permissions.
7. Connexion aux systèmes existants, si prévue.
8. Importation et validation des données.
9. Formation.
10. Tests de bout en bout.
11. Recette utilisateur (UAT).
12. Validation de sécurité et de confidentialité.
13. Sauvegarde.
14. Autorisation de mise en service.
15. Go Live.
16. Surveillance et stabilisation.
17. Support continu.

Chaque étape doit présenter son responsable, ses livrables, ses dépendances, son statut et ses preuves.

Afficher un pourcentage réel d'avancement et les actions bloquantes.

## 12. Module Utilisateurs, comptes et permissions

Permettre un grand nombre de comptes individuels par établissement, sans limite fixe arbitraire par rôle.

Exemple : plusieurs administrateurs, quinze agents de nettoyage, plusieurs dizaines d'employés des urgences ou des admissions.

Fonctionnalités :

- Création individuelle.
- Création groupée.
- Invitations par courriel.
- Import CSV/XLSX.
- Affectation par établissement et service.
- Rôles et permissions configurables.
- Activation et désactivation.
- Révocation des sessions.
- Gestion des utilisateurs ayant plusieurs affectations autorisées.

### Connexions simultanées

Plusieurs employés ayant le même rôle doivent pouvoir utiliser Arrimo simultanément depuis des appareils différents, chacun avec son compte personnel.

Afficher en bas de la barre latérale :

Nom et prénom — Fonction — Établissement.

Chaque action doit enregistrer son auteur, sa date, son heure et son établissement.

Prévenir les conflits d'écriture : deux personnes ne doivent pas pouvoir attribuer simultanément le même lit à deux patients différents.

## 13. Mot de passe oublié et identité

Implémenter la récupération des comptes pour :

- Arrimo SH.
- Arrimo Pilote.
- Arrimo Production.
- Arrimo Démo selon sa politique d'accès.

Parcours :

1. Clic sur « Mot de passe oublié ? ».
2. Saisie du courriel.
3. Envoi d'un lien sécurisé.
4. Ouverture du lien.
5. Choix et confirmation d'un nouveau mot de passe.
6. Connexion avec le nouveau mot de passe.

Mesures obligatoires :

- Ne jamais envoyer l'ancien mot de passe.
- Lien à usage unique et durée limitée.
- Jetons stockés sous forme d'empreinte.
- Protection contre les abus.
- Message identique pour les comptes existants et inexistants.
- Invalidation des sessions appropriées.
- Journal de sécurité sans secrets.

Prévoir également les invitations, confirmations et notifications par courriel.

Configurer une infrastructure réelle d'envoi de courriels, avec gestion des échecs et contrôles de délivrabilité.

## 14. Catalogue des modules d'Arrimo

Créer un catalogue moderne semblable aux applications d'un ERP.

Chaque module dispose :

- D'une icône professionnelle.
- D'un nom clair.
- D'une description.
- D'un interrupteur Activer / Désactiver.
- D'une version.
- De paramètres.
- De permissions.
- De dépendances.
- D'un statut technique.

Inclure les modules hospitaliers existants selon leur état réel :

- Lits.
- Civières et urgences.
- Admissions.
- Transferts.
- Réseau interhospitalier.
- Nettoyage.
- Congés.
- Alertes.
- NSA.
- Indicateurs.
- Journal.
- Administration et paramètres.
- OG.

Préserver la distinction des fonctionnalités Réseau et National lorsqu'elles existent.

Un module peut être activé par client, établissement ou environnement, selon le modèle d'autorisation.

L'activation doit vérifier les dépendances et ne jamais rendre accessibles des données non autorisées.

Prévoir un cadre d'extension permettant d'ajouter de futurs modules et de déployer des mises à jour versionnées.

## 15. OG — Copilote intelligent universel d'Arrimo

OG reste l'unique copilote IA d'Arrimo.

Il doit être disponible dans tous les environnements et établissements où son module est activé.

OG doit fonctionner avec des permissions strictes et exploiter uniquement les données autorisées.

### Capacités obligatoires

OG doit comprendre les questions concernant :

- Patients.
- Lits.
- Civières.
- Chambres.
- Admissions.
- Congés.
- Nettoyage.
- Capacités.
- Transferts.
- Établissements.
- Attentes.
- Alertes.
- Priorités validées par le personnel.
- État des opérations.
- Indicateurs.

OG doit retrouver un patient relevant du périmètre autorisé même après un transfert.

Exemple de non-régression :

Depuis l'Hôpital C, OG doit retrouver le patient fictif P-43267 admis à l'Hôpital A, chambre 108, lit SI-108, avec le transfert TR-00067 reçu.

Depuis l'Hôpital B, OG ne doit pas révéler de détails auxquels le compte n'est pas autorisé.

OG doit distinguer les informations certaines, estimées, non confirmées ou indisponibles.

Il ne doit pas inventer de patient, de lit, de priorité clinique, de position ou d'heure d'arrivée.

### Parcours patient

Lorsque les données existent et que l'utilisateur a les droits nécessaires, OG doit pouvoir expliquer :

- Où se trouve le patient.
- Son établissement actuel.
- Son statut d'admission.
- Son lit ou sa civière.
- Son historique de transfert.
- L'étape actuelle.
- Les étapes précédentes.
- Le dernier événement enregistré.

Si le transfert est en cours, OG doit donner le dernier statut confirmé et non prétendre connaître une position GPS non disponible.

### Décisions humaines

OG peut assister, expliquer et proposer.

Il ne peut pas attribuer seul une gravité clinique, accepter une admission, déclencher un transfert ou modifier une donnée critique sans autorisation et validation humaine.

## 16. NOUVELLE PRIORITÉ — OG VOCAL ET CONVERSATIONNEL

Ajouter à OG un mode conversationnel vocal moderne.

L'utilisateur doit pouvoir poser une question oralement plutôt que de devoir l'écrire.

OG doit pouvoir répondre **à voix haute et afficher simultanément sa réponse sous forme de texte**.

### Interface

Dans le panneau OG :

- Zone de conversation habituelle.
- Bouton microphone.
- Indicateur d'écoute.
- Affichage du texte reconnu.
- Réponse écrite.
- Lecture vocale de la réponse.
- Bouton pour interrompre la lecture.
- Possibilité de repasser immédiatement au clavier.

Deux parcours sont souhaités :

**Mode message vocal :** l'utilisateur enregistre une question, valide son envoi et reçoit une réponse texte + audio.

**Mode conversation vocale :** lorsque la technologie disponible le permet, l'utilisateur échange oralement avec OG avec une latence faible et peut interrompre la réponse.

Le mode message vocal peut être livré d'abord. Le mode conversation en continu doit être ajouté seulement après vérification de sa fiabilité.

### Exemple attendu

L'utilisateur demande oralement :

« OG, où se trouve le patient P-43267 ? »

OG répond oralement et par écrit :

« Le patient P-43267 a été transféré de l'Hôpital C vers l'Hôpital A. Son admission est enregistrée en soins intensifs, chambre 108, lit SI-108. Le transfert TR-00067 est reçu. »

La réponse doit être générée à partir des données vérifiées au moment de la demande, dans les limites des accès.

### Sécurité vocale

- Autorisation explicite du microphone.
- Transmission audio chiffrée.
- Information claire sur le traitement de la voix.
- Pas d'enregistrement audio permanent par défaut.
- Politique de conservation documentée.
- Pas de lancement automatique de capture sonore.
- Respect des permissions de l'utilisateur.
- Aucune action clinique sensible déclenchée uniquement par reconnaissance vocale sans validation appropriée.
- Gestion des erreurs de transcription et des homonymes.

Dans les environnements réels, la conformité et les autorisations de traitement audio doivent être validées avant activation.

La Démo ABC doit permettre de tester le mode vocal avec des patients fictifs.

## 17. Transport — Périmètre retenu

**Décision du 28 octobre : reporter le développement d'un nouveau module autonome de suivi GPS des transporteurs.**

Ne pas ajouter maintenant de portail transporteur ni de suivi GPS en direct.

Conserver les fonctionnalités de transport déjà présentes dans les transferts d'Arrimo.

OG doit pouvoir répondre à partir des statuts existants :

- Transport demandé.
- Transport organisé.
- Départ confirmé.
- Réception confirmée.
- Transfert terminé.

OG doit distinguer :

- Temps de trajet routier estimé.
- Temps écoulé.
- Durée enregistrée.
- Position réelle, uniquement si une source autorisée fournit effectivement cette information.

Préserver les interfaces d'extension pour un futur module transport, mais ne pas annoncer de suivi GPS en direct à ce stade.

## 18. Intégrations et interopérabilité

Prévoir un module Intégrations pour gérer :

- Logiciels hospitaliers existants.
- API sécurisées.
- Webhooks.
- Connecteurs versionnés.
- Échanges HL7/FHIR lorsque pertinents.
- Importations CSV/XLSX.
- Synchronisations planifiées ou événementielles.
- Journalisation.
- Surveillance.
- Gestion des erreurs.
- Reprises après incident.

Ne pas ouvrir de ports réseau arbitraires.

Chaque intégration doit être autorisée, authentifiée, documentée, isolée par environnement et validée avec l'établissement concerné.

Le mode manuel doit rester possible lorsque l'intégration automatique n'est pas disponible.

## 19. CRM, devis, contrats et facturation

Ajouter ou compléter les fonctions de gestion commerciale nécessaires à SenseAfriGroup :

- Prospects.
- Opportunités.
- Contacts.
- Clients.
- Propositions de pilote.
- Devis.
- Contrats.
- Licences.
- Facturation.
- Paiements et échéances.
- Renouvellements.
- Tarification par établissement, projet ou réseau.

Prévoir devis et factures en PDF, taxes et devises configurables, suivi des paiements et historique contractuel.

La conversion d'une opportunité gagnée doit pouvoir créer un client et un projet, après validation.

## 20. Support, maintenance et qualité

Prévoir :

- Tickets clients.
- Incidents.
- Demandes d'amélioration.
- Priorités et affectations.
- Suivi des délais.
- Versions logicielles.
- Mises à jour.
- Journal des déploiements.
- Tests de régression.
- Supervision des environnements.
- Sauvegardes.
- Procédures de restauration.

Chaque établissement doit disposer d'un suivi de support adapté à son contrat.

## 21. Suppression, archivage et restauration des projets

Permettre de gérer le cycle de vie de tout projet :

- Archiver.
- Restaurer.
- Demander la suppression.
- Supprimer définitivement lorsque cela est autorisé.

Cela concerne les projets Démo, Pilote et Production.

Pour les projets actifs en Production, imposer des contrôles supplémentaires : autorisation, vérification des dépendances, obligations de conservation, restitution des données si nécessaire et révocation des accès.

Une suppression ne doit jamais effacer accidentellement un autre établissement, un réseau ou un environnement.

Conserver un historique des opérations administratives conformément aux obligations applicables.

## 22. Interface et expérience utilisateur

Créer un design moderne et cohérent :

- Barre latérale compacte.
- Tableau de bord lisible.
- Modules avec icônes sobres.
- Interrupteurs visuels d'activation.
- Cartes d'indicateurs.
- Vues Kanban, listes et formulaires.
- Recherche globale.
- Filtres enregistrables.
- Notifications.
- États de chargement.
- Messages de validation et d'erreur.
- Compatibilité desktop et mobile.
- Accessibilité.
- Interface française prioritaire, avec architecture multilingue.

La présentation doit être digne d'un ERP professionnel, sans surcharge visuelle.

## 23. Sécurité, audit et disponibilité

Mettre en place ou vérifier :

- Authentification sécurisée.
- Permissions par rôle, action, projet et établissement.
- Isolation des tenants.
- Protection des données de santé.
- Chiffrement en transit et au repos lorsque pertinent.
- Gestion sécurisée des secrets.
- Journaux d'audit.
- Sauvegardes vérifiées.
- Restauration testée.
- Contrôle des migrations.
- Protection contre les actions concurrentes.
- Surveillance et alertes techniques.
- Protection contre les accès non autorisés.
- Conformité aux exigences applicables selon le pays et l'établissement.

Ne jamais considérer un projet prêt à être déployé uniquement parce que son interface fonctionne.

## 24. Plan de tests obligatoire

Tester l'ERP SH et Arrimo de bout en bout :

1. Plusieurs pays et clients indépendants.
2. Plusieurs établissements dans un même pays.
3. Plusieurs projets pilotes simultanés.
4. Deux projets pour un même établissement.
5. Chef de projet et équipe affectés.
6. Attribution, validation et clôture de tâches.
7. Formation de plusieurs employés.
8. Création de nombreux comptes ayant le même rôle.
9. Connexions simultanées.
10. Identité utilisateur affichée et journalisée.
11. Réinitialisation des mots de passe par courriel.
12. Activation et désactivation de modules.
13. Déploiement d'un environnement pilote.
14. Promotion contrôlée Pilote → Production.
15. Archivage et suppression sécurisée.
16. Isolation stricte entre pays, clients et projets.
17. OG sur plusieurs établissements.
18. OG et le transfert P-43267 / TR-00067.
19. Refus des accès non autorisés depuis B.
20. Questions vocales à OG.
21. Réponses audio + texte synchronisées.
22. Retour au clavier et gestion des erreurs microphone.
23. Régression sur les modules hospitaliers existants.
24. Vérification des sauvegardes et des mécanismes de retour arrière.

Utiliser des données fictives pour les nouveaux scénarios de test.

## 25. Essai final — Nouveau pilote fictif

Après mise en œuvre, créer depuis SH un nouveau projet fictif de bout en bout.

Exemple : « Pilote Hôpital Test ».

Effectuer réellement :

1. Création du client et de l'établissement fictifs.
2. Création d'un projet pilote.
3. Affectation du chef de projet.
4. Création de l'équipe et des tâches.
5. Configuration des services, chambres, lits et civières.
6. Activation des modules.
7. Activation d'OG.
8. Création de plusieurs comptes hospitaliers.
9. Invitations et accès.
10. Formation fictive avec suivi.
11. Tests des principaux parcours hospitaliers.
12. Test d'OG en texte et en voix.
13. Validation des critères de passage en production.
14. Simulation de promotion en production sans données cliniques réelles.
15. Vérification de l'archivage et de la procédure de suppression.

La Démo ABC originale doit rester intacte.

## 26. Instructions d'exécution pour Codex

Commencer par un inventaire des fonctionnalités existantes de SH, d'Arrimo et d'OG.

Classer chaque exigence en :

- Déjà opérationnelle.
- Existante mais incomplète.
- Absente.
- Nécessitant une intégration ou une ressource externe.

Ne pas redévelopper ce qui fonctionne déjà.

Implémenter les éléments manquants avec des migrations propres, des tests automatisés et des contrôles de sécurité.

Prioriser les fonctions nécessaires à la création et à l'activation d'un nouvel établissement pilote, puis le vocal OG, puis les modules ERP complémentaires.

Les modifications doivent être testées et publiées sur les environnements de démonstration ou de validation autorisés.

**Ne pas modifier les environnements hospitaliers réels ni la Production sans autorisation explicite.**

Si une fonctionnalité nécessite un fournisseur externe (voix, courriel, hébergement, interopérabilité), identifier clairement la dépendance, sa configuration et son état de fonctionnement.

Ne jamais déclarer opérationnelle une fonctionnalité simplement parce que son interface existe.

## 27. Rapport final attendu

Fournir :

- Tableau des fonctionnalités existantes et ajoutées.
- Modules réellement fonctionnels.
- Migrations exécutées.
- Résultats détaillés des tests.
- État du mode vocal OG.
- État de la récupération des mots de passe.
- Résultat de création du pilote fictif.
- État de la promotion Pilote → Production.
- Vérification de la Démo ABC.
- Vérification des autorisations et de l'isolation.
- URLs réellement déployées et testées.
- Blocages restants.
- État des sauvegardes.
- Confirmation des environnements inchangés.

**Résultat final recherché : Arrimo SH devient le cockpit central de SenseAfriGroup, permettant de piloter simultanément des projets hospitaliers dans plusieurs pays, avec équipes, tâches, formations, modules, déploiements et OG vocal, jusqu'au Go Live et à la maintenance.****COMPLÉMENT À L'AUDIT CODEX — MODULE TICKETS ET SUPPORT**

Vérifie si Arrimo SH possède déjà un module Tickets, Support ou Helpdesk.

S'il existe, identifie les fonctionnalités présentes et celles qui manquent.

Le module cible doit permettre :

**1. Création de tickets**
- Signaler un problème technique ou un bug.
- Demander une modification ou une amélioration.
- Demander une assistance ou une formation.
- Signaler un problème d'accès ou de connexion.
- Effectuer une demande liée à un projet ou un établissement.

**2. Gestion des tickets**
- Numéro automatique : TICK-2026-0001.
- Client, établissement, projet et environnement concernés.
- Titre, description, priorité et catégorie.
- Pièces jointes et captures d'écran.
- Responsable assigné et échéance.
- Commentaires et historique des interventions.
- Notifications par courriel.

**3. Suivi Kanban**

Nouveau → Assigné → En cours → En attente → Résolu → Fermé.

Prévoir également la réouverture d'un ticket.

**4. Affectation automatique ou manuelle**

L'administrateur ou un responsable autorisé peut affecter un ticket à un développeur, consultant ou membre du support.

Chaque employé retrouve les tickets qui lui sont attribués dans son tableau de bord.

**5. Portail client**

Un établissement client doit pouvoir créer un ticket et consulter son avancement, sans accéder aux tickets des autres clients.

**6. Gestion des incidents critiques**

Prévoir les priorités, délais de prise en charge, escalades et engagements de service (SLA) selon les contrats.

Ne jamais inclure inutilement de données médicales identifiables dans les tickets ou notifications.

**7. OG et les tickets**

OG dans SH peut aider les employés autorisés à rechercher, résumer et suivre les tickets.

Exemple : « OG, quels tickets critiques sont encore ouverts pour le projet pilote du Québec ? »

**IMPORTANT : pour l'instant, vérifie l'existant et complète ton rapport d'audit. Ne développe et ne publie rien avant notre validation.****MISSION CODEX — AUDIT DES MODULES EXISTANTS D'ARRIMO SH**

Avant de commencer le développement du nouveau cahier des charges, analyse intégralement l'Arrimo SH existant.

**1. Inventaire complet**

Vérifie tous les modules actuels : Contacts, CRM, Projets, Tâches, Équipe/RH, Devis, Contrats, Facturation, Finances, Documents, Formations, Déploiements, Support, Intégrations, Environnements, Utilisateurs, Rôles, OG et tous les autres modules présents.

N'oublie pas les fonctionnalités présentes dans le code mais absentes de l'interface.

**2. Classe chaque module**

- Déjà fonctionnel et testé.
- Partiellement développé.
- Présent uniquement dans l'interface.
- Absent.
- Présent mais présentant des erreurs.

**3. Vérifie le fonctionnement réel**

Contrôle les interfaces, les API, la base de données, les permissions, les interactions entre modules et les tests existants.

Ne considère pas qu'un module fonctionne simplement parce qu'un bouton ou un menu apparaît.

**4. Compare avec notre cahier des charges**

Identifie uniquement les fonctionnalités manquantes à développer et les fonctionnalités existantes à améliorer.

Préserve les données, comptes, projets et configurations déjà présents.

**5. Rapport attendu**

Prépare un tableau indiquant pour chaque module : son état actuel, les fonctions existantes, les éléments manquants, les anomalies et les travaux nécessaires.

**IMPORTANT : pour cette première mission, effectue uniquement l'audit. Ne modifie rien et ne publie rien.**

Une fois le rapport terminé, nous déciderons précisément des améliorations à apporter, sans reconstruire inutilement Arrimo SH.**COMPLÉMENT À L'AUDIT ARRIMO SH — MULTI-PAYS, DEVISES ET CONFIDENTIALITÉ**

### 1. Gestion de tous les pays et devises

Vérifier si SH possède déjà un référentiel international complet.

Exigences :
- Tous les pays et territoires pris en charge, avec leurs codes ISO.
- Association automatique du pays à sa devise par défaut.
- Affichage du nom, du symbole et du code de devise.
- Possibilité de sélectionner une autre devise pour un contrat international.
- Gestion des fuseaux horaires, langues et formats régionaux.
- Configuration des taxes selon le pays, sans inventer de taux fiscaux.
- Prise en charge des devises multiples dans les devis, contrats, factures et rapports.

Exemples :
- Canada → CAD
- Togo → XOF (franc CFA BCEAO)
- Niger → XOF
- Mali → XOF
- Guinée → GNF
- France → EUR
- États-Unis → USD

Lorsqu'on sélectionne un pays, la devise doit apparaître automatiquement dans le formulaire.

Les taux de change doivent provenir d'une source fiable, avec date de mise à jour. Ne jamais les inventer.

### 2. Gestion des devis, contrats et informations financières

Vérifier les modules existants :
- Devis commerciaux et PDF.
- Contrats.
- Licences et abonnements.
- Facturation.
- Paiements.
- Budgets.
- Coûts, marges et bénéfices.

Chaque document doit être lié au bon client, projet, établissement et pays.

### 3. Permissions strictes par rôle

Tous les employés ne doivent PAS avoir accès aux contrats et aux finances.

Les permissions doivent distinguer :
- Voir.
- Créer.
- Modifier.
- Approuver.
- Exporter.
- Supprimer.

Exemples de règles :

**Superadministrateur :** accès global.

**Commercial autorisé :** contacts, opportunités et devis relevant de son périmètre.

**Chef de projet :** projets, équipes, tâches et suivi des déploiements ; aucun accès automatique aux contrats confidentiels ou aux marges.

**Consultant :** projets et tâches affectés, configurations autorisées.

**Développeur :** tâches techniques, tickets et déploiements autorisés ; aucun accès aux informations financières.

**RH :** employés et ressources humaines autorisés ; aucun accès automatique aux contrats commerciaux.

**Support :** tickets et interventions attribués.

Permettre au fondateur de créer des rôles personnalisés et d'attribuer précisément les permissions.

Les restrictions doivent être appliquées dans les API et la base de données, pas seulement en masquant les menus.

Les informations confidentielles doivent aussi être protégées dans les recherches, exports, notifications, fichiers PDF et réponses d'OG.

### 4. Vérification avant développement

Codex doit :
1. Vérifier ce qui existe déjà.
2. Identifier les fonctionnalités incomplètes.
3. Contrôler les permissions actuelles.
4. Identifier les risques de divulgation.
5. Présenter les corrections nécessaires.

**Pour l'instant, audit uniquement : ne pas modifier ni publier.** noublie pas de travaille ren autonomie , seul et fais vite
