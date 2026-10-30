# AJOUT AU CAHIER ULTIME OG — RECHERCHE ET CONSULTATION DES PATIENTS

Implémenter une fonctionnalité **« Rechercher un patient avec OG »**, accessible par texte et par conversation vocale.

## Recherche

Permettre les recherches par :

- Nom et prénom.
- Nom partiel.
- Identifiant patient.
- Numéro de dossier hospitalier autorisé.
- Date de naissance en complément pour départager plusieurs résultats.
- Référence d'admission ou de transfert.

Gérer les fautes de frappe, les accents et les variantes de noms, sans mélanger automatiquement des identités différentes.

## Résultats

Afficher les correspondances autorisées sous forme de cartes sélectionnables.

Si plusieurs patients correspondent, demander à l'utilisateur de sélectionner le bon dossier.

Ne jamais supposer qu'un patient est identifié avec certitude sur la seule base de son nom.

## Fiche patient

Après sélection, permettre à OG d'ouvrir une fiche opérationnelle regroupant les données réellement disponibles dans Arrimo :

1. Identité et référence.
2. Établissement et unité.
3. Chambre, lit ou civière.
4. Statut actuel.
5. Admission et mouvements.
6. Transferts et étapes.
7. Alertes et demandes liées.
8. Historique horodaté.
9. Actions administratives autorisées.

Ajouter un bouton **« Voir la fiche patient »**, qui ouvre le dossier existant dans Arrimo.

Ne pas inventer de données médicales ou d'historique absents du système.

## Commandes vocales

Exemples : « OG, cherche Jean Dupont. » · « OG, affiche son dossier. » · « Dans quelle chambre est-il ? » · « Depuis quand est-il admis ? » · « Est-ce qu'il a été transféré ? » · « Montre-moi son historique de mouvements. »

OG conserve le contexte du patient sélectionné pendant la session autorisée et vérifie à nouveau les droits avant chaque consultation.

## Sécurité

- Contrôler les permissions côté serveur.
- Limiter les résultats à l'établissement ou au réseau explicitement autorisé.
- Ne jamais exposer les patients d'un autre hôpital sans droit d'accès.
- Masquer les informations sensibles non nécessaires dans les listes.
- Journaliser les consultations selon les politiques hospitalières.
- Éviter de prononcer à haute voix des informations sensibles sans confirmation lorsque l'environnement peut être entendu par d'autres.
- Ne jamais présenter une correspondance approximative comme une identification certaine.

## Tests

Tester dans les hôpitaux fictifs A, B et C : recherche exacte ; recherche partielle ; plusieurs patients portant le même nom ; identifiants proches ; recherche vocale ; consultation de fiche ; suivi des transferts ; restrictions interhospitalières ; accès refusé ; données mises à jour.

Intégrer cette fonctionnalité au moteur OG existant et au provisionnement des futurs établissements depuis SH.
