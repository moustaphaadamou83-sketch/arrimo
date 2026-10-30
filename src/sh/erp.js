'use strict';
const {verifierDestinataire}=require('./notifications-perimetres');
/**
 * Modules ERP de la console SH : tarification, contrats (période, renouvellement, PDF), facturation,
 * personnel (équipes, matrice des permissions), documents, hébergement, rapports, formation par séances,
 * notifications et calendrier. Toutes les mutations sont journalisées dans sh_journal (immuable).
 */
const fs = require('fs');
const { transaction } = require('../db');
const { lignesPropres, totaux, prochainNumero, ajouterMois, ajouterJours, cents, versMontant, jourDe,verifierMontantDevise,codeRegion } = require('./montants');
const { documentCommercial, date: dateFr } = require('./pdf-erp');
const documents = require('./documents');
const { notifier, nombre } = require('./automatisations');
const { montantsDevis, taxesClient, aujourdhui, jourOuNull } = require('./commercial');
const { PERMISSIONS, ROLES_SH } = require('./permissions');
const { verifierEnvironnements } = require('./supervision');
const { equipeValidee,enregistrerEquipe:enregistrerEquipeProjet } = require('./projets');
const { traduire:traduireSH } = require('../../public-sh/i18n/localisation');
const presence=require('./presence');
const change=require('./change');

const texte = (x, max = 500) => String(x ?? '').trim().slice(0, max) || null;
const idPositif = (x) => Number.isSafeInteger(Number(x)) && Number(x) > 0 ? Number(x) : null;
const erreur = (statut, message) => Object.assign(new Error(message), { statut });
const jour = jourDe;
const PERIODES_MOIS = { mensuel: 1, annuel: 12 };
const ROLES_FACTURATION = ['administration', 'finance'];

function brancher(api, pool, route, journal, { cibles, appeler, env }) {
  require('./cycle-projets').brancher(api,pool,route,journal,env);
  require('./finances-projets').brancher(api,pool,route,journal);
  require('./taches-suivi').brancher(api,pool,route,journal);
  require('./projets-pilotage').brancher(api,pool,route,journal);
  require('./competences').brancher(api,pool,route,journal);
  require('./recherche').brancher(api,pool,route);
  require('./deploiement').brancher(api,pool,route,journal);
  /* ------------------------------------------------------------ tarification et taxes */
  api.get('/tarifs', route(async () => (await pool.query('SELECT * FROM sh_tarifs ORDER BY actif DESC, libelle')).rows));
  api.post('/tarifs', route(async (req) => {
    const b = req.body; const code = String(b.code || '').trim().toLowerCase();
    const prix = Number(b.prix_unitaire);
    if (!/^[a-z0-9_-]{2,40}$/.test(code) || !texte(b.libelle, 160) || !Number.isFinite(prix) || prix < 0) throw erreur(400, 'Code (minuscules, chiffres, - ou _), libellé et prix positif requis.');
    if (!['unique', 'mensuel', 'annuel'].includes(b.periodicite || 'unique')) throw erreur(400, 'Périodicité invalide.');
    const { rows } = await pool.query(`INSERT INTO sh_tarifs(code,libelle,description,prix_unitaire,unite,periodicite,taxable,actif,modifie_par)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(code) DO UPDATE SET libelle=EXCLUDED.libelle,description=EXCLUDED.description,prix_unitaire=EXCLUDED.prix_unitaire,
      unite=EXCLUDED.unite,periodicite=EXCLUDED.periodicite,taxable=EXCLUDED.taxable,actif=EXCLUDED.actif,modifie_par=EXCLUDED.modifie_par,modifie_le=now() RETURNING *`,
    [code, texte(b.libelle, 160), texte(b.description, 1000), prix, texte(b.unite, 40) || 'forfait', b.periodicite || 'unique', b.taxable !== false, b.actif !== false, req.u.email]);
    await journal(pool, req.u, 'Tarif enregistré', code, `${prix} · ${rows[0].periodicite}`);
    return rows[0];
  }));
  api.get('/facturation/taxes', route(async () => (await pool.query('SELECT * FROM sh_taxes ORDER BY pays_code, region, ordre')).rows));
  api.get('/facturation/change', route(async () => ({ source: { nom: change.SOURCE_NOM, url: change.SOURCE_URL }, devises: change.DEVISES, anciennete_max_jours: change.ANCIENNETE_MAX_JOURS,
    derniers: (await pool.query('SELECT DISTINCT ON (devise) devise,jour,cad_par_unite,source_nom,source_url,serie,recupere_le FROM sh_taux_change ORDER BY devise,jour DESC')).rows })));
  api.post('/facturation/change/actualiser', route(async (req) => {
    const debut = jourOuNull(req.body.depuis) || ajouterJours(aujourdhui(), -14);
    if (debut < ajouterJours(aujourdhui(), -366) || debut > aujourdhui()) throw erreur(400, 'Période d’import limitée à l’année écoulée.');
    const bilan = await transaction(pool, (c) => change.importerBanqueCanada(c, { debut }));
    await journal(pool, req.u, 'Taux de change importés', change.SOURCE_NOM, `depuis ${debut} · ${bilan.ajoutes} ajoutés · ${bilan.divergents.length} divergents`);
    return bilan;
  }));
  api.get('/facturation/profils-fiscaux', route(async () => (await pool.query('SELECT * FROM sh_profils_fiscaux ORDER BY pays_code,region')).rows));
  api.post('/facturation/profils-fiscaux',route(async(req)=>{
    const b=req.body,pays=require('./international').normaliserPays(b.pays_code),region=String(b.region||'').trim()==='*'?'*':codeRegion(b.region),statut=String(b.statut||'a_verifier');
    const sourceNom=texte(b.source_nom,160),source=String(b.source_url||'').trim(),motif=texte(b.motif,500);
    if(!region||!['a_verifier','valide','exonere'].includes(statut)||!motif)throw erreur(400,'Pays, région, statut et justification sont requis.');
    if(statut!=='a_verifier'&&(!sourceNom||!/^https:\/\//i.test(source)))throw erreur(400,'Un profil validé ou exonéré exige une source officielle HTTPS.');
    const {rows}=await pool.query(`INSERT INTO sh_profils_fiscaux(pays_code,region,statut,source_nom,source_url,verifie_le,motif,modifie_par)
      VALUES($1,$2,$3,$4,$5,CASE WHEN $3='a_verifier' THEN NULL ELSE CURRENT_DATE END,$6,$7) RETURNING *`,[pays,region,statut,statut==='a_verifier'?null:sourceNom,statut==='a_verifier'?null:source,motif,req.u.email]);
    await journal(pool,req.u,'Profil fiscal créé',`${pays}/${region}`,`${statut} · ${motif}`);return rows[0];
  }));
  api.post('/facturation/taxes', route(async (req) => {
    const b=req.body,pays=require('./international').normaliserPays(b.pays_code),region=String(b.region||'').trim()==='*'?'*':codeRegion(b.region);
    const code=String(b.code||'').trim().toUpperCase(),nom=texte(b.nom,100),taux=Number(b.taux),de=jourOuNull(b.valide_de),jusqua=jourOuNull(b.valide_jusqua);
    const source=String(b.source_url||'').trim(),sourceNom=texte(b.source_nom,160),motif=texte(b.motif,500);
    if(!region||!/^[A-Z0-9_-]{2,24}$/.test(code)||!nom||!Number.isFinite(taux)||taux<0||taux>=100||!de||!sourceNom||!/^https:\/\//i.test(source)||!motif||jusqua&&jusqua<de)throw erreur(400,'Pays, région, code, taux, dates, source HTTPS et motif fiscal documenté sont requis.');
    const rows=await transaction(pool,async c=>{
      await c.query("SELECT pg_advisory_xact_lock(hashtext('sh-fiscal-rule'),hashtext($1))",[`${pays}/${region}/${code}`]);
      const overlaps=(await c.query(`SELECT * FROM sh_taxes WHERE pays_code=$1 AND region=$2 AND code=$3
        AND (valide_de IS NULL OR valide_de<=$4::date) AND (valide_jusqua IS NULL OR valide_jusqua>= $5::date) FOR UPDATE`,[pays,region,code,jusqua||'9999-12-31',de])).rows;
      if(overlaps.length>1)throw erreur(409,'Les périodes fiscales existantes se chevauchent; corrigez-les avant d’ajouter une règle.');
      if(overlaps.length){const old=overlaps[0];if(old.valide_de&&de<=jour(old.valide_de))throw erreur(409,'La nouvelle règle doit commencer après la période existante; utilisez Modifier pour une correction.');
        if(jusqua&&old.valide_jusqua&&jusqua<jour(old.valide_jusqua))throw erreur(409,'La période proposée chevauche une règle future déjà enregistrée.');
        await c.query('UPDATE sh_taxes SET valide_jusqua=$2::date-1 WHERE id=$1',[old.id,de]);}
      return (await c.query(`INSERT INTO sh_taxes(pays_code,region,code,nom,taux,ordre,source_nom,source_url,verifie_le,valide_de,valide_jusqua)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_DATE,$9,$10) RETURNING *`,[pays,region,code,nom,taux,Math.max(1,Math.min(99,Number(b.ordre)||overlaps[0]?.ordre||1)),sourceNom,source,de,jusqua])).rows[0];
    });
    await journal(pool,req.u,'Règle fiscale créée',`${pays}/${region} · ${code}`,`${taux}% · ${sourceNom} · ${de}${jusqua?` → ${jusqua}`:''} · ${motif}`);
    return rows;
  }));
  api.put('/facturation/taxes/:id', route(async (req) => {
    const b=req.body,taux=Number(b.taux),de=jourOuNull(b.valide_de),jusqua=jourOuNull(b.valide_jusqua),source=String(b.source_url||'').trim(),sourceNom=texte(b.source_nom,160),motif=texte(b.motif,500);
    if(!Number.isFinite(taux)||taux<0||taux>=100||!de||!sourceNom||!/^https:\/\//i.test(source)||!motif||jusqua&&jusqua<de)throw erreur(400,'Taux, dates, source HTTPS et motif fiscal documenté sont requis.');
    const { rows } = await pool.query(`UPDATE sh_taxes SET taux=$2,source_nom=$3,source_url=$4,verifie_le=CURRENT_DATE,valide_de=$5,valide_jusqua=$6 WHERE id=$1 RETURNING *`, [idPositif(req.params.id), taux,sourceNom,source,de,jusqua]);
    if (!rows[0]) throw erreur(404, 'Taxe introuvable.');
    await journal(pool, req.u, 'Taux de taxe modifié', `${rows[0].pays_code}/${rows[0].region} ${rows[0].code}`, `${taux} % · ${sourceNom} · ${de}${jusqua?` → ${jusqua}`:''} · ${motif}`);
    return rows[0];
  }));
  api.put('/facturation/profils-fiscaux/:id', route(async(req)=>{
    const id=idPositif(req.params.id),statut=String(req.body.statut||''),sourceNom=texte(req.body.source_nom,160),source=String(req.body.source_url||'').trim(),motif=texte(req.body.motif,500);
    if(!['a_verifier','valide','exonere'].includes(statut)||!motif)throw erreur(400,'Statut et justification de profil fiscal requis.');
    if(statut!=='a_verifier'&&(!sourceNom||!/^https:\/\//i.test(source)))throw erreur(400,'Un profil validé ou exonéré exige une source officielle HTTPS.');
    const {rows}=await pool.query(`UPDATE sh_profils_fiscaux SET statut=$2,source_nom=$3,source_url=$4,verifie_le=CASE WHEN $2='a_verifier' THEN NULL ELSE CURRENT_DATE END,motif=$5,modifie_par=$6,modifie_le=now() WHERE id=$1 RETURNING *`,[id,statut,statut==='a_verifier'?null:sourceNom,statut==='a_verifier'?null:source,motif,req.u.email]);
    if(!rows[0])throw erreur(404,'Profil fiscal introuvable.');
    await journal(pool,req.u,'Profil fiscal modifié',`${rows[0].pays_code}/${rows[0].region}`,`${statut} · ${motif}`);
    return rows[0];
  }));

  /* ------------------------------------------------------------ PDF devis et contrat */
  const clientDe = async (organisationId) => (await pool.query(`SELECT o.nom, COALESCE(o.adresse,h.adresse) adresse, COALESCE(o.ville,h.ville) ville,
    COALESCE(o.region,h.region) region, COALESCE(o.courriel_facturation, h.contact_courriel) courriel
    FROM sh_crm_organisations o LEFT JOIN hopitaux h ON h.id=o.hopital_id WHERE o.id=$1`, [organisationId])).rows[0];
  const envoyerPdf = (res, pdf, nom) => res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nom}.pdf"` }).send(pdf);
  api.get('/crm/devis/:id/pdf', async (req, res, next) => {
    try {
      const d = (await pool.query(`SELECT d.*, p.titre, p.organisation_id FROM sh_devis d JOIN sh_opportunites p ON p.id=d.opportunite_id WHERE d.id=$1`, [idPositif(req.params.id)])).rows[0];
      if (!d) throw erreur(404, 'Devis introuvable.');
      const m = await montantsDevis(pool, d);
      const pdf = await documentCommercial({ type: 'devis', titre: 'Devis', reference: `D-${d.opportunite_id}-v${d.version}`, client: await clientDe(d.organisation_id), devise: d.devise,
        champs: [['Objet', d.titre], ['Version', `v${d.version} · ${d.statut}`], ['Émis le', dateFr(d.cree_le, req.langue)], ['Valide jusqu’au', dateFr(jour(d.valide_jusqu), req.langue)]],
        lignes: m.lignes, totaux: m, mentions: [d.conditions || 'Conditions : paiement à 30 jours. Les abonnements sont facturés au début de chaque période.',
          'Document généré par la console Arrimo.SH ; il ne vaut pas signature. Aucune donnée de patient.'] }, {...(await require('./parametres').envEffectif(pool, env)),SH_DOCUMENT_LANGUE:req.langue});
      await journal(pool, req.u, 'Devis téléchargé (PDF)', `Devis ${d.id}`, `v${d.version}`);
      envoyerPdf(res, pdf, `devis-${d.opportunite_id}-v${d.version}`);
    } catch (e) { next(e); }
  });
  async function contratComplet(id) {
    const c = (await pool.query(`SELECT c.*, p.titre, p.organisation_id, o.nom client FROM sh_contrats c JOIN sh_opportunites p ON p.id=c.opportunite_id
      JOIN sh_crm_organisations o ON o.id=p.organisation_id WHERE c.id=$1`, [id])).rows[0];
    if (!c) throw erreur(404, 'Contrat introuvable.');
    return c;
  }
  api.get('/crm/contrats/:id', route(async (req) => {
    const c = await contratComplet(idPositif(req.params.id));
    const [renouvellements, abonnements, factures, devis] = await Promise.all([
      pool.query('SELECT * FROM sh_contrats_renouvellements WHERE contrat_id=$1 ORDER BY quand DESC', [c.id]),
      pool.query('SELECT * FROM sh_abonnements WHERE contrat_id=$1 ORDER BY id', [c.id]),
      ROLES_FACTURATION.includes(req.u.role) ? pool.query('SELECT id, numero, statut, total, echeance_le FROM sh_factures WHERE contrat_id=$1 ORDER BY id', [c.id]) : { rows: [] },
      c.devis_id ? pool.query('SELECT * FROM sh_devis WHERE id=$1', [c.devis_id]) : { rows: [] },
    ]);
    return { ...c, renouvellements: renouvellements.rows, abonnements: abonnements.rows, factures: factures.rows, devis: devis.rows[0] || null };
  }));
  api.put('/crm/contrats/:id', route(async (req) => {
    const c = await contratComplet(idPositif(req.params.id)); const b = req.body;
    if (c.statut === 'signe' && ['date_debut', 'duree_mois'].some((k) => b[k] !== undefined)) throw erreur(409, 'Contrat signé : la période se modifie par un renouvellement.');
    if (['resilie', 'expire'].includes(c.statut)) throw erreur(409, 'Contrat résilié ou expiré.');
    const statut = b.statut === undefined ? c.statut : String(b.statut);
    if (!['negociation', 'pret_a_signer', c.statut].includes(statut)) throw erreur(400, 'Seuls les statuts « négociation » et « prêt à signer » se règlent ici.');
    const duree = b.duree_mois === undefined ? c.duree_mois : Number(b.duree_mois);
    const preavis = b.preavis_jours === undefined ? c.preavis_jours : Number(b.preavis_jours);
    if (!Number.isInteger(duree) || duree < 1 || duree > 120 || !Number.isInteger(preavis) || preavis < 0 || preavis > 365) throw erreur(400, 'Durée (1 à 120 mois) ou préavis (0 à 365 jours) invalide.');
    const fin = jour(c.date_fin);
    const { rows } = await pool.query(`UPDATE sh_contrats SET statut=$2,date_debut=$3,duree_mois=$4,preavis_jours=$5,renouvellement_auto=$6,
      renouvellement_le=CASE WHEN $7::date IS NULL THEN renouvellement_le ELSE $7::date - $5::int END WHERE id=$1 RETURNING *`,
    [c.id, statut, b.date_debut === undefined ? jour(c.date_debut) : jourOuNull(b.date_debut), duree, preavis, b.renouvellement_auto === undefined ? c.renouvellement_auto : b.renouvellement_auto !== false, fin]);
    await journal(pool, req.u, 'Contrat modifié', c.reference, Object.keys(b).join(', '), c.hopital_id);
    return rows[0];
  }));
  api.post('/crm/contrats/:id/renouveler', route(async (req) => transaction(pool, async (db) => {
    const c = (await db.query('SELECT * FROM sh_contrats WHERE id=$1 FOR UPDATE', [idPositif(req.params.id)])).rows[0];
    if (!c) throw erreur(404, 'Contrat introuvable.');
    if (c.statut !== 'signe' || !c.date_fin) throw erreur(409, 'Seul un contrat signé se renouvelle.');
    const ancienne = jour(c.date_fin);
    const nouvelle = ajouterJours(ajouterMois(ajouterJours(ancienne, 1), c.duree_mois), -1);
    await db.query('UPDATE sh_contrats SET date_fin=$2, renouvellement_le=$3 WHERE id=$1', [c.id, nouvelle, ajouterJours(nouvelle, -c.preavis_jours)]);
    await db.query('UPDATE sh_abonnements SET fin=$2 WHERE contrat_id=$1 AND statut<>\'termine\'', [c.id, nouvelle]);
    await db.query('INSERT INTO sh_contrats_renouvellements(contrat_id,ancienne_fin,nouvelle_fin,par) VALUES($1,$2,$3,$4)', [c.id, ancienne, nouvelle, req.u.email]);
    await journal(db, req.u, 'Contrat renouvelé', c.reference, `${ancienne} → ${nouvelle}`, c.hopital_id);
    return (await db.query('SELECT * FROM sh_contrats WHERE id=$1', [c.id])).rows[0];
  })));
  api.post('/crm/contrats/:id/resilier', route(async (req) => {
    const motif = texte(req.body.motif, 500); if (!motif || motif.length < 3) throw erreur(400, 'Indiquez le motif de la résiliation.');
    return transaction(pool, async (db) => {
      const c = (await db.query('SELECT * FROM sh_contrats WHERE id=$1 FOR UPDATE', [idPositif(req.params.id)])).rows[0];
      if (!c) throw erreur(404, 'Contrat introuvable.');
      if (c.statut === 'resilie') return c;
      await db.query(`UPDATE sh_contrats SET statut='resilie', resilie_le=now(), motif_resiliation=$2 WHERE id=$1`, [c.id, motif]);
      await db.query(`UPDATE sh_abonnements SET statut='termine' WHERE contrat_id=$1`, [c.id]);
      await journal(db, req.u, 'Contrat résilié', c.reference, `motif : ${motif}`, c.hopital_id);
      return (await db.query('SELECT * FROM sh_contrats WHERE id=$1', [c.id])).rows[0];
    });
  }));
  api.get('/crm/contrats/:id/pdf', async (req, res, next) => {
    try {
      const c = await contratComplet(idPositif(req.params.id));
      const d = c.devis_id ? (await pool.query('SELECT * FROM sh_devis WHERE id=$1', [c.devis_id])).rows[0] : null;
      const m = d ? await montantsDevis(pool, d) : null;
      const pdf = await documentCommercial({ type: 'contrat', titre: 'Contrat de service', reference: c.reference, client: await clientDe(c.organisation_id), devise: d?.devise || 'CAD',
        champs: [['Objet', c.titre], ['Statut', c.statut], ['Début', dateFr(jour(c.date_debut), req.langue)], ['Fin', dateFr(jour(c.date_fin), req.langue)], ['Durée', `${c.duree_mois} mois`],
          ['Renouvellement', c.renouvellement_auto ? `automatique, préavis de ${c.preavis_jours} jours` : 'sur décision expresse'], ['Devis de référence', d ? `v${d.version}` : '—'],
          ['Signature', c.statut === 'signe' ? `${c.signe_par} · ${dateFr(c.signe_le, req.langue)} · ${c.document_ref}` : 'non signé']],
        lignes: m?.lignes, totaux: m, signatures: c.statut !== 'signe',
        mentions: ['Le service est hébergé et exploité selon les exigences de la Loi 25 convenues entre les parties ; aucune donnée de patient n’est traitée par la console SH.',
          'Modèle généré par Arrimo.SH, à faire valider juridiquement avant usage. La signature est obtenue hors plateforme puis consignée avec la référence du document signé.'] }, {...(await require('./parametres').envEffectif(pool, env)),SH_DOCUMENT_LANGUE:req.langue});
      await journal(pool, req.u, 'Contrat téléchargé (PDF)', c.reference, null, c.hopital_id);
      envoyerPdf(res, pdf, `contrat-${c.reference}`);
    } catch (e) { next(e); }
  });

  /* ------------------------------------------------------------ facturation */
  const SELECT_FACTURE = `SELECT f.*, o.nom client, h.nom hopital, COALESCE(p.paye,0)::numeric(14,2) paye,
      (f.total - COALESCE(p.paye,0))::numeric(14,2) solde,
      CASE WHEN f.statut='annulee' THEN 'annulee' WHEN f.statut='brouillon' THEN 'brouillon'
        WHEN COALESCE(p.paye,0) >= f.total THEN 'payee' WHEN f.echeance_le < now()::date THEN 'en_retard'
        WHEN COALESCE(p.paye,0) > 0 THEN 'partiellement_payee' ELSE 'emise' END etat
    FROM sh_factures f JOIN sh_crm_organisations o ON o.id=f.organisation_id LEFT JOIN hopitaux h ON h.id=f.hopital_id
    LEFT JOIN (SELECT facture_id, sum(montant) paye FROM sh_paiements GROUP BY facture_id) p ON p.facture_id=f.id`;
  const facture = async (id, db = pool) => {
    const f = (await db.query(`${SELECT_FACTURE} WHERE f.id=$1`, [id])).rows[0];
    if (!f) throw erreur(404, 'Facture introuvable.');
    return f;
  };
  api.get('/facturation/abonnements', route(async () => (await pool.query(`SELECT a.*, o.nom client, c.reference contrat,
    (SELECT sum((l->>'montant')::numeric) FROM jsonb_array_elements(a.lignes) l)::numeric(14,2) montant_periode
    FROM sh_abonnements a JOIN sh_crm_organisations o ON o.id=a.organisation_id JOIN sh_contrats c ON c.id=a.contrat_id ORDER BY a.statut, a.prochaine_facture_le`)).rows));
  api.put('/facturation/abonnements/:id', route(async (req) => {
    const statut = String(req.body.statut || '');
    if (!['actif', 'suspendu', 'termine'].includes(statut)) throw erreur(400, 'Statut d’abonnement invalide.');
    const { rows } = await pool.query('UPDATE sh_abonnements SET statut=$2 WHERE id=$1 RETURNING *', [idPositif(req.params.id), statut]);
    if (!rows[0]) throw erreur(404, 'Abonnement introuvable.');
    await journal(pool, req.u, 'Abonnement modifié', rows[0].libelle, statut);
    return rows[0];
  }));
  /** Facture la prochaine période d'un abonnement actif (une seule facture par période, même en cas de double clic). */
  async function facturerAbonnement(db, abonnementId, u) {
    const a = (await db.query('SELECT a.*, o.hopital_id FROM sh_abonnements a JOIN sh_crm_organisations o ON o.id=a.organisation_id WHERE a.id=$1 FOR UPDATE OF a', [abonnementId])).rows[0];
    if (!a) throw erreur(404, 'Abonnement introuvable.');
    if (a.statut !== 'actif') throw erreur(409, 'Seul un abonnement actif se facture.');
    const debut = jour(a.prochaine_facture_le);
    if (a.fin && debut > jour(a.fin)) throw erreur(409, 'La période suivante dépasse la fin du contrat : renouvelez-le d’abord.');
    const finPeriode = ajouterJours(ajouterMois(debut, PERIODES_MOIS[a.periodicite]), -1);
    const lignes = lignesPropres(a.lignes,new Map(),a.devise);
    const t = totaux(lignes, await taxesClient(db, a.organisation_id,debut),a.devise);
    const f = (await db.query(`INSERT INTO sh_factures(organisation_id,hopital_id,contrat_id,abonnement_id,periode_debut,periode_fin,lignes,devise,sous_total,taxes,total,cree_par)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (abonnement_id, periode_debut) WHERE abonnement_id IS NOT NULL DO NOTHING RETURNING id`,
    [a.organisation_id, a.hopital_id, a.contrat_id, a.id, debut, finPeriode, JSON.stringify(lignes), a.devise, t.sous_total, JSON.stringify(t.taxes), t.total, u.id])).rows[0];
    await db.query('UPDATE sh_abonnements SET prochaine_facture_le=$2 WHERE id=$1', [a.id, ajouterJours(finPeriode, 1)]);
    if (f) await journal(db, u, 'Facture d’abonnement préparée', a.libelle, `${debut} → ${finPeriode} · ${t.total} ${a.devise}`, a.hopital_id);
    return f ? f.id : null;
  }
  api.post('/facturation/abonnements/:id/facturer', route(async (req) => {
    const id = await transaction(pool, (db) => facturerAbonnement(db, idPositif(req.params.id), req.u));
    return id ? facture(id) : { deja_facturee: true };
  }));
  api.post('/facturation/generer', route(async (req) => {
    const dus = (await pool.query(`SELECT id FROM sh_abonnements WHERE statut='actif' AND prochaine_facture_le <= now()::date AND (fin IS NULL OR prochaine_facture_le <= fin)`)).rows;
    const creees = [], bloquees = [];
    // Un profil fiscal manquant bloque son seul abonnement, pas la génération des autres.
    for (const a of dus) {
      try { const id = await transaction(pool, (db) => facturerAbonnement(db, a.id, req.u)); if (id) creees.push(id); }
      catch (e) { if (!/^(profil_fiscal_|region_fiscale_|taux_fiscal_)/.test(e.code || '')) throw e; bloquees.push({ abonnement_id: a.id, code: e.code, message: e.message }); }
    }
    return { abonnements: dus.length, factures_creees: creees.length, ids: creees, bloquees };
  }));
  api.get('/facturation/factures', route(async (req) => {
    const etat = ['brouillon', 'emise', 'partiellement_payee', 'payee', 'en_retard', 'annulee'].includes(req.query.etat) ? req.query.etat : null;
    return (await pool.query(`SELECT * FROM (${SELECT_FACTURE}) x WHERE ($1::text IS NULL OR x.etat=$1) AND ($2::bigint IS NULL OR x.organisation_id=$2)
      ORDER BY x.cree_le DESC LIMIT 1000`, [etat, idPositif(req.query.organisation_id)])).rows;
  }));
  api.get('/facturation/factures/:id', route(async (req) => {
    const f = await facture(idPositif(req.params.id));
    return { ...f, paiements: (await pool.query('SELECT p.*, u.nom saisi_par_nom FROM sh_paiements p LEFT JOIN sh_utilisateurs u ON u.id=p.saisi_par WHERE facture_id=$1 ORDER BY recu_le, id', [f.id])).rows };
  }));
  api.post('/facturation/factures', route(async (req) => {
    const org = idPositif(req.body.organisation_id);
    const o = (await pool.query('SELECT * FROM sh_crm_organisations WHERE id=$1', [org])).rows[0];
    if (!o) throw erreur(404, 'Organisation introuvable.');
    const devise=require('./international').choisirDevise(o.pays_code,req.body.devise);
    const lignes = lignesPropres(req.body.lignes, new Map((await pool.query('SELECT * FROM sh_tarifs WHERE actif')).rows.map((t) => [t.code, { ...t, prix_unitaire: Number(t.prix_unitaire) }])),devise);
    const t = totaux(lignes, await taxesClient(pool, org, aujourdhui()),devise);
    const { rows } = await pool.query(`INSERT INTO sh_factures(organisation_id,hopital_id,lignes,devise,sous_total,taxes,total,note,cree_par)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [org, o.hopital_id, JSON.stringify(lignes), devise, t.sous_total, JSON.stringify(t.taxes), t.total, texte(req.body.note, 1000), req.u.id]);
    await journal(pool, req.u, 'Facture préparée', o.nom, `${t.total} · brouillon`, o.hopital_id);
    return facture(rows[0].id);
  }));
  api.post('/facturation/factures/:id/emettre', route(async (req) => transaction(pool, async (db) => {
    const f = (await db.query('SELECT f.*, a.delai_paiement_jours FROM sh_factures f LEFT JOIN sh_abonnements a ON a.id=f.abonnement_id WHERE f.id=$1 FOR UPDATE OF f', [idPositif(req.params.id)])).rows[0];
    if (!f) throw erreur(404, 'Facture introuvable.');
    if (f.statut !== 'brouillon') throw erreur(409, 'Seule une facture brouillon peut être émise.');
    const emise = aujourdhui();
    // Taxes recalculées à l'émission : la province du client a pu être complétée depuis le brouillon.
    const lignes = lignesPropres(f.lignes,new Map(),f.devise);
    const t = totaux(lignes, await taxesClient(db, f.organisation_id, emise),f.devise);
    // Équivalent CAD informatif, figé à l'émission ; sans taux officiel récent, il est déclaré indisponible.
    const taux = f.devise === 'CAD' ? null : await change.tauxPour(db, f.devise, emise);
    const equivalent = f.devise === 'CAD' ? null : taux ? { devise: f.devise, cad_par_unite: String(taux.cad_par_unite), jour: jourDe(taux.jour), source_nom: taux.source_nom,
      source_url: taux.source_url, serie: taux.serie, total_cad: Number((t.total * Number(taux.cad_par_unite)).toFixed(2)) } : { devise: f.devise, indisponible: true };
    const numero = await prochainNumero(db, 'FAC', emise.slice(0, 4));
    await db.query(`UPDATE sh_factures SET statut='emise', numero=$2, emise_le=$3, echeance_le=$4, sous_total=$5, taxes=$6, total=$7, change=$8 WHERE id=$1`,
      [f.id, numero, emise, jourOuNull(req.body.echeance_le) || ajouterJours(emise, f.delai_paiement_jours ?? 30), t.sous_total, JSON.stringify(t.taxes), t.total, equivalent && JSON.stringify(equivalent)]);
    await journal(db, req.u, 'Facture émise', numero, `${t.total} ${f.devise}`, f.hopital_id);
    return facture(f.id, db);
  })));
  api.post('/facturation/factures/:id/annuler', route(async (req) => {
    const motif = texte(req.body.motif, 500); if (!motif) throw erreur(400, 'Indiquez le motif de l’annulation.');
    return transaction(pool, async (db) => {
      const f = await facture(idPositif(req.params.id), db);
      if (f.statut === 'annulee') return f;
      if (Number(f.paye) > 0) throw erreur(409, 'Une facture avec un paiement enregistré ne peut pas être annulée.');
      await db.query(`UPDATE sh_factures SET statut='annulee', annulee_motif=$2 WHERE id=$1`, [f.id, motif]);
      await journal(db, req.u, 'Facture annulée', f.numero || `brouillon ${f.id}`, `motif : ${motif}`, f.hopital_id);
      return facture(f.id, db);
    });
  }));
  api.post('/facturation/factures/:id/paiements', route(async (req) => transaction(pool, async (db) => {
    const id = idPositif(req.params.id);
    await db.query('SELECT 1 FROM sh_factures WHERE id=$1 FOR UPDATE', [id]);
    const f = await facture(id, db);
    if (!['emise'].includes(f.statut)) throw erreur(409, 'Le paiement s’enregistre sur une facture émise.');
    const montant = Number(req.body.montant);
    if (!Number.isFinite(montant) || montant <= 0) throw erreur(400, 'Montant de paiement invalide.');
    verifierMontantDevise(montant,f.devise);
    if (cents(montant) > cents(f.solde)) throw erreur(409, `Le paiement dépasse le solde dû (${f.solde} ${f.devise}).`);
    const mode = ['virement', 'cheque', 'carte', 'prelevement', 'autre'].includes(req.body.mode) ? req.body.mode : null;
    if (!mode) throw erreur(400, 'Mode de paiement invalide.');
    await db.query('INSERT INTO sh_paiements(facture_id,montant,recu_le,mode,reference,saisi_par) VALUES($1,$2,$3,$4,$5,$6)',
      [id, versMontant(cents(montant)), jourOuNull(req.body.recu_le) || aujourdhui(), mode, texte(req.body.reference, 120), req.u.id]);
    await journal(db, req.u, 'Paiement enregistré', f.numero, `${montant} ${f.devise} · ${mode}`, f.hopital_id);
    return facture(id, db);
  })));
  api.get('/facturation/factures/:id/pdf', async (req, res, next) => {
    try {
      const f = await facture(idPositif(req.params.id));
      if (f.statut === 'brouillon') throw erreur(409, 'Émettez la facture avant de produire son PDF.');
      const pdf = await documentCommercial({ type: 'facture', titre: f.statut === 'annulee' ? 'Facture annulée' : 'Facture', reference: f.numero, client: await clientDe(f.organisation_id), devise: f.devise,
        champs: [['Émise le', dateFr(jour(f.emise_le), req.langue)], ['Échéance', dateFr(jour(f.echeance_le), req.langue)], ['Période', f.periode_debut ? `${dateFr(jour(f.periode_debut), req.langue)} au ${dateFr(jour(f.periode_fin), req.langue)}` : '—'], ['État', f.etat]],
        lignes: f.lignes, totaux: { sous_total: f.sous_total, taxes: f.taxes, total: f.total, paye: f.paye, solde: f.solde },
        mentions: [f.statut === 'annulee' ? `Facture annulée : ${f.annulee_motif}.` : 'Paiement par virement ou chèque à l’ordre de l’émetteur, en indiquant le numéro de facture.',
          ...(f.change ? [f.change.indisponible ? 'Équivalent en dollars canadiens non indiqué : aucun taux officiel récent de la Banque du Canada pour cette devise.'
            : `Équivalent informatif : ${f.change.total_cad} CAD au taux ${f.change.cad_par_unite} CAD/${f.change.devise} du ${f.change.jour} (${f.change.source_nom}, ${f.change.serie}). Le montant dû reste en ${f.change.devise}.`] : []),
          'Aucune donnée de patient.'] }, {...(await require('./parametres').envEffectif(pool, env)),SH_DOCUMENT_LANGUE:req.langue});
      await journal(pool, req.u, 'Facture téléchargée (PDF)', f.numero, null, f.hopital_id);
      envoyerPdf(res, pdf, `facture-${f.numero}`);
    } catch (e) { next(e); }
  });
  api.get('/facturation/resume', route(async () => {
    const etats = (await pool.query(`SELECT etat, devise, count(*)::int n, sum(total)::numeric(14,2) total, sum(solde)::numeric(14,2) solde FROM (${SELECT_FACTURE}) x GROUP BY etat, devise`)).rows;
    const mrr = (await pool.query(`SELECT devise, sum(CASE periodicite WHEN 'mensuel' THEN m ELSE m/12 END)::numeric(14,2) mrr FROM
      (SELECT a.devise, a.periodicite, (SELECT sum((l->>'montant')::numeric) FROM jsonb_array_elements(a.lignes) l) m FROM sh_abonnements a WHERE statut='actif') s GROUP BY devise`)).rows;
    const encaisse = (await pool.query(`SELECT f.devise, sum(p.montant)::numeric(14,2) total FROM sh_paiements p JOIN sh_factures f ON f.id=p.facture_id
      WHERE p.recu_le >= date_trunc('month', now())::date GROUP BY f.devise`)).rows;
    const aFacturer = (await pool.query(`SELECT count(*)::int n FROM sh_abonnements WHERE statut='actif' AND prochaine_facture_le <= now()::date AND (fin IS NULL OR prochaine_facture_le <= fin)`)).rows[0].n;
    return { etats, mrr, encaisse_mois: encaisse, abonnements_a_facturer: aFacturer };
  }));

  /* ------------------------------------------------------------ personnel : équipes et permissions */
  api.get('/personnel', route(async () => (await pool.query(`SELECT u.id,u.nom,u.role,u.fonction,${presence.expression()} presence FROM sh_utilisateurs u WHERE u.actif AND u.archive_le IS NULL ORDER BY u.nom`)).rows));
  api.get('/permissions', route(async () => ({ roles: ROLES_SH, routes: Object.entries(PERMISSIONS).map(([route, roles]) => ({ route, roles })) })));
  api.get('/equipes', route(async () => (await pool.query(`SELECT e.*, COALESCE(json_agg(json_build_object('utilisateur_id',u.id,'nom',u.nom,'role',u.role,'chef',m.chef) ORDER BY m.chef DESC, u.nom)
      FILTER (WHERE u.id IS NOT NULL), '[]') membres FROM sh_equipes e LEFT JOIN sh_equipes_membres m ON m.equipe_id=e.id LEFT JOIN sh_utilisateurs u ON u.id=m.utilisateur_id
    GROUP BY e.id ORDER BY e.nom`)).rows));
  async function enregistrerEquipe(req, id) {
    const nom = texte(req.body.nom, 120); if (!nom) throw erreur(400, 'Nom de l’équipe requis.');
    const membres = Array.isArray(req.body.membres) ? req.body.membres : [];
    if (membres.length > 200) throw erreur(400, 'Trop de membres.');
    return transaction(pool, async (c) => {
      const e = id
        ? (await c.query('UPDATE sh_equipes SET nom=$2, description=$3 WHERE id=$1 RETURNING *', [id, nom, texte(req.body.description, 1000)])).rows[0]
        : (await c.query('INSERT INTO sh_equipes(nom, description) VALUES($1,$2) RETURNING *', [nom, texte(req.body.description, 1000)])).rows[0];
      if (!e) throw erreur(404, 'Équipe introuvable.');
      await c.query('DELETE FROM sh_equipes_membres WHERE equipe_id=$1', [e.id]);
      for (const m of membres) {
        const uid = idPositif(m.utilisateur_id);
        if (!uid || !(await c.query('SELECT 1 FROM sh_utilisateurs WHERE id=$1', [uid])).rowCount) throw erreur(400, 'Membre inconnu.');
        await c.query('INSERT INTO sh_equipes_membres(equipe_id,utilisateur_id,chef) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [e.id, uid, m.chef === true]);
      }
      await journal(c, req.u, id ? 'Équipe modifiée' : 'Équipe créée', nom, nombre(membres.length, 'membre'));
      return e;
    }).catch((e) => { if (e.code === '23505') throw erreur(409, 'Une équipe porte déjà ce nom.'); throw e; });
  }
  api.post('/equipes', route((req) => enregistrerEquipe(req, null)));
  api.put('/equipes/:id', route((req) => enregistrerEquipe(req, idPositif(req.params.id))));

  /* ------------------------------------------------------------ documents */
  const RATTACHEMENTS = ['hopital_id', 'organisation_id', 'contrat_id', 'projet_id', 'ticket_id'];
  api.get('/documents', route(async (req) => {
    const conds = ['d.archive_le IS NULL', 'd.version = (SELECT max(x.version) FROM sh_documents x WHERE x.groupe = d.groupe AND x.archive_le IS NULL)']; const vals = [];
    for (const k of RATTACHEMENTS) if (idPositif(req.query[k])) { vals.push(idPositif(req.query[k])); conds.push(`d.${k} = $${vals.length}`); }
    if (documents.CATEGORIES[req.query.categorie]) { vals.push(req.query.categorie); conds.push(`d.categorie = $${vals.length}`); }
    const rows = (await pool.query(`SELECT d.id, d.nom, d.categorie, d.version, d.type_mime, d.taille, d.confidentiel, d.cree_le, d.groupe,
        ${RATTACHEMENTS.map((k) => `d.${k}`).join(',')}, u.nom depose_par_nom, h.nom hopital, o.nom organisation,
        (SELECT count(*)::int FROM sh_documents x WHERE x.groupe = d.groupe) versions
      FROM sh_documents d LEFT JOIN sh_utilisateurs u ON u.id=d.depose_par LEFT JOIN hopitaux h ON h.id=d.hopital_id LEFT JOIN sh_crm_organisations o ON o.id=d.organisation_id
      WHERE ${conds.join(' AND ')} ORDER BY d.cree_le DESC LIMIT 500`, vals)).rows;
    return rows.filter((d) => documents.peutLire(req.u.role, d));
  }));
  api.get('/documents/:id/versions', route(async (req) => {
    const d = (await pool.query('SELECT * FROM sh_documents WHERE id=$1', [idPositif(req.params.id)])).rows[0];
    if (!d || !documents.peutLire(req.u.role, d)) throw erreur(404, 'Document introuvable.');
    return (await pool.query(`SELECT d.id, d.nom, d.version, d.taille, d.empreinte, d.cree_le, d.archive_le, u.nom depose_par_nom FROM sh_documents d
      LEFT JOIN sh_utilisateurs u ON u.id=d.depose_par WHERE d.groupe=$1 ORDER BY d.version DESC`, [d.groupe])).rows;
  }));
  api.post('/documents', route(async (req) => {
    const categorie = String(req.body.categorie || '');
    if (!documents.CATEGORIES[categorie]) throw erreur(400, 'Catégorie de document invalide.');
    if (req.u.role !== 'administration' && !documents.CATEGORIES[categorie].includes(req.u.role)) throw erreur(403, 'Votre rôle ne permet pas de déposer dans cette catégorie.');
    const f = documents.valider(req.body.nom, req.body.contenu_base64);
    const rattache = Object.fromEntries(RATTACHEMENTS.map((k) => [k, idPositif(req.body[k])]));
    const remplace = idPositif(req.body.remplace_id);
    const stocke = await documents.ecrire(f.octets, env);
    return transaction(pool, async (c) => {
      let groupe; let version = 1;
      if (remplace) {
        const ancien = (await c.query('SELECT * FROM sh_documents WHERE id=$1', [remplace])).rows[0];
        if (!ancien || !documents.peutLire(req.u.role, ancien)) throw erreur(404, 'Document à remplacer introuvable.');
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ancien.groupe]);
        groupe = ancien.groupe;
        version = (await c.query('SELECT max(version)+1 v FROM sh_documents WHERE groupe=$1', [groupe])).rows[0].v;
        for (const k of RATTACHEMENTS) rattache[k] = rattache[k] || ancien[k];
      } else groupe = `doc-${stocke.stockage_ref.slice(0, 24)}`;
      const { rows } = await c.query(`INSERT INTO sh_documents(nom,categorie,stockage_ref,version,depose_par,type_mime,taille,empreinte,confidentiel,groupe,${RATTACHEMENTS.join(',')})
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, nom, categorie, version, taille, empreinte, groupe, cree_le`,
      [f.nom, categorie, stocke.stockage_ref, version, req.u.id, f.mime, f.octets.length, stocke.empreinte, req.body.confidentiel === true, groupe, ...RATTACHEMENTS.map((k) => rattache[k])])
        .catch((e) => { if (e.code === '23503') throw erreur(400, 'Élément de rattachement introuvable.'); throw e; });
      await journal(c, req.u, version > 1 ? 'Nouvelle version de document' : 'Document déposé', f.nom, `${categorie} · v${version} · sha256 ${stocke.empreinte.slice(0, 12)}`, rattache.hopital_id);
      return rows[0];
    });
  }));
  api.get('/documents/:id/fichier', async (req, res, next) => {
    try {
      const d = (await pool.query('SELECT * FROM sh_documents WHERE id=$1', [idPositif(req.params.id)])).rows[0];
      if (!d || !documents.peutLire(req.u.role, d)) throw erreur(404, 'Document introuvable.');
      const contenu = await documents.lire(d, env);
      await journal(pool, req.u, 'Document téléchargé', d.nom, `v${d.version}`, d.hopital_id);
      res.set({ 'Content-Type': d.type_mime || 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(d.nom)}`,
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }).send(contenu);
    } catch (e) { next(e); }
  });
  api.post('/documents/:id/archiver', route(async (req) => {
    const { rows } = await pool.query('UPDATE sh_documents SET archive_le=now() WHERE id=$1 AND archive_le IS NULL RETURNING nom, version, hopital_id', [idPositif(req.params.id)]);
    if (!rows[0]) throw erreur(404, 'Document introuvable ou déjà archivé.');
    await journal(pool, req.u, 'Document archivé', rows[0].nom, `v${rows[0].version} · fichier conservé`, rows[0].hopital_id);
    return { ok: true };
  }));

  /* ------------------------------------------------------------ hébergement et supervision */
  function etatSauvegardes() {
    const f = String(env.SH_SAUVEGARDES_ETAT || '').trim();
    if (!f) return { configure: false };
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      return { configure: true, genere_le: j.genere_le, environnements: j.environnements || {} };
    } catch { return { configure: true, illisible: true }; }
  }
  api.get('/hebergement', route(async () => {
    const releves = (await pool.query(`SELECT DISTINCT ON (environnement) environnement, ok, latence_ms, version, detail, quand FROM sh_supervision ORDER BY environnement, quand DESC`)).rows;
    const dispo = (await pool.query(`SELECT environnement, count(*)::int n, count(*) FILTER (WHERE ok)::int ok, round(avg(latence_ms) FILTER (WHERE ok))::int latence
      FROM sh_supervision WHERE quand > now() - interval '24 hours' GROUP BY environnement`)).rows;
    const hopitaux = (await pool.query(`SELECT environnement, count(*)::int n, count(*) FILTER (WHERE statut='actif')::int actifs FROM hopitaux GROUP BY environnement`)).rows;
    const sauvegardes = etatSauvegardes();
    return {
      environnements: cibles().map((c) => {
        const r = releves.find((x) => x.environnement === c.code); const d = dispo.find((x) => x.environnement === c.code); const h = hopitaux.find((x) => x.environnement === c.code);
        return { code: c.code, nom: c.nom, public: c.public, dernier_releve: r || null,
          disponibilite_24h: d ? Math.round((1000 * d.ok) / d.n) / 10 : null, releves_24h: d ? d.n : 0, latence_moyenne_ms: d ? d.latence : null,
          hopitaux: h ? h.n : 0, hopitaux_actifs: h ? h.actifs : 0, sauvegarde: sauvegardes.environnements?.[c.code] || null };
      }),
      sauvegardes: { configure: sauvegardes.configure, illisible: !!sauvegardes.illisible, genere_le: sauvegardes.genere_le || null },
      console: { version: require('../../package.json').version, node: process.version },
    };
  }));
  api.post('/hebergement/verifier', route(async () => verifierEnvironnements(pool, cibles())));

  /* ------------------------------------------------------------ rapports */
  api.get('/rapports/indicateurs', route(async (req) => {
    const r = req.u.role; const voit = (roles) => r === 'administration' || roles.includes(r); const out = { genere_le: new Date().toISOString() };
    if (voit(['commercial', 'finance'])) {
      out.pipeline = (await pool.query(`SELECT statut, devise, count(*)::int n, COALESCE(sum(montant),0)::numeric(14,2) valeur,
        COALESCE(sum(montant*probabilite/100.0),0)::numeric(14,2) ponderee FROM sh_opportunites GROUP BY statut, devise ORDER BY devise,statut`)).rows;
      const conv = (await pool.query(`SELECT count(*) FILTER (WHERE statut='gagnee')::int gagnees, count(*) FILTER (WHERE statut IN ('gagnee','perdue'))::int closes FROM sh_opportunites`)).rows[0];
      out.taux_conversion = conv.closes ? Math.round((1000 * conv.gagnees) / conv.closes) / 10 : null;
      out.devis = (await pool.query('SELECT statut, count(*)::int n FROM sh_devis GROUP BY statut')).rows;
      out.contrats = (await pool.query(`SELECT count(*) FILTER (WHERE statut='signe')::int actifs, count(*) FILTER (WHERE statut='signe' AND renouvellement_le <= now()::date + 90)::int a_renouveler,
        count(*) FILTER (WHERE statut IN ('negociation','pret_a_signer'))::int en_cours FROM sh_contrats`)).rows[0];
      out.relances_en_retard = (await pool.query('SELECT count(*)::int n FROM sh_activites WHERE terminee_le IS NULL AND echeance < now()')).rows[0].n;
    }
    if (voit(['finance'])) {
      const f = (await pool.query(`SELECT etat, devise, count(*)::int n, sum(total)::numeric(14,2) total, sum(solde)::numeric(14,2) solde FROM (${SELECT_FACTURE}) x GROUP BY etat, devise`)).rows;
      out.factures = f;
      out.mrr = (await pool.query(`SELECT devise, sum(CASE periodicite WHEN 'mensuel' THEN m ELSE m/12 END)::numeric(14,2) mrr FROM
        (SELECT a.devise, a.periodicite, (SELECT sum((l->>'montant')::numeric) FROM jsonb_array_elements(a.lignes) l) m FROM sh_abonnements a WHERE statut='actif') s GROUP BY devise`)).rows;
      out.delai_moyen_paiement_jours = (await pool.query(`SELECT round(avg(p.recu_le - f.emise_le))::int j FROM sh_paiements p JOIN sh_factures f ON f.id=p.facture_id`)).rows[0].j;
    }
    if (voit(['implantation', 'support', 'formation'])) {
      out.projets = (await pool.query('SELECT statut, count(*)::int n FROM sh_projets GROUP BY statut')).rows;
      out.taches = (await pool.query(`SELECT count(*) FILTER (WHERE statut NOT IN ('terminee','annulee'))::int ouvertes, count(*) FILTER (WHERE statut NOT IN ('terminee','annulee') AND echeance < now()::date)::int en_retard,
        count(*) FILTER (WHERE statut='terminee')::int terminees FROM sh_taches`)).rows[0];
      out.hopitaux = (await pool.query('SELECT statut, environnement, count(*)::int n FROM hopitaux GROUP BY statut, environnement')).rows;
      out.formation = (await pool.query(`SELECT h.id, h.nom, count(fe.id)::int elements, count(fe.id) FILTER (WHERE fe.faite)::int faits,
        (SELECT count(*)::int FROM sh_formation_participants p JOIN sh_formation_sessions s ON s.id=p.session_id WHERE s.hopital_id=h.id AND p.valide) participants_valides
        FROM hopitaux h LEFT JOIN formation_elements fe ON fe.hopital_id=h.id GROUP BY h.id ORDER BY h.nom`)).rows;
    }
    if (voit(['support', 'implantation'])) {
      out.support = (await pool.query(`SELECT count(*) FILTER (WHERE statut NOT IN ('resolu','ferme'))::int ouverts,
        count(*) FILTER (WHERE statut NOT IN ('resolu','ferme') AND echeance < now())::int hors_delai,
        count(*) FILTER (WHERE type='incident' AND statut NOT IN ('resolu','ferme'))::int incidents_ouverts,
        round(avg(EXTRACT(EPOCH FROM (resolu_le - cree_le))/3600) FILTER (WHERE resolu_le IS NOT NULL))::int resolution_moyenne_heures,
        count(*) FILTER (WHERE prise_en_charge_echeance IS NOT NULL AND (prise_en_charge_le IS NOT NULL OR prise_en_charge_echeance<=now()))::int prises_en_charge_sla_eligibles,
        count(*) FILTER (WHERE prise_en_charge_echeance IS NOT NULL AND (prise_en_charge_le IS NOT NULL OR prise_en_charge_echeance<=now()) AND prise_en_charge_le<=prise_en_charge_echeance)::int prises_en_charge_sla_respectees,
        count(*) FILTER (WHERE resolution_echeance IS NOT NULL AND (resolu_le IS NOT NULL OR resolution_echeance<=now()))::int resolutions_sla_eligibles,
        count(*) FILTER (WHERE resolution_echeance IS NOT NULL AND (resolu_le IS NOT NULL OR resolution_echeance<=now()) AND resolu_le<=resolution_echeance)::int resolutions_sla_respectees,
        round(100.0*count(*) FILTER (WHERE prise_en_charge_echeance IS NOT NULL AND (prise_en_charge_le IS NOT NULL OR prise_en_charge_echeance<=now()) AND prise_en_charge_le<=prise_en_charge_echeance)/NULLIF(count(*) FILTER (WHERE prise_en_charge_echeance IS NOT NULL AND (prise_en_charge_le IS NOT NULL OR prise_en_charge_echeance<=now())),0),1)::numeric prise_en_charge_sla_pct,
        round(100.0*count(*) FILTER (WHERE resolution_echeance IS NOT NULL AND (resolu_le IS NOT NULL OR resolution_echeance<=now()) AND resolu_le<=resolution_echeance)/NULLIF(count(*) FILTER (WHERE resolution_echeance IS NOT NULL AND (resolu_le IS NOT NULL OR resolution_echeance<=now())),0),1)::numeric resolution_sla_pct
        FROM sh_support_tickets`)).rows[0];
    }
    return out;
  }));
  const csv = (lignes) => lignes.map((l) => l.map((v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; }).join(';')).join('\r\n');
  api.get('/rapports/export', async (req, res, next) => {
    try {
      const section = String(req.query.section || '');
      let lignes;
      if (section === 'factures') {
        if (!ROLES_FACTURATION.includes(req.u.role)) throw erreur(403, 'Votre rôle ne permet pas cet export.');
        lignes = [['numero', 'client', 'etat', 'emise_le', 'echeance_le', 'sous_total', 'taxes', 'total', 'paye', 'solde', 'devise'],
          ...(await pool.query(`SELECT * FROM (${SELECT_FACTURE}) x WHERE statut<>'brouillon' ORDER BY emise_le`)).rows.map((f) => [f.numero, f.client, f.etat, jour(f.emise_le), jour(f.echeance_le), f.sous_total,
            (f.taxes || []).reduce((n, t) => n + Number(t.montant), 0).toFixed(2), f.total, f.paye, f.solde, f.devise])];
      } else if (section === 'pipeline') {
        if (!['administration', 'commercial', 'finance'].includes(req.u.role)) throw erreur(403, 'Votre rôle ne permet pas cet export.');
        lignes = [['organisation', 'opportunite', 'statut', 'montant', 'devise', 'probabilite', 'echeance'],
          ...(await pool.query('SELECT p.*, o.nom organisation FROM sh_opportunites p JOIN sh_crm_organisations o ON o.id=p.organisation_id ORDER BY o.nom')).rows
            .map((o) => [o.organisation, o.titre, o.statut, o.montant, o.devise, o.probabilite, jour(o.echeance)])];
      } else if (section === 'support') {
        if (!['administration', 'support', 'implantation'].includes(req.u.role)) throw erreur(403, 'Votre rôle ne permet pas cet export.');
        lignes = [['ticket', 'etablissement', 'type', 'gravite', 'priorite', 'statut', 'cree_le', 'resolu_le', 'prise_en_charge_echeance', 'prise_en_charge_le', 'prise_en_charge_respectee', 'resolution_echeance', 'resolution_le', 'resolution_respectee'],
          ...(await pool.query('SELECT t.*, h.nom hopital FROM sh_support_tickets t JOIN hopitaux h ON h.id=t.hopital_id ORDER BY t.cree_le')).rows
            .map((t) => [t.id, t.hopital, t.type, t.gravite, t.priorite, t.statut, t.cree_le?.toISOString(), t.resolu_le?.toISOString(), t.prise_en_charge_echeance?.toISOString(),t.prise_en_charge_le?.toISOString(),t.prise_en_charge_echeance&&t.prise_en_charge_le? t.prise_en_charge_le<=t.prise_en_charge_echeance:'',t.resolution_echeance?.toISOString(),t.resolu_le?.toISOString(),t.resolution_echeance&&t.resolu_le?t.resolu_le<=t.resolution_echeance:''])];
      } else throw erreur(400, 'Section d’export inconnue : factures, pipeline ou support.');
      await journal(pool, req.u, 'Export de rapport', section, nombre(lignes.length - 1, 'ligne'));
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="arrimo-sh-${section}.csv"` }).send(`﻿${csv(lignes)}\r\n`);
    } catch (e) { next(e); }
  });

  /* ------------------------------------------------------------ formation : séances et participants */
  const ROLES_FORMATION = ['coordination', 'urgence', 'entretien', 'administration'];
  api.get('/hopitaux/:id/formation/sessions', route(async (req) => (await pool.query(`SELECT s.*, u.nom formateur,
      COALESCE(json_agg(p.* ORDER BY p.nom) FILTER (WHERE p.id IS NOT NULL), '[]') participants
    FROM sh_formation_sessions s LEFT JOIN sh_utilisateurs u ON u.id=s.formateur_id LEFT JOIN sh_formation_participants p ON p.session_id=s.id
    WHERE s.hopital_id=$1 GROUP BY s.id, u.nom ORDER BY s.debut`, [idPositif(req.params.id)])).rows));
  api.post('/hopitaux/:id/formation/sessions', route(async (req) => {
    const h = idPositif(req.params.id); const b = req.body;
    const debut = new Date(b.debut);
    if (!ROLES_FORMATION.includes(b.role) || Number.isNaN(debut.getTime())) throw erreur(400, 'Rôle formé et date de début requis.');
    const formateur = idPositif(b.formateur_id);
    return transaction(pool, async (c) => {
      await verifierDestinataire(c,formateur,'formation','hopital',h);
      const { rows } = await c.query(`INSERT INTO sh_formation_sessions(hopital_id,role,titre,debut,duree_minutes,lieu,formateur_id,cree_par) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [h, b.role, texte(b.titre, 160) || `Formation ${b.role}`, debut, Number(b.duree_minutes) || 90, texte(b.lieu, 200), formateur, req.u.id])
        .catch((e) => { if (e.code === '23503') throw erreur(404, 'Établissement ou formateur introuvable.'); if (e.code === '23514') throw erreur(400, 'Durée invalide (15 à 600 minutes).'); throw e; });
      if (formateur && formateur !== req.u.id) await notifier(c, formateur, { ressourceType:'hopital',ressourceId:h, type: 'formation', titre: `Séance de formation planifiée : ${rows[0].titre}`, lien: 'calendrier' });
      await journal(c, req.u, 'Séance de formation planifiée', rows[0].titre, debut.toISOString(), h);
      return rows[0];
    });
  }));
  api.put('/formation/sessions/:id', route(async (req) => {
    const s = (await pool.query('SELECT * FROM sh_formation_sessions WHERE id=$1', [idPositif(req.params.id)])).rows[0];
    if (!s) throw erreur(404, 'Séance introuvable.');
    const statut = req.body.statut ?? s.statut;
    if (!['planifiee', 'realisee', 'annulee'].includes(statut)) throw erreur(400, 'Statut de séance invalide.');
    const debut = req.body.debut ? new Date(req.body.debut) : s.debut;
    if (Number.isNaN(new Date(debut).getTime())) throw erreur(400, 'Date invalide.');
    const { rows } = await pool.query('UPDATE sh_formation_sessions SET statut=$2, debut=$3, lieu=$4 WHERE id=$1 RETURNING *', [s.id, statut, debut, req.body.lieu === undefined ? s.lieu : texte(req.body.lieu, 200)]);
    await journal(pool, req.u, 'Séance de formation modifiée', s.titre, statut, s.hopital_id);
    return rows[0];
  }));
  api.post('/formation/sessions/:id/participants', route(async (req) => {
    const s = (await pool.query('SELECT s.*, h.code_etab, h.environnement, h.relie FROM sh_formation_sessions s JOIN hopitaux h ON h.id=s.hopital_id WHERE s.id=$1', [idPositif(req.params.id)])).rows[0];
    if (!s) throw erreur(404, 'Séance introuvable.');
    let liste = Array.isArray(req.body.participants) ? req.body.participants : [];
    if (req.body.depuis_comptes === true) {
      // Comptes réellement créés dans l'environnement de l'établissement (nom, courriel, rôle ; aucun mot de passe).
      const cible = cibles().find((c) => c.code === s.environnement);
      if (!cible || !s.relie) throw erreur(409, 'L’établissement doit être relié à son environnement.');
      const ROLES_ARRIMO = { coordination: ['coordonnateur'], urgence: ['coordonnateur'], entretien: ['entretien'], administration: ['admin_etab'] }[s.role];
      liste = (await appeler(cible, 'GET', `/sh/etablissements/${s.code_etab}/comptes`)).filter((u) => ROLES_ARRIMO.includes(u.role)).map((u) => ({ nom: u.nom, courriel: u.courriel, role_arrimo: u.role }));
    }
    if (!liste.length || liste.length > 300) throw erreur(400, 'Ajoutez de 1 à 300 participants.');
    let ajoutes = 0;
    await transaction(pool, async (c) => {
      for (const p of liste) {
        const nom = texte(p.nom, 160); if (!nom) throw erreur(400, 'Chaque participant doit avoir un nom.');
        const r = await c.query(`INSERT INTO sh_formation_participants(session_id,nom,courriel,role_arrimo) VALUES($1,$2,lower($3),$4) ON CONFLICT DO NOTHING`,
          [s.id, nom, texte(p.courriel, 200), texte(p.role_arrimo, 40)]);
        ajoutes += r.rowCount;
      }
      await journal(c, req.u, 'Participants ajoutés à une séance', s.titre, nombre(ajoutes, 'participant'), s.hopital_id);
    });
    return { ajoutes };
  }));
  api.put('/formation/participants/:id', route(async (req) => {
    const p = (await pool.query('SELECT p.*, s.hopital_id, s.titre, s.statut statut_seance FROM sh_formation_participants p JOIN sh_formation_sessions s ON s.id=p.session_id WHERE p.id=$1', [idPositif(req.params.id)])).rows[0];
    if (!p) throw erreur(404, 'Participant introuvable.');
    const present = req.body.present === undefined ? p.present : req.body.present === true;
    const valide = req.body.valide === undefined ? p.valide : req.body.valide === true;
    if (valide && !present) throw erreur(409, 'Un participant absent ne peut pas être validé.');
    const { rows } = await pool.query(`UPDATE sh_formation_participants SET present=$2, valide=$3, note=$4,
      valide_par=CASE WHEN $3 THEN COALESCE(valide_par,$5) ELSE NULL END, valide_le=CASE WHEN $3 THEN COALESCE(valide_le,now()) ELSE NULL END WHERE id=$1 RETURNING *`,
    [p.id, present, valide, req.body.note === undefined ? p.note : texte(req.body.note, 500), req.u.email]);
    await journal(pool, req.u, valide ? 'Participant validé' : 'Participant modifié', `${p.titre} · ${p.nom}`, present ? 'présent' : 'absent', p.hopital_id);
    return rows[0];
  }));

  /* ------------------------------------------------------------ notifications et calendrier */
  api.get('/notifications', route(async (req) => {
    const rows = (await pool.query('SELECT * FROM sh_notifications WHERE utilisateur_id=$1 ORDER BY lu_le NULLS FIRST, cree_le DESC LIMIT 50', [req.u.id])).rows;
    // Rappels calculés : tâches attribuées en retard, une fois par jour et par tâche.
    const retard = (await pool.query(`SELECT id, titre FROM sh_taches WHERE responsable_id=$1 AND statut NOT IN ('terminee','annulee') AND echeance < now()::date`, [req.u.id])).rows;
    const jourJ = aujourdhui();
    for (const t of retard) {
      await notifier(pool, req.u.id, { type: 'rappel',ressourceType:'tache',ressourceId:t.id, titre: `Tâche en retard : ${t.titre}`, lien: 'taches', cle: `retard-${jourJ}-${t.id}` });
    }
    const non_lues = (await pool.query('SELECT count(*)::int n FROM sh_notifications WHERE utilisateur_id=$1 AND lu_le IS NULL', [req.u.id])).rows[0].n;
    const notifications=retard.length?(await pool.query('SELECT * FROM sh_notifications WHERE utilisateur_id=$1 ORDER BY lu_le NULLS FIRST, cree_le DESC LIMIT 50',[req.u.id])).rows:rows;
    return { non_lues, notifications:notifications.map(n=>({...n,titre:traduireSH(n.titre,req.langue||req.u.langue)})) };
  }));
  api.post('/notifications/lues', route(async (req) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(idPositif).filter(Boolean) : null;
    const r = await pool.query(`UPDATE sh_notifications SET lu_le=now() WHERE utilisateur_id=$1 AND lu_le IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2))`, [req.u.id, ids]);
    return { marquees: r.rowCount };
  }));
  api.get('/calendrier', route(async (req) => {
    const debut = jourOuNull(req.query.debut) || aujourdhui().slice(0, 8) + '01';
    const fin = jourOuNull(req.query.fin) || ajouterJours(ajouterMois(debut, 1), -1);
    if (fin < debut || ajouterMois(debut, 3) < fin) throw erreur(400, 'Période de 3 mois au plus.');
    const r = req.u.role; const voit = (roles) => r === 'administration' || roles.includes(r);
    const ev = [];
    const ajouter = (rows, type, vue) => rows.forEach((x) => ev.push({ type, vue, date: jour(x.d), titre: x.titre, detail: x.detail || null, statut: x.statut || null, id: x.id, a_moi: x.a_moi === true }));
    ajouter((await pool.query(`SELECT t.id, t.echeance d, t.titre, COALESCE(h.nom,o.nom) detail, t.statut, t.responsable_id=$3 a_moi FROM sh_taches t JOIN sh_projets p ON p.id=t.projet_id
      LEFT JOIN hopitaux h ON h.id=p.hopital_id LEFT JOIN sh_crm_organisations o ON o.id=p.organisation_id WHERE t.echeance BETWEEN $1 AND $2`, [debut, fin, req.u.id])).rows, 'tache', 'taches');
    ajouter((await pool.query(`SELECT j.id, j.echeance d, j.nom titre, p.nom detail, CASE WHEN j.termine_le IS NULL THEN 'a_faire' ELSE 'termine' END statut FROM sh_jalons j
      JOIN sh_projets p ON p.id=j.projet_id WHERE j.echeance BETWEEN $1 AND $2`, [debut, fin])).rows, 'jalon', 'projets');
    if (voit(['implantation', 'formation'])) ajouter((await pool.query(`SELECT s.id, (s.debut AT TIME ZONE $3)::date d, s.titre, h.nom detail, s.statut FROM sh_formation_sessions s JOIN hopitaux h ON h.id=s.hopital_id
      WHERE (s.debut AT TIME ZONE $3)::date BETWEEN $1 AND $2`, [debut, fin, process.env.SH_FUSEAU || 'America/Toronto'])).rows, 'formation', 'hopitaux');
    if (voit(['commercial'])) {
      ajouter((await pool.query(`SELECT a.id, (a.echeance AT TIME ZONE $3)::date d, a.titre, o.nom detail, CASE WHEN a.terminee_le IS NULL THEN 'a_faire' ELSE 'termine' END statut, a.responsable_id=$4 a_moi
        FROM sh_activites a LEFT JOIN sh_crm_organisations o ON o.id=a.organisation_id WHERE (a.echeance AT TIME ZONE $3)::date BETWEEN $1 AND $2`, [debut, fin, process.env.SH_FUSEAU || 'America/Toronto', req.u.id])).rows, 'relance', 'crm');
      ajouter((await pool.query(`SELECT c.id, c.renouvellement_le d, 'Préavis de renouvellement · ' || c.reference titre, o.nom detail, c.statut FROM sh_contrats c
        JOIN sh_opportunites p ON p.id=c.opportunite_id JOIN sh_crm_organisations o ON o.id=p.organisation_id WHERE c.renouvellement_le BETWEEN $1 AND $2`, [debut, fin])).rows, 'contrat', 'contrats');
    }
    if (voit(['finance'])) ajouter((await pool.query(`SELECT f.id, f.echeance_le d, 'Échéance ' || f.numero titre, o.nom detail, f.statut FROM sh_factures f JOIN sh_crm_organisations o ON o.id=f.organisation_id
      WHERE f.statut='emise' AND f.echeance_le BETWEEN $1 AND $2`, [debut, fin])).rows, 'facture', 'facturation');
    if (voit(['support', 'implantation'])) ajouter((await pool.query(`SELECT t.id, (t.echeance AT TIME ZONE $3)::date d, 'Échéance ticket · ' || t.titre titre, h.nom detail, t.statut FROM sh_support_tickets t
      JOIN hopitaux h ON h.id=t.hopital_id WHERE t.statut NOT IN ('resolu','ferme') AND (t.echeance AT TIME ZONE $3)::date BETWEEN $1 AND $2`, [debut, fin, process.env.SH_FUSEAU || 'America/Toronto'])).rows, 'ticket', 'support');
    return { debut, fin, evenements: ev.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type)) };
  }));

  /* ------------------------------------------------------------ projets : détail, jalons */
  api.get('/projets/:id', route(async (req) => {
    const id = idPositif(req.params.id);
    const p = (await pool.query(`SELECT p.*, h.nom hopital, o.nom organisation, c.reference contrat, u.nom responsable FROM sh_projets p LEFT JOIN hopitaux h ON h.id=p.hopital_id
      LEFT JOIN sh_crm_organisations o ON o.id=p.organisation_id LEFT JOIN sh_contrats c ON c.id=p.contrat_id LEFT JOIN sh_utilisateurs u ON u.id=p.responsable_id WHERE p.id=$1`, [id])).rows[0];
    if (!p) throw erreur(404, 'Projet introuvable.');
    const [taches, jalons] = await Promise.all([
      pool.query(`SELECT t.*, u.nom responsable, (t.statut NOT IN ('terminee','annulee') AND t.echeance < now()::date) en_retard FROM sh_taches t LEFT JOIN sh_utilisateurs u ON u.id=t.responsable_id WHERE projet_id=$1 ORDER BY (t.statut='terminee'), t.echeance NULLS LAST, t.id`, [id]),
      pool.query(`SELECT j.*, u.nom responsable FROM sh_jalons j LEFT JOIN sh_utilisateurs u ON u.id=j.responsable_id WHERE projet_id=$1 ORDER BY j.echeance NULLS LAST, j.id`, [id]),
    ]);
    const n = taches.rows.filter((t) => t.statut !== 'annulee').length; const faites = taches.rows.filter((t) => t.statut === 'terminee').length;
    const membres=(await pool.query(`SELECT m.utilisateur_id,u.nom,u.fonction,u.actif FROM sh_projet_membres m
      JOIN sh_utilisateurs u ON u.id=m.utilisateur_id WHERE m.projet_id=$1 ORDER BY u.nom`,[id])).rows;
    return { ...p, reference:`PRJ-${String(p.id).padStart(6,'0')}`, membres,avancement: n ? Math.round((100 * faites) / n) : 0, taches: taches.rows, jalons: jalons.rows };
  }));
  api.put('/projets/:id', route(async (req) => {
    return transaction(pool,async c=>{
    const p = (await c.query('SELECT * FROM sh_projets WHERE id=$1 FOR UPDATE', [idPositif(req.params.id)])).rows[0];
    if (!p) throw erreur(404, 'Projet introuvable.');
    const b = req.body; const statut = b.statut ?? p.statut;
    if (!require('./projets-pilotage-migrations').STATUTS_PROJET.includes(statut)) throw erreur(400, 'Statut de projet invalide.');
    if (statut === 'termine' && (await c.query(`SELECT 1 FROM sh_taches WHERE projet_id=$1 AND statut NOT IN ('terminee','annulee')`, [p.id])).rowCount) throw erreur(409, 'Des tâches sont encore ouvertes : terminez-les avant de clore le projet.');
    const responsable = b.responsable_id === undefined ? p.responsable_id : idPositif(b.responsable_id);
    const existants=(await c.query('SELECT utilisateur_id FROM sh_projet_membres WHERE projet_id=$1',[p.id])).rows.map(m=>m.utilisateur_id);
    const ids=await equipeValidee(c,responsable,b.membres??existants,{pilote:p.type_projet==='pilote'});
    const { rows } = await c.query(`UPDATE sh_projets SET statut=$2, nom=$3, debut=$4, echeance=$5, responsable_id=$6, description=$7, modifie_le=now() WHERE id=$1 RETURNING *`,
      [p.id, statut, texte(b.nom ?? p.nom, 180), b.debut === undefined ? jour(p.debut) : jourOuNull(b.debut), b.echeance === undefined ? jour(p.echeance) : jourOuNull(b.echeance), responsable,
        b.description === undefined ? p.description : texte(b.description, 4000)]);
    await enregistrerEquipeProjet(c,p.id,ids);
    if (responsable && responsable !== p.responsable_id && responsable !== req.u.id) await notifier(c, responsable, { ressourceType:'projet',ressourceId:p.id, type: 'projet', titre: `Projet confié : ${rows[0].nom}`, lien: 'projets' });
    await journal(c, req.u, 'Projet modifié', rows[0].nom, statut, p.hopital_id);
    return rows[0];
    });
  }));
  api.post('/projets/:id/jalons', route(async (req) => {
    const id = idPositif(req.params.id); const nom = texte(req.body.nom, 180); if (!nom) throw erreur(400, 'Nom du jalon requis.');
    const { rows } = await pool.query('INSERT INTO sh_jalons(projet_id,nom,echeance,responsable_id) VALUES($1,$2,$3,$4) RETURNING *', [id, nom, jourOuNull(req.body.echeance), idPositif(req.body.responsable_id)])
      .catch((e) => { if (e.code === '23503') throw erreur(404, 'Projet ou responsable introuvable.'); throw e; });
    await journal(pool, req.u, 'Jalon ajouté', nom, `projet ${id}`);
    return rows[0];
  }));
  api.put('/jalons/:id', route(async (req) => {
    const { rows } = await pool.query(`UPDATE sh_jalons SET termine_le=CASE WHEN $2 THEN COALESCE(termine_le,now()) ELSE NULL END, echeance=COALESCE($3::date, echeance) WHERE id=$1 RETURNING *`,
      [idPositif(req.params.id), req.body.termine === true, jourOuNull(req.body.echeance)]);
    if (!rows[0]) throw erreur(404, 'Jalon introuvable.');
    await journal(pool, req.u, req.body.termine === true ? 'Jalon atteint' : 'Jalon modifié', rows[0].nom, null);
    return rows[0];
  }));

  /* ------------------------------------------------------------ suivi d'un établissement (vue 360) */
  api.get('/hopitaux/:id/suivi', route(async (req) => {
    const id = idPositif(req.params.id); const r = req.u.role; const voit = (roles) => r === 'administration' || roles.includes(r);
    const org = (await pool.query('SELECT id, nom, type FROM sh_crm_organisations WHERE hopital_id=$1', [id])).rows[0] || null;
    const out = { organisation: org };
    out.projets = (await pool.query(`SELECT p.id, p.nom, p.statut, COALESCE(round(100.0*count(t.id) FILTER(WHERE t.statut='terminee')/NULLIF(count(t.id) FILTER(WHERE t.statut<>'annulee'),0)),0)::int avancement
      FROM sh_projets p LEFT JOIN sh_taches t ON t.projet_id=p.id WHERE p.hopital_id=$1 GROUP BY p.id ORDER BY p.id`, [id])).rows;
    if (voit(['support', 'implantation'])) out.tickets = (await pool.query(`SELECT id, titre, type, statut, priorite, cree_le FROM sh_support_tickets WHERE hopital_id=$1 ORDER BY (statut IN ('resolu','ferme')), cree_le DESC LIMIT 50`, [id])).rows;
    if (voit(['commercial', 'finance'])) out.contrats = (await pool.query(`SELECT c.id, c.reference, c.statut, c.date_fin FROM sh_contrats c WHERE c.hopital_id=$1
      OR c.opportunite_id IN (SELECT id FROM sh_opportunites WHERE organisation_id=$2) ORDER BY c.id`, [id, org?.id || 0])).rows;
    if (voit(['finance'])) out.factures = (await pool.query(`SELECT id, numero, etat, total, solde, echeance_le FROM (${SELECT_FACTURE}) x WHERE hopital_id=$1 OR organisation_id=$2 ORDER BY cree_le DESC LIMIT 50`, [id, org?.id || 0])).rows;
    out.documents = (await pool.query(`SELECT d.id, d.nom, d.categorie, d.version, d.confidentiel FROM sh_documents d WHERE d.hopital_id=$1 AND d.archive_le IS NULL
      AND d.version = (SELECT max(x.version) FROM sh_documents x WHERE x.groupe=d.groupe AND x.archive_le IS NULL) ORDER BY d.cree_le DESC`, [id])).rows.filter((d) => documents.peutLire(r, d));
    return out;
  }));
}

module.exports = { brancher, ROLES_FACTURATION };
