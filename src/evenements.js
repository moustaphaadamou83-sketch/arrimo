'use strict';
/* Numérisation des fax, cahiers et appels : saisie structurée et import CSV vérifié. Auteur, date, statut, historique.
   Un import n'entre qu'après vérification et confirmation par une personne. Aucune reconnaissance de texte automatique. */
const crypto = require('node:crypto');
const { ErreurHttp, transaction } = require('./db');
const { exigerEtablissement } = require('./auth');

const TYPES = ['demande_transfert', 'admission_retour', 'absence', 'communication', 'confirmation', 'tache_preparation', 'information'];
const STATUTS = ['ouvert', 'traite', 'annule'];
const ROLES = ['coordonnateur', 'admin_etab', 'gestionnaire', 'equipe_soins'];
const MAX_IMPORT = 40000; const MAX_LIGNES = 300;
const garde = (u, e) => { exigerEtablissement(u, e); if (!ROLES.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant'); };
const empreinte = (s) => crypto.createHash('sha256').update(s).digest('hex');

function champs(b) {
  if (!TYPES.includes(b.type)) throw new ErreurHttp(400, 'evenement_invalide');
  const contenu = String(b.contenu ?? '').trim(); const reference = String(b.reference ?? '').trim();
  if (!contenu || contenu.length > 1000 || reference.length > 40) throw new ErreurHttp(400, 'evenement_invalide');
  return { type: b.type, contenu, reference: reference || null };
}
async function inserer(c, etab, u, v, source) {
  const e = (await c.query(`INSERT INTO evenements_saisis (etablissement_id, type, reference, contenu, source, auteur) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [etab, v.type, v.reference, v.contenu, source, u.id])).rows[0];
  await c.query('INSERT INTO evenements_saisis_historique (evenement_id, statut, par) VALUES ($1, $2, $3)', [e.id, 'ouvert', u.id]);
  return e;
}
/** Lit le fichier sans rien écrire. En-tête exacte : type;reference;contenu. Une erreur par ligne, rien n'est deviné. */
function analyser(texte) {
  const s = String(texte ?? '').replace(/^﻿/, '');
  if (!s.trim() || s.length > MAX_IMPORT) throw new ErreurHttp(400, 'import_invalide');
  if (s.startsWith('%PDF') || s.includes('\u0000')) throw new ErreurHttp(400, 'import_format');
  const lignes = s.split(/\r?\n/).filter((l) => l.trim());
  const sep = lignes[0].includes(';') ? ';' : ',';
  if (lignes[0].split(sep).map((x) => x.trim().toLowerCase()).join(',') !== 'type,reference,contenu') throw new ErreurHttp(400, 'import_entete');
  if (lignes.length - 1 > MAX_LIGNES) throw new ErreurHttp(400, 'import_invalide');
  const valides = []; const erreurs = [];
  lignes.slice(1).forEach((l, i) => {
    const [type, reference, ...reste] = l.split(sep);
    try { valides.push(champs({ type: String(type).trim(), reference, contenu: reste.join(sep) })); } catch { erreurs.push({ ligne: i + 2, code: 'ligne_invalide' }); }
  });
  return { valides, erreurs, empreinte: empreinte(s) };
}
function brancher(api, pool, route, entier) {
  api.get('/evenements', route(async (req) => {
    const e = entier(req.query.etablissement_id, 'etablissement_id'); garde(req.utilisateur, e);
    return (await pool.query(`SELECT v.*, a.nom AS auteur_nom, COALESCE((SELECT json_agg(json_build_object('statut', h.statut, 'le', h.le, 'par', u.nom) ORDER BY h.id) FROM evenements_saisis_historique h LEFT JOIN utilisateurs u ON u.id = h.par WHERE h.evenement_id = v.id), '[]') AS historique
      FROM evenements_saisis v LEFT JOIN utilisateurs a ON a.id = v.auteur WHERE v.etablissement_id = $1 ORDER BY v.id DESC LIMIT 200`, [e])).rows;
  }));
  api.post('/evenements', route(async (req) => {
    const e = entier(req.body?.etablissement_id, 'etablissement_id'); garde(req.utilisateur, e); const v = champs(req.body);
    return transaction(pool, (c) => inserer(c, e, req.utilisateur, v, 'saisie'));
  }));
  api.post('/evenements/:id/statut', route(async (req) => {
    const id = entier(req.params.id, 'id');
    if (!STATUTS.includes(req.body?.statut) || req.body.statut === 'ouvert') throw new ErreurHttp(400, 'evenement_invalide');
    return transaction(pool, async (c) => {
      const v = (await c.query('SELECT * FROM evenements_saisis WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!v) throw new ErreurHttp(404, 'evenement_introuvable');
      garde(req.utilisateur, v.etablissement_id);
      if (v.version !== Number(req.body.version)) throw new ErreurHttp(409, 'version_perimee');
      if (v.statut !== 'ouvert') throw new ErreurHttp(409, 'evenement_clos');
      const n = (await c.query('UPDATE evenements_saisis SET statut = $2, version = version + 1 WHERE id = $1 RETURNING *', [id, req.body.statut])).rows[0];
      await c.query('INSERT INTO evenements_saisis_historique (evenement_id, statut, par) VALUES ($1, $2, $3)', [id, req.body.statut, req.utilisateur.id]);
      return n;
    });
  }));
  api.post('/evenements/import/verifier', route(async (req) => {
    const e = entier(req.body?.etablissement_id, 'etablissement_id'); garde(req.utilisateur, e);
    const a = analyser(req.body.contenu);
    return { apercu: a.valides, erreurs: a.erreurs, empreinte: a.empreinte };
  }));
  api.post('/evenements/import', route(async (req) => {
    const e = entier(req.body?.etablissement_id, 'etablissement_id'); garde(req.utilisateur, e);
    if (req.body.confirme !== true) throw new ErreurHttp(400, 'import_a_confirmer');
    const a = analyser(req.body.contenu);
    if (a.erreurs.length) throw new ErreurHttp(409, 'import_erreurs', { n: a.erreurs.length });
    if (a.empreinte !== req.body.empreinte) throw new ErreurHttp(409, 'import_modifie');
    return transaction(pool, async (c) => { for (const v of a.valides) await inserer(c, e, req.utilisateur, v, 'import'); return { importes: a.valides.length }; });
  }));
}
module.exports = { brancher, TYPES };
