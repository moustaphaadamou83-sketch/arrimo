# Arrimo · Test de charge

Mesuré le 2026-10-16 : 50 utilisateurs simultanés pendant 60 s sur la démo Hôpital X / Hôpital Y,
serveur dans un processus séparé, base PostgreSQL locale. Chaque utilisateur change d’écran toutes les 1 à 3 secondes
(un vrai utilisateur rafraîchit toutes les 30 secondes). Au même instant, tous les utilisateurs de coordination essaient de réserver les mêmes lits libres.

## Résultat

- Requêtes : 1374 (22.9 par seconde) · médiane 18.5 ms · 95e centile 231.9 ms
- Erreurs serveur (5xx) ou réseau : **0**
- Codes HTTP : 200 × 1344 · 409 × 30
- Verrou des lits : **respecté** (un seul gagnant par lit disputé, les autres refusés et journalisés)

| Écran (API) | Appels | Médiane | 95e centile | Maximum |
|---|---|---|---|---|
| Indicateurs | 73 | 31.9 ms | 467.2 ms | 651.5 ms |
| Admissions | 89 | 25.2 ms | 341.0 ms | 1271.7 ms |
| Copilote · briefing | 72 | 71.1 ms | 340.5 ms | 932.9 ms |
| Réseau | 73 | 16.1 ms | 271.6 ms | 1212.8 ms |
| Copilote · réseau | 83 | 24.2 ms | 228.0 ms | 833.4 ms |
| Transferts | 63 | 18.4 ms | 217.6 ms | 581.1 ms |
| Nettoyage | 496 | 12.7 ms | 208.2 ms | 1210.5 ms |
| NSA | 84 | 17.9 ms | 200.1 ms | 613.8 ms |
| Journal | 81 | 17.0 ms | 163.9 ms | 1031.9 ms |
| Lits | 72 | 16.6 ms | 159.1 ms | 829.6 ms |
| Notifications | 102 | 13.2 ms | 139.3 ms | 970.1 ms |
| Réserver (disputé) | 36 | 130.3 ms | 139.0 ms | 145.0 ms |
| Connexion | 50 | 66.6 ms | 81.2 ms | 150.2 ms |

## Lits disputés

| Lit | Essais simultanés | Réussis | Refusés (409) | État final | Versions + | Refus au journal |
|---|---|---|---|---|---|---|
| MAT-406A | 22 | 1 | 21 | reserve | 1 | 21 |
| CHIR-301A | 3 | 1 | 2 | reserve | 1 | 2 |
| CHIR-301B | 3 | 1 | 2 | reserve | 1 | 2 |
| CHIR-302A | 2 | 1 | 1 | reserve | 1 | 1 |
| CHIR-302B | 4 | 1 | 3 | reserve | 1 | 3 |
| MAT-401A | 2 | 1 | 1 | reserve | 1 | 1 |
