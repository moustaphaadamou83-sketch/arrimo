# Arrimo : dossier pour le test d'intrusion

**À remettre au prestataire indépendant retenu, avec un accès distinct.** Les autotests de l'audit ne remplacent pas ce test.

## Périmètre proposé
| Cible | Inclus |
|---|---|
| Application Arrimo (recette dédiée) | API, interface, rôles, cloisonnement entre établissements, OG, portail des proches |
| Console SH (instance dédiée) | Authentification et double authentification, rôles, documents, lien avec les environnements |
| Serveur dédié au test | Ports, SSH, Nginx, TLS, droits système |
| Exclus | Autres sites du serveur actuel, production, déni de service, ingénierie sociale, sans accord écrit |

Le test ne doit pas viser le serveur actuel : il héberge d'autres sites. Il faut une instance dédiée, sans vraies données.

## Comptes à fournir
Un compte par rôle dans deux établissements et deux pays fictifs : coordination, urgence, entretien, administration d'établissement, gestionnaire réseau, CHSLD, proche ; rôles SH. Mots de passe remis par un canal séparé, jamais dans ce dossier.

## Points à éprouver en priorité
1. Lecture ou action sur un autre établissement (par identifiant, par OG, par export).
2. Élévation de rôle, y compris dans SH et par les clés de service.
3. Contournement de la double authentification et réutilisation d'un code.
4. Identité de patient ou de résident hors des environnements fictifs.
5. Injection et script malveillant par les champs libres, CSV et Excel importés, questions à OG.
6. Manipulation d'OG pour lui faire exécuter une action ou révéler des données.
7. Lien SH ↔ environnements : clé, rejeu, redirection.
8. Courses : même lit attribué deux fois, double validation.
9. Fichiers joints de SH : téléversement, accès, chiffrement.
10. Altération des journaux immuables.

## Déjà testé en interne (à recontrôler sans s'y fier)
Voir `docs/AUDIT_SECURITE_2026-11-05.md`.

## Non couvert par l'audit interne
Fichiers joints et fonctions vocales de bout en bout, certains rôles SH, résistance à la charge.

## Attendus
Rapport avec gravité, preuve et correction proposée ; contre-test après correction ; résumé remis aux établissements.

**À décider :** prestataire, budget, date, accord écrit d'autorisation.
