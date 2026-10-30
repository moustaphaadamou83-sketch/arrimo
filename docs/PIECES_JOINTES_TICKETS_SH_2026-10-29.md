# Pièces jointes aux tickets SH — 29 octobre 2026

Les tickets internes et le portail client acceptent des PDF, images PNG/JPEG, documents DOCX/XLSX, CSV et TXT jusqu’à 10 Mo. Le serveur valide l’extension et la signature du contenu, chiffre chaque fichier en AES-256-GCM dans le stockage SH existant et ne conserve en base que les métadonnées, l’empreinte et la référence chiffrée.

Les établissements clients peuvent joindre un fichier à la création ou à un ticket ouvert. Ils ne peuvent télécharger que les fichiers d’un ticket visible rattaché à leur établissement. Les employés SH disposent du dépôt et du téléchargement selon leurs permissions documentaires. Les téléchargements sont authentifiés, journalisés, servis avec `nosniff` et sans interprétation active. Les fichiers des tickets fermés restent consultables; le dépôt y est refusé. La limite d’upload HTTP est de 15 Mo pour transporter l’encodage base64 d’un fichier de 10 Mo.

La migration 22 ajoute un index de consultation par ticket. Elle ne réécrit pas les données métier existantes. Le stockage réutilise `SH_DOCUMENTS_DIR` et la clé de chiffrement déjà configurée pour les documents SH.

## Vérification

- 10/10 tests du portail : upload depuis le client, téléchargement identique après déchiffrement, invalidation d’un faux PNG, masquage croisé entre deux établissements, interface mobile FR/EN.
- 8/8 SLA, 6/6 cycle projet, 8/8 notifications, 27/27 accès et 8/8 activation/parité : 67 tests intégrés réussis au total sur bases fictives neuves.
- `node --check` sur les nouveaux points d’entrée et `git diff --check` réussis.
- Les preuves sont dans [preuves-pièces-jointes](preuves-pieces-jointes-sh-20261029/).

## Publication

Candidate `pieces-jointes-20261029t1900` publiée sur principal, Démo ABC, recette, validation, SH et SH-validation. Les 6 services sont sains après bascule; les 26 fichiers hospitaliers et 14 fichiers SH servis ont leurs empreintes vérifiées. La préparation a restauré des snapshots PostgreSQL et rejoué les migrations sur clones isolés. Les configurations sont préservées et les migrations restent additives. Les bases de validation ne contiennent que des données fictives.

## Portée restante du module support

La file des notifications courriel est maintenant publiée; l’intégration applicative est décrite dans [Notifications courriel du support](COURRIELS_SUPPORT_SH_2026-10-29.md). Une réception SMTP réelle reste à vérifier. La recherche/résumé des tickets par OG SH et les finitions du Kanban (notamment une colonne « Assigné » explicite) restent à faire. Les calendriers ouvrés et les rapports avancés SLA restent également hors de cette évolution.
