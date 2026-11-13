'use strict';
/* Demandes reçues par le formulaire du site public.
   Dépôt : une seule route, sans session, sans lecture, réservée au serveur du site (adresse locale et clé).
   Conservation : 24 mois (Loi 25, politique de confidentialité du site). Alerte par courriel sans renseignement personnel. */
const crypto = require('node:crypto');
const courriel = require('../courriel');

const TYPES = ['demo', 'devis', 'contact'];
const PAYS = ['canada', 'europe', 'afrique', 'autre'];   // ancien formulaire (par continent), encore accepté
const PAYS_ISO = new Set(Object.keys(require('./donnees-internationales.json').pays));
const { LANGUES_CONTACT } = require('./demandes-monde-migrations');
const E164 = /^\+[1-9]\d{6,14}$/;
const STATUTS = ['a_traiter', 'traitee', 'rejetee'];
const CRM = require('./demandes-crm');
const { MOTIFS_REJET, MODULES_INTERET, ETAPES } = require('./demandes-crm-migrations');
const { transaction } = require('../db');
const COURRIEL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[^\s@<>"'.]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const refus = (message) => Object.assign(new Error(message), { refus: true });

function texte(v, max, { requis = false, multiligne = false } = {}) {
  if (v !== undefined && v !== null && typeof v !== 'string') throw refus('champ_invalide');
  const s = String(v ?? '').replace(multiligne ? /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, ' ').trim();
  if (requis && !s) throw refus('champ_requis');
  if (s.length > max) throw refus('champ_trop_long');
  return s || null;
}
function normaliser(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw refus('corps_invalide');
  if (!UUID.test(String(b.depot_id ?? ''))) throw refus('depot_invalide');
  const ancien = b.pays !== undefined && b.pays_code === undefined;
  if (!TYPES.includes(b.type) || !['fr', 'en'].includes(b.langue) || (ancien ? !PAYS.includes(b.pays) : !PAYS_ISO.has(b.pays_code))) throw refus('choix_invalide');
  if (b.langue_contact !== undefined && !LANGUES_CONTACT.includes(b.langue_contact)) throw refus('choix_invalide');
  if (b.module_interet !== undefined && b.module_interet !== '' && !MODULES_INTERET.includes(b.module_interet)) throw refus('choix_invalide');
  if (b.consentement !== true) throw refus('consentement_requis');
  const email = texte(b.courriel, 254, { requis: true });
  if (!COURRIEL.test(email)) throw refus('courriel_invalide');
  const telephone = texte(b.telephone, 40);
  return { depot_id: b.depot_id, type: b.type, ...(ancien ? { pays: b.pays } : { pays_code: b.pays_code }), langue: b.langue, courriel: email,
    ville: texte(b.ville, 120), langue_contact: b.langue_contact || null, module_interet: b.module_interet || null, telephone_a_verifier: !!telephone && !E164.test(telephone),
    nom: texte(b.nom, 120, { requis: true }), fonction: texte(b.fonction, 120), organisation: texte(b.organisation, 160, { requis: true }),
    telephone, type_organisation: texte(b.type_organisation, 80), format: texte(b.format, 80),
    nb_etablissements: texte(b.nb_etablissements, 40), offre: texte(b.offre, 80), sujet: texte(b.sujet, 160),
    message: texte(b.message, 4000, { requis: true, multiligne: true }) };
}
/** Seul le serveur du site passe : connexion directe locale (Nginx ajoute X-Forwarded-For à tout appel venu d'Internet) et clé. */
function depotAutorise(req, env) {
  const attendu = String(env.SH_DEPOT_SITE_CLE_SHA256 || '');
  if (!/^[0-9a-f]{64}$/.test(attendu)) return 404;
  const ip = req.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip) || req.headers['x-forwarded-for'] || req.headers['x-real-ip']) return 404;
  const recu = crypto.createHash('sha256').update(String(req.headers['x-depot-cle'] || '')).digest();
  return crypto.timingSafeEqual(recu, Buffer.from(attendu, 'hex')) ? 200 : 401;
}
async function deposer(pool, corps) {
  const v = normaliser(corps);
  const cles = Object.keys(v);
  // La demande est d'abord enregistrée seule (jamais perdue) ; le prospect et l'accusé suivent, et sont repris par l'entretien en cas d'échec.
  const r = await pool.query(`INSERT INTO sh_demandes_site (${cles.join(',')}, consentement_le) VALUES (${cles.map((_, i) => `$${i + 1}`).join(',')}, now())
    ON CONFLICT (depot_id) DO NOTHING RETURNING *`, cles.map((k) => v[k]));
  if (r.rowCount) await rattacher(pool, r.rows[0], { accuse: true }).catch((e) => console.error('Prospect de la demande :', e.code || e.name));
  return { ok: true, nouvelle: r.rowCount === 1 };
}
async function rattacher(pool, d, { accuse = false } = {}) {
  return transaction(pool, async (c) => {
    const x = (await c.query('SELECT * FROM sh_demandes_site WHERE id = $1 FOR UPDATE', [d.id])).rows[0];
    if (!x || x.organisation_id) return null;
    const p = await CRM.prospect(c, x);
    if (accuse) await CRM.accuser(c, { ...x, organisation_id: p.organisation_id });
    return p;
  });
}
/** Alertes en attente, puis suppression après 24 mois. Le courriel ne contient ni nom, ni adresse, ni message. */
async function entretien(pool, env = process.env) {
  const supprimees = (await pool.query("DELETE FROM sh_demandes_site WHERE recu_le < now() - interval '24 months'")).rowCount;
  // Demandes encore sans prospect (reçues avant le lien avec le CRM, ou rattachement échoué) : rattachées sans accusé.
  for (const d of (await pool.query("SELECT id FROM sh_demandes_site WHERE organisation_id IS NULL AND statut = 'a_traiter' ORDER BY id LIMIT 50")).rows) {
    await rattacher(pool, d).catch((e) => console.error('Prospect de la demande :', e.code || e.name));
  }
  if (supprimees) await pool.query(`INSERT INTO sh_journal (action, cible, detail) VALUES ('Demandes du site supprimées', 'Conservation', $1)`, [`${supprimees} après 24 mois`]);
  let alertes = 0;
  const a = String(env.SH_DEPOT_SITE_ALERTE || '').trim();
  if (a && courriel.actif(env.SH_PUBLIC_URL, env)) {
    // Réservée d'abord : deux passages simultanés n'envoient jamais la même alerte. Un échec la remet en attente.
    const { rows } = await pool.query(`UPDATE sh_demandes_site SET alerte_le = now() WHERE id IN (
      SELECT id FROM sh_demandes_site WHERE alerte_le IS NULL ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING id, type, coalesce(pays_code, pays) AS pays`);
    for (const d of rows) {
      const lien = env.SH_PUBLIC_URL ? `\n\nOuvrir SH : ${env.SH_PUBLIC_URL}` : '';
      try {
        await courriel.envoyer({ a, sujet: `Arrimo · Nouvelle demande n° ${d.id}`, texte: `Nouvelle demande reçue par le site.\nType : ${d.type}\nPays : ${d.pays}\nLes détails sont dans l’écran « Demandes » de SH.${lien}` }, env);
        alertes++;
      } catch (e) {
        await pool.query('UPDATE sh_demandes_site SET alerte_le = NULL WHERE id = $1', [d.id]);
        console.error('Alerte de demande :', e.code || e.name);
      }
    }
  }
  return { supprimees, alertes };
}
function brancherDepot(app, pool, env) {
  app.post('/api/depot-site/demandes', async (req, res) => {
    const acces = depotAutorise(req, env);
    if (acces !== 200) return res.status(acces).json({ erreur: acces === 404 ? 'Adresse inconnue.' : 'Clé refusée.' });
    try { res.json(await deposer(pool, req.body)); entretien(pool, env).catch((e) => console.error('Demandes du site :', e.code || e.name)); }
    catch (e) { if (e.refus) return res.status(400).json({ erreur: e.message }); console.error('Dépôt du site :', e.code || e.name); res.status(500).json({ erreur: 'indisponible' }); }
  });
}
function brancherEcran(api, pool, route, entier, journal, ErreurSh) {
  const PAR_PAGE = 50;
  api.get('/demandes-site/compteur', route(async () => (await pool.query("SELECT count(*)::int a_traiter FROM sh_demandes_site WHERE statut = 'a_traiter'")).rows[0]));
  api.get('/demandes-site', route(async (req) => {
    const q = req.query;
    const vue = q.vue === 'archives' ? 'archives' : 'a_traiter';
    const conds = [vue === 'archives' ? "d.statut IN ('traitee','rejetee')" : "d.statut = 'a_traiter'"]; const vals = [];
    const ajouter = (sql, v) => { vals.push(v); conds.push(sql.replace('?', `$${vals.length}`)); };
    if (/^[A-Z]{2}$/.test(String(q.pays || ''))) ajouter('d.pays_code = ?', String(q.pays));
    if (LANGUES_CONTACT.includes(q.langue)) ajouter('coalesce(d.langue_contact, d.langue) = ?', q.langue);
    if (MODULES_INTERET.includes(q.module)) ajouter('d.module_interet = ?', q.module);
    if (q.type_organisation) ajouter('d.type_organisation = ?', String(q.type_organisation).slice(0, 80));
    if (q.ville) ajouter("d.ville ILIKE '%' || ? || '%'", String(q.ville).trim().slice(0, 120));
    if (q.recherche) ajouter("(d.nom || ' ' || d.organisation || ' ' || d.courriel || ' ' || coalesce(d.sujet,'') || ' ' || d.message) ILIKE '%' || ? || '%'", String(q.recherche).trim().slice(0, 120));
    if (q.statut && STATUTS.includes(q.statut)) ajouter('d.statut = ?', q.statut);
    const ou = `WHERE ${conds.join(' AND ')}`;
    const page = Math.max(1, Math.min(10000, Number.parseInt(q.page, 10) || 1));
    const total = (await pool.query(`SELECT count(*)::int n FROM sh_demandes_site d ${ou}`, vals)).rows[0].n;
    const demandes = (await pool.query(`SELECT d.*, u.nom AS traite_par_nom, a.nom AS attribue_nom, o.nom AS organisation_crm, o.etape AS etape_crm,
        pp.code AS profil_pays_code, pp.nom AS profil_pays_nom,
        (SELECT json_agg(json_build_object('genre', m.genre, 'etat', m.etat, 'sujet', m.sujet, 'texte', m.texte, 'cree_le', m.cree_le, 'envoye_le', m.envoye_le) ORDER BY m.id)
           FROM sh_demandes_courriels m WHERE m.demande_id = d.id) AS courriels
      FROM sh_demandes_site d LEFT JOIN sh_utilisateurs u ON u.id = d.traite_par LEFT JOIN sh_utilisateurs a ON a.id = d.attribue_a
      LEFT JOIN sh_crm_organisations o ON o.id = d.organisation_id
      LEFT JOIN LATERAL (SELECT code, nom FROM sh_profils_pays p WHERE p.pays_code = d.pays_code ORDER BY p.id LIMIT 1) pp ON true
      ${ou} ORDER BY d.recu_le DESC, d.id DESC LIMIT ${PAR_PAGE} OFFSET ${(page - 1) * PAR_PAGE}`, vals)).rows;
    const types = (await pool.query("SELECT DISTINCT type_organisation FROM sh_demandes_site WHERE type_organisation IS NOT NULL ORDER BY 1")).rows.map((x) => x.type_organisation);
    return { vue, demandes, total, page, par_page: PAR_PAGE, types_organisation: types, motifs_rejet: MOTIFS_REJET, modules: MODULES_INTERET };
  }));
  // Changement de statut (un ou plusieurs). Rejet : motif obligatoire. Le journal ne garde que les numéros.
  async function changer(c, u, ids, b) {
    const statut = b.statut;
    if (!STATUTS.includes(statut)) throw new ErreurSh(400, 'Statut invalide.');
    const motif = statut === 'rejetee' ? b.rejet_motif : null;
    if (statut === 'rejetee' && !MOTIFS_REJET.includes(motif)) throw new ErreurSh(400, 'Choisissez le motif du rejet : pourriel, hors cible, doublon ou autre.');
    const note = statut === 'rejetee' ? String(b.rejet_note || '').trim().slice(0, 500) || null : null;
    const r = await c.query(`UPDATE sh_demandes_site SET statut = $2, rejet_motif = $3, rejet_note = $4, traite_par = $5, traite_le = now() WHERE id = ANY($1::int[]) RETURNING id`,
      [ids, statut, motif, note, u.id]);
    if (!r.rowCount) throw new ErreurSh(404, 'Demande introuvable.');
    await journal(c, u, statut === 'a_traiter' ? 'Demande du site remise à traiter' : statut === 'traitee' ? 'Demande du site traitée' : 'Demande du site rejetée',
      r.rows.map((x) => `Demande ${x.id}`).join(', ').slice(0, 500), motif || null);
    return r.rowCount;
  }
  const idsValides = (l) => { const ids = [...new Set((Array.isArray(l) ? l : []).map(entier).filter((x) => x > 0))]; if (!ids.length || ids.length > 200) throw new ErreurSh(400, 'Choisissez de 1 à 200 demandes.'); return ids; };
  async function attribuer(c, u, ids, uid) {
    const cible = uid == null || uid === '' ? null : entier(uid);
    if (cible && !(await c.query("SELECT 1 FROM sh_utilisateurs WHERE id = $1 AND actif AND role IN ('administration','commercial')", [cible])).rowCount) throw new ErreurSh(400, 'Personne introuvable ou sans accès aux demandes.');
    const r = await c.query('UPDATE sh_demandes_site SET attribue_a = $2 WHERE id = ANY($1::int[])', [ids, cible]);
    await journal(c, u, 'Demande du site attribuée', ids.map((x) => `Demande ${x}`).join(', ').slice(0, 500), cible ? `à l’utilisateur ${cible}` : 'sans attribution');
    return r.rowCount;
  }
  api.put('/demandes-site/:id', route(async (req) => transaction(pool, async (c) => {
    const id = entier(req.params.id);
    if (req.body?.attribue_a !== undefined) await attribuer(c, req.u, [id], req.body.attribue_a);
    if (req.body?.statut !== undefined) await changer(c, req.u, [id], req.body);
    return (await c.query('SELECT * FROM sh_demandes_site WHERE id = $1', [id])).rows[0] || (() => { throw new ErreurSh(404, 'Demande introuvable.'); })();
  })));
  api.post('/demandes-site/lot', route(async (req) => transaction(pool, async (c) => {
    const ids = idsValides(req.body?.ids); const a = req.body?.action;
    if (a === 'traiter') return { modifiees: await changer(c, req.u, ids, { statut: 'traitee' }) };
    if (a === 'rejeter') return { modifiees: await changer(c, req.u, ids, { statut: 'rejetee', rejet_motif: req.body.rejet_motif, rejet_note: req.body.rejet_note }) };
    if (a === 'attribuer') return { modifiees: await attribuer(c, req.u, ids, req.body.utilisateur_id) };
    throw new ErreurSh(400, 'Action inconnue : traiter, rejeter ou attribuer.');
  })));
  // Réponse signée « L'équipe Arrimo », modifiable avant envoi ; texte conservé dans l'historique du contact.
  api.post('/demandes-site/:id/repondre', route(async (req) => transaction(pool, async (c) => {
    const d = (await c.query('SELECT * FROM sh_demandes_site WHERE id = $1 FOR UPDATE', [entier(req.params.id)])).rows[0];
    if (!d) throw new ErreurSh(404, 'Demande introuvable.');
    const sujet = String(req.body?.sujet || '').trim().slice(0, 200); const texteR = String(req.body?.texte || '').replace(/\r\n/g, '\n').trim();
    if (!sujet || texteR.length < 10 || texteR.length > 8000) throw new ErreurSh(400, 'Sujet et message (10 à 8000 caractères) requis.');
    const langue = CRM.langueCourriel(d);
    await CRM.mettreEnFile(c, { demande: d.id, organisation: d.organisation_id, genre: 'reponse', destinataire: d.courriel, langue, sujet, texte: texteR, par: req.u.id });
    if (d.organisation_id) await c.query(`INSERT INTO sh_activites (organisation_id, type, titre, contenu, cree_par, terminee_le) VALUES ($1, 'courriel', $2, $3, $4, now())`,
      [d.organisation_id, `Réponse à la demande ${CRM.reference(d.id)} : ${sujet}`.slice(0, 200), texteR, req.u.id]);
    if (req.body?.marquer_traitee === true && d.statut === 'a_traiter') await changer(c, req.u, [d.id], { statut: 'traitee' });
    if (d.organisation_id) await c.query("UPDATE sh_crm_organisations SET etape = 'contacte', etape_le = now() WHERE id = $1 AND etape = 'prospect'", [d.organisation_id]);
    await journal(c, req.u, 'Réponse à une demande du site', `Demande ${d.id}`, null);
    return { ok: true };
  })));
  // Suppression réservée aux pourriels déjà rejetés (administration) ; le journal ne garde que le numéro.
  api.delete('/demandes-site/:id', route(async (req) => {
    const id = entier(req.params.id);
    const d = (await pool.query('SELECT statut, rejet_motif FROM sh_demandes_site WHERE id = $1', [id])).rows[0];
    if (!d) throw new ErreurSh(404, 'Demande introuvable.');
    if (d.statut !== 'rejetee' || d.rejet_motif !== 'pourriel') throw new ErreurSh(409, 'Seul un pourriel rejeté peut être supprimé ; les autres demandes vont aux archives.');
    await pool.query('DELETE FROM sh_demandes_site WHERE id = $1', [id]);
    await journal(pool, req.u, 'Demande du site supprimée', `Demande ${id}`, 'Pourriel');
  }));
  // Suivi des prospects : étape de l'organisation ; « perdu » exige un motif ; « gagné » en fait un client.
  api.put('/crm/organisations/:id/etape', route(async (req) => transaction(pool, async (c) => {
    const id = entier(req.params.id); const etape = req.body?.etape;
    if (!ETAPES.includes(etape)) throw new ErreurSh(400, 'Étape invalide.');
    const motif = String(req.body?.motif || '').trim().slice(0, 500);
    if (etape === 'perdu' && motif.length < 3) throw new ErreurSh(400, 'Indiquez pourquoi le prospect est perdu.');
    const r = await c.query(`UPDATE sh_crm_organisations SET etape = $2, etape_le = now(), perdu_motif = $3, type = CASE WHEN $2 = 'gagne' THEN 'client' ELSE type END, modifie_le = now()
      WHERE id = $1 RETURNING id, nom, etape, type`, [id, etape, etape === 'perdu' ? motif : null]);
    if (!r.rowCount) throw new ErreurSh(404, 'Organisation introuvable.');
    await c.query(`INSERT INTO sh_activites (organisation_id, type, titre, contenu, cree_par, terminee_le) VALUES ($1, 'note', $2, $3, $4, now())`,
      [id, `Étape : ${etape.replace('_', ' ')}`, etape === 'perdu' ? `Motif : ${motif}` : null, req.u.id]);
    await journal(c, req.u, 'Étape du prospect modifiée', r.rows[0].nom, etape + (etape === 'perdu' ? ` · ${motif}` : ''));
    return r.rows[0];
  })));
}
module.exports = { normaliser, depotAutorise, deposer, rattacher, entretien, brancherDepot, brancherEcran, TYPES, PAYS, STATUTS };
