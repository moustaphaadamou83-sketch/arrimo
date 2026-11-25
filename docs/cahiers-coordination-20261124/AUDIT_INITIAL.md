# Audit initial — chantier coordination (cahiers du 24 nov. 2026)

**Date :** 25 nov. 2026 · **Branche :** `moteur-commun-20261119` · **Base du code audité :** `27b287d` (contient `4958e8c`, publiée en démo le 24 nov.)
**Méthode :** lecture du code (`src/`, `public/`, `db/`), recherche des concepts de chaque exigence, puis suite de tests complète sur une base créée exprès (résultats en fin de document).
Légende : ✅ existe et fonctionne · 🟡 partiel · ❌ manquant. Un ✅ ne vaut que pour ce que les tests couvrent ; le reste est marqué « à vérifier ».

## 1. Ce qui existe déjà (à réutiliser, pas à refaire)

| Moteur | Fichier | Ce qu'il fait déjà |
|---|---|---|
| Horloge | `src/horloge.js` | Heures immuables, source, auteur, corrections tracées (base de Chrono, Sillage, Transport) |
| Règles des lits | `src/regles.js` | Seul point qui change l'état d'un lit ou d'une civière ; verrou + version (anti double réservation) |
| Chrono | `src/chrono.js` | H11 à H15, cibles par établissement (profil de pays), niveaux vert / orange / rouge, 8 motifs de retard (liste fermée, journalisés), **une** alerte persistante par passage, rapport mensuel (moyenne, médiane, % hors cible, complétude, minutes d'immobilisation), CSV, contrôle des écarts |
| Vigilance | `src/vigilance.js` | 8 types d'alertes **lits et civières** (réservation prolongée, congé retardé, nettoyage, disponibilité périmée…), responsable par type, fait vs hypothèse, seuil, action proposée, fraîcheur |
| Prévisions | `src/previsions.js` | Lits et civières à **4, 12 et 24 h**, explicables, avec marge d'incertitude |
| Sillage | `src/sillage.js` | Chronologie transversale (préalerte → Chrono → transfert → transport → hébergement → mission CCS), `attention` (confirmations manquantes, étapes sautées) |
| OG | `src/og-flux.js`, `og-outils.js`, `og-modules.js`, `copilote.js` | Questions par module, explique un parcours, ne décide de rien |
| Secours / CCS | `src/prealertes.js`, `missions-ccs.js`, `vehicules.js` | Préalertes, missions, états de véhicule (dont `a_l_hopital`, `desinfection`), changement de destination, comparatif des urgences, capacités régionales, appels simulés (démo) |
| Transport | `src/transports.js` | Demande → acceptation → en route → prise en charge → arrivée, refus, annulation, brouillons, archivage |
| Bourse / hébergement | `src/bourse.js`, `nsa-places.js`, `nsa-chsld.js`, `chsld.js` | Places compatibles, classement, invitations, parcours NSA → CHSLD |
| Mode crise | `src/crise.js`, `continuite.js` | Évacuation d'un **CHSLD** : aperçu, déclenchement, lieu proposé par résident, réservation par les règles des lits, départ / arrivée / retour, familles avisées, levée journalisée, alertes Secours |
| Mes tâches | `src/taches.js` | Tâches par personne, attribution, paramètres de module, notification de retard unique |
| Famille / proches | `src/famille.js`, `proches-comptes.js`, `portail-proches.js` | Comptes de proches, révocation, notifications sans clinique |
| Données | `src/donnees.js` | Listes d'attente par orientation, délais (médiane), CSV |
| Connect | `src/connect.js`, `connecteurs.js` | Connect v1 signé HMAC, événements HL7 ADT traduits |

## 2. Matrice de couverture

### A. Détecter les blocages

| Exigence (cahier) | État | Ce qui manque / modification | Modules | Tests à ajouter |
|---|---|---|---|---|
| Immobilisation ambulancière mesurée H11→H15 (C1 §5, C3 §6.1) | ✅ | Ajouter « remise en disponibilité effective » (après H15 : désinfection → disponible, déjà dans `vehicules`) au calcul | Chrono, Secours | durée jusqu'à la disponibilité |
| Couleurs 0-14 / 15-29 / 30-44 / 45+ (C1 §4) | 🟡 | 3 niveaux aujourd'hui ; ajouter « critique » et un seuil d'escalade configurables (profil de pays + établissement) | Chrono, config_pays | passage vert→orange→rouge→critique |
| Causes d'immobilisation (C3 §6.2) | 🟡 | 8 motifs fixes ; ajouter « triage saturé », « contraintes cliniques », « cause inconnue » ; liste configurable par organisation ; jamais d'attribution automatique | Chrono | motif hors liste refusé |
| Vigilance transversale (C1 §12, C3 §11) | 🟡 | Vigilance ne voit que lits/civières ; Sillage `attention` voit les parcours. Réunir dans un flux unique : immobilisation prolongée, transport en retard, placement accepté non réalisé, réservation trop longue, transfert sans réponse, ambulances attendues > civières confirmées, données périmées, incohérence entre modules | Vigilance, Sillage, Chrono, Transport, Bourse | un test par type |
| Disponibilité réelle : confirmé / prévisionnel / réservé / inconnu (C1 §6, C3 §7) | 🟡 | États `libre/reserve/occupe/nettoyage/indispo` + `disponibilite_confirmee_le` existent ; manque l'affichage séparé « vides » / « opérationnels » / « non confirmés » partout (Capacités, Secours, Réseau, OG) | services, vehicules, national, accueil | 20 vides / 8 opérationnels |
| Prévisions 6, 12, 24, 48 h (C2 Singapour) | 🟡 | Horizons 4/12/24 ; ajouter 6 et 48 h, intégrer les ambulances annoncées (préalertes) | Prévisions | horizons + préalertes |
| Données obsolètes / panne de synchronisation (C3 scén. G) | 🟡 | Fraîcheur existe (Vigilance) ; à propager : « non confirmé » au lieu d'un chiffre quand la source est trop ancienne | Vigilance, services, Secours, OG | scénario G |
| Rupture de couverture (C3 §10) | ❌ | Rien. Avec seuils **de simulation** seulement : nombre d'unités disponibles par région vs immobilisées ; jamais de mesure réglementaire déclenchée | Secours, Vigilance | scénario E |

### B. Identifier les solutions

| Exigence | État | Ce qui manque / modification | Modules | Tests |
|---|---|---|---|---|
| OG : situation, données, contraintes, actions, acteurs, incertitudes, validations (C3 §13, C1 §13) | 🟡 | OG explique et répond par module ; manque une **fiche de recommandation** structurée en 7 points, commune, avec heure des données et incertitude ; « impossible faute de données fiables » | OG | structure présente, aucune donnée inventée |
| Comparer les destinations au CCS (C3 §4) | 🟡 | Comparatif des urgences existe (`urgencesClassees`) ; ajouter ambulances déjà attendues, délais observés (Chrono), restrictions, fraîcheur, quote-part si renseignée | Secours, Chrono | scénario A, B |
| Alternatives transfert / transport (C3 §9, scén. D) | 🟡 | `alternativesTransfert` existe pour les transferts ; rien pour un transport annulé/en retard | Transport | scénario D |
| Plan de coordination anticipé (C2 §4 « 16 h ») | ❌ | Assembler : sorties prévues, placements, transports non confirmés, nettoyages, préalertes → plan proposé, suivi des confirmations | OG, Prévisions, Vigilance | scénario du cahier 2 |

### C. Coordonner les responsables

| Exigence | État | Ce qui manque / modification | Modules | Tests |
|---|---|---|---|---|
| Cycle d'une alerte : responsable + remplaçant, échéance, accusé, action engagée, escalade, résolution confirmée (C1 §4, §15) | ❌ | Aujourd'hui : responsable affiché en texte, une seule notification Chrono, acquittement seulement sur certains objets (transport, flux). Ajouter **un cycle commun** (table additive) relié aux objets de l'Horloge ; l'action passe par Mes tâches | Vigilance, Mes tâches, Chrono | accusé ≠ résolu ; responsable absent → escalade ; déduplication |
| Matrice responsabilités / escalades configurable (C2 §5) | ❌ | Rôle destinataire par type de blocage et par niveau, par établissement (valeurs par défaut du cahier 2, modifiables) | Paramètres de module | configuration et refus de rôle |
| Mes tâches : bloquantes, dépendances, relève de quart, remplaçant (C4 §6) | 🟡 | Attribution et retards existent ; pas de dépendance, pas de relève, pas de remplaçant | Mes tâches | relève jour→soir |
| Obstacles de sortie autorisée mais retardée (C3 §8, C2 Suède) | 🟡 | Parcours NSA → CHSLD suivi ; manque la liste fermée d'obstacles (place, réponse, transport, chambre, documents, famille) et la distinction sortie prévue / autorisée / NSA officiel | Liaison CHSLD, NSA | scénario C |
| Confirmation réception ≠ prise en charge (C2 Norvège, Danemark) | 🟡 | Étapes distinctes dans Transport et Transferts ; à vérifier dans Liaison CHSLD | Liaison CHSLD | à vérifier |

### D. Mesurer les résultats

| Exigence | État | Ce qui manque / modification | Modules | Tests |
|---|---|---|---|---|
| Moyenne, médiane, **P90**, dépassements, **heures cumulées**, **simultanées**, causes (C3 §6.3) | 🟡 | Moyenne, médiane, % hors cible, minutes cumulées, causes : ✅. Manquent P90, maximum simultané, filtres région/période au-delà du mois | Chrono | calculs sur jeu connu |
| Observé vs potentiellement évitable (C3 §6.3) | ❌ | Évitable = au-delà de la cible configurée, marqué « indicatif » | Chrono | — |
| Délais sortie autorisée → départ, placement, transport, réponse (C3 §17) | 🟡 | Données (Horloge) présentes ; indicateurs non assemblés | Données, Sillage | — |
| Temps de résolution des alertes, alertes résolues (C2 §6) | ❌ | Dépend du cycle d'alerte (C) | Vigilance | — |
| Avant / après pilote (C1 §20) | ❌ | Comparaison de deux périodes choisies, sans attribuer le gain à Arrimo | Données | — |

### E. Quotes-parts (cahier 3, §3)

| Exigence | État | Proposition |
|---|---|---|
| Quote-part, autorité, période, actualisation, reçues / attendues / en route, exceptions, historique, source | ❌ | Table additive renseignée **à la main** par un rôle autorisé (CCS ou coordination réseau), historique immuable ; reçues / attendues / en route **calculées** depuis Préalertes et Chrono ; **aucune formule de marge** (« Non renseigné ») ; jamais d'influence sur un classement sans règle validée ; affichage CCS + Secours + OG ; scénario B (contradiction quote-part / civières) |

### F. Cahier nº 3 (résilience) — hors des quatre capacités prioritaires

| Domaine | État | Écart principal |
|---|---|---|
| Mode crise | 🟡 | Évacuation **CHSLD seulement** ; pas de rapport post-incident, pas de mode hors connexion ; scénario 49 résidents à tester |
| Visites | 🟡 | Aucune suspension ni restriction liée à une crise ou à un transfert |
| Famille | 🟡 | Révocation existe ; pas de suivi des étapes d'un transfert côté proche |
| Admissions | 🟡 | Préalertes reçues ; pas de liste de préparation configurable |
| Urgences proches | 🟡 | Lien 811 présent (migration) ; reste démo seulement (avis juridique) |
| Formation | 🟡 | Parcours et capsules ; pas d'exercice isolé avec injection d'événements |
| Données (qualité) | ❌ | Ni score de qualité ni détection d'incohérences |
| Connect (résilience) | ❌ | Ni tableau de santé, ni file de reprise, ni suspension d'un connecteur |
| Coopération entre territoires | ❌ | — |

## 3. Plan proposé (dans l'ordre de tes quatre capacités)

Chaque lot : migrations **additives** uniquement (garde d'intégrité), FR + EN, tests, commit + push. Pas de modification de SH. Pas de publication avant la fin.

1. **Lot 1 — Détecter** : Vigilance transversale (flux unique alimenté par Chrono, Transport, Bourse, Liaison CHSLD, Sillage), niveau critique Chrono, causes enrichies et configurables, disponibilité confirmée / prévisionnelle / réservée / inconnue, données obsolètes (scénario G).
2. **Lot 2 — Coordonner** : cycle d'alerte commun (responsable, remplaçant, échéance, accusé, action, escalade, résolution) + matrice d'escalade configurable + lien Mes tâches ; obstacles de sortie.
3. **Lot 3 — Solutions** : fiche de recommandation OG en 7 points ; comparatif CCS enrichi ; alternatives de transport ; plan anticipé « 16 h ».
4. **Lot 4 — Mesurer** : P90, simultanéité, évitable indicatif, délais de sortie, temps de résolution des alertes, comparaison de périodes.
5. **Lot 5 — Quotes-parts** : préparation configurable, rien d'activé hors démo.
6. **Lot 6 — Scénarios** A à G du cahier 3 et scénario du cahier 2, en tests automatisés sur base fictive.
7. **Ensuite** (cahier nº 3, P0 puis P1) : traçabilité Mode crise + scénario 49 résidents, permissions Famille, isolation des simulations, santé des connecteurs.
8. **Fin** : recette complète, version candidate, **une publication complète** après ton accord.

## 4. Résultats des tests (état de départ)

*(complété à la fin de la suite en cours)*
