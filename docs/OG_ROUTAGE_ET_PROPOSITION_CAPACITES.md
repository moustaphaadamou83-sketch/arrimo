# OG — routage, fiabilité de capacité et mesure de coordination

## Routage réellement calculé

RescueMatch réutilise l’adaptateur `src/routage.js` : l’endpoint OSRM configuré fournit les matrices (candidats) et itinéraires (carte/transfert). Les distances sont issues des mètres routiers retournés, les durées des secondes du moteur. Arrimo enregistre au transfert la date de calcul, le fournisseur et, si fourni, `data_version`. Les coordonnées absentes, une panne, un résultat sans route ou une configuration invalide laissent distance et durée indisponibles. Dans ce cas, aucune demande de transfert et aucune heure d’arrivée estimée ne sont créées.

Configuration par environnement du serveur, jamais par navigateur : `ARRIMO_ROUTEUR_URL=https://<hôte approuvé>`, `ARRIMO_ROUTEUR_PROFIL=driving`, `ARRIMO_ROUTEUR_NOM=<nom stable>`, `ARRIMO_ROUTAGE_TIMEOUT_MS=5000`. Si l’instance requiert une clé, `ARRIMO_ROUTEUR_CLE` est envoyée en `Authorization: Bearer` et ne figure pas dans l’URL. Refuser HTTP hors boucle locale/test, redirections vers un hôte non approuvé et toute URL qui contient identifiants, paramètres ou fragment. Autoriser en sortie seulement le fournisseur retenu; garder TLS, délais d’expiration, journalisation sans coordonnées patient et supervision de latence/erreur. L’OSRM public de démonstration sert à valider des exemples non sensibles uniquement; il ne constitue ni un SLA ni une dépendance acceptable pour un pilote. Le déploiement pilote doit utiliser une instance OSRM gérée ou un fournisseur approuvé contractuellement, et tester couverture/qualité routière de chaque région desservie.

`data_version` est la version du jeu cartographique si le moteur la retourne, pas l’heure de calcul. `route_actualise_le` est l’heure UTC du calcul. Le calcul de trajet n’établit pas une capacité médicale et n’envoie au routeur que des coordonnées d’établissements.

La durée retournée est celle du profil routier du fournisseur; elle ne doit pas être présentée comme une mesure du trafic en temps réel ou une garantie d’heure d’arrivée d’une ambulance. La prévision d’arrivée affichée au départ est calculée à partir de cette durée, doit garder l’heure de calcul visible, et reste indicative.

## Réalisation locale dans la copie isolée

| Besoin | Réemploi | Extension minimale proposée | Garde-fous |
|---|---|---|---|
| Confirmation | `lits.etat`, `version`, `journal`, établissements et rôles existants | Colonnes additives d’horodatage et d’utilisateur, endpoint et action de confirmation depuis les lits; l’établissement est dérivé du lit; validité réglable dans la configuration pays (5 à 1440 min) | La transition physique vers « libre » efface la confirmation précédente; seules des personnes autorisées confirment; état physique conservé séparément. |
| Fraîcheur | colonnes de confirmation | Calcul à la lecture : confirmée, non confirmée ou périmée; capacités réseau, recherche, OG et transferts distinguent ces décomptes | Une donnée périmée/non confirmée n’est jamais réservée ni présentée à OG comme place confirmée. Le TTL n’ajoute aucun état physique. |
| Blocage et responsabilité | `transferts.statut`, `motif_refus_code`, `notifications`, `journal` | Cause de refus déjà conservée; service receveur attribuable sur une demande en attente; attente visible à partir des horodatages et du statut. Relance manuelle de l’origine, minimum 5 min entre envois, compteur/heure sur le transfert, notification existante et trace dans le journal. | Aucun envoi périodique ou transfert automatique; personnel d’entretien exclu; aucune donnée patient dans la notification de relance. |
| Alternatives après refus/indisponibilité | RescueMatch, Plan B, routage et verrouillage existants | Plan B relit les capacités actuelles, exclut le receveur qui a refusé et donne la priorité aux places compatibles confirmées; distances/temps proviennent du routeur réel configuré. | OG recommande; une personne habilitée décide. Aucune solution ou distance n’est inventée si le routeur ou la capacité manque. |
| Indicateurs | tableau d’indicateurs/CSV existant, journaux et événements de transfert | Ajout des capacités confirmées/à confirmer/périmées, demandes encore en attente dans la cohorte, confirmations consignées et transferts réorientés lorsque la même demande est liée; taux de refus et délais existants conservés. | Les réorientations ne sont mesurées que si `demande_admission_id` est partagé entre tentatives. Les périodes comptent les dates de demande. |

## Capacités qui restent à cadrer avant un pilote

- La validité est configurable par configuration pays, pas séparément par établissement, unité ou type de lit. Un réglage plus fin demande une décision métier avant changement de schéma.
- Il n’existe pas de journal structuré des étapes « première destination compatible », attente de confirmation, relances attendues ou préparations de lit par transfert. L’historique général conserve la confirmation et la relance, mais ne permet pas encore ces temps de bout en bout.
- Le service responsable est un libellé libre limité à 100 caractères, modifiable par l’établissement receveur tant que la demande attend. Aucun annuaire de services ni SLA organisationnel n’est configuré.
- Les motifs de refus et leur nomenclature déjà stockés sont réutilisés. Les relances sont manuelles, permises par l’origine au plus une fois par cinq minutes; aucun rappel automatique n’est généré.
- Le temps de coordination économisé n’est pas calculé : aucune référence de comparaison validée n’existe. Les règles pédiatriques et les seuils restent à faire approuver par les établissements.

## État de validation et travail avant pilote

- Couvert localement : fournisseur configurable côté serveur, validation d’URL/profil/coordonnées, timeout, clé optionnelle dans l’en-tête, conversion mètres/secondes, matrices nulles sans repli inventé, panne qui bloque la demande de transfert, alternatives revalidées après refus, stockage des mesures et provenance au transfert; confirmations humaines avec expiration calculée, refus de réservation périmée, service responsable et relance auditée; indicateurs de confirmation et de réorientation.
- Validation externe de démonstration : route et table OSRM ont donné les mêmes 1 888 m et 260,4 s entre les coordonnées de test Friedrichstraße et Torstraße, Berlin. Le rendu arrondit à 1,9 km et 4 min. Cet exemple technique ne valide ni les performances du fournisseur pour le Québec ni l’exactitude métier des coordonnées d’Arrimo.
- Avant pilote : choisir et contracter le fournisseur, vérifier les conditions de traitement et la couverture locale; valider la source/qualité des coordonnées institutionnelles; faire un test avec trajets québécois convenus; documenter disponibilité/latence/SLA et supervision; faire approuver seuils d’expiration, propriétaires de capacité, raisons de blocage, circuit de relance, règles pédiatriques et définition des indicateurs par les établissements.
- Les nouvelles colonnes de provenance de route sont additives et nullables. Elles ne modifient ni les comptes, ni les lits, ni les transferts existants; aucune donnée fictive n’est importée dans une base réelle.
