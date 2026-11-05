# Parcours CHSLD ↔ hôpital : correction finale (5 novembre 2026)

Source : cahier « Correction finale du parcours CHSLD ↔ Hôpital ». Branche `chsld-20261031`.

## 1. Ce qui existait déjà et a été réutilisé
- Coordinations CHSLD ↔ hôpital : verrous, versions, journal, notifications, envois sans doublon.
- Module Liaison CHSLD.
- File d'admission (`terrain.creerDemande`, `assignerLit`, `admettreDemande`).
- Civières et lits : `regles.js` reste le seul endroit qui change leur état.
- Place conservée, entretien séparé de l'occupation, contrôle de réintégration.
- Rôle entretien, journal immuable, OG.

## 2. Ce qui a été corrigé ou ajouté

### A. Départ du CHSLD
- Formulaire de préparation : motif administratif, degré d'urgence déclaré, service souhaité (services de l'hôpital choisi), destination, transport, besoins d'accessibilité, accompagnateur.
- Les informations opérationnelles sont en **listes fermées** : seul le motif reste en texte libre, avec un rappel de n'y inscrire aucune donnée clinique.
- L'hôpital lit ces renseignements sur sa fiche, sans nouvelle saisie.
- Le degré d'urgence reste une **information** : il ne fixe aucune priorité et n'entre dans aucun calcul.

### B. Admission à l'hôpital
- Nouvelle action « Orienter / admettre le patient », après l'arrivée confirmée.
- **Avant** : une orientation vers l'urgence n'était qu'une note, et une admission restait en file sans lit.
- **Maintenant** :
  - Le personnel confirme ou corrige le service et indique les équipements requis.
  - Il choisit un lit libre et compatible (service, équipements, groupe d'âge), une civière libre ou la file d'admission.
  - Avec un lit choisi, l'attribution et l'admission se font en **une seule transaction**. La version et l'état du lit sont revérifiés par `regles.js` ; en cas d'échec, rien n'est enregistré.
  - Une civière peut ensuite mener à un lit ; elle part alors au nettoyage.
- Doubles admissions refusées : une référence qui occupe déjà un lit ou une civière, ou qui sert à un autre parcours ouvert.
- Statuts synchronisés : la fiche affiche l'état réel de l'admission (en file, lit attribué, admis).
- Au départ confirmé vers le CHSLD, le lit ou la civière part au nettoyage ; une demande encore en attente est annulée.
- Décision, auteur, référence, emplacement et service corrigé sont inscrits au journal.

### C. Retour vers le CHSLD
- Nouvelle section « Retours en cours » dans la Liaison CHSLD.
- Chronologie : demande, acceptation, préparation, chambre vérifiée, départ, transport, arrivée, réintégration, clôture.
- **L'étape et la chronologie sont désormais calculées par le serveur** et sont identiques des deux côtés. Avant, l'écran du CHSLD avait son propre calcul, qui pouvait différer de celui de l'hôpital.
- **L'arrivée et la réintégration sont séparées** :
  - L'arrivée est toujours enregistrable, car le résident est là. Il passe au nouvel état « arrivé, réintégration à confirmer », et sa place reste conservée.
  - « Réintégrer dans sa chambre » est réservée à la coordination, à l'administration de l'établissement et aux gestionnaires. L'action exige l'identité vérifiée, les conditions d'accueil confirmées, la chambre vérifiée et une place attribuée, non bloquée, propre et sans tâche ouverte.
  - Le parcours n'est clos qu'après cette action.
- Arrivées anticipées : refusées tant que l'étape précédente manque. Un incident « arrivée anticipée » prévient l'autre établissement.

### D. Nettoyage et chambre conservée
- **Écart corrigé** : le rôle entretien pouvait lire `/chsld/accueil`, un tableau de bord général. C'est maintenant refusé.
- L'entretien ne reçoit plus aucune référence ni aucun nom de résident dans les chambres et les tâches. Il confirme son intervention dans ses tâches.
- Une place propre reste conservée.

### Défauts trouvés en chemin, que j'avais introduits le 1er novembre
- Les notifications « retour proposé » et « retour accepté » nommaient le mauvais établissement.
- Mon message `motif_requis` écrasait celui d'un lit mis hors service. Le code de la libération d'une place est maintenant distinct.

## 3. Tests exécutés (données fictives seulement)
- **Parcours final, par l'API** : CHSLD A → Hôpital B → CHSLD A. Couvre :
  - formulaire et valeurs refusées ;
  - emplacements compatibles ;
  - lit périmé, occupé ou incompatible, sans effet partiel ;
  - même référence refusée, même lit visé en parallèle (un seul gagnant) ;
  - civière puis lit ;
  - arrivées anticipées dans les deux sens ;
  - chambre non prête ; retour refusé ;
  - conditions de réintégration et rôles ;
  - étape et chronologie comparées des deux côtés à chaque étape ;
  - journal avec auteur et sans nom.
- **Parcours complet dans un navigateur réel** (Chromium), joué à l'écran par le personnel, avec contrôle du téléphone sans défilement horizontal. La seule exception est la fin des tâches de l'entretien, faite par l'API dans ce test. Les boutons de l'entretien ne sont donc pas testés dans ce parcours.
- **Non-régression** : voir § 5, avec les 600 cas d'OG toujours à 600 sur 600.

« Pannes » a été testé comme un échec en cours d'attribution, qui annule toute la transaction, et comme un renvoi après coupure réseau. Un arrêt réel du serveur ou de la base n'a pas été testé.

## 4. Limites restantes
- **Degré d'urgence et motif** : le motif reste en texte libre ; aucun filtre ne peut garantir l'absence de donnée clinique. Le rappel à l'écran ne remplace pas la formation.
- **Compatibilité d'un lit** : service, équipements et groupe d'âge seulement. Le personnel juge du reste.
- **Départ de l'hôpital sans chambre vérifiée** : il n'est pas bloqué, seulement visible dans la chronologie. Le résident ne peut pas être réintégré tant que la vérification n'est pas faite.
- **Étape « transport »** : facultative, elle ne bloque pas l'arrivée.
- **Sur tablette** : non testé.
- **Résident déjà en cours de retour au moment de la publication** : il suit les nouvelles étapes à partir de son état actuel. Les anciens retours déjà reçus restent considérés comme terminés.

## 5. Recette et publication (5 novembre 2026, 22 h 53 UTC)
- Empreinte des sources `8df88be42b97`, toutes les suites vertes, 249 tests, 0 échec :
  - SH : 10 suites, 110 tests (`20261105222040_35bfc9`) ;
  - CHSLD 22/22, interface hospitalière 16/16, OG suivi 21/21 (`20261105222044_2aa983`) ;
  - scénarios A, B, C 8/8 et OG de base (`20261105222042_bebde7`) ;
  - API 71/71, lancée seule (`20261105225050_7938a9`).
- Release `parcours-20261105t2253` sur la démo et SH. Avant la bascule : sauvegarde, restauration identique sur copie, migrations rejouables, ancien et nouveau code essayés sur la copie. Rapport : `.local/parcours-release-20261105t2253/rapport.json`.
- Scénario A, B, C et comptes préservés ; aucune remise à zéro. Recette, validation et principal n'ont pas été mis à jour.
