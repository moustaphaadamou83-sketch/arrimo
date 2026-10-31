'use strict';
/**
 * Démonstration CHSLD, déclenchée depuis SH (POST /api/sh/demo-chsld/peupler, clé de service SH) après la création
 * des deux CHSLD par la console : environnement fictif seulement.
 * - Les comptes des deux CHSLD (domaine fictif @chsld.example.invalid) reçoivent le mot de passe de démonstration déjà
 *   utilisé par les hôpitaux A, B et C (DEMO_MOT_DE_PASSE de cet environnement). Aucun autre compte n'est modifié.
 * - Les scénarios sont saisis par connexion normale de ces comptes et du compte de l'Hôpital B (même mot de passe),
 *   par l'API d'Arrimo ; les sessions sont fermées à la fin.
 */
const { ErreurHttp } = require('./db');
const { hacherAsync } = require('./auth');
const { environnement } = require('./environnement');
const { peupler, ROLES, courrielDe, CHSLD } = require('../db/provisionner-chsld');

async function peuplerDemo(pool, base) {
  if (!['demo', 'recette'].includes(environnement()) && process.env.ARRIMO_PATIENTS_FICTIFS !== '1') throw new ErreurHttp(403, 'residents_reserve_demo');
  const mdp = process.env.DEMO_MOT_DE_PASSE;
  if (!mdp) throw new ErreurHttp(409, 'demo_mot_de_passe_absent');
  const etabs = (await pool.query(`SELECT id, code FROM etablissements WHERE code = ANY($1) AND type_etablissement = 'chsld' AND module_actif`, [CHSLD.map((c) => c.code)])).rows;
  if (etabs.length !== CHSLD.length) throw new ErreurHttp(409, 'demo_chsld_absents');
  if ((await pool.query('SELECT 1 FROM residents WHERE etablissement_id = ANY($1) LIMIT 1', [etabs.map((e) => e.id)])).rowCount) throw new ErreurHttp(409, 'demo_chsld_deja_peuplee');
  const hopitalB = (await pool.query(`SELECT id FROM etablissements WHERE code = 'HY' AND type_etablissement = 'hopital'`)).rows[0];
  if (!hopitalB) throw new ErreurHttp(409, 'demo_hopital_b_absent');
  // Mot de passe de démonstration pour les comptes CHSLD fictifs seulement (rattachés à ces deux établissements)
  const courriels = CHSLD.flatMap((c) => ROLES.map(([, cle]) => courrielDe(c, cle)));
  const hash = await hacherAsync(mdp);
  const maj = await pool.query(`UPDATE utilisateurs u SET mot_de_passe_hash = $2, mdp_temporaire = false, invitation_en_attente = false
    WHERE u.email = ANY($1) AND u.email LIKE '%@chsld.example.invalid'
      AND EXISTS (SELECT 1 FROM utilisateur_etablissements ue WHERE ue.utilisateur_id = u.id AND ue.etablissement_id = ANY($3))
      AND NOT EXISTS (SELECT 1 FROM utilisateur_etablissements ue WHERE ue.utilisateur_id = u.id AND NOT (ue.etablissement_id = ANY($3)))`, [courriels, hash, etabs.map((e) => e.id)]);
  if (maj.rowCount !== courriels.length) throw new ErreurHttp(409, 'demo_chsld_comptes_incomplets');
  // Connexions normales, puis scénarios par l'API
  const sessions = {};
  const appel = async (qui, methode, chemin, corps) => {
    const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(qui && sessions[qui] ? { Authorization: `Bearer ${sessions[qui]}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new ErreurHttp(r.status === 401 ? 409 : r.status, d?.code || 'demo_chsld_echec', d?.vars || {});
    return d;
  };
  const connecter = async (qui, email) => { sessions[qui] = (await appel(null, 'POST', '/connexion', { email, mot_de_passe: mdp })).token; };
  try {
    await connecter('era', courrielDe(CHSLD[0], 'coordination'));
    await connecter('stl', courrielDe(CHSLD[1], 'coordination'));
    await connecter('b', 'hopital.b@demo.arrimo');
    const r = await peupler(appel, { hopitalB: hopitalB.id });
    // Portail des proches (si activé pour les Érables) : Marie Dupont invitée, accès avec le mot de passe de démonstration
    let proche = null;
    const fiche = await appel('era', 'GET', `/chsld/residents/${r.dupont}`);
    const marie = fiche.contacts.find((k) => k.relation === 'fille');
    try {
      const inv = await appel('era', 'POST', `/chsld/contacts/${marie.id}/acces-portail`, {});
      await appel(null, 'POST', '/proches/invitation', { jeton: inv.lien.match(/invitation=([a-f0-9]{64})/)[1], mot_de_passe: mdp });
      await appel('era', 'POST', `/chsld/residents/${r.dupont}/messages`, { contact_id: marie.id, categorie: 'rendez_vous', texte: 'Bonjour, la visite de samedi à 14 h est confirmée.' });
      proche = marie.courriel;
    } catch (e) { if (e.code !== 'module_desactive') throw e; }
    return { cree: true, comptes: courriels, proche, scenarios: ['Jean Dupont (deux proches, autorisations distinctes)', 'Gilles Martin (Hôpital B, retour proposé)', 'transfert inter-CHSLD en attente', 'demandes d’hébergement', 'tâches'] };
  } finally {
    for (const qui of Object.keys(sessions)) await appel(qui, 'POST', '/deconnexion').catch(() => {});
  }
}
module.exports = { peuplerDemo };
