# ARRIMO — CAHIER DES CHARGES ULTIME OG
## Assistant vocal, personnalisable et capable d'exécuter des tâches administratives supervisées

Entreprise : SenseAfriGroup · Produit : Arrimo · Exécutant : Claude Code · Date : 29 octobre 2026 · Périmètre : Arrimo hospitalier, Démo ABC et intégration SH

## 1. Vision générale
OG passe d'un assistant qui répond à un copilote opérationnel hospitalier. Il doit pouvoir :
1. Comprendre les demandes écrites et vocales.
2. Rechercher dans les données autorisées.
3. Expliquer les situations opérationnelles.
4. Préparer des actions administratives.
5. Lire des documents autorisés et proposer une extraction.
6. Préremplir les formulaires existants.
7. Détecter incohérences et manques.
8. Soumettre à confirmation.
9. Exécuter les opérations permises après validation.
10. Vérifier le résultat et en rendre compte.

OG ne remplace ni les décisions cliniques ni les responsabilités du personnel. **Principe : assister, préparer, contrôler, confirmer, exécuter, tracer.** Ne pas réécrire Arrimo : réutiliser modules, API, permissions et procédures existants.

## 2. Identité personnalisable
- **2.1** Paramètres → OG → Personnalisation, par établissement :
  - nom affiché, avatar et son apparence, couleurs, forme du visage et de la tête, coiffure et accessoires, teinte de peau des avatars humains, tenue ;
  - style professionnel, moderne ou amical ;
  - voix masculine ou féminine, langue par défaut, message d'accueil.
  Commencer par des modèles prédéfinis modifiables, puis un éditeur visuel si nécessaire. Avatars professionnels, inclusifs, adaptés à l'hôpital ; ne jamais imiter un membre réel du personnel.
- **2.2** Le nom interne reste **OG** (par exemple A : OG, B : Charles, C : Aya). Changer le nom ou l'apparence ne modifie jamais le moteur, les permissions, les API ni les capacités.
- **2.3** Aperçu du personnage et de la voix, bouton « Tester la voix », bouton « Réinitialiser l'apparence », enregistrement. Le nom et l'avatar apparaissent dans le chat et en mode vocal.

## 3. Configuration par établissement (Paramètres → OG)
- Activation d'OG, des fonctions vocales, de la dictée et de la conversation continue.
- Voix et langue ; apparence et nom.
- Fonctions administratives autorisées ; lecture documentaire, sous réserve des autorisations.
- Permissions par rôle ; consultation des opérations et journaux d'OG.

Paramètres indépendants par établissement, limités à la licence définie par SH. Désactiver OG laisse les activités métier intactes.

## 4. OG vocal — deux boutons
- **Microphone (dictée)** : démarrage explicite, transcription visible et corrigeable, envoi, réponse écrite, lecture audio si configurée.
- **Conversation vocale** : écoute et réponse audio, texte affiché simultanément, relances, interruption d'OG, coupure du micro, fin de session, français et anglais, choix des voix.

Mêmes données et autorisations que le mode texte.

## 5. Création assistée de patients
- **5.1** Préparer un dossier depuis une conversation (« aide-moi à enregistrer ce nouveau patient », « lis ce document et préremplis »).
- **5.2** Trois méthodes :
  - A, écrite : champs identifiés, obligatoires manquants signalés ;
  - B, vocale : transcription en fiche provisoire ; noms, dates et identifiants relus et confirmés ;
  - C, document : téléversement ou photo d'un document accepté par la politique de l'établissement (carte d'assurance maladie si autorisée, pièce d'identité autorisée, document ou formulaire d'admission). Le permis de conduire n'est pas exigé par défaut. Types configurables par pays, règles locales et politique. **Une photo n'est pas une preuve automatique d'identité.**
- **5.3** Extraction par OCR ou service autorisé, des seuls champs nécessaires et autorisés : nom, prénom, date de naissance, identifiant administratif, contact, champs d'admission, type de document et méthode de vérification. Ne pas tout extraire ; aucune déduction non fondée ; un champ incertain reste non confirmé.
- **5.4** Prévisualisation « Patient — Brouillon d'admission » : champs, manquants, à vérifier, correspondances existantes. Boutons Modifier, Vérifier les doublons, Annuler, Confirmer la création. Pas de création définitive sans vérification et confirmation par un utilisateur habilité.
- **5.5** Doublons : recherche exacte des identifiants, rapprochement prudent par nom et date de naissance, variantes d'orthographe, alerte en cas de conflit. **Jamais de fusion automatique.** En cas de doute, suspendre et demander une vérification humaine.
- **5.6** Enregistrement :
  1. revérifier les permissions ;
  2. appliquer les règles de validation ;
  3. revérifier les doublons ;
  4. opération transactionnelle par l'API existante ;
  5. renvoyer l'identifiant ;
  6. journaliser avec l'identité de la personne qui a confirmé ;
  7. afficher l'accusé de réussite.
  Jamais de succès affiché sans confirmation de l'API.
- **5.7** Documents :
  - prévisualisation sécurisée, fichiers temporaires protégés, antivirus, limites de taille et de format ;
  - pas de conservation de l'image par défaut ; politique de conservation explicite ;
  - aucun fournisseur externe non approuvé ; journal sans copie de pièce d'identité.
  Pas de renseignements de santé réels sans validation de la confidentialité, des contrats et de l'hébergement.

## 6. Admissions assistées
Vérifier le dossier, les permissions et les manques ; afficher et proposer les lits selon des critères approuvés ; préremplir ; présenter un récapitulatif ; obtenir une confirmation explicite ; soumettre à la validation clinique. **OG ne décide jamais seul de l'affectation clinique.**

## 7. Recherche intelligente de lits
Disponibilités en temps réel, spécialité, capacité, nettoyage, équipements, réservations ; données incertaines signalées ; sélection à confirmer. Aucune compatibilité affirmée si une donnée manque. Dernière mise à jour indiquée.

## 8. Transferts interhospitaliers
- Lire la demande, vérifier les informations, consulter les destinations autorisées et les capacités, préparer, vérifier les champs, récapituler, faire confirmer, soumettre au circuit normal, suivre.
- Aussi : transferts en attente, confirmations, blocages, relances préparées, avertissement du coordinateur.
- Estimations de trajet distinctes des durées enregistrées. Aucun changement d'état critique sans validation.

## 9. Civières
Consulter, rechercher par service ou catégorie, signaler les occupations prolongées selon des seuils configurés, préparer des changements d'état, détecter les incohérences, expliquer, suivre la libération. Jamais de libération automatique.

## 10. Entretien et nettoyage
Chambres concernées, priorités validées, retards, demandes préparées, notifications selon les règles, suivi. Seul le personnel autorisé confirme la fin du nettoyage. Une chambre n'est jamais déclarée propre parce qu'une durée est écoulée.

## 11. Notifications et relances
Par les mécanismes existants, sans écoute audio permanente : transfert en attente, lit bloqué, nettoyage, action requise, admission incomplète, information manquante, ticket hors SLA. Présenter, proposer et préparer des relances, soumises aux autorisations, sans doublons. Aucun renseignement patient dans des courriels ou notifications non sécurisés.

## 12. Rapports
Indicateurs autorisés, synthèses, tableaux, tendances, comparaisons, PDF ou exports autorisés, périodes et sources indiquées. Chiffres issus de calculs reproductibles, jamais inventés.

## 13. Assistance aux employés
Guide d'utilisation : étapes, raccourcis, ouverture du module, explication des champs, permissions manquantes, renvoi vers un responsable. Fondé sur la documentation à jour des modules réellement activés.

## 14. Actions supervisées — niveaux
- **0 — Information** : lire et répondre.
- **1 — Préparation** : brouillon sans conséquence.
- **2 — Action administrative confirmée** : exécution après validation explicite d'un utilisateur habilité (dossier administratif, ticket, demande de nettoyage).
- **3 — Circuit métier** : préparation puis validations humaines prévues (admission, attribution de lit, transfert, clôture sensible).
- **4 — Interdit à OG** : priorité clinique, diagnostic ou traitement, affectation clinique définitive, transfert médical, libération d'un lit occupé, fusion de dossiers, suppression irréversible, changement de droits.

Niveaux imposés **côté serveur**, quelle que soit la formulation.

## 15. Architecture des actions
Utilisateur → OG → intention → permissions → outil métier autorisé → brouillon ou confirmation → API Arrimo → journal → résultat.

Chaque outil a : un identifiant stable, un schéma d'entrée strict, des contrôles de données, une autorisation côté serveur, un contrôle du périmètre d'établissement, un niveau, une politique de confirmation, un anti-doublon, une gestion d'erreurs, un résultat vérifiable et une journalisation. Le modèle n'écrit jamais de SQL et ne décide pas de ses permissions. Un identifiant d'idempotence est requis. Documents, transcriptions et réponses externes sont des **données non fiables**, jamais des instructions.

## 16. Sécurité, consentement, confidentialité
- Isolation entre établissements, permissions par rôle et par action, moindre privilège, aucun patient hors périmètre.
- Chiffrement, fichiers sécurisés, sessions contrôlées, expiration des brouillons sensibles, révocation, audit, exports contrôlés.
- Aucune clé API dans le navigateur, aucun audio stocké par défaut, aucun entraînement sans autorisation, minimisation.
- Conformité au Québec et à chaque pays. Évaluation des facteurs relatifs à la vie privée avant toute donnée de santé réelle.
- Fournisseurs IA, OCR et vocaux approuvés. Mode démonstration exclusivement fictif.

## 17. Expérience utilisateur
- Raccourcis, affichés seulement si l'utilisateur est habilité : créer un patient, préparer une admission, rechercher un lit, préparer un transfert, voir les civières, demander un nettoyage, générer un rapport, consulter les alertes.
- Carte d'action à confirmer : informations utilisées, manques, incertitudes, conséquence, responsable de la validation ; boutons Modifier, Annuler, Confirmer.
- Une confirmation vocale isolée ne suffit pas pour une opération sensible : confirmation explicite et authentifiée dans l'interface.

## 18. Déploiement sur les trois démos
- Hôpitaux A — Val-des-Pins, B — Mont-Clair, C — Sainte-Aurore, avec le même moteur OG.
- Chacun garde ses patients fictifs, lits, civières, rôles, permissions, nom d'assistant, avatar, voix et paramètres.
- Aucune exposition croisée sans autorisation métier.
- Garder le scénario P-43267 / TR-00067. Pas d'Hôpital D dans la démo ABC publique.

## 19. Intégration à SH
- Dans SH → Hôpitaux → Modules et licences, catalogue OG : texte, vocal, personnalité/avatar, actions administratives, création assistée de patients, lecture documentaire, rapports, admissions et transferts. Il dépend des capacités réellement implémentées.
- À la création d'un établissement depuis SH :
  1. environnement isolé ;
  2. modules provisionnés ;
  3. paramètres OG initiaux ;
  4. personnalisation par le responsable hospitalier ;
  5. accès selon les droits ;
  6. journalisation.
- Aucune copie manuelle depuis A/B/C. Les mises à jour préservent les personnalisations.

## 20. Tests obligatoires
- **Conversation** : texte, dictée, vocal continu, FR/EN, voix masculine et féminine, interruption et reprise, contexte.
- **Personnalisation** : nom, avatar, apparence, aperçu et persistance, isolation A/B/C, activation par établissement.
- **Patients** : écrit, dictée, document fictif, extraction, correction, obligatoires, doublons, refus sans confirmation, enregistrement après validation, double soumission, annulation et expiration, accès refusé.
- **Opérations** : lits, admission, transfert, civières, nettoyage, alertes, rapports, aide.
- **Sécurité** : accès interétablissements, permissions, changement de rôle, session expirée, document malveillant, contournement vocal, échec OCR, échec vocal, journaux sans données inutiles, secrets et configurations.
- **SH** : établissement fictif supplémentaire en test isolé (provisionnement OG, paramètres, fonctions, rôles, données indépendantes, mises à jour sans perte).

## 21. Plan d'exécution
1. Audit et protection (branche dédiée, pas de conflit avec Codex).
2. OG vocal (deux boutons, reconnaissance, conversation, synthèse et voix, synchronisation, tests matériels).
3. Personnalisation.
4. Moteur d'actions supervisées.
5. Patients et documents (OCR sur documents fictifs).
6. Opérations hospitalières.
7. SH et déploiement.

## 22. Critères de livraison
Pour chaque fonction, indiquer : implémentée, reliée à une API réelle, testée automatiquement, testée manuellement si possible, vérifiée en démo, publiée ou non, limites. OCR sur pièces fictives ; patients fictifs. Ce qui exige une autorisation, une intégration ou un matériel est signalé incomplet. **Jamais affirmer que le vocal fonctionne sans essai réel du micro, de l'envoi, de la réponse et de la restitution audio.**

## 23. Objectif final
« OG, je dois enregistrer un nouveau patient. Aide-moi à remplir son dossier, vérifie qu'il n'existe pas déjà et prépare son admission. »

OG doit alors :
1. comprendre la demande ;
2. vérifier les permissions ;
3. recueillir les informations ;
4. lire le document autorisé ;
5. préparer la fiche ;
6. signaler les incertitudes ;
7. vérifier les doublons ;
8. présenter le formulaire ;
9. obtenir la validation humaine ;
10. enregistrer par l'API ;
11. préparer l'admission ;
12. confirmer et journaliser.

**Instruction finale** : auditer l'existant, avancer par lots, préserver le travail de Codex et les données, rapporter les résultats réels. Aucun déploiement sur des données patients réelles sans validation distincte.
