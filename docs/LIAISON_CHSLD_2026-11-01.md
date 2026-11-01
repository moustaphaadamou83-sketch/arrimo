# Arrimo — module hospitalier « Liaison CHSLD » (1er novembre 2026)

Sources : cahiers « Nouveau module Liaison CHSLD » et « Module universel Liaison CHSLD ». Branche `chsld-20261031`.

## 1. Défaut d'origine : demande du CHSLD non visible dans l'Hôpital B
Reproduit par test (`tests/chsld.test.cjs`, « défaut reproduit puis parcours complet »). Trois causes cumulées :
- **Le CHSLD ne trouvait pas l'hôpital.** La liste des hôpitaux venait de `/chsld/reseau`, qui exige le module « Réseau inter-CHSLD ». Si ce module était désactivé, la liste restait vide et aucune demande ne partait.
- **L'hôpital n'était pas prévenu.** Aucune notification n'était créée à l'envoi.
- **La demande était noyée dans les transferts.** Elle n'apparaissait qu'en bas de l'écran Transferts, et l'hôpital n'avait aucune action avant que le CHSLD confirme le départ.

Correction du parcours complet, pas seulement de l'affichage :
- liste dédiée `/chsld/hopitaux` (hôpitaux actifs ayant la Liaison CHSLD) ;
- notification enregistrée dans la même transaction que la demande ;
- étapes côté hôpital ;
- module séparé des transferts.

## 2. Un seul module, commun à tous les hôpitaux
- **Référentiel unique** (`src/types-etablissement.js`) : `liaison_chsld`, catégorie hôpital, disponible, dépendances admissions et transferts. Il n'est jamais proposé à un CHSLD.
- **Activé par défaut** (drapeau absent = actif), donc actif pour A, B et C sans aucune modification de leurs données. Les futurs hôpitaux le reçoivent selon leur configuration ; il est proposé à la création dans SH.
- **SH** : migration n° 38, qui ajoute une seule ligne au catalogue. Configuration opérationnelle : case « Liaison CHSLD », construite à partir des drapeaux exposés par l'environnement.
- **Désactivation** : l'onglet est masqué et l'API répond `module_desactive`. Les CHSLD ne peuvent plus envoyer à cet hôpital. Aucune donnée n'est détruite ; à la réactivation, l'historique réapparaît.
- **Compatibilité** : une console ou un environnement plus ancien qui ne connaît pas le drapeau ne le modifie pas.

## 3. Moteur commun, type de parcours distinct
Aucun moteur parallèle : ce sont les coordinations CHSLD ↔ hôpital existantes (`src/chsld.js`), avec les mêmes verrous, numéros de version, journal et notifications. On a ajouté seulement des colonnes horodatées (`db/schema.sql`, rejouable). **Chaque horodatage est la preuve d'une confirmation humaine.**

| Étape | Qui confirme | Trace |
|---|---|---|
| Demande transmise (identité vérifiée) | CHSLD | `envoyee`, notification à l'hôpital |
| Reçue par l'hôpital | Hôpital | `recue_hopital_le` |
| Acceptée ou refusée (facultatif) | Hôpital (coordination) | `acceptee` ou `refusee`, notification au CHSLD |
| Départ confirmé | CHSLD | `en_cours`, résident hospitalisé, place conservée |
| Arrivée physique confirmée | Hôpital, seulement après le départ | `recue`, `arrivee_le` |
| Admission ou urgence | Hôpital (décision humaine) | `orientation`, référence de l'épisode à l'hôpital |
| Retour préparé, accepté, départ, reçu | Hôpital, puis CHSLD | coordination `retour` liée |
| Clôturée | à la réception du retour par le CHSLD | `cloturee_le` |

Cas particuliers :
- **Annulation** par le CHSLD avant le départ.
- **Incidents** : arrivée retardée, informations manquantes (demande incomplète), hospitalisation prolongée, retour retardé.
- **Expiration** : celle qui existait déjà.

**Préparer l'admission** :
- Crée une demande d'admission ordinaire (`terrain.creerDemande`), avec les mêmes contrôles de format de référence et de doublon.
- Aucune priorité clinique n'est attribuée : `priorite_code` reste vide jusqu'à la validation par une personne habilitée.

**Orienter vers les urgences** : seulement si le module Urgence est actif. La décision est enregistrée ; le placement sur civière se fait dans l'écran Urgence.

**Identité** :
- L'épisode hospitalier porte la référence de l'hôpital (`P-…`).
- L'identité et le dossier du CHSLD ne sont ni copiés ni modifiés.
- L'hôpital ne voit que `R-…`.

**Doublons** :
- Une seule demande ouverte par résident : verrou du résident, puis contrôle.
- Identifiant d'envoi (`cle`) : un renvoi après une coupure réseau rend la même demande.
- Un seul retour ouvert à la fois.

## 4. Interface hospitalière
Onglet « Liaison CHSLD » dans la navigation des hôpitaux. Il est masqué si le module est désactivé. Quatre sous-onglets :
- Arrivées CHSLD ;
- À accueillir ;
- Hospitalisations et retours ;
- Historique.

Chaque fiche montre :
- le CHSLD d'origine et la référence du résident ;
- l'étape, l'heure de transmission et la dernière confirmation ;
- les étapes détaillées et les actions permises.

Le panneau « Résidents de CHSLD » a été **retiré de l'écran Transferts**.

Côté CHSLD :
- le départ est possible depuis « transmise » ou « acceptée » ;
- les libellés des étapes sont partagés avec l'hôpital.

## 5. OG
**Hôpital** (`src/og-liaison.js`) :
- Questions prises en charge :
  - résidents attendus (aujourd'hui) ;
  - arrivés en attente d'accueil, ou arrivée à confirmer ;
  - retours en préparation ;
  - demandes d'un CHSLD nommé ;
  - état d'une référence `R-…` ;
  - « prépare le retour de R-… vers son CHSLD ».
- La préparation du retour produit une carte à confirmer, avec une date choisie par la personne : **rien n'est écrit avant la confirmation**.
- OG cite la dernière confirmation et son horodatage. Il rappelle qu'une demande transmise n'est pas une arrivée.
- Pour un nom (« Jean Dupont »), il explique que l'hôpital ne voit que les références.
- Il refuse toute orientation ou priorité clinique.

**CHSLD** : « Où en est la demande de transfert de Jean Dupont vers l'Hôpital B ? » donne l'étape, l'hôpital et l'heure de la dernière confirmation enregistrée.

## 6. Tests (suite de recette « chsld », données fictives seulement)
**17 tests sur 17** sur une base neuve, avec une vraie console SH et un environnement isolé contenant A, B, C et les deux CHSLD. Couvert :
- **Catalogue** : module au catalogue SH, actif pour A, B et C, absent des CHSLD.
- **Parcours Érables → B** : défaut reproduit ; renvoi idempotent ; doublon refusé ; notification ; invisible pour A ; transferts inchangés ; arrivée impossible avant le départ ; réception, acceptation, départ, arrivée, admission (référence contrôlée, sans priorité), retour (OG puis personne), clôture ; étapes complètes ; journal sans nom ; OG dans les deux établissements.
- **Érables → A** : accueil à l'urgence, puis retour.
- **Saint-Laurent → C** : refus (résident resté présent), puis parcours complet jusqu'au retour.
- **Cas limites** : annulation, deux envois simultanés (un seul accepté), mauvais hôpital, isolation entre A et B, rôles, identité à vérifier.
- **Activation depuis SH** : désactivation et réactivation pour C (accès masqué, envois refusés, données conservées, console plus ancienne sans effet) ; futur hôpital « Hôpital D — Essai de validation » créé dans SH (environnement de test seulement), module proposé et actif, aucune demande reçue avant l'activation.
- **Captures** du module dans A, B et C (et B sur téléphone, sans défilement horizontal) : `.local/captures-chsld/liaison-chsld-hopital-*.png`. L'écran Transferts ne contient plus de résident de CHSLD.

## 7. Publication
- **Démo et SH seulement**, après une recette complète réussie. Le mécanisme est le même que pour la release CHSLD (`.local/livrer-demo-sh.py`) : sauvegarde, restauration vérifiée sur copie, migration répétée, bascule atomique, retour arrière applicatif.
- **Exception du contrôle de publication SH** : élargie d'un seul code, `liaison_chsld` (liste fermée ; aucune ligne existante modifiée). Voir `docs/CHSLD_MIGRATION_CATALOGUE_SH.md`.
- **Défaut antérieur, hors module** : le test unitaire « API SH : aucune donnée de parcours dans la lecture du référentiel » (`tests/configuration-operationnelle.test.cjs`) échoue déjà sur l'état committé. La réponse contient désormais `type_etablissement` et `modules_modifiables`, ajoutés avec les CHSLD. Ce n'est pas corrigé ici.
