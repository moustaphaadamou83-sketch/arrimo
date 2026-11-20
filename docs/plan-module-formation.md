# Module 🎓 Formation — audit et plan (22 nov. 2026)

Cahier de Moustafa : « Module Formation (couvre tous les modules d'Arrimo) ». **Rien n'est construit avant son « oui ».**

## 1. Audit : ce qui existe déjà

| Élément | État | Réutilisable pour |
|---|---|---|
| Aide intégrée par écran (`public/i18n/aide.fr.js` / `aide.en.js`, 30 écrans, texte par rôle) | En service, FR/EN, testée | Texte de base des capsules ; bouton « ? » |
| « Premiers pas » à la première connexion (`premiersPas()` dans `public/app.js`) | En service | Point d'entrée vers « Ma formation » |
| OG « comment faire… » (`src/og-guide.js`, 6 sujets) | En service | Renvoi d'OG vers la bonne capsule |
| SH : sessions de formation, invitations de calendrier, participants, formation par rôle (`src/sh/formation-invitations.js`, routes `/hopitaux/:id/formation/*`) | En service | Séances en direct, superutilisateurs, suivi côté SH |
| Générateur de données fictives (`src/formation.js`, recette seulement) | En service | Base du bac à sable |
| Chaîne vidéo automatique (`/root/arrimo-video/outils` : Playwright enregistre, ffmpeg monte, titres) | Utilisée le 17 nov. (vidéo de 9 min) | Vidéos des capsules, régénérées quand un écran change |
| Scripts de captures (site v2, scénario 14 étapes, simulation de tous les modules) | En service | Captures et vérification des exercices |
| Carte 🎓 Formation dans SH (`public-sh/modules-cartes.js`) | Carte « incluse », sans module derrière | Devient un vrai module activable |
| `docs/plan-module-formation.md` cité par le cahier | **Introuvable** (ce fichier le remplace) | — |
| Modèle Triage / AIC « déjà rédigé » (vidéo en 10 scènes, exercice, test) | **Introuvable sur le serveur** : à me transmettre | Gabarit de toutes les capsules |

Manque : progression par personne, capsules, exercices notés, bac à sable isolé, attestations, tableau du formateur, export SCORM.

## 2. Principes retenus
- Chaque personne voit seulement **son rôle et les modules activés** de son établissement (même règle que les onglets).
- Capsule = **une tâche, 2 à 3 min** : vidéo ou animation avec captures réelles de la démo (données fictives), sous-titres FR/EN, **emplacement de voix** prêt pour le service de synthèse vocale ; « À vous de jouer » dans le bac à sable avec bulles « cliquez ici » ; mini-test (1 exercice noté automatiquement + 3 questions).
- **Bac à sable** : un environnement à part (comme la recette), données fictives, **remis à zéro automatiquement** (chaque nuit, et scénario rechargé au début de chaque exercice), jamais relié à la démo ni à de vraies données.
- Notation **vérifiée par le serveur** (l'état attendu existe-t-il dans le bac à sable ?), jamais par le seul navigateur.
- Attestation PDF FR/EN (nom, rôle, date, parcours) ; aucune donnée patient nulle part.

## 3. Parcours × capsules

Légende : ● capsule du parcours · ○ capsule facultative. Les capsules OG, Sillage, Vigilance (O1 à O3) sont dans **tous** les parcours.

| Module | Capsule (une tâche) | Triage/AIC | Gestion lits | Coord. NSA/liaison | Chef d'unité | Hygiène | Coord. CHSLD | RPA/RI/RTF | Intervenant CLSC | Répartiteur CCS | Ambulancier | Superviseur amb. | Transporteur | Coord. transferts | Direction régionale | Famille | Admin établ. | Formateur |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 🚑 Secours | S1 Envoyer une préalerte | | | | | | | | | | ● | ● | | | | | | ● |
| | S2 Prendre en compte une préalerte, confirmer le bon véhicule | ● | | | | | | | | | | | | | | | | ● |
| | S3 Suivre unités et missions | | | | | | | | | ● | | ● | | | | | | ● |
| | S4 Superviser (non reçues, non prises en compte) | | | | | | | | | ● | | ● | | | | | | ● |
| ⏱️ Chrono | C1 Marquer triage et civière libérée | ● | | | | | | | | | ● | | | | | | | ● |
| | C2 Corriger une heure avec motif | ● | | | | | | | | | ● | ● | | | | | | ● |
| | C3 Lire le rapport mensuel | | | | ● | | | | | ● | | ● | | | ● | | | ● |
| 🚨 Urgences en direct | U1 Déclarer le statut de l'urgence | ● | | | ● | | | | | | | | | | | | | ● |
| | U2 Planifier une fermeture | | | | ● | | | | | | | | | | | | ● | ● |
| | U3 Consulter les urgences avant de partir | | | | | | | | | ● | ● | | | | | | | ● |
| 🔁 Transferts | T1 Demander un transfert | | ● | | | | | | | | | | | ● | | | | ● |
| | T2 Accepter ou refuser avec motif | | ● | | ● | | | | | | | | | ● | | | | ● |
| | T3 Fiche, délais et alertes | | ● | | | | | | | | | | | ● | ● | | | ● |
| | T4 Rapatriement proposé | | | | | | | | | | | | | ● | | | | ● |
| 🚐 Transport | R1 Réserver un transport | | ● | ● | | | ● | ● | | | | | | ● | | | | ● |
| | R2 Confirmer ou refuser une plage | | | | | | | | | | | | ● | | | | | ● |
| 🏥 Hôpital et NSA | H1 Lits : réserver, occuper, libérer | ● | ● | | ● | | | | | | | | | | | | | ● |
| | H2 Admissions et file | ● | ● | | | | | | | | | | | | | | | ● |
| | H3 Nettoyage prioritaire | | | | | ● | | | | | | | | | | | | ● |
| | H4 Épisode NSA et orientation | | | ● | ● | | | | | | | | | | | | | ● |
| | H5 Places compatibles et demande d'hébergement | | | ● | | | | | | | | | | | | | | ● |
| | H6 Congés prévus et vigilance des lits | | ● | | ● | | | | | | | | | | | | | ● |
| 🏡 Hébergement | E1 Résidents et chambres | | | | | | ● | ● | | | | | | | | | | ● |
| | E2 Recevoir une demande d'hébergement | | | ● | | | ● | ● | | | | | | | | | | ● |
| | E3 Départ vers l'hôpital et retour | | | ● | | | ● | ● | | | | | | | | | | ● |
| | E4 Tâches et entretien des chambres | | | | | ● | ● | | | | | | | | | | | ● |
| 🛏️ Bourse des places | B1 Chercher une place avec filtres | | | ● | | | ● | ○ | | | | | | ● | ● | | | ● |
| | B2 Fiche de transfert d'une page | | | ● | | | | | | | | | | | | | | ● |
| | B3 Inviter un professionnel externe | | | ● | | | | | | | | | | | | | ● | ● |
| ✅ Visites confirmées | V1 Planifier les visites | | | | | | ● | ● | | | | | | | | | | ● |
| | V2 Confirmer arrivée et départ | | | | | | | | ● | | | | | | | | | ● |
| | V3 Visite manquée : agir | | | | | | ● | ● | | | | | | | | | | ● |
| 🛡️ Avant l'appel | A1 Utiliser la liste avant l'appel | | | | | | ● | ● | | | | | | | | | | ● |
| | A2 Écrire la liste de l'établissement | | | | | | | | | | | | | | | | ● | ● |
| 📊 Données | D1 Lire le tableau régional | | | | ● | | | | | | | | | | ● | | | ● |
| | D2 Listes d'attente et export | | | ● | | | | | | | | | | | ● | | | ● |
| 🆘 Mode crise | K1 Déclencher une évacuation | | | | | | ● | ● | | | | | | | | | ● | ● |
| | K2 Confirmer les lieux et suivre | | | | | | ● | ● | | | | | | | ● | | | ● |
| 👨‍👩‍👧 Famille | F1 Le portail des proches | | | | | | | | | | | | | | | ● | | ● |
| | F2 Inviter un proche | | | | | | ● | ● | | | | | | | | | | ● |
| Console SH | SH1 Activer un module, gérer les comptes | | | | | | | | | | | | | | | | ● | ● |
| ✨🧭👁️ Transversal | O1 Demander à OG · O2 Ouvrir le Sillage · O3 Lire la Vigilance | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ○ | ● | ● |

**Total : 42 capsules** (39 de modules + 3 transversales). Le Formateur / superutilisateur voit toutes les capsules de son établissement.

## 4. Ordre de construction et heures

| Lot | Contenu | Heures |
|---|---|---|
| 1 | **Moteur de formation** : tables (parcours, capsules, progression, essais, réponses), attribution automatique par rôle et modules, page « Ma formation » (anneau de progression, prochaine capsule en un clic, cartes avec durée et état, badges), lecteur de capsule (vidéo, sous-titres FR/EN, emplacement de voix), mini-test et notation, FR/EN, mode sombre, téléphone, accessibilité, tests | 40 |
| 2 | **Bac à sable** : environnement séparé, comptes d'apprenant, scénario rechargé par exercice, remise à zéro nocturne, isolation testée ; bulles « cliquez ici » dans l'application | 22 |
| 3 | **Chaîne de capsules** : captures et vidéos régénérées automatiquement depuis la démo (reprise de `/root/arrimo-video`), sous-titres, fichier de scénario par capsule | 10 |
| 4 | **Premiers parcours** : Triage / AIC (8 capsules), Ambulancier (7), Coordination NSA et liaison (12) — sur le gabarit Triage / AIC | 34 |
| 5 | Attestation PDF FR/EN, tableau du formateur (vu, pratiqué, réussi, besoin d'aide ; par établissement, rôle, module ; CSV), superutilisateurs par site, satisfaction en fin de parcours | 18 |
| 6 | Aide en contexte : bouton « ? » de chaque écran vers sa capsule ; OG « comment faire… » vers la capsule | 8 |
| 7 | Les 14 autres parcours (≈ 20 capsules restantes, les autres sont partagées) | 40 |
| 8 | Export SCORM 1.2 / cmi5 préparé, non activé | 8 |
| 9 | Activation : carte 🎓 dans SH « Disponible », démo (hôpitaux A, B, C, deux CHSLD, DEMO-AMB, DEMO-CCS, CLSC), publication recette → démo → SH | 4 |
| | **Total** | **184 h** |

Chaque lot : tests verts, puis publication avec les règles habituelles (sauvegarde, recette → démo → SH, retour en arrière si échec, rapport).

## 5. Décisions demandées à Moustafa
1. **Modèle Triage / AIC** (10 scènes, exercice, test de 60 s) : me le transmettre ; il n'est pas sur le serveur.
2. **Polices** : le cahier demande Space Grotesk et Inter ; l'application utilise aujourd'hui Public Sans. Formation seulement en Space Grotesk / Inter (hébergées sur nos serveurs, licence libre), ou toute l'application ?
3. **Bac à sable** : un nouvel environnement « formation » sur le serveur de démonstration (service, base, sous-domaine `formation.arrimo.senseafri.com`). C'est une action sur le serveur : votre accord est requis.
4. **Voix** : nom du service de synthèse vocale quand il sera prêt ; l'emplacement (piste audio par langue) est prévu dès le lot 1.

## 6. État d'avancement (22 nov. 2026)
- Lot 1 (moteur, « Ma formation », Triage / AIC) : fait.
- Lot 2 (« À vous de jouer ») : exercice guidé **dans la page de formation**, sur les vraies captures de la démo, état et note tenus par le serveur, bulle « cliquez ici ». Reste : le bac à sable comme environnement séparé (service, base, sous-domaine `formation.`, certificat), pour des exercices dans l'application elle-même.
- Lot 3 (chaîne de captures) : `scripts/formation-captures.cjs` régénère captures et zones depuis une copie de la démo. Vidéos montées (ffmpeg) : à brancher sur `/root/arrimo-video`.
- Lot 4 et lot 7 : 42 capsules prêtes sur 44 ; restent F1 (portail des proches, connexion à part) et SH1 (console SH).
- Lot 5 (attestation PDF, tableau du formateur, superutilisateurs, satisfaction) et lot 6 (« ? » de chaque écran, OG) : faits.
- Lot 8 : export SCORM 1.2 préparé (`scripts/formation-scorm.cjs`), non activé.
- Lot 9 : activation démo (préparer-demo.sh) et SH (migration 60) prêtes ; publication en cours.
