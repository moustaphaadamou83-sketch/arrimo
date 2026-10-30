# OG — livraison du 30 octobre 2026 (cahiers OG du 29-30 octobre)

Référence : `docs/sources-cahier-20261030/`, audit `docs/AUDIT_OG_2026-10-30.md`. État indiqué selon le §22 du cahier.

| Fonction | Implémentée | API réelle | Tests automatiques | Essai manuel | Limites |
|---|---|---|---|---|---|
| Recherche et fiche patient par OG (travail de Codex intégré) | oui | oui | oui (unitaires, navigateur, refus production et validation) | à faire en démo | Fiches **fictives**, démo et recette seulement (décision du 30 oct.) ; hors de ces environnements, OG répond sans erreur et sans chercher |
| Brouillon, doublons et création de patient (écrit, dictée, **document**) | oui | oui | oui | à faire | — |
| **Lecture de documents fictifs (OCR local Tesseract 5.3.4, FR/EN)** | oui | oui | oui (vraie lecture d'une carte fictive, texte piégé ignoré, aucun fichier conservé, refus en production et en validation) | à faire | Signature PNG/JPEG et taille vérifiées ; **pas d'antivirus installé** (fichier jamais conservé ni exécuté) ; démo et recette seulement |
| Deux boutons vocaux visibles (dictée, conversation continue), lecture audio — **dans tous les environnements et établissements** (démo A/B/C, pilote, déploiement, production ; décision du 30 oct.) | oui | navigateur | oui (moteurs simulés) | **à faire par Moustafa** (micro et haut-parleur réels) | Réponse sensible jamais lue automatiquement. Hors démo, le consentement interdit de dicter des renseignements de santé réels tant que le fournisseur vocal du navigateur n'est pas approuvé (cahier §16, Loi 25) |
| Personnalisation par établissement (nom, avatar, voix, langue, accueil), aperçu, « Tester la voix », réinitialisation | oui | oui | oui (persistance, isolation A/B, refus hors administrateur) | à faire | Le genre des voix dépend des voix installées dans le navigateur |
| Configuration et fonctions par établissement, bornées par la licence SH | oui | oui | oui | — | Démo et recette : fonctions démontrables ouvertes par défaut, documents exclus ; ailleurs, sans licence : texte et vocal |
| Licence OG dans SH et provisionnement à l'établissement relié | oui | oui | oui (unitaires) | à faire | Licence décrite dans les paramètres JSON du module OG |
| Moteur d'actions supervisées : niveaux 0 à 3, niveau 4 refusé côté serveur, idempotence, confirmation explicite, journal | oui | oui | oui (bout en bout) | à faire | Quatre outils : demande d'admission (niveau 3), demande de transfert (niveau 3, lits confirmés, proximité d'abord, acceptation par la destination), **relance d'un transfert en attente** (niveau 2, anti-répétition de 5 min, aucune donnée patient dans la notification), ticket de support (niveau 2) |
| Raccourcis selon les fonctions actives (§17) | oui | oui | oui | à faire | — |
| Guide d'utilisation par OG (§13) : étapes et bouton « Ouvrir cet écran », modules désactivés respectés | oui | oui | oui | à faire | Sujets : transferts, lits bloqués, statut de lit, nettoyage, admissions, urgence, rapports |
| Provisionnement depuis SH vérifié de bout en bout (§20.6) : licence transmise au pilote isolé, recette voisine intacte, personnalisation conservée lors d'une nouvelle licence | oui | oui | oui | — | Sans décision OG dans SH, rien n'est transmis (fonctionnement par défaut) |
| Correction : suivi d'une référence explicite et continuité « dans quel service est-il ? » | oui | oui | oui | — | — |

## Non fait ou bloqué
- **Demande de nettoyage par OG** : il n'existe pas de « demande d'entretien » distincte dans Arrimo. La mise en nettoyage suit la libération du lit, et seule l'équipe d'entretien confirme la fin (§10). OG explique et ouvre l'écran Nettoyage, sans créer d'action parallèle.
- **Rapports** : OG présente les alertes et ouvre l'écran Indicateurs, dont les chiffres sont calculés et reproductibles. OG ne génère pas de PDF lui-même. La relance d'un transfert est un outil OG depuis le 30 octobre.
- **Antivirus des téléversements** : non installé. Le document est contrôlé (signature, taille), lu localement puis supprimé immédiatement.
- **Essais vocaux réels** : à faire par Moustafa.

## Publication

Release `og-sh-20261030t0656`, publiée le 30 octobre 2026 sur principal, démo A/B/C, recette, validation, SH et SH-validation. Recette `.local/preuves-sh-lot1/20261030062935_535ed2/` : 16 suites, 218 tests, aucun échec. Santé `ok`, ressources vérifiées, configurations préservées, scénario A/B/C intact.

Mise à jour publiée : release `collaborateurs-20261030t1204` (relance OG, collaborateurs), recette `20261030114008_b6deb9` : 16 suites, 220 tests, aucun échec.
