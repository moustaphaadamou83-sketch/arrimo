# État des six lots — candidate locale du 29 octobre 2026

> Dernière publication : [pilotage des projets, finances, tâches, compétences, recherche](PILOTAGE_PROJETS_SH_2026-10-30.md) (migrations 30 à 34) et [OG](OG_LIVRAISON_2026-10-30.md) (travail de Codex intégré, personnalisation, licence SH, actions supervisées, lecture de documents, vocal partout), release `og-sh-20261030t0656` sur les six services ; 16 suites, 218 tests verts.

> Publication précédente : [paramètres modifiables et suppression d’un employé](PARAMETRES_SUPPRESSION_SH_2026-10-30.md), migration 29, release `parametres-20261030t0259` sur les six services; 16 suites et 209 tests verts, OG compris.

> Publication précédente : [apparence claire, sombre, automatique et solaire](APPARENCE_2026-10-29.md), SH (migration 28) et hospitalier, release `apparence-20261030t0046` sur les six services; 14 suites et 187 tests verts, contrastes AA en sombre aux trois largeurs.

> Publication précédente : [taux de change datés](CHANGE_SH_2026-10-29.md), migration 27, release `change-20261029t2240` sur les six services; dix suites SH vertes (ERP 22/22, accès 28/28, interface, parité 8/8, cycle, restauration, notifications, portail, raccordement, SLA). Import réel Banque du Canada vérifié en production.

> Publication précédente : [fiscalité par pays et région](FISCALITE_SH_2026-10-29.md), migration 26 et six services synchronisés sous `fiscalite-20261029t2225`, empreinte `c65e3cf7…e9ada58e`; ERP 21/21, accès 28/28, interface 1/1 (trois formats), parité 8/8. Taux canadiens sourcés seulement; BC/MB/SK à vérifier; autres pays bloqués faute de source.

> Publication précédente : [préférence de fuseau individuelle](PREFERENCE_FUSEAU_SH_2026-10-29.md), migration 25 et six services synchronisés sous `preferences-fuseau-20261029t2136`, empreinte `a8cefe3d…d8ac2a1d`; accès 28/28, interface navigateur et parité réelle 8/8 vérifiés.

> Étape précédente : [notifications courriel du support](COURRIELS_SUPPORT_SH_2026-10-29.md), migration 23 et six services publiés ; 60 tests intégrés ciblés réussis, plus transport courriel simulé. La livraison réelle SMTP n’a pas été testée par envoi.

> Dernière étape terminée : [portail support raccordé](RACCORDEMENT_SUPPORT_SH_2026-10-29.md). Migration 20, six services publiés, 41 établissements raccordés, accès publics A/B/C FR/EN vérifiés ; 152 tests intégrés et 221 locaux réussis. Les paragraphes antérieurs restent historiques.

> Dernière publication : [écosystème et parité du nouvel hôpital](PUBLICATION_ECOSYSTEME_PARITE_2026-10-29.md). Les six services existants sont à jour ; huit tests de parité réussis, connexions réelles et OG FR/EN vérifiés. Le raccordement opérationnel du portail support reste à configurer.

> Reprise en cours : [confidentialité des notifications, migration 19 et validation](CONFIDENTIALITE_NOTIFICATIONS_SH_2026-10-29.md). SH publiée après demande explicite : release `sh-v19-20261029t163913z`, migrations 10–19 et contrôles HTTPS réussis. Recette finale valide : 188 tests intégrés et 212 locaux ; applications hospitalières non publiées par cette livraison.

Dernière évolution : [notifications financières et pagination](NOTIFICATIONS_PAGINATION_SH_2026-10-29.md), migrations 17–18.

Suite : [portail support client](PORTAIL_SUPPORT_SH_2026-10-29.md), migrations 15–16 et notifications support.

Le [bilan de travail autonome](NUIT_SH_2026-10-29.md) et ses preuves décrivent la dernière tranche. « Testé » ci-dessous concerne les scénarios fictifs exécutés, pas une conformité exhaustive ni une livraison publique.

| Lot | Avancement vérifiable | Reste principal |
|---|---|---|
| 1 — Socle, accès, bilingue, présence | Recette accès PostgreSQL/API/Chromium ; FR/EN, sessions, récupération, invitations, présence et fuseau individuel testés; envoi SMTP réel reçu | Paramètres éditables complets et vérification de délivrabilité périodique |
| 2 — OG vocal | Texte réel OG et commandes vocales navigateur testées avec moteurs simulés ; consentement et refus production | Microphone physique, qualité/latence, fournisseurs et autorisation pour des données réelles |
| 3 — Isolation et rôles | Rôles et périmètres projet/pays/client/hôpital; ERP 21/21, cycle projets 6/6, notifications 8/8 et recettes accès/parité documentés dans [la note d’isolation](ISOLATION_PERIMETRES_SH_2026-10-29.md) | Revue exhaustive des chemins indirects et séparation physique/réseaux internationaux non démontrées |
| 4 — Pays, devises, finances | Référentiel, profils pays, calculs supportés et ERP PostgreSQL testés; profils fiscaux et taux datés/sourcés (Canada) publiés, facturation bloquée sans profil validé; taux de change Banque du Canada datés et équivalent CAD figé | Taux des autres pays (sources officielles), BC/MB/SK, lieu de fourniture configurable, budgets/coûts/marges |
| 5 — Pilote et promotion | Scénario Pilote Hôpital Test exécuté en isolation ; profils production, configuration, concurrence, reprises et exclusion des patients testés | Étapes détaillées, référentiels/spécialités/intégrations supplémentaires, prérequis opérationnels du pilote réel |
| 6 — Support et recette globale | Portail client raccordé à 41 établissements ; SLA versionnés, escalades internes, pièces jointes chiffrées, courriels et recherche OG publiés; Kanban Assigné, calendriers ouvrés et rapports SLA publiés | Pauses et pénalités contractuelles; rapports et analyses avancés |

La livraison du 29 octobre a synchronisé les six services existants. Aucun lot n'est déclaré intégralement clos : plusieurs exigences restent partielles, listées ci-dessus. Les scénarios de validation utilisent des données fictives; la migration n’a modifié aucune configuration d’établissement.
