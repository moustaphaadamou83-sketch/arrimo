'use strict';
/**
 * Demandes, lecture commune (moteur commun, lot 0) : les 5 circuits (transferts, hébergement, transport, préalertes, missions CCS)
 * lus dans la vue v_demandes, sans fusion des moteurs (décision du 12 nov., confirmée le 19 nov.). Échéance de réponse commune,
 * alerte de dépassement. Chacun ne voit que les demandes dont il est demandeur ou destinataire ; la direction régionale, sa région.
 * Aucune référence patient dans cette lecture : numéro, parties, statut, motif, heures.
 */
const { ErreurHttp } = require('./db');
const motifs = require('./motifs');

const STATUTS = ['en_attente', 'acceptee', 'en_cours', 'terminee', 'refusee', 'annulee'];
const CIRCUITS = ['transfert', 'hebergement', 'transport', 'prealerte', 'mission_ccs'];

/** Périmètre d'un utilisateur : établissements et organisations visibles. null = tout (gestionnaire réseau). */
async function perimetre(pool, u) {
  if (u.gestionnaire) return null;
  if (u.role === 'direction_regionale') {
    const r = (await pool.query(`SELECT COALESCE(array_agg(DISTINCT e.id) FILTER (WHERE e.id IS NOT NULL), '{}') AS etabs,
        COALESCE(array_agg(DISTINCT o.id) FILTER (WHERE o.id IS NOT NULL), '{}') AS orgs
      FROM utilisateur_directions ud JOIN directions_regionales d ON d.id = ud.direction_id AND d.actif
      LEFT JOIN etablissements e ON e.region_id = d.region_id LEFT JOIN organisations_secours o ON o.region_id = d.region_id
      WHERE ud.utilisateur_id = $1`, [u.id])).rows[0];
    return { etabs: r.etabs, orgs: r.orgs };
  }
  const orgs = (await pool.query('SELECT organisation_id FROM utilisateur_organisations WHERE utilisateur_id = $1', [u.id])).rows.map((r) => r.organisation_id);
  return { etabs: (u.etabs || []).map(Number), orgs };
}

async function liste(pool, u, q = {}) {
  const p = await perimetre(pool, u);
  const conds = []; const vals = [];
  const add = (sql, v) => { vals.push(v); conds.push(sql.replace('?', `$${vals.length}`)); };
  if (p) {
    vals.push(p.etabs, p.orgs);
    conds.push(`((demandeur_type = 'etablissement' AND demandeur_id = ANY($1)) OR (destinataire_type = 'etablissement' AND destinataire_id = ANY($1))
      OR (demandeur_type = 'organisation' AND demandeur_id = ANY($2)) OR (destinataire_type = 'organisation' AND destinataire_id = ANY($2)))`);
  }
  if (q.circuit !== undefined) { if (!CIRCUITS.includes(q.circuit)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'circuit' }); add('circuit = ?', q.circuit); }
  if (q.statut !== undefined) { if (!STATUTS.includes(q.statut)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'statut' }); add('statut = ?', q.statut); }
  if (q.etablissement_id !== undefined) {
    const id = Number(q.etablissement_id);
    if (!Number.isInteger(id) || (p && !p.etabs.includes(id))) throw new ErreurHttp(403, 'etab_interdit');
    add("((demandeur_type = 'etablissement' AND demandeur_id = ?) OR (destinataire_type = 'etablissement' AND destinataire_id = $" + (vals.length + 1) + '))', id);
  }
  if (q.en_retard === '1' || q.en_retard === true) conds.push("statut = 'en_attente' AND echeance_le < now()");
  const rows = (await pool.query(`SELECT circuit, id, numero, demandeur_type, demandeur_id, destinataire_type, destinataire_id, statut_source, statut, motif,
      cree_le, repondue_le, echeance_le, (statut = 'en_attente' AND echeance_le < now()) AS en_retard
    FROM v_demandes ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''} ORDER BY cree_le DESC LIMIT 500`, vals)).rows;
  const langue = u.langue === 'en' ? 'en' : 'fr';
  return rows.map((r) => ({ ...r, motif_libelle: r.motif ? motifs.libelle(r.motif, langue) : null }));
}

/** Synthèse par circuit et statut, avec le nombre de demandes en attente au-delà de l'échéance. */
async function synthese(pool, u, q = {}) {
  const rows = await liste(pool, u, q);
  const parCircuit = {};
  for (const r of rows) {
    const c = parCircuit[r.circuit] || (parCircuit[r.circuit] = { total: 0, en_retard: 0, ...Object.fromEntries(STATUTS.map((s) => [s, 0])) });
    c.total += 1; c[r.statut] += 1; if (r.en_retard) c.en_retard += 1;
  }
  return { par_circuit: parCircuit, en_retard: rows.filter((r) => r.en_retard).length };
}

module.exports = { liste, synthese, perimetre, STATUTS, CIRCUITS };
