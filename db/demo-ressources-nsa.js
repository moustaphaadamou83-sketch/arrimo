/**
 * Démonstration et recette seulement : prépare le parcours NSA vers l'hébergement (lots A à D, 17 nov. 2026).
 * - Profils d'hébergement des milieux existants (capacités, langues, délai d'admission) et une place à venir aux Érables.
 * - Besoins en catégories de deux patients NSA fictifs de l'Hôpital B : Lucienne Tremblay (fauteuil, unité sécurisée ; famille à Val-des-Pins,
 *   1er choix : Érables) et Roger Lavoie (fauteuil ; famille à Mont-Clair). « Places » propose alors les Érables pour Lucienne,
 *   et explique pourquoi le CHSLD du Saint-Laurent est écarté (pas d'unité sécurisée déclarée).
 * Tout passe par les mêmes règles que l'interface (nsa-places.js, nsa-besoins.js), journalisé. Rejouable. Aucune donnée réelle, aucun diagnostic.
 * Les nouveaux établissements (RI, RTF, maison des aînés) se créent depuis SH, jamais par ce script.
 */
const { creerPool } = require('../src/db');
const { environnement } = require('../src/environnement');
const places = require('../src/nsa-places');
const besoins = require('../src/nsa-besoins');

const PROFILS = {
  'CHSLD-ERA': { capacites: ['fauteuil', 'marchette', 'leve_personne', 'unite_securisee'], langues: ['fr', 'en'], delai_admission_jours: 1 },
  'CHSLD-STL': { capacites: ['fauteuil', 'marchette', 'oxygene'], langues: ['fr'], delai_admission_jours: 2 },
};
const PAR_GENRE = {
  rpa: { capacites: ['marchette'], langues: ['fr'], delai_admission_jours: 3, circuit: 'direct', statut_ressource: 'prive' },
  ri: { capacites: ['marchette', 'fauteuil'], langues: ['fr'], delai_admission_jours: 2 },
  rtf: { capacites: ['marchette'], langues: ['fr'], delai_admission_jours: 2 },
  maison_aines: { capacites: ['marchette', 'fauteuil', 'leve_personne'], langues: ['fr', 'en'], delai_admission_jours: 2 },
};

async function utilisateurDe(pool, etabId, roles = ['coordonnateur', 'admin_etab', 'gestionnaire']) {
  const u = (await pool.query(`SELECT u.id, u.nom, u.role FROM utilisateurs u JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id
    WHERE ue.etablissement_id = $1 AND u.actif AND u.role = ANY($2) ORDER BY u.id LIMIT 1`, [etabId, roles])).rows[0];
  return u && { ...u, etabs: [etabId], gestionnaire: false, admin: u.role !== 'coordonnateur', langue: 'fr' };
}

async function preparer(pool, { silencieux = false } = {}) {
  if (!['demo', 'recette'].includes(environnement())) throw new Error('Démonstration et recette seulement (ARRIMO_ENV).');
  const log = (m) => { if (!silencieux) console.log(m); };
  const milieux = (await pool.query(`SELECT id, code, nom, type_local_code FROM etablissements WHERE type_etablissement = 'chsld' AND actif ORDER BY id`)).rows;
  for (const e of milieux) {
    const genre = ['rpa', 'ri', 'rtf', 'maison_aines'].includes(e.type_local_code) ? e.type_local_code : 'chsld';
    const voulu = PROFILS[e.code] || PAR_GENRE[genre];
    if (!voulu) continue;
    if ((await pool.query('SELECT 1 FROM ressource_profils WHERE etablissement_id = $1', [e.id])).rowCount) { log(`Profil déjà déclaré : ${e.nom}`); continue; }
    const u = await utilisateurDe(pool, e.id);
    if (!u) { log(`Aucun compte de coordination pour ${e.nom} : profil non déclaré`); continue; }
    await places.majProfil(pool, u, e.id, { ...voulu, version: 0 });
    log(`Profil d’hébergement déclaré : ${e.nom}`);
  }
  const era = milieux.find((e) => e.code === 'CHSLD-ERA');
  if (era && !(await pool.query(`SELECT 1 FROM places_a_venir WHERE etablissement_id = $1 AND statut = 'ouverte'`, [era.id])).rowCount) {
    const u = await utilisateurDe(pool, era.id);
    if (u) { await places.creerPlaceAVenir(pool, u, { etablissement_id: era.id, date_prevue: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), certitude: 'probable' }); log('Place à venir déclarée aux Érables (dans 5 jours)'); }
  }
  const hy = (await pool.query(`SELECT id FROM etablissements WHERE code = 'HY'`)).rows[0];
  const stl = milieux.find((e) => e.code === 'CHSLD-STL');
  if (hy) {
    const u = await utilisateurDe(pool, hy.id, ['coordonnateur', 'admin_etab', 'gestionnaire', 'equipe_soins']);
    const patients = [
      { prenom: 'Lucienne', nom: 'Tremblay', codes: ['fauteuil', 'unite_securisee'], municipalite: 'Val-des-Pins', preferences: era ? [era.id] : [] },
      { prenom: 'Roger', nom: 'Lavoie', codes: ['fauteuil'], municipalite: 'Mont-Clair', preferences: stl ? [stl.id] : [] },
    ];
    for (const p of patients) {
      const l = (await pool.query(`SELECT l.id, l.code FROM lits l JOIN patients pa ON pa.reference = l.patient_ref AND pa.etablissement_id = l.etablissement_id
        WHERE l.etablissement_id = $1 AND l.nsa_depuis IS NOT NULL AND pa.prenom = $2 AND pa.nom = $3 LIMIT 1`, [hy.id, p.prenom, p.nom])).rows[0];
      if (!l || !u) { log(`Patient NSA ${p.prenom} ${p.nom} introuvable : besoins non renseignés`); continue; }
      const actuel = await besoins.lire(pool, u, l.id);
      if (actuel.besoins.version > 0) { log(`Besoins déjà renseignés : lit ${l.code}`); continue; }
      await besoins.modifier(pool, u, l.id, { version: 0, codes: p.codes, municipalite_famille: p.municipalite, preferences: p.preferences, langue: 'fr' });
      log(`Besoins renseignés : lit ${l.code} (${p.prenom} ${p.nom}, données fictives)`);
    }
  }
}

if (require.main === module) {
  const pool = creerPool(process.env.DATABASE_URL);
  preparer(pool).then(() => pool.end()).catch((e) => { console.error(e.message); pool.end(); process.exit(1); });
}
module.exports = { preparer };
