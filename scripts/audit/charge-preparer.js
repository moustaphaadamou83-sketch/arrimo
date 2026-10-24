// Prépare la base de charge : réseau fictif de 20 hôpitaux et 50 comptes de coordination par hôpital (1 000 comptes).
const { creerPool } = require('../../src/db');
const { viderBase } = require('../../db/vider');
const { demoReseau } = require('../../db/demo-reseau');
const { hacher } = require('../../src/auth');
require('../../tests/routeur-fictif.cjs').activer();   // aucun appel OSRM externe
(async () => {
  const url = process.env.AUDIT_DATABASE_URL;
  if (!/\/arrimo_audit_[a-z0-9_]+(\?|$)/.test(url || '')) throw new Error('Base arrimo_audit_* requise');
  const pool = creerPool(url);
  await viderBase(pool); await demoReseau(pool, { silencieux: true });
  const hash = hacher('Charge-Arrimo-2026');
  const etabs = (await pool.query('SELECT id, code FROM etablissements WHERE actif ORDER BY id')).rows;
  for (const e of etabs) for (let i = 1; i <= 50; i++) {
    const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1,$2,$3,$4) RETURNING id', [`charge.${e.code.toLowerCase()}.${i}@audit.exemple`, `Charge ${e.code} ${i}`, hash, 'coordonnateur'])).rows[0];
    await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1,$2)', [u.id, e.id]);
  }
  console.log(JSON.stringify({ etablissements: etabs.length, comptes: etabs.length * 50 }));
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
