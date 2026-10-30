# ARRIMO SH — PARAMÈTRES, ADMINISTRATION ET GESTION DES ACCÈS

**Mission Codex : vérifier d'abord les fonctionnalités existantes, identifier les manques et proposer les corrections. Aucun développement ni déploiement pour le moment.**

## 1. Module Paramètres

Organiser les paramètres dans les sections suivantes :

| Section | Fonctionnalités |
|---|---|
| Général | Nom SenseAfriGroup, logo, coordonnées, adresse, fuseau horaire |
| Langues | Français, anglais et autres langues extensibles |
| Pays et devises | Pays ISO, devise automatique, formats régionaux |
| Apparence | Thème clair/sombre, couleurs, préférences d'affichage |
| Utilisateurs | Comptes, invitations, statuts, sessions |
| Rôles et permissions | Création de rôles personnalisés, droits par module et projet |
| Sécurité | Authentification, sessions, journaux, récupération de compte |
| Courriels | SMTP/API, modèles, invitations, notifications |
| Modules | Catalogue, interrupteurs d'activation, dépendances |
| Intégrations | API, connecteurs, webhooks, clés et journaux |
| Projets | Étapes, modèles de tâches, formations, Go Live |
| Documents | Modèles PDF, devis, factures, contrats |
| Notifications | Courriels, alertes internes, préférences |
| Données | Importation, exportation, archivage, conservation |
| Sauvegardes | Historique, vérification, restauration autorisée |
| OG | Activation, mode vocal, langue, autorisations |
| Audit | Historique des actions, connexions, événements sensibles |

Chaque paramètre doit avoir une valeur effective, une validation et des permissions. Pas de boutons décoratifs.

## 2. Langues et localisation

Permettre à chaque utilisateur de choisir sa langue d'interface.

- Français par défaut.
- Anglais.
- Architecture permettant d'ajouter d'autres langues.
- Traduction des menus, formulaires, notifications et messages.
- Fuseau horaire configurable par utilisateur.
- Formats locaux des dates, heures, nombres et montants.

OG doit pouvoir répondre à l'oral et à l'écrit dans la langue configurée, si celle-ci est effectivement prise en charge.

## 3. Administration des employés

Dans **Paramètres → Utilisateurs et accès**, le superadministrateur peut :

- Créer et inviter un employé.
- Modifier son prénom, nom, fonction et rôle.
- Affecter ou retirer des projets.
- Suspendre son compte.
- Réactiver son compte.
- Déconnecter toutes ses sessions actives.
- Révoquer une session précise.
- Renvoyer une invitation.
- Envoyer un lien sécurisé de récupération du compte.
- Archiver un employé.
- Demander la suppression définitive lorsque cela est autorisé.

**Pour l'instant, seul le superadministrateur peut créer les comptes internes de SenseAfriGroup et attribuer les rôles sensibles.**

## 4. Déconnexion à distance

Ajouter les actions :

**Déconnecter cet utilisateur** et **Déconnecter toutes les sessions**.

La révocation doit réellement invalider les sessions côté serveur, y compris sur les autres ordinateurs.

L'employé devra se reconnecter pour accéder à Arrimo SH.

Toute révocation doit être journalisée.

## 5. Assistance à la connexion

Si un employé n'arrive pas à se connecter, le superadministrateur doit pouvoir :

1. Vérifier si son compte est actif.
2. Vérifier si son invitation a expiré.
3. Vérifier si son adresse courriel est correcte.
4. Renvoyer son invitation.
5. Lui envoyer un lien de réinitialisation.
6. Débloquer son compte si la politique de sécurité l'autorise.
7. Vérifier les erreurs de connexion dans les journaux.

Prévoir un bouton **« Aider à se connecter »**.

Ne pas permettre à l'administrateur de consulter le mot de passe d'un employé ni de se connecter à sa place avec son identité.

Pour résoudre un problème d'utilisation, prévoir un mode d'assistance temporaire explicitement autorisé, limité et journalisé, sans usurpation silencieuse.

## 6. Suppression des comptes

Distinguer :

- **Désactiver** : bloque immédiatement l'accès.
- **Archiver** : conserve l'historique des tâches et interventions.
- **Supprimer** : retire les données personnelles admissibles selon les règles de conservation.

Si un développeur quitte SenseAfriGroup, les projets, tickets et tâches qu'il a créés doivent rester traçables.

La suppression ne doit pas effacer les journaux d'audit requis ni les données des projets.

Prévoir confirmation renforcée pour toute suppression définitive.

## 7. Permissions sur les paramètres

Tous les employés ne doivent pas voir les paramètres sensibles.

Par défaut :

- Superadministrateur : administration globale.
- Chef de projet : paramètres autorisés de ses projets.
- Consultant : préférences personnelles et configuration fonctionnelle autorisée.
- Développeur : paramètres techniques explicitement délégués.
- RH : informations du personnel autorisées, sans administration des identités sauf délégation.
- Commercial : préférences et paramètres commerciaux autorisés.

Les restrictions doivent être appliquées dans l'interface, les API et les accès aux données.

OG doit respecter les mêmes permissions.

## 8. Tests à intégrer à l'audit

Vérifier :

- Changement de langue.
- Création et affectation de rôles.
- Révocation des sessions.
- Désactivation et réactivation d'un compte.
- Récupération du mot de passe.
- Expiration d'invitation.
- Blocage des accès non autorisés.
- Conservation de l'historique après archivage.
- Isolation des paramètres entre clients et pays.
- Journalisation des opérations sensibles.

**RAPPORT ATTENDU**

Pour chaque fonctionnalité, indiquer :

- Existe déjà et fonctionne.
- Existe mais nécessite une correction.
- Est absente.
- Nécessite une configuration externe.
- Priorité de mise en œuvre.

Ne rien modifier pendant cet audit. Conserver les configurations et les comptes existants.
