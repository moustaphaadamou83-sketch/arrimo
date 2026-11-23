# Arrimo — Professionnalisation ERP (23 nov. 2026)

Livrables des cahiers « Professionnalisation ERP », « Suppression des emojis » et « Accueil comme centre de décision ». Données fictives seulement.

## 1. Audit de l’interface (avant)

- ≈ 240 emojis utilisés comme icônes dans Arrimo et SH (menus, titres, météo, formation, cartes de modules, statuts).
- Nom personnalisé d’OG « YZY » sur l’Hôpital A de la démo.
- KPI de l’Accueil sans définition consultable (formule, source, période).
- Grandes listes sans recherche, tri ni pagination.
- Cartes de l’Accueil étirées (espaces vides) ; priorités sans action directe.
- Aucun son pour les messages, alertes et préalertes (sauf un bip optionnel en Liaison Secours).

## 2. Composants communs

| Composant | Fichier | Rôle |
|---|---|---|
| Jeu d’icônes unique (Lucide, ISC) | public/icones.svg, public-sh/icones.svg | 86 icônes SVG, même trait (2 px) et même grille 24 px |
| Correspondance des données historiques | public/icone-emoji.js | Codes du catalogue de formation → icône |
| Accueil universel | public/accueil.js | Comprendre (KPI + niveau), décider (priorités justifiées), agir (boutons) |
| Catalogue des KPI | src/kpi-catalogue.js, GET /api/kpi/catalogue | Fiche de chaque indicateur, bouton « i » sur chaque carte, OG |
| Tableaux ERP | public/tableaux.js (Arrimo et SH) | Recherche, tri au clic et au clavier (aria-sort), pagination 50 |
| Mes tâches | public/mes-taches.js | Composant commun à tous les rôles |
| Son de notification | public/son-notif.js | Messages, notifications, alertes, préalertes, tâches ; bouton de l’en-tête |

## 3. Catalogue des KPI

| Code | Nom | Formule | Source | Période | Actualisation | Données manquantes |
|---|---|---|---|---|---|---|
| k_lits | Lits libres | Nombre de lits actifs de l’établissement dont l’état est « libre » (un lit en nettoyage, réservé ou bloqué n’est pas compté). | Lits (src/regles.js, seul service qui change l’état d’un lit) | Instantané | À chaque ouverture et toutes les 15 s | Aucun lit déclaré : « — » |
| k_urgence | Urgence (civières occupées) | Civières occupées ÷ civières fonctionnelles × 100 (civières de débordement exclues du dénominateur). | Civières (src/civieres.js, statsUrgence) | Instantané | À chaque ouverture et toutes les 15 s | Pas d’urgence : indicateur masqué |
| k_arrivees | Arrivées prévues | Mouvements d’Arrimo Flux dont la destination est l’établissement, d’hier à aujourd’hui, hors annulés. | Arrimo Flux (src/arrimo-flux.js, lit les transports, transferts, hébergement et préalertes) | Aujourd’hui (et la veille non close) | En direct | 0 si aucun mouvement |
| k_prealertes | Préalertes actives | Mouvements avec préalerte, non arrivés, non terminés, non annulés. | Arrimo Flux et Liaison Secours (src/prealertes.js, src/transports.js) | En cours | En direct | 0 |
| k_porte | Ambulances à la porte | Passages Chrono avec H11 enregistrée et sans H14 ; en rouge si l’attente dépasse le seuil configuré. | Chrono (src/chrono.js, seul moteur de délais) | En cours | En direct | Chrono non activé : indicateur masqué |
| k_transferts | Transferts actifs | Transferts entrants + sortants au statut demandé, validé, transport ou en route. | Transferts (src/services.js) | En cours | À chaque ouverture et toutes les 15 s | 0 |
| k_places | Places libres | Places de l’établissement à l’état « libre », sans résident rattaché. | Chambres et places (src/chsld.js) | Instantané | À chaque ouverture et en direct | 0 |
| k_departs | Départs prévus | Mouvements d’Arrimo Flux dont l’origine est l’établissement, hors annulés. | Arrimo Flux (src/arrimo-flux.js) | Aujourd’hui | En direct | 0 |
| k_preparer | Chambres à préparer | Arrivées d’Arrimo Flux dont la préparation est « à faire » ou « en cours » ; à défaut, places à nettoyer. | Arrimo Flux et Personnel & Tâches (taches_etab) | Aujourd’hui | En direct | 0 |
| k_taches | Tâches prioritaires | Tâches à faire ou en cours avec une échéance antérieure à maintenant. | Personnel & Tâches (taches_etab, moteur unique) | En cours | À chaque ouverture | Sans échéance : jamais en retard |

Aucune valeur n’est calculée par le catalogue : chaque carte lit le service métier cité. Une donnée absente affiche « — » ou masque l’indicateur, jamais une valeur fictive présentée comme réelle.

## 4. Corrections UI/UX

- Tous les emojis d’interface remplacés par des icônes SVG ; textes simples (OG, notifications) sans pictogramme. Contrôle automatique dans tests/cahier-ultime.test.cjs.
- « YZY » remplacé par « OG » dans les données de démonstration (journalisé) ; la personnalisation reste possible.
- Cartes de l’Accueil à la hauteur de leur contenu (aucun étirement).
- Priorités : justification d’OG et bouton « Ouvrir et agir » vers l’écran concerné.
- Son distinct pour chaque type d’événement, activé par défaut, coupé ou réactivé depuis l’en-tête.

## 5. Sources de données vérifiées

Voir la colonne « Source » du catalogue : lits (src/regles.js), civières (src/civieres.js), Arrimo Flux (src/arrimo-flux.js), Chrono (src/chrono.js), transferts (src/services.js), places (src/chsld.js), tâches (taches_etab).

## 6. Tests

npm test (serveur), tests d’interface (clair, sombre, anglais, 3 largeurs), temps réel, suite CHSLD, catalogue des KPI, absence d’emoji.

## 7. Problèmes restants

- Notion d’équipe et de disponibilité déclarée du personnel à ajouter.
- Les capsules de formation gardent un code emoji dans leurs données (affiché en icône).
