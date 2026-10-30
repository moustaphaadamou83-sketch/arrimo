# Historique longitudinal des patients — phase A — 30 octobre 2026

Source : « Ajout au cahier ultime OG — constantes vitales, passages hospitaliers et historique longitudinal ».

**Décision de Moustafa (30 oct. 2026) : phase A seulement.** Les constantes vitales (phase B) sont des données cliniques. Elles restent interdites par la règle permanente d'Arrimo tant que la validation réglementaire n'est pas faite (Loi 25, hébergement au Canada). Il en va de même pour les documents cliniques (phase C) et l'aide au triage (phase D).

## Audit de l'existant
Avant ce travail, il existait déjà :
- une fiche patient **fictive** (prénom, nom, date de naissance, référence `P-…`), en démo et recette seulement ;
- la détection des doublons, sans fusion automatique ;
- l'arrivée à l'urgence sur une civière ;
- les demandes d'admission, les transferts et un journal immuable ;
- la recherche et la fiche patient dans OG (travail de Codex).

Il manquait :
- la notion de **passage** ;
- un historique consultable ;
- la réutilisation d'un dossier au retour d'un patient.

## Ce qui est livré
- **Modèle.** Patient → passages (`patient_passages` : urgence, consultation, admission) → mouvements (lits, civières), demandes de lit et transferts, rattachés au passage selon leurs dates.
  - Aucun texte libre, aucune donnée clinique.
  - Un passage n'est jamais supprimé. Qui l'a ouvert et qui l'a clos est tracé.
- **Arrivée à l'urgence.** Chaque arrivée ouvre un passage.
  - Pour un patient connu, la référence existante peut être saisie : le dossier est réutilisé, sans doublon.
  - Le passage suit le parcours : hospitalisé à l'admission, transféré et clos lors d'un transfert.
- **Un seul passage ouvert à la fois.** L'ouverture d'un nouveau passage clôt le précédent (résultat « sorti »). Une date d'arrivée antérieure au passage en cours est refusée.
- **Écran Patients** (onglet Opérations, démo et recette seulement) :
  - recherche par nom, prénom ou référence ;
  - **vérification d'identité obligatoire** avant d'ouvrir l'historique ;
  - historique des passages avec leurs événements ;
  - nouveau passage (consultation, admission), clôture avec résultat ;
  - mention claire : seuls les passages enregistrés dans Arrimo sont affichés, et leur conservation suit les règles applicables (aucune promesse de durée).
- **OG.** La fiche patient d'OG propose un bouton « Historique des passages », qui ouvre l'écran Patients (vérification d'identité comprise).
- **Sécurité** :
  - contrôle de l'établissement à chaque appel ;
  - refus en production et en pilote ;
  - journal limité aux références (« Passage ouvert », « Passage clos », « Historique patient consulté »), sans aucun nom.

## API
| Méthode | Chemin | Rôle |
|---|---|---|
| GET | `/api/patients/:id/historique?identite_verifiee=1` | Historique. Répond 428 sans vérification d'identité. |
| POST | `/api/patients/:id/passages` | Nouveau passage : consultation ou admission. |
| POST | `/api/passages/:id/cloture` | Clôture : sorti, hospitalisé, transféré ou annulé. |
| POST | `/api/urgence/arrivees` | Accepte `patient_reference` pour réutiliser un dossier existant. |

## Tests (patients entièrement fictifs)
**Scénario A/B/C n° 8** :
- passage ouvert à l'arrivée, historique refusé sans vérification (428) ;
- clôture, double clôture refusée ;
- retour simulé **dix ans plus tard** : même dossier, ancien passage conservé, aucun doublon ;
- nouveau passage qui clôt le précédent, un seul passage ouvert ;
- saisies invalides refusées ;
- isolement de B vers A (403 en lecture, en création et en clôture) ;
- journal sans identité ;
- refus en production et en pilote.

**Scénarios 1 et 4** :
- le passage devient « hospitalisé » à l'admission ;
- il est « transféré » et clos lors d'un transfert.

**Test navigateur** (ordinateur et téléphone) : recherche, vérification d'identité, historique, nouveau passage, clôture, état vérifié en base.

## Limites et suite
- **Phase B** (constantes vitales et dictée par OG) : non développée, sur décision de Moustafa. À rouvrir après la validation réglementaire et l'approbation de protocoles cliniques.
- **Phases C et D** (documents cliniques, aide au triage) : non développées. Elles exigent une intégration autorisée (par exemple HL7 FHIR) et des protocoles validés.
- **Événements antérieurs** : les événements survenus avant la création des passages sont affichés à part (« Événements antérieurs aux passages enregistrés »), sans rien inventer.
- **Contacts, allergies, interprète, mobilité** (§7) : non ajoutés. Ce sont des données sensibles ou cliniques qui demandent une source clinique fiable et une décision.
- **Recherche entre établissements** : l'historique reste propre à chaque établissement. Aucune consultation entre hôpitaux n'est possible sans base légale et technique.

## Publication
Release `refonte-20261030t1828`, publiée le 30 octobre 2026 sur six environnements, identiques : principal, démo A/B/C, recette, validation, SH et SH-validation.
- Recette `.local/preuves-sh-lot1/20261030175954_d75bdf/` : 16 suites, 225 tests, aucun échec.
- Santé `ok` partout. Configurations préservées. Scénario A/B/C et comptes de démo intacts.
- Droits des comptes applicatifs vérifiés sur la nouvelle table `patient_passages` (quatre bases hospitalières).
- Captures avant/après de la démo B en ligne (ordinateur et téléphone) dans `docs/captures-refonte-20261030/`.

**Hôpitaux A, B et C** : même logiciel, réglages propres. Vérifiés par le scénario A/B/C, par les tests d'interface et sur la démo en ligne.

**Nouvel établissement provisionné depuis SH** : il reçoit la même interface. Vérifié par la suite « raccordement » et par les tests OG de provisionnement (§20.6).
