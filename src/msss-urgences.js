'use strict';
/**
 * Lecteur du fichier horaire des urgences du MSSS (cahier v2, C.2 C ; 21 nov. 2026) : « Fichier horaire des données de la situation à
 * l'urgence », Données Québec, licence CC-BY 4.0 (source citée partout où les chiffres s'affichent). Lu une fois par heure, sans compte.
 * Seulement l'OCCUPATION (civières fonctionnelles et occupées, patients de plus de 24 h et 48 h) : jamais un état « fermé » déduit.
 * Les urgences déjà branchées sur Arrimo (table de correspondance) ne sont pas doublées. Désactivé par défaut : ARRIMO_MSSS_URGENCES=1.
 * Colonnes (liste officielle des variables) : Nom_etablissement, Nom_installation, No_permis_installation, Nombre_de_civieres_fonctionnelles,
 * Nombre_de_civieres_occupees, Nombre_de_patients_sur_civiere_plus_de_24_heures, …_48_heures, heure d'extraction, Mise_a_jour (+ RSS, Region).
 */
const URL_DEFAUT = 'https://www.msss.gouv.qc.ca/professionnels/statistiques/documents/urgences/Releve_horaire_urgences_7jours.csv';
const ATTRIBUTION = 'Source : ministère de la Santé et des Services sociaux, Données Québec, licence CC-BY 4.0';
let fetchImpl = (...a) => fetch(...a);
const definirFetchTest = (f) => { fetchImpl = f || ((...a) => fetch(...a)); };
const actif = () => process.env.ARRIMO_MSSS_URGENCES === '1';
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Décode (UTF-8, sinon latin-1), détecte le séparateur, lit les colonnes par leur nom normalisé ; ignore les lignes de total. */
function analyser(buffer) {
  let texte = Buffer.from(buffer).toString('utf8');
  if (texte.includes('�')) texte = Buffer.from(buffer).toString('latin1');
  texte = texte.replace(/^﻿/, '');
  const lignes = texte.split(/\r?\n/).filter((l) => l.trim());
  if (lignes.length < 2) return [];
  const sep = (lignes[0].match(/;/g) || []).length > (lignes[0].match(/,/g) || []).length ? ';' : ',';
  const decouper = (l) => { const r = []; let cur = ''; let q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { r.push(cur); cur = ''; } else cur += ch; } r.push(cur); return r.map((x) => x.trim()); };
  const tete = decouper(lignes[0]).map(norm);
  const col = (...motifs) => tete.findIndex((h) => motifs.every((m) => h.includes(m)));
  const idx = { etab: col('nom_etablissement'), inst: col('nom_installation'), permis: col('permis'), region: col('region'), fonct: col('civieres_fonctionnelles'),
    occ: col('civieres_occupees'), h24: col('24'), h48: col('48'), extraction: tete.findIndex((h) => h.includes('extraction') || h.startsWith('heure')), maj: col('mise_a_jour') };
  if (idx.inst < 0 || idx.occ < 0 || idx.fonct < 0) throw new Error('format_inconnu');
  const nombre = (v) => { const n = Number(String(v || '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n) : null; };
  return lignes.slice(1).map(decouper).map((c) => ({
    no_permis: idx.permis >= 0 ? c[idx.permis] : null, etablissement: idx.etab >= 0 ? c[idx.etab] : null, installation: c[idx.inst], region: idx.region >= 0 ? c[idx.region] : null,
    civieres_fonctionnelles: nombre(c[idx.fonct]), civieres_occupees: nombre(c[idx.occ]), plus_24h: idx.h24 >= 0 ? nombre(c[idx.h24]) : null, plus_48h: idx.h48 >= 0 ? nombre(c[idx.h48]) : null,
    extraction: idx.extraction >= 0 ? c[idx.extraction] : null, mise_a_jour: idx.maj >= 0 ? c[idx.maj] : null,
  })).filter((r) => r.no_permis && r.installation && !/total|ensemble du qu/i.test(r.installation));
}

/** Lecture planifiée : remplace l'image précédente (dernière lecture seulement) ; chaque essai est journalisé (lectures_msss). */
async function lire(pool) {
  if (!actif()) return { statut: 'desactive' };
  try {
    const r = await fetchImpl(process.env.ARRIMO_MSSS_URGENCES_URL || URL_DEFAUT, { headers: { 'User-Agent': 'Arrimo (lecture horaire des données ouvertes)' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const lignes = analyser(Buffer.from(await r.arrayBuffer()));
    if (!lignes.length) throw new Error('fichier_vide');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM urgences_publiques_msss');
      for (const l of lignes) {
        await c.query(`INSERT INTO urgences_publiques_msss (no_permis, etablissement, installation, region, civieres_fonctionnelles, civieres_occupees, plus_24h, plus_48h, extraction, mise_a_jour)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (no_permis) DO NOTHING`,
        [l.no_permis, l.etablissement, l.installation, l.region, l.civieres_fonctionnelles, l.civieres_occupees, l.plus_24h, l.plus_48h, l.extraction, l.mise_a_jour]);
      }
      await c.query("INSERT INTO lectures_msss (statut, lignes) VALUES ('ok', $1)", [lignes.length]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    return { statut: 'ok', lignes: lignes.length };
  } catch (e) {
    await pool.query("INSERT INTO lectures_msss (statut, detail) VALUES ('echec', $1)", [String(e.message).slice(0, 200)]);
    return { statut: 'echec', detail: e.message };
  }
}
/** Urgences du fichier MSSS qui ne sont pas déjà branchées sur Arrimo : occupation seulement, avec la source et l'heure. */
async function autresUrgences(db) {
  const rows = (await db.query(`SELECT u.installation, u.etablissement, u.region, u.civieres_fonctionnelles, u.civieres_occupees, u.plus_24h, u.plus_48h, u.extraction, u.mise_a_jour
    FROM urgences_publiques_msss u WHERE NOT EXISTS (SELECT 1 FROM correspondances_urgences_publiques c WHERE c.no_permis = u.no_permis) ORDER BY u.region, u.installation`)).rows;
  return rows.map((r) => ({ ...r, taux_occupation: r.civieres_fonctionnelles ? Math.round((100 * r.civieres_occupees) / r.civieres_fonctionnelles) : null }));
}
module.exports = { analyser, lire, autresUrgences, actif, definirFetchTest, ATTRIBUTION, URL_DEFAUT };
