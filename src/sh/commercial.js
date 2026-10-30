'use strict';
const {verifierDestinataire}=require('./notifications-perimetres');

const { transaction } = require('../db');
const { lignesPropres, taxesPour, totaux, ajouterMois, ajouterJours, jourDe } = require('./montants');
const { notifier, comptesAvecRoles, nombre } = require('./automatisations');
const { TYPES_PROJET,equipeValidee,enregistrerEquipe } = require('./projets');

const STATUTS_OPP = new Set(['qualification', 'analyse', 'proposition', 'negociation', 'gagnee', 'perdue']);
const PRIORITES = ['basse', 'normale', 'haute', 'urgente'];
const { STATUTS_TACHE } = require('./taches-suivi-migrations');
// Délai de prise en charge d'un ticket selon sa priorité (heures).
const SLA_HEURES = { urgente: 4, haute: 24, normale: 72, basse: 168 };
// Tâches créées à la signature ; le code permet de les terminer quand l'étape est validée dans la console.
const MODELE_TACHES = [
  ['donnees_administratives', 'Valider les données administratives'],
  ['import_structure', 'Importer services, unités, chambres et lits'],
  ['modules', 'Configurer les modules et les quotas'],
  ['utilisateurs', 'Inviter les administrateurs de l’établissement'],
  ['formation', 'Planifier et réaliser la formation'],
  ['golive', 'Exécuter la recette et valider le Go Live'],
];
const texte = (x, max = 500) => String(x ?? '').trim().slice(0, max) || null;
const idPositif = (x) => Number.isSafeInteger(Number(x)) && Number(x) > 0 ? Number(x) : null;
const erreur = (statut, message) => Object.assign(new Error(message), { statut });
const jourOuNull = (v) => {
  if (v == null || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) throw erreur(400, 'Date invalide (AAAA-MM-JJ).');
  return String(v);
};
const aujourdhui = () => new Date().toLocaleDateString('en-CA', { timeZone: process.env.SH_FUSEAU || 'America/Toronto' });

/** Taxes du client : province de l'organisation, sinon celle de son établissement. */
async function taxesClient(db, organisationId, date) {
  const o = (await db.query(`SELECT o.pays_code, COALESCE(o.region, h.region) AS region, COALESCE(h.pays_code, o.pays_code) AS pays_hopital
    FROM sh_crm_organisations o LEFT JOIN hopitaux h ON h.id = o.hopital_id WHERE o.id = $1`, [organisationId])).rows[0];
  if (!o) throw erreur(404, 'Organisation introuvable.');
  return taxesPour(db, o.pays_code || o.pays_hopital, o.region, date);
}
async function grilleTarifs(db) {
  return new Map((await db.query('SELECT * FROM sh_tarifs WHERE actif')).rows.map((t) => [t.code, { ...t, prix_unitaire: Number(t.prix_unitaire) }]));
}
/** Lignes et totaux d'un devis, y compris ceux créés avant le calcul des taxes. */
async function montantsDevis(db, d) {
  if (d.total != null) return { lignes:d.lignes, sous_total: Number(d.sous_total), taxes: d.taxes, total: Number(d.total) };
  const lignes = lignesPropres(d.lignes,new Map(),d.devise||'CAD');
  const opp = (await db.query('SELECT organisation_id FROM sh_opportunites WHERE id = $1', [d.opportunite_id])).rows[0];
  return { lignes, ...totaux(lignes, await taxesClient(db, opp.organisation_id, aujourdhui()),d.devise||'CAD') };
}

function brancher(api, pool, route, journal) {
  /* ------------------------------------------------------------ organisations et contacts */
  api.get('/crm/organisations', route(async () => (await pool.query(`SELECT o.*, count(DISTINCT c.id)::int contacts,
    count(DISTINCT p.id)::int opportunites FROM sh_crm_organisations o LEFT JOIN sh_crm_contacts c ON c.organisation_id=o.id
    LEFT JOIN sh_opportunites p ON p.organisation_id=o.id GROUP BY o.id ORDER BY o.nom`)).rows));
  api.post('/crm/organisations', route(async (req) => {
    const nom = texte(req.body.nom, 180);
    if (!nom) throw erreur(400, 'Nom de l’organisation requis.');
    const pays = require('./international').normaliserPays(req.body.pays_code||'CA');
    return transaction(pool, async (c) => {
      const { rows } = await c.query(`INSERT INTO sh_crm_organisations(nom,type,site_web,notes,cree_par,adresse,ville,region,pays_code,courriel_facturation)
        VALUES($1,'prospect',$2,$3,$4,$5,$6,$7,$8,lower($9)) RETURNING *`, [nom, texte(req.body.site_web, 300), texte(req.body.notes, 4000), req.u.id,
        texte(req.body.adresse, 200), texte(req.body.ville, 80), texte(req.body.region, 100), pays, texte(req.body.courriel_facturation, 200)]);
      await journal(c, req.u, 'Organisation CRM créée', nom, 'prospect'); return rows[0];
    });
  }));
  api.get('/crm/organisations/:id', route(async (req) => {
    const id = idPositif(req.params.id);
    const o = (await pool.query('SELECT * FROM sh_crm_organisations WHERE id=$1', [id])).rows[0];
    if (!o) throw erreur(404, 'Organisation introuvable.');
    const [contacts, opportunites, activites, contrats] = await Promise.all([
      pool.query('SELECT * FROM sh_crm_contacts WHERE organisation_id=$1 ORDER BY decideur DESC, nom', [id]),
      pool.query(`SELECT p.*, u.nom responsable FROM sh_opportunites p LEFT JOIN sh_utilisateurs u ON u.id=p.responsable_id WHERE organisation_id=$1 ORDER BY p.modifie_le DESC`, [id]),
      pool.query(`SELECT a.*, u.nom responsable FROM sh_activites a LEFT JOIN sh_utilisateurs u ON u.id=a.responsable_id
        WHERE a.organisation_id=$1 OR a.opportunite_id IN (SELECT id FROM sh_opportunites WHERE organisation_id=$1) ORDER BY COALESCE(a.echeance,a.cree_le) DESC LIMIT 200`, [id]),
      pool.query(`SELECT c.* FROM sh_contrats c JOIN sh_opportunites p ON p.id=c.opportunite_id WHERE p.organisation_id=$1 ORDER BY c.cree_le DESC`, [id]),
    ]);
    return { ...o, contacts: contacts.rows, opportunites: opportunites.rows, activites: activites.rows, contrats: contrats.rows };
  }));
  api.put('/crm/organisations/:id', route(async (req) => {
    const id = idPositif(req.params.id);
    const o = (await pool.query('SELECT * FROM sh_crm_organisations WHERE id=$1', [id])).rows[0];
    if (!o) throw erreur(404, 'Organisation introuvable.');
    const b = req.body; const pick = (k, max) => (b[k] !== undefined ? texte(b[k], max) : o[k]);
    const pays = require('./international').normaliserPays(b.pays_code??o.pays_code??'CA');
    if(o.hopital_id&&pays!==o.pays_code)throw erreur(409,'Le pays d’un client lié exige un parcours de migration dédié.');
    if (!pick('nom', 180)) throw erreur(400, 'Nom ou pays invalide.');
    const { rows } = await pool.query(`UPDATE sh_crm_organisations SET nom=$2,site_web=$3,notes=$4,adresse=$5,ville=$6,region=$7,pays_code=$8,courriel_facturation=lower($9),modifie_le=now()
      WHERE id=$1 RETURNING *`, [id, pick('nom', 180), pick('site_web', 300), pick('notes', 4000), pick('adresse', 200), pick('ville', 80), pick('region', 100), pays, pick('courriel_facturation', 200)]);
    await journal(pool, req.u, 'Organisation CRM modifiée', rows[0].nom, Object.keys(b).join(', '));
    return rows[0];
  }));
  api.post('/crm/organisations/:id/contacts', route(async (req) => {
    const org = idPositif(req.params.id); const nom = texte(req.body.nom, 160);
    if (!org || !nom) throw erreur(400, 'Organisation et nom du contact requis.');
    return transaction(pool, async (c) => {
      if (!(await c.query('SELECT 1 FROM sh_crm_organisations WHERE id=$1', [org])).rowCount) throw erreur(404, 'Organisation introuvable.');
      const { rows } = await c.query(`INSERT INTO sh_crm_contacts(organisation_id,nom,fonction,courriel,telephone,decideur)
        VALUES($1,$2,$3,lower($4),$5,$6) RETURNING *`, [org, nom, texte(req.body.fonction, 120), texte(req.body.courriel, 200), texte(req.body.telephone, 50), req.body.decideur === true]);
      await journal(c, req.u, 'Contact CRM créé', nom, `organisation ${org}`); return rows[0];
    }).catch((e) => { if (e.code === '23505') throw erreur(409, 'Ce courriel existe déjà pour cette organisation.'); throw e; });
  }));
  api.put('/crm/organisations/:id/etablissement', route(async (req) => {
    const org = idPositif(req.params.id), hopital = idPositif(req.body.hopital_id);
    if (!org || !hopital) throw erreur(400, 'Organisation et établissement requis.');
    return transaction(pool, async (c) => {
      const o=(await c.query('SELECT id,pays_code FROM sh_crm_organisations WHERE id=$1 FOR UPDATE',[org])).rows[0];
      const h=(await c.query('SELECT id,pays_code,organisation_id FROM hopitaux WHERE id=$1 FOR UPDATE',[hopital])).rows[0];
      if(!o||!h)throw erreur(404,'Organisation ou établissement introuvable.');
      if(o.pays_code!==h.pays_code)throw erreur(409,'Le client et l’établissement doivent appartenir au même pays.');
      if(h.organisation_id&&String(h.organisation_id)!==String(org))throw erreur(409,'Établissement déjà associé à une autre organisation CRM.');
      const { rows } = await c.query(`UPDATE sh_crm_organisations o SET hopital_id=$2,type='client',modifie_le=now() WHERE o.id=$1 AND (o.hopital_id IS NULL OR o.hopital_id=$2)
        AND NOT EXISTS(SELECT 1 FROM sh_crm_organisations x WHERE x.hopital_id=$2 AND x.id<>$1) RETURNING o.*`, [org, hopital]);
      if (!rows[0]) throw erreur(409, 'Établissement déjà associé à une autre organisation CRM.');
      await c.query('UPDATE hopitaux SET organisation_id=$2 WHERE id=$1',[hopital,org]);
      // Projets et factures créés avant la fiche établissement : rattachés maintenant.
      await c.query('UPDATE sh_projets SET hopital_id=$2, modifie_le=now() WHERE organisation_id=$1 AND hopital_id IS NULL', [org, hopital]);
      await c.query('UPDATE sh_contrats SET hopital_id=$2 WHERE hopital_id IS NULL AND opportunite_id IN (SELECT id FROM sh_opportunites WHERE organisation_id=$1)', [org, hopital]);
      await c.query('UPDATE sh_factures SET hopital_id=$2 WHERE organisation_id=$1 AND hopital_id IS NULL', [org, hopital]);
      await journal(c, req.u, 'Organisation liée à un établissement', rows[0].nom, `hôpital SH ${hopital}`, hopital); return rows[0];
    });
  }));

  /* ------------------------------------------------------------ opportunités, relances */
  api.get('/crm/opportunites', route(async (req) => {
    const statut = STATUTS_OPP.has(req.query.statut) ? req.query.statut : null;
    const { rows } = await pool.query(`SELECT p.*,o.nom organisation,u.nom responsable FROM sh_opportunites p
      JOIN sh_crm_organisations o ON o.id=p.organisation_id LEFT JOIN sh_utilisateurs u ON u.id=p.responsable_id
      WHERE ($1::text IS NULL OR p.statut=$1) ORDER BY p.echeance NULLS LAST,p.modifie_le DESC LIMIT 500`, [statut]);
    return rows;
  }));
  api.get('/crm/opportunites/:id/devis', route(async (req) => (await pool.query('SELECT * FROM sh_devis WHERE opportunite_id=$1 ORDER BY version DESC', [idPositif(req.params.id)])).rows));
  api.post('/crm/opportunites', route(async (req) => {
    const org = idPositif(req.body.organisation_id); const titre = texte(req.body.titre, 180);
    if (!org || !titre) throw erreur(400, 'Organisation et titre requis.');
    const montant = req.body.montant == null || req.body.montant === '' ? null : Number(req.body.montant);
    const proba = req.body.probabilite == null || req.body.probabilite === '' ? 0 : Number(req.body.probabilite);
    if ((montant !== null && (!Number.isFinite(montant) || montant < 0)) || !Number.isInteger(proba) || proba < 0 || proba > 100) throw erreur(400, 'Montant ou probabilité invalide.');
    const responsable = idPositif(req.body.responsable_id);
    return transaction(pool, async (c) => {
      const client=(await c.query('SELECT pays_code FROM sh_crm_organisations WHERE id=$1',[org])).rows[0];
      if(!client)throw erreur(404,'Organisation introuvable.');
      const devise=require('./international').choisirDevise(client.pays_code,req.body.devise);
      await verifierDestinataire(c,responsable,'crm','client',org);
      const { rows } = await c.query(`INSERT INTO sh_opportunites(organisation_id,titre,montant,devise,probabilite,responsable_id,prochaine_action,echeance,cree_par)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [org, titre, montant, devise, proba, responsable, texte(req.body.prochaine_action, 300), jourOuNull(req.body.echeance), req.u.id]);
      if (responsable && responsable !== req.u.id) await notifier(c, responsable, { ressourceType:'opportunite',ressourceId:rows[0].id, type: 'crm', titre: `Opportunité attribuée : ${titre}`, lien: 'crm' });
      await journal(c, req.u, 'Opportunité créée', titre, `organisation ${org}`); return rows[0];
    });
  }));
  api.put('/crm/opportunites/:id', route(async (req) => {
    const id = idPositif(req.params.id);
    const avant = (await pool.query('SELECT * FROM sh_opportunites WHERE id=$1', [id])).rows[0];
    if (!avant) throw erreur(404, 'Opportunité introuvable.');
    const b = req.body; const statut = String(b.statut ?? avant.statut);
    if (!STATUTS_OPP.has(statut)) throw erreur(400, 'Étape de pipeline invalide.');
    const proba = b.probabilite === undefined ? avant.probabilite : Math.min(100, Math.max(0, Math.round(Number(b.probabilite)) || 0));
    const montant = b.montant === undefined ? avant.montant : (b.montant === '' || b.montant == null ? null : Number(b.montant));
    if (montant != null && (!Number.isFinite(Number(montant)) || Number(montant) < 0)) throw erreur(400, 'Montant invalide.');
    if (statut === 'perdue' && !texte(b.perdue_motif ?? avant.perdue_motif)) throw erreur(400, 'Indiquez le motif de la perte.');
    const responsable = b.responsable_id === undefined ? avant.responsable_id : idPositif(b.responsable_id);
    if(b.responsable_id!==undefined)await verifierDestinataire(pool,responsable,'crm','opportunite',id);
    const { rows } = await pool.query(`UPDATE sh_opportunites SET statut=$2,probabilite=$3,prochaine_action=$4,echeance=$5,
      perdue_motif=$6,montant=$7,responsable_id=$8,titre=$9,modifie_le=now() WHERE id=$1 RETURNING *`,
    [id, statut, statut === 'gagnee' ? 100 : statut === 'perdue' ? 0 : proba, b.prochaine_action === undefined ? avant.prochaine_action : texte(b.prochaine_action, 300),
      b.echeance === undefined ? avant.echeance : jourOuNull(b.echeance), statut === 'perdue' ? texte(b.perdue_motif ?? avant.perdue_motif, 500) : null,
      montant, responsable, texte(b.titre ?? avant.titre, 180)]);
    if (responsable && responsable !== avant.responsable_id && responsable !== req.u.id) await notifier(pool, responsable, { ressourceType:'opportunite',ressourceId:rows[0].id, type: 'crm', titre: `Opportunité attribuée : ${rows[0].titre}`, lien: 'crm' });
    await journal(pool, req.u, 'Opportunité modifiée', rows[0].titre, statut); return rows[0];
  }));
  async function creerActivite(req, { opportunite = null, organisation = null }) {
    const type = String(req.body.type || ''); const titre = texte(req.body.titre, 180);
    if (!['appel', 'reunion', 'courriel', 'relance', 'note'].includes(type) || !titre) throw erreur(400, 'Type et titre d’activité requis.');
    const echeance = req.body.echeance ? new Date(req.body.echeance) : null;
    if (echeance && Number.isNaN(echeance.getTime())) throw erreur(400, 'Échéance invalide.');
    const responsable = idPositif(req.body.responsable_id) || req.u.id;
    if (opportunite && !organisation) organisation = (await pool.query('SELECT organisation_id FROM sh_opportunites WHERE id=$1', [opportunite])).rows[0]?.organisation_id;
    if (!organisation) throw erreur(404, 'Opportunité ou organisation introuvable.');
    await verifierDestinataire(pool,responsable,'relance','client',organisation);
    const { rows } = await pool.query(`INSERT INTO sh_activites(opportunite_id,organisation_id,type,titre,contenu,echeance,responsable_id,cree_par,terminee_le)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $3='note' THEN now() END) RETURNING *`,
    [opportunite, organisation, type, titre, texte(req.body.contenu, 4000), echeance, responsable, req.u.id]);
    if (responsable !== req.u.id) await notifier(pool, responsable, { ressourceType:'activite',ressourceId:rows[0].id, type: 'relance', titre: `${type === 'relance' ? 'Relance' : 'Activité'} à faire : ${titre}`, lien: 'crm' });
    await journal(pool, req.u, 'Activité CRM ajoutée', titre, `${type} · ${opportunite ? `opportunité ${opportunite}` : `organisation ${organisation}`}`);
    return rows[0];
  }
  api.post('/crm/opportunites/:id/activites', route((req) => creerActivite(req, { opportunite: idPositif(req.params.id) })));
  api.post('/crm/organisations/:id/activites', route((req) => creerActivite(req, { organisation: idPositif(req.params.id) })));
  api.get('/crm/activites', route(async (req) => (await pool.query(`SELECT a.*, o.nom organisation, p.titre opportunite, u.nom responsable,
      (a.terminee_le IS NULL AND a.echeance < now()) en_retard FROM sh_activites a
    LEFT JOIN sh_crm_organisations o ON o.id=a.organisation_id LEFT JOIN sh_opportunites p ON p.id=a.opportunite_id LEFT JOIN sh_utilisateurs u ON u.id=a.responsable_id
    WHERE ($1::boolean=false OR a.terminee_le IS NULL) AND ($2::boolean=false OR a.responsable_id=$3)
    ORDER BY a.terminee_le NULLS FIRST, a.echeance NULLS LAST, a.id DESC LIMIT 500`, [req.query.a_faire === '1', req.query.moi === '1', req.u.id])).rows));
  api.put('/crm/activites/:id', route(async (req) => {
    const { rows } = await pool.query(`UPDATE sh_activites SET terminee_le=CASE WHEN $2 THEN COALESCE(terminee_le,now()) ELSE NULL END WHERE id=$1 RETURNING *`,
      [idPositif(req.params.id), req.body.terminee === true]);
    if (!rows[0]) throw erreur(404, 'Activité introuvable.');
    await journal(pool, req.u, req.body.terminee === true ? 'Relance terminée' : 'Relance rouverte', rows[0].titre, rows[0].type);
    return rows[0];
  }));

  /* ------------------------------------------------------------ devis */
  api.post('/crm/opportunites/:id/devis', route(async (req) => {
    const id = idPositif(req.params.id);
    const opp = (await pool.query('SELECT * FROM sh_opportunites WHERE id=$1', [id])).rows[0];
    if (!opp) throw erreur(404, 'Opportunité introuvable.');
    const devise=require('./international').normaliserDevise(req.body.devise||opp.devise||'CAD');
    const lignes = lignesPropres(req.body.lignes, await grilleTarifs(pool),devise);
    const t = totaux(lignes, await taxesClient(pool, opp.organisation_id, aujourdhui()),devise);
    const valide = jourOuNull(req.body.valide_jusqu) || ajouterJours(aujourdhui(), 30);
    return transaction(pool, async (c) => {
      await c.query('SELECT 1 FROM sh_opportunites WHERE id=$1 FOR UPDATE', [id]);
      const n = (await c.query('SELECT COALESCE(max(version),0)+1 version FROM sh_devis WHERE opportunite_id=$1', [id])).rows[0].version;
      const r = await c.query(`INSERT INTO sh_devis(opportunite_id,version,lignes,devise,cree_par,sous_total,taxes,total,valide_jusqu,conditions)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [id, n, JSON.stringify(lignes), devise, req.u.id,
        t.sous_total, JSON.stringify(t.taxes), t.total, valide, texte(req.body.conditions, 4000)]);
      await c.query(`UPDATE sh_opportunites SET montant=$2,devise=$3, statut=CASE WHEN statut IN ('qualification','analyse') THEN 'proposition' ELSE statut END, modifie_le=now() WHERE id=$1`, [id, t.sous_total,devise]);
      await journal(c, req.u, 'Devis créé', `Opportunité ${id}`, `version ${n} · total ${t.total} ${r.rows[0].devise}`); return r.rows[0];
    });
  }));
  api.post('/crm/devis/:id/valider', route(async (req) => {
    const id = idPositif(req.params.id);
    const { rows } = await pool.query(`UPDATE sh_devis SET statut='approuve',valide_par=$2,valide_le=now(),statut_modifie_le=now() WHERE id=$1 AND statut IN ('brouillon','a_valider') RETURNING *`, [id, req.u.id]);
    if (!rows[0]) throw erreur(409, 'Devis introuvable ou statut incompatible.');
    if (rows[0].cree_par && rows[0].cree_par !== req.u.id) await notifier(pool, rows[0].cree_par, { ressourceType:'devis',ressourceId:idPositif(req.params.id), type: 'devis', titre: `Devis v${rows[0].version} approuvé`, lien: 'contrats' });
    await journal(pool, req.u, 'Devis approuvé', `Devis ${id}`, `version ${rows[0].version}`); return rows[0];
  }));
  // Cycle du devis : soumis à l'approbation, envoyé au client, accepté ou refusé par lui.
  const TRANSITIONS_DEVIS = { a_valider: ['brouillon'], envoye: ['approuve'], accepte: ['approuve', 'envoye'], refuse: ['approuve', 'envoye', 'a_valider', 'brouillon'] };
  api.put('/crm/devis/:id/statut', route(async (req) => {
    const id = idPositif(req.params.id); const statut = String(req.body.statut || '');
    if (!TRANSITIONS_DEVIS[statut]) throw erreur(400, 'Statut de devis invalide.');
    if (statut === 'refuse' && !texte(req.body.motif)) throw erreur(400, 'Indiquez le motif du refus.');
    return transaction(pool, async (c) => {
      const d = (await c.query('SELECT * FROM sh_devis WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!d) throw erreur(404, 'Devis introuvable.');
      if (d.statut === statut) return d;
      if (!TRANSITIONS_DEVIS[statut].includes(d.statut)) throw erreur(409, `Un devis « ${d.statut} » ne peut pas passer à « ${statut} ».`);
      if (['envoye', 'accepte'].includes(statut) && d.valide_jusqu && String(d.valide_jusqu instanceof Date ? d.valide_jusqu.toISOString() : d.valide_jusqu).slice(0, 10) < aujourdhui()) {
        throw erreur(409, 'Ce devis a dépassé sa date de validité : créez une nouvelle version.');
      }
      const { rows } = await c.query(`UPDATE sh_devis SET statut=$2, motif_refus=$3, statut_modifie_le=now() WHERE id=$1 RETURNING *`, [id, statut, statut === 'refuse' ? texte(req.body.motif) : null]);
      if (statut === 'a_valider') await notifier(c, await comptesAvecRoles(c, ['administration']), { ressourceType:'devis',ressourceId:idPositif(req.params.id), type: 'devis', titre: `Devis v${d.version} à approuver`, lien: 'contrats', cle: `devis-a-valider-${id}` });
      if (statut === 'accepte') await c.query(`UPDATE sh_opportunites SET statut='negociation', probabilite=GREATEST(probabilite,90), modifie_le=now() WHERE id=$1 AND statut NOT IN ('gagnee','perdue')`, [d.opportunite_id]);
      await journal(c, req.u, 'Statut de devis modifié', `Devis ${id} v${d.version}`, `${d.statut} → ${statut}`);
      return rows[0];
    });
  }));

  /* ------------------------------------------------------------ contrats */
  api.get('/crm/contrats', route(async () => (await pool.query(`SELECT c.*,o.nom client,o.id organisation_id,d.version devis_version,d.total devis_total,d.devise,
      (c.statut='signe' AND c.renouvellement_le IS NOT NULL AND c.renouvellement_le <= (now()::date + 90)) a_renouveler
    FROM sh_contrats c JOIN sh_opportunites p ON p.id=c.opportunite_id
    JOIN sh_crm_organisations o ON o.id=p.organisation_id LEFT JOIN sh_devis d ON d.id=c.devis_id ORDER BY c.cree_le DESC`)).rows));
  api.post('/crm/opportunites/:id/contrats', route(async (req) => {
    const opp = idPositif(req.params.id), devis = idPositif(req.body.devis_id); if (!opp || !devis) throw erreur(400, 'Opportunité et devis approuvé requis.');
    return transaction(pool, async (c) => {
      const existing = (await c.query('SELECT * FROM sh_contrats WHERE opportunite_id=$1 AND devis_id=$2 FOR UPDATE', [opp, devis])).rows[0]; if (existing) return existing;
      const q = (await c.query(`SELECT d.id,d.statut FROM sh_devis d WHERE d.id=$1 AND d.opportunite_id=$2 FOR UPDATE`, [devis, opp])).rows[0];
      if (!q || !['approuve', 'envoye', 'accepte'].includes(q.statut)) throw erreur(409, 'Le devis doit être approuvé avant de créer un contrat.');
      const hopital = (await c.query('SELECT o.hopital_id FROM sh_opportunites p JOIN sh_crm_organisations o ON o.id=p.organisation_id WHERE p.id=$1', [opp])).rows[0]?.hopital_id || null;
      const reference = `ARR-${opp}-${Date.now().toString(36).toUpperCase()}`;
      const { rows } = await c.query(`INSERT INTO sh_contrats(opportunite_id,devis_id,reference,cree_par,hopital_id,duree_mois,preavis_jours,renouvellement_auto,date_debut)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [opp, devis, reference, req.u.id, hopital,
        Number(req.body.duree_mois) || 12, req.body.preavis_jours == null ? 60 : Number(req.body.preavis_jours), req.body.renouvellement_auto !== false, jourOuNull(req.body.date_debut)])
        .catch((e) => { if (e.code === '23514') throw erreur(400, 'Durée (1 à 120 mois) ou préavis (0 à 365 jours) invalide.'); throw e; });
      await journal(c, req.u, 'Contrat créé', reference, `opportunité ${opp}; aucune signature électronique déclarée`); return rows[0];
    });
  }));
  api.post('/crm/contrats/:id/signe', route(async (req) => {
    const id = idPositif(req.params.id), signataire = texte(req.body.signataire, 180);
    const documentId = idPositif(req.body.document_id);
    if (!signataire || (!texte(req.body.document_ref, 500) && !documentId)) throw erreur(400, 'Le signataire et la référence du document de signature sont requis.');
    return transaction(pool, async (c) => {
      const old = (await c.query(`SELECT c.*,p.titre,p.organisation_id,o.nom client,o.hopital_id org_hopital FROM sh_contrats c JOIN sh_opportunites p ON p.id=c.opportunite_id
        JOIN sh_crm_organisations o ON o.id=p.organisation_id WHERE c.id=$1 FOR UPDATE OF c`, [id])).rows[0];
      if (!old) throw erreur(404, 'Contrat introuvable.');
      if (['resilie', 'expire'].includes(old.statut)) throw erreur(409, 'Ce contrat est résilié ou expiré.');
      let docRef = texte(req.body.document_ref, 500);
      if (documentId) {
        const d = (await c.query(`SELECT id, nom, version FROM sh_documents WHERE id=$1 AND categorie='contrat' AND archive_le IS NULL`, [documentId])).rows[0];
        if (!d) throw erreur(400, 'Le document signé doit être déposé dans Documents, catégorie Contrat.');
        docRef = docRef || `document ${d.id} · ${d.nom} v${d.version}`;
      }
      const hopital = old.hopital_id || old.org_hopital || null;
      if (old.statut !== 'signe') {
        const debut = jourDe(old.date_debut) || aujourdhui();
        const fin = ajouterJours(ajouterMois(debut, old.duree_mois || 12), -1);
        await c.query(`UPDATE sh_contrats SET statut='signe',signe_par=$2,document_ref=$3,document_id=$4,signe_le=now(),date_debut=$5,date_fin=$6,
          renouvellement_le=$7,hopital_id=$8 WHERE id=$1`, [id, signataire, docRef, documentId, debut, fin, ajouterJours(fin, -(old.preavis_jours ?? 60)), hopital]);
      }
      await c.query(`UPDATE sh_crm_organisations SET type='client',modifie_le=now() WHERE id=$1`, [old.organisation_id]);
      await c.query(`UPDATE sh_opportunites SET statut='gagnee',probabilite=100,modifie_le=now() WHERE id=$1`, [old.opportunite_id]);
      const project = (await c.query(`INSERT INTO sh_projets(hopital_id,organisation_id,contrat_id,nom,statut,cree_par) VALUES($1,$2,$3,$4,'planification',$5)
        ON CONFLICT(contrat_id) WHERE contrat_id IS NOT NULL DO UPDATE SET contrat_id=EXCLUDED.contrat_id RETURNING *`, [hopital, old.organisation_id, id, `Implantation · ${old.client}`, req.u.id])).rows[0];
      for (const [code, titre] of MODELE_TACHES) {
        await c.query(`INSERT INTO sh_taches(projet_id,titre,priorite,cree_par,code_auto) VALUES($1,$2,'normale',$3,$4) ON CONFLICT(projet_id,lower(titre)) DO NOTHING`, [project.id, titre, req.u.id, code]);
      }
      // Facturation issue du devis signé : un abonnement par périodicité, une facture brouillon pour les frais uniques.
      const contrat = (await c.query('SELECT * FROM sh_contrats WHERE id=$1', [id])).rows[0];
      const devis = contrat.devis_id ? (await c.query('SELECT * FROM sh_devis WHERE id=$1', [contrat.devis_id])).rows[0] : null;
      const abonnements = []; let factureInitiale = null;
      if (devis) {
        const { lignes } = await montantsDevis(c, devis);
        const debut = jourDe(contrat.date_debut);
        for (const periodicite of ['mensuel', 'annuel']) {
          const ls = lignes.filter((l) => l.periodicite === periodicite);
          if (!ls.length) continue;
          const a = (await c.query(`INSERT INTO sh_abonnements(contrat_id,organisation_id,libelle,periodicite,lignes,devise,debut,fin,prochaine_facture_le)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7) ON CONFLICT(contrat_id,periodicite) DO NOTHING RETURNING *`,
          [id, old.organisation_id, `${old.client} · abonnement ${periodicite}`, periodicite, JSON.stringify(ls), devis.devise, debut, contrat.date_fin])).rows[0];
          if (a) abonnements.push(a);
        }
        const uniques = lignes.filter((l) => l.periodicite === 'unique');
        if (uniques.length) {
          const t = totaux(uniques, await taxesClient(c, old.organisation_id, aujourdhui()),devis.devise);
          factureInitiale = (await c.query(`INSERT INTO sh_factures(organisation_id,hopital_id,contrat_id,lignes,devise,sous_total,taxes,total,note,cree_par)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,'frais_uniques_contrat',$9)
            ON CONFLICT (contrat_id) WHERE abonnement_id IS NULL AND note = 'frais_uniques_contrat' DO NOTHING RETURNING id`,
          [old.organisation_id, hopital, id, JSON.stringify(uniques), devis.devise, t.sous_total, JSON.stringify(t.taxes), t.total, req.u.id])).rows[0] || null;
        }
      }
      if (abonnements.length || factureInitiale) {
        await notifier(c, (await c.query('SELECT utilisateur_id FROM sh_facturation_destinataires($1)',[old.organisation_id])).rows.map(u=>u.utilisateur_id), { type: 'facturation',organisationId:old.organisation_id,
          titre: `Contrat ${old.reference} signé : ${nombre(abonnements.length, 'abonnement')}${factureInitiale ? ' et une facture de frais uniques à émettre' : ''}`, lien: 'facturation', cle: `contrat-signe-${id}` });
      }
      await journal(c, req.u, 'Contrat marqué signé', old.reference, `signataire déclaré : ${signataire}; document : ${docRef}; projet ${project.id}`, hopital);
      return { contrat, projet: project, taches_creees: MODELE_TACHES.length, abonnements_crees: abonnements.length, facture_initiale: factureInitiale?.id || null };
    });
  }));

  /* ------------------------------------------------------------ projets et tâches */
  api.get('/projets', route(async (req) => (await pool.query(`SELECT p.*,h.nom hopital,o.nom organisation,u.nom responsable,
    COALESCE(round(100.0*count(t.id) FILTER(WHERE t.statut='terminee')/NULLIF(count(t.id) FILTER(WHERE t.statut<>'annulee'),0)),0)::int avancement,
    count(t.id)::int taches, count(t.id) FILTER (WHERE t.statut NOT IN ('terminee','annulee') AND t.echeance < now()::date)::int taches_en_retard
    FROM sh_projets p LEFT JOIN hopitaux h ON h.id=p.hopital_id LEFT JOIN sh_crm_organisations o ON o.id=p.organisation_id
    LEFT JOIN sh_utilisateurs u ON u.id=p.responsable_id LEFT JOIN sh_taches t ON t.projet_id=p.id
    WHERE (p.archive_le IS NOT NULL)=$1
    GROUP BY p.id,h.nom,o.nom,u.nom ORDER BY p.echeance NULLS LAST,p.id DESC`,[req.query.archives==='1'])).rows));
  api.post('/projets', route(async (req) => {
    const h = idPositif(req.body.hopital_id); const nom = texte(req.body.nom, 180); if (!h || !nom) throw erreur(400, 'Établissement et nom de projet requis.');
    return transaction(pool, async (c) => {
      const type=req.body.type_projet||'implantation';
      if(!TYPES_PROJET.includes(type))throw erreur(400,'Type de projet invalide.');
      const responsable=idPositif(req.body.responsable_id);
      const membres=await equipeValidee(c,responsable,req.body.membres||[],{pilote:type==='pilote'});
      const org = (await c.query('SELECT id FROM sh_crm_organisations WHERE hopital_id=$1', [h])).rows[0]?.id || null;
      const r = await c.query(`INSERT INTO sh_projets(hopital_id,organisation_id,contrat_id,nom,debut,echeance,cree_par,responsable_id,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [h, org, idPositif(req.body.contrat_id), nom, jourOuNull(req.body.debut), jourOuNull(req.body.echeance), req.u.id, idPositif(req.body.responsable_id), texte(req.body.description, 4000)]);
      await c.query('UPDATE sh_projets SET type_projet=$2 WHERE id=$1',[r.rows[0].id,type]);
      await enregistrerEquipe(c,r.rows[0].id,membres);
      await journal(c, req.u, 'Projet créé', nom, `hôpital ${h} ; type ${type}`, h); return {...r.rows[0],type_projet:type,membres};
    });
  }));
  api.get('/taches', route(async (req) => {
    const moi = req.query.moi === '1'; const projet = idPositif(req.query.projet_id); const statut = STATUTS_TACHE.includes(req.query.statut) ? req.query.statut : null;
    return (await pool.query(`SELECT t.*,p.nom projet,COALESCE(h.nom,o.nom) hopital,u.nom responsable,
        (t.statut NOT IN ('terminee','annulee') AND t.echeance < now()::date) en_retard,
        (SELECT count(*)::int FROM sh_taches_commentaires k WHERE k.tache_id=t.id) commentaires,
        EXISTS (SELECT 1 FROM sh_taches_collaborateurs c WHERE c.tache_id=t.id AND c.utilisateur_id=$2) collaborateur
      FROM sh_taches t JOIN sh_projets p ON p.id=t.projet_id LEFT JOIN hopitaux h ON h.id=p.hopital_id LEFT JOIN sh_crm_organisations o ON o.id=p.organisation_id
      LEFT JOIN sh_utilisateurs u ON u.id=t.responsable_id
      WHERE ($1::boolean=false OR t.responsable_id=$2 OR EXISTS (SELECT 1 FROM sh_taches_collaborateurs c WHERE c.tache_id=t.id AND c.utilisateur_id=$2)) AND ($3::bigint IS NULL OR t.projet_id=$3) AND ($4::text IS NULL OR t.statut=$4)
      ORDER BY (t.statut IN ('terminee','annulee')), t.echeance NULLS LAST,t.id DESC LIMIT 1000`, [moi, req.u.id, projet, statut])).rows;
  }));
  api.post('/projets/:id/taches', route(async (req) => {
    const p = idPositif(req.params.id); const titre = texte(req.body.titre, 180); if (!titre) throw erreur(400, 'Titre de tâche requis.');
    if (req.body.parent_id && !idPositif(req.body.parent_id)) throw erreur(400, 'Sous-tâche invalide.');
    const responsable = idPositif(req.body.responsable_id);
    return transaction(pool, async (c) => {
      if (!(await c.query('SELECT 1 FROM sh_projets WHERE id=$1', [p])).rowCount) throw erreur(404, 'Projet introuvable.');
      await verifierDestinataire(c,responsable,'tache','projet',p);
      if(req.body.parent_id && !(await c.query('SELECT 1 FROM sh_taches WHERE id=$1 AND projet_id=$2',[idPositif(req.body.parent_id),p])).rowCount)throw erreur(400,'La tâche parente doit appartenir au même projet.');
      if(req.body.critique_golive!==undefined&&typeof req.body.critique_golive!=='boolean')throw erreur(400,'Criticité invalide.');
      const { rows } = await c.query(`INSERT INTO sh_taches(projet_id,parent_id,titre,description,priorite,responsable_id,echeance,cree_par) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [p, idPositif(req.body.parent_id), titre, texte(req.body.description, 4000), PRIORITES.includes(req.body.priorite) ? req.body.priorite : 'normale', responsable, jourOuNull(req.body.echeance), req.u.id])
        .catch((e) => { if (e.code === '23505') throw erreur(409, 'Une tâche de ce titre existe déjà dans ce projet.'); throw e; });
      if (responsable && responsable !== req.u.id) await notifier(c, responsable, { ressourceType:'tache',ressourceId:rows[0].id, type: 'tache', titre: `Tâche attribuée : ${titre}`, lien: 'taches' });
      await c.query('UPDATE sh_taches SET critique_golive=$2,criteres_acceptation=$3 WHERE id=$1',[rows[0].id,req.body.critique_golive===true,texte(req.body.criteres_acceptation,4000)]);
      await journal(c, req.u, 'Tâche créée', titre, `projet ${p}`); return {...rows[0],critique_golive:req.body.critique_golive===true,criteres_acceptation:texte(req.body.criteres_acceptation,4000)};
    });
  }));
  api.put('/taches/:id', route(async (req) => {
    const id = idPositif(req.params.id);
    const avant = (await pool.query('SELECT * FROM sh_taches WHERE id=$1', [id])).rows[0];
    if (!avant) throw erreur(404, 'Tâche introuvable.');
    // Les rôles hors implantation ne modifient que les tâches qui leur sont attribuées.
    if (!['administration', 'implantation'].includes(req.u.role) && avant.responsable_id !== req.u.id
      && !(await pool.query('SELECT 1 FROM sh_taches_collaborateurs WHERE tache_id=$1 AND utilisateur_id=$2', [id, req.u.id])).rowCount) throw erreur(403, 'Vous ne pouvez modifier que les tâches qui vous sont attribuées.');
    const b = req.body; const statut = String(b.statut ?? avant.statut);
    if (!STATUTS_TACHE.includes(statut)) throw erreur(400, 'Statut de tâche invalide.');
    const gestion = ['administration', 'implantation'].includes(req.u.role);
    // Annulation motivée et validation des critères réservées à l'implantation ; checklist complète avant clôture.
    if (statut === 'annulee' && avant.statut !== 'annulee') {
      if (!gestion) throw erreur(403, 'Seules l’implantation et l’administration annulent une tâche.');
      if (String(b.motif || '').trim().length < 5) throw erreur(400, 'Motif d’annulation requis.');
    }
    if (statut === 'terminee' && avant.statut !== 'terminee') {
      if (String(avant.criteres_acceptation || '').trim() && !gestion) throw erreur(403, 'Cette tâche a des critères d’acceptation : passez-la en validation.');
      if ((await pool.query('SELECT 1 FROM sh_taches_checklist WHERE tache_id=$1 AND NOT faite LIMIT 1', [id])).rowCount) throw erreur(409, 'Des éléments de la checklist restent à faire.');
    }
    const priorite = b.priorite === undefined ? avant.priorite : PRIORITES.includes(b.priorite) ? b.priorite : 'normale';
    const responsable = b.responsable_id === undefined ? avant.responsable_id : idPositif(b.responsable_id);
    if(b.responsable_id!==undefined)await verifierDestinataire(pool,responsable,'tache','tache',id);
    const { rows } = await pool.query(`UPDATE sh_taches SET statut=$2,priorite=$3,responsable_id=$4,echeance=$5,description=$6,
      terminee_le=CASE WHEN $2='terminee' THEN COALESCE(terminee_le,now()) ELSE NULL END,
      annulee_motif=CASE WHEN $2='annulee' THEN COALESCE($7,annulee_motif) ELSE NULL END,
      validee_par=CASE WHEN $2='terminee' AND $8 AND $9='en_validation' THEN $10::int WHEN $2='terminee' THEN validee_par ELSE NULL END,
      validee_le=CASE WHEN $2='terminee' AND $8 AND $9='en_validation' THEN now() WHEN $2='terminee' THEN validee_le ELSE NULL END,
      modifie_le=now() WHERE id=$1 RETURNING *`,
    [id, statut, priorite, responsable, b.echeance === undefined ? avant.echeance : jourOuNull(b.echeance), b.description === undefined ? avant.description : texte(b.description, 4000),
      statut === 'annulee' ? texte(b.motif, 500) : null, gestion, avant.statut, req.u.id]);
    if (responsable && responsable !== avant.responsable_id && responsable !== req.u.id) await notifier(pool, responsable, { ressourceType:'tache',ressourceId:id, type: 'tache', titre: `Tâche attribuée : ${rows[0].titre}`, lien: 'taches' });
    await journal(pool, req.u, 'Tâche modifiée', rows[0].titre, statut); return rows[0];
  }));
  api.get('/taches/:id/commentaires', route(async (req) => (await pool.query(`SELECT k.*, u.nom auteur FROM sh_taches_commentaires k
    LEFT JOIN sh_utilisateurs u ON u.id=k.utilisateur_id WHERE k.tache_id=$1 ORDER BY k.cree_le`, [idPositif(req.params.id)])).rows));
  api.post('/taches/:id/commentaires', route(async (req) => {
    const id = idPositif(req.params.id); const commentaire = texte(req.body.commentaire, 4000); if (!commentaire) throw erreur(400, 'Commentaire requis.');
    const t = (await pool.query('SELECT titre, responsable_id FROM sh_taches WHERE id=$1', [id])).rows[0];
    if (!t) throw erreur(404, 'Tâche introuvable.');
    const { rows } = await pool.query(`INSERT INTO sh_taches_commentaires(tache_id,utilisateur_id,commentaire) VALUES($1,$2,$3) RETURNING *`, [id, req.u.id, commentaire]);
    if (t.responsable_id && t.responsable_id !== req.u.id) await notifier(pool, t.responsable_id, { ressourceType:'tache',ressourceId:id, type: 'tache', titre: `Commentaire sur « ${t.titre} »`, lien: 'taches' });
    return rows[0];
  }));

  /* ------------------------------------------------------------ support */
  api.get('/support/tickets', route(async (req) => {
    const statut = ['ouvert', 'assigne', 'en_cours', 'en_attente', 'resolu', 'ferme'].includes(req.query.statut) ? req.query.statut : null;
    const type = ['demande', 'incident', 'question'].includes(req.query.type) ? req.query.type : null;
    return (await pool.query(`SELECT t.*,h.nom hopital,u.nom responsable,
        COALESCE((t.statut NOT IN ('resolu','ferme') AND CASE WHEN t.sla_snapshot IS NULL THEN t.echeance<now() ELSE (t.prise_en_charge_le IS NULL AND t.prise_en_charge_echeance<now()) OR t.resolution_echeance<now() END),false) hors_delai
      FROM sh_support_tickets t JOIN hopitaux h ON h.id=t.hopital_id LEFT JOIN sh_utilisateurs u ON u.id=t.responsable_id
      WHERE ($1::text IS NULL OR ($1='assigne' AND t.statut='ouvert' AND t.responsable_id IS NOT NULL) OR ($1<>'assigne' AND t.statut=$1)) AND ($2::text IS NULL OR t.type=$2) AND ($3::int IS NULL OR t.hopital_id=$3) AND ($4::boolean=false OR t.responsable_id=$5)
      ORDER BY (t.statut IN ('resolu','ferme')), t.echeance NULLS LAST, t.cree_le DESC LIMIT 1000`,
    [statut, type, idPositif(req.query.hopital_id), req.query.moi === '1', req.u.id])).rows;
  }));
  // Recherche OG locale, en lecture seule. RLS conserve le périmètre utilisateur;
  // seuls les champs factuels du ticket sont renvoyés, jamais messages ni documents.
  api.post('/support/og/recherche', route(async (req) => {
    const recherche = String(req.body.recherche ?? '').trim().slice(0, 160);
    if (recherche.length < 2) throw erreur(400, 'Saisissez au moins deux caractères.');
    const { rows } = await pool.query(`SELECT t.id,t.reference,t.titre,t.statut,t.priorite,t.type,
        h.nom hopital,u.nom responsable
      FROM sh_support_tickets t JOIN hopitaux h ON h.id=t.hopital_id
      LEFT JOIN sh_utilisateurs u ON u.id=t.responsable_id
      WHERE to_tsvector('simple', concat_ws(' ',t.reference,t.titre,t.description,t.type,t.statut,t.priorite))
        @@ plainto_tsquery('simple',$1)
      ORDER BY ts_rank(to_tsvector('simple', concat_ws(' ',t.reference,t.titre,t.description,t.type,t.statut,t.priorite)),
        plainto_tsquery('simple',$1)) DESC,t.cree_le DESC LIMIT 10`, [recherche]);
    const tickets = rows.map((t) => ({ id:t.id,reference:t.reference,titre:t.titre,statut:t.statut,
      priorite:t.priorite,type:t.type,hopital:t.hopital,responsable:t.responsable,
      resume:`${t.reference} — ${t.statut}; priorité ${t.priorite}; établissement : ${t.hopital}${t.responsable ? `; responsable : ${t.responsable}` : '; sans responsable'}.` }));
    return { mode:'recherche_locale_factuelle',nombre:tickets.length,tickets };
  }));
  api.post('/support/tickets', route(async (req) => {
    const h = idPositif(req.body.hopital_id); const titre = texte(req.body.titre, 180); if (!h || !titre) throw erreur(400, 'Établissement et titre requis.');
    const type = ['demande', 'incident', 'question'].includes(req.body.type) ? req.body.type : 'demande';
    const gravite = type === 'incident' ? (['critique', 'majeure', 'mineure'].includes(req.body.gravite) ? req.body.gravite : 'majeure') : null;
    const priorite = PRIORITES.includes(req.body.priorite) ? req.body.priorite : gravite === 'critique' ? 'urgente' : gravite === 'majeure' ? 'haute' : 'normale';
    const responsable = idPositif(req.body.responsable_id);
    return transaction(pool, async (c) => {
      const autorises=await require('./support-droits').destinataires(c,h);
      if(responsable&&!autorises.includes(responsable))throw erreur(400,'Le responsable doit avoir accès au support de cet établissement.');
      const { rows } = await c.query(`INSERT INTO sh_support_tickets(hopital_id,titre,description,priorite,cree_par,type,gravite,contact,responsable_id,echeance)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now() + make_interval(hours => $10)) RETURNING *`,
      [h, titre, texte(req.body.description, 4000), priorite, req.u.id, type, gravite, texte(req.body.contact, 200), responsable, SLA_HEURES[priorite]])
        .catch((e) => { if (e.code === '23503') throw erreur(404, 'Établissement introuvable.'); throw e; });
      const destinataires = responsable ? [responsable] : autorises;
      await notifier(c, destinataires.filter((x) => x !== req.u.id), { ressourceType:'ticket',ressourceId:rows[0].id, type: 'support', titre: `${type === 'incident' ? `Incident ${gravite}` : 'Ticket'} : ${titre}`, lien: 'support' });
      await journal(c, req.u, type === 'incident' ? 'Incident déclaré' : 'Ticket créé', titre, `hôpital ${h} · priorité ${priorite}`, h); return rows[0];
    });
  }));
  api.get('/support/tickets/:id', route(async (req) => {
    const id = idPositif(req.params.id);
    const t = (await pool.query(`SELECT t.*,h.nom hopital,h.code_etab,u.nom responsable,cr.nom createur FROM sh_support_tickets t JOIN hopitaux h ON h.id=t.hopital_id
      LEFT JOIN sh_utilisateurs u ON u.id=t.responsable_id LEFT JOIN sh_utilisateurs cr ON cr.id=t.cree_par WHERE t.id=$1`, [id])).rows[0];
    if (!t) throw erreur(404, 'Ticket introuvable.');
    const [messages, evenements, escalades] = await Promise.all([
      pool.query('SELECT m.*, COALESCE(u.nom,m.auteur_client) auteur FROM sh_support_messages m LEFT JOIN sh_utilisateurs u ON u.id=m.auteur_id WHERE ticket_id=$1 ORDER BY m.cree_le', [id]),
      pool.query('SELECT * FROM sh_support_evenements WHERE ticket_id=$1 ORDER BY quand', [id]),
      pool.query('SELECT id,phase,cree_le,generation FROM sh_support_escalades WHERE ticket_id=$1 ORDER BY id',[id]),
    ]);
    return { ...t, messages: messages.rows, evenements: evenements.rows, escalades:escalades.rows };
  }));
  api.put('/support/tickets/:id', route(async (req) => {
    const id = idPositif(req.params.id); const b = req.body;
    return transaction(pool, async (c) => {
      const t = (await c.query('SELECT * FROM sh_support_tickets WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!t) throw erreur(404, 'Ticket introuvable.');
      const v = {
        statut: b.statut ?? t.statut, priorite: b.priorite ?? t.priorite,
        responsable_id: b.responsable_id === undefined ? t.responsable_id : idPositif(b.responsable_id),
        resolution: b.resolution === undefined ? t.resolution : texte(b.resolution, 4000),
        client_visible:b.client_visible===undefined?t.client_visible:b.client_visible,
      };
      if(v.responsable_id&&!(await require('./support-droits').destinataires(c,t.hopital_id)).includes(v.responsable_id))throw erreur(400,'Le responsable doit avoir accès au support de cet établissement.');
      if(typeof v.client_visible!=='boolean')throw erreur(400,'Visibilité client invalide.');
      if (!['ouvert', 'en_cours', 'en_attente', 'resolu', 'ferme'].includes(v.statut) || !PRIORITES.includes(v.priorite)) throw erreur(400, 'Statut ou priorité invalide.');
      if (['resolu', 'ferme'].includes(v.statut) && !v.resolution) throw erreur(400, 'Décrivez la résolution avant de résoudre ou fermer le ticket.');
      if (v.statut === 'ferme' && !['resolu', 'ferme'].includes(t.statut)) throw erreur(409, 'Un ticket se ferme après avoir été résolu.');
      const { rows } = await c.query(`UPDATE sh_support_tickets SET statut=$2,priorite=$3,responsable_id=$4,resolution=$5,client_visible=$7,
        resolu_le=CASE WHEN $2 IN ('resolu','ferme') THEN COALESCE(resolu_le,now()) ELSE NULL END,
        echeance=CASE WHEN $3<>priorite THEN cree_le + make_interval(hours => $6) ELSE echeance END, modifie_le=now() WHERE id=$1 RETURNING *`,
      [id, v.statut, v.priorite, v.responsable_id, v.resolution, SLA_HEURES[v.priorite],v.client_visible]);
      for (const k of ['statut', 'priorite', 'responsable_id','client_visible']) {
        if (String(t[k] ?? '') !== String(v[k] ?? '')) await c.query('INSERT INTO sh_support_evenements(ticket_id,champ,avant,apres,par) VALUES($1,$2,$3,$4,$5)', [id, k, t[k], v[k], req.u.email]);
      }
      if (v.responsable_id && v.responsable_id !== t.responsable_id && v.responsable_id !== req.u.id) await notifier(c, v.responsable_id, { ressourceType:'ticket',ressourceId:idPositif(req.params.id), type: 'support', titre: `Ticket attribué : ${t.titre}`, lien: 'support' });
      const courrielsSupport=require('./support-courriels');
      if(v.responsable_id&&v.responsable_id!==t.responsable_id){const u=(await c.query('SELECT email FROM sh_utilisateurs WHERE id=$1',[v.responsable_id])).rows[0];await courrielsSupport.ajouter(c,id,'ticket_attribue',[u?.email]);}
      if(v.client_visible&&v.statut!==t.statut&&t.demandeur_client)await courrielsSupport.ajouter(c,id,'statut',[t.demandeur_client]);
      await journal(c, req.u, 'Ticket modifié', t.titre, `${t.statut} → ${v.statut}`, t.hopital_id);
      return rows[0];
    });
  }));
  api.post('/support/tickets/:id/messages', route(async (req) => {
    const id = idPositif(req.params.id); const message = texte(req.body.message, 8000); if (!message) throw erreur(400, 'Message requis.');
    return transaction(pool,async c=>{
    const t = (await c.query('SELECT * FROM sh_support_tickets WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!t) throw erreur(404, 'Ticket introuvable.');
    const { rows } = await c.query('INSERT INTO sh_support_messages(ticket_id,auteur_id,message,interne) VALUES($1,$2,$3,$4) RETURNING *', [id, req.u.id, message, req.body.interne !== false]);
    if (t.statut === 'ouvert') await c.query(`UPDATE sh_support_tickets SET statut='en_cours', modifie_le=now() WHERE id=$1`, [id]);
    if (t.responsable_id && t.responsable_id !== req.u.id && (await require('./support-droits').destinataires(c,t.hopital_id)).includes(t.responsable_id)) await notifier(c, t.responsable_id, { ressourceType:'ticket',ressourceId:idPositif(req.params.id), type: 'support', titre: `Nouveau message : ${t.titre}`, lien: 'support' });
    if(req.body.interne===false&&t.client_visible&&t.demandeur_client)await require('./support-courriels').ajouter(c,id,'reponse_support',[t.demandeur_client]);
    return rows[0];
    });
  }));
}

module.exports = { brancher, montantsDevis, taxesClient, aujourdhui, jourOuNull, MODELE_TACHES };
