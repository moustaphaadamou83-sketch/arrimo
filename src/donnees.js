'use strict';
/**
 * Données (cahier v2, C.6 ; 20 nov. 2026) : tableaux par région et par établissement, calculés depuis l'Horloge et les tables
 * existantes ; jamais de référence patient. Cellule masquée sous 5 (1 à 4 → « < 5 ») ; la direction régionale ne voit que sa région.
 * Liste d'attente = épisodes NSA ouverts + demandes d'hébergement en cours, par orientation (type de ressource) : nombre de personnes,
 * ancienneté médiane, places libres en face.
 */
const { ErreurHttp } = require('./db');
const TE = require('./types-etablissement');

const SEUIL = 5;
const masquer = (n) => (n == null ? null : n > 0 && n < SEUIL ? { masque: true } : n);
const mediane = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10; };
const ORIENT_GENRE = { chsld: 'chsld', chsld_prive_conventionne: 'chsld', chsld_prive: 'chsld_prive', rpa: 'rpa', ri: 'ri', rtf: 'rtf', maison_aines: 'maison_aines', palliatif: 'soins_palliatifs' };

/** Établissements du périmètre : direction régionale (sa région), gestionnaire (tout, ou une région), établissement (sa région, module actif). */
async function perimetre(db, u, q) {
  if (u.role === 'direction_regionale') {
    const r = (await db.query(`SELECT DISTINCT d.region_id FROM utilisateur_directions ud JOIN directions_regionales d ON d.id = ud.direction_id AND d.actif WHERE ud.utilisateur_id = $1`, [u.id])).rows.map((x) => x.region_id);
    if (!r.length) throw new ErreurHttp(403, 'direction_sans_region');
    return { regions: r };
  }
  if (u.gestionnaire) return { regions: q.region_id ? [Number(q.region_id)] : null };
  const id = Number(q.etablissement_id);
  if (!(u.etabs || []).map(Number).includes(id)) throw new ErreurHttp(403, 'etab_interdit');
  const e = (await db.query('SELECT id, region_id, modules, type_etablissement FROM etablissements WHERE id = $1', [id])).rows[0];
  if (!e || !TE.moduleActif(e, 'donnees_regionales')) throw new ErreurHttp(403, 'module_desactive', { module: 'donnees_regionales' });
  return e.region_id ? { regions: [e.region_id] } : { etablissements: [e.id] };
}
function periode(q) {
  const fin = q.fin ? new Date(q.fin) : new Date(); const debut = q.debut ? new Date(q.debut) : new Date(fin.getTime() - 30 * 86400000);
  if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime()) || debut >= fin || fin - debut > 400 * 86400000) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'periode' });
  return { debut, fin };
}

/** Chiffres bruts (avant masquage) : une ligne par établissement du périmètre. */
async function brut(db, per, { debut, fin }) {
  const etabs = (await db.query(`SELECT e.id, e.nom, e.type_etablissement, e.type_local_code, e.region_id, r.code AS region_code, r.nom AS region_nom
    FROM etablissements e LEFT JOIN regions r ON r.id = e.region_id
    WHERE e.actif AND ($1::int[] IS NULL OR e.region_id = ANY($1)) AND ($2::int[] IS NULL OR e.id = ANY($2)) ORDER BY e.nom`, [per.regions || null, per.etablissements || null])).rows;
  const ids = etabs.map((e) => e.id);
  const q = async (sql, vals = []) => (await db.query(sql, [ids, debut, fin, ...vals])).rows;
  const chrono = await q(`SELECT p.etablissement_id AS id, p.id AS passage,
      EXTRACT(EPOCH FROM (h14.heure - h11.heure)) / 60 AS porte FROM passages_chrono p
      LEFT JOIN v_horodatages_courants h11 ON h11.objet = 'passage_chrono' AND h11.objet_id = p.id AND h11.etape = 'H11'
      LEFT JOIN v_horodatages_courants h14 ON h14.objet = 'passage_chrono' AND h14.objet_id = p.id AND h14.etape = 'H14'
    WHERE p.etablissement_id = ANY($1) AND p.cree_le BETWEEN $2 AND $3 AND p.statut IN ('a_la_porte', 'termine')`);
  const transferts = await q(`SELECT t.origine_id, t.destination_id, t.statut, t.motif_refus_code,
      EXTRACT(EPOCH FROM (hd.heure - hq.heure)) / 60 AS decision FROM transferts t
      LEFT JOIN v_horodatages_courants hq ON hq.objet = 'transfert' AND hq.objet_id = t.id AND hq.etape = 'demande'
      LEFT JOIN v_horodatages_courants hd ON hd.objet = 'transfert' AND hd.objet_id = t.id AND hd.etape = 'decision'
    WHERE (t.origine_id = ANY($1) OR t.destination_id = ANY($1)) AND t.date_demande BETWEEN $2 AND $3`);
  const nsa = await q(`SELECT etablissement_id AS id, orientation, EXTRACT(EPOCH FROM (now() - debut_le)) / 86400 AS jours FROM nsa_episodes WHERE etablissement_id = ANY($1) AND statut = 'actif' AND $2::timestamptz IS NOT NULL AND $3::timestamptz IS NOT NULL`);
  const refus = await q(`SELECT circuit, motif, demandeur_id, destinataire_id, demandeur_type, destinataire_type FROM v_demandes
    WHERE statut = 'refusee' AND cree_le BETWEEN $2 AND $3 AND ((destinataire_type = 'etablissement' AND destinataire_id = ANY($1)) OR (demandeur_type = 'etablissement' AND demandeur_id = ANY($1)))`);
  const places = await q(`SELECT e.id, e.type_local_code, COALESCE(p.places_libres_declarees, (SELECT count(*)::int FROM lits l WHERE l.etablissement_id = e.id AND l.etat = 'libre' AND l.actif)) AS libres
    FROM etablissements e LEFT JOIN ressource_profils p ON p.etablissement_id = e.id WHERE e.id = ANY($1) AND e.type_etablissement = 'chsld' AND $2::timestamptz IS NOT NULL AND $3::timestamptz IS NOT NULL`);
  const demandesHeb = await q(`SELECT h.etablissement_id AS id, e.type_local_code, EXTRACT(EPOCH FROM (now() - h.cree_le)) / 86400 AS jours FROM demandes_hebergement h
    JOIN etablissements e ON e.id = h.etablissement_id WHERE h.etablissement_id = ANY($1) AND h.statut IN ('recue', 'documents_manquants', 'en_verification', 'place_proposee', 'acceptee')
      AND $2::timestamptz IS NOT NULL AND $3::timestamptz IS NOT NULL`);
  return { etabs, chrono, transferts, nsa, refus, places, demandesHeb };
}

async function tableau(pool, u, q = {}) {
  const per = await perimetre(pool, u, q); const p = periode(q);
  const b = await brut(pool, per, p);
  const lignes = b.etabs.map((e) => {
    const ch = b.chrono.filter((x) => x.id === e.id); const tr = b.transferts.filter((x) => x.origine_id === e.id || x.destination_id === e.id);
    const ns = b.nsa.filter((x) => x.id === e.id);
    return { id: e.id, nom: e.nom, region: e.region_code, type: e.type_etablissement,
      chrono_passages: ch.length, chrono_porte_mediane_min: mediane(ch.map((x) => (x.porte == null ? null : Number(x.porte)))),
      transferts: tr.length, transferts_refuses: tr.filter((x) => x.statut === 'refuse' && x.destination_id === e.id).length,
      transferts_decision_mediane_min: mediane(tr.filter((x) => x.destination_id === e.id).map((x) => (x.decision == null ? null : Number(x.decision)))),
      nsa_actifs: ns.length, nsa_jours_median: mediane(ns.map((x) => Math.floor(Number(x.jours)))),
      places_libres: b.places.filter((x) => x.id === e.id).reduce((s, x) => s + Number(x.libres || 0), 0) };
  });
  // Totaux calculés sur les chiffres bruts, puis masqués comme le détail
  const somme = (k) => lignes.reduce((s, l) => s + (l[k] || 0), 0);
  const totaux = Object.fromEntries(['chrono_passages', 'transferts', 'transferts_refuses', 'nsa_actifs', 'places_libres'].map((k) => [k, somme(k)]));
  const refus = {};
  for (const r of b.refus) { const k = `${r.circuit}:${r.motif || 'sans_motif'}`; refus[k] = (refus[k] || 0) + 1; }
  // Listes d'attente par type de ressource : NSA ouverts (orientation) + demandes d'hébergement en cours ; places libres en face
  const attente = {};
  const ajout = (g, jours) => { const a = attente[g] || (attente[g] = { personnes: 0, jours: [], places_libres: 0 }); a.personnes += 1; a.jours.push(Number(jours)); };
  for (const n of b.nsa) if (ORIENT_GENRE[n.orientation]) ajout(ORIENT_GENRE[n.orientation], n.jours);
  for (const d of b.demandesHeb) ajout(d.type_local_code || 'chsld', d.jours);
  for (const pl of b.places) { const g = pl.type_local_code || 'chsld'; (attente[g] || (attente[g] = { personnes: 0, jours: [], places_libres: 0 })).places_libres += Number(pl.libres || 0); }
  const masqueLigne = (l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, ['chrono_passages', 'transferts', 'transferts_refuses', 'nsa_actifs'].includes(k) ? masquer(v) : v]));
  return { periode: p, seuil_masquage: SEUIL,
    etablissements: lignes.map(masqueLigne),
    totaux: Object.fromEntries(Object.entries(totaux).map(([k, v]) => [k, k === 'places_libres' ? v : masquer(v)])),
    refus_par_motif: Object.fromEntries(Object.entries(refus).map(([k, v]) => [k, masquer(v)])),
    listes_attente: Object.entries(attente).map(([genre, a]) => ({ genre, personnes: masquer(a.personnes), anciennete_mediane_jours: a.personnes >= SEUIL ? mediane(a.jours.map(Math.floor)) : null, places_libres: a.places_libres }))
      .sort((x, y) => x.genre.localeCompare(y.genre)) };
}

function csv(t, langue = 'fr') {
  const en = langue === 'en'; const v = (x) => (x && x.masque ? '<5' : x == null ? '' : String(x));
  const champ = (s) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const tete = en ? ['Facility', 'Region', 'Chrono visits', 'Door median (min)', 'Transfers', 'Transfers declined', 'Decision median (min)', 'ALC open', 'ALC median days', 'Free places']
    : ['Établissement', 'Région', 'Passages Chrono', 'Porte médiane (min)', 'Transferts', 'Transferts refusés', 'Décision médiane (min)', 'NSA ouverts', 'Jours NSA médians', 'Places libres'];
  const lignes = t.etablissements.map((l) => [l.nom, l.region || '', v(l.chrono_passages), v(l.chrono_porte_mediane_min), v(l.transferts), v(l.transferts_refuses), v(l.transferts_decision_mediane_min), v(l.nsa_actifs), v(l.nsa_jours_median), v(l.places_libres)].map(champ).join(';'));
  return `﻿${[tete.join(';'), ...lignes].join('\r\n')}\r\n`;
}

module.exports = { tableau, csv, masquer, SEUIL };
