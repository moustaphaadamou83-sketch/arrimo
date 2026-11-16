/**
 * Démonstration seulement (ARRIMO_ENV=demo) : prépare le parcours principal de la rencontre du 19 nov. 2026.
 * - Hôpital B (HY) occupé de façon réaliste : environ 85 % des lits ouverts occupés, quelques lits libres gardés ;
 *   les lits fermés faute de personnel restent fermés.
 * - Trois patients NSA fictifs avec fiche d'identification fictive : deux orientés CHSLD, un en réadaptation.
 * - Jean Dupont (CHSLD des Érables) hospitalisé à l'Hôpital B, admis dans un lit, prêt pour « Préparer le retour au CHSLD ».
 * Tout passe par les mêmes règles que l'interface (regles.js, chsld.js, patients.js) et est journalisé.
 * Rejouable : ce qui est déjà en place n'est pas refait. Aucune donnée réelle, aucune donnée clinique.
 */
const { creerPool, transaction } = require('../src/db');
const { changerEtat } = require('../src/regles');
const { estDemo } = require('../src/environnement');

const NSA = [
  { prenom: 'Lucienne', nom: 'Tremblay', date_naissance: '1936-03-14', orientation: 'chsld', jours: 34 },
  { prenom: 'Roger', nom: 'Lavoie', date_naissance: '1941-09-02', orientation: 'chsld', jours: 12 },
  { prenom: 'Yvette', nom: 'Gagnon', date_naissance: '1939-12-20', orientation: 'readaptation', jours: 5 },
];

async function utilisateur(pool, email) {
  const u = (await pool.query(`SELECT u.id, u.nom, u.email, u.role, COALESCE(array_agg(ue.etablissement_id) FILTER (WHERE ue.etablissement_id IS NOT NULL), '{}') AS etabs
    FROM utilisateurs u LEFT JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id WHERE u.email = $1 AND u.actif GROUP BY u.id`, [email])).rows[0];
  if (!u) throw new Error(`Compte introuvable : ${email}`);
  return { ...u, gestionnaire: u.role === 'gestionnaire', admin: ['gestionnaire', 'admin_etab'].includes(u.role), langue: 'fr' };
}
const etab = async (pool, code) => (await pool.query('SELECT id FROM etablissements WHERE code = $1', [code])).rows[0]?.id;
const nouvelleRef = async (c) => (await c.query(`SELECT 'P-' || lpad(nextval('patient_seq')::text, 5, '0') AS r`)).rows[0].r;

/** Occupe un lit libre (réservé puis occupé), comme une admission. */
async function occuper(c, pool, uid, litId, ref, detail) {
  await changerEtat(c, pool, uid, litId, 'reserve', { patientRef: ref, detail });
  return changerEtat(c, pool, uid, litId, 'occupe', { detail });
}

async function preparerParcoursNsa(pool, { journal = console.log } = {}) {
  if (!estDemo()) throw new Error('Réservé à l’environnement de démonstration (ARRIMO_ENV=demo).');
  const patients = require('../src/patients');
  const ch = require('../src/chsld');
  const hy = await etab(pool, 'HY'); const era = await etab(pool, 'CHSLD-ERA');
  if (!hy || !era) throw new Error('Hôpital B (HY) ou CHSLD des Érables introuvable.');
  const b = await utilisateur(pool, 'hopital.b@demo.arrimo');
  const coordEra = await utilisateur(pool, 'coordination.erables@chsld.example.invalid');

  // 1. Patients NSA fictifs (fiche + lit occupé + statut NSA daté)
  for (const p of NSA) {
    const deja = (await pool.query(`SELECT p.reference, l.id AS lit FROM patients p LEFT JOIN lits l ON l.etablissement_id = p.etablissement_id AND l.patient_ref = p.reference AND l.etat = 'occupe'
      WHERE p.etablissement_id = $1 AND p.nom = $2 AND p.prenom = $3 AND p.date_naissance = $4 ORDER BY p.id DESC LIMIT 1`, [hy, p.nom, p.prenom, p.date_naissance])).rows[0];
    if (deja?.lit) { journal(`NSA déjà en place : ${deja.reference}`); continue; }
    await transaction(pool, async (c) => {
      const fiche = deja || await patients.creerPatient(c, b, hy, { ...p, confirmer_doublon: true }, { parcours: 'hospitalise', arrivee: new Date(Date.now() - (p.jours + 6) * 86400000) });
      const lit = (await c.query(`SELECT l.id FROM lits l JOIN unites u ON u.id = l.unite_id WHERE l.etablissement_id = $1 AND l.etat = 'libre' AND l.actif
        AND u.nom !~* 'intensi|urgence|pédiat|pediat|obst|natal' ORDER BY l.id LIMIT 1`, [hy])).rows[0];
      if (!lit) throw new Error('Aucun lit libre à l’Hôpital B pour un patient NSA.');
      await occuper(c, pool, b.id, lit.id, fiche.reference, 'Admission (démonstration)');
      await c.query(`UPDATE patients SET parcours = 'hospitalise' WHERE etablissement_id = $1 AND reference = $2`, [hy, fiche.reference]);
      await c.query(`UPDATE lits SET nsa_depuis = now() - make_interval(days => $2), nsa_orientation = $3 WHERE id = $1`, [lit.id, p.jours, p.orientation]);
      journal(`NSA prêt : ${fiche.reference} (${p.orientation}, ${p.jours} j)`);
    });
  }

  // 2. Jean Dupont hospitalisé à l'Hôpital B et admis dans un lit (avant le remplissage, pour garder un lit adapté)
  const jean = (await pool.query(`SELECT id, statut, version FROM residents WHERE etablissement_id = $1 AND reference = 'R-00001'`, [era])).rows[0];
  if (jean && jean.statut === 'present') {
    let co = await ch.preparerHospitalisation(pool, coordEra, jean.id, { hopital_id: hy, identite_verifiee: true, motif_admin: 'Évaluation à l’hôpital', version: jean.version,
      infos_operationnelles: { transport: 'ambulance' } });
    co = await ch.actionCoordination(pool, b, co.id, { etablissement_id: hy, action: 'accuser_reception', version: co.version });
    co = await ch.actionCoordination(pool, b, co.id, { etablissement_id: hy, action: 'accepter', version: co.version });
    co = await ch.actionCoordination(pool, coordEra, co.id, { etablissement_id: era, action: 'confirmer_depart', version: co.version });
    co = await ch.actionCoordination(pool, b, co.id, { etablissement_id: hy, action: 'confirmer_reception', version: co.version });
    const lit = (await pool.query(`SELECT l.id, l.version, l.type_id FROM lits l JOIN unites u ON u.id = l.unite_id WHERE l.etablissement_id = $1 AND l.etat = 'libre' AND l.actif
      AND u.nom !~* 'intensi|urgence|pédiat|pediat|obst|natal' ORDER BY l.id LIMIT 1`, [hy])).rows[0];
    const ref = await nouvelleRef(pool);
    co = await ch.actionCoordination(pool, b, co.id, { etablissement_id: hy, action: 'orienter', orientation: 'admission', patient_ref: ref, type_id: lit.type_id, lit_id: lit.id, version_lit: lit.version, version: co.version });
    journal(`Jean Dupont hospitalisé à l’Hôpital B (${co.numero}, ${ref}) : prêt pour le retour`);
  } else journal(`Jean Dupont : statut ${jean?.statut || 'introuvable'}, rien à faire`);

  // 3. Remplissage réaliste : environ 85 % des lits ouverts occupés ; au moins 2 lits libres gardés par unité qui en a
  const libres = (await pool.query(`SELECT l.id, l.unite_id FROM lits l WHERE l.etablissement_id = $1 AND l.etat = 'libre' AND l.actif ORDER BY l.unite_id, l.id`, [hy])).rows;
  const ouverts = (await pool.query(`SELECT count(*)::int n FROM lits WHERE etablissement_id = $1 AND actif AND etat <> 'indispo'`, [hy])).rows[0].n;
  const occupes = (await pool.query(`SELECT count(*)::int n FROM lits WHERE etablissement_id = $1 AND etat IN ('occupe', 'reserve')`, [hy])).rows[0].n;
  let aOccuper = Math.max(0, Math.round(ouverts * 0.85) - occupes);
  const parUnite = new Map(); for (const l of libres) parUnite.set(l.unite_id, [...(parUnite.get(l.unite_id) || []), l.id]);
  let n = 0;
  for (const ids of parUnite.values()) {
    for (const id of ids.slice(Math.min(2, ids.length))) {
      if (aOccuper <= 0) break;
      await transaction(pool, async (c) => occuper(c, pool, null, id, await nouvelleRef(c), 'Admission (démonstration)'));
      aOccuper -= 1; n += 1;
    }
  }
  journal(`Hôpital B : ${n} lit(s) occupé(s) en plus ; ${ouverts} lits ouverts`);
}

if (require.main === module) {
  const pool = creerPool(process.env.DATABASE_URL);
  preparerParcoursNsa(pool).then(() => pool.end()).catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });
}
module.exports = { preparerParcoursNsa };
