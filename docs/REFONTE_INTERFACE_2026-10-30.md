# Refonte de l'interface hospitalière — Paramètres, Indicateurs, ALC, ACL — 30 octobre 2026

Sources : cahiers « Refonte des paramètres, indicateurs et ACL » et « Cahier de refonte de l'interface hospitalière ». Dans l'application, l'ALC est l'écran **NSA** et l'ACL est la gestion des **comptes** (Administration).

## Constats de l'audit
- Les comptes de démo A, B et C sont des comptes de **coordination**, pas d'administration. Le panneau OG s'affichait donc en lecture seule.
- **Défaut trouvé** : toutes les 30 secondes, l'écran actif était redessiné. Les saisies en cours étaient effacées (nom d'OG, mot de passe, formulaires d'administration). Les écrans à formulaires ne sont plus redessinés automatiquement.
- « Enregistrer » (« Log » en anglais) est l'onglet **Journal**. « Assistance clientèle » est l'onglet **Support**.
- **Console SH** : cocher « Sombre » ne faisait rien tant qu'on n'avait pas cliqué « Enregistrer l'apparence ». La page Paramètres renvoyait simplement vers une autre page.
- Le gestionnaire réseau sans double authentification reste bloqué sur l'administration. C'est voulu.

## Ce qui change

### Navigation (lot 2)
- Barre regroupée :
  - **Opérations** : lits, urgence, admissions, transferts, nettoyage, vigilance.
  - **Pilotage** : ALC, indicateurs, réseau, national.
  - **Gestion** : paramètres, administration.
- Journal et Support sortent de la barre. Ils sont accessibles depuis Paramètres, sans perte de fonction.
- Bouton de thème dans l'en-tête : clair → sombre → automatique. Le choix est immédiat et enregistré sur le compte.

### Paramètres (lot 1)
Un menu commun en tête de Paramètres, Mon compte, Administration, Support et Journal. Les entrées suivent les droits.

- **Mon compte**
  - Profil : nom, courriel, rôle, établissements de rattachement.
  - Changement de mot de passe : mot de passe actuel exigé, autres sessions fermées.
  - Double authentification, langue.
  - Bouton **Se déconnecter** : la session est fermée côté serveur.
- **Établissement**
  - *Administratif* : identité, localisation, coordonnées, fuseau horaire, réseau.
  - *Opérationnel* : structure réelle (départements, services, unités, chambres, lits, civières), cycle du lit, établissements.
  - La configuration technique est repliée et réservée aux administrateurs.
- **OG**
  - Activation des fonctions selon la licence SH, nom, avatar, couleurs, voix, langue, accueil.
  - Aperçu, test de la voix, réinitialisation, enregistrement.
  - Les modifications non enregistrées sont signalées, et une confirmation est demandée avant de quitter.
  - En démo, le coordonnateur peut personnaliser OG. Ailleurs, c'est réservé aux administrateurs, avec double authentification.
  - Les changements s'appliquent immédiatement au panneau et à la voix, et sont conservés après rechargement.
- **Apparence et langue** : clair, sombre, automatique ou soleil. Application immédiate.
- **Notifications et alertes** : rayon d'alerte, notifications, seuils d'occupation (lits et civières), règle de relance des transferts.

### Indicateurs (lot 3)
- Trois sections avec une courte explication : **Vue d'ensemble**, **Flux hospitaliers**, **Performance opérationnelle**. S'y ajoute **Urgence** si le module est actif.
- Filtre par section. Nombre d'indicateurs hors cible.
- Mêmes tuiles et **mêmes calculs** : unité, cible et tendance par rapport à la période précédente.
- Période et export CSV conservés.
- **Graphiques** sur données réelles :
  - disponibilité par unité (libres, occupés, autres) ;
  - transferts par jour sur la période (non refusés, refusés).
- Chaque graphique a une légende et des infobulles, et s'adapte au téléphone.

### ALC (lot 4)
- **Synthèse** : tuiles existantes.
- **Liste** : triée par durée, avec recherche (lit, unité, référence), filtre par orientation et compteur.
- **Détails** : panneau avec référence, unité, orientation, date d'entrée, statut (« séjour prolongé » à partir de 30 jours), et événements du journal du séjour en cours.

### ACL (comptes)
- Recherche, filtres par rôle et par état (actifs, désactivés). Comptes regroupés par rôle.
- Encadré « Que peut faire chaque rôle ? » et **tableau des accès effectifs** (fonction × rôle).
- Aucune règle serveur modifiée.

### Console SH
- Le mode d'affichage s'applique et s'enregistre **dès le clic** :
  - dans Mon compte ;
  - dans Paramètres, où le choix se fait directement ;
  - avec le nouveau bouton de thème de l'en-tête.
- Le bouton « Enregistrer l'apparence », devenu inutile, est retiré.
- Vérification ailleurs dans SH : aucun écran n'est redessiné automatiquement, donc aucune saisie perdue.

## API ajoutées (lecture seule, mêmes contrôles d'accès)
- `GET /api/indicateurs` renvoie aussi :
  - `par_unite` : lits en service, libres et occupés par unité ;
  - `transferts_par_jour` : total et refus par jour.
- `GET /api/nsa/lits/:id` : détail d'un lit ALC et événements du séjour en cours. L'établissement de l'utilisateur et le module ALC sont vérifiés.

## Fichiers modifiés
- **Code, côté hôpital** : `public/app.js`, `public/index.html`, `public/style.css`, `public/icones.svg`, `public/og.js`, `public/og-vocal-moteur.js`, `public/i18n/fr.js`, `public/i18n/en.js`.
- **Code, console SH** : `public-sh/sh.js`, `public-sh/acces.js`, `public-sh/index.html`, `public-sh/i18n/en-lot1.js`.
- **Code, serveur** : `src/app.js`, `src/terrain.js`, `src/og-configuration.js`.
- **Tests** : `tests/interface.spec.js`, `tests/og.interface.spec.js`, `tests/api.test.js`, `tests/sh-erp.interface.spec.cjs`.

## Tests
Tests unitaires : 101 sur 101.

**Nouveau test « centre de paramètres »** (ordinateur et téléphone) :
- le menu, et l'absence de Journal et Support dans la barre ;
- la structure de l'établissement ;
- le thème changé par l'en-tête, enregistré en base, retrouvé après rechargement puis après reconnexion ;
- OG : nom, avatar et voix enregistrés et appliqués, avertissement en cas de modifications non enregistrées ;
- l'accès au Journal et au Support ;
- le mot de passe : l'ancien est refusé, le nouveau est accepté ;
- la déconnexion : session fermée côté serveur.

**Parcours A/B/C** (ordinateur, tablette, téléphone) :
- la recherche ALC et son panneau de détails ;
- les sections et graphiques des indicateurs ;
- la recherche de comptes, le filtre par état et le tableau des accès.

**Tests API** :
- détail ALC refusé à un autre établissement ;
- données des graphiques cohérentes.

**Console SH** : thème appliqué au clic dans Mon compte, dans Paramètres et par l'en-tête.

**Défauts corrigés pendant les tests** :
- le menu des paramètres débordait sur téléphone ;
- les pluriels s'écrivaient avec « (s) » ;
- le détail ALC montrait des événements antérieurs au séjour en cours.

## Limites
- Il n'y a pas de filtre par unité ou par service sur l'ensemble des indicateurs : les calculs serveur sont faits par établissement, et le cahier interdit de les modifier. Le graphique par unité donne la vue par unité.
- Les graphiques « évolution de l'occupation » et « délais d'attente dans le temps » demandent un historique quotidien de l'occupation, qui n'est pas stocké aujourd'hui. Ils ne sont pas affichés plutôt que d'être inventés.
- Les droits ne se modifient pas depuis l'interface : ils restent fixés par rôle côté serveur. Le tableau les explique.
- Les essais vocaux réels restent à faire par Moustafa.
- Le mot de passe des comptes de démo publics n'est pas changé en ligne, car le contrôle de publication se connecte avec eux. Le changement est prouvé sur un compte de test.
