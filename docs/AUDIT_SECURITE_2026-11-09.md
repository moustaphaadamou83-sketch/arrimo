# Audit de sécurité des nouveautés (9 novembre 2026)

Périmètre : tout ce qui a été publié depuis l'audit du 5 et 6 novembre (`docs/AUDIT_SECURITE_2026-11-05.md`).
Coordination Famille et portail des proches, notifications, nettoyage sous précautions, évaluations fictives, registre et import, transferts entre hôpitaux, OG Famille, dépôt des demandes du site dans SH.

## Méthode
- Lecture des contrôles d'accès de chaque route ajoutée.
- Test automatique d'attaques (`tests/chsld.test.cjs`, « audit de sécurité »), étendu le 9 nov. à **toutes les routes de tous les modules** :
  - sans session : seules les routes publiques connues répondent ;
  - avec le rôle entretien : tout est refusé hors de sa liste fermée ;
  - depuis un autre CHSLD et depuis un hôpital : aucune lecture ni modification des ressources du CHSLD des Érables, y compris les nouvelles (demandes, messages, confirmations, réglages, journal de vie, registre, précautions, nettoyage, visites) ;
  - injections SQL et XSS, en-têtes, journal immuable.
- Contrôles serveur : ports ouverts, SSH, pare-feu, fail2ban, en-têtes HTTP, droits des fichiers.
- Dépendances : `npm audit` (production) : aucune vulnérabilité connue.

## Constats et corrections

| # | Constat | Gravité | Correction | Preuve |
|---|---|---|---|---|
| 1 | Le test d'attaques ne parcourait que deux fichiers de routes : les routes des nouveaux modules n'étaient pas attaquées automatiquement | Moyenne (angle mort des tests) | Le test lit toutes les routes de `src/` et attaque les nouvelles ressources | Suite CHSLD verte |
| 2 | Un proche connaissant l'adresse de notification d'un autre proche pouvait la rattacher à son accès et le priver de ses notifications | Faible (l'adresse est secrète ; aucune donnée exposée) | Une adresse déjà liée à un autre accès n'est jamais réattribuée | Test : 409, adresse inchangée |
| 3 | Le site public n'imposait pas le HTTPS aux navigateurs (pas de HSTS) | Faible | En-tête `Strict-Transport-Security` ajouté ; copie de l'ancienne configuration gardée | `curl -I` |

## Vérifié sans défaut
- Chaque route du portail ne lit que le résident et le proche de la session ; un proche ne touche jamais aux demandes, confirmations ni visites d'un autre (test).
- La révocation coupe les sessions, la file de notifications et les adresses de poussée (test).
- Notifications sans contenu : ni nom, ni statut, ni établissement ; adresses limitées aux services de Google, Apple, Mozilla et Microsoft.
- OG Famille : aucune information de santé, aucune donnée hors des autorisations du proche, rien d'inventé (60 questions testées).
- OG du personnel : la coordination famille est refusée au rôle entretien.
- Évaluations fictives : refusées hors démonstration, activées établissement par établissement, invisibles pour l'entretien et OG (test).
- Dépôt des demandes du site : connexion locale du serveur du site seulement, avec la clé ; aucune lecture possible (test).
- Serveur : seuls 22, 80 et 443 ouverts ; SSH par clé seulement ; pare-feu et fail2ban actifs ; dossier des outils en accès root seul.

## Points restants (non corrigés aujourd'hui)
- **Site public :** sa politique de sécurité autorise encore le script en ligne. À retirer quand le formulaire réel sera activé, car le script sera alors réécrit.
- **Connexion au portail :** un même courriel lié à plusieurs résidents rend la vérification un peu plus longue ; un attaquant pourrait en déduire qu'un courriel suit plusieurs résidents. Risque faible.
- **Version incomplète :** le dossier `/opt/arrimo-demo/releases/famille-20261108t2119` ne contient ni secret ni configuration. À retirer avec l'accord de Moustafa.
- **Avant de vraies données :** hébergement au Canada, évaluation Loi 25, test d'intrusion indépendant. Arrimo n'est pas déclaré conforme.
