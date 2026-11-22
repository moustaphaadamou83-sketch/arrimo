# Arrimo — Restructuration globale (cahiers du 21 au 23 nov. 2026)

Livrables demandés par le Cahier directeur ultime (section 27) et le cahier Personnel & Tâches + Nettoyage (section 25).
Données fictives seulement ; aucune donnée clinique dans les vues réseau, les notifications ni le journal.

## 1. Inventaire du code existant (réutilisé, non dupliqué)

| Domaine | Fichiers | Rôle |
|---|---|---|
| État des lits et civières | `src/regles.js` | Seul endroit qui change l'état d'un lit (verrou, version, journal immuable) |
| Tâches | `taches_etab`, `src/chsld.js` (`tache`, `statutTache`), `src/nettoyage-securise.js` | Moteur unique ; chambre propre confirmée par l'entretien |
| Mouvements | `src/arrimo-flux.js` | Lit transports, transferts, hébergement et préalertes : aucune seconde base |
| Chrono | `src/chrono.js` | Seul moteur de délais ambulance (H11 → H14) |
| Niveau opérationnel | `src/terrain.js` (`niveauAlerte`) | Pression des lits, attentes, urgence |
| OG | `src/og-flux.js`, `src/copilote.js` | Interroge les services ci-dessus, avec les droits de la personne |
| Messagerie | `src/connect-interne.js`, `public/messagerie.js` | Arrimo Connect interne |

## 2. Cartographie avant / après

| Avant (≈ 20 onglets à plat) | Après (espace → modules) |
|---|---|
| Accueil, Flux | **Accueil** : Accueil (le Flux est dans Transferts) |
| Patients, DSN, Admissions, Résidents, NSA | **Patients & DSN** |
| Flux, Transferts, Liaison CHSLD, Demandes, Mouvements, Transports | **Transferts** (Flux = vue d'ensemble par statut + historique) |
| Lits, Chambres, Bourse, Urgences CHSLD | **Capacités** (+ historique des disponibilités) |
| Urgence, Liaison Secours (préalertes), Chrono, Avant l'appel, Crise | **Urgences** |
| Nettoyage, Tâches, Visites | **Opérations** (+ **Mes tâches**) |
| Continuité (Sillage), Vigilance, Indicateurs, Données | **Pilotage** |
| Réseau, National, Paramètres, Administration, Journal, Support | **Administration** (gouvernance) |

Les anciens boutons gardent leurs identifiants (`data-v`), leurs routes et leurs favoris : aucune route supprimée.

## 3. Arborescence de navigation

Première ligne : les espaces visibles pour ce rôle et cet établissement (un espace sans module autorisé n'apparaît pas).
Deuxième ligne : les modules de l'espace ouvert, et « ⚙ Paramètres du module » pour les responsables.
L'agent d'entretien ne voit que l'espace Opérations (Nettoyage, Mes tâches).

## 4. Composants réutilisés

`ArrimoFluxVue.panneau` (Accueil et Flux), `ArrimoAccueil.construire` (Accueil hôpital, CHSLD, RPA, ressources), cartes `acc-kpi`,
badges `badge-flux`, sous-onglets communs, centre de paramètres, panneau Arrimo Connect.

## 5. Services modifiés ou ajoutés

- `public/accueil.js` : Accueil universel (niveau compact cliquable, 6 indicateurs, Flux | Bourse, Chrono, préalertes et priorités, Mes tâches, prévisions, analyse OG repliée, mode supervision).
- `public/espaces.js` : navigation par espaces.
- `src/taches.js` + `public/mes-taches.js` : Mes tâches, attribution, paramètres de module, notifications de retard.
- `src/arrimo-flux.js` : historique des transferts, historique des disponibilités, préparation en retard.
- `src/connect-interne.js` : conversations de groupe.
- `src/og-flux.js` : niveau, Chrono, mes tâches, tâches en retard, lits libérés, chambres à nettoyer, parcours patient.
- Migration additive `db/migrations/20261123-flux.sql` : `taches_etab.assigne_a`, `taches_etab.retard_notifie_le`, tables `parametres_modules`, `connect_participants`.

## 6. Connexions entre modules

Départ confirmé → `regles.js` met le lit en nettoyage → la tâche apparaît dans Mes tâches et Nettoyage → l'entretien confirme →
le lit redevient libre → la Bourse et le Flux le reflètent → OG le lit dans le journal.
Transfert accepté → préparation de chambre (tâche) → état « à préparer / en cours / prête / en retard » dans Flux → arrivée confirmée.
Préalerte → Flux, Accueil, Chrono, notifications → accusé de réception.

## 7. Règles d'affichage par rôle

- Coordination, administration et gestion : tous les espaces activés ; attribution et paramètres de module.
- Équipe de soins : modules cliniques et opérationnels autorisés ; pas de paramètres de module.
- Entretien : Nettoyage et Mes tâches seulement ; titres de tâches sans référence patient.
- Ambulance et CCS : écrans Secours (missions, préalertes, étapes) ; inchangés.
- Modules non activés : bouton masqué ; refus côté serveur.

## 8. Paramètres de chaque module

| Module | Où | Réglages |
|---|---|---|
| Personnel & Tâches | Mes tâches → Paramètres du module | Échéance par défaut, seuil de priorité, notification d'attribution, attribution automatique (aucune / seule personne active du rôle) |
| Nettoyage | Mes tâches → Paramètres du module | Délai cible, types d'intervention |
| Transferts, Capacités, Urgences, Patients, Pilotage | ⚙ Paramètres du module → section Établissement existante | Seuils, structure, cycle des lits, poids NSA, protocoles |

Modification : administration et coordination de l'établissement ; journalisée ; propre à chaque établissement.

## 9. Modifications d'OG

Nouvelles réponses fondées sur les services réels : « Pourquoi sommes-nous en niveau … ? », dépassements et tendance Chrono,
« Quelles sont mes tâches ? », « Quelles tâches sont en retard ? », « Quels lits viennent de se libérer ? »,
« Quelles chambres attendent un nettoyage ? » (tâches + lits en nettoyage), parcours d'un patient (P-xxxxx).
Questions sans référence : OG demande de préciser au lieu d'inventer.

## 10. Tests exécutés

- `npm test` (≈ 350 tests serveur) et `tests/cahier-ultime.test.cjs` (11 tests : OG, attribution, paramètres, historique, groupes Connect, attribution automatique).
- Interface (`npm run test:interface`) : clair, sombre, anglais, 3 largeurs, guide de démonstration.
- Formation : capsules X7 (Accueil et espaces) et X8 (Mes tâches), X6 mise à jour ; captures FR et EN.

## 11. Résultats

Voir le rapport de publication du 23 nov. 2026.

## 12. Anomalies restantes

- `tests/chsld.test.cjs` : 2 tests de tête échouaient déjà sur la version publiée (43a1838) : liste des types SH et provisionnement contraire à la règle « chambre propre confirmée par l'entretien » ; les tests suivants en dépendent.
- Pas de notion d'« équipe » distincte du rôle : la file du rôle tient lieu d'équipe.

## 13. Risques techniques

- Habitude des utilisateurs : les modules sont regroupés ; les favoris et routes restent valides.
- Attribution automatique : volontairement prudente (désactivée par défaut).

## 14. Recommandations avant pilote

Valider les espaces avec les utilisateurs, ajouter la notion d'équipe et de disponibilité déclarée, faire relire les paramètres
métier par chaque établissement, et remettre à jour `tests/chsld.test.cjs` sur les règles du 17 nov.
