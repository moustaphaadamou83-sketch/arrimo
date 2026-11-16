/**
 * Recherche unique, depuis tous les modules (décision de Moustafa, 16 nov. 2026) : par référence, prénom ou nom.
 * - Seulement dans l'établissement choisi : le nom ne quitte jamais l'établissement qui l'a saisi.
 * - Noms et prénoms : fiches fictives seulement (démo, recette) ; ailleurs, la recherche se fait par référence.
 * - Le journal garde le fait qu'une recherche a eu lieu, jamais le texte cherché.
 * Résultat : où se trouve la personne (lit, civière, chambre, liaison en cours), pour ouvrir le bon onglet.
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const { environnement } = require('./environnement');
const { journaliser } = require('./regles');

const fictifs = () => ['demo', 'recette'].includes(environnement()) || process.env.ARRIMO_PATIENTS_FICTIFS === '1';
// Comparaison sans accents ni majuscules
const SANS = (x) => `translate(lower(${x}), 'àâäáãçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaceeeeiiiinooooouuuuyy')`;
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

async function rechercher(pool, u, etabId, requete) {
  exigerEtablissement(u, etabId);
  // L'entretien ne voit jamais de patient ni de résident
  if (u.role === 'entretien') throw new ErreurHttp(403, 'role_insuffisant');
  const q = String(requete || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (q.length < 2) throw new ErreurHttp(400, 'recherche_trop_courte');
  const e = (await pool.query('SELECT id, type_etablissement FROM etablissements WHERE id = $1', [etabId])).rows[0];
  if (!e) throw new ErreurHttp(404, 'etab_introuvable');
  const ref = `${q.toUpperCase()}%`;
  const mots = norm(q).split(' ').filter(Boolean).slice(0, 3);
  const avecNoms = fictifs() && mots.length > 0;
  // Chaque mot doit se trouver dans le prénom ou le nom
  const condNoms = (p) => mots.map((_, i) => `(${SANS(`${p}.prenom`)} LIKE $${i + 3} OR ${SANS(`${p}.nom`)} LIKE $${i + 3})`).join(' AND ');
  const argsNoms = mots.map((m) => `%${m}%`);
  const resultats = [];

  if (e.type_etablissement === 'hopital') {
    // Fiches (démo, recette) et emplacements connus par la référence
    const fiches = avecNoms ? (await pool.query(`SELECT p.reference, p.prenom, p.nom, p.date_naissance FROM patients p WHERE p.etablissement_id = $1
        AND (upper(p.reference) LIKE $2 OR (${condNoms('p')})) ORDER BY p.modifie_le DESC NULLS LAST, p.id DESC LIMIT 20`, [etabId, ref, ...argsNoms])).rows : [];
    const refs = [...new Set([...fiches.map((f) => f.reference)])];
    const lits = (await pool.query(`SELECT l.code, l.patient_ref, l.etat, l.nsa_depuis IS NOT NULL AS nsa, un.nom AS unite FROM lits l JOIN unites un ON un.id = l.unite_id
      WHERE l.etablissement_id = $1 AND l.etat IN ('reserve', 'occupe') AND (upper(l.patient_ref) LIKE $2 OR l.patient_ref = ANY($3)) ORDER BY l.code LIMIT 20`, [etabId, ref, refs])).rows;
    const civieres = (await pool.query(`SELECT code, patient_ref FROM civieres WHERE etablissement_id = $1 AND etat = 'occupee' AND (upper(patient_ref) LIKE $2 OR patient_ref = ANY($3)) LIMIT 20`,
      [etabId, ref, refs])).rows;
    const liaisons = (await pool.query(`SELECT numero, type, statut, resident_ref, patient_ref_hopital FROM coordinations WHERE (origine_id = $1 OR destination_id = $1) AND cloturee_le IS NULL
      AND (upper(resident_ref) LIKE $2 OR upper(coalesce(patient_ref_hopital, '')) LIKE $2 OR patient_ref_hopital = ANY($3)) ORDER BY id DESC LIMIT 10`, [etabId, ref, refs])).rows;
    const fiche = new Map(fiches.map((f) => [f.reference, f]));
    const vus = new Set();
    for (const l of lits) { vus.add(l.patient_ref); resultats.push({ type: 'lit', reference: l.patient_ref, ...identite(fiche.get(l.patient_ref)), lieu: `${l.unite} · ${l.code}`, etat: l.etat, nsa: l.nsa, onglet: l.nsa ? 'nsa' : 'lits' }); }
    for (const c of civieres) { vus.add(c.patient_ref); resultats.push({ type: 'civiere', reference: c.patient_ref, ...identite(fiche.get(c.patient_ref)), lieu: c.code, onglet: 'urgence' }); }
    for (const co of liaisons) resultats.push({ type: 'liaison', reference: co.patient_ref_hopital || co.resident_ref, numero: co.numero, statut: co.statut, onglet: 'liaison' });
    for (const f of fiches) if (!vus.has(f.reference)) resultats.push({ type: 'patient', reference: f.reference, ...identite(f), onglet: 'patients' });
  } else {
    // Établissement d'hébergement : résidents et demandes d'hébergement (fiches fictives seulement)
    const residents = (await pool.query(`SELECT r.reference, r.prenom, r.nom, r.date_naissance, r.statut, l.code AS chambre FROM residents r LEFT JOIN lits l ON l.id = r.lit_id
      WHERE r.etablissement_id = $1 AND r.statut <> 'sorti' AND (upper(r.reference) LIKE $2 ${avecNoms ? `OR (${condNoms('r')})` : ''}) ORDER BY r.nom, r.prenom LIMIT 20`,
    [etabId, ref, ...(avecNoms ? argsNoms : [])])).rows;
    for (const r of residents) resultats.push({ type: 'resident', reference: r.reference, ...(fictifs() ? identite(r) : {}), lieu: r.chambre, statut: r.statut, onglet: 'c-residents' });
    if (avecNoms) {
      const dh = (await pool.query(`SELECT d.numero, d.prenom, d.nom, d.date_naissance, d.statut FROM demandes_hebergement d WHERE d.etablissement_id = $1
        AND d.statut NOT IN ('admise', 'refusee', 'annulee') AND (upper(d.numero) LIKE $2 OR (${condNoms('d')})) LIMIT 10`, [etabId, ref, ...argsNoms])).rows;
      for (const d of dh) resultats.push({ type: 'demande', reference: d.numero, ...identite(d), statut: d.statut, onglet: 'c-demandes' });
    }
  }
  await journaliser(pool, { etablissementId: etabId, utilisateurId: u.id, action: 'Recherche', detail: `${resultats.length} résultat(s)` });
  return { resultats, noms: fictifs() };
}
function identite(f) {
  if (!f) return {};
  return { prenom: f.prenom, nom: f.nom, date_naissance: f.date_naissance ? String(f.date_naissance.toISOString?.() || f.date_naissance).slice(0, 10) : null };
}

module.exports = { rechercher };
