# Démonstration Arrimo à trois hôpitaux

## Audit des modules réutilisés

| Besoin | État actuel | Réutilisation / limite |
|---|---|---|
| Établissements, départements et unités | Partiel | Établissements et unités existent; il n’existe pas de table distincte `departements`. Le type d’unité décrit déjà le service. Le pilote doit décider si ce niveau métier manque réellement avant d’ajouter un schéma. |
| Chambres numérotées, lits identifiés et états | Fonctionnel | `chambres` et `lits`, codes uniques dans leur hôpital, transitions validées et journalisées. |
| Patients de démonstration | Fonctionnel au minimum requis | Référence synthétique `P-#####`; aucune fiche médicale complète. |
| Admissions et affectation | Fonctionnel | `demandes_admission`, affectation transactionnelle et validation du lit compatible. |
| Transferts, acceptation, refus, réception | Fonctionnel | API et interface existantes, lit réservé dans la transaction, notifications et journal. |
| Permissions | Fonctionnel | Comptes coordonnateurs limités à leur établissement; gestionnaire réseau voit les capacités partagées. |
| OG et itinéraire | Fonctionnel avec limites explicites | Recherche/Plan B existants. Les tests de parcours utilisent un routeur fictif clairement indiqué; le runtime local A/B/C n’a aucun fournisseur et montre « trajet indisponible ». |
| Jeu de démo à trois comptes hospitaliers | Incomplet avant cette livraison | Le générateur avait X/Y et le gestionnaire; la variante A/B/C ajoute des accès dédiés et rend C entièrement partageable. |

Les états physiques sont `libre`, `occupe`, `reserve`, `nettoyage` et `indispo` (hors service). La fraîcheur de confirmation est un indicateur distinct. Les lits et chambres sont liés aux unités et établissements; les capacités sont calculées des lits existants, sans compte parallèle.

## Comptes et environnements

Le jeu A/B/C réutilise le réseau fictif existant : A correspond à HX, B à HY et C à HC. Les unités, chambres, lits et capacités sont les lignes métier du jeu existant; aucune structure en double n’est créée. Dans cette fixture, le coordonnateur fictif de C confirme ses lits libres avec l’horodatage courant. Le gestionnaire réseau conserve l’accès existant. Comptes :

- `hopital.a@demo.arrimo` — Hôpital A (HX)
- `hopital.b@demo.arrimo` — Hôpital B (HY)
- `hopital.c@demo.arrimo` — Hôpital C — Sainte-Aurore (HC)
- `reseau@demo.arrimo` — gestionnaire réseau

Le générateur écrit les mots de passe avec les comptes dans `.local/acces-demo-trio.txt`, permissions Unix `0600`. Ne pas joindre ce fichier aux documents de présentation. Le mot de passe vient de `DEMO_MOT_DE_PASSE`, ou de la valeur de démonstration locale par défaut. Les comptes ne doivent jamais être créés sur le domaine public.

Créer d’abord une base PostgreSQL locale dédiée dont le nom commence par `arrimo_demo_trio`, puis lancer le serveur avec `ARRIMO_ENV=demo` et `DATABASE_URL` vers cette base. `npm run demo:trio` refuse tout hôte non local et tout nom de base hors préfixe. Le générateur refuse une base déjà peuplée. Seul `npm run demo:trio:reset`, avec les mêmes garde-fous, remet le jeu fictif à zéro.

## Trois sessions et vues

Ouvrir trois profils de navigateur indépendants (ou trois contextes privés, chacun avec une session distincte) et se connecter comme A, B et gestionnaire réseau. C sert à la seconde partie après le refus de B. Le tableau de bord hospitalier A montre ses admissions, lits, alertes, transferts sortants et OG; B montre ses propres lits, demandes entrantes et transferts; le gestionnaire voit la synthèse du réseau selon les règles de partage. C ne voit pas les transferts A/B. Les comptes A/B/C peuvent chacun initier ou recevoir un transfert selon les droits du côté concerné.

## Déroulé Teams — 10 minutes

| Temps | Session | Démonstration |
|---|---|---|
| 0:00–1:00 | Gestionnaire | Vue réseau, niveaux de pression et limites du partage. Préciser que les données sont fictives. |
| 1:00–2:00 | A | Créer une admission fictive avec une référence `P-93001` et un type d’unité, sans identité ni donnée clinique. |
| 2:00–3:30 | A / OG | Rechercher un lit confirmé compatible chez B; montrer l’établissement, l’état, le niveau de saturation et l’heure de confirmation. Afficher km/min uniquement si l’API rapporte un calcul réel et son fournisseur; sinon dire « trajet indisponible ». |
| 3:30–4:30 | A | Sélectionner un lit B nommé dans l’interface et envoyer la demande. Montrer la réservation et le changement de capacité. |
| 4:30–6:00 | B | Voir la notification, accepter, confirmer la préparation de la chambre et consulter le transfert entrant. |
| 6:00–7:30 | A puis B | Faire avancer transport, départ et réception; vérifier le lit occupé, les notifications et l’historique. N’effectuer ce parcours que si le routage de démonstration utilise un fournisseur réel approuvé. |
| 7:30–9:00 | A puis B | Créer une deuxième demande fictive vers B; B refuse avec motif. OG relit les capacités et écarte B du Plan B. Choisir C seulement si capacité confirmée et critères appropriés. |
| 9:00–10:00 | Gestionnaire puis C | Comparer les trois vues et l’isolation. Rappeler que les recommandations n’acceptent ni n’orientent un patient automatiquement. |

Le routeur fictif des tests n’est pas un service de distance et ne doit pas être présenté pendant une réunion comme une estimation routière. En absence d’un fournisseur réel approuvé, la demande se bloque avant départ; présenter ce garde-fou et ne pas prétendre avoir achevé le même transfert.

## Vérifications exécutées

`tests/demo-trio.test.cjs` crée la base depuis le générateur existant puis vérifie les références établissement/unité/chambre/lit, les doublons, les sessions et permissions A/B/C/gestionnaire, la recherche OG vers B et C, la réservation d’un lit précis, l’acceptation, la préparation, le départ et la réception en adaptateur d’itinéraire explicitement fictif, les notifications, deux demandes concurrentes sur le même lit (une seule réussit), le refus de B et la présence de C dans les alternatives Plan B.

Ces preuves sont de test logiciel sur données fictives. Elles ne prouvent pas la fiabilité d’un fournisseur routier, des règles cliniques ou pédiatriques, ni la validation hospitalière. Aucune modification ou requête n’est effectuée sur la production.

Les captures automatiques des trois sessions, créées pendant le test, sont conservées dans `.local/preuves-demo-trio/` (accueil A, accueil B, réseau). La commande de test utilise une base PostgreSQL temporaire, la détruit après le test et ne touche pas aux autres bases.

## Audit OG et capacité ajoutée dans cette candidate

| Fonction demandée | État avant cette candidate | Réutilisation / résultat de cette candidate | Limite restante |
|---|---|---|---|
| Capacités partagées compatibles, refus et alternatives | Fonctionnel pour les lits structurés; recherche et Plan B existent | `services.recommander`, route existante `/transferts/:id/alternatives`; aucun nouveau moteur de recherche. | La compatibilité dépend uniquement des critères structurés connus. Validation clinique humaine obligatoire. |
| Confirmé, périmé, non confirmé et prévu | Partiel mais déjà modélisé | OG présente ces catégories dans son plan de coordination; états physiques des lits conservés tels quels. | Un lit prévu ne donne ni heure ferme ni acceptation d’admission. |
| Plan lorsqu’aucune place confirmée n’existe | Manquant comme vue combinée | `plans_coordination` ajouté au briefing OG; regroupe les capacités partagées, confirmations, nettoyage visible, attentes, réponses concurrentes et suggestions d’escalade. | Plan calculé à la demande et en lecture seule; aucune tâche persistante, relance ni échéance n’est créée. |
| Impact opérationnel avant réservation | Partiel (pression existante) | Simulation dans `services.recommander`: pression actuelle et hypothèse d’une réservation supplémentaire; clairement identifiée comme simulation. | N’intègre pas un modèle temporel, les ressources de personnel, la disponibilité d’équipement non déclarée ni les effets cliniques. |
| Responsable et date de résolution | Incomplet | OG désigne seulement le rôle/service à contacter; affiche l’absence d’échéance déclarée. | Pas de responsable nominatif ni d’assignation ou de suivi durable. À intégrer au journal/workflow de transfert seulement après validation métier. |
| Nettoyage et rapprochement avec demandes externes | Workflow local existant; rapprochement réseau incomplet | File mobile, permissions entretien, journal et confirmation existants; OG compte un lit en nettoyage séparément et suggère un suivi si le partage complet l’autorise. | L’entretien n’accède pas aux données patient; aucun rapprochement automatique ou notification interétablissement n’est ajouté. |
| Personnel, équipements et contraintes du receveur | Partiel | OG réutilise les besoins structurés et les champs de compatibilité des lits lorsque disponibles. | Les déclarations fiables de personnel/équipement et leur fraîcheur ne sont pas une capacité réseau générale. OG signale cette limite. |
| Itinéraire vérifié | Fonctionnel uniquement avec fournisseur configuré | Les km/minutes s’affichent si le fournisseur existant retourne un trajet; le panel OG affiche sinon « trajet indisponible ». | Le test d’acceptation A/B/C utilise un adaptateur de test; le runtime de démonstration n’a pas de routeur réel. Ne pas présenter les km du test comme trajet réel. |
| Permissions A/B/C | Fonctionnel | Accès et vues séparés; capacité d’un candidat limitée à son niveau de partage. Les nombres de demandes concurrentes ne sont exposés qu’en partage complet. | Le jeu est fictif et ne valide pas l’architecture d’identité d’un pilote hospitalier. |

## Parcours de la démonstration OG

Dans le compte A, créer une demande fictive sans lit local assignable. Le briefing OG affiche les candidats et sépare capacité confirmée, non confirmée, périmée et prévisionnelle. Il montre le nettoyage uniquement pour les établissements en partage complet, les demandes concurrentes autorisées, et la pression avant/après une réservation hypothétique. Les km/min sont rendus uniquement si `statut_route=calcule`; sinon aucune distance n’est affichée. Les actions proposées ont un rôle responsable et `échéance: null` lorsque le produit ne possède pas cette donnée. L’équipe suit ensuite les parcours existants pour demande, acceptation/refus, réservation et nettoyage.

La nouvelle vue est un plan indicatif, recalculé à l’ouverture du briefing. Elle ne crée pas de tâches, de transferts, de notifications, de réservations ou d’orientations. Le panneau indique explicitement ces limites et les prévisions restent séparées des faits confirmés.

## Proposition de vidéo de deux minutes

| Temps | Image et narration proposée |
|---|---|
| 00:00–00:20 | Dashboard A et réseau fictif. « Arrimo rassemble les capacités partagées de plusieurs établissements. » Mention à l’écran : données fictives. |
| 00:20–00:40 | Lit réservé, nettoyage et confirmation dans le parcours existant. « Les états physiques et la confirmation restent distincts; l’entretien ne voit aucune donnée patient. » |
| 00:40–01:05 | OG affiche candidats, confirmation, projections, pression et actions proposées. Montrer « trajet indisponible » sur le serveur candidat local; aucune distance n’est fabriquée. |
| 01:05–01:35 | Refus B, puis ouverture du Plan B vers C dans la démonstration automatisée. Superposer « scénario fictif de test » si le fournisseur de test affiche des kilomètres. |
| 01:35–02:00 | Dashboards A/B/C, réservation et clôture du test. « OG explique les options; les coordonnateurs décident. Toute validation clinique appartient aux équipes. » |

Cette proposition est un storyboard, pas un fichier vidéo enregistré. Le parcours automatisé d’acceptation utilise un routeur de test fictif; il ne faut donc pas utiliser ses kilomètres/durées comme données réelles dans une vidéo destinée à un établissement. Pour filmer un transfert complet sans incrustation de simulation, configurer et valider d’abord un fournisseur de routage approuvé.
