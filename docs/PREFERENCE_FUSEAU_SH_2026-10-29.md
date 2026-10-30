# Préférence individuelle de fuseau horaire SH — 29 octobre 2026

La migration 25 ajoute un fuseau IANA par utilisateur SH. La page « Mon compte » permet de le modifier; les heures affichées utilisent cette préférence. Les échéances SLA continuent d’utiliser le fuseau contractuel de l’établissement. Le serveur valide le fuseau dans `pg_timezone_names`, journalise la modification et ne change que le compte connecté.

## Validation

- Accès/API : 28 tests réussis, dont persistance, isolation entre deux comptes et rejet d’un fuseau invalide.
- Interface navigateur : parcours complet réussi; enregistrement confirmé par réponse HTTP 200 et lecture PostgreSQL.
- Parité : 8/8 réussis, connexions réelles à l’établissement fictif et contrôles d’interface OG en français et en anglais.
- Empreinte des sources : `a8cefe3de8e536a577f2058a78401266864d83eec028673d91b3e365d8ac2a1d`.
- Publication : release `preferences-fuseau-20261029t2136` diffusée sur `principal`, `demo`, `recette`, `validation`, `sh` et `sh-validation`. Santé applicative et base `ok` sur les six services; configurations préservées; 26 ressources web vérifiées pour les services hospitaliers et 14 pour SH.

Rapport détaillé : `.local/preferences-fuseau-release-20261029t2136/rapport.json`.

Cette livraison clôt le réglage individuel du fuseau. Elle ne clôt pas à elle seule les six lots du cahier des charges.
