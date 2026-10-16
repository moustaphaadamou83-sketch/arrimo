# Arrimo · Guide de démonstration (10 minutes)

Deux hôpitaux fictifs : **Hôpital X**, sous pression, et **Hôpital Y**, qui a de la place.
Avant chaque présentation, remettez la démo à zéro (voir la fin du guide) : les temps d’attente repartent de la situation de départ.

Ouvrez deux fenêtres côte à côte : à gauche **coordo.x@demo.arrimo**, à droite **coordo.y@demo.arrimo**.

## 1. Le problème, en 30 secondes (Hôpital X, onglet Copilote)
- Le bandeau rouge résume la situation : pression au-dessus de 100 %, 6 patients en attente d’un lit dont 2 depuis plus de 4 heures, un seul lit libre.
- Message clé : *« Aujourd’hui, l’équipe le découvre par téléphone et sur des tableaux blancs. Arrimo le montre en un coup d’œil. »*

## 2. Le Copilote propose, l’humain décide (Hôpital X)
- Montrez les recommandations classées : Urgent, Important, À faire. Chacune explique pourquoi.
- Cliquez **« Assigner ce lit »** sur la recommandation de maternité : le lit est réservé, le patient sort de la file.
- Posez la question **« Que faire en priorité ? »**, puis **« Où en sont les NSA ? »**.
- Message clé : *« Le Copilote n’agit jamais seul, et chaque action est journalisée. »*

## 3. Un transfert en quelques clics (X vers Y)
- Hôpital X, onglet **Admissions** : sur le patient P1 qui a besoin d’isolement, cliquez **Chercher ailleurs**. Hôpital Y est proposé avec la raison (lits libres, lits prévus, distance), et seuls les lits qui respectent l’isolement sont retenus.
- Validez : le lit est bloqué chez Y, qui reçoit une notification.
- Hôpital Y, onglet **Transferts** : cliquez **Accepter**. Hôpital X voit le changement et organise le transport.
- Message clé : *« Plus de chaîne d’appels. Le lit ne peut pas être pris deux fois : la deuxième réservation est refusée. »*

## 4. Les lits qui ne tournent pas
- Hôpital X, onglet **Nettoyage** (ou connectez-vous en **entretien.x@demo.arrimo** sur une tablette) : l’ordre est dicté par les patients qui attendent, pas par l’ordre d’arrivée. Cliquez **Commencer**, puis **Terminé** : le lit redevient libre partout.
- Onglet **NSA** : le taux est comparé à la cible de 8 %, avec les jours d’attente et l’orientation (CHSLD, ressource intermédiaire…).
- Onglet **Lits** : les lits fermés faute de personnel apparaissent avec leur motif.

## 5. La preuve (onglet Indicateurs)
- Délai de réponse aux transferts, attente avant lit assigné, durée de nettoyage (plus longue chez X que chez Y), taux de refus et motifs, export CSV.
- Message clé : *« Un pilote de 6 mois mesure ces chiffres avant et après. »*

## 6. Le réseau (compte reseau@demo.arrimo)
- Le Copilote montre le niveau de chaque hôpital et propose les délestages de X vers Y.
- Mentionnez la connexion aux systèmes des hôpitaux (HL7 ADT) : les admissions et congés arrivent sans double saisie.

## 7. La sécurité (si on vous la demande)
- Compte **reseau@demo.arrimo**, onglet **Administration** : la double authentification est exigée avant d’y entrer. Montrez l’activation par code QR, la création d’un compte avec mot de passe temporaire et le journal d’administration.

## Questions fréquentes
- **Données de patients ?** Aucune donnée clinique : une référence seulement. Le mode IA du Copilote ne reçoit aucune référence patient.
- **Remplace-t-il nos systèmes ?** Non. Arrimo est une couche de coordination qui se branche sur les systèmes existants.
- **Hébergement ?** Au Canada pour un pilote, avec évaluation des facteurs relatifs à la vie privée (Loi 25).

## Remettre la démo à zéro
Sur le serveur :
```
sudo -u arrimo bash -c 'set -a; . /opt/arrimo/.env; set +a; cd /opt/arrimo && npm run -s demo:reset' > /opt/arrimo/acces-demo.txt
```
Les comptes restent les mêmes ; seules les clés des connecteurs changent.
