# Guide de démonstration — Arrimo Préhospitalier

Données entièrement fictives (`npm run demo:reset`). Mot de passe des comptes : celui de la démonstration (fichier d'accès de la démo, jamais dans ce document).
Le cahier de référence est `docs/cahiers-prehospitalier-20261112/2-cahier-construction-prehospitalier.md` (section 18).

## Comptes

| Compte | Rôle | Écran |
|---|---|---|
| `ambulance.a@demo.arrimo` | paramédic, Ambulances du Nord (unités 41-12, 41-15) | `/secours` (Arrimo Ambulance) |
| `superviseur.a@demo.arrimo` | superviseur, Ambulances du Nord | `/secours` (vue de l'organisation) |
| `ambulance.b@demo.arrimo` | paramédic, Paramédics des Rives (unité 57-03, préalerte en cours) | `/secours` |
| `ccs@demo.arrimo` | répartition régionale | `/secours` (Arrimo CCS) |
| `hopital.x@demo.arrimo` | coordination de l'Hôpital X | onglet **Liaison Secours** |
| `hopital.y@demo.arrimo` | coordination de l'Hôpital Y | onglet **Liaison Secours** |
| `reseau@demo.arrimo` | gestionnaire réseau | Administration → **Secours** (organisations, unités, comptes, systèmes, supervision) |

Liaison Secours est activée pour l'Hôpital X, l'Hôpital Y et l'Hôpital du Bois-Joli.

## Scénarios (10 minutes)

**A — Arrivée anticipée.** `ambulance.a` : choisir l'Hôpital Y, priorité « Urgente », catégorie, délai, « Transmettre la préalerte ». `hopital.y` : onglet Liaison Secours, la préalerte apparaît (reçue), « Accuser la préalerte ». Retour sur l'ambulance : l'étape « Prise en compte » est cochée.

**B — Priorité élevée.** Même parcours en « Immédiate » : la notification de l'hôpital le signale ; la synthèse d'OG rappelle qu'une priorité immédiate n'est pas encore prise en compte ; son activable par poste.

**C — Proposition d'OG.** Sur la fiche, « Service proposé par OG » avec sa règle (catégorie → service de l'établissement). Confirmer, indiquer un autre service ou refuser. Demander à OG : « Quel service est potentiellement concerné ? ».

**D et E — Patient identifié ou non.** Le parcours ne dépend jamais de l'identité : la préalerte avance avec son numéro temporaire `PA-…` (scénario E). La correspondance simulée avec un dossier hospitalier (scénario D) attend la décision de Moustafa sur les données d'identité (voir le rapport d'audit, section 14).

**F — Changement de destination.** Sur l'ambulance, « Changer de destination » : l'ancienne préalerte reste visible comme remplacée dans l'hôpital d'origine, qui est notifié ; le nouvel hôpital reçoit une nouvelle préalerte.

**G — Données de capacité périmées.** L'Hôpital X a déclaré « Saturation » il y a 35 min : l'écran Ambulance, le CCS et OG l'indiquent comme donnée ancienne ; la synthèse d'OG de l'Hôpital X demande de confirmer. Déclarer à nouveau le statut renouvelle l'heure.

**H — Problème réseau.** Sur la tablette de l'ambulance, couper le réseau puis transmettre une préalerte : « Envoi en attente », la préalerte est gardée sur l'appareil ; au retour du réseau, elle est transmise une seule fois (même clé d'envoi).

**Bon véhicule.** `hopital.x` : la préalerte de l'unité 57-03 est en préparation. « Confirmer le véhicule arrivé » avec un autre numéro : enregistré, la préalerte reste ouverte. Avec 57-03 : arrivée confirmée, puis « Confirmer la remise ».

**CCS.** `ccs` : carte régionale (hôpitaux selon l'urgence, ambulances annoncées), alertes de saturation, préalertes et transports en consultation ; OG répond sans rien décider.

**Arrimo Connect.** Clés de démonstration dans le fichier d'accès de la démo. Requêtes signées : `X-Arrimo-Cle`, `X-Arrimo-Horodatage` (ms), `X-Arrimo-Signature` = HMAC-SHA256(secret, `horodatage.MÉTHODE.chemin.corps`). Routes : `GET /api/connect/v1/statut`, `GET /api/connect/v1/urgences`, `GET|POST /api/connect/v1/prealertes`, `GET /api/connect/v1/prealertes/:numero`, `POST /api/connect/v1/prealertes/:numero/evenements`, `POST /api/connect/v1/unites/:numero/position`.

## Liaison Établissements (transport)
Dans un environnement avec CHSLD (démo CHSLD) : sur une hospitalisation transmise, « Demander un transport » → choix de l'entreprise ; l'ambulance voit la demande (référence R-…, lieux, accessibilité) et l'accepte avec son unité, puis « En route », « Résident pris en charge », « Arrivé à destination ». Le départ et l'arrivée de la coordination restent confirmés par le CHSLD et l'hôpital. OG du CHSLD : « Où en est le transport de R-00001 ? ».

Rappel : Arrimo complète le 911, les CCS et les protocoles ; il ne choisit jamais une destination, un service ou une priorité clinique.
