# Rapport final — chantier « coordination opérationnelle » (cahiers du 24 nov. 2026)

**Réalisé le 25-26 nov. 2026** · branche `moteur-commun-20261119` (poussée sur GitHub) · commits `d259e82` à `1dc2b81` · **rien n'est publié**.
Audit et matrice de départ : `AUDIT_INITIAL.md`. Les quatre cahiers sont dans ce dossier.

## 1. Ce qui a été fait, par capacité

Les quatre cahiers se recoupent (Chrono, Vigilance, OG apparaissent dans plusieurs) : chaque sujet a été traité **une seule fois**, dans le moteur existant.
Aucun nouveau module, aucun nouveau type d'établissement, SH non modifié.

| Capacité | Réalisation | Où |
|---|---|---|
| **Détecter** | Vigilance transversale : ambulance immobilisée (paliers vigilance / escalade / critique), ambulances annoncées > civières libres, transport en retard ou non accepté, placement accepté non réalisé, transfert sans réponse, connecteur silencieux ou suspendu, contradiction quote-part / civières, incohérences entre modules | `src/vigilance.js` |
| | Capacité réelle : vides, opérationnels (confirmés récemment), non confirmés, réservés, sorties prévues 24 h, nettoyage, civières, ambulances annoncées — comptés à part | `src/vigilance.js`, écran Vigilance |
| | Chrono : palier « critique » (cible totale), motifs « triage saturé », « contraintes cliniques », « cause inconnue » ; jamais de cause inventée | `src/chrono.js`, `public/chrono-retards.js` |
| | Rupture de couverture d'une région (seuil de **simulation** seulement), registre début / fin / durée / cause / mesure / responsable | `src/couverture.js`, tableau CCS |
| **Coordonner** | Suivi de chaque alerte : responsable + remplaçant (grille configurable, défaut cahier nº 2 §5), échéance, accusé (≠ résolution), action (liste fermée), escalade sans réponse, responsable absent tracé, « levée » ≠ « résolue », résolution confirmée par une personne, journal immuable | `src/suivi-alertes.js`, `/coordination/alertes`, `/coordination/escalades` |
| | Relève entre équipes (jour / soir / nuit), accusée par l'équipe entrante | `src/taches.js`, écran Mes tâches |
| **Solutions** | Plan de coordination d'OG : une fiche en 7 points par groupe de blocages (situation, données et heure, contraintes, actions, acteurs, incertitudes, validations) ; synthèse confirmé / prévisionnel / inconnu ; « recommandation limitée » si données insuffisantes ; OG répond à « que faire ? » | `src/og-plan.js`, `/coordination/plan`, `src/og-flux.js` |
| | Rechanges de transport : transporteurs autorisés de la région avec unités déclarées disponibles | `src/og-plan.js` |
| | Comparatif des destinations du CCS : ambulances annoncées, à la porte, médiane porte 24 h (mesurée) | `src/vehicules.js`, `public/secours.js` |
| **Mesurer** | Chrono : P90, max d'ambulances simultanées à la porte, heures cumulées, minutes au-delà de la cible (indicatif) | `src/chrono.js` |
| | Indicateurs de coordination sur deux périodes de même durée (transferts, transports, placements, suivis d'alertes) ; écarts observés, jamais attribués à Arrimo ; rien d'estimé | `src/coordination-indicateurs.js` |
| **Quotes-parts** | Saisie par le CCS de la région ou la gestion réseau, historique immuable, période configurable, source et fiabilité ; reçues / attendues / en route calculées ; **marge non calculée** ; « non renseignée » jamais 0 ; démo et recette seulement | `src/quotes-parts.js`, formulaire CCS |
| **Résilience (cahier nº 3)** | Mode crise : changement de destination (sans doublon), transport annulé, rapport post-incident ; évacuation de 49 résidents testée | `src/crise.js`, `public/crise.js` |
| | Connecteurs : état de santé, suspension réversible (503 au partenaire, Arrimo continue), reprise | `src/admin.js`, `src/connecteurs.js` |
| | Visites des intervenants suspendues pendant une évacuation réelle | `src/visites.js` |

## 2. Migrations (additives, ordre de publication)

`20261126-coordination-detection.sql` · `-coordination-suivi.sql` · `-quotes-parts.sql` · `-couverture.sql` · `-crise-suivi.sql` · `-connecteurs-suspension.sql` · `-releves.sql`
— ajoutées à `MIGRATIONS_APPLICATION` du script de publication. **Essai sur une copie de la recette réelle** : les 15 migrations de la liste passent, se rejouent sans erreur, données des lits identiques avant / après.

## 3. Tests

Nouveaux fichiers (tous dans `npm test`) : `coordination-detection`, `coordination-suivi`, `coordination-solutions`, `coordination-mesure`, `quotes-parts`,
`coordination-scenarios` (E, F), `crise-49-residents`, `resilience-donnees`, `releve-visites`. Scénarios A à G du cahier 3 et scénario « 16 h » du cahier 2 couverts.
Résultat de la suite complète : voir § 7.

## 4. Règles métier à valider sur le terrain (rien n'est activé comme règle officielle)

- Paliers Chrono 15 / 20 / 45 min (profil de pays) : indicatifs, non cliniques.
- Grille d'escalade par défaut (cahier nº 2 §5) et délais de réponse.
- Seuils de Vigilance : `transport_retard_marge_min` 30, `transfert_reponse_max_min` 60, `placement_accepte_max_h` 24, `connecteur_silence_max_min` 60.
- Quotes-parts : formule de marge, période, autorité, exceptions — à confirmer auprès des autorités ; module refusé en pilote et production.
- Seuil de rupture de couverture : simulation seulement.

## 5. Limites restantes et dépendances externes

- Mode crise : pas de fonctionnement hors connexion ni de réconciliation après coupure (cahier nº 3 §3.5) ; évacuation d'un CHSLD seulement.
- Formation : pas encore d'exercice isolé avec injection d'événements (cahier nº 3 §9).
- Famille, Admissions (liste de préparation), Urgences proches, coopération entre territoires : non approfondis.
- Prévisions à 6 et 48 h : non ajoutées (4 / 12 / 24 h existent).
- Connexions réelles (DSN, répartition ambulancière, transporteurs) : aucune présentée comme opérationnelle sans validation du partenaire.
- Références internationales des cahiers : à vérifier avant toute présentation commerciale.

## 6. Publication et retour arrière

Publication complète unique, **après accord de Moustafa** : `scripts/publication-arrimo.py` (sauvegarde restaurable, migrations sur copie, garde d'intégrité,
bascule, contrôle de santé, retour automatique en cas d'échec). Ordre : recette → démo → principale → SH (SH : aucune modification de code dans ce chantier).
Point ouvert du lanceur : la base recette a 20 tables au propriétaire `arrimo_recette` (le lanceur exige `postgres`) — à adapter avant la publication de la recette.

## 7. Résultat de la suite complète

Suite complète (`npm test`, 26 nov. 2026, avec `--test-force-exit`) : **417 tests, 414 réussis au premier passage, 3 corrigés ensuite** :
- « dossier d'entiercement » : variable `SUIVI_ALERTES_MINUTES` non documentée → documentée (`dd85939`) ;
- deux tests de la console SH : forme de l'adresse de test (`postgres://root@/base?host=…` n'est pas lisible par `new URL`) ; avec `postgres://root@localhost/base?host=/var/run/postgresql`, les deux passent. Aucun code modifié.
- `npm test` sans `--test-force-exit` peut rester bloqué à la fin d'`api.test.js` quand un test SH échoue (connexions restées ouvertes) : utiliser l'option ou le runner de recette.
