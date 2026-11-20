/**
 * COR-001 (audit du 20 nov. 2026) : départs NSA déjà programmés AVANT le correctif (ex. Ramzy Haji, Hôpital A → CHSLD des Érables) :
 * prépare la demande de transport partagée « à valider », exactement comme le fait désormais la confirmation de place. Rejouable, sans doublon.
 * Démonstration et recette seulement : aucune demande n'est transmise ; une personne de l'hôpital la vérifie et la transmet.
 */
const { creerPool, transaction } = require('../src/db');
const { environnement } = require('../src/environnement');
(async () => {
  if (!['demo', 'recette'].includes(environnement())) { console.error('Démonstration et recette seulement (ARRIMO_ENV).'); process.exit(1); }
  const pool = creerPool(process.env.DATABASE_URL);
  const ds = (await pool.query(`SELECT * FROM demandes_hebergement WHERE statut = 'acceptee' AND acceptation_equipe_le IS NOT NULL AND depart_hopital_le IS NULL
    AND depart_prevu_le > now() - interval '12 hours' AND transport_mode IN ('ambulance', 'transport_adapte')`)).rows;
  for (const d of ds) {
    const r = await transaction(pool, (c) => require('../src/transports').preparerDepuisHebergement(c, d, { id: d.acceptation_equipe_par || null }));
    console.log(`${d.numero} : ${r.statut}${r.numero ? ` (${r.numero})` : ''}`);
  }
  if (!ds.length) console.log('Aucun départ programmé à rattraper');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
