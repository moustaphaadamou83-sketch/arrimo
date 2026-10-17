/**
 * API réservée à la console SH (siège), avec la clé de service de cet environnement (en-tête X-SH-Key = SH_API_KEY du .env).
 * La console ne reçoit que la structure, les comptes et des compteurs : jamais de référence patient.
 * Chaque action est inscrite au journal d'administration de l'environnement, avec le courriel du membre SH (« par »).
 *   GET  /api/sh/etablissements                  établissements et compteurs (unités, chambres, lits, civières, comptes)
 *   POST /api/sh/etablissements                  nouvel établissement (inactif)
 *   PUT  /api/sh/etablissements/{code}           module_actif (avec motif pour une désactivation), partage, sous_domaine
 *   GET  /api/sh/import/modeles/{type}           modèle CSV
 *   POST /api/sh/import/verifier | importer      import CSV (mêmes règles que l'administration)
 */
const crypto = require('crypto');
const { ErreurHttp } = require('./db');
const { journalAdmin, creerEtablissement } = require('./admin');
const imp = require('./import');

// Noms réservés : ne peuvent pas servir de lien d'hôpital
const RESERVES = ['www', 'sh', 'recette', 'api', 'demo', 'admin', 'mail'];
const SOUS_DOMAINE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

function exigerCle(req) {
  const cle = process.env.SH_API_KEY;
  const fournie = String(req.get('x-sh-key') || '');
  if (!cle) throw new ErreurHttp(503, 'sh_non_configure');
  const ok = fournie.length === cle.length && crypto.timingSafeEqual(Buffer.from(fournie), Buffer.from(cle));
  if (!ok) throw new ErreurHttp(401, 'cle_sh_invalide');
}
/** Auteur de l'action côté SH (courriel), repris dans le journal de l'environnement. */
const parSh = (b) => `console SH · ${String((b && b.par) || 'inconnu').slice(0, 120)}`;
const systeme = { id: null };

function brancherSh(api, pool, route) {
  const sh = (fn) => route(async (req, res) => { exigerCle(req); return fn(req, res); });
  const etabParCode = async (code) => {
    const e = (await pool.query('SELECT id, code, nom, partage, module_actif, sous_domaine FROM etablissements WHERE code = $1', [String(code || '').trim().toUpperCase()])).rows[0];
    if (!e) throw new ErreurHttp(404, 'etab_introuvable');
    return e;
  };

  api.get('/sh/etablissements', sh(async () => (await pool.query(
    `SELECT e.id, e.code, e.nom, e.ville, e.adresse, e.partage, e.module_actif, e.sous_domaine,
            (SELECT count(*)::int FROM unites u WHERE u.etablissement_id = e.id) AS unites,
            (SELECT count(*)::int FROM chambres ch JOIN unites u ON u.id = ch.unite_id WHERE u.etablissement_id = e.id) AS chambres,
            (SELECT count(*)::int FROM lits l WHERE l.etablissement_id = e.id) AS lits,
            (SELECT count(*)::int FROM civieres c WHERE c.etablissement_id = e.id) AS civieres,
            (SELECT count(*)::int FROM utilisateur_etablissements ue JOIN utilisateurs us ON us.id = ue.utilisateur_id AND us.actif
              WHERE ue.etablissement_id = e.id) AS comptes
       FROM etablissements e WHERE e.actif ORDER BY e.nom`)).rows));

  api.post('/sh/etablissements', sh((req) => creerEtablissement(pool, req.body,
    (c, e) => journalAdmin(c, systeme, 'Établissement créé', `${e.code} · ${e.nom}`, parSh(req.body), e.id))));

  api.put('/sh/etablissements/:code', sh(async (req) => {
    const b = req.body || {};
    const e = await etabParCode(req.params.code);
    const sets = []; const vals = [e.id]; const detail = [];
    if (b.module_actif !== undefined) {
      const actif = !!b.module_actif;
      const motif = String(b.motif || '').trim();
      // Désactivation demandée par la console : motif obligatoire
      if (!actif && b.par && motif.length < 3) throw new ErreurHttp(400, 'motif_desactivation');
      vals.push(actif); sets.push(`module_actif = $${vals.length}`);
      detail.push(`module ${actif ? 'activé' : 'désactivé'}${motif ? ` · motif : ${motif.slice(0, 300)}` : ''}`);
    }
    if (b.partage !== undefined) {
      if (!['complet', 'agrege', 'aucun'].includes(b.partage)) throw new ErreurHttp(400, 'partage_invalide');
      vals.push(b.partage); sets.push(`partage = $${vals.length}`); detail.push(`partage ${b.partage}`);
    }
    if (b.sous_domaine !== undefined) {
      const sd = b.sous_domaine == null || b.sous_domaine === '' ? null : String(b.sous_domaine).trim().toLowerCase();
      if (sd && (!SOUS_DOMAINE.test(sd) || RESERVES.includes(sd))) throw new ErreurHttp(400, 'sous_domaine_invalide');
      if (sd && (await pool.query('SELECT 1 FROM etablissements WHERE sous_domaine = $1 AND id <> $2', [sd, e.id])).rows[0]) throw new ErreurHttp(409, 'sous_domaine_pris');
      vals.push(sd); sets.push(`sous_domaine = $${vals.length}`); detail.push(`lien ${sd || 'retiré'}`);
    }
    if (!sets.length) throw new ErreurHttp(400, 'rien_a_modifier');
    const r = (await pool.query(`UPDATE etablissements SET ${sets.join(', ')} WHERE id = $1 RETURNING id, code, nom, partage, module_actif, sous_domaine`, vals)).rows[0];
    await journalAdmin(pool, systeme, 'Établissement modifié', r.nom, `${detail.join(' · ')} · ${parSh(b)}`, r.id);
    return r;
  }));

  api.get('/sh/import/modeles/:type', async (req, res, next) => {
    try {
      exigerCle(req);
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="arrimo-${req.params.type}.csv"` }).send(imp.modele(req.params.type));
    } catch (e) { next(e); }
  });
  api.post('/sh/import/verifier', sh(async (req) => {
    const e = await etabParCode(req.body.code);
    const v = await imp.verifier(pool, e.id, String(req.body.type || ''), String(req.body.contenu || ''));
    return { lignes: v.lignes, erreurs: v.erreurs.slice(0, 500), nb_erreurs: v.erreurs.length, actions: v.actions.slice(0, 500), resume: v.resume, empreinte: v.empreinte };
  }));
  api.post('/sh/import/importer', sh(async (req) => {
    const e = await etabParCode(req.body.code);
    // Journal de l'environnement : l'auteur est le membre SH
    const journal = (c, u, action, cible, detail, etab) => journalAdmin(c, systeme, action, cible, `${detail} · ${parSh(req.body)}`, etab);
    return imp.importer(pool, systeme, e.id, String(req.body.type || ''), String(req.body.contenu || ''), String(req.body.empreinte || ''), journal);
  }));
}

/** Lien propre d'un hôpital : <sous_domaine>.<hôte de l'environnement> mène à son établissement. */
async function etablissementDuLien(pool, hoteDemande, hoteEnv) {
  const h = String(hoteDemande || '').toLowerCase();
  if (!hoteEnv || !h.endsWith(`.${hoteEnv}`)) return null;
  const sd = h.slice(0, -(hoteEnv.length + 1));
  if (!SOUS_DOMAINE.test(sd)) return null;
  return (await pool.query('SELECT id, nom FROM etablissements WHERE sous_domaine = $1 AND actif', [sd])).rows[0] || null;
}

module.exports = { brancherSh, etablissementDuLien, SOUS_DOMAINE, RESERVES };
