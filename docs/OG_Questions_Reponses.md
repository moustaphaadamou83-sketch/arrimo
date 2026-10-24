# OG — questions testées et réponses obtenues

Copie isolée de la démo A/B/C (données fictives), 24 octobre 2026. Réponses brutes du serveur, non retouchées.

### [Hôpital A] Quel est l’état actuel de mon hôpital ?

Intentions : ["etat"]

```
Hôpital A — Val-des-Pins est au niveau ROUGE (pression 109 % : lits occupés + patients en attente, rapportés aux lits en service).
• Lits : 1 libres (1 confirmés), 4 réservés, 42 occupés, 6 en nettoyage, 3 hors service.
• Admissions : 6 patients attendent un lit, 0 ont un lit assigné.
• Urgence : 24 civières occupées sur 17 en service (141 %), 8 en corridor, 6 patients depuis plus de 24 h.
• Transferts : 0 demandes reçues attendent votre réponse ; 0 transferts en cours.
• NSA : 4 patients (9.5 % des lits occupés ; cible 8 %).
• Alertes : 13 (2 bloquantes). Demandez « Quelles alertes bloquent notre unité ? » pour le détail.

Sources : Lits, Accueil (niveau d’alerte), Admissions, Transferts, NSA, Alertes — lues à 17 h 46.
```

### [Hôpital A] Quelles sont les trois situations prioritaires ?

Intentions : ["priorites"]

```
Les 3 situations prioritaires maintenant :
1. Prioriser le nettoyage de 4 lits
2. Aucun lit pour P-75612
3. 4 patients sur civière depuis plus de 24 h sans demande de lit

À faire (décision humaine) : Chaque recommandation propose une action dans l’onglet OG ; c’est vous qui la réalisez.
Sources : Lits, Recommandations OG — lues à 17 h 46.
```

### [Hôpital B] Quels lits sont libres en soins intensifs ?

Intentions : ["lits_libres"]

```
Lits libres en soins intensifs chez Hôpital B — Mont-Clair : 3.
• Confirmés (3) : SI-101 (Soins intensifs), SI-102 (Soins intensifs), SI-103 (Soins intensifs)

Sources : Lits — lues à 17 h 46.
```

### [Hôpital A] Quels lits sont réservés depuis plus de deux heures ?

Intentions : ["reserves"]

```
Lits réservés depuis plus de 2 h (1) :
• SI-108 (Soins intensifs) — P-72562, depuis 3 h 35 · réservation locale sans demande liée

À faire (décision humaine) : Au-delà de 2 h (seuil configuré), vérifier avec l’équipe si la réservation doit être maintenue ; rien n’est annulé automatiquement.
Sources : Lits — lues à 17 h 46.
```

### [Hôpital A] Quel est le numéro des lits qui vont se libérer aujourd’hui ?

Intentions : ["conges"]

```
Lits dont le départ est enregistré aujourd’hui (6) :
• MAT-405B — Maternité, chambre 405 : congé confirmé aujourd’hui à 11 h 46 · heure dépassée de 6 h, vérification nécessaire.
• SI-101 — Soins intensifs, chambre 101 : congé confirmé aujourd’hui à 19 h 16 · disponible vers 20 h 01 (estimation : heure de congé confirmée + durée cible de nettoyage (45 min, configuration)).
• CHIR-306B — Chirurgie, chambre 306 : congé prévu aujourd’hui à 19 h 46.
• CHIR-307A — Chirurgie, chambre 307 : congé prévu aujourd’hui à 20 h 31.
• CHIR-306A — Chirurgie, chambre 306 : congé prévu aujourd’hui à 22 h 01.
• CHIR-308A — Chirurgie, chambre 308 : congé prévu aujourd’hui à 22 h 01.
Ces lits restent occupés jusqu’au départ réel ; un congé prévu n’est pas un lit libre.

Estimations : heure de disponibilité = congé confirmé + durée cible de nettoyage.
Sources : Lits, Congés — lues à 17 h 46.
```

### [Hôpital A] Le lit MED-204A a-t-il un congé prévu ou confirmé ?

Intentions : ["lit"]

```
Lit MED-204A (Médecine, chambre 204) : occupé depuis 4 h 37 · patient P-18093.
• Congé prévu pour demain à 14 h 00.
• Le congé est prévu, pas encore confirmé : le lit n’est pas libre.
• Dernier événement : Changement d’état (Historique de démonstration), le 16 oct. à 13 h 05.

Sources : Lits, Journal, Congés — lues à 17 h 46.
```

### [Hôpital A] Quels lits nécessitent un nettoyage ?

Intentions : ["nettoyage"]

```
À nettoyer, par priorité (7) :
1. Civière URG-04 — depuis 25 min · 8 patients attendent en corridor une civière régulière
2. MED-207B (Médecine, chambre 207) — depuis 46 min · 3 patients attendent un lit en médecine
3. MED-203A (Médecine, chambre 203) — depuis 42 min · 3 patients attendent un lit en médecine
4. SI-105 (Soins intensifs, chambre 105) — depuis 2 h 50 · 1 patient attend un lit en soins intensifs
5. CHIR-307B (Chirurgie, chambre 307) — depuis 39 min · 1 patient attend un lit en chirurgie
6. CHIR-303A (Chirurgie, chambre 303) — depuis 23 min · 1 patient attend un lit en chirurgie
7. MAT-403A (Maternité, chambre 403) — depuis 20 min · Ordre d’arrivée

Sources : Lits, Nettoyage — lues à 17 h 46.
```

### [Hôpital A] Quels patients fictifs attendent un lit depuis plus de 24 heures ?

Intentions : ["attente"]

```
Aucune demande de lit n’attend depuis plus de 24 h (durée comptée depuis la demande de lit).
À noter : P-32533 est sur civière (URG-03) depuis 38 h ; P-62549 est sur civière (URG-07) depuis 27 h.

Sources : Lits, Admissions — lues à 17 h 46.
```

### [Hôpital A] Combien de civières sont occupées dans le corridor ?

Intentions : ["civieres"]

```
Urgence de Hôpital A — Val-des-Pins : 24 civières occupées sur 17 en service (141 %), dont 8 en corridor ; 0 civières libres, 1 en nettoyage.
6 patients depuis plus de 24 h, 2 depuis plus de 48 h ; 6 ont une demande de lit, 18 n’en ont pas.
• COR-01 (corridor) — P-58342 depuis 5 h · sans demande de lit
• COR-02 (corridor) — P-69669 depuis 4 h · sans demande de lit
• COR-03 (corridor) — P-51243 depuis 3 h 30 · sans demande de lit
• COR-04 (corridor) — P-95836 depuis 3 h · sans demande de lit
• COR-05 (corridor) — P-29078 depuis 2 h 30 · sans demande de lit
• COR-06 (corridor) — P-20593 depuis 2 h · sans demande de lit
• COR-07 (corridor) — P-30862 depuis 1 h 30 · sans demande de lit
• COR-08 (corridor) — P-54073 depuis 1 h · sans demande de lit
Une longue présence sur civière n’est pas à elle seule une indication d’hospitalisation : à interpréter par l’équipe.

Sources : Lits, Urgence — lues à 17 h 46.
```

### [Hôpital B] Quelles demandes de transfert attendent une réponse ?

Intentions : ["transferts"]

```
Aucune demande reçue en attente de votre réponse.
Aucune de vos demandes n’attend de réponse.

Sources : Lits, Transferts — lues à 17 h 46.
```

### [Hôpital A] Pourquoi l’hôpital C est-il proposé plutôt que B ?

Intentions : ["pourquoi"]

```
Recherche d’un lit de médecine depuis Hôpital A — Val-des-Pins — règle : capacité confirmée d’abord, puis niveau de tension, puis durée et distance routières.
Aucun établissement n’est proposé maintenant (aucune capacité confirmée avec route calculée).
• Hôpital C — Sainte-Aurore — rang 6 : 2 lit(s) confirmé(s), niveau vert, route non calculée.
• Hôpital B — Mont-Clair — rang 1 : 5 lit(s) confirmé(s), niveau vert, route non calculée ; a refusé TR-00009 : « Pas d’infirmière disponible cette nuit ».
Distance routière et durée viennent du routeur (sans trafic en temps réel) ; la décision et l’acceptation restent humaines.

Estimations : durée routière OSRM sans trafic.
Sources : Lits, Transferts, Réseau (recherche) — lues à 17 h 46.
```

### [Hôpital A] Quels établissements ont des lits pédiatriques potentiellement compatibles ?

Intentions : ["pediatrie"]

```
Capacités pédiatriques et néonatales partagées (lits de groupe d’âge compatible seulement) :
• Hôpital C — Sainte-Aurore : Pédiatrie générale 1 confirmé(s)
• Centre pédiatrique des Érables (fictif) : Pédiatrie générale 2 confirmé(s) ; Soins intensifs pédiatriques 1 confirmé(s) ; Néonatologie 1 confirmé(s) ; Chirurgie pédiatrique 1 confirmé(s)
« Potentiellement compatible » : type d’unité et groupe d’âge concordent ; la compatibilité clinique reste à valider par l’équipe receveuse.

Sources : Lits, Réseau — lues à 17 h 46.
```

### [Hôpital B] Quels lits ont une disponibilité non confirmée ?

Intentions : ["non_confirmes"]

```
Tous les lits libres ont une disponibilité confirmée et récente.

Sources : Lits — lues à 17 h 46.
```

### [Hôpital A] Quelles alertes bloquent le fonctionnement de notre unité ?

Intentions : ["alertes"]

```
Alertes actives (13), les plus bloquantes d’abord :
• [rouge] P-32533 attend un lit de soins intensifs depuis 6 h 20 (civière URG-03).
   Origine : Création de la demande de lit · seuil : Attente maximale configurée (240 min).
   Fait : Aucun lit compatible assigné à cette demande.
   Proposition : Assigner un lit compatible, ou chercher ailleurs (Réseau) ; la décision reste humaine. (Coordination des lits de l’établissement)
• [rouge] SI-108 — Réservé depuis 3 h 35 sans admission enregistrée.
   Origine : Passage à l’état « réservé » · seuil : Réservation plus longue que la durée maximale configurée (config. pays : reservation_max_min).
   Hypothèse : Réservation locale sans demande liée : le patient est peut-être déjà arrivé sans que l’admission soit saisie, ou la réservation n’est plus utile.
   Proposition : Vérifier auprès de l’équipe responsable si la réservation doit être maintenue ; sinon admettre ou annuler (décision humaine). (Coordination des lits de l’établissement)
• [orange] MAT-405B — Congé prévu dépassé de 6 h, départ non enregistré.
   Origine : Congé prévu le 24 oct., 11 h 46 · seuil : Alerte dès l’heure dépassée ; niveau relevé après la marge configurée (60 min).
   Hypothèse : Départ peut-être fait sans être saisi, ou congé reporté (transport, attente d’un résultat).
   Proposition : Vérifier avec l’unité : enregistrer le départ, ou mettre à jour le congé (reporté, nouvelle heure). Le lit n’est pas libéré automatiquement. (Équipe de soins de l’unité, avec la coordination)
• [orange] P-62549 attend un lit de médecine depuis 5 h (civière URG-07).
   Origine : Création de la demande de lit · seuil : Attente maximale configurée (240 min).
   Fait : Aucun lit compatible assigné à cette demande.
   Proposition : Assigner un lit compatible, ou chercher ailleurs (Réseau) ; la décision reste humaine. (Coordination des lits de l’établissement)
• [orange] SI-105 — En nettoyage depuis 2 h 50, nettoyage non commencé.
   Origine : Départ du patient (lit passé au nettoyage) · seuil : Durée cible de nettoyage configurée (nettoyage_cible_min).
   Fait : Aucun début de nettoyage enregistré.
   Proposition : Confirmer la fin du nettoyage dans l’écran Nettoyage, ou signaler l’empêchement. (Équipe d’entretien)
• [jaune] MAT-406B — Hors service depuis 2 j 8 h (motif : personnel).
   Origine : Mise hors service · seuil : Hors service plus long que 24 h (hors_service_max_h).
   Fait : Motif enregistré : personnel.
   Proposition : Vérifier si le lit peut être remis en service. (Gestion de l’unité)
• [jaune] Civière URG-01 — P-99508 présent depuis 2 j 8 h, sans demande de lit.
   Origine : Arrivée sur civière · seuil : Présence de plus de 24 h sans demande de lit enregistrée.
   Hypothèse : Une longue présence n’indique pas à elle seule une hospitalisation : à interpréter par l’équipe de l’urgence.
   Proposition : Faire valider par l’équipe compétente si une demande de lit est nécessaire. (Équipe médicale de l’urgence)
• [jaune] Civière URG-02 — P-94873 présent depuis 2 j 2 h, sans demande de lit.
   Origine : Arrivée sur civière · seuil : Présence de plus de 24 h sans demande de lit enregistrée.
   Hypothèse : Une longue présence n’indique pas à elle seule une hospitalisation : à interpréter par l’équipe de l’urgence.
   Proposition : Faire valider par l’équipe compétente si une demande de lit est nécessaire. (Équipe médicale de l’urgence)
• [jaune] MED-210B — Hors service depuis 45 h 14 (motif : personnel).
   Origine : Mise hors service · seuil : Hors service plus long que 24 h (hors_service_max_h).
   Fait : Motif enregistré : personnel.
   Proposition : Vérifier si le lit peut être remis en service. (Gestion de l’unité)
• [jaune] Civière URG-05 — P-48764 présent depuis 31 h, sans demande de lit.
   Origine : Arrivée sur civière · seuil : Présence de plus de 24 h sans demande de lit enregistrée.
   Hypothèse : Une longue présence n’indique pas à elle seule une hospitalisation : à interpréter par l’équipe de l’urgence.
   Proposition : Faire valider par l’équipe compétente si une demande de lit est nécessaire. (Équipe médicale de l’urgence)
• [jaune] Civière URG-08 — P-59486 présent depuis 26 h, sans demande de lit.
   Origine : Arrivée sur civière · seuil : Présence de plus de 24 h sans demande de lit enregistrée.
   Hypothèse : Une longue présence n’indique pas à elle seule une hospitalisation : à interpréter par l’équipe de l’urgence.
   Proposition : Faire valider par l’équipe compétente si une demande de lit est nécessaire. (Équipe médicale de l’urgence)
• [jaune] MED-207B — En nettoyage depuis 46 min, nettoyage non commencé.
   Origine : Départ du patient (lit passé au nettoyage) · seuil : Durée cible de nettoyage configurée (nettoyage_cible_min).
   Fait : Aucun début de nettoyage enregistré.
   Proposition : Confirmer la fin du nettoyage dans l’écran Nettoyage, ou signaler l’empêchement. (Équipe d’entretien)

Données manquantes : contrôle périodique en retard : les alertes ci-dessus sont recalculées en direct.
Sources : Lits, Alertes — lues à 17 h 46.
```

### [Hôpital A] Quelles actions sont attendues de notre équipe aujourd’hui ?

Intentions : ["actions"]

```
Actions attendues de votre équipe aujourd’hui (à décider et réaliser par les personnes habilitées) :
1. Assigner un lit à 1 patient(s) en attente : P-52256 → MAT-406A.
2. Vérifier les congés dépassés : MAT-405B.
3. Nettoyage en attente : SI-105, MED-207B.
4. Vérifier les réservations prolongées : SI-108.

Sources : Lits, Alertes, Transferts, Admissions, Congés — lues à 17 h 46.
```

### [Hôpital A] Combien de lits libres en médecine et combien de civières en corridor ?

Intentions : ["lits_libres","civieres"]

```
Aucun lit libre en médecine chez Hôpital A — Val-des-Pins en ce moment. Demandez « Où trouver un lit … dans le réseau ? » pour chercher ailleurs.

Urgence de Hôpital A — Val-des-Pins : 24 civières occupées sur 17 en service (141 %), dont 8 en corridor ; 0 civières libres, 1 en nettoyage.
6 patients depuis plus de 24 h, 2 depuis plus de 48 h ; 6 ont une demande de lit, 18 n’en ont pas.
• COR-01 (corridor) — P-58342 depuis 5 h · sans demande de lit
• COR-02 (corridor) — P-69669 depuis 4 h · sans demande de lit
• COR-03 (corridor) — P-51243 depuis 3 h 30 · sans demande de lit
• COR-04 (corridor) — P-95836 depuis 3 h · sans demande de lit
• COR-05 (corridor) — P-29078 depuis 2 h 30 · sans demande de lit
• COR-06 (corridor) — P-20593 depuis 2 h · sans demande de lit
• COR-07 (corridor) — P-30862 depuis 1 h 30 · sans demande de lit
• COR-08 (corridor) — P-54073 depuis 1 h · sans demande de lit
Une longue présence sur civière n’est pas à elle seule une indication d’hospitalisation : à interpréter par l’équipe.

Sources : Lits, Urgence — lues à 17 h 46.
```

### [Hôpital A] Et en chirurgie ?

Intentions : ["lits_libres"]

```
Aucun lit libre en chirurgie chez Hôpital A — Val-des-Pins en ce moment. Demandez « Où trouver un lit … dans le réseau ? » pour chercher ailleurs.

Sources : Lits — lues à 17 h 46.
```

### [Hôpital A] Ce lit a-t-il un congé ?

Intentions : ["lit"]

```
Lit MED-204A (Médecine, chambre 204) : occupé depuis 4 h 37 · patient P-18093.
• Congé prévu pour demain à 14 h 00.
• Le congé est prévu, pas encore confirmé : le lit n’est pas libre.
• Dernier événement : Changement d’état (Historique de démonstration), le 16 oct. à 13 h 05.

Sources : Lits, Journal, Congés — lues à 17 h 46.
```

### [Hôpital B] Le lit MED-204A a-t-il un congé prévu ?

Intentions : ["lit"]

```
Lit MED-204A (Médecine, chambre 204) : occupé depuis 2 j 9 h · patient P-31168.
• Congé prévu pour le 27 oct. à 11 h 46.
• Le congé est prévu, pas encore confirmé : le lit n’est pas libre.
• Dernier événement : Changement d’état (Historique de démonstration), le 21 oct. à 6 h 10.

Sources : Lits, Journal, Congés — lues à 17 h 46.
```

### [Hôpital A] Quelles sont les capacités par département et spécialité ?

Intentions : ["capacites"]

```
Capacités de Hôpital A — Val-des-Pins par spécialité :
• Soins intensifs (Sans département) : 8 en service · 0 libres (0 confirmés) · 6 occupés · 1 réservés · 1 en nettoyage
• Médecine (Sans département) : 19 en service · 0 libres (0 confirmés) · 16 occupés · 1 réservés · 2 en nettoyage
• Chirurgie (Sans département) : 15 en service · 0 libres (0 confirmés) · 12 occupés · 1 réservés · 2 en nettoyage
• Maternité (Sans département) : 11 en service · 1 libres (1 confirmés) · 8 occupés · 1 réservés · 1 en nettoyage

Sources : Lits, Structure — lues à 17 h 46.
```

### [Hôpital A] Résume les NSA

Intentions : ["nsa"]

```
4 patients en NSA (9.5 % des lits occupés ; cible 8 %), 128 jours-lits au total :
• CHIR-301B (Chirurgie) — P-29579, depuis 44 j · orientation : CHSLD
• MED-208B (Médecine) — P-60240, depuis 36 j · orientation : ressource intermédiaire
• MED-205B (Médecine) — P-83195, depuis 28 j · orientation : réadaptation
• MED-202B (Médecine) — P-27515, depuis 20 j · orientation : domicile

À faire (décision humaine) : Coordination des orientations : suivre les places en CHSLD, ressources intermédiaires ou réadaptation (hors Arrimo).
Sources : Lits, NSA — lues à 17 h 46.
```

### [Hôpital A] Bonjour, tu peux m’aider ?

Intentions : null

```
Je réponds à partir des données d’Arrimo de votre établissement (et de ce que le réseau partage). Par exemple :
• Quel est l’état actuel de mon hôpital ?
• Quelles sont les trois situations prioritaires ?
• Quels lits sont libres en soins intensifs ?
• Quels lits vont se libérer aujourd’hui ? · Le lit MED-204A a-t-il un congé prévu ?
• Quels lits sont réservés depuis plus de deux heures ?
• Quels lits nécessitent un nettoyage ? · Combien de civières en corridor ?
• Quelles demandes de transfert attendent une réponse ?
• Pourquoi l’hôpital C est-il proposé plutôt que B ? · Quels établissements ont des lits pédiatriques compatibles ?
• Quelles alertes bloquent notre unité ? · Quelles actions sont attendues de notre équipe aujourd’hui ?
Je ne donne aucun avis clinique et je ne fais aucune action à votre place.
```
