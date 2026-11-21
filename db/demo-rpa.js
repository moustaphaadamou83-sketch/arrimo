'use strict';
/**
 * Démo seulement : la Résidence des Tilleuls (RPA fictive) reçoit un compte de coordination, un étage de 10 chambres et
 * 7 résidents fictifs, et les mêmes modules que le CHSLD des Érables (transport, mode crise, Avant l'appel, familles…).
 * Rejouable (rien n'est refait si le compte existe). Refusé hors démo. Le mot de passe est celui des autres comptes de démo (copie du hachage).
 */
const { creerPool } = require('../src/db');
if (process.env.ARRIMO_ENV !== 'demo') { console.error('Refusé : démonstration seulement.'); process.exit(1); }
const EMAIL = 'coordination.tilleuls@rpa.example.invalid';
const NOMS = [['Huguette', 'Lapointe'], ['Réal', 'Dufresne'], ['Monique', 'Caron'], ['Jacques', 'Bérard'], ['Denise', 'Lavallée'], ['Gilles', 'Arsenault'], ['Claudette', 'Poirier']];
(async () => {
  const pool = creerPool(process.env.DATABASE_URL); const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if ((await c.query('SELECT 1 FROM utilisateurs WHERE email = $1', [EMAIL])).rowCount) { console.log('Déjà en place'); await c.query('ROLLBACK'); return; }
    const e = (await c.query("SELECT id FROM etablissements WHERE code = 'RPA-TIL'")).rows[0];
    const modele = (await c.query(`SELECT e.modules, u.type_id AS ut, l.type_id AS lt, l.categorie FROM etablissements e JOIN lits l ON l.etablissement_id = e.id JOIN unites u ON u.id = l.unite_id WHERE e.code = 'CHSLD-ERA' LIMIT 1`)).rows[0];
    const ref = (await c.query("SELECT mot_de_passe_hash FROM utilisateurs WHERE email = 'coordination.erables@chsld.example.invalid'")).rows[0];
    await c.query('UPDATE etablissements SET modules = $2 WHERE id = $1', [e.id, modele.modules]);
    const u = (await c.query('INSERT INTO unites (etablissement_id, type_id, nom) VALUES ($1, $2, $3) RETURNING id', [e.id, modele.ut, 'Étage des Tilleuls'])).rows[0].id;
    const lits = [];
    for (let i = 1; i <= 10; i++) {
      const code = `TIL-${100 + i}`;
      const ch = (await c.query('INSERT INTO chambres (unite_id, numero) VALUES ($1, $2) RETURNING id', [u, code])).rows[0].id;
      lits.push((await c.query('INSERT INTO lits (chambre_id, unite_id, type_id, etablissement_id, code, categorie) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, code', [ch, u, modele.lt, e.id, code, modele.categorie])).rows[0]);
    }
    for (const [i, [p, n]] of NOMS.entries()) {
      const r = `R-T${String(i + 1).padStart(4, '0')}`;
      await c.query("UPDATE lits SET etat = 'occupe', patient_ref = $2, etat_depuis = now() WHERE id = $1", [lits[i].id, r]);
      await c.query("INSERT INTO residents (etablissement_id, reference, prenom, nom, date_naissance, statut, lit_id, admis_le) VALUES ($1, $2, $3, $4, $5, 'present', $6, now() - interval '200 days')",
        [e.id, r, p, n, `19${35 + i}-0${(i % 9) + 1}-1${i}`, lits[i].id]);
    }
    const id = (await c.query("INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, 'Coordination des Tilleuls', $2, 'admin_etab') RETURNING id", [EMAIL, ref.mot_de_passe_hash])).rows[0].id;
    await c.query('INSERT INTO utilisateur_etablissements (utilisateur_id, etablissement_id) VALUES ($1, $2)', [id, e.id]);
    await c.query("INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, NULL, 'Démo : RPA préparée', '10 chambres, 7 résidents fictifs, 1 compte')", [e.id]);
    await c.query('COMMIT'); console.log('RPA des Tilleuls prête : 10 chambres, 7 résidents fictifs, compte', EMAIL);
  } catch (err) { await c.query('ROLLBACK'); throw err; } finally { c.release(); await pool.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
