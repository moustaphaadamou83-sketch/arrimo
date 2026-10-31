# Appels audio et vidéo avec les proches — étude (phase 3)

Statut : **étude seulement**. Rien n’est développé. Dans le catalogue SH, le module « Appels audio et vidéo » est marqué « À l’étude » : il ne peut être ni souscrit ni activé.

## Besoin à confirmer avant tout développement
- Fréquence réelle des appels vidéo entre résidents et proches, et outils déjà utilisés par les CHSLD (tablettes, téléphonie, solutions du réseau).
- Qui organise l’appel : le personnel, le résident seul ou un proche aidant ?
- Le consentement et la capacité du résident à consentir ; le rôle du représentant légal.
- L’appel doit-il passer par Arrimo, ou Arrimo doit-il seulement le **planifier** (date, proche autorisé, tablette réservée) ?

## Ce qui est déjà possible sans appel intégré
- Arrimo planifie un **échange** (« Échange planifié ») avec un proche autorisé et le trace dans le dossier.
- Le proche peut demander un **rappel** depuis le portail.
- La téléphonie actuelle reste utilisée : aucun changement pour les équipes.

## Options techniques, si le besoin est confirmé
| Option | Principe | Confidentialité | Coût indicatif | Remarques |
|---|---|---|---|---|
| A. WebRTC pair-à-pair, serveur de signalisation Arrimo et relais TURN hébergé au Canada | Flux audio et vidéo chiffrés de bout en bout entre deux navigateurs | Aucun enregistrement ; seules les métadonnées (heure, durée) passent par Arrimo | Serveur TURN (bande passante) ; faible à modéré | Le plus sobre ; fonctionne sur tablette et téléphone récents |
| B. Serveur de visioconférence auto-hébergé au Canada (type Jitsi) | Salle par appel, lien à usage unique | Hébergement maîtrisé ; pas de tiers | Serveur dédié et exploitation | Permet les appels à plusieurs proches |
| C. Service infonuagique de visioconférence avec région canadienne | API d’un fournisseur | Évaluation Loi 25 et entente de traitement nécessaires | Facturé à la minute | Plus rapide à intégrer, dépendance à un tiers |

Les prix sont à vérifier sur les grilles des fournisseurs au moment du choix.

## Exigences si l’on développe
- **Consentement** explicite du résident ou de son représentant, enregistré et révocable.
- **Aucun enregistrement** audio ou vidéo sans autorisation appropriée ; aucun enregistrement par défaut.
- Appel réservé à un proche ayant une **autorisation** « Rendez-vous » valide et un accès actif au portail ; l’invitation expire après l’appel.
- **Interface pour personnes âgées** : très gros boutons, deux actions au plus (« Répondre », « Raccrocher »), mode tablette fixe, sous-titres si possible.
- **Journal** : qui, quand, durée ; jamais le contenu.
- Essais réels avec des résidents, des proches et le personnel avant tout déploiement.

## Recommandation
Commencer par la **planification** (déjà disponible) et mesurer l’usage pendant le pilote. Si le besoin est confirmé, privilégier l’option A (WebRTC chiffré, relais au Canada, sans enregistrement), après validation de Moustafa, de l’établissement pilote et de l’évaluation Loi 25.
