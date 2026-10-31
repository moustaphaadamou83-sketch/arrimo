# Corrections du 31 octobre 2026 — navigation, langues, OG vocal, nom de l'assistant, alternatives réseau

Sources : cahiers « Correction complète : navigation, défilement, OG vocal, personnalisation et langues », « Correction prioritaire du bug de langue OG », « OG vocal 2.0 », « OG conversation vocale temps réel », « Recherche automatique de lits alternatifs » et « Proposition automatique de lits alternatifs dans les Admissions ». Demande orale : remplacer « gratuit » par « libre » pour les lits.

Branche `correction-navigation-langue-og-20261031`. Tout est dans le socle commun (`src/`, `public/`, `db/schema.sql`) : hôpitaux A, B, C et futurs établissements activés depuis SH, sans copie de code. Aucune règle n'est limitée à un département : tous les types d'unité sont traités de la même façon.

## 1. Causes trouvées

### Défilement et navigation
- **Barre latérale en `position: fixed`** calée sur la hauteur de l'en-tête seul (`--haut-barre`), alors que le bandeau « Démonstration » au-dessus défile avec la page. Écart d'environ 24 px en haut de page, qui disparaissait en défilant : d'où « le menu ne suit pas » et « des écarts apparaissent ».
- **En-tête collant + barre fixe + contenu décalé par marge** : trois mécanismes différents, recalculés à chaque rendu.
- **Déplacement de la zone météo dans le DOM à chaque rafraîchissement** (toutes les 30 s et à chaque action) : recalcul de mise en page et petits sauts.
- **Onglet sélectionné en gras (500 → 600)** : la largeur des onglets changeait au clic, et tout le menu horizontal se décalait.
- **Position de défilement conservée d'un écran à l'autre** : saut en arrivant sur un écran plus court.
- **Cartes Leaflet** : leurs calques (z-index 400) pouvaient passer devant l'en-tête collant.
- **Téléphone** : barre d'onglets horizontale défilante et en-tête de plusieurs lignes, sans vraie navigation mobile.

### Langue d'OG
1. **Le serveur répondait dans la langue de l'interface**, pas dans celle de la question. Seule la phrase explicite « réponds en anglais » était reconnue.
2. **La réponse n'indiquait pas sa langue** : la voix lisait dans la langue de l'interface, pas dans celle du texte.
3. **La langue du micro était figée** : le premier enregistrement des préférences vocales mémorisait la langue du moment, qui ne suivait plus les changements ensuite.
4. **Chrome charge ses voix en différé** : premier essai sans voix.
5. **Changer de langue fermait la conversation** et redessinait l'écran : les saisies étaient perdues.

### « Gratuit » au lieu de « libre »
Le mot n'existe pas dans le code. L'interface anglaise affichait « Free » pour un lit libre, et **la traduction automatique du navigateur** le rendait par « Gratuit ».

### Nom de l'assistant
Le nom choisi n'était appliqué qu'au titre du panneau OG. Les libellés (menu, bouton flottant, paramètres, messages, voix) gardaient « OG » en dur.

### Alternatives dans les Admissions
- Le réseau n'était interrogé qu'après un clic sur « Chercher ailleurs ».
- **Le même lit local était proposé à plusieurs demandes** : avec deux patients pour un lit, aucun déficit n'apparaissait.

## 2. Corrections

### Navigation (lots 1, 7)
- **Une seule stratégie** : la page défile ; aucun conteneur de contenu à défilement imbriqué ; aucun JavaScript au défilement.
- **Menu horizontal** : en-tête et onglets forment un seul bloc collant (`.entete-app`).
- **Menu vertical** :
  - grille CSS ; en-tête sur toute la largeur ;
  - barre latérale **collante** juste sous l'en-tête, alignée à toutes les positions de défilement ;
  - barre latérale défilable seule (`overscroll-behavior: contain`) ;
  - contenu dans la seconde colonne.
- **Changement d'écran** : la page revient en haut.
- **Onglets** de largeur constante ; le survol ne change ni taille ni position.
- **Téléphone** :
  - en-tête sur une seule ligne : menu, établissement, FR | EN, notifications, compte ;
  - **menu tiroir** fermé par le bouton, le voile, Échap ou le choix d'un écran ;
  - météo, heure et date en tête du tiroir.
- **Cartes** isolées sous l'en-tête.

### Langues (lot 2 et correctif prioritaire)
Trois réglages distincts :

| Réglage | Où | Effet |
|---|---|---|
| Langue de l'interface | Sélecteur **FR \| EN** de l'en-tête, enregistré sur le compte (`utilisateurs.langue_interface`) | Textes changés tout de suite, sans déconnexion ; écran et saisies conservés ; retrouvée à la reconnexion sur tout appareil |
| Langue de conversation | Paramètres → OG (Automatique = langue de l'interface, Français, English), boutons FR \| EN dans la conversation, ou « parle en anglais » | Langue du micro ; repli pour une question ambiguë |
| Langue de lecture | Langue de la réponse renvoyée par le serveur (`langue`) | Voix choisie **uniquement** parmi les voix de cette langue ; sans voix compatible, message explicite, jamais de voix d'une autre langue |

- **Règle de réponse** (`public/og-langue.js`, partagé par le navigateur et le serveur, sans service externe) : langue demandée explicitement, sinon langue reconnue dans la question, sinon langue de conversation.
- Une référence seule (« P-43267 ») est ambiguë : c'est la langue de conversation qui s'applique.
- Avant chaque nouvelle lecture, la précédente est annulée.
- « Free » devient « Available » en anglais, pour tous les lits et civières.
- La page déclare `translate="no"` : la traduction automatique du navigateur ne déforme plus les termes.

### OG vocal 2.0 (lots 3, 4 et cahiers vocaux)
**Moteur** (`public/og-vocal-moteur.js`) :
- **États explicites** : connexion, écoute, parole, traitement, lecture, interrompu, micro coupé, reconnexion, hors ligne, erreur, terminé.
- **Fin de tour** : les segments successifs sont réunis, puis envoyés après 0,8 s de silence.
- **Une seule réponse à la fois** (pas de double réponse).
- **Interruption** dès deux mots prononcés, ou un ordre « stop », « arrête », « attends ».
- **Écho** : la voix d'OG captée par le micro n'est jamais prise pour une question.
- **Relance de la reconnaissance** : un silence normal relance sans attendre ; les coupures en boucle sont espacées (250 ms → 4 s) avec l'état « Reconnexion ». Pas de redémarrages permanents.
- **Micro coupé** : reconnaissance réellement fermée, aucune relance.
- **Mesures de latence** : fin de parole → premier son, gardées dans `window.ArrimoOgVocalMesures`.

**Conversation continue** (`public/og-vocal.js`) :
- Une seule pression ; transcription en direct ; pastille d'état et texte.
- Boutons FR | EN, Couper le micro, **Terminer** (toujours visible pendant la session) ; délai de réponse affiché.
- **Fin à la voix** : « On a fini », « Termine la conversation », « End the conversation », « Stop the voice chat »… OG confirme brièvement, puis le micro est fermé et l'écrit reprend.
- Phrase **ambiguë** (« au revoir », « stop ») : OG demande « oui ou non ? ». **« merci » ne ferme jamais.**
- Fermeture du panneau, onglet masqué, déconnexion ou changement d'établissement : micro arrêté.

**Message vocal** (`public/og-message-vocal.js`) :
- Enregistrer, avec durée et niveau du micro ; arrêt automatique à 1 minute.
- Réécouter, supprimer, recommencer ; transcription modifiable ; envoyer.
- « Envoyé » seulement après la réponse ; en cas d'échec, le message est conservé.
- Silence ou volume faible signalés ; erreurs de micro expliquées (refusé, absent, déjà utilisé).
- Format Opus/WebM (Chrome) ou AAC/MP4 (Safari) ; annulation d'écho et réduction de bruit demandées au navigateur.
- **L'audio reste dans le navigateur** et est effacé après l'envoi.

**Dictée** dans le champ : conservée, distincte.

**Préférences vocales** : autorisation, langue de conversation et lecture automatique **en base** (`utilisateurs.preferences_og`, `PUT /api/moi/og-voix`) ; volume propre à l'appareil.

**Même moteur OG** : la question vocale suit exactement le chemin d'une question écrite (mêmes API, droits, isolation, actions supervisées).

### Nom de l'assistant (lots 5, 6)
- **Source unique** (`nomAssistant` dans `public/app.js`), chargée pour l'établissement courant. Elle s'applique à tout texte d'interface (menus, bouton flottant, panneau, accueil, paramètres, voix, messages), avec l'élision française (« d'OG » → « de Charles »).
- Elle sert aussi aux réponses affichées et lues.
- « Charles, combien de lits ? » : l'appel par le nom est retiré avant l'analyse.
- **Isolation par établissement**, testée : A Charles, B Aya, C OG.
- « OG » reste l'identifiant technique ; journaux et audit inchangés.

### Admissions : alternatives automatiques
- **Répartition locale** dans l'ordre de la file : un lit compatible n'est proposé qu'à **une** demande.
- Les suivantes affichent le **déficit** de leur unité (« Manque 1 lit en Soins intensifs : 2 demandes pour 1 lit compatible libre »).
- Le personnel peut quand même assigner le lit disputé (« Assigner SI-107 à ce patient »).
- **Panneau « Capacité insuffisante — Solutions alternatives disponibles »** sous chaque demande sans lit, sans clic. Pour chaque proposition :
  - établissement, unité, lits signalés libres ;
  - confirmation (confirmée, à reconfirmer si périmée, à vérifier) et son heure ;
  - distance et durée seulement si l'itinéraire est calculé ;
  - lits écartés pour l'âge ou les besoins ;
  - heure d'actualisation ;
  - **« Préparer le transfert »** avec confirmation : le receveur doit accepter.
- Trois propositions affichées ; « Voir toutes les destinations » ouvre la liste complète.
- **Actualisation** :
  - `GET /api/admissions/alternatives` ;
  - cache court par établissement et critères ;
  - invalidé dès qu'un lit change d'état n'importe où (journal), qu'une disponibilité est confirmée ou qu'une demande change ;
  - recherches simultanées regroupées, au plus une recherche identique toutes les 5 s ;
  - chargement sans bloquer l'écran.
- **Tous les types d'unité** sont traités, ainsi que les besoins et le groupe d'âge. Classement opérationnel existant (capacité confirmée, niveau d'alerte, durée, distance), sans priorité clinique.
- **Aucune attribution ni aucun transfert automatique.**

## 3. Tests

| Vérification | Résultat |
|---|---|
| `tests/correction-31oct.test.cjs` (nouvelle suite « correction ») : langue des réponses, préférences en base, noms Charles / Aya / OG isolés, 2 patients pour 1 lit, 3 patients pour 2 lits, alternatives sans clic, lit externe devenu indisponible, réseau sans place, permissions A/B, recherches concurrentes, aucun transfert automatique, tous types d'unité | 4/4 |
| `tests/og-vocal.test.cjs` + `tests/bilingue.test.cjs` : langue, choix de voix, fin de conversation, micro coupé, relances espacées, fin de tour | 24/24 |
| `tests/og-suivi-postgres.test.cjs` (suivi OG + vocal simulé sur téléphone) | 21/21 |
| Tests locaux sans PostgreSQL (`scripts/test-vnext-local.cjs`) | 237/237 |
| Mesures de navigation dans Chromium (vertical clair/sombre à 0, 300, 1500 px et en bas ; horizontal ; tablette ; tiroir du téléphone ; survol ; FR → EN) | 39/39 |
| Conversation vocale simulée dans Chromium, vraie API OG : 10 échanges sans clic FR/EN avec la voix de la bonne langue, interruption, micro coupé/réactivé, « merci », « au revoir » + « non », « On a fini », micro arrêté à la fermeture | 44/44 |
| Recette officielle isolée, 17 suites sur bases neuves, empreinte `dd0c431f…` : `20261031193548_5e5a7e` (erp 31, acces 28, interface SH, parité 8, cycle 6, restauration, notifications 8, portail 12, raccordement 6, sla 8), `20261031193550_0da44b` (correction 4, api 69, og-base, structure, scénarios A/B/C 8), `20261031195403_31696f` (hopital 16, og 21) | toutes valides, aucun échec |

Latence mesurée en simulation (serveur local, fin de tour 0,8 s comprise) : 0,9 à 1,6 s par échange, une pointe à 3,0 s. **Ce n'est pas une mesure audio réelle.**

## 4. Publication
Release `correction-20261031t2045`, publiée le 31 octobre 2026 vers 21 h 10 sur les six environnements : SH-validation, validation, recette, principal, démo A/B/C, SH (`.local/correction-release-20261031t2045/rapport.json`, statut `publie`).
- Avant la bascule, pour chaque environnement : sauvegarde, restauration identique sur copie, migration rejouée deux fois sans modifier les anciennes données, ancienne et nouvelle version contrôlées sur la copie.
- Après la bascule : santé `ok` partout ; scénario A/B/C et comptes de la démo préservés.
- Vérification en ligne (démo, compte de l'Hôpital B) :
  - question anglaise avec interface française → réponse anglaise, et inversement ;
  - alternatives calculées ;
  - aucune erreur JavaScript sur ordinateur et téléphone ;
  - le nom choisi par B (« Smart ») apparaît dans le menu.

Écarts trouvés par la recette et corrigés avant publication :
- **La console SH partage la feuille de style** : les règles de navigation hospitalières sont limitées à `.entete-app` (l'en-tête SH reste collant, pas de tiroir sans bouton).
- **Le rôle entretien** peut lire la configuration de l'assistant (son nom), en lecture seule.
- **Langue** : le choix fait sur l'appareil l'emporte et est recopié sur le compte. Sinon, la langue du compte s'applique.
- **Contraste du bouton FR | EN actif en mode sombre** ; libellés FR | EN traduits.
- **Tests adaptés aux règles demandées** :
  - réponse dans la langue de la question ;
  - nom personnalisé dans les messages ;
  - navigation par le tiroir sur téléphone ;
  - attente de l'enregistrement du thème.

## 5. Limites et suite

- **Aucun essai audio réel n'a pu être fait** : le serveur n'a ni micro ni haut-parleur. Qualité, volume, prononciation, écho réel et comportement de Safari restent **à valider sur appareil** (procédure : `docs/ESSAIS_VOCAUX_OG.md`, à compléter par les essais ci-dessous). Le vocal n'est pas déclaré validé.
- Essais à faire :
  - Chrome sur Mac ; Safari sur Mac et iPhone ; Chrome sur Android ;
  - 10 échanges ; interruption ; « On a fini » ; « merci » ;
  - message vocal ;
  - voix masculine et féminine en français et en anglais.
- **Limites propres aux navigateurs** :
  - Firefox n'a pas de reconnaissance vocale ;
  - la reconnaissance de Chrome passe par Google (d'où l'autorisation demandée et la restriction aux données fictives) ;
  - Safari sur iPhone peut couper l'écoute pendant la lecture (la relance est automatique) ;
  - le genre des voix est déduit de leur nom ; s'il n'existe pas pour une langue, une autre voix compatible est utilisée et c'est signalé.
- **Architecture temps réel externe** : non intégrée, conformément aux cahiers (validation préalable du fournisseur, des coûts et de la conformité). Options à évaluer avec Moustafa :
  1. **Hébergée au Canada, sans fournisseur tiers** : transcription Whisper (faster-whisper) et synthèse Piper sur un serveur canadien, flux WebSocket. Coût : un serveur (GPU recommandé). Meilleure option Loi 25.
  2. **Services infonuagiques avec région canadienne** (Azure Speech Canada Central, Google Cloud Speech Montréal, AWS Transcribe/Polly ca-central-1) : facturation à la minute, évaluation Loi 25 et entente de traitement nécessaires.
  3. **API temps réel parole-à-parole** (type OpenAI Realtime) : expérience la plus proche de ChatGPT Voice, mais hébergement hors Canada et coût à la minute plus élevé ; incompatible avec des données réelles sans évaluation.
  - Les prix sont à vérifier sur les grilles officielles au moment du choix. Dans tous les cas, la clé reste côté serveur, et le moteur et les droits d'OG restent ceux d'Arrimo.
- La version anglaise des réponses d'OG suit le moteur historique en anglais : certaines formulations sont moins détaillées qu'en français. Le moteur transversal le plus riche reste en français.
