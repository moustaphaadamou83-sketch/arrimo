# Comment Arrimo s'arrime à vos systèmes

**Pour les cliniques, hôpitaux, établissements d'hébergement et organisations de secours.**
Arrimo **ne remplace pas** vos solutions (dossier médical électronique, dossier patient, système de répartition, Dossier santé numérique — DSN). Il coordonne les places, les lits, les transferts, les transports et les arrivées d'ambulances, et se branche à côté de ce que vous avez déjà.

État au 12 novembre 2026. Les connexions décrites ici sont **construites et testées avec des simulateurs**. Aucune connexion réelle à un système partenaire (DSN, Epic ou autre) n'est revendiquée tant qu'elle n'a pas été autorisée, documentée et testée avec ce partenaire.

## 1. Principes

| Principe | Ce que cela veut dire |
|---|---|
| Complément, pas remplacement | Vos systèmes restent la source de vérité clinique. Arrimo ne lit que ce qui sert à coordonner. |
| Minimisation | Arrimo n'a besoin d'aucune identité : une référence pseudonymisée (P-00000, R-00000) suffit. Les noms et dates de naissance envoyés par erreur sont ignorés (HL7 PID-5, PID-7). |
| Client par client | Chaque connexion est activée pour **un** client, depuis la console SH. Ses droits se limitent aux données de ce client. |
| Désactivable à tout moment | Une connexion révoquée cesse immédiatement de fonctionner. Chaque action est journalisée. |
| Secrets jamais affichés | Clés et secrets générés sur le serveur, chiffrés, remis **une seule fois** à votre contact technique par un lien valable 24 h. |
| Aucun port ouvert | Tout passe par HTTPS (443). Aucune écoute MLLP ni SFTP publique sans accord explicite. |
| Un humain décide | Aucune action automatique sur un patient, un lit, une destination ou une priorité. |

## 2. Les portes d'entrée disponibles

| Besoin | Interface | Sens | Détail |
|---|---|---|---|
| Votre moteur d'interface envoie admissions, transferts, congés | **HL7 v2 ADT** sur HTTPS : `POST /api/connecteurs/hl7v2` | entrant | A01, A02, A03, A04 (arrivée à l'urgence), A16. Accusé HL7 (MSA AA/AE). Identifiant de contrôle MSH-10 : jamais traité deux fois. |
| Même chose en JSON | **ADT JSON** : `POST /api/connecteurs/evenements` | entrant | Pour les moteurs qui produisent du JSON. |
| Votre DME/DSN veut lire la situation d'Arrimo | **FHIR R4** (lecture) : `/api/fhir/r4/...` | sortant | `metadata`, `Organization`, `Location` (lits et état opérationnel), `HealthcareService`, `Encounter` (ambulances annoncées, sans patient). Données de **votre** établissement seulement. |
| Être prévenu en temps réel | **Webhooks signés** | sortant | Préalertes et transports qui vous concernent ; signature HMAC-SHA256 ; nouvelles tentatives ; abandon visible en supervision. |
| Système de répartition ou ambulancier | **Arrimo Connect v1** : `/api/connect/v1/...` | les deux | Requêtes signées (HMAC, horodatage 5 min, idempotence) ; mêmes règles que l'écran. |
| Structure (unités, chambres, lits), comptes | **Import CSV / Excel** par SH | entrant | Tout ou rien, vérifié avant écriture. |

## 3. Et le DSN ?

Le Dossier santé numérique n'est **pas** présumé être une API unique et directement accessible : son architecture réelle, ses interfaces et ses règles d'accès relèvent de Santé Québec et des établissements. Arrimo est préparé pour s'y arrimer **par les voies standard**, sans contourner vos systèmes :

1. **Par votre moteur d'interface** (le cas le plus courant) : il reçoit déjà les événements de votre DSN ou de votre DME et peut en transmettre une copie minimale à Arrimo en HL7 v2 ADT ou en JSON. Rien à changer côté DSN.
2. **Par FHIR R4** : si votre plateforme expose ou consomme FHIR, elle peut lire la situation d'Arrimo (lits, services, arrivées annoncées) avec une clé limitée à votre établissement.
3. **Par webhooks** : votre plateforme reçoit les événements Arrimo qui la concernent, signés, sans identité.

Ce qu'il faudra avant une connexion réelle au DSN : la documentation technique et l'autorisation de Santé Québec et de l'établissement, l'évaluation des facteurs relatifs à la vie privée (EFVP, Loi 25), l'hébergement au Canada, des tests en recette avec le partenaire, et la validation de la correspondance des identifiants (aucune identification sur un nom ressemblant).

## 4. Démarche type pour une clinique

1. **Rencontre technique** : quels systèmes, quels formats, qui est le contact technique.
2. **Activation dans SH** : client créé (type « clinique » = type local du pays, sur le modèle Hôpital), modules choisis un par un, connexions activées une par une.
3. **Remise des accès** : votre contact technique reçoit un lien unique (24 h).
4. **Recette** : essais avec des données fictives, puis validation de votre équipe.
5. **Mise en service** : activation par la console SH ; désactivation possible à tout moment.

## 5. Sécurité, en bref

Chiffrement en transit (TLS) · secrets chiffrés au repos · clés et sessions par empreinte · contrôle des droits à chaque requête · isolation par client · journaux immuables · limitation des requêtes · aucune donnée de santé identifiante dans les journaux techniques · adresses de webhooks internes refusées.
