'use strict';
/**
 * Démonstration CHSLD, déclenchée depuis SH (POST /api/sh/demo-chsld/peupler, clé de service SH) après la création
 * des deux CHSLD par la console : environnement fictif seulement.
 * - Les comptes des deux CHSLD (domaine fictif @chsld.example.invalid) reçoivent le mot de passe de démonstration déjà
 *   utilisé par les hôpitaux A, B et C (DEMO_MOT_DE_PASSE de cet environnement). Aucun autre compte n'est modifié.
 * - Les scénarios sont saisis par connexion normale de ces comptes et du compte de l'Hôpital B (même mot de passe),
 *   par l'API d'Arrimo ; les sessions sont fermées à la fin.
 */
const { ErreurHttp, transaction } = require('./db');
const { journalAdmin } = require('./admin');
const { hacherAsync } = require('./auth');
const { environnement } = require('./environnement');
const { peupler, ROLES, courrielDe, CHSLD, RPA } = require('../db/provisionner-chsld');

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
    // Démonstration publique : un seul compte par CHSLD (la recette et les pilotes gardent les quatre rôles)
    const simplification = environnement() === 'demo' ? await simplifierComptesDemo(pool) : null;
    return { cree: true, comptes: simplification ? simplification.actifs : courriels, comptes_desactives: simplification ? simplification.desactives : [], proche, scenarios: ['Jean Dupont (deux proches, autorisations distinctes)', 'Gilles Martin (Hôpital B, retour proposé)', 'transfert inter-CHSLD en attente', 'demandes d’hébergement', 'tâches'] };
  } finally {
    for (const qui of Object.keys(sessions)) await appel(qui, 'POST', '/deconnexion').catch(() => {});
  }
}
/**
 * Démonstration : un seul compte par CHSLD (cahier « refonte visuelle et simplification », 1er nov. 2026).
 * Le compte de coordination devient administrateur de démonstration de son établissement (rôle admin_etab : tous les
 * modules et l'administration de ce seul établissement) ; les trois autres comptes sont désactivés, sans suppression
 * (données, historiques et journaux conservés) et leurs sessions fermées. Comptes fictifs @chsld.example.invalid des deux
 * CHSLD de démonstration seulement ; idempotent ; journalisé. Les rôles du produit restent inchangés.
 */
async function simplifierComptesDemo(pool, liste = CHSLD) {
  if (environnement() !== 'demo') throw new ErreurHttp(403, 'residents_reserve_demo');
  const etabs = (await pool.query(`SELECT id, code FROM etablissements WHERE code = ANY($1) AND type_etablissement = 'chsld'`, [liste.map((c) => c.code)])).rows;
  if (etabs.length !== liste.length) throw new ErreurHttp(409, 'demo_chsld_absents');
  const actifs = [], desactives = [];
  await transaction(pool, async (c) => {
    for (const ch of liste) {
      const etab = etabs.find((e) => e.code === ch.code); const domaine = `%@${ch.domaine || 'chsld.example.invalid'}`;
      for (const [, cle] of ROLES) {
        const email = courrielDe(ch, cle);
        // Compte rattaché à ce seul CHSLD de démonstration
        const u = (await c.query(`SELECT u.id, u.role, u.actif FROM utilisateurs u WHERE u.email = $1 AND u.email LIKE $3
          AND EXISTS (SELECT 1 FROM utilisateur_etablissements ue WHERE ue.utilisateur_id = u.id AND ue.etablissement_id = $2)
          AND NOT EXISTS (SELECT 1 FROM utilisateur_etablissements ue WHERE ue.utilisateur_id = u.id AND ue.etablissement_id <> $2) FOR UPDATE`, [email, etab.id, domaine])).rows[0];
        if (!u) throw new ErreurHttp(409, 'demo_chsld_comptes_incomplets');
        if (cle === 'coordination') {
          if (u.role !== 'admin_etab' || !u.actif) {
            await c.query(`UPDATE utilisateurs SET role = 'admin_etab', actif = true WHERE id = $1`, [u.id]);
            await journalAdmin(c, { id: null }, 'Compte de démonstration CHSLD : administrateur de l’établissement', email, 'démonstration fictive · compte unique', etab.id);
          }
          actifs.push(email);
        } else {
          if (u.actif) {
            await c.query('UPDATE utilisateurs SET actif = false WHERE id = $1', [u.id]);
            await c.query('DELETE FROM sessions WHERE utilisateur_id = $1', [u.id]);
            await journalAdmin(c, { id: null }, 'Compte de démonstration CHSLD désactivé', email, 'démonstration fictive · compte unique par CHSLD ; données conservées', etab.id);
          }
          desactives.push(email);
        }
      }
    }
  });
  return { actifs, desactives };
}
/**
 * Démonstration RPA (« Résidence des Pins », type local RPA sur le moteur CHSLD), déclenchée depuis SH après sa création
 * par la console : environnement fictif seulement. Comptes @rpa.example.invalid au mot de passe de démonstration ;
 * résidents et proches fictifs saisis par l'API d'Arrimo avec le compte de coordination ; aucune donnée clinique.
 */
async function peuplerDemoRpa(pool, base) {
  if (!['demo', 'recette'].includes(environnement()) && process.env.ARRIMO_PATIENTS_FICTIFS !== '1') throw new ErreurHttp(403, 'residents_reserve_demo');
  const mdp = process.env.DEMO_MOT_DE_PASSE;
  if (!mdp) throw new ErreurHttp(409, 'demo_mot_de_passe_absent');
  const [c] = RPA;
  const e = (await pool.query(`SELECT id FROM etablissements WHERE code = $1 AND type_etablissement = 'chsld' AND type_local_code = 'rpa' AND module_actif`, [c.code])).rows[0];
  if (!e) throw new ErreurHttp(409, 'demo_rpa_absente');
  if ((await pool.query('SELECT 1 FROM residents WHERE etablissement_id = $1 LIMIT 1', [e.id])).rowCount) throw new ErreurHttp(409, 'demo_chsld_deja_peuplee');
  const courriels = ROLES.map(([, cle]) => courrielDe(c, cle));
  const maj = await pool.query(`UPDATE utilisateurs u SET mot_de_passe_hash = $2, mdp_temporaire = false, invitation_en_attente = false
    WHERE u.email = ANY($1) AND u.email LIKE '%@rpa.example.invalid'
      AND EXISTS (SELECT 1 FROM utilisateur_etablissements ue WHERE ue.utilisateur_id = u.id AND ue.etablissement_id = $3)
      AND NOT EXISTS (SELECT 1 FROM utilisateur_etablissements ue WHERE ue.utilisateur_id = u.id AND ue.etablissement_id <> $3)`, [courriels, await hacherAsync(mdp), e.id]);
  if (maj.rowCount !== courriels.length) throw new ErreurHttp(409, 'demo_chsld_comptes_incomplets');
  let jeton = null;
  const appel = async (methode, chemin, corps, sans) => {
    const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton && !sans ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new ErreurHttp(r.status === 401 ? 409 : r.status, d?.code || 'demo_chsld_echec', d?.vars || {});
    return d;
  };
  jeton = (await appel('POST', '/connexion', { email: courrielDe(c, 'coordination'), mot_de_passe: mdp }, true)).token;
  try {
    const PRENOMS = ['Huguette', 'Réal', 'Monique', 'Jean-Guy', 'Claudette', 'Normand', 'Denise', 'Rosaire', 'Lise', 'Fernand', 'Ginette', 'Laurent'];
    const NOMS = ['Lachance', 'Poirier', 'Dion', 'Boivin', 'Caron', 'Nadeau', 'Hamel', 'Plante', 'Vachon', 'Thibault', 'Leclerc', 'Martel'];
    const admettre = async (identite, contacts, arrivee = true) => {
      const libre = (await appel('GET', `/chsld/places?etablissement_id=${e.id}`)).find((x) => x.etat === 'libre');
      const r = await appel('POST', '/chsld/residents', { etablissement_id: e.id, ...identite, contacts, confirmer_doublon: true });
      const r2 = await appel('POST', `/chsld/residents/${r.id}/reserver-place`, { lit_id: libre.id, version: libre.version, version_resident: r.version });
      if (!arrivee) return r2;
      for (const t of (await appel('GET', `/chsld/taches?etablissement_id=${e.id}`)).filter((x) => x.lit_id === libre.id && ['preparation_chambre', 'entretien'].includes(x.type))) {
        await appel('POST', `/chsld/taches/${t.id}/statut`, { statut: 'faite', version: t.version });
      }
      return appel('POST', `/chsld/residents/${r.id}/arrivee`, { version: r2.version });
    };
    // Rose Gendron : sa fille Nathalie est invitée dans Arrimo Famille (mot de passe de démonstration)
    const rose = await admettre({ prenom: 'Rose', nom: 'Gendron', date_naissance: '1939-05-14', langue: 'fr' }, [
      { prenom: 'Nathalie', nom: 'Gendron', relation: 'fille', telephone: '555-0401', courriel: 'nathalie.gendron@example.invalid', principal: true, rang: 1, proche_aidant: true, autorisations: ['administratif', 'hebergement', 'mouvements', 'rendez_vous'] }]);
    for (let i = 0; i < 27; i += 1) {
      await admettre({ prenom: PRENOMS[i % 12], nom: `${NOMS[(i * 5) % 12]}-Pins${i}`, date_naissance: `19${33 + (i % 12)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}` },
        [{ prenom: 'Proche', nom: NOMS[(i * 7) % 12], relation: ['fille', 'fils', 'conjoint', 'soeur'][i % 4], telephone: `555-4${String(i).padStart(3, '0')}`, principal: true, autorisations: i % 2 ? ['administratif'] : [] }]);
    }
    // Arrivée prévue demain (logement réservé)
    await admettre({ prenom: 'Gérald', nom: 'Fournier', date_naissance: '1941-08-30', arrivee_prevue: new Date(Date.now() + 86400000).toISOString().slice(0, 10) },
      [{ prenom: 'Josée', nom: 'Fournier', relation: 'fille', telephone: '555-0402', principal: true, autorisations: ['administratif'] }], false);
    let proche = null;
    try {
      const fiche = await appel('GET', `/chsld/residents/${rose.id}`);
      const nat = fiche.contacts.find((k) => k.relation === 'fille');
      const inv = await appel('POST', `/chsld/contacts/${nat.id}/acces-portail`, {});
      await appel('POST', '/proches/invitation', { jeton: inv.lien.match(/invitation=([a-f0-9]{64})/)[1], mot_de_passe: mdp }, true);
      await appel('POST', `/chsld/residents/${rose.id}/messages`, { contact_id: nat.id, categorie: 'rendez_vous', texte: 'Bonjour, le souper de famille de dimanche est confirmé à 17 h.' });
      proche = nat.courriel;
    } catch (er) { if (er.code !== 'module_desactive') throw er; }
    const simplification = environnement() === 'demo' ? await simplifierComptesDemo(pool, RPA) : null;
    const residents = (await pool.query('SELECT count(*)::int n FROM residents WHERE etablissement_id = $1', [e.id])).rows[0].n;
    return { cree: true, residents, comptes: simplification ? simplification.actifs : courriels, comptes_desactives: simplification ? simplification.desactives : [], proche };
  } finally { await appel('POST', '/deconnexion').catch(() => {}); }
}
module.exports = { peuplerDemo, peuplerDemoRpa, simplifierComptesDemo };
