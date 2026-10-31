# Produit CHSLD — reprise (31 oct. 2026, soir)

Branche `chsld-20261031` (partie de `correction-navigation-langue-og-20261031`). Rien n'est publié.

## Fait
- Audit : aucune notion de type d'établissement ; modules limités à urgence, NSA, nettoyage, national.
- Choix de conception :
  - les CHSLD ont **leur propre configuration** (unités d'hébergement, références `R-00000`). Les vues de capacité hospitalières filtrent par configuration : aucun mélange avec les lits d'hôpital ;
  - les places réutilisent lits, chambres et unités, et `regles.changerEtat` (verrou, version, journal), sans nouvel état de lit ;
  - pendant une hospitalisation, la place reste « occupée » (conservée) et le résident passe « hospitalisé » ;
  - le nettoyage réutilise le module existant.
- `db/schema.sql` (vérifié : s'applique et se rejoue sans erreur) :
  - `etablissements.type_etablissement` (hôpital par défaut) et `conservation_place_jours` ;
  - rôle `equipe_soins` ;
  - tables `residents`, `resident_contacts` (rôles distincts : urgence, proche aidant, représentant légal vérifié, autorisations par catégorie), `resident_mouvements`, `demandes_hebergement` et leurs étapes, `coordinations` et leurs étapes (hospitalisation, retour, transfert inter-CHSLD ; les autres établissements ne voient que la référence), `taches_etab`, `communications_proches`.

## Reste (phase 1)
1. `src/chsld.js` : API (accueil, résidents et contacts, réservation, arrivée, changement de chambre, absence, sortie, demandes d'hébergement, hospitalisation et retour, transfert inter-CHSLD, tâches, communications avec contrôle des autorisations, indicateurs).
   - Identités : `exigerFictifs` (démo et recette seulement). Rôle entretien : ajouter les routes des tâches.
2. Côté hôpital : section « Résidents de CHSLD » dans Transferts (confirmer la réception, préparer le retour, incidents).
3. Interface `public/chsld.js` : navigation selon le type d'établissement, onze écrans, FR/EN.
4. OG : `src/og-chsld.js` (questions CHSLD, contexte du résident, propositions confirmées, refus des décisions cliniques).
5. SH : type d'établissement et catalogue de modules (communs, hôpital, CHSLD ; les autres types marqués « à venir »), provisionnement.
6. `db/demo-chsld.js` : CHSLD des Érables (60 lits) et CHSLD du Saint-Laurent (90 lits), comptes et scénarios.
   - À placer dans un environnement de démonstration isolé, séparé de la démo ABC publique (sous-domaine à autoriser).
7. Tests `tests/chsld.test.cjs`, non-régression A/B/C, recette complète.

Phase 2 : portail des proches (revue de sécurité). Phase 3 : appels audio et vidéo (étude seulement).
