# Reprise de publication OG — 26 octobre 2026

> Historique de diagnostic. Le périmètre actuel est A/B/C et coordination régionale.
> Voir [le rapport de publication actualisé](PUBLICATION_OG_ABC_RESEAU_2026-10-26.md) ; les anciens lots ci-dessous restent conservés.

## Diagnostic vérifié

Le rapport initial `/root/arrimo-og-publication-20261026T195358Z_5ce372fe/rapport.json`
indique un arrêt avant bascule à `og-copie-demo`, après sauvegarde, restauration et
comparaison des contenus réussies. Le lanceur utilisait `prive=True` et ne conservait
ni stdout ni stderr pour cette étape : aucun journal détaillé correspondant n’est
présent dans ce dossier. Il n’est donc pas possible de citer l’exception historique.

Un défaut bloquant certain a été reproduit sur la copie conservée
`arrimo_publication_restore_og_demo_5ce372fe` : l’ancien vérificateur exigeait un lit
occupé avec une référence patient dans chacun des quatre établissements. Les nombres
réels sont A/HX : 2, B/HY : 30, C/HC : 0, D/HPED : 21. La précondition de C échoue
forcément, alors qu’un établissement sans patient admis est un état métier valide.

Le vérificateur contrôle maintenant la réponse correspondant à cet état (absence de
lit actif ou réservation), comparée à PostgreSQL. L’explication d’attribution utilise
un lit existant, même si aucun lit n’est occupé. Les contrôles positifs d’admission
restent exigés dès qu’un témoin existe. Aucune donnée hébergée n’est ajoutée ni
modifiée pour satisfaire un test. Les sept scénarios positifs restent exercés sur
des fixtures neuves, avec une seconde passe A/B/C/D après libération des lits de C.

Un diagnostic structuré root 0600 est désormais conservé pour les erreurs OG : type
d’erreur, lettre du compte et étape. Les entrées privées, jetons, URL SQL et réponses
patients ne sont pas enregistrés. Deux tests vérifient cette protection.

## Résultats réels

- 152 tests locaux réussis, aucun échec, ignoré ou annulé.
- 21 tests des garde-fous de publication réussis.
- Test PostgreSQL OG ciblé réussi : vérificateur complet A/B/C/D avec témoins puis
  avec C sans lit occupé, dans une base neuve `arrimo_og_test_b92dc5131722af`.
- Sur la copie historique : diagnostic métier en lecture seule réussi pour A/B/C/D
  (patient, occupation totale et refus interétablissement). Il appelle le moteur
  avec les droits lus dans la copie ; il ne constitue pas une connexion HTTP réelle.
- Audit du lot : service Démo actif, identité PostgreSQL et santé HTTPS confirmées.
  Rapport : `/root/arrimo-og-publication-20261026T201117Z_c9ed17b0/rapport.json`.
- La liaison SH pointe hors de la cible Démo retenue : aucun appel à cette liaison.

Les preuves exportables sont dans `docs/preuves-og-reprise-20261026/`.
La recette complète a réussi : **154 tests dans les 13 suites**, aucun échec, ignoré
ou annulé ; exercice de retour arrière réussi et sources runtime inchangées.
Elle conserve ses bases et ses résultats sous
`/tmp/arrimo-og-reprise-20261026T200714Z_c1f7186c/rapport.json` et
`/var/tmp/arrimo-og-recette-20261026T200714Z_c1f7186c/`.

## Publication

Aucune bascule n’a été exécutée pendant ces diagnostics. Les sauvegardes initiales
et les lots précédents sont conservés. Aucune migration, réinitialisation, suppression
ou écriture métier n’a été exécutée sur les bases hébergées. Production n’a pas été
interrogée ni modifiée.

Les mots de passe existants A/B/C/D ne sont pas fournis à cette session. Le lanceur
les demande dans le terminal SSH du titulaire ; aucun accès n’est deviné et aucune
session n’est fabriquée. La vérification HTTP et navigateur après publication reste
obligatoire dans le lanceur avant d’annoncer `publication_verifiee`.

Commande finale depuis le terminal SSH root :

```bash
bash /root/arrimo-og-publication-validee-20261026/publier.sh --cibles demo
```

Saisir les mots de passe existants des comptes A/B/C/D et les codes MFA si requis.
Le lanceur rejoue tous les contrôles, sauvegarde et restaure une nouvelle copie,
puis vérifie les quatre comptes via API et navigateur après bascule.

## Tentative finale réellement exécutée

Lot privé : `/root/arrimo-og-publication-validee-20261026`.
Archive SHA-256 : `998bddbc775c07156f3753cba372d8f26d4b18e545b518bbe61ec95a3189332b`.
Les six empreintes du lot, le service Démo, l’identité SQL, la maintenance PostgreSQL
et les 152 tests locaux ont réussi lors de cette tentative.
Arrêt avant sauvegarde et bascule : `Accès manquants : fournir --acces ou lancer dans un terminal interactif`.
Rapport : `/root/arrimo-og-publication-20261026T202354Z_a720e935/rapport.json`.
`publication_verifiee=false`, Démo non publiée, aucun contrôle après publication effectué.
La commande ci-dessus est le relais nécessaire depuis le véritable terminal SSH root.

## Correction du périmètre par le titulaire

Les comptes autorisés pour la reprise sont A/HX, B/HY, C/HC et la coordination
régionale `reseau@demo.arrimo`. Aucun compte D n’est requis ou utilisé. Les constats
A/B/C/D ci-dessus décrivent les essais antérieurs. Le contrôle régional exige le
rôle gestionnaire et compare son périmètre aux établissements actifs réellement
autorisés par le serveur ; les comptes hospitaliers restent strictement isolés.
Le test PostgreSQL corrigé avec ces quatre comptes, y compris C sans lit occupé,
a réussi sur la base neuve `arrimo_og_test_e9648da6e7bc54`.
Les accès fournis sont utilisés uniquement dans un fichier root 0600 hors dépôt.
