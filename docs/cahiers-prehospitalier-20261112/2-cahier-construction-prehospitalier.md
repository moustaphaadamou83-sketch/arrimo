# CAHIER DE CONSTRUCTION ULTIME
# ARRIMO PRÉHOSPITALIER
## Liaison Secouriste – Arrimo Véhicule – Préalerte – Préparation Hospitalière – Arrimo Connect – OG

**Date : 12 novembre 2026**  
**Projet : Arrimo – SenseAfriGroup**  
**Nature : Extension fonctionnelle de l'écosystème Arrimo existant**  
**Objectif : Coordination préhospitalière et préparation anticipée de l'accueil hospitalier**

---

# 1. VISION GÉNÉRALE DU PROJET

Nous souhaitons construire une nouvelle partie stratégique d'Arrimo : **Arrimo Préhospitalier**.

Cette extension doit permettre une communication structurée entre les équipes ambulancières et les établissements hospitaliers avant l'arrivée d'un patient.

Aujourd'hui, l'hôpital peut apprendre l'arrivée d'un patient lorsque l'ambulance arrive physiquement ou par des communications qui ne sont pas toujours centralisées.

Arrimo doit permettre d'anticiper cette arrivée.

Lorsqu'une ambulance est en intervention et qu'une arrivée à l'hôpital est envisagée, les informations autorisées sont transmises à Arrimo. OG analyse les informations opérationnelles, les capacités disponibles et les services hospitaliers configurés. L'établissement concerné reçoit une préalerte et peut commencer à préparer son accueil avant l'arrivée de l'ambulance.

**Le principe fondamental : l'ambulance informe, OG analyse et assiste, l'hôpital est averti et se prépare, les professionnels conservent toutes les décisions médicales et opérationnelles.**

Arrimo complète les outils existants. Il ne remplace jamais :
- Le 911.
- Les centres de communication santé (CCS).
- Les protocoles de répartition et de destination.
- Les systèmes hospitaliers comme Epic.
- Les systèmes de gestion des dossiers patients.
- Les responsabilités des ambulanciers et des équipes hospitalières.

## 1.1 Objectifs principaux

1. Connecter les ambulanciers à l'écosystème Arrimo.
2. Permettre la transmission des préalertes aux hôpitaux.
3. Prévenir l'hôpital suffisamment tôt de l'arrivée d'une ambulance.
4. Permettre à l'hôpital de préparer son accueil selon la priorité et les informations reçues.
5. Consulter les capacités d'accueil des urgences partenaires.
6. Permettre à OG de proposer le service ou département hospitalier potentiellement concerné.
7. Récupérer, lorsque cela est autorisé et techniquement possible, les informations patient depuis les logiciels hospitaliers.
8. Connecter cette extension aux modules Arrimo existants.
9. Assurer un suivi de bout en bout jusqu'à la remise du patient à l'établissement.

---

# 2. RÈGLE FONDAMENTALE : OG EST L'INTELLIGENCE CENTRALE

OG doit conserver son rôle primordial dans l'ensemble de l'écosystème Arrimo.

Il ne faut surtout pas construire un module préhospitalier qui fonctionne indépendamment d'OG.

OG doit être connecté à :
- Liaison Secouriste.
- Arrimo Véhicule.
- Arrimo Préalerte.
- Arrimo Hôpital.
- Arrimo Préparation Hospitalière.
- Arrimo Disponibilités.
- Gestion des lits.
- Gestion des transferts.
- Liaison Hôpital.
- Liaison CHSLD, lorsque les parcours sont pertinents.
- Arrimo Connect.
- Arrimo SH.

## 2.1 Responsabilités d'OG

OG doit pouvoir :

- Recevoir les événements et informations provenant des modules autorisés.
- Analyser les informations d'une préalerte.
- Produire une synthèse opérationnelle claire.
- Identifier les informations manquantes ou incohérentes.
- Consulter les capacités hospitalières disponibles.
- Consulter les départements et services configurés dans les établissements.
- Proposer le service hospitalier potentiellement concerné.
- Évaluer le temps estimé avant l'arrivée à partir des données disponibles.
- Signaler les changements importants.
- Détecter les informations périmées.
- Aider l'hôpital à anticiper les ressources à préparer.
- Suivre l'évolution d'une préalerte.
- Signaler les erreurs de synchronisation et les notifications non délivrées.
- Présenter aux utilisateurs une synthèse des événements importants.

OG doit aussi pouvoir répondre aux questions opérationnelles des utilisateurs autorisés.

Exemples :
- « Quelle ambulance est actuellement en route ? »
- « Quelles préalertes sont en attente de réception ? »
- « Quel établissement a été prévenu ? »
- « Quel service est potentiellement concerné ? »
- « L'hôpital a-t-il confirmé la réception ? »
- « Quelle est l'heure estimée d'arrivée ? »
- « Quelles informations manquent pour compléter cette préalerte ? »

## 2.2 Proposition du service ou département

C'est une fonctionnalité obligatoire.

OG doit proposer le service ou le département hospitalier pertinent en fonction :
- De la catégorie de l'intervention transmise.
- Des informations opérationnelles autorisées.
- Des services configurés dans l'établissement.
- Des règles de correspondance validées par l'établissement.
- Des capacités et ressources déclarées disponibles.
- Des limites et particularités de l'établissement.

Exemples de services configurables :
- Urgence générale.
- Réanimation / soins intensifs.
- Cardiologie.
- Neurologie / AVC.
- Traumatologie.
- Pédiatrie.
- Autres services définis par l'établissement.

La proposition d'OG doit apparaître clairement sur l'écran de l'hôpital.

L'hôpital doit pouvoir :
- Consulter la proposition.
- La confirmer.
- La modifier.
- La refuser.
- Indiquer un autre service.
- Signaler que la préparation est en cours.

**OG ne pose aucun diagnostic, ne réalise pas de triage médical autonome, ne décide pas de la destination de l'ambulance et n'affecte pas définitivement un patient à un département.**

La destination demeure déterminée par les professionnels et les protocoles applicables.

## 2.3 Interface OG

OG doit conserver une interface cohérente avec celle déjà présente dans Arrimo.

Ne pas créer un nouvel assistant concurrent, un autre robot ou plusieurs intelligences artificielles indépendantes.

Il faut réutiliser OG et son architecture actuelle.

Si plusieurs modules transmettent des événements à OG, ils doivent passer par une architecture commune et sécurisée, sans duplication de logique.

---

# 3. ARCHITECTURE FONCTIONNELLE À CONSTRUIRE

Le chantier doit comprendre les composantes suivantes :

1. Arrimo Liaison Secouriste.
2. Arrimo Véhicule.
3. Arrimo Préalerte.
4. Arrimo Hôpital.
5. Arrimo Préparation Hospitalière.
6. Arrimo Disponibilités.
7. Arrimo Connect.
8. Arrimo SH – administration et supervision.

Ces composantes doivent être intégrées à l'architecture existante d'Arrimo.

Il ne faut pas créer huit applications indépendantes.

Les interfaces peuvent être distinctes selon les utilisateurs, mais les données, services, règles métier, authentification et événements doivent être mutualisés lorsque l'architecture actuelle le permet.

---

# 4. MODULE 1 — ARRIMO LIAISON SECOURISTE

## 4.1 Objectif

Créer une interface permettant aux équipes ambulancières autorisées de communiquer avec les établissements hospitaliers à travers Arrimo.

Les ambulanciers constituent les utilisateurs principaux de ce module.

Le chantier actuel ne comprend pas de tableau de bord dédié aux pompiers ni de nouvelle plateforme pour les centres de communication santé.

Les CCS conservent leurs outils habituels. Toute intégration éventuelle avec leurs systèmes devra faire l'objet d'une autorisation et d'une validation technique distinctes.

## 4.2 Fonctions

- Authentification sécurisée.
- Identification de l'organisation et de l'équipe.
- Identification du véhicule.
- Ouverture d'une intervention.
- Transmission d'une préalerte.
- Mise à jour de la priorité transmise par le professionnel.
- Transmission des informations opérationnelles autorisées.
- Transmission du temps estimé d'arrivée.
- Consultation des capacités hospitalières accessibles.
- Réception des notifications de l'hôpital.
- Consultation des accusés de réception.
- Mise à jour des événements de l'intervention.
- Signalement d'un changement de destination décidé par les professionnels.
- Confirmation de l'arrivée.
- Confirmation de la remise du patient.

## 4.3 Informations d'une intervention

Une intervention peut comporter :

- Identifiant unique.
- Identifiant de mission provenant du système partenaire, si disponible.
- Identifiant du véhicule.
- Identifiant de l'équipe.
- Date et heure de création.
- Catégorie de l'intervention.
- Priorité renseignée par le professionnel.
- Informations patient autorisées.
- Informations utiles à la préparation de l'accueil.
- Établissement destinataire.
- Heure estimée d'arrivée.
- État de transmission.
- Historique des événements.

Les données médicales doivent être limitées au strict nécessaire et accessibles uniquement aux utilisateurs autorisés.

## 4.4 Simplicité d'utilisation

L'écran ambulancier doit être particulièrement simple.

Un professionnel en intervention ne doit pas avoir à remplir un long formulaire ou naviguer dans plusieurs menus.

Prévoir :
- Des actions principales immédiatement visibles.
- Des champs courts.
- Une interface adaptée aux tablettes et écrans embarqués.
- Une lisibilité élevée.
- Des confirmations claires.
- Un fonctionnement adapté aux connexions instables.

---

# 5. MODULE 2 — ARRIMO VÉHICULE

## 5.1 Objectif

Créer une interface embarquée destinée aux équipes ambulancières.

Il peut s'agir d'une application web progressive (PWA) ou d'une interface web responsive, selon les choix techniques déjà présents dans Arrimo.

Ne pas développer une application native séparée sans nécessité démontrée.

## 5.2 Écran principal

L'écran doit afficher :

- Équipe connectée.
- Véhicule actif.
- Intervention en cours.
- Statut de l'intervention.
- Préalerte en cours.
- Établissement destinataire confirmé par les professionnels.
- Temps estimé d'arrivée.
- État de la transmission.
- Accusé de réception de l'hôpital.
- Notifications importantes.
- État de la connexion.

## 5.3 Actions principales

- Démarrer une intervention dans Arrimo si autorisé.
- Créer une préalerte.
- Transmettre les informations autorisées.
- Mettre à jour les informations.
- Signaler un retard.
- Signaler une modification de destination.
- Confirmer l'arrivée à l'hôpital.
- Confirmer la remise du patient.
- Consulter l'état de la préalerte.

Les changements de destination doivent être initiés ou confirmés par les professionnels responsables.

Arrimo ne doit jamais modifier automatiquement la destination.

## 5.4 Géolocalisation

Prévoir la possibilité d'utiliser une position GPS lorsque :
- L'utilisateur a donné son autorisation.
- L'organisation l'autorise.
- Le cadre légal et les règles de protection des données le permettent.

La position sert à améliorer l'estimation du temps d'arrivée et le suivi opérationnel.

Prévoir une fréquence configurable, par exemple toutes les 30 secondes lorsque cela est autorisé et utile.

La géolocalisation ne doit pas devenir une condition obligatoire au fonctionnement de la préalerte.

---

# 6. MODULE 3 — ARRIMO PRÉALERTE

## 6.1 Objectif

C'est le moteur central de transmission des informations entre l'ambulance et l'hôpital.

Il doit garantir qu'une préalerte soit correctement créée, transmise, reçue, suivie et historisée.

## 6.2 Création

Lorsqu'une équipe ambulancière transmet une préalerte, Arrimo crée un dossier avec :

- Un identifiant unique.
- L'identifiant de l'intervention.
- L'identifiant de l'organisation émettrice.
- L'établissement destinataire.
- Les informations opérationnelles autorisées.
- La priorité déclarée.
- Le service éventuellement proposé par OG.
- L'heure estimée d'arrivée.
- La date et l'heure de création.
- L'état de transmission.

## 6.3 Cycle de vie

Prévoir les statuts suivants :

1. Brouillon.
2. Préalerte envoyée.
3. Transmission en attente.
4. Réception technique confirmée.
5. Préalerte consultée par l'hôpital.
6. Prise en compte humaine confirmée.
7. Préparation hospitalière en cours.
8. Ambulance arrivée.
9. Patient remis.
10. Préalerte clôturée.

Prévoir également :
- Erreur de transmission.
- Préalerte annulée.
- Préalerte expirée.
- Destination modifiée.
- Préalerte remplacée.

Les statuts doivent être horodatés et associés à l'utilisateur ou au système qui a effectué l'action.

## 6.4 Deux types de confirmation

Il est indispensable de distinguer :

**Confirmation technique :** le système hospitalier a bien reçu le message.

**Confirmation humaine :** un professionnel autorisé a consulté la préalerte et en a pris connaissance.

Un message reçu par le serveur ne signifie pas que l'équipe hospitalière a effectivement pris connaissance de l'arrivée.

## 6.5 Modification de destination

Lorsqu'un changement de destination est décidé par les professionnels :

- Conserver l'ancienne préalerte.
- Enregistrer l'événement de changement.
- Informer l'ancien établissement si nécessaire.
- Créer ou transmettre la préalerte au nouvel établissement.
- Conserver l'historique complet.
- Afficher clairement la destination actuellement confirmée.

Ne jamais supprimer silencieusement une ancienne préalerte.

---

# 7. MODULE 4 — ARRIMO HÔPITAL

## 7.1 Objectif

L'hôpital doit être informé de l'arrivée prochaine d'une ambulance suffisamment tôt pour anticiper l'accueil du patient.

C'est une fonctionnalité essentielle du projet.

L'établissement ne doit pas découvrir l'arrivée de l'ambulance uniquement au moment où celle-ci arrive physiquement.

L'hôpital doit disposer d'un tableau de bord dédié aux préalertes ambulancières.

## 7.2 Tableau de bord des arrivées

Créer une vue centralisée affichant :

- Ambulances attendues.
- Préalertes entrantes.
- Préalertes prioritaires.
- Temps estimés avant arrivée.
- Catégories d'intervention.
- Informations patient autorisées.
- Services potentiellement concernés.
- État de réception.
- État de préparation.
- Changements de destination.
- Historique des arrivées.

Les préalertes prioritaires doivent être visuellement identifiables sans surcharger l'interface.

Prévoir des notifications visuelles et sonores configurables.

## 7.3 Fiche détaillée d'une préalerte

Lorsqu'un professionnel hospitalier ouvre une préalerte, il doit retrouver :

- Identifiant de la préalerte.
- Identifiant de l'intervention.
- Véhicule et équipe.
- Heure d'envoi.
- Heure estimée d'arrivée.
- Priorité transmise par l'équipe.
- Catégorie de l'intervention.
- Informations patient autorisées.
- Service proposé par OG.
- Justification opérationnelle de la proposition, lorsque disponible.
- Informations de capacité pertinentes.
- État de la préparation.
- Historique des événements.

## 7.4 Accusé de réception

L'établissement doit pouvoir :

- Confirmer la réception technique lorsque son système le permet.
- Confirmer la prise en compte humaine.
- Signaler que la préalerte est consultée.
- Indiquer qu'une préparation est en cours.
- Indiquer que la préparation est terminée.
- Signaler un problème ou une information manquante.

La réception doit être visible côté ambulancier.

---

# 8. MODULE 5 — ARRIMO PRÉPARATION HOSPITALIÈRE

## 8.1 Objectif

Cette fonctionnalité doit être intégrée à Arrimo Hôpital.

Elle permet à l'établissement de commencer à préparer la réception du patient avant l'arrivée de l'ambulance.

La préparation doit tenir compte de la priorité transmise, des informations disponibles, de la proposition de service d'OG et des protocoles de l'établissement.

## 8.2 Fonctionnement

Dès qu'une préalerte est reçue :

1. Arrimo notifie l'établissement.
2. OG analyse les informations opérationnelles autorisées.
3. OG propose le service ou département potentiellement concerné.
4. L'équipe hospitalière consulte la préalerte.
5. L'équipe valide ou modifie le service proposé.
6. L'établissement peut commencer sa préparation.
7. Les professionnels mettent à jour l'état de préparation.
8. L'arrivée de l'ambulance est enregistrée.
9. La remise du patient est confirmée.

## 8.3 États de préparation

Prévoir les états suivants :

- Non consultée.
- À prendre en compte.
- Analyse en cours.
- Service à confirmer.
- Préparation à effectuer.
- Préparation en cours.
- Préparation terminée.
- Patient arrivé.
- Patient remis.
- Préparation annulée ou modifiée.

Ces états doivent être personnalisables par établissement dans les limites de l'architecture commune.

## 8.4 Préparation selon la priorité

Les règles de notification et de préparation doivent être configurables par établissement.

Exemple de fonctionnement :

- Préalerte prioritaire : notification immédiate aux personnes ou services concernés selon les règles locales.
- Préalerte intermédiaire : notification et anticipation de l'accueil selon le protocole applicable.
- Préalerte non urgente : information anticipée et organisation de l'accueil.

Ces catégories sont des exemples d'organisation opérationnelle, et non un algorithme de triage médical.

OG peut attirer l'attention sur les situations nécessitant une prise en compte rapide, mais les équipes hospitalières restent responsables de leur évaluation et de leur préparation.

## 8.5 Ressources à préparer

Selon les informations disponibles et les règles de l'établissement, la plateforme peut signaler des besoins potentiels concernant :

- Une place de réception.
- Une civière.
- Un espace d'accueil adapté.
- Un équipement déclaré nécessaire par le personnel autorisé.
- La disponibilité du service concerné.
- La coordination avec une équipe hospitalière.

Arrimo ne doit pas réserver automatiquement un lit ou affecter une ressource clinique sans validation humaine.

---

# 9. MODULE 6 — ARRIMO DISPONIBILITÉS

## 9.1 Objectif

Permettre de consulter les capacités opérationnelles déclarées par les établissements partenaires.

Les disponibilités doivent aider les professionnels et les équipes hospitalières à mieux anticiper les arrivées.

## 9.2 Données à gérer

Pour chaque établissement, prévoir :

**Urgences :**
- Ouvert.
- Capacité limitée.
- Saturation déclarée.
- Situation particulière ou délestage déclaré.

**Civières :**
- Nombre total.
- Nombre occupé.
- Nombre disponible.
- Date et heure de mise à jour.

**Lits :**
- Lits par unité, lorsque l'information est autorisée.
- Lits occupés.
- Lits disponibles.
- Niveau de soins concerné.

**Services :**
- Services ouverts.
- Services temporairement indisponibles.
- Capacités déclarées.
- Ressources particulières.

## 9.3 Distinctions obligatoires

Ne jamais confondre :

- Capacité d'accueil des urgences.
- Disponibilité d'une civière.
- Disponibilité d'un lit d'hospitalisation.
- Disponibilité d'un lit de soins intensifs.
- Disponibilité d'une chambre en CHSLD ou en RPA.

Un lit disponible ne signifie pas automatiquement qu'un établissement peut recevoir un patient.

Il faut tenir compte des ressources humaines, des équipements, du niveau de soins, des règles d'admission et de la confirmation de l'établissement.

## 9.4 Fiabilité des données

Chaque donnée doit comporter :

- Sa source.
- Son établissement.
- Sa date de mise à jour.
- Son heure de mise à jour.
- Son statut de synchronisation.
- Son niveau de fiabilité lorsque celui-ci peut être établi.

Une donnée ancienne ne doit jamais être présentée comme une disponibilité actuelle confirmée.

Prévoir une alerte de données périmées, avec un seuil configurable. Quinze minutes peuvent servir de valeur initiale à tester, mais ce seuil doit être validé avec les établissements.

## 9.5 Vue des établissements partenaires

Créer une interface permettant aux utilisateurs autorisés de consulter les établissements accessibles.

Les informations doivent être filtrables selon :
- La proximité.
- Le type d'établissement.
- Le statut des urgences.
- Les services disponibles.
- La fraîcheur des données.

Cette consultation ne doit pas décider automatiquement de la destination d'une ambulance.

---

# 10. IDENTIFICATION DU PATIENT ET CONNEXION AUX LOGICIELS HOSPITALIERS

## 10.1 Objectif

Arrimo doit pouvoir récupérer certaines informations patient depuis les logiciels numériques hospitaliers lorsque l'établissement a autorisé l'intégration.

C'est notamment le rôle d'Arrimo Connect.

L'objectif est de permettre à l'hôpital de retrouver ou de faire correspondre le dossier du patient sans imposer aux ambulanciers un accès général aux dossiers médicaux.

## 10.2 Sources possibles

Prévoir une architecture de connexion aux systèmes partenaires, notamment :

- Epic.
- Systèmes numériques des établissements.
- Plateformes et systèmes relevant du DSN, selon leur architecture réelle.
- Autres dossiers patients informatisés.
- Interfaces hospitalières autorisées.

**Attention : ne pas présumer que le DSN correspond à une API unique accessible ou que tous les établissements disposent des mêmes interfaces.**

Claude Code doit construire une architecture d'intégration adaptable, mais ne doit pas inventer de connexion réelle ou prétendre disposer d'un accès à Epic ou au DSN sans identifiants, documentation et autorisation.

## 10.3 Comment Arrimo obtient les informations patient

Le parcours recherché est le suivant :

1. Une intervention est créée par l'équipe ambulancière.
2. Une préalerte est transmise à l'établissement.
3. Arrimo Connect reçoit les informations autorisées.
4. Le connecteur partenaire peut interroger le système hospitalier selon les droits accordés.
5. Le système hospitalier effectue ou propose une correspondance avec un dossier existant.
6. Arrimo reçoit uniquement les informations permises par l'intégration.
7. OG analyse les informations opérationnelles disponibles.
8. L'hôpital voit les informations dans sa propre interface selon ses droits d'accès.

## 10.4 Informations potentiellement récupérables

Sous réserve des autorisations et des capacités réelles du système partenaire :

- Nom et prénom.
- Date de naissance.
- Identifiant patient dans le système hospitalier.
- Identifiant de séjour ou de rencontre.
- Établissement de rattachement.
- Informations administratives nécessaires.
- Informations cliniques strictement nécessaires et autorisées.
- Service ou unité concerné, lorsque disponible.

Ne pas collecter toutes les données d'un dossier médical simplement parce qu'une API les expose.

## 10.5 Correspondance du patient

Le système doit utiliser des identifiants fiables et les règles de correspondance validées par le partenaire.

Ne pas identifier automatiquement un patient uniquement à partir d'un nom ressemblant, d'un âge approximatif ou d'informations incertaines.

Prévoir trois situations :

**Correspondance confirmée :**
Le système partenaire confirme le dossier selon ses règles.

**Correspondance incertaine :**
Une vérification humaine est nécessaire.

**Aucune correspondance :**
La préalerte continue avec un identifiant temporaire d'intervention. L'hôpital pourra compléter l'identification selon ses procédures.

Il ne faut jamais bloquer une préalerte parce que le patient n'a pas encore été identifié dans le dossier hospitalier.

## 10.6 Protection des accès

Les ambulanciers ne doivent pas recevoir automatiquement un accès général à Epic ou au dossier patient.

L'interface embarquée doit afficher uniquement les informations nécessaires à leur mission et autorisées par l'organisation.

Les informations plus détaillées doivent être accessibles aux professionnels hospitaliers autorisés, dans le système et le contexte appropriés.

---

# 11. MODULE 7 — ARRIMO CONNECT

## 11.1 Objectif

Construire la couche d'intégration entre Arrimo et les systèmes externes.

Arrimo Connect doit être réutilisable pour d'autres intégrations futures.

## 11.2 Protocoles et technologies à prévoir

Selon les possibilités réelles des partenaires :

- API REST.
- HL7 v2.
- FHIR.
- Webhooks.
- Échanges sécurisés de fichiers.
- SFTP.
- Interfaces intermédiaires.
- Autres protocoles documentés par les partenaires.

Prévoir notamment l'étude des ressources FHIR :
- Patient.
- Encounter.
- Location.
- Organization.
- Practitioner.
- HealthcareService.

Les événements HL7 v2 à étudier peuvent inclure :
- ADT A01.
- ADT A02.
- ADT A03.
- ADT A04.
- ADT A08.
- ADT A11.
- ADT A12.
- ADT A13.
- ADT A16.

Ne pas implémenter tous les événements sans analyser leur pertinence pour le parcours préhospitalier et les systèmes partenaires.

## 11.3 API Arrimo à prévoir

Les routes ci-dessous sont des propositions fonctionnelles. Elles doivent être adaptées aux conventions existantes du dépôt.

- `GET /api/v1/urgences`
- `GET /api/v1/urgences/:id/capacites`
- `POST /api/v1/prealertes`
- `GET /api/v1/prealertes`
- `GET /api/v1/prealertes/:id`
- `PATCH /api/v1/prealertes/:id`
- `POST /api/v1/prealertes/:id/acknowledgements`
- `POST /api/v1/prealertes/:id/events`
- `POST /api/v1/prealertes/:id/arrival`
- `POST /api/v1/prealertes/:id/handover`
- `GET /api/v1/organizations/:id/departments`
- `GET /api/v1/integrations/status`

Les routes réelles doivent respecter le routage, la version et les conventions déjà en place.

## 11.4 Sécurité des intégrations

Prévoir :
- OAuth 2.0 ou mécanisme équivalent adapté au partenaire.
- Authentification des systèmes.
- Contrôle des permissions.
- TLS.
- Signature HMAC des webhooks lorsque pertinent.
- Clés d'idempotence.
- Gestion des erreurs.
- Journalisation sécurisée.
- Rotation des secrets.
- Limitation des requêtes.
- Gestion des nouvelles tentatives.
- File d'échec (dead-letter queue) si l'architecture le justifie.

## 11.5 Simulation

Pour la démonstration, construire des connecteurs simulés :

- Epic simulé.
- Système hospitalier simulé.
- Échange FHIR simulé.
- Messages HL7 simulés.
- Données de capacité simulées.

L'interface doit clairement indiquer qu'il s'agit d'une simulation.

Ne jamais présenter une intégration simulée comme une connexion réelle.

---

# 12. MODULE 8 — ARRIMO SH : ADMINISTRATION ET SUPERVISION

## 12.1 Objectif

Intégrer la gestion du préhospitalier dans Arrimo SH en respectant son architecture actuelle.

Avant toute modification, Claude Code doit comprendre exactement le rôle et la structure d'Arrimo SH dans le dépôt.

## 12.2 Administration

Les administrateurs autorisés doivent pouvoir gérer :

- Les organisations.
- Les établissements.
- Les utilisateurs.
- Les équipes ambulancières.
- Les véhicules.
- Les services et départements hospitaliers.
- Les rôles et permissions.
- Les règles de notification.
- Les connecteurs externes.
- Les paramètres des préalertes.
- Les règles de disponibilité.
- Les configurations de démonstration.

## 12.3 Supervision

Créer une vue de supervision permettant de consulter :

- État des API.
- État des connecteurs.
- Synchronisations réussies.
- Synchronisations en attente.
- Messages en erreur.
- Préalertes non délivrées.
- Notifications en attente.
- État des files de traitement.
- État des services OG.
- Données périmées.
- Événements techniques.
- Historique des incidents.

Ne pas exposer les données médicales aux administrateurs techniques qui n'en ont pas besoin.

---

# 13. CONNEXION AUX AUTRES MODULES ARRIMO

Arrimo Préhospitalier ne doit pas fonctionner comme une plateforme isolée.

Il doit réutiliser et connecter les fonctionnalités existantes.

## 13.1 Liaison Hôpital

Réutiliser les établissements, les relations interhospitalières, les utilisateurs et les mécanismes existants.

## 13.2 Gestion des lits

Lorsque le parcours nécessite une hospitalisation, permettre la continuité vers les fonctions existantes de gestion des lits.

Ne pas réserver automatiquement un lit sur la seule base d'une préalerte.

Toute demande ou confirmation de lit doit respecter les règles et validations de l'établissement.

## 13.3 Gestion des transferts

Si le patient doit ensuite être transféré entre établissements, la continuité doit pouvoir être assurée avec les fonctionnalités de transfert existantes.

## 13.4 Liaison CHSLD

Ne pas mélanger automatiquement les flux ambulanciers et les flux CHSLD.

Une connexion peut être prévue lorsque les parcours de transfert le justifient, mais les règles métier doivent rester distinctes.

## 13.5 Notifications

Réutiliser le service de notifications existant s'il existe.

Éviter de créer plusieurs moteurs de notifications concurrents.

## 13.6 OG

OG doit disposer d'une vue cohérente de l'ensemble des événements autorisés, avec une séparation stricte des organisations et des droits d'accès.

---

# 14. PARCOURS COMPLET D'UNE INTERVENTION

Voici le scénario principal que le système doit permettre de démontrer.

### Étape 1 — Intervention ambulancière

Une équipe ambulancière est en intervention.

Elle utilise ses outils et ses protocoles habituels. Arrimo intervient en complément.

### Étape 2 — Préalerte

L'équipe transmet à Arrimo les informations opérationnelles autorisées.

La préalerte est créée et reçoit un identifiant unique.

### Étape 3 — Analyse OG

OG :
- Analyse les informations.
- Prépare une synthèse.
- Consulte les services configurés.
- Consulte les capacités hospitalières accessibles.
- Propose un service potentiellement concerné.
- Identifie les informations manquantes.

### Étape 4 — Notification hospitalière

L'établissement destinataire reçoit une notification.

La préalerte apparaît sur son tableau de bord.

### Étape 5 — Préparation hospitalière

L'équipe hospitalière :
- Consulte la préalerte.
- Prend connaissance de la priorité transmise.
- Vérifie les informations disponibles.
- Consulte la proposition de service d'OG.
- Confirme ou modifie le service concerné.
- Commence la préparation de l'accueil selon ses protocoles.

### Étape 6 — Suivi de l'approche

Arrimo met à jour le temps estimé d'arrivée lorsque les informations sont disponibles.

Les changements importants sont transmis aux personnes autorisées.

### Étape 7 — Arrivée

L'équipe ambulancière confirme l'arrivée.

L'hôpital voit le changement de statut.

### Étape 8 — Remise du patient

La remise est confirmée par les professionnels concernés.

La préalerte est clôturée et son historique est conservé selon les règles de conservation validées.

### Étape 9 — Continuité

Si une hospitalisation ou un transfert est nécessaire, les modules Arrimo correspondants peuvent prendre le relais.

---

# 15. GESTION DES UTILISATEURS ET DES PERMISSIONS

Prévoir des rôles distincts.

### Ambulancier
- Créer une préalerte.
- Transmettre des informations autorisées.
- Consulter l'état de réception.
- Mettre à jour son intervention.
- Confirmer l'arrivée et la remise.

### Personnel de réception hospitalière
- Voir les préalertes autorisées.
- Confirmer leur prise en compte.
- Mettre à jour les états de réception.

### Personnel hospitalier concerné
- Consulter les préalertes relevant de ses fonctions.
- Consulter les informations autorisées.
- Confirmer ou modifier la préparation.
- Valider le service concerné selon les règles locales.

### Gestionnaire hospitalier
- Configurer les services.
- Gérer les capacités déclarées.
- Gérer les utilisateurs et les permissions autorisées.
- Consulter les historiques opérationnels.

### Administrateur Arrimo
- Gérer les organisations et les configurations.
- Superviser les intégrations.
- Consulter les journaux techniques autorisés.

### OG
OG n'est pas un utilisateur humain disposant de permissions universelles.

Ses accès doivent être limités par des permissions techniques explicites, au contexte de l'organisation et aux données nécessaires à chaque fonction.

**Règle obligatoire : isolation stricte entre les organisations.**

Un établissement ne doit jamais accéder aux informations d'un autre établissement sans autorisation explicite.

---

# 16. SÉCURITÉ, CONFIDENTIALITÉ ET CONFORMITÉ

Le projet est destiné à un environnement de santé. La sécurité doit être intégrée dès la conception.

Prévoir :

- Contrôle d'accès par rôle et organisation.
- Authentification sécurisée.
- Gestion des sessions.
- Chiffrement des communications.
- Protection des données stockées.
- Journal d'audit.
- Gestion des consentements et autorisations lorsque requis.
- Minimisation des données.
- Séparation des environnements.
- Protection contre les accès non autorisés.
- Protection des API.
- Gestion sécurisée des secrets.
- Sauvegardes.
- Politique de conservation et suppression.
- Procédures de gestion des incidents.
- Tests d'isolation multi-tenant.

Pour un déploiement québécois, étudier et faire valider les exigences applicables, notamment la Loi 25, les évaluations des facteurs relatifs à la vie privée (EFVP), les obligations contractuelles des établissements et les exigences de Santé Québec.

Les données de santé québécoises doivent être hébergées et traitées dans un environnement conforme aux exigences applicables et aux accords conclus avec les partenaires.

Ne pas considérer une durée de conservation ou un emplacement d'hébergement comme validé sans décision documentée.

Les journaux techniques ne doivent pas contenir de données de santé identifiantes inutilement.

---

# 17. MODE DÉGRADÉ ET FIABILITÉ

Le système doit pouvoir gérer :

- Une connexion réseau instable.
- Une indisponibilité temporaire d'un connecteur.
- Une erreur d'API.
- Une notification non délivrée.
- Une réponse hospitalière tardive.
- Un doublon de message.
- Une interruption de service.

Prévoir :
- File d'envoi sécurisée.
- Synchronisation différée.
- Idempotence.
- Nouvelles tentatives contrôlées.
- Détection des doublons.
- Affichage du statut de synchronisation.
- Alertes d'échec.
- Historique des erreurs.
- Procédure de reprise.

Une préalerte ne doit pas être considérée comme reçue tant que la réception n'a pas été confirmée.

Arrimo ne doit jamais être le seul moyen de communication entre les professionnels.

En cas de panne, les procédures habituelles des services ambulanciers et hospitaliers continuent de s'appliquer.

---

# 18. ENVIRONNEMENT DE DÉMONSTRATION

Créer une démonstration complète et réaliste, avec des données entièrement fictives.

La démonstration doit permettre de présenter tout le parcours sans dépendre d'une connexion réelle à Epic, au DSN ou à un système ambulancier.

## 18.1 Données de démonstration

Créer :
- 2 ambulances.
- 2 équipes ambulancières.
- 3 établissements hospitaliers.
- Plusieurs services par établissement.
- Des capacités différentes.
- Des préalertes de différentes priorités.
- Des arrivées en cours.
- Des notifications.
- Des confirmations hospitalières.
- Des situations de capacité limitée.
- Des changements de destination simulés.
- Des correspondances patient confirmées, incertaines et absentes.

## 18.2 Scénarios à démontrer

**Scénario A : arrivée anticipée**

Une ambulance transmet une préalerte. L'hôpital est averti, consulte les informations et prépare l'accueil.

**Scénario B : priorité élevée**

Une préalerte prioritaire est transmise. L'hôpital reçoit une notification adaptée à ses règles et peut commencer sa préparation.

**Scénario C : proposition OG**

OG analyse les informations autorisées et propose un service hospitalier. L'équipe hospitalière confirme ou modifie la proposition.

**Scénario D : patient identifié**

Le système simulé retourne une correspondance patient confirmée. L'information est affichée uniquement aux utilisateurs autorisés.

**Scénario E : patient non identifié**

La préalerte continue avec un identifiant temporaire. L'accueil n'est pas bloqué.

**Scénario F : changement de destination**

Les professionnels décident d'une autre destination. L'ancien établissement est informé selon les règles prévues et le nouvel établissement reçoit une nouvelle préalerte.

**Scénario G : données de capacité périmées**

OG signale que les informations de capacité ne sont plus suffisamment récentes.

**Scénario H : problème réseau**

La préalerte est mise en attente, puis synchronisée lorsque le réseau revient. Aucun doublon ne doit être créé.

## 18.3 Séparation des données

Les données de démonstration doivent être isolées des données de production.

Aucune donnée réelle de patient ne doit être utilisée pour les démonstrations.

---

# 19. INTERFACE ET EXPÉRIENCE UTILISATEUR

L'interface doit respecter l'identité visuelle actuelle d'Arrimo.

Ne pas reconstruire toute l'identité visuelle sans raison.

Les interfaces doivent être modernes, professionnelles, sobres et faciles à utiliser.

## Arrimo Véhicule
Interface très simple, adaptée aux tablettes et écrans embarqués.

## Arrimo Hôpital
Tableau de bord de supervision des arrivées, préalertes et préparations.

## Arrimo Disponibilités
Vue des établissements et de leurs capacités déclarées.

## Arrimo SH
Gestion des configurations, des organisations, des utilisateurs et des intégrations.

## OG
Conserver l'assistant central actuel et son identité visuelle.

Éviter les informations redondantes, les tableaux trop chargés et les notifications excessives.

Toutes les vues doivent être adaptées aux écrans d'ordinateur et de tablette. Les interfaces mobiles doivent être utilisables lorsque le rôle le nécessite.

---

# 20. TESTS ET CRITÈRES D'ACCEPTATION

Claude Code doit découvrir et exécuter les tests réellement présents dans le dépôt avant toute modification.

Ne pas supposer que les anciens nombres de tests annoncés sont toujours exacts.

Créer des tests couvrant au minimum les points suivants.

### Fonctionnels
- Création d'une préalerte.
- Transmission.
- Accusé de réception technique.
- Confirmation humaine.
- Affichage côté hôpital.
- Préparation hospitalière.
- Proposition de service par OG.
- Validation humaine du service.
- Identification patient simulée.
- Absence de correspondance patient.
- Changement de destination.
- Arrivée et remise du patient.
- Clôture.

### Sécurité
- Isolation entre organisations.
- Contrôle des rôles.
- Contrôle des accès aux données patient.
- Absence de fuite de données dans les logs.
- Protection des API.
- Protection des connecteurs.
- Gestion des sessions et des secrets.

### Fiabilité
- Messages dupliqués.
- Messages perdus.
- Erreurs de connexion.
- Reprise après interruption.
- Synchronisation différée.
- Données de capacité périmées.
- Notification non délivrée.
- Indisponibilité temporaire d'un connecteur.

### Performance
Prévoir des objectifs de performance initiaux à mesurer, notamment :
- Affichage rapide du tableau de bord.
- Transmission rapide des préalertes.
- Actualisation fiable des statuts.
- Traitement des événements sans doublons.

Les objectifs chiffrés définitifs doivent être validés selon l'environnement réel et les partenaires.

### Tests d'intégration
Créer des tests simulant :
- Un système Epic.
- Un connecteur FHIR.
- Un message HL7.
- Une API hospitalière.
- Un système ambulancier.
- Une indisponibilité de partenaire.

Ne jamais confondre réussite d'un test simulé et validation d'une intégration réelle.

---

# 21. PLAN DE CONSTRUCTION PAR PHASES

Le développement doit être progressif.

## PHASE 0 — AUDIT COMPLET DU DÉPÔT

Avant toute modification :

- Identifier l'architecture actuelle.
- Identifier le frontend et le backend.
- Identifier les bases de données.
- Identifier les API.
- Identifier les modules existants.
- Identifier le fonctionnement actuel d'OG.
- Identifier Arrimo SH.
- Identifier les systèmes d'authentification.
- Identifier les rôles et permissions.
- Identifier les services de notification.
- Identifier les composants de gestion des lits.
- Identifier les fonctions de disponibilité.
- Identifier les tests.
- Identifier les déploiements et services actifs.
- Identifier les éventuels modules déjà commencés pour le préhospitalier.

Produire un rapport d'audit avec :
1. Architecture réelle.
2. Modules réutilisables.
3. Fonctions déjà présentes.
4. Fonctions manquantes.
5. Risques techniques.
6. Risques de sécurité.
7. Modifications nécessaires.
8. Ordre recommandé de construction.
9. Liste des fichiers et composants concernés.

**Ne pas modifier le code, la base de données, les services ou le serveur pendant cette première phase. Présenter le rapport et attendre la validation avant de commencer les modifications.**

## PHASE 1 — SOCLE PRÉHOSPITALIER

Construire :
- Structures de données.
- Organisations et permissions.
- Interventions.
- Préalertes.
- Historique des événements.
- Statuts.
- Notifications.
- Connexion avec OG.

## PHASE 2 — ARRIMO VÉHICULE

Construire l'interface ambulancière :
- Connexion.
- Véhicule.
- Équipe.
- Intervention.
- Préalerte.
- Consultation des statuts.
- Confirmation d'arrivée.
- Confirmation de remise.

## PHASE 3 — ARRIMO HÔPITAL

Construire :
- Tableau de bord des préalertes.
- Notifications.
- Fiches détaillées.
- Accusés de réception.
- Historique.
- Suivi des arrivées.

## PHASE 4 — PRÉPARATION HOSPITALIÈRE ET OG

Construire :
- Proposition de service par OG.
- Affichage de la synthèse.
- Validation humaine.
- États de préparation.
- Notifications adaptées à la priorité.
- Suivi de la préparation jusqu'à l'arrivée.

## PHASE 5 — ARRIMO DISPONIBILITÉS

Construire :
- Capacités d'urgence.
- Civières.
- Lits et unités.
- Services.
- Horodatage.
- Fraîcheur des données.
- Vue des établissements partenaires.

## PHASE 6 — ARRIMO CONNECT

Construire les interfaces génériques et les connecteurs simulés.

Préparer l'architecture pour les futures intégrations Epic, DSN et systèmes ambulanciers.

## PHASE 7 — INTÉGRATION ARRIMO SH

Intégrer l'administration et la supervision au système existant.

## PHASE 8 — TESTS ET DÉMONSTRATION

Effectuer les tests fonctionnels, techniques et de sécurité.

Préparer une démonstration complète du parcours ambulance → OG → hôpital → préparation → arrivée → remise.

## PHASE 9 — PRÉPARATION DU PILOTE

Documenter les éléments nécessaires :
- Organisation pilote.
- Utilisateurs autorisés.
- Processus opérationnels.
- Autorisations.
- Intégrations.
- EFVP.
- Formation.
- Support.
- Procédures de secours.
- Critères de validation.

Le passage en production et le déploiement sur le serveur nécessitent une validation explicite.

---

# 22. DIRECTIVES TECHNIQUES IMPÉRATIVES POUR CLAUDE CODE

Tu interviens sur un projet Arrimo existant.

Tu ne dois pas considérer ce chantier comme une application neuve.

**RÈGLE 1 — AUDITER AVANT DE CONSTRUIRE**

Commence par analyser intégralement le dépôt, son architecture, ses modules, ses API, ses bases de données et son fonctionnement réel.

Ne modifie rien avant d'avoir présenté le rapport d'audit et obtenu l'accord.

**RÈGLE 2 — RÉUTILISER AVANT DE RECRÉER**

Avant de développer un service, vérifie s'il existe déjà.

Réutilise :
- L'authentification.
- Les organisations.
- Les utilisateurs.
- Les permissions.
- Les établissements.
- Les notifications.
- Les services OG.
- Les fonctionnalités de gestion des lits.
- Les fonctions de transfert.
- Les composants graphiques.
- Les API existantes.

Ne crée pas de doublons.

**RÈGLE 3 — OG EST CENTRAL**

Ne construis pas une deuxième intelligence artificielle.

Connecte le préhospitalier à OG et respecte son architecture actuelle.

Toute nouvelle capacité d'OG doit être documentée et testée.

**RÈGLE 4 — PROTÉGER L'EXISTANT**

Ne supprime aucune fonctionnalité existante.

Ne remplace pas une architecture qui fonctionne sans justification technique.

Ne casse pas les interfaces actuelles.

Ne modifie pas les configurations de production sans autorisation.

**RÈGLE 5 — BASE DE DONNÉES**

Étudier le schéma existant avant toute migration.

Créer des migrations versionnées, réversibles lorsque possible, et documentées.

Ne pas supprimer ou écraser des données existantes.

**RÈGLE 6 — INTÉGRATIONS**

Ne prétends jamais qu'une connexion Epic, DSN ou ambulancière est réelle sans documentation, autorisation et test avec le partenaire.

Utilise des simulateurs clairement identifiés pour la démonstration.

**RÈGLE 7 — SÉCURITÉ**

Aucune fuite entre établissements.

Aucun accès général aux dossiers patients.

Aucune donnée sensible dans les logs techniques.

Aucune décision médicale ou destination automatique par OG.

**RÈGLE 8 — QUALITÉ**

Après chaque phase :
- Exécuter les tests.
- Corriger les régressions.
- Vérifier les permissions.
- Vérifier les interfaces.
- Documenter les changements.
- Présenter les résultats.

Ne déclare pas une fonctionnalité terminée si elle n'est que visuelle ou simulée.

**RÈGLE 9 — DÉPLOIEMENT**

Ne déploie rien sur le serveur de production sans validation explicite.

Ne redémarre pas les services de production sans autorisation.

**RÈGLE 10 — LIVRABLES**

À la fin de chaque phase, fournir :
- Ce qui a été construit.
- Les fichiers modifiés.
- Les migrations effectuées.
- Les API ajoutées.
- Les tests exécutés.
- Les résultats des tests.
- Les éléments restant à faire.
- Les éventuels risques.
- Les instructions pour tester.

---

# 23. RÉSULTAT FINAL ATTENDU

Nous voulons obtenir une extension Arrimo Préhospitalier complète, cohérente et intégrée.

Un ambulancier doit pouvoir transmettre une préalerte depuis Arrimo Véhicule.

OG doit analyser les informations et proposer le service hospitalier potentiellement concerné.

L'hôpital doit être averti immédiatement selon les règles configurées, voir l'arrivée prévue et commencer à préparer la réception du patient selon la priorité et les informations autorisées.

L'hôpital doit pouvoir confirmer la réception, valider le service concerné, suivre la préparation et confirmer l'arrivée de l'ambulance.

Arrimo Connect doit permettre de préparer les futures connexions aux logiciels hospitaliers et aux systèmes numériques partenaires, notamment Epic et les systèmes du DSN, lorsque les autorisations et interfaces seront disponibles.

Arrimo SH doit permettre d'administrer et de superviser l'ensemble.

OG doit rester l'intelligence centrale de l'écosystème.

**Le résultat recherché n'est pas simplement un système qui signale qu'une ambulance arrive. C'est un système qui permet à l'hôpital d'anticiper cette arrivée, de préparer son accueil et de mieux coordonner les informations avant même que le patient franchisse les portes de l'établissement.**

**FIN DU CAHIER DES CHARGES**