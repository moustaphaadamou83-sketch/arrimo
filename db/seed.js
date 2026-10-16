/**
 * Données de démonstration (fictives) : configuration Québec, 6 établissements, lits, comptes.
 * Usage : node db/seed.js        (la base doit être vide ou réinitialisée avec npm run db:reset)
 */
const fs = require('fs');
const path = require('path');
const { creerPool, transaction } = require('../src/db');
const { hacher } = require('../src/auth');
const { creerTransfert, avancerTransfert, detecterBlocages } = require('../src/services');

const MOT_DE_PASSE_DEMO = process.env.DEMO_MOT_DE_PASSE || 'Demo-Arrimo-2026';

const NOMS_EN = { SI: 'Intensive care', MED: 'Medicine', CHIR: 'Surgery', MAT: 'Maternity' };

async function seed(pool, { silencieux = false } = {}) {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const deja = await pool.query('SELECT count(*)::int AS n FROM etablissements');
  if (deja.rows[0].n) { if (!silencieux) console.log('Base déjà remplie, rien à faire.'); return; }

  let rng = 20261015;
  const rnd = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };

  await transaction(pool, async (c) => {
    const cfg = (await c.query(`INSERT INTO config_pays (code, nom) VALUES ('QC', 'Québec (Canada)') RETURNING id`)).rows[0].id;
    const types = {};
    for (const [code, nom, ordre] of [['SI', 'Soins intensifs', 1], ['MED', 'Médecine', 2], ['CHIR', 'Chirurgie', 3], ['MAT', 'Maternité', 4]]) {
      types[code] = (await c.query('INSERT INTO types_unite (config_id, code, nom, ordre, nom_en) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [cfg, code, nom, ordre, NOMS_EN[code]])).rows[0].id;
    }
    const etabs = [
      ['MB', 'Hôpital Mont-Bellevue', 'Sherbrooke', 45.40, -71.89, 'complet', true, ['SI', 'MED', 'CHIR', 'MAT'], 'tremblay', 'A. Tremblay'],
      ['LM', 'Centre hospitalier du Lac-Magog', 'Magog', 45.27, -72.15, 'complet', true, ['MED', 'CHIR', 'MAT'], 'gagnon', 'M. Gagnon'],
      ['RC', 'Hôpital régional des Cantons', 'Granby', 45.40, -72.73, 'complet', true, ['SI', 'MED', 'CHIR'], 'roy', 'S. Roy'],
      ['MI', 'Hôpital des Mille-Îles', 'Laval', 45.57, -73.72, 'agrege', true, ['SI', 'MED', 'CHIR', 'MAT'], 'cote', 'K. Côté'],
      ['SL', 'CHU Saint-Laurent', 'Montréal', 45.50, -73.57, 'complet', true, ['SI', 'MED', 'CHIR', 'MAT'], 'bouchard', 'J. Bouchard'],
      ['MS', 'Centre hospitalier des Monts-Sutton', 'Sutton', 45.10, -72.61, 'aucun', false, ['MED'], 'pelletier', 'L. Pelletier'],
    ];
    const plan = { SI: [6, 1, 1], MED: [6, 2, 2], CHIR: [5, 2, 3], MAT: [4, 2, 4] };
    const hash = hacher(MOT_DE_PASSE_DEMO);
    for (const [code, nom, ville, lat, lon, partage, actif, unites, login, coord] of etabs) {
      const e = (await c.query(
        `INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, partage, module_actif)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [code, nom, ville, lat, lon, cfg, partage, actif])).rows[0].id;
      const u = (await c.query(`INSERT INTO utilisateurs (email, nom, mot_de_passe_hash) VALUES ($1,$2,$3) RETURNING id`,
        [`${login}@demo.arrimo`, coord, hash])).rows[0].id;
      await c.query('INSERT INTO utilisateur_etablissements VALUES ($1,$2)', [u, e]);
      const poids = code === 'MB' ? [0.03, 0.06, 0.77, 0.08, 0.06] : [0.14, 0.06, 0.64, 0.09, 0.07];
      for (const t of unites) {
        const [nbCh, nbLits, etage] = plan[t];
        const unite = (await c.query('INSERT INTO unites (etablissement_id, type_id, nom) VALUES ($1,$2,$3) RETURNING id',
          [e, types[t], { SI: 'Soins intensifs', MED: 'Médecine', CHIR: 'Chirurgie', MAT: 'Maternité' }[t]])).rows[0].id;
        for (let ch = 1; ch <= nbCh; ch += 1) {
          const num = `${etage}${String(ch).padStart(2, '0')}`;
          const chambre = (await c.query('INSERT INTO chambres (unite_id, numero) VALUES ($1,$2) RETURNING id', [unite, num])).rows[0].id;
          for (let k = 0; k < nbLits; k += 1) {
            let x = rnd(); let i = 0;
            for (; i < poids.length - 1; i += 1) { x -= poids[i]; if (x < 0) break; }
            const etat = ['libre', 'reserve', 'occupe', 'nettoyage', 'indispo'][i];
            const depuis = etat === 'reserve' || etat === 'nettoyage' ? 5 + rnd() * 50 : etat === 'indispo' ? 30 + rnd() * 500 : 20 + rnd() * 900;
            const sortie = etat === 'occupe' ? (-60 + rnd() * 4380) : null;
            const l = await c.query(
              `INSERT INTO lits (chambre_id, unite_id, type_id, etablissement_id, code, etat, patient_ref, etat_depuis, sortie_prevue)
               VALUES ($1,$2,$3,$4,$5,$6,$7, now() - make_interval(mins => $8::int), CASE WHEN $9::float IS NULL THEN NULL ELSE now() + make_interval(mins => round($9::float)::int) END)
               RETURNING id`,
              [chambre, unite, types[t], e, `${t}-${num}${nbLits > 1 ? 'AB'[k] : ''}`, etat,
                ['reserve', 'occupe'].includes(etat) ? `P-${String(10000 + Math.floor(rnd() * 89999))}` : null,
                Math.round(depuis), sortie]);
            await c.query(`INSERT INTO journal (lit_id, etablissement_id, action, nouvel_etat, detail)
                           VALUES ($1, $2, 'Création', $3, 'Données de démonstration')`, [l.rows[0].id, e, etat]);
          }
        }
      }
    }
    // Scénario : soins intensifs saturés à Mont-Bellevue, places ailleurs, quelques blocages à repérer
    await c.query(`UPDATE lits SET etat = 'occupe', patient_ref = 'P-' || (20000 + id)::text, sortie_prevue = now() + interval '30 hours'
                    WHERE etablissement_id = (SELECT id FROM etablissements WHERE code = 'MB') AND type_id = $1 AND etat = 'libre'`, [types.SI]);
    await c.query(`UPDATE lits SET sortie_prevue = now() + interval '100 minutes'
                    WHERE id = (SELECT min(id) FROM lits WHERE etablissement_id = (SELECT id FROM etablissements WHERE code = 'MB')
                                AND type_id = $1 AND etat = 'occupe')`, [types.SI]);
    for (const [code, t, n] of [['RC', 'SI', 1], ['SL', 'SI', 2], ['MI', 'SI', 1], ['LM', 'MED', 2], ['MB', 'CHIR', 1], ['SL', 'MAT', 2], ['SL', 'MED', 2], ['LM', 'CHIR', 2]]) {
      await c.query(`UPDATE lits SET etat = 'libre', patient_ref = NULL, sortie_prevue = NULL
                      WHERE id IN (SELECT id FROM lits WHERE etablissement_id = (SELECT id FROM etablissements WHERE code = $1)
                                   AND type_id = $2 AND etat <> 'libre' ORDER BY code LIMIT $3)`, [code, types[t], n]);
    }
    const mb = `(SELECT id FROM etablissements WHERE code = 'MB')`;
    await c.query(`UPDATE lits SET etat_depuis = now() - interval '150 minutes' WHERE id = (SELECT min(id) FROM lits WHERE etablissement_id = ${mb} AND etat = 'nettoyage')`);
    await c.query(`UPDATE lits SET etat_depuis = now() - interval '205 minutes' WHERE id = (SELECT min(id) FROM lits WHERE etablissement_id = ${mb} AND etat = 'reserve')`);
    await c.query(`UPDATE lits SET sortie_prevue = now() - interval '5 hours' WHERE id = (SELECT max(id) FROM lits WHERE etablissement_id = ${mb} AND etat = 'occupe' AND type_id <> $1)`, [types.SI]);
    await c.query(`UPDATE lits SET etat_depuis = now() - interval '31 hours' WHERE id = (SELECT min(id) FROM lits WHERE etablissement_id = ${mb} AND etat = 'indispo')`);

    const admin = (await c.query(`INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role)
                                  VALUES ('reseau@demo.arrimo', 'Gestionnaire réseau', $1, 'gestionnaire') RETURNING id`, [hash])).rows[0].id;
    void admin;
  });

  // Version 2 : caractéristiques, motifs, NSA, congés, équipes d'entretien, file d'admission
  await pool.query(`UPDATE lits l SET ventilation = true, telemetrie = true FROM types_unite t WHERE t.id = l.type_id AND t.code = 'SI'`);
  await pool.query(`UPDATE lits SET isolement = true WHERE code ~ '(01|02)A?$'`);
  await pool.query(`UPDATE lits SET pression_negative = true WHERE code ~ '01A?$'`);
  await pool.query(`UPDATE lits SET telemetrie = true WHERE code LIKE 'MED-2%' AND code ~ '0[1-3]'`);
  await pool.query(`UPDATE lits SET motif_indispo = (ARRAY['personnel','personnel','personnel','equipement','travaux','infection'])[1 + (id % 6)]
                     WHERE etat = 'indispo'`);
  // NSA : environ 13 % des lits occupés, avec des durées réalistes
  await pool.query(`UPDATE lits SET nsa_depuis = now() - make_interval(days => 3 + (id * 7) % 70),
                     nsa_orientation = (ARRAY['chsld','chsld','chsld','ri','readaptation','domicile','palliatif'])[1 + (id % 7)]
                     WHERE etat = 'occupe' AND type_id <> (SELECT id FROM types_unite WHERE code = 'SI') AND id % 8 = 0`);
  await pool.query(`UPDATE lits SET sortie_prevue = NULL WHERE nsa_depuis IS NOT NULL`);
  await pool.query(`UPDATE lits SET conge_statut = CASE WHEN id % 3 = 0 THEN 'confirme' ELSE 'prevu' END
                     WHERE etat = 'occupe' AND sortie_prevue IS NOT NULL AND sortie_prevue < now() + interval '30 hours'`);
  // Congés prévus aujourd'hui, non confirmés, à Mont-Bellevue
  await pool.query(`UPDATE lits SET sortie_prevue = date_trunc('day', now()) + interval '15 hours' + make_interval(mins => (id % 4) * 30),
                     conge_statut = 'prevu'
                     WHERE id IN (SELECT id FROM lits WHERE etablissement_id = (SELECT id FROM etablissements WHERE code = 'MB')
                                  AND etat = 'occupe' AND nsa_depuis IS NULL AND blocage_motif IS NULL
                                  AND type_id <> (SELECT id FROM types_unite WHERE code = 'SI') ORDER BY id LIMIT 3)`);
  for (const [code, nom] of [['MB', 'Équipe entretien Mont-Bellevue'], ['SL', 'Équipe entretien Saint-Laurent']]) {
    const u = (await pool.query(`INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, 'entretien') RETURNING id`,
      [`entretien.${code.toLowerCase()}@demo.arrimo`, nom, hacher(MOT_DE_PASSE_DEMO)])).rows[0].id;
    await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, (SELECT id FROM etablissements WHERE code = $2))', [u, code]);
  }

  // Quelques transferts réels, créés par les mêmes règles que l'application
  const user = async (login) => {
    const r = await pool.query(`SELECT u.id, u.role, array_agg(ue.etablissement_id) AS etabs FROM utilisateurs u
                                 JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id WHERE email = $1 GROUP BY u.id`,
    [`${login}@demo.arrimo`]);
    return { ...r.rows[0], gestionnaire: false };
  };
  const id = async (code) => (await pool.query('SELECT id FROM etablissements WHERE code = $1', [code])).rows[0].id;
  const type = async (code) => (await pool.query('SELECT id FROM types_unite WHERE code = $1', [code])).rows[0].id;
  const [roy, tremblay, bouchard, cote] = await Promise.all(['roy', 'tremblay', 'bouchard', 'cote'].map(user));
  const t1 = await creerTransfert(pool, roy, { origine_id: await id('RC'), destination_id: await id('MB'), type_id: await type('CHIR'), patient_ref: 'P-41522', urgent: false });
  void t1;
  const t2 = await creerTransfert(pool, tremblay, { origine_id: await id('MB'), destination_id: await id('SL'), type_id: await type('MAT'), patient_ref: 'P-77310', urgent: true });
  await avancerTransfert(pool, bouchard, t2.id, 'accepter');
  await avancerTransfert(pool, tremblay, t2.id, 'transport');
  const t3 = await creerTransfert(pool, cote, { origine_id: await id('MI'), destination_id: await id('SL'), type_id: await type('MED'), patient_ref: 'P-30981', urgent: false });
  await avancerTransfert(pool, bouchard, t3.id, 'accepter');
  await avancerTransfert(pool, cote, t3.id, 'transport');
  await avancerTransfert(pool, cote, t3.id, 'depart');
  // File d'admission à l'urgence de Mont-Bellevue (patients sur civière qui attendent un lit)
  const { creerDemande } = require('../src/terrain');
  const demandes = [
    ['SI', 'p1', 410, { ventilation: true }], ['MED', 'p2', 290, {}], ['MED', 'p2', 95, { isolement: true }],
    ['CHIR', 'p3', 40, {}], ['MAT', 'p2', 25, {}],
  ];
  let n = 0;
  for (const [tc, prio, ilya, besoins] of demandes) {
    n += 1;
    const d = await creerDemande(pool, tremblay, { etablissement_id: await id('MB'), type_id: await type(tc), priorite: prio,
      provenance: 'urgence', patient_ref: `P-6${String(1000 + n * 37).padStart(4, '0')}`, besoins });
    await pool.query(`UPDATE demandes_admission SET cree_le = now() - make_interval(mins => $2) WHERE id = $1`, [d.id, ilya]);
  }

  await detecterBlocages(pool);
  const { creerConnecteur } = require('../src/connecteurs');
  const con = await creerConnecteur(pool, 'Interface ADT Mont-Bellevue (démo)', await id('MB'));
  const reseau = await creerConnecteur(pool, 'Coordination régionale (démo, lecture)', null);
  if (!silencieux) {
    console.log('Clé du connecteur ADT de démonstration (Mont-Bellevue) :', con.cle);
    console.log('Clé du connecteur réseau de démonstration (lecture) :', reseau.cle);
    console.log('Démo prête. Comptes (mot de passe :', MOT_DE_PASSE_DEMO + ') :');
    console.log('  tremblay@demo.arrimo (Mont-Bellevue), bouchard@demo.arrimo (CHU Saint-Laurent),');
    console.log('  roy@, gagnon@, cote@demo.arrimo, reseau@demo.arrimo (gestionnaire réseau),');
    console.log('  entretien.mb@demo.arrimo et entretien.sl@demo.arrimo (écran Nettoyage)');
  }
}

if (require.main === module) {
  const pool = creerPool(process.env.DATABASE_URL);
  seed(pool).then(() => pool.end()).catch((e) => { console.error(e); pool.end(); process.exit(1); });
}
module.exports = { seed, MOT_DE_PASSE_DEMO };
