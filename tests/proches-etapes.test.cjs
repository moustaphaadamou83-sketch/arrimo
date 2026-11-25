'use strict';
/** Mise à jour « Famille » (26 nov. 2026) : étapes d'une évacuation et d'un transfert entre hébergements, sans chambre ni donnée clinique. */
const test = require('node:test');
const assert = require('node:assert');
const { creerPool } = require('../src/db');
const { viderBase } = require('../db/vider');
const { seed } = require('../db/seed');
const { situation } = require('../src/portail-proches');

test('portail : évacuation puis transfert entre hébergements, étapes et établissement d’accueil seulement', async () => {
  require('./routeur-fictif.cjs').activer();
  const pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  try {
    const mb = (await pool.query("SELECT latitude, longitude, config_id FROM etablissements WHERE code = 'MB'")).rows[0];
    const mk = async (code) => (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, module_actif, type_etablissement) VALUES ($1, $2, 'Ville', $3, $4, $5, true, 'chsld') RETURNING id`, [code, `Résidence ${code}`, mb.latitude, mb.longitude, mb.config_id])).rows[0].id;
    const a = await mk('PR-A'); const b = await mk('PR-B');
    const r = (await pool.query("INSERT INTO residents (etablissement_id, reference, prenom, nom, date_naissance, statut) VALUES ($1, 'R-97001', 'Prénom', 'Fictif', '1940-01-01', 'present') RETURNING id", [a])).rows[0].id;
    const p = { resident_id: r, autorisations: ['mouvements'] };
    assert.strictEqual(await situation(pool, { ...p, autorisations: ['administratif'] }), null, 'sans la catégorie « mouvements » : rien');
    const ev = (await pool.query("INSERT INTO evacuations (numero, etablissement_id, motif, declencheur_role) VALUES ('EV-PR1', $1, 'incendie', 'admin_etab') RETURNING id", [a])).rows[0].id;
    await pool.query("INSERT INTO evacuation_residents (evacuation_id, resident_id, resident_ref, destination_id, statut, confirme_le, depart_le) VALUES ($1, $2, 'R-97001', $3, 'parti', now() - interval '30 minutes', now() - interval '10 minutes')", [ev, r, b]);
    let s = await situation(pool, p);
    assert.strictEqual(s.statut, 'evacuation_en_route'); assert.strictEqual(s.hopital, 'Résidence PR-B');
    assert.deepStrictEqual(s.parcours.map((x) => [x.code, x.fait]), [['evacuation_declenchee', true], ['lieu_confirme', true], ['depart_confirme', true], ['arrivee_confirmee', false], ['accueil_confirme', false]]);
    assert.ok(!/lit|chambre/i.test(JSON.stringify(s)), 'ni lit ni chambre');
    await pool.query("UPDATE evacuations SET statut = 'levee', levee_le = now() WHERE id = $1", [ev]);
    await pool.query("INSERT INTO coordinations (numero, type, resident_id, resident_ref, origine_id, destination_id, statut) VALUES ('CO-PR1', 'transfert_chsld', $1, 'R-97001', $2, $3, 'envoyee')", [r, a, b]);
    s = await situation(pool, p);
    assert.strictEqual(s.statut, 'transfert_hebergement_prevu'); assert.strictEqual(s.parcours[0].fait, true); assert.strictEqual(s.parcours[1].fait, false);
  } finally { await pool.end(); }
});
