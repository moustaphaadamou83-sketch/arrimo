# Fiscalité SH — lot 4, migration 26 — 29 octobre 2026

## Ce que la migration 26 apporte

- `sh_taxes` reçoit `source_nom`, `source_url`, `verifie_le`, `valide_de`, `valide_jusqua`. Une règle peut avoir plusieurs versions successives (index unique `pays/région/code/valide_de`). Ajouter une version ferme la précédente la veille; une facture déjà émise n'est jamais réécrite.
- `sh_profils_fiscaux` (pays, région) avec l'état `a_verifier`, `valide` ou `exonere`. Un profil `valide` ou `exonere` exige une source HTTPS, une date de vérification et une justification d'au moins 8 caractères (contrainte PostgreSQL).
- La facturation est **bloquée** (HTTP 409) dans ces cas : profil absent, profil « à vérifier », région manquante pour un pays découpé en régions, ou aucun taux sourcé en vigueur à la date du document. Une configuration absente ne vaut jamais exonération.
- Chaque taxe calculée est **copiée dans la facture** avec son taux, sa source, sa période d'effet et sa date de vérification. Le PDF affiche un bloc « Provenance fiscale » et l'écran facture affiche la même information.

## Taux confirmés et sourcés (Canada uniquement)

| Région | Taxes | Source |
|---|---|---|
| QC | TPS 5 % + TVQ 9,975 % | [Revenu Québec](https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/basic-rules-for-applying-the-gsthst-and-qst/tables-of-gst-and-qst-rates/) |
| ON | TVH 13 % | [ARC](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html) |
| NB, NL, PE | TVH 15 % | ARC |
| NS | TVH 14 % (depuis le 1er avril 2025) | ARC |
| AB, NT, NU | TPS 5 % (règle nationale `CA/*`, aucune ligne régionale ajoutée) | ARC |

Les lignes existantes ne sont sourcées que si leur valeur correspond exactement au barème officiel. Une valeur divergente reste non sourcée et bloque la facturation au lieu d'être corrigée silencieusement.

**Yukon (YT) : aucun profil.** Les factures y sont bloquées jusqu'à l'ajout d'un profil sourcé.

**Volontairement « à vérifier » : BC, MB, SK.** La taxe provinciale de vente (PST/RST) applicable dépend de la nature de la fourniture et de l'inscription fiscale du fournisseur. Aucun taux provincial n'est saisi. Les factures de ces provinces sont bloquées tant qu'un administrateur n'a pas validé un profil sourcé.

**Autres pays : aucun taux.** Aucun taux supposé n'est enregistré. Toute facture pour un client hors Canada est bloquée jusqu'à l'ajout d'un profil et de taux issus d'une source officielle. En production, cela concerne le seul client existant, situé hors Canada : sa facture déjà émise reste intacte, mais toute nouvelle facture pour ce client sera refusée tant que le profil fiscal de son pays n'est pas configuré.

## Date d'effet

- Les taux sont recherchés à la date du document : date locale (`SH_FUSEAU`, défaut America/Toronto) pour un brouillon ou un devis, date d'émission à l'émission, début de période pour un abonnement. Avant cette correction, la recherche utilisait la date UTC du serveur.
- Les règles importées par la migration commencent au **29 octobre 2026**, date de vérification des sources. Leur date réelle d'entrée en vigueur est plus ancienne, mais elle n'a pas été saisie faute de vérification individuelle. Conséquence : un document daté d'avant le 29 octobre 2026 (par exemple une période d'abonnement antérieure) est bloqué. Pour le débloquer, un administrateur ajoute une version antérieure sourcée.

## Lieu de fourniture — vérification

Le calcul actuel prend le pays et la région de **l'organisation cliente** (à défaut, la région de son établissement).

Selon l'[ARC, mémorandum 3-3-6, règle générale 1 (services)](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/3-3-6/plc-spply-prvnc-gnrl-rls-fr-srvcs.html), le lieu de fourniture d'un service est la province de l'adresse canadienne du destinataire obtenue par le fournisseur. Lorsqu'il y en a plusieurs, c'est l'adresse **la plus étroitement liée à la fourniture**, en général celle d'où le fournisseur a été engagé. Les biens meubles incorporels, comme les licences logicielles, suivent des règles distinctes (mémorandums [3-3-5](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/3-3-5/plc-sppl-prvnc-gnrl-rls-ntngbl-prsnl-prprt.html) et [3-3-5-1](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/3-3-5-1/plc-sppl-prvnc-spcfc-rls-ntngbl-prsnl-prprt.html)).

**Conclusion : le lieu de fourniture doit devenir configurable** par contrat ou par organisation, avec justification. C'est nécessaire quand un réseau de santé contracte depuis une province pour un établissement situé dans une autre, et pour qualifier une licence comme service ou comme bien meuble incorporel. Ce n'est pas encore implémenté. Ce travail exige une nouvelle migration et une validation par un fiscaliste de la qualification de l'offre Arrimo.

## Limites

- Aucune qualification fiscale de l'offre (service ou licence) n'a été validée par un professionnel.
- Les numéros d'inscription TPS/TVQ de l'émetteur viennent de `SH_EMETTEUR_TAXES`; leur présence n'est pas vérifiée.
- Pas de gestion des exemptions propres à un client (organisme public, autochtone, etc.) : seule l'exonération d'un profil pays/région entier existe.
- Pas encore de taux de change datés.

## Validation et publication

- Recette `.local/preuves-sh-lot1/20261029222034_3208e6/` sur bases fictives neuves, empreinte `c65e3cf716a47c1d913aea0302427d4abf8af1b32498e6f5b9929639e9ada58e` : ERP 21/21 (blocage BC/MB/SK, TPS seule en AB, conservation de la provenance après une nouvelle version de règle), accès 28/28, interface 1/1 (ordinateur, tablette, téléphone), parité 8/8.
- Une première préparation a été refusée par la garde d'intégrité : la migration ajoutait des lignes à `sh_taxes`. Corrigé : aucune ligne ajoutée aux tables existantes.
- Corrigé en cours de recette : les rendus concurrents de la console (un clic pendant le chargement de l'accueil pouvait être écrasé), cause d'un échec intermittent de la suite accès.
- Publication `fiscalite-20261029t2225` sur principal, démo, recette, validation, sh et sh-validation. Sauvegarde et restauration identique, migrations rejouées deux fois sur copie, démarrage ancien et nouveau code, santé `ok`, ressources web vérifiées (26 hospitalières, 14 SH), configurations inchangées, scénario A/B/C de la démo préservé. Rapport : `.local/fiscalite-release-20261029t2225/rapport.json`.
- Production SH après publication : version 26, 12 profils fiscaux, 8 taux sourcés. La facture existante est inchangée.
- Non vérifié : un parcours authentifié en production (il exige le compte administrateur réel et son MFA).

## Profil fiscal du Mali — vérification du 30 octobre 2026 (non ajouté)

- Le seul client SH en production est au Mali (ML). Recherche d'une source officielle pour le taux normal de TVA : le site de la DGI (https://www.dgi.gouv.ml/CGI/) publie le Code général des impôts, mais l'article fixant le taux n'a pas pu être lu et cité.
- Les sources secondaires (guides fiscaux, mémoires) indiquent 18 % (harmonisation UEMOA). **Elles ne suffisent pas** : aucun taux n'est enregistré.
- Pour débloquer : un administrateur SH saisit le profil ML, puis la règle TVA, avec l'URL du Code général des impôts **et le numéro de l'article**, dans Facturation → Profils fiscaux, puis Règles de taxe. La saisie est contrôlée et journalisée.
