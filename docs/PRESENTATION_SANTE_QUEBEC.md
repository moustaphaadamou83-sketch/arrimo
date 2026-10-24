# Arrimo — démonstration Santé Québec / CHU Sainte-Justine

Document de présentation, 22 octobre 2026. Scénario fictif générique : aucune implantation ou validation clinique par les institutions citées n'est revendiquée. L'état du domaine public et la décision de déploiement figurent dans `RAPPORT_DEPLOIEMENT_PUBLIC_2026-10-22.md`.

## Message d'ouverture

« Arrimo rassemble la disponibilité des lits, la pression sur les civières et les transferts dans un même outil de coordination. OG aide à lire la situation et propose des actions ; les équipes décident et confirment. Nous vous montrons aujourd'hui un réseau de démonstration. »

## Préparer les fenêtres

Le domaine public répond à https://arrimo.senseafri.com/, mais son déploiement est partiel et la candidate n'y est pas validée. Ne pas utiliser ce domaine pour une démonstration institutionnelle avant la levée des blocages décrits dans le rapport de déploiement. Aucun mot de passe n'est consigné dans ces supports.

Version de préparation avec OG et correctifs : lancer `npm run presentation:locale` depuis cette copie, puis ouvrir http://127.0.0.1:3014. Le runtime de référence est Node.js 24.22.1 LTS, épinglé dans `.nvmrc`, et le PostgreSQL local d'audit sur le port 55439. Les accès sont créés dans `.local/acces-presentation.txt` (privé). Ils concernent uniquement cette version locale.

Utiliser deux profils de navigateur distincts pour `hopital.x@demo.arrimo` et `hopital.y@demo.arrimo`, puis une troisième session pour `reseau@demo.arrimo`. Deux onglets ordinaires partagent la session. Les comptes entretien servent à montrer les limites par rôle. La MFA est conservée pour l'administration sensible ; son activation publique ne fait pas partie de la démonstration préparée.

Le lanceur crée sa propre base neuve au premier démarrage et la réutilise ensuite. Il ne réinitialise aucune base existante, ne charge aucun `.env` et désactive les courriels et appels IA externes. Il ne démarre pas le simulateur périodique : le scénario reste plus stable pour la répétition. Ne pas utiliser les commandes de remise à zéro du guide historique sur le service public.

## Démonstration de 10 minutes

| Temps | Écran et manipulation locale | Ce que cela établit |
|---|---|---|
| 0–1 min | Accueil OG, Hôpital X : capacité, attente, civières et alertes | Situation partagée, rôle de l'humain et chiffres fictifs |
| 1–2 min | Urgence : civières régulières/corridor et demande d'admission | Lien entre urgence et recherche de lit |
| 2–3 min | OG : demander les priorités et ouvrir une recommandation | Raisons lisibles, validation humaine |
| 3–6 min | Recherche interhospitalière avec besoin d'isolement; confirmer un lit fictif; envoyer la demande X→Y; acceptation, préparation, départ et réception | Compatibilité, capacité confirmée, responsabilités et étapes du transfert |
| 6–7 min | Montrer un refus et Plan B, puis une disponibilité périmée qui exige une nouvelle confirmation | Alternatives proposées, capacité incertaine non réservable |
| 7–8 min | Lits/civières : admission, nettoyage et remise en disponibilité | États physiques conservés et journalisés |
| 8–9 min | Indicateurs de capacité, refus, confirmations et réorientations | Mesures de coordination, sans prétendre à des gains déjà prouvés |
| 9–10 min | Saturation et limites de routage; aucune distance si le fournisseur est absent | Pas de distance inventée; décisions et validation métier restent humaines |

Lire les valeurs affichées au moment de la présentation : les chiffres publics évoluent avec la simulation et les autres utilisateurs. Les actions métier du scénario sont à répéter dans la copie locale ; cette mission n'a pas effectué ces actions sur le service public.

## Réunion Teams de 30 minutes

| Temps | Contenu |
|---|---|
| 0–2 min | Présentations, objectif de la rencontre et résultat attendu |
| 2–7 min | Problème de coordination visé, limites du périmètre et questions des équipes |
| 7–17 min | Démonstration de 10 minutes sur la copie locale et les données fictives |
| 17–22 min | Architecture, sécurité, confidentialité et intégration envisagée |
| 22–25 min | Proposition de méthodologie, responsabilités et indicateurs d'un pilote à discuter |
| 25–30 min | Questions, risques, critères de décision et prochaines étapes |

Éteindre le partage des identifiants, masquer les notifications personnelles du poste et ouvrir uniquement la copie locale préparée. Ne jamais présenter les résultats simulés comme des observations cliniques.

## Explications à donner sur les chiffres

- Lits dotés dans le code : lits hors service exclus. Ce n'est pas une vérification des ressources humaines réellement disponibles.
- Occupation par un patient : lits occupés / lits dotés. Le tableau Indicateurs de cette copie utilise cette définition.
- Non-disponibilité : (occupés + réservés + nettoyage) / dotés. Le champ historique API `occupation` conserve ce calcul pour compatibilité ; la vue Réseau est explicitement étiquetée « Non-disponibilité » dans cette copie.
- Pression : (dotés − libres + demandes en attente) / dotés. Elle peut dépasser 100 % et conserve les seuils existants.
- Civières : patients présents rapportés aux civières régulières fonctionnelles ; le débordement peut conduire à un taux supérieur à 100 %. En l'absence de capacité régulière, le code utilise une valeur sentinelle : ne pas la présenter comme un taux institutionnel normalisé.
- Prévisions : pondération des congés et moyennes historiques sur une fenêtre allant jusqu'à huit semaines, avec marge calculée. Sur une démo synthétique, cette marge n'est pas une validation statistique sur des patients réels.

## Questions attendues

**Est-ce connecté aux systèmes hospitaliers ?** Un connecteur JSON et son idempotence sont testés localement. Les messages HL7 ADT doivent être traduits par le moteur d'interface de l'établissement. Aucune connexion réelle à Santé Québec ou Sainte-Justine n'a été validée ici.

**OG est-il une IA clinique ?** Le briefing, les recommandations et les prévisions sont calculés par les règles du produit. L'IA externe facultative reste désactivée dans la présentation locale ; elle ne reçoit, dans cette copie corrigée, que des agrégats et des questions prédéfinies. OG ne prescrit pas et n'exécute pas une action sans confirmation.

**Est-ce adapté à la pédiatrie ?** Le parcours de coordination est démontrable. Les contraintes d'âge, de poids, d'équipement et d'acceptation propres aux unités pédiatriques doivent être définies et validées avec les équipes avant un pilote.

**Quels gains ?** Les écrans et les tests démontrent des fonctions. Aucun gain de temps hospitalier, résultat clinique ou réduction réelle d'attente n'a été mesuré par cette mission.

## Décisions à obtenir pour un pilote

Choisir les établissements et unités, les acteurs responsables, les événements à intégrer et les définitions communes des indicateurs. Établir ensuite une période de référence et les critères d'évaluation : attente, délais de transfert, nettoyage, séjours prolongés et qualité des données. Définir avec les responsables concernés l'hébergement, les accès, les sauvegardes et les conditions de traitement avant toute donnée réelle.

## Répétition finale par le présentateur

Sur le Mac et le réseau utilisés le jour J : connexion Safari réelle, fermeture du guide d'accueil, fenêtres isolées X/Y, parcours de transfert, export et affichage en projection. Garder les captures locales comme secours. Cette répétition humaine et la validation métier pédiatrique restent à réaliser ; les tests automatisés ne les remplacent pas.

## Rejouer la validation

Depuis cette copie : `npm run presentation:valider`. La commande crée des bases neuves sur le PostgreSQL local d’audit (127.0.0.1:55439), conserve les bases et écrit les preuves dans un nouveau dossier privé `.local/preuves-*`. Elle n’utilise aucune URL de base fournie par l’environnement. La dernière exécution avec Node 24.22.1 LTS a validé 62 tests API, 1 test courriel, 9 tests d’interface et 6 tests OG. Les 6 tests de routage se lancent séparément avec `node --test tests/routage.test.cjs`. Chromium correspondant à Playwright doit être installé. Les bases existantes ne sont pas réinitialisées.
