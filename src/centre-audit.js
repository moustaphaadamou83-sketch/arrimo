'use strict';
/**
 * Centre d'audit (refonte unifiée, cahier directeur §21-22 ; 26 nov. 2026). Une recherche sur les journaux EXISTANTS, sans copie :
 * journal opérationnel (immuable), journal d'administration (immuable), journal des suivis d'alertes (immuable).
 * Filtres : période, utilisateur, source, action, texte, refus seulement. Indicateurs d'activité et d'anomalies (refus, escalades).
 * Export CSV contrôlé, lui-même journalisé. Réservé à l'administration de l'établissement et à la gestion réseau.
 * Distinct de Sillage (chronologie opérationnelle) ; rapprochement par la référence (numéro de transfert, de transport…).
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');

const ROLES = ['admin_etab', 'gestionnaire'];
const SOURCES = ['operations', 'administration', 'alertes'];
const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

function filtres(q) {
  const date = (v, nom) => { if (!v) return null; const d = new Date(String(v)); if (Number.isNaN(d.getTime())) throw new ErreurHttp(400, 'parametre_invalide', { nom }); return d; };
  const au = date(q.au, 'au') || new Date(); const du = date(q.du, 'du') || new Date(au.getTime() - 7 * 86400000);
  if (du >= au || au - du > 366 * 86400000) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'du' });
  const sources = q.source ? String(q.source).split(',').filter((x) => SOURCES.includes(x)) : SOURCES;
  if (!sources.length) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'source' });
  const texte = q.texte ? String(q.texte).slice(0, 80) : null;
  return { du, au, sources, texte, utilisateur: entier(q.utilisateur_id), action: q.action ? String(q.action).slice(0, 80) : null, refus: q.refus === '1',
    limite: Math.min(Math.max(Number(q.limite) || 200, 1), 1000) };
}

async function rechercher(pool, u, q = {}) {
  const etabId = entier(q.etablissement_id); if (!etabId) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, etabId);
  if (!ROLES.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const f = filtres(q);
  const morceaux = [];
  if (f.sources.includes('operations')) morceaux.push(`SELECT 'operations' AS source, j.id, j.date, j.utilisateur_id, x.nom AS utilisateur, j.action, j.detail,
      j.ancien_etat, j.nouvel_etat, j.refuse, t.numero AS reference FROM journal j LEFT JOIN utilisateurs x ON x.id = j.utilisateur_id LEFT JOIN transferts t ON t.id = j.transfert_id
      WHERE j.etablissement_id = $1 AND j.date >= $2 AND j.date < $3`);
  if (f.sources.includes('administration')) morceaux.push(`SELECT 'administration', a.id, a.date, a.utilisateur_id, x.nom, a.action, concat_ws(' · ', a.cible, a.detail),
      NULL, NULL, false, NULL FROM journal_admin a LEFT JOIN utilisateurs x ON x.id = a.utilisateur_id WHERE a.etablissement_id = $1 AND a.date >= $2 AND a.date < $3`);
  if (f.sources.includes('alertes')) morceaux.push(`SELECT 'alertes', sj.id, sj.cree_le, sj.auteur_id, x.nom, 'Suivi d’alerte : ' || sj.action, s.titre,
      NULL, s.statut, false, s.type FROM suivis_alertes_journal sj JOIN suivis_alertes s ON s.id = sj.suivi_id LEFT JOIN utilisateurs x ON x.id = sj.auteur_id
      WHERE s.etablissement_id = $1 AND sj.cree_le >= $2 AND sj.cree_le < $3`);
  const vals = [etabId, f.du, f.au]; const cond = [];
  if (f.utilisateur) { vals.push(f.utilisateur); cond.push(`utilisateur_id = $${vals.length}`); }
  if (f.action) { vals.push(`%${f.action}%`); cond.push(`action ILIKE $${vals.length}`); }
  if (f.texte) { vals.push(`%${f.texte}%`); cond.push(`(detail ILIKE $${vals.length} OR reference ILIKE $${vals.length})`); }
  if (f.refus) cond.push('refuse');
  const sql = `SELECT * FROM (${morceaux.join(' UNION ALL ')}) e(source, id, date, utilisateur_id, utilisateur, action, detail, ancien_etat, nouvel_etat, refuse, reference)
    ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}`;
  const evenements = (await pool.query(`${sql} ORDER BY date DESC LIMIT ${f.limite}`, vals)).rows.map((e) => ({ ...e, id: `${e.source}:${e.id}` }));
  const stats = (await pool.query(`SELECT source, count(*)::int AS n, count(*) FILTER (WHERE refuse)::int AS refus,
      count(*) FILTER (WHERE action ILIKE '%escalade%')::int AS escalades FROM (${sql}) s GROUP BY source`, vals)).rows;
  return { periode: { du: f.du, au: f.au }, sources: f.sources, evenements, tronque: evenements.length === f.limite,
    activite: Object.fromEntries(stats.map((s) => [s.source, { evenements: s.n, refus: s.refus, escalades: s.escalades }])),
    regle: u.langue === 'en' ? 'Immutable logs, searched in place. Distinct from Sillage (operational timeline); linked by reference.'
      : 'Journaux immuables, consultés sur place. Distinct de Sillage (chronologie opérationnelle) ; rapprochement par la référence.' };
}

/** Export CSV des résultats autorisés ; l'export lui-même est journalisé (journal d'administration). */
async function exporter(pool, u, q = {}) {
  const r = await rechercher(pool, u, { ...q, limite: 1000 });
  const champ = (v) => { const s = v == null ? '' : String(v instanceof Date ? v.toISOString() : v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const tete = ['source', 'date', 'utilisateur', 'action', 'reference', 'ancien_etat', 'nouvel_etat', 'refuse', 'detail'];
  const lignes = r.evenements.map((e) => tete.map((k) => champ(e[k])).join(';'));
  await pool.query(`INSERT INTO journal_admin (utilisateur_id, etablissement_id, action, cible, detail) VALUES ($1, $2, 'Export du centre d’audit', $3, $4)`,
    [u.id, Number(q.etablissement_id), `${r.evenements.length} événements`, `${new Date(r.periode.du).toISOString()} → ${new Date(r.periode.au).toISOString()}`]);
  return `﻿${[tete.join(';'), ...lignes].join('\r\n')}\r\n`;
}

module.exports = { rechercher, exporter };
