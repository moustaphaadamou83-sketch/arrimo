/** Variante de démonstration A/B/C bâtie sur les modules et le jeu réseau existants. */
const fs = require('node:fs');
const path = require('node:path');
const { creerPool } = require('../src/db');
const { hacher } = require('../src/auth');
const { demoReseau } = require('./demo-reseau');

const ACCES = path.join(__dirname, '..', '.local', 'acces-demo-trio.txt');
const COMPTES = [
  ['hopital.a@demo.arrimo', 'Coordination Hôpital A', 'HX'],
  ['hopital.b@demo.arrimo', 'Coordination Hôpital B', 'HY'],
  ['hopital.c@demo.arrimo', 'Coordination Hôpital C', 'HC'],
];

async function preparerDemoTrio(pool, { silencieux = false, fichierAcces = ACCES } = {}) {
  await demoReseau(pool, { silencieux: true, comptesRoles: true, avecTransfertsActifs: false });
  // L'historique commun contient des chiffres de scénario, pas des routes vérifiées : ne les expose pas comme trajets réels.
  await pool.query(`UPDATE transferts SET distance_km = NULL, minutes_route = NULL, route_actualise_le = NULL,
    route_fournisseur = NULL, route_version_donnees = NULL, arrivee_prevue = NULL`);
  const mdp = process.env.DEMO_MOT_DE_PASSE || 'Demo-Arrimo-2026';
  const hash = hacher(mdp);
  // HC existait déjà dans le jeu réseau, mais son partage agrégé ne permettait pas une réservation distante.
  await pool.query(`UPDATE etablissements SET nom = 'Hôpital C — Sainte-Aurore', partage = 'complet' WHERE code = 'HC'`);
  // Un exemple réservé explicite dans chaque hôpital rend visible la différence entre capacité libre et réservée.
  await pool.query(`UPDATE lits SET etat = 'reserve', etat_depuis = now() - interval '20 minutes'
    WHERE id = (SELECT min(id) FROM lits WHERE etablissement_id = (SELECT id FROM etablissements WHERE code = 'HC') AND etat = 'occupe')`);
  for (const [email, nom, code] of COMPTES) {
    const etab = (await pool.query('SELECT id FROM etablissements WHERE code = $1', [code])).rows[0];
    const utilisateur = (await pool.query(
      `INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, 'coordonnateur') RETURNING id`,
      [email, nom, hash])).rows[0];
    await pool.query('INSERT INTO utilisateur_etablissements (utilisateur_id, etablissement_id) VALUES ($1, $2)', [utilisateur.id, etab.id]);
  }
  // Noms alignés sur les comptes : le compte « Hôpital A » ouvre bien « Hôpital A », etc.
  await pool.query(`UPDATE etablissements SET nom = 'Hôpital A — Val-des-Pins' WHERE code = 'HX'`);
  await pool.query(`UPDATE etablissements SET nom = 'Hôpital B — Mont-Clair' WHERE code = 'HY'`);
  // Jeu pédiatrique fictif (centre pédiatrique, unités pédiatriques de C, patients fictifs) et congé prévu du lit MED-204A
  const { ajouterPediatrie, congeMed204A } = require('./demo-pediatrie');
  await ajouterPediatrie(pool, { hash });
  await congeMed204A(pool);
  // Dans cette fixture fictive, la capacité de C est fraîchement confirmée par son compte coordonnateur dédié.
  await pool.query(`UPDATE lits SET disponibilite_confirmee_le = now(), disponibilite_confirmee_par =
    (SELECT id FROM utilisateurs WHERE email = 'hopital.c@demo.arrimo')
    WHERE etablissement_id = (SELECT id FROM etablissements WHERE code = 'HC') AND etat = 'libre'`);
  const contenu = [
    'ARRIMO — ACCÈS PRIVÉ DE DÉMONSTRATION A/B/C',
    'Comptes fictifs, uniquement pour la base de démonstration isolée.',
    ...COMPTES.map(([email]) => email),
    'hopital.d@demo.arrimo (centre pédiatrique fictif)',
    'Gestionnaire réseau : reseau@demo.arrimo',
    `Mot de passe commun : ${mdp}`,
    'Ne pas réutiliser ni importer ces comptes dans un environnement réel.',
    '',
  ].join('\n');
  const cheminAcces = path.resolve(fichierAcces);
  fs.mkdirSync(path.dirname(cheminAcces), { recursive: true, mode: 0o700 });
  fs.writeFileSync(cheminAcces, contenu, { mode: 0o600 });
  fs.chmodSync(cheminAcces, 0o600);
  if (!silencieux) console.log(`Démo A/B/C prête. Comptes et mot de passe : ${cheminAcces}`);
  return { comptes: COMPTES.map(([email, , code]) => ({ email, code })), cheminAcces };
}

function urlDemoLocale(value) {
  try {
    const u = new URL(value);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname) && /^arrimo_demo_trio(?:_|$)/.test(decodeURIComponent(u.pathname.slice(1)));
  } catch { return false; }
}

if (require.main === module) {
  const { environnement } = require('../src/environnement');
  if (environnement() !== 'demo' || !urlDemoLocale(process.env.DATABASE_URL || '')) {
    console.error('Refusé : cette commande exige ARRIMO_ENV=demo et une base locale nommée arrimo_demo_trio*.');
    process.exit(1);
  }
  const pool = creerPool(process.env.DATABASE_URL);
  preparerDemoTrio(pool).then(() => pool.end()).catch((e) => { console.error(e.message); pool.end(); process.exitCode = 1; });
}

module.exports = { preparerDemoTrio, urlDemoLocale, ACCES, COMPTES };
