# Arrimo : registre des renseignements et modèle d'évaluation (Loi 25)

**Projet de travail, ce n'est pas un avis juridique. À faire relire par un avocat avant tout usage.** Aujourd'hui, Arrimo ne traite que des données fictives.

## À trancher en premier avec l'avocat
1. **Rôle d'Arrimo :** prestataire de l'établissement, responsable du traitement, ou partage selon les fonctions ?
2. **Lois applicables :** Loi 25, loi sur l'accès pour les organismes publics, et surtout la **Loi sur les renseignements de santé et de services sociaux**, à vérifier en priorité pour un réseau de santé.
3. **Référence patient :** même sans diagnostic, elle identifie indirectement une personne si l'hôpital détient la correspondance. La traiter comme un renseignement personnel, sauf avis contraire.
4. **Résidents CHSLD :** nom, date de naissance et coordonnées restent aujourd'hui réservés aux environnements fictifs. Leur usage réel exige une décision et cette évaluation.

## 1. Registre des renseignements (relevé dans le code, 6 novembre 2026)
| Personnes | Renseignements | Finalité | Où | Durée de conservation |
|---|---|---|---|---|
| Personnel des établissements | Nom, courriel, rôle, mot de passe haché, double authentification, connexions | Accès et traçabilité | `utilisateurs`, `sessions`, `journal_admin` | **À définir** |
| Patients | Référence au format du pays, lit, service, statuts, horaires ; aucun diagnostic | Coordination des lits et transferts | `lits`, `civieres`, `transferts`, `journal` | **À définir** |
| Patients fictifs (démo et recette) | Prénom, nom, date de naissance, passages | Démonstration seulement | `patients`, `patient_passages` | Sans objet |
| Résidents CHSLD (fictifs) | Prénom, nom, date de naissance, téléphone, courriel, chambre, mouvements | Coordination du parcours | `residents`, `resident_contacts`, `resident_mouvements` | **À définir** |
| Proches (fictifs) | Courriel, lien avec le résident, messages | Portail des proches | `proches_acces`, `messages_proches` | **À définir** |
| Contacts clients | Nom, courriel, téléphone professionnels | Suivi commercial et implantation | Base de SH | **À définir** |

**Journaux immuables :** ils ne peuvent pas être effacés. Il faut donc concilier cette règle avec les durées de conservation et le droit de rectification ; c'est à trancher avec l'avocat.

## 2. Services externes
| Service | Ce qu'il reçoit | État |
|---|---|---|
| Hébergeur | Toutes les données | Production : hébergeur dans le pays à choisir |
| Stockage des sauvegardes | Copies chiffrées | Actuellement hors Canada, données fictives ; bucket canadien à prévoir |
| Courriel | Adresses et avis | Prestataire à choisir ; aucun renseignement de patient |
| Mode IA d'OG, facultatif | Questions, jamais de référence patient d'après le code | Hors Canada probable : évaluation requise avant activation |
| Météo | Position de l'établissement | Pas de renseignement personnel |

## 3. Modèle d'évaluation des facteurs relatifs à la vie privée
À remplir pour chaque établissement, avant chaque projet ou changement important.

1. **Projet :** établissement, modules activés, responsables.
2. **Renseignements :** lesquels, de qui, sensibilité, volume.
3. **Nécessité :** pourquoi chacun est requis ; ce qui a été retiré.
4. **Fondement et consentement :** à compléter avec l'avocat.
5. **Accès :** rôles, cloisonnement entre établissements, double authentification.
6. **Hébergement et transferts :** pays, prestataires, contrats, évaluation en cas de sortie du Québec.
7. **Sécurité :** chiffrement, journaux, sauvegardes, résultat du test d'intrusion.
8. **Durée et destruction :** délais et procédure.
9. **Droits des personnes :** accès, rectification, plainte ; qui répond.
10. **Risques :** probabilité, gravité, mesures, risque résiduel.
11. **Décision :** signature du responsable de la protection des renseignements personnels.

## 4. Manques à combler avant de vrais renseignements
- Durées de conservation et purge automatique.
- Responsable désigné et politique publique relue.
- Contrats avec les prestataires.
- Procédure pour les demandes d'accès et de rectification.
- Registre des incidents (voir `docs/PLAN_INCIDENT_ET_REPRISE.md`).
