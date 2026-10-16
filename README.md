# Arrimo

Module autonome de gestion des lits hospitaliers et des transferts entre établissements.
Node.js + PostgreSQL + interface web. Aucune dépendance à un ERP.

## Ce que fait le module

- **Hiérarchie** : établissement > unité > chambre > lit.
- **Cycle d’un lit** : libre → réservé → occupé → nettoyage → libre après confirmation (hors service depuis et vers libre).
- **Un lit ne peut être pris qu’une fois** : verrou de ligne PostgreSQL + numéro de version. Testé avec 10 réservations simultanées : une seule passe.
- **Aucune donnée médicale** : référence patient seulement, au format défini par pays.
- **Journal immuable** : chaque changement et chaque refus, protégé au niveau de la base (ni modification, ni suppression, ni vidage).
- **Isolation** : un établissement ne voit et ne modifie que ses lits ; les autres apparaissent selon leur partage (complet, agrégé, aucun).
- **Configuration par pays** : types d’unité, seuils, rayon, format de référence. Rien n’est codé en dur.
- **Activation par établissement depuis SH** : API protégée par clé.
- **Recherche d’un lit ailleurs** : classement selon lits libres, lits prévus, tension et distance. Validation humaine obligatoire.
- **Transferts** : demande → validée → transport organisé → en transfert → reçu (ou refusé). Chaque étape revient au bon établissement ; notifications à chaque étape.
- **Prévision** : lits qui devraient se libérer (congés prévus et nettoyages en cours).
- **Détection des blocages** toutes les 15 min : réservations sans admission, nettoyages trop longs, congés dépassés, lits hors service.
- **Assistant Arrimo** : questions en français sur les lits, réponses calculées sur les données.

## Version 2 : ce qui répond aux problèmes du terrain

| Problème réel | Fonction d’Arrimo |
|---|---|
| Patients sur civière qui attendent un lit | **File d’admission** priorisée (P1 à P3), temps d’attente, lit adapté proposé, transfert en un clic si rien ici |
| Urgence débordée, patients en corridor | **Civières de l’urgence** (régulières et débordement) : taux d’occupation (peut dépasser 100 %), patients depuis plus de 24 h et 48 h, durée moyenne ; la demande de lit est liée à la civière, qui part au nettoyage à l’admission |
| Lits bloqués par des patients NSA | **Suivi NSA** : orientation attendue, jours d’attente, taux comparé à la cible (8 % au Québec) |
| Lits fermés faute de personnel | **Motif d’indisponibilité** obligatoire, capacité perdue visible dans les indicateurs |
| Nettoyage lent entre deux patients | **Écran Nettoyage** pour l’équipe d’entretien, trié par priorité, début et fin chronométrés |
| Congés tardifs | **Statut du congé** : prévu, confirmé, en attente de transport |
| Transfert vers un lit inadapté | **Besoins du patient** (isolement, pression négative, ventilation, télémétrie) respectés partout |
| Débordement géré trop tard | **Niveau d’alerte** vert, jaune, orange, rouge, avec le protocole configuré par pays |
| Pas de preuve des progrès | **Indicateurs** et export CSV |
| Saisie en double | **Connecteur ADT** : admissions, transferts internes et congés reçus automatiquement |

### Copilote

- **Briefing** pour la réunion quotidienne de gestion des lits : niveau d’alerte, résumé, recommandations classées
  (Urgent, Important, À faire), chacune avec un bouton d’action. Le Copilote propose ; un humain valide toujours,
  et chaque action passe par les mêmes règles que le reste de l’application.
- **Vue réseau** : niveau de chaque établissement qui partage, et délestages possibles entre hôpitaux.
- **Questions** en français : mode local par défaut (les données ne quittent pas le serveur). Mode IA facultatif :
  définir `COPILOTE_IA_CLE` (et au besoin `COPILOTE_IA_URL`, `COPILOTE_IA_MODELE`). Les références patient sont retirées
  avant tout envoi. Avant d’activer ce mode en production, vérifier la conformité (Loi 25, lieu d’hébergement du fournisseur).

### Connexion aux systèmes de l’hôpital et du réseau

Le moteur d’interface de l’hôpital traduit les messages HL7 ADT en JSON et les envoie à Arrimo.
La référence patient doit être pseudonymisée avant l’envoi : Arrimo ne reçoit jamais l’identité du patient.

```
POST /api/connecteurs/evenements          X-Connecteur-Key: <clé>
{ "identifiant": "MSH-10 du message", "evenement": "admission", "lit": "MED-203A", "patient_ref": "P-12345" }
```

| HL7 | `evenement` | Effet |
|---|---|---|
| ADT^A01 | `admission` | lit occupé |
| ADT^A02 | `transfert_interne` (+ `lit_precedent`) | ancien lit en nettoyage, nouveau lit occupé |
| ADT^A03 | `conge` | lit en nettoyage |
| ADT^A16 | `conge_prevu` (+ `date`) | congé prévu |

Un même `identifiant` n’est appliqué qu’une fois. Un connecteur n’agit que sur son établissement.
Un connecteur sans établissement lit la capacité agrégée du réseau (`GET /api/connecteurs/capacite`),
pour une coordination régionale ou nationale : aucun lit individuel, aucun patient.
Création d’une clé (gestionnaire réseau) : `POST /api/admin/connecteurs { "nom": "...", "etablissement_id": 1 }`.

## Version 4 : comptes, administration, sauvegardes

- **Double authentification** (code à 6 chiffres, applications Microsoft ou Google Authenticator), obligatoire pour l’administration.
- **Mots de passe temporaires** à la création ou à la réinitialisation d’un compte, à changer à la première connexion (12 caractères minimum).
- **Administration** : comptes (création, rôle, établissements, désactivation, réinitialisation), unités, chambres, lits et équipement,
  configuration pays (seuils, rayon, temps de route, protocoles), connecteurs (création, révocation, suivi des rejets).
  Rôles : gestionnaire réseau (tout) et admin d’établissement (ses établissements seulement).
- **Journal d’administration** immuable.
- **Sauvegardes** chaque nuit à 3 h, vérifiées, conservées 14 jours (copie externe possible avec rclone). Restauration : `arrimo-restaurer <fichier>`.
- **État du service** : `GET /api/sante` (sans aucune donnée).

## Installation

Prérequis : Node.js 18 ou plus, PostgreSQL 13 ou plus.

```bash
npm install --omit=dev
cp .env.example .env              # puis remplir les valeurs
createdb arrimo
set -a; . ./.env; set +a
npm run db:seed                   # crée le schéma et les données de démonstration
npm start                         # http://localhost:3010
```

Comptes de démonstration (mot de passe `Demo-Arrimo-2026`) :
`tremblay@demo.arrimo` (Hôpital Mont-Bellevue), `bouchard@demo.arrimo` (CHU Saint-Laurent),
`roy@`, `gagnon@`, `cote@demo.arrimo`, `reseau@demo.arrimo` (gestionnaire réseau),
`entretien.mb@demo.arrimo` et `entretien.sl@demo.arrimo` (écran Nettoyage seulement).
Tous les établissements et toutes les données de démonstration sont fictifs.

En production, ne lancez pas `db:seed` : créez seulement le schéma (`psql -f db/schema.sql`) puis vos établissements.
`npm run db:reset` est refusé quand `NODE_ENV=production`.

## Tests

```bash
createdb arrimo_test
TEST_DATABASE_URL=postgres:///arrimo_test npm test
```

40 tests de bout en bout sur une vraie base : cycle du lit, concurrence, transitions interdites,
référence sans donnée médicale, journal immuable, isolation, partage, transferts complets,
version périmée, refus, blocages, prévision, assistant, activation SH, motifs d’indisponibilité, NSA,
file d’admission (besoins, concurrence), transfert depuis la file, nettoyage et rôle entretien, Copilote
(briefing, actions, vue réseau, mode IA sans référence patient), connecteurs (idempotence, isolation), indicateurs,
civières de l’urgence (verrou, demande liée, admission, changement de civière, partage), langues, aide, pages légales, pagination, limites.
`npm run test:interface` : parcours du guide de démonstration dans Chromium, en largeur ordinateur, tablette et téléphone, et en anglais.

## Activation depuis SH

```
PUT /api/sh/etablissements/{code}
X-SH-Key: <SH_API_KEY>
{ "module_actif": true, "partage": "complet" }
```

## API principale (session : `Authorization: Bearer <token>`)

| Méthode | Chemin | Rôle |
|---|---|---|
| POST | `/api/connexion` | Obtenir un jeton |
| GET | `/api/moi` | Utilisateur, établissements, configuration |
| GET | `/api/reseau?depuis=` | Capacité vue depuis un établissement |
| GET | `/api/recherche?depuis=&type_id=` | Suggestions classées (ne réserve rien) |
| GET | `/api/lits?etablissement_id=` | Lits de l’établissement |
| POST | `/api/lits/{id}/action` | `reserver`, `admettre`, `annuler`, `liberer`, `nettoyage_ok`, `hors_service`, `remettre` |
| PUT | `/api/lits/{id}/sortie-prevue` | Congé prévu |
| GET | `/api/blocages?etablissement_id=` | Blocages détectés |
| GET | `/api/civieres?etablissement_id=` | Civières de l’urgence et statistiques (taux, > 24 h, > 48 h, durée moyenne) |
| POST | `/api/civieres/{id}/action` | `placer` (référence), `liberer`, `nettoyage_ok`, `hors_service` (motif), `remettre` |
| POST | `/api/civieres/{id}/deplacer` | Changer le patient de civière (`vers_id`, `version`) ; sa demande de lit le suit |
| GET/POST | `/api/admissions` | File d’admission ; `civiere_id` lie la demande à la civière du patient |
| GET/POST | `/api/transferts`, `/api/transferts/{id}/{accepter|refuser|transport|depart|reception}` | Transferts |
| GET | `/api/journal?etablissement_id=` | Journal |
| GET/POST | `/api/notifications`, `/api/notifications/lues` | Notifications |
| POST | `/api/assistant` | Question en langage courant |

## Ce qui reste à faire avant un pilote réel

- Hébergement au Canada (idéalement au Québec), HTTPS, sauvegardes automatiques chiffrées.
- Évaluation des facteurs relatifs à la vie privée (Loi 25) et test d’intrusion indépendant.
- Connexion aux admissions, transferts et congés de l’établissement (HL7 ADT ou FHIR), pour que l’état des lits se mette à jour sans saisie.
- Branchement réel du transport (M2) ; prévision par règles (congés prévus, nettoyages), à remplacer par un modèle entraîné sur l’historique réel d’un pilote.
- Gestion des utilisateurs et de la structure (unités, chambres) par écran ; aujourd’hui par l’API gestionnaire ou en base.
- Authentification unique (SSO) de l’établissement et double authentification.

## Mise en ligne sur un serveur (démonstration)

1. Chez Namecheap, créer un enregistrement DNS **A** (ex. `arrimo`) vers l’adresse IP du serveur.
2. Copier `arrimo.zip` et `deploy/installer.sh` sur le serveur, puis en root :
   `bash installer.sh arrimo.mondomaine.com`
3. Le script installe Node.js, PostgreSQL et Nginx, crée la base avec un mot de passe aléatoire,
   charge les données fictives avec un mot de passe de démonstration aléatoire, lance le service
   au redémarrage, et active HTTPS. Les comptes et les clés sont écrits dans `/opt/arrimo/acces-demo.txt`.
4. Pour une mise à jour : recopier le nouveau `arrimo.zip` et relancer la même commande ; la base est conservée.
