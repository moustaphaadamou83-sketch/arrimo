/**
 * Démonstration seulement (21 nov. 2026) : Visites confirmées et « Avant l'appel » aux CHSLD des Érables et du Saint-Laurent.
 * Prestataire fictif « CLSC de démonstration » (profil Visites), quelques visites prévues pour des résidents des Érables, et une liste
 * « avant l'appel » d'EXEMPLE marquée comme telle (dans la réalité, elle vient du protocole de l'établissement). Rejouable.
 * Le compte de l'intervenant est créé par le script de préparation (empreinte d'un mot de passe de démonstration, jamais affichée).
 */
const { creerPool } = require('../src/db');
const { environnement } = require('../src/environnement');
async function preparer(pool) {
  if (environnement() !== 'demo') throw new Error('Démonstration seulement (ARRIMO_ENV=demo).');
  const era = (await pool.query("SELECT id, config_id, profil_config_id FROM etablissements WHERE code = 'CHSLD-ERA'")).rows[0];
  if (!era) { console.log('CHSLD des Érables absent'); return; }
  const org = (await pool.query(`INSERT INTO organisations_secours (code, nom, type, profils, config_id, region_id)
    VALUES ('DEMO-CLSC', 'CLSC de démonstration', 'prestataire', '{visites}', $1, (SELECT id FROM regions WHERE code = 'CA-QC-04'))
    ON CONFLICT (code) DO UPDATE SET profils = '{visites}' RETURNING id`, [era.profil_config_id || era.config_id])).rows[0].id;
  if ((await pool.query('SELECT 1 FROM visites WHERE prestataire_id = $1 LIMIT 1', [org])).rowCount) { console.log('Visites de démonstration déjà présentes'); return; }
  const res = (await pool.query("SELECT id, reference FROM residents WHERE etablissement_id = $1 AND statut = 'present' ORDER BY id LIMIT 3", [era.id])).rows;
  const types = ['aide_hygiene', 'soins_infirmiers', 'readaptation'];
  for (const [i, r] of res.entries()) {
    for (let j = 0; j < 5; j += 1) {
      // Heure de Montréal (9 h, 11 h, 13 h), quel que soit le fuseau du serveur
      const n = (await pool.query("SELECT nextval('visite_seq') AS n")).rows[0].n;
      await pool.query(`INSERT INTO visites (numero, etablissement_id, resident_id, resident_ref, prestataire_id, type_visite, debut_prevu, fin_prevue)
        SELECT $1, $2, $3, $4, $5, $6, d, d + interval '1 hour' FROM (SELECT ((now() AT TIME ZONE 'America/Toronto')::date + $7::int + make_time($8, 0, 0)) AT TIME ZONE 'America/Toronto' AS d) x`,
      [`VI-${String(n).padStart(6, '0')}`, era.id, r.id, r.reference, org, types[i], j, 9 + i * 2]);
    }
  }
  await pool.query(`INSERT INTO eviter_listes (etablissement_id, verifications, alternatives) VALUES ($1, $2, $3) ON CONFLICT (etablissement_id) DO NOTHING`, [era.id,
    JSON.stringify(['EXEMPLE DE DÉMONSTRATION — à remplacer par le protocole de l’établissement', 'Le médecin de garde a-t-il été joint ?', 'La famille est-elle informée ?']),
    JSON.stringify([{ code: 'medecin_garde', contact: 'Poste 1234 (fictif)' }, { code: 'info_sante', contact: '811' }, { code: 'telesoins', contact: 'Plateforme fictive' }])]);
  console.log(`Visites de démonstration : ${res.length * 5} visites prévues (CLSC de démonstration), liste « avant l’appel » d’exemple`);
}
if (require.main === module) { const pool = creerPool(process.env.DATABASE_URL); preparer(pool).then(() => pool.end()).catch((e) => { console.error(e.message); pool.end(); process.exit(1); }); }
module.exports = { preparer };
