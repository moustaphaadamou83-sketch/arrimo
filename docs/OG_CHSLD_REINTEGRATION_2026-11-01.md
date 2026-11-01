# OG copilote CHSLD, conservation de chambre et réintégration (1er novembre 2026)

Sources : cahiers « OG CHSLD et retour d'hospitalisation », « OG copilote intelligent universel », « Conservation de chambre et réintégration automatique », « Nettoyage des chambres conservées ». Branche `chsld-20261031`.

## 1. Défaut ERA117A : reproduit, puis corrigé
- **Reproduit** (test « réintégration : défaut ERA117A ») : OG ne reconnaissait que les références `R-00000`. `ERA117A` (le lit ERA-117A, chambre 117, CHSLD des Érables) tombait sur la liste générique des fonctions.
- **Corrigé** : toute référence saisie seule déclenche une recherche dans l'établissement. Casse, espaces et tirets sont normalisés, avec des index dédiés en base.
  - Types reconnus : résident (`R-00001`, `r00001`, `R 1`, `RES-0001`), lit (`ERA-117A`, `era117a`, `Era 117A`), coordination (`CO-…`), demande d'hébergement (`DH-…`).
  - Une référence inconnue ou appartenant à un autre établissement donne « Aucun résultat autorisé ». OG n'invente jamais un type ni un résultat.
  - Les noms composés (`Bouchard-Era12`) ne sont pas pris pour des références.

## 2. Conservation de la place et réintégration
- **Pendant l'hospitalisation** : le dossier, l'identifiant, la chambre et le lit sont conservés. L'occupation affichée est « Place conservée — hospitalisation ». Une place conservée n'est jamais comptée comme disponible ni proposée à une admission. Le départ n'est confirmé qu'après confirmation humaine.
- **Entretien indépendant de l'occupation** (`lits.entretien_statut`) : à nettoyer, nettoyage en cours, propre. Il suit les tâches d'entretien et de préparation, et l'auteur et l'heure du nettoyage sont enregistrés.
  - Changer l'état d'entretien ne modifie jamais l'attribution. Une place conservée et propre reste conservée.
- **Retour** : l'hôpital prépare le retour, et le contrôle de réintégration retrouve la place habituelle. Il vérifie que la place est toujours attribuée, qu'elle n'est ni bloquée, ni hors service, ni attribuée à un autre résident, et que la préparation est terminée.
  - Si tout est bon, la fiche et la carte affichent « Retour prêt à confirmer : chambre prête ».
- **Confirmation de la réception physique** (personnel habilité) : réintégration dans le même lit, en une seule transaction. Le résident passe à « Présent » et le mouvement est journalisé avec son auteur et l'heure.
  - **Idempotente** : deux confirmations simultanées ne produisent qu'une réintégration ; la seconde ne change rien.
- **Cas exceptionnels** :
  - Place bloquée ou réattribuée : la réintégration est refusée (`reintegration_bloquee`, avec le motif). Un responsable choisit explicitement une autre place (action « Résoudre »). **Jamais d'attribution silencieuse.**
  - Retour annulé par l'hôpital : le résident reste hospitalisé et sa place reste conservée.
  - Hospitalisation prolongée : un responsable peut libérer volontairement la place conservée, avec un motif obligatoire et une trace au journal.

## 3. OG : copilote connecté aux données
- **Résolveur** de références et de noms :
  - fautes de frappe d'une lettre tolérées, y compris l'inversion de deux lettres ;
  - prénom seul pris pour le résident déjà en conversation ;
  - homonymes : OG demande de choisir, sans jamais fusionner deux identités.
- **Contexte de conversation** (30 min, par utilisateur et par établissement) : par exemple « ERA117A » → « Il est où ? » → « Il revient quand ? » → « Sa chambre est toujours disponible ? ».
- **Outils métier ciblés** : seules les lectures nécessaires sont faites, jamais la base entière.
  - Résident : localisation confirmée, chambre habituelle, place conservée, retour, préparation, motifs de blocage, dernier mouvement, départ, auteur de la réception.
  - Établissement : places libres, bloquées, conservées, en nettoyage ; occupation ; retours ; hospitalisés ; demandes ; accueils ; tâches ; messages ; notifications ; modules actifs.
  - Hôpital (Liaison CHSLD) : numéros `CO-…`, demandes en attente de réponse, origine d'un transfert.
- **Statuts distingués** : situation confirmée, demande en attente et donnée absente sont toujours séparées, avec la date du dernier statut confirmé.
- **Actions préparées, toujours à confirmer** : tâche de nettoyage, demande de rappel à un proche autorisé, acceptation d'un retour. OG ne confirme jamais une arrivée physique et refuse les décisions cliniques, d'admissibilité, de médication et d'attribution définitive.
- **Liste des fonctions** : elle n'apparaît plus que sur « Que peux-tu faire ? ». Une question incomprise reçoit une réponse précise et une démarche.

## 4. Résultats des 600 cas (`tests/og-cas-chsld.cjs`)
Cas construits à partir des données fictives réelles de l'environnement de test : questions en français et en anglais, fautes de frappe, dictée transcrite, références seules, conversations à plusieurs étapes, cinq rôles et quatre établissements. Chaque cas vérifie le **contenu** de la réponse, pas seulement le code HTTP 200. Rapport détaillé : `.local/og-600-rapport-20261101.json`.

| Domaine | Minimum demandé | Cas | Réussis |
|---|---:|---:|---:|
| Recherche par référence et identité | 100 | 100 | 100 |
| Chambres, lits et capacités | 70 | 70 | 70 |
| Admissions et mouvements CHSLD | 60 | 60 | 60 |
| Hospitalisations et départs | 80 | 80 | 80 |
| Retours et réinstallations | 80 | 80 | 80 |
| Liaison CHSLD–Hôpital | 80 | 80 | 80 |
| Proches et communication | 40 | 40 | 40 |
| Personnel, entretien et tâches | 40 | 40 | 40 |
| Permissions, ambiguïtés et sécurité | 50 | 50 | 50 |
| **Total** | **600** | **600** | **600** |

**Premier passage : 561 sur 600.** Les 39 échecs ont révélé de vrais défauts, corrigés dans le code et non dans les attentes :
- noms composés pris pour des références ;
- inversion de lettres mal comptée ;
- « taux » détecté dans « hôpitaux » ;
- pronoms détectés à l'intérieur des mots côté hôpital (« the » → « he ») ;
- « CHSLDs » au pluriel non reconnu ;
- refus de confirmation absent en anglais ;
- contexte implicite manquant pour les proches ;
- détection de l'anglais incomplète.

**Rôle entretien** : OG n'est pas ouvert à ce rôle (règle existante, écran Nettoyage seulement). Les cas correspondants vérifient le refus du serveur et l'absence de donnée exposée.

## 5. Scénarios de bout en bout (suite « chsld », 20 tests sur 20)
- **Jean Dupont, CHSLD des Érables → Hôpital B → Érables** : départ ; réception dans la Liaison CHSLD ; arrivée ; admission ; place conservée et jamais disponible ; nettoyage pendant l'absence (à nettoyer, en cours, propre, auteur) ; retour préparé ; chambre prête ; acceptation (OG propose seulement) ; préparation ; deux confirmations simultanées ; réintégration dans le **même lit** ; dossier et historique identiques ; OG à chaque étape.
- La chambre 204 existe (lit unique `ERA-204`, sans lit A) ; le scénario utilise la chambre réelle de Jean Dupont.
- **Variantes** : place bloquée (refus, résolution validée), place libérée puis réattribuée à un autre résident (refus, place choisie explicitement), retour annulé par l'hôpital (place conservée, notification), aucune double attribution.

## 6. Limites et vérifications manuelles
- OG reste un moteur local de compréhension (intentions, lexique tolérant, contexte). Il ne s'appuie pas sur un modèle de langue : une formulation très éloignée peut ne pas être comprise. OG le dit alors clairement.
- **Console SH dans OG** : non connectée. Les paramètres SH restent accessibles par la console, réservée aux rôles d'administration. Dans Arrimo, OG indique seulement les modules actifs de l'établissement.
- **Vérifications manuelles** :
  - essai vocal réel (dictée) ;
  - ergonomie des messages de blocage avec une équipe de CHSLD ;
  - choix de la place lors d'une résolution, sur tablette.

## 7. Publication faite (1er novembre 2026, 22 h 59 UTC)
- Release `reintegration-20261101t2259` sur la démo et SH. Rapport : `.local/reintegration-release-20261101t2259/rapport.json`.
- Recette sur l'empreinte `1d6277f2…`, toute verte :
  - SH 10 suites (`20261101223039_09134f`) ;
  - chsld 20/20, dont les 600 cas d'OG ;
  - interface hospitalière 16/16 ;
  - OG suivi 21/21 ;
  - scénarios ABC 8/8 et OG de base ;
  - api 71/71.
- **Vérifié en ligne** : santé `ok`, colonnes d'entretien présentes, lit ERA-117A retrouvé par la référence normalisée. Comptes, scénario ABC et données préservés ; aucune remise à zéro.
