# Scénarios A/B/C — résultats

Exécutés par tests/scenarios-abc.test.cjs sur une copie isolée (7/7 réussis). Chaque preuve est relue en base.

| Scénario | Étape | Preuve |
|---|---|---|
| 1 | Patient fictif enregistré à l’urgence de A et placé sur une civière | P-01005 sur COR-T1004, groupe adulte |
| 1 | Demande de lit créée depuis la civière | demande n° 87, statut attente |
| 1 | Lit adapté assigné : le lit devient réservé | MED-203A réservé pour P-01005 |
| 1 | Admission finalisée : lit occupé, civière en nettoyage, parcours « hospitalisé » | MED-203A occupé ; civière COR-T1004 en nettoyage |
| 1 | Journal et file d’admission à jour | 4 événements journalisés ; demande retirée de la file |
| 1 | Variante : admission lancée depuis la fiche Lit, puis second clic dans Admissions | MED-207B occupé, demande admise, civière COR-T1006 en nettoyage, second clic sans effet (idempotent) |
| 2 | Congé prévu visible par numéro de lit (Congés, filtre « demain ») | MED-204A : prevu, 2026-10-25T18:00:00.000Z |
| 2 | OG retrouve le congé du lit MED-204A | Lit MED-204A (Médecine, chambre 204) : occupé depuis 4 h 37 · patient P-18093. / • Congé prévu pour demain à 14 h 00. |
| 2 | Congé confirmé ; OG suit le contexte (« ce lit ») | • Congé confirmé pour demain à 14 h 00. |
| 2 | Départ réel simulé : congé réalisé, lit en nettoyage | départ réel 2026-10-24T21:43:47.498Z |
| 2 | Nettoyage commencé puis confirmé, disponibilité confirmée, capacités à jour | MED-204A libre et confirmé ; 2 lit(s) libre(s) confirmé(s) chez A |
| 3 | Patient de B désigné NSA, orientation réadaptation ; NSA et Indicateurs synchronisés | CHIR-303B ; 2 NSA (7.1 %) |
| 3 | OG résume les NSA de B | 2 patients en NSA (7.1 % des lits occupés ; cible 8 %), 9 jours-lits au total : |
| 3 | Orientation modifiée puis statut retiré ; A ne peut pas agir sur un lit de B | refus 404 pour A |
| 3 | Module NSA désactivé pour le centre pédiatrique (configuration modulaire) | refus 403 module_desactive |
| 4 | A recherche un lit de médecine : B est proposé (capacité confirmée, route calculée) | Hôpital B — Mont-Clair · 29,9 km par la route · environ 30 min · 5 lits adaptés libres · niveau vert |
| 4 | OG propose B | Meilleure option en médecine : Hôpital B — Mont-Clair (Ville Y, 29,9 km, environ 30 min de route), 5 lits libres, 1 prévu. |
| 4 | A envoie la demande ; le lit de B est réservé | TR-00059 · lit MED-201A |
| 4 | Étape accepter (B) | TR-00059 : validee |
| 4 | Étape chambre_prete (B) | TR-00059 : validee |
| 4 | Étape transport (A) | TR-00059 : transport |
| 4 | Étape depart (A) | TR-00059 : en_route |
| 4 | Étape reception (B) | TR-00059 : recu |
| 4 | Réception : lit de B occupé, civière de A au nettoyage, journaux cohérents | MED-201A occupé |
| 5 | B refuse avec un motif ; son lit redevient libre | TR-00060 refusé |
| 5 | Plan B : la recherche actualisée exclut B et propose C | Hôpital C — Sainte-Aurore · 7,9 km par la route · environ 8 min · 1 lit adapté libre · niveau vert |
| 5 | OG explique le refus de B et la proposition | Établissement proposé maintenant : Hôpital C — Sainte-Aurore — Recommandé : le plus proche avec un lit adapté. / • Hôpital C — Sainte-Aurore — rang 1 (proposé) : 1 lit(s) confirmé(s), niveau vert, 8 min de route (7.9 km, routeur routeur de test fictif). / • Hôpital B — Mont-Clair — rang 2 : 3 lit(s) confirmé(s), niveau vert, 30 min de route (29.9 km, routeur routeur de test fictif) ; a refusé TR-00060 : « Plus de personnel en chirurgie cette nuit ». |
| 5 | A transmet une nouvelle demande ; C accepte et prépare la réception | TR-00061 accepté, chambre prête |
| 6 | Enfant fictif enregistré à l’urgence de A | P-01011, groupe d’âge calculé : pédiatrique |
| 6 | Demande de soins intensifs pédiatriques : B (lits SI adultes libres) n’est pas proposé ; le centre pédiatrique l’est | 3 lit(s) SI adulte(s) libre(s) chez B, exclus ; proposé : Centre pédiatrique des Érables (fictif) |
| 6 | Chirurgie pour un enfant : lits adultes écartés (raison : groupe d’âge), lit « tous âges » de C possible | B : 4 lit(s) écarté(s) pour l’âge ; C : 1 lit(s) compatible(s) |
| 6 | Transfert forcé vers un lit adulte de B refusé par le serveur | code confirmation_capacite_requise |
| 6 | OG liste les capacités pédiatriques compatibles et rappelle la validation clinique | Capacités pédiatriques et néonatales partagées (lits de groupe d’âge compatible seulement) : / • Hôpital C — Sainte-Aurore : Pédiatrie générale 1 confirmé(s) / • Centre pédiatrique des Érables (fictif) : Pédiatrie générale 2 confirmé(s) ; Soins intensifs pédiatriques 1 confirmé(s) ; Néonatologie 1 confirmé(s) ; Chirurgie pédiatrique 1 confirmé(s) |
| 6 | Droits respectés entre A et le centre pédiatrique ; OG du centre liste ses lits SIP | Lits libres en soins intensifs pédiatriques chez Centre pédiatrique des Érables (fictif) : 1. |
| 7 | Huit réservations simultanées du même lit : une seule valide | 7 refus 409 |
| 7 | Deux admissions simultanées : une seule appliquée | un seul passage à « occupé » au journal |
| 7 | Aucun accès interétablissement (lits, congés, alertes, OG) entre A, B, C et le centre pédiatrique | 16 refus 403 |
| 7 | Lit verrouillé pendant l’admission : refus propre sans état partiel, puis reprise réussie | demande restée « assignée », civière occupée ; reprise : admise |
