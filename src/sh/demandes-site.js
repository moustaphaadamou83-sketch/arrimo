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
const STATUTS = ['nouvelle', 'en_cours', 'traitee', 'rejetee'];
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
  if (b.consentement !== true) throw refus('consentement_requis');
  const email = texte(b.courriel, 254, { requis: true });
  if (!COURRIEL.test(email)) throw refus('courriel_invalide');
  const telephone = texte(b.telephone, 40);
  return { depot_id: b.depot_id, type: b.type, ...(ancien ? { pays: b.pays } : { pays_code: b.pays_code }), langue: b.langue, courriel: email,
    ville: texte(b.ville, 120), langue_contact: b.langue_contact || null, telephone_a_verifier: !!telephone && !E164.test(telephone),
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
  const r = await pool.query(`INSERT INTO sh_demandes_site (${cles.join(',')}) VALUES (${cles.map((_, i) => `$${i + 1}`).join(',')})
    ON CONFLICT (depot_id) DO NOTHING RETURNING id`, cles.map((k) => v[k]));
  return { ok: true, nouvelle: r.rowCount === 1 };
}
/** Alertes en attente, puis suppression après 24 mois. Le courriel ne contient ni nom, ni adresse, ni message. */
async function entretien(pool, env = process.env) {
  const supprimees = (await pool.query("DELETE FROM sh_demandes_site WHERE recu_le < now() - interval '24 months'")).rowCount;
  if (supprimees) await pool.query(`INSERT INTO sh_journal (action, cible, detail) VALUES ('Demandes du site supprimées', 'Conservation', $1)`, [`${supprimees} après 24 mois`]);
  let alertes = 0;
  const a = String(env.SH_DEPOT_SITE_ALERTE || '').trim();
  if (a && courriel.actif(env.SH_PUBLIC_URL, env)) {
    // Réservée d'abord : deux passages simultanés n'envoient jamais la même alerte. Un échec la remet en attente.
    const { rows } = await pool.query(`UPDATE sh_demandes_site SET alerte_le = now() WHERE id IN (
      SELECT id FROM sh_demandes_site WHERE alerte_le IS NULL ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING id, type, pays`);
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
  api.get('/demandes-site', route(async (req) => {
    const statut = req.query.statut === undefined || req.query.statut === '' ? null : String(req.query.statut);
    if (statut && !STATUTS.includes(statut)) throw new ErreurSh(400, 'Statut invalide.');
    const pays = /^[A-Z]{2}$/.test(String(req.query.pays || '')) ? String(req.query.pays) : null;
    const langue = LANGUES_CONTACT.includes(req.query.langue) ? req.query.langue : null;
    const ville = String(req.query.ville || '').trim().slice(0, 120) || null;
    // Profil de pays rattaché quand il existe (configuration du pays dans SH)
    return (await pool.query(`SELECT d.*, u.nom AS traite_par_nom, pp.code AS profil_pays_code, pp.nom AS profil_pays_nom
      FROM sh_demandes_site d LEFT JOIN sh_utilisateurs u ON u.id = d.traite_par
      LEFT JOIN LATERAL (SELECT code, nom FROM sh_profils_pays p WHERE p.pays_code = d.pays_code ORDER BY p.id LIMIT 1) pp ON true
      WHERE ($1::text IS NULL OR d.statut = $1) AND ($2::text IS NULL OR d.pays_code = $2) AND ($3::text IS NULL OR coalesce(d.langue_contact, d.langue) = $3)
        AND ($4::text IS NULL OR d.ville ILIKE '%' || $4 || '%')
      ORDER BY d.recu_le DESC, d.id DESC LIMIT 500`, [statut, pays, langue, ville])).rows;
  }));
  api.put('/demandes-site/:id', route(async (req) => {
    const id = entier(req.params.id);
    if (!STATUTS.includes(req.body?.statut)) throw new ErreurSh(400, 'Statut invalide.');
    const d = (await pool.query('UPDATE sh_demandes_site SET statut = $2, traite_par = $3, traite_le = now() WHERE id = $1 RETURNING *', [id, req.body.statut, req.u.id])).rows[0];
    if (!d) throw new ErreurSh(404, 'Demande introuvable.');
    await journal(pool, req.u, 'Demande du site modifiée', `Demande ${id}`, req.body.statut);
    return d;
  }));
  // Droit de suppression (Loi 25) : le journal ne garde que le numéro.
  api.delete('/demandes-site/:id', route(async (req) => {
    const id = entier(req.params.id);
    if (!(await pool.query('DELETE FROM sh_demandes_site WHERE id = $1', [id])).rowCount) throw new ErreurSh(404, 'Demande introuvable.');
    await journal(pool, req.u, 'Demande du site supprimée', `Demande ${id}`, 'Sur décision de l’administration');
  }));
}
module.exports = { normaliser, depotAutorise, deposer, entretien, brancherDepot, brancherEcran, TYPES, PAYS, STATUTS };
