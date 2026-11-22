# Rencontre Santé Québec Mauricie-et-Centre-du-Québec — analyse préparatoire

Analyse en lecture seule, 16 nov. 2026, à partir du code d'Arrimo (commit 3ab4141) et du texte transmis (courriel de Santé Québec MCQ, ce qu'on sait du DSN). Rien n'a été modifié et le site du CIUSSS n'a pas été consulté.
Rencontre de 30 minutes avec une coordonnatrice de la gestion des lits et sa supérieure. Leur question centrale : l'arrimage avec Epic (DSN, en place depuis le 9 mai 2026 dans 5 hôpitaux et les CHSLD publics).
Document lié : `docs/positionnement-dsn.md` (détail technique de la connexion à Epic et estimation des efforts).

---

## A. Ce qu'Arrimo fait VRAIMENT pour une coordonnatrice de la gestion des lits

Écrans de l'hôpital (`public/index.html`, onglets) et code qui les porte :

| Écran | Ce qu'il fait (code) |
|---|---|
| **OG (Copilote)** | Briefing, recommandations et questions en français (`src/copilote.js`). Il propose et un humain décide : aucune action automatique. |
| **Lits** | Tableau des lits par unité : libre, occupé, réservé, nettoyage, fermé (avec motif, dont « personnel »). Tous les changements passent par `src/regles.js` (verrou, version, journal, refus journalisés). |
| **Urgence** | Civières : occupation, durée de séjour, plus de 24 h et plus de 48 h, changement de civière, statistiques (`src/civieres.js`). |
| **Admissions** | File d'admission de l'urgence vers les unités, priorités, besoins de chambre, attribution d'un lit compatible (`src/terrain.js`, `src/priorites.js`). |
| **Transferts** | Recommandation de l'hôpital le plus proche qui a un lit adapté (sauf s'il est débordé), demande, acceptation et suivi (`src/services.js`). |
| **NSA** | Liste des patients NSA, durée, et **sortie vers un CHSLD** : demande d'hébergement transmise du CHSLD le plus proche au plus loin, départ confirmé par l'hôpital, avis aux deux établissements (`src/nsa-chsld.js`). |
| **Nettoyage** | Lits à nettoyer après un congé, prise en charge et fin du nettoyage (écran prévu pour la tablette). |
| **Liaison CHSLD** | Arrivées de résidents de CHSLD hospitalisés, accueil et retour vers le CHSLD (`src/liaison-chsld.js`). |
| **Liaison Secours** | Ambulances annoncées, heure d'arrivée prévue, réservation de civière avec confirmation en 60 secondes, alertes à 10, 5 et 2 minutes (`src/prealertes.js`, `src/reservations.js`). |
| **Arrimo Sillage** | Parcours d'un résident en 6 étapes : CHSLD, ambulance, hôpital, retour (`src/continuite.js`). |
| **Vigilance, Indicateurs** | Niveaux d'alerte, taux d'occupation, NSA, séjours à l'urgence. |
| **Réseau, National** | Capacité des autres établissements qui partagent, carte par proximité (`src/national.js`). |
| **Journal** | Historique immuable de chaque action (déclencheurs PostgreSQL). |
| **Recherche** | Recherche par référence, prénom ou nom, limitée à son établissement (`src/recherche.js`). |

**Risque de doublon avec Epic.** Lits, Urgence, Admissions et Nettoyage sont **les fonctions qu'Epic couvre peut-être déjà** (gestion des lits et des admissions, hygiène et salubrité). C'est à vérifier avec elles : les infos publiques du DSN n'en parlent pas. Les tâches du personnel (CHSLD) rejoignent Rover, et Arrimo Famille ou le portail des proches rejoint Mon dossier santé, mais pour un autre public : les proches des résidents de CHSLD.

---

## B. Arrimage Epic : la vérité du code

**Ce qui existe (fait) :**
- **HL7 v2 ADT reçu sur HTTPS**, sans MLLP (`src/hl7v2.js`) : A01 admission, A02 transfert interne, A03 congé, A04 arrivée à l'urgence, A16 congé prévu. Arrimo répond par un accusé HL7 (AA ou AE) et ne rejoue jamais deux fois le même message. Il ne lit que la référence (PID-3), jamais le nom ni la date de naissance.
- **Événements ADT en JSON** pour un moteur d'interfaces (`src/connecteurs.js`).
- **FHIR R4 en lecture seule, Arrimo étant le serveur** (`src/fhir.js`) : établissement, lits avec leur statut, services, ambulances annoncées. Aucune ressource Patient.
- **Arrimo Connect v1** (requêtes signées) et **webhooks signés** : prévus pour les systèmes de secours (préalertes, transports).
- **Import Excel ou CSV** de la structure (unités, chambres, lits, civières) et des comptes.
- Toutes les connexions s'activent client par client depuis la console SH. Clés et secrets ne sont jamais affichés : ils sont remis une seule fois au contact technique.

**Ce qui est testé :**
- Testé : A01 en HL7 (accusé, rejeu, identité jamais conservée, message non pris en charge refusé) ; admission, congé et congé prévu en JSON ; FHIR (lecture limitée à son établissement, jamais de Patient) ; Connect v1 ; webhooks.
- **Non testé : A02, A03, A04 et A16 en HL7, ainsi que le transfert interne et l'arrivée à l'urgence par un connecteur réel.**
- **Jamais testé avec Epic** ni avec un vrai message Epic.

**Ce qui manque (rien de cela n'est fait) :**
- Les messages ADT A08, A11, A12, A13, A06/A07, A17, A20, A21/A22. Aucune annulation ni correction n'est reçue.
- Le **statut NSA** venant d'Epic.
- Une correspondance des codes de lits pour un connecteur réel : les codes d'Epic doivent être identiques à ceux d'Arrimo.
- La pseudonymisation de PID-3 est **attendue du moteur d'interfaces**.
- Un **client FHIR** pour lire Epic.
- La **connexion avec les comptes `@ssss.gouv.qc.ca`** (SSO OpenID Connect ou SAML).
- Le **lancement depuis Epic** (SMART on FHIR).
- L'**hébergement au Canada** et l'EFVP (Loi 25).

Effort estimé côté Arrimo : environ 290 à 460 h, sans compter le travail de leur équipe d'interfaces ni l'inscription chez Epic (délai externe de plusieurs mois pour SMART on FHIR). Détail dans `docs/positionnement-dsn.md`.

**La phrase de positionnement à corriger.** Dire « Arrimo lit Epic sans ressaisie » est faux aujourd'hui. Formulation juste : « Epic gère le patient à l'intérieur ; Arrimo relie ce qui est à l'extérieur (ambulances, CCS, CHSLD, proches, autres hôpitaux) et il est conçu pour recevoir les mouvements d'Epic par HL7 afin d'éviter la ressaisie ».

---

## C. Les 10 questions probables, avec des réponses vraies

1. **Comment Arrimo se connecte-t-il à Epic ?**
   Votre moteur d'interfaces envoie à Arrimo les messages HL7 ADT standards (admission, transfert, congé, congé prévu, arrivée à l'urgence) par HTTPS, et Arrimo met les lits à jour avec les mêmes règles qu'à l'écran. Ce connecteur fonctionne avec des données fictives ; il n'a encore jamais été branché sur Epic.

2. **Faudra-t-il ressaisir ce qui est déjà dans Epic ?**
   Une fois l'ADT branché, les admissions, les congés et les transferts internes arrivent seuls, et le nom du patient n'est jamais ressaisi. Aujourd'hui, le statut NSA, les demandes de lit de l'urgence et la fin du nettoyage se saisissent encore dans Arrimo. Si Epic les gère chez vous, il faudra les faire venir d'Epic ou ne pas les utiliser dans Arrimo.

3. **Est-ce que ça fait doublon avec la gestion des lits d'Epic ?**
   Pour les lits à l'intérieur d'un hôpital, possiblement : c'est à regarder ensemble selon ce que vous utilisez déjà dans Epic. Ce qu'Arrimo ajoute surtout se passe entre les organisations : ambulances et CCS, CHSLD (y compris privés), autres hôpitaux et proches.

4. **Quelles données de patients Arrimo conserve-t-il ?**
   Une référence pseudonymisée, jamais de nom, de date de naissance ni de diagnostic en production. Le nom envoyé dans un message HL7 n'est ni lu ni conservé, et un test le vérifie.

5. **Où sont hébergées les données ?**
   La démonstration contient seulement des données fictives et n'est pas hébergée au Canada. La production sera hébergée au Canada, après une évaluation des facteurs relatifs à la vie privée selon la Loi 25 : ce n'est pas encore fait, et l'installateur refuse une production sans cette confirmation.

6. **Nos employés pourront-ils se connecter avec leurs comptes du réseau ?**
   Pas aujourd'hui : Arrimo a ses propres comptes, avec double authentification hors démonstration. La connexion avec vos comptes `@ssss.gouv.qc.ca` (OpenID Connect ou SAML) est à développer, en partant de votre fournisseur d'identité.

7. **Peut-on ouvrir Arrimo depuis Epic ?**
   Non pour l'instant : le lancement depuis Epic (SMART on FHIR) n'existe pas dans Arrimo. Il suppose aussi une démarche d'inscription chez Epic, qui a ses propres délais.

8. **Comment les ambulances et le CCS sont-ils reliés ?**
   Le CCS et les ambulances ont leurs propres écrans dans Arrimo, ou une API signée pour leurs systèmes. L'hôpital reçoit la préalerte, l'heure d'arrivée prévue et une demande de réservation de civière qu'il confirme en 60 secondes. Arrimo transmet l'information, le CCS décide, et aucune ambulance n'est commandée automatiquement.

9. **Que se passe-t-il pour nos patients NSA qui attendent un CHSLD ?**
   Depuis l'onglet NSA, la demande d'hébergement est transmise aux CHSLD du plus proche au plus loin. L'hôpital confirme le départ, le CHSLD l'arrivée, et les deux établissements reçoivent un avis sans identité. Le statut NSA lui-même se déclare dans Arrimo, car il n'arrive pas encore d'Epic.

10. **Qui décide : Arrimo ou le personnel ?**
    Toujours une personne : OG propose, mais ne pose aucun diagnostic et ne déclenche aucune action. Chaque action, même proposée, passe par les mêmes règles et laisse une trace dans un journal impossible à modifier.

Autres questions possibles : le coût, la formation et le soutien. Ces sujets ne viennent pas du code et sont à préparer à part (prix encore ouvert dans la proposition de projet pilote).

---

## D. La démo de 30 minutes

Démo publique : https://demo.arrimo.senseafri.com, uniquement avec des données fictives. Mots de passe : ceux de la démo, **jamais affichés à l'écran ni dans un document**. La connexion se fait avant la rencontre.

| Min. | Écran | Compte | Message |
|---|---|---|---|
| 0–3 | Positionnement (sans écran) | — | « Epic à l'intérieur, Arrimo entre les organisations », sans prétendre qu'Arrimo est déjà connecté. |
| 3–8 | **OG**, puis **Lits**, puis **Urgence** de l'Hôpital B | `hopital.b@demo.arrimo` | La vue d'ensemble de la coordonnatrice : occupation, civières de plus de 24 h et plus de 48 h, ce qu'OG propose. |
| 8–15 | **NSA** → sortie vers le **CHSLD des Érables** | `hopital.b@demo.arrimo` et `coordination.erables@chsld.example.invalid` (deux fenêtres) | Parcours principal du guide `/demo-guide` : demande, acceptation, départ, arrivée, avis. Puis le retour de Jean Dupont et l'avis à Marie (Arrimo Famille). |
| 15–21 | **Liaison Secours** | `ambulance.demo@demo.arrimo` (téléphone), `ccs.demo@demo.arrimo`, `hopital.b@demo.arrimo` | Préalerte, heure d'arrivée prévue, réservation de civière confirmée en 60 s, civière réservée à l'urgence. |
| 21–24 | **Réseau / National** | `reseau@demo.arrimo` | Capacité des autres hôpitaux, recommandation par proximité. |
| 24–30 | **Arrimage Epic** (sans écran, ou une diapositive) | — | Ce qui existe (HL7 ADT, FHIR en lecture), ce qui n'est pas fait, et la proposition de commencer par une analyse avec leur équipe d'interfaces. Garder du temps pour les questions. |

Avant la rencontre :
- Restaurer la référence `/var/backups/arrimo/reference-demo-ciusss-20261116-v2.dump` selon la procédure connue.
- Vérifier que DM-101 est disponible et qu'aucune préalerte n'est restée ouverte.

---

## E. Points faibles : à corriger ou à ne pas montrer

**À ne pas présenter comme faits :**
- La connexion à Epic : seule l'admission (A01) est testée en HL7, et jamais avec Epic.
- Les RPA et les RI : ils sont « à venir » dans le code et refusés à la création.
- La connexion avec les comptes du réseau, le lancement depuis Epic et l'hébergement au Canada.

**À éviter à l'écran :**
- Les fiches de patients fictifs avec nom et date de naissance, et les pathologies ou symptômes fictifs : autorisés en démo seulement, mais ils ressemblent à des données cliniques et brouillent le message « aucune donnée médicale ».
- Le journal en détail et l'onglet Administration : sans intérêt pour elles, et cela invite les questions de sécurité dans le mauvais sens.
- La démo n'a pas de double authentification (décision voulue) : si on demande, préciser qu'elle est exigée hors démonstration.

**Risques de doublon à cadrer d'avance :**
- Lits, Urgence, Admissions et Nettoyage face à Epic : poser la question de ce qu'elles utilisent dans Epic au lieu d'insister sur ces écrans.

**Défauts connus (faibles pour la démo) :**
- Les tests de l'API ne s'arrêtent pas d'eux-mêmes à la fin, et 2 tests SH échouent déjà de façon connue. Sans effet sur la démo.
- La démo est gelée mercredi soir : **ne rien corriger qui touche la démo avant la rencontre** ; s'il faut absolument corriger, refaire ensuite la sauvegarde de référence.
