# Arrimo · Guide de démonstration (10 minutes)

Un réseau de **20 hôpitaux fictifs** (noms, villes et adresses inventés). Deux ont un compte pour la démonstration :
**Hôpital X**, sous pression (urgence débordée), et **Hôpital Y**, à 25 km, qui a de la place.
Les 18 autres n'ont pas de compte : leur capacité évolue d'elle-même toutes les quelques minutes (congés, admissions, nettoyages,
patients à l'urgence), et leurs équipes répondent aux demandes de transfert. La démo est donc vivante.

Un seul compte par hôpital gère tout : lits, civières, urgence, nettoyage, transferts.
Ouvrez deux fenêtres côte à côte : à gauche **hopital.x@demo.arrimo**, à droite **hopital.y@demo.arrimo**.

## 1. Le problème, en 30 secondes (Hôpital X, onglet Copilote)
- Le bandeau rouge résume la situation : pression au-dessus de 100 %, des patients en attente d'un lit, un seul lit libre,
  et une urgence à plus de 130 % avec des patients sur civière depuis plus de 24 h et 48 h.
- Message clé : *« Aujourd'hui, l'équipe le découvre par téléphone et sur des tableaux blancs. Arrimo le montre en un coup d'œil. »*

## 2. L'urgence (Hôpital X, onglet Urgence)
- Civières régulières et de débordement (corridor), durée sur civière en orange au-delà de 24 h, en rouge au-delà de 48 h.
- Sur un patient sans demande de lit, cliquez **Demander un lit** : la demande rejoint la file d'admission, liée à sa civière.
- Message clé : *« À l'admission dans un lit, la civière part d'elle-même au nettoyage. »*

## 3. Le Copilote propose, l'humain décide (Hôpital X)
- Recommandations classées Urgent, Important, À faire, chacune avec sa raison.
- Cliquez **Assigner ce lit** sur la recommandation de maternité : le lit est réservé, le patient sort de la file.
- Posez **« Que faire en priorité ? »**, puis **« Combien de civières occupées depuis plus de 24 h ? »**.

## 4. Un transfert en quelques clics (X vers Y), sans dossier chez le receveur
- Hôpital X, onglet **Admissions** : sur le patient P1 qui a besoin d'isolement, **Chercher ailleurs**. Les voisins de X n'ont plus
  de chambre d'isolement libre : Hôpital Y est proposé, avec la raison (distance, temps de route, lits libres, niveau).
- Validez : le lit est bloqué chez Y, qui est avisé.
- Hôpital Y, onglet **Transferts** : **Accepter**, puis **Chambre prête**. Y ne crée aucun dossier : il reçoit la référence,
  les besoins et, au départ de l'ambulance, l'heure d'arrivée prévue avec un compte à rebours (voir le transfert déjà en route).
- Message clé : *« Plus de chaîne d'appels. Le lit ne peut pas être pris deux fois. »*

## 5. Le tableau national (Hôpital X, onglet National)
- Tous les hôpitaux qui partagent leur capacité, du plus proche au plus loin, sans limite de distance.
- Choisissez **Médecine**, cochez **Avec lit libre seulement**, limitez le temps de route à **1 h** ; ouvrez la **Carte** (couleur = niveau d'alerte).
- **Transférer ici** sur un hôpital voisin sans compte : son équipe (simulée) accepte en une minute environ.

- **Disponibilité à côté** : pendant la démo, quand un lit se libère dans un hôpital voisin (la simulation en libère régulièrement),
  un bandeau apparaît en direct chez X, sans recharger la page : « Lit de médecine libre à côté : …, 5 km, environ 6 min », avec **Transférer ici**.
  Au plus une alerte par type d'unité toutes les 10 minutes ; le rayon (10 km par défaut) se règle dans Paramètres.

## 6. Les lits qui ne tournent pas (Hôpital X)
- Onglet **Nettoyage** : l'ordre est dicté par les patients qui attendent (une civière régulière passe en premier quand des patients sont en corridor).
  Sur une tablette, l'écran s'utilise d'une main. **Terminé** : le lit ou la civière redevient libre partout.
- Onglet **NSA** : le taux comparé à la cible de 8 % ; onglet **Lits** : les lits fermés faute de personnel, avec leur motif.

## 7. La preuve (onglet Indicateurs)
- Chaque indicateur affiche sa cible et sa tendance par rapport aux 30 jours précédents ; une pastille seulement si la cible est dépassée.
- Message clé : *« Un pilote de 6 mois mesure ces chiffres avant et après. »*

## 8. Le réseau (compte reseau@demo.arrimo)
- Le Copilote montre le niveau de chaque hôpital et propose les délestages.
- La sécurité, si on vous la demande : onglet **Administration**, la double authentification est exigée avant d'y entrer.

## Questions fréquentes
- **Données de patients ?** Aucune donnée clinique : une référence seulement. Le mode IA du Copilote ne reçoit aucune référence patient.
- **Remplace-t-il nos systèmes ?** Non. Arrimo est une couche de coordination qui se branche sur les systèmes existants (HL7 ADT).
- **Hébergement ?** Au Canada pour un pilote, avec évaluation des facteurs relatifs à la vie privée (Loi 25).
- **Des rôles par métier ?** Oui : coordination, urgence, entretien, administration. La démo utilise un seul compte par hôpital pour aller vite.

## Remettre la démo à zéro
Elle est remise à zéro chaque nuit à 4 h. Le gestionnaire réseau peut aussi le faire depuis Administration, Démonstration, ou sur le serveur :
```
systemctl start arrimo-demo-nuit.service
```
Les comptes et le mot de passe restent les mêmes ; seules les clés des connecteurs changent.
