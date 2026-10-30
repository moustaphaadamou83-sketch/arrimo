# OG — suivi interhospitalier et temps de transport

## Diagnostic réel

P-43267 / TR-00067 : origine C/Sainte-Aurore, destination A/Val-des-Pins,
réception enregistrée, lit SI-108 occupé par la même référence et lié au transfert,
service Soins intensifs, chambre 108. L’admission d’origine n°107 est transférée ;
sa civière URG-02 est en nettoyage sans patient. Aucun dossier `patients` n’est lié
à cet ancien parcours : le suivi conserve l’identifiant d’admission existant,
sans créer ni fusionner de patient.

L’ancien OG consultait les lits locaux et la liste paginée des transferts ; il
ne vérifiait pas le lit courant relié à un transfert reçu. Les anciens transferts
pouvaient aussi disparaître de la première page de résultats.

L’estimation enregistrée pour TR-00067 est 7,7 km / 11 minutes. Le « 0 puis
1 minute » de l’écran représentait l’âge du transfert, sans libellé explicite.
Les heures enregistrées départ/réception représentent environ 14 secondes dans
ce scénario fictif ; ce n’est pas l’estimation de route.

## Correctifs

- Projection OG en lecture seule sur les transferts communs : origine ou
  destination, ou gestionnaire selon les droits existants. Recherche exacte,
  indépendante de la pagination des transferts terminés.
- Vérification du lien transfert/admission/patient interne, du lit encore lié au
  même transfert et à la même référence, du service, de la chambre et de la civière
  d’origine. Un lit réattribué ne permet pas d’affirmer une admission actuelle.
- Statuts distincts et historique horodaté : admission d’origine, transfert,
  réservation, départ, réception, occupation actuelle. Les événements manquants
  ne sont pas inventés. Questions simples, composées et suivi de conversation.
- Identités concurrentes : demande de précision par identifiant interne ou
  transfert, sans rapprochement arbitraire ni fusion de données.
- Recherche interhospitalière via le moteur existant : confirmation de capacité,
  partage autorisé, route, tension et contraintes disponibles ; compatibilité
  individuelle à confirmer si les besoins ne sont pas enregistrés dans une demande
  active accessible. Aucune réservation/admission/transfert automatique.
- Écran FR/EN : trajet routier estimé, âge du transfert et durée réelle du transport
  explicitement séparés ; durée réelle affichée en secondes pour éviter « 0 min ».

## Validation et publication

152 tests locaux et 24 tests de garde-fous réussis. Recette ciblée : 19 tests
PostgreSQL/API/navigateur réussis, couvrant les quatorze demandes de validation,
avec réservation et départ contrôlés séparément. Les essais utilisent uniquement
des bases neuves fictives ; aucun utilisateur hébergé n’est recréé.

La publication utilise le lanceur validé, avec baseline issue du manifeste du lot
précédemment publié. Les seuls fichiers runtime autorisés concernent OG et les
libellés de transport ; aucun changement de schéma ni de contrôle d’accès global.
Sauvegarde, restauration isolée, comparaison des contenus, recette complète,
exercice de retour arrière et vérifications publiques restent obligatoires.

## Résultat final : publié et vérifié

**URL vérifiée : https://demo.arrimo.senseafri.com**

Statut réel du rapport : `publication_verifiee`,
`environnements.demo.statut=publie_et_verifie`.

| Compte | Résultat après publication |
| --- | --- |
| A | P-43267 retrouvé, SI-108 occupé, soins intensifs, chambre 108 ; transfert reçu. Vérification directe du lit SI-108 également réussie. |
| C | Même situation actuelle à A retrouvée par référence et par TR-00067 ; URG-02 non occupée par ce patient. |
| B | Aucun détail du dossier ou du transfert divulgué. Accès direct aux données d’un autre établissement toujours refusé. |
| Coordination régionale | Suivi autorisé retrouvé et périmètre existant conservé. |

**152 tests locaux, 173 tests dans 14 suites intégrées et 24 tests des garde-fous :
réussis. Aucun échec, test ignoré ou annulé dans la validation finale.**
Les 19 tests ciblés de suivi sont inclus dans les 173 tests intégrés.
Le test de retour arrière a réussi avant bascule.

Après bascule : vérifications API et Chromium réussies pour les quatre comptes,
recherche interhospitalière sans action automatique et trois temps de transport
vérifiés dans les cartes de transfert pour les comptes autorisés. L’estimation
routière de TR-00067 reste **11 minutes pour 7,7 km**, distincte de l’âge du transfert
et de la durée entre départ et réception.

Une seconde vérification HTTPS indépendante, avec de nouvelles connexions normales,
a ensuite confirmé les réponses depuis A, B, C et le compte régional, ainsi que
la question sur le lit SI-108 depuis A. Ces sessions de test ont été fermées.
Le lien de release actif et toutes les empreintes runtime ont été revérifiés
contre le manifeste publié.

Sauvegarde et restauration identique vérifiées avant publication ; aucune migration,
réinitialisation ou restauration SQL sur la base hébergée. Les sauvegardes, anciennes
releases, admissions, transferts, comptes et permissions sont conservés.
Production n’a pas été interrogée ni modifiée. La liaison SH hors de la cible Démo
retenue n’a pas été appelée.

Limites conservées : les données absentes ne sont pas inventées ; une réception
passée sans lit encore lié n’est pas présentée comme une admission actuelle ; les
références ambiguës exigent une précision par identifiant interne ou transfert.
Le trajet reste une estimation sans trafic en temps réel. Aucun rapprochement
historique n’est créé sur la seule ressemblance des références.

Preuves : `docs/preuves-og-suivi-20261026/publication-verifiee/`.

Lot final publié : `/root/arrimo-og-publication-suivi-v3-20261026`.
Rapport : `/root/arrimo-og-publication-20261026T213634Z_a85db96d/rapport.json`.
Une première préparation a été interrompue volontairement avant bascule afin de
préserver le verrou des établissements désactivés ; sauvegarde et copie conservées.
Ce verrou fait désormais partie des tests obligatoires.

Échec intermédiaire corrigé : le routage des recherches de capacités interceptait
une question pédiatrique générique et perdait son rappel clinique existant. La
spécialisation pédiatrique a été conservée et le rappel ajouté aux options de lit.
Les sept scénarios A/B/C ont été rejoués avec succès, sans modifier leurs attentes.
La publication en échec avait été arrêtée avant bascule, sans impact sur la Démo.

Release active : `releases/arrimo-og-20261026T213634Z_a85db96d`.
Santé HTTPS vérifiée : `2026-10-26T21:53:08.272Z` ; état et base OK.
Sauvegarde conservée : `/root/arrimo-og-publication-20261026T213634Z_a85db96d/sauvegarde-demo`.
Retour applicatif disponible : `/root/arrimo-og-publication-20261026T213634Z_a85db96d/retour-demo.sh`.
Archive SHA-256 : `57cbe783d078588839b73e7516dc4c3dbbda3ee18274f008b0545dc8aec4aa79`.

Autre échec local corrigé pendant le développement : une formulation « retrouve le
patient » était reconnue à tort comme une recherche de capacité. La reconnaissance
a été précisée ; les 152 tests locaux existants ont ensuite été rejoués avec succès.
