# Déblocage OG du 26 octobre 2026

Lot corrigé : `/root/arrimo-og-publication-corrigee-20261026`.
Le lot initial est conservé. L’archive candidate est inchangée (SHA-256 : `2b3e52503cb085012dc31d1f22f5e43527858813db6d877b58efeb25a2e57cb7`).

Cause exacte : `lire_env()` appliquait `shlex.split()` puis refusait plus d’un mot. Après `service-demo`, le fichier systemd `/opt/arrimo-demo/shared/routeur-osrm.env`, ligne 3, contient `ARRIMO_ROUTEUR_NOM` avec six mots non cités, valides pour EnvironmentFile. La lecture des fichiers supplémentaires systemd accepte désormais les espaces intérieurs littéraux ; les évaluations et formes complexes restent refusées. Les erreurs indiquent fichier, ligne et clé sans exposer la valeur. La même lecture est utilisée pour le retour arrière.

Second défaut découvert à l’exécution : `runuser` ne figure pas dans le PATH volontairement restreint. Ses trois appels utilisent désormais `/usr/sbin/runuser`.

Inventaire en lecture seule :

| Cible | Racine | Service | Port | Base locale | Marqueurs |
| --- | --- | --- | --- | --- | --- |
| Démo séparée | /opt/arrimo-demo | arrimo-public-demo | 3016 | arrimo_demo_trio_public_f6db_20261023 | demo / 1 |
| Principal | /opt/arrimo | arrimo | 3010 | arrimo | demo / 1 |
| Console SH | /opt/arrimo-sh | non interrogé | 3012 | arrimo_sh | sh |

Seule Démo séparée a fait l’objet d’un audit complet. Le principal n’a pas été publié ni interrogé en SQL. La liaison Démo SH pointe vers le principal ; elle a été exclue des appels pour cette exécution limitée à Démo séparée.

Vérifications réelles : 19 tests des garde-fous réussis ; syntaxe Bash valide ; empreintes du lot valides ; audit complet Démo réussi ; identité SQL, service actif, santé HTTPS et maintenance PostgreSQL réussis ; 152 tests locaux réussis, aucun échec, ignoré ou annulé.

Audit : `/root/arrimo-og-publication-20261026T194503Z_ce9245af/rapport.json`.
Dernière tentative : `/root/arrimo-og-publication-20261026T194719Z_7922bce3/rapport.json`.
Arrêt : `Accès manquants : fournir --acces ou lancer dans un terminal interactif`.
Aucune sauvegarde, recette intégrée ou bascule effectuée. Aucun succès de publication annoncé.

Depuis le véritable terminal SSH root :

```bash
bash /root/arrimo-og-publication-corrigee-20261026/publier.sh --cibles demo
```

Saisir le mot de passe existant commun des comptes Démo A/B/C/D et les éventuels codes MFA. Si les comptes ont des mots de passe différents, utiliser le fichier privé `--acces` au format documenté dans `PUBLICATION_OG_SSH_2026-10-26.md`. Aucun mot de passe n’est deviné ou modifié.

Le lanceur conserve tous les contrôles, sauvegardes, restaurations isolées, tests, bascule et rollback du lot initial. Garder la session ouverte. Le seul succès final attendu est `publication_verifiee`, avec `environnements.demo.statut=publie_et_verifie` dans le nouveau rapport affiché au lancement.
