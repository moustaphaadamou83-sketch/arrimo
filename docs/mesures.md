# Arrimo · Mesures de performance

Mesuré le 2026-10-16 sur la démo Hôpital X / Hôpital Y (30 appels par écran, serveur et base sur la même machine).
Objectif : moins de 300 ms par écran.

| Écran (API) | Médiane | 95e centile | Maximum | Objectif |
|---|---|---|---|---|
| Copilote · briefing | 51.3 ms | 85.4 ms | 109.8 ms | atteint |
| Copilote · réseau | 15.4 ms | 22.9 ms | 26.3 ms | atteint |
| Copilote · question | 54.1 ms | 77.3 ms | 102.3 ms | atteint |
| Réseau · capacité | 8.1 ms | 11.7 ms | 17.6 ms | atteint |
| Réseau · recherche | 12.1 ms | 19.1 ms | 26.6 ms | atteint |
| Lits | 12.2 ms | 21.1 ms | 23.5 ms | atteint |
| Admissions | 13.6 ms | 24.0 ms | 28.6 ms | atteint |
| Transferts | 9.3 ms | 13.9 ms | 14.1 ms | atteint |
| Nettoyage | 6.4 ms | 8.3 ms | 9.1 ms | atteint |
| NSA | 7.8 ms | 11.5 ms | 14.1 ms | atteint |
| Indicateurs (30 j) | 15.3 ms | 22.4 ms | 26.7 ms | atteint |
| Journal | 11.3 ms | 15.4 ms | 17.4 ms | atteint |
| Notifications | 8.3 ms | 20.5 ms | 22.4 ms | atteint |
| Moi | 6.9 ms | 12.2 ms | 17.3 ms | atteint |
| Copilote réseau (gestionnaire) | 16.7 ms | 37.7 ms | 38.7 ms | atteint |

## Plans d’exécution (EXPLAIN ANALYZE, journal grossi de 20 000 lignes)

### Capacité du réseau (SQL_CAPACITE) · 0.458 ms

```
Sort  (cost=15.23..15.25 rows=8 width=101) (actual time=0.285..0.288 rows=8 loops=1)
  Sort Key: e.nom, t.ordre
  Sort Method: quicksort  Memory: 26kB
  ->  HashAggregate  (cost=14.89..15.11 rows=8 width=101) (actual time=0.252..0.259 rows=8 loops=1)
        Group Key: e.id, t.id
        Batches: 1  Memory Usage: 24kB
        ->  Hash Join  (cost=3.18..8.45 rows=112 width=92) (actual time=0.042..0.147 rows=112 loops=1)
              Hash Cond: (l.type_id = t.id)
              ->  Hash Join  (cost=2.09..6.75 rows=112 width=73) (actual time=0.021..0.092 rows=112 loops=1)
                    Hash Cond: (l.etablissement_id = e.id)
                    ->  Seq Scan on lits l  (cost=0.00..3.12 rows=112 width=23) (actual time=0.005..0.037 rows=112 loops=1)
                    ->  Hash  (cost=2.07..2.07 rows=2 width=54) (actual time=0.011..0.012 rows=2 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                          ->  Nested Loop  (cost=0.00..2.07 rows=2 width=54) (actual time=0.008..0.009 rows=2 loops=1)
                                ->  Seq Scan on config_pays c  (cost=0.00..1.01 rows=1 width=8) (actual time=0.003..0.003 rows=1 loops=1)
                                      Filter: (id = 1)
                                ->  Seq Scan on etablissements e  (cost=0.00..1.03 rows=2 width=54) (actual time=0.003..0.004 rows=2 loops=1)
                                      Filter: (module_actif AND actif AND (config_id = 1) AND ((partage <> 'aucun'::text) OR (id = 1)))
              ->  Hash  (cost=1.04..1.04 rows=4 width=23) (actual time=0.015..0.015 rows=4 loops=1)
                    Buckets: 1024  Batches: 1  Memory Usage: 9kB
                    ->  Seq Scan on types_unite t  (cost=0.00..1.04 rows=4 width=23) (actual time=0.009..0.010 rows=4 loops=1)
Planning Time: 1.446 ms
Execution Time: 0.458 ms
```

### Journal de l’établissement (première page) · 3.706 ms

```
Limit  (cost=1058.95..1059.70 rows=300 width=16) (actual time=3.516..3.579 rows=300 loops=1)
  ->  Sort  (cost=1058.95..1060.45 rows=600 width=16) (actual time=3.514..3.537 rows=300 loops=1)
        Sort Key: journal.date DESC, journal.id DESC
        Sort Method: quicksort  Memory: 36kB
        ->  HashAggregate  (cost=1025.27..1031.27 rows=600 width=16) (actual time=3.345..3.401 rows=305 loops=1)
              Group Key: journal.id, journal.date
              Batches: 1  Memory Usage: 57kB
              ->  Append  (cost=0.29..1022.27 rows=600 width=16) (actual time=0.030..3.206 rows=305 loops=1)
                    ->  Limit  (cost=0.29..34.86 rows=300 width=16) (actual time=0.029..3.058 rows=300 loops=1)
                          ->  Index Only Scan using journal_etab_date_id on journal  (cost=0.29..1303.33 rows=11306 width=16) (actual time=0.029..3.029 rows=300 loops=1)
                                Index Cond: (etablissement_id = 1)
                                Heap Fetches: 300
                    ->  Limit  (cost=983.65..984.40 rows=300 width=16) (actual time=0.113..0.115 rows=5 loops=1)
                          ->  Sort  (cost=983.65..1027.46 rows=17523 width=16) (actual time=0.111..0.112 rows=5 loops=1)
                                Sort Key: j.date DESC, j.id DESC
                                Sort Method: quicksort  Memory: 25kB
                                ->  Nested Loop  (cost=0.29..175.07 rows=17523 width=16) (actual time=0.086..0.092 rows=5 loops=1)
                                      ->  Seq Scan on transferts t  (cost=0.00..1.45 rows=26 width=4) (actual time=0.023..0.032 rows=30 loops=1)
                                            Filter: ((origine_id = 1) OR (destination_id = 1))
                                      ->  Index Scan using journal_transfert on journal j  (cost=0.29..6.65 rows=3 width=20) (actual time=0.001..0.002 rows=0 loops=30)
                                            Index Cond: (transfert_id = t.id)
Planning Time: 0.768 ms
Execution Time: 3.706 ms
```

### Indicateurs : durées de nettoyage (journal, 30 j) · 0.109 ms

```
Aggregate  (cost=138.26..138.27 rows=1 width=8) (actual time=0.056..0.057 rows=1 loops=1)
  ->  Bitmap Heap Scan on journal  (cost=4.86..138.25 rows=1 width=0) (actual time=0.029..0.049 rows=50 loops=1)
        Recheck Cond: ((etablissement_id = 1) AND (date > (now() - '30 days'::interval)))
        Filter: (action = 'Changement d’état'::text)
        Heap Blocks: exact=2
        ->  Bitmap Index Scan on journal_etab_date_id  (cost=0.00..4.86 rows=57 width=0) (actual time=0.018..0.018 rows=50 loops=1)
              Index Cond: ((etablissement_id = 1) AND (date > (now() - '30 days'::interval)))
Planning Time: 0.194 ms
Execution Time: 0.109 ms
```

### File d’admission : lit libre adapté · 0.056 ms

```
Limit  (cost=3.97..3.97 rows=1 width=13) (actual time=0.039..0.039 rows=0 loops=1)
  ->  Sort  (cost=3.97..3.97 rows=1 width=13) (actual time=0.037..0.038 rows=0 loops=1)
        Sort Key: code
        Sort Method: quicksort  Memory: 25kB
        ->  Seq Scan on lits l  (cost=0.00..3.96 rows=1 width=13) (actual time=0.029..0.029 rows=0 loops=1)
              Filter: (ventilation AND (etablissement_id = 1) AND (type_id = 1) AND (etat = 'libre'::text))
              Rows Removed by Filter: 112
Planning Time: 0.245 ms
Execution Time: 0.056 ms
```

### Transferts de l’établissement (en cours) · 0.025 ms

```
Seq Scan on transferts t  (cost=0.00..1.52 rows=2 width=4) (actual time=0.017..0.018 rows=2 loops=1)
  Filter: ((statut <> ALL ('{recu,refuse}'::text[])) AND ((origine_id = 1) OR (destination_id = 1)))
  Rows Removed by Filter: 28
Planning Time: 0.091 ms
Execution Time: 0.025 ms
```
