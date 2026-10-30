# Publication de l’écosystème et activation d’un nouvel hôpital — 29 octobre 2026

## Publications réellement effectuées

La candidate applicative testée sous l’empreinte de sources `f56eef3abe3aa12337666ab6142a108daeac55a779ca38f96b4b52af65f79f36` a été publiée sur les services existants. Les évolutions ultérieures du dépôt concernent les tests et outils de contrôle, pas le code applicatif de cette candidate.

| Service | Résultat |
|---|---|
| SH | Déjà à jour, migrations 4–19 ; sources SH comparées à la candidate |
| Application principale | Release `ecosysteme-20261029t1700`, santé HTTPS et fichiers publics vérifiés |
| Démo ABC | Même release, contrôles de fichiers, scénario et comptes vérifiés |
| Recette hospitalière | Même release, migration du schéma ancien et bascule vers une release immuable |
| Validation hospitalière | Même release, schéma ancien migré après restauration et contrôles de conservation |
| SH validation | Même release de sources, migrations jusqu’à 19, santé HTTPS sous `/sh-validation/` et fichiers vérifiés |

Le manifeste applicatif commun des quatre services hospitaliers est `69e72c3dc0780cca176b780e5dce9098f63df1825f6ec33b29609f5b08908403`. Le nouveau fichier public `/version.json` permet d’en vérifier l’identifiant. Le contrôle compare aussi les fichiers locaux de la release et les fichiers JavaScript servis ; une santé verte seule n’est pas considérée comme une preuve de cohérence.

Les fichiers d’environnement ont gardé leurs empreintes. L’unité de recette utilise désormais un complément systemd pointant vers `current` et le runtime Node 24 isolé ; son installation ancienne reste conservée. Aucune remise à zéro ni réaffectation automatique des hôpitaux n’a été exécutée. Chaque cible modifiée dispose d’une sauvegarde restaurée de préparation, d’une sauvegarde fraîche et de son ancienne release. Les sauvegardes et configurations privées restent dans `.local/ecosysteme-20261029t1700/`.

## Écarts corrigés pendant la livraison

La recette nécessitait les migrations hospitalières historiques avant le schéma courant : les déclarations `CREATE TABLE IF NOT EXISTS` seules n’ajoutent pas les colonnes des anciennes tables, notamment `civieres.unite_id`. Les migrations sont maintenant appliquées dans cet ordre dans le lanceur de livraison, puis rejouées sur les copies. Les anciennes colonnes sont comparées sous verrou et dans la transaction avant validation ; les anciennes traductions et les catalogues existants ne sont pas réécrits.

Les dépendances historiques de recette différaient. La nouvelle release utilise une copie des dépendances compatibles déjà disponibles localement, sans installation réseau ni modification des anciennes dépendances. Le rôle sans connexion de SH validation a été préparé. La sauvegarde hospitalière de validation utilise le propriétaire PostgreSQL pour inclure `deployment_write_marker`, sans accorder de nouveaux accès à cette table au compte applicatif.

Une première bascule ABC est revenue automatiquement à l’ancienne release. Le recalage normal des horloges de démonstration avait avancé les deux dates du transfert témoin de 1 560 secondes ; les autres champs étaient identiques. Ce diagnostic a été vérifié. La reprise utilise une connexion normale de B avant la sauvegarde fraîche et contrôle de nouveau le scénario intégral ; elle a réussi. Aucun état patient n’a été forcé pour satisfaire le contrôle.

Le vérificateur navigateur historique supposait que tous les libellés provenaient de `onglets.*`. Le support utilise `support.titre`. Le vérificateur résout maintenant la vraie clé `data-i18n`, exige une traduction et compare le libellé ; la recette publique FR/EN a ensuite réussi.

## Activation fictive et parité avec B

Le test obligatoire est enregistré dans `tests/sh-activation-parite.test.cjs` et ajouté à la sélection par défaut du lanceur `scripts/recette-sh-lot1.cjs`. Il exige une base fictive neuve du cluster isolé. Le B de référence est reconstruit par la même fixture ABC ; les versions applicatives utilisées pour la bascule sont l’ancienne release B immuable et la candidate. Aucun hôpital fictif de ce test n’a été créé dans un service public.

Le parcours crée depuis SH `PARITE-NEW`, sa structure et trois comptes invités, valide la formation et les vérifications par les API SH, puis active l’établissement. Les invitations sont consommées et les comptes coordination, entretien et administration se connectent par le vrai endpoint de connexion. Une seconde connexion est effectuée dans Chromium avec le formulaire normal du nouvel hôpital.

Les contrôles couvrent les mêmes modules et fichiers que B, les admissions, lits et civières, le nettoyage avec le compte entretien, un transfert accepté et reçu par B, OG en français et en anglais, ainsi que les refus de lecture et d’écriture interétablissements. Le test bascule réellement entre les deux versions applicatives sur les mêmes données : les configurations de B et du nouvel hôpital ainsi que leurs sessions sont préservées.

**Le dernier passage renforcé a réussi ses huit tests**, dont les deux langues dans le navigateur du nouvel hôpital et de B : aucun échec, annulation ni test ignoré. Le [rapport intégré de parité](preuves-ecosysteme-parite-20261029/recette-parite.json), le [journal](preuves-ecosysteme-parite-20261029/parite.log) et les quatre captures sont archivés. La connexion au nouvel hôpital et son activation ont réellement été exercées ; ce résultat concerne uniquement la fixture isolée.

## Contrôles reproductibles et limites

Le vérificateur `scripts/verifier-coherence-applicative.cjs` refuse les fichiers ou assets divergents, un manifeste public différent, une santé dégradée ou une release hors périmètre. Ses cinq tests passent. Il est intégré aux tests locaux pour les prochaines évolutions. Le dernier passage local compte **217 réussites, aucun échec, annulation ni test ignoré**, avec la même empreinte de sources que la recette de parité finale. La recette intégrée antérieure de 188 tests concernait la candidate applicative publiée ; elle n’est pas présentée comme une nouvelle exécution des 188 tests après ajout des outils.

```bash
node scripts/verifier-coherence-applicative.cjs docs/preuves-ecosysteme-parite-20261029/manifest-runtime.json
node scripts/recette-sh-lot1.cjs --configuration=.local/recette-isolee-20261029.env parite
```

Pour une autre machine, fournir `SH_PARITE_BASELINE_RELEASE` pointant vers une release B antérieure et immuable. Le test de bascule refuse de considérer deux copies identiques comme deux versions différentes.

Le portail support est livré dans les applications hospitalières et SH, mais aucune liaison hospitalière n’existe dans la base SH actuelle et les clés de raccordement ne sont pas configurées. Les demandes ne sont donc pas activées sur les services publics. Aucune liaison vers une autre base portant les mêmes codes d’hôpitaux n’a été inventée ; la Démo ABC reste distincte de la cible démonstration pilotée par SH.

Les validations physiques du microphone, de la voix et de la délivrabilité SMTP restent à faire. Les pièces jointes, SLA contractuels, escalades, recherche de tickets SH par OG, finances avancées, détails projets/RH et paramètres restants du cahier ne sont pas déclarés terminés. Aucun nouveau service pilote réel n’a été créé par cette publication.

Preuves : [publication](preuves-ecosysteme-parite-20261029/publication.json), [cohérence des quatre applications](preuves-ecosysteme-parite-20261029/coherence-applicative.json), [navigateur public ABC](preuves-ecosysteme-parite-20261029/navigateur-public.json), [OG public bilingue](preuves-ecosysteme-parite-20261029/og-public.json). Les outils exacts de livraison sont archivés dans le même dossier pour inspection ; ils restent épinglés à cette candidate et ne dispensent pas de valider une candidate future.

Le [résumé consolidé](preuves-ecosysteme-parite-20261029/resume.json) et les empreintes des preuves sont archivés avec les rapports. Les autres écarts du cahier restent suivis dans la matrice générale.
