/**
 * Démonstration seulement (ARRIMO_ENV=demo) : clôt les parcours de test restés ouverts depuis plus de 24 h, par les mêmes actions
 * que l'interface (chsld.js, prealertes.js, vehicules.js), pour que Sillage n'affiche pas d'alertes d'anciens essais.
 * - départs jamais partis : annulés par le CHSLD ;
 * - départs partis sans arrivée : arrivée confirmée par l'hôpital ;
 * - hospitalisations sans orientation : admission dans un lit libre (référence créée automatiquement) ;
 * - retours arrivés sans réintégration : chambre préparée puis réintégration confirmée ;
 * - anciens retours « reçus » d'une version précédente (résident déjà présent) : clôturés, avec étape journalisée ;
 * - préalertes ouvertes : remise confirmée par l'hôpital ; unités hors service : remises en service.
 * Rejouable. Aucune donnée réelle.
 */
const { creerPool } = require('../src/db');
const { estDemo } = require('../src/environnement');

async function utilisateurDe(pool, etabId) {
  const u = (await pool.query(`SELECT u.id, u.nom, u.email, u.role, COALESCE(array_agg(ue.etablissement_id), '{}') AS etabs FROM utilisateurs u
    JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id WHERE u.actif AND u.role IN ('coordonnateur', 'admin_etab', 'gestionnaire')
    AND u.id IN (SELECT utilisateur_id FROM utilisateur_etablissements WHERE etablissement_id = $1) GROUP BY u.id ORDER BY u.id LIMIT 1`, [etabId])).rows[0];
  if (!u) throw new Error(`Aucun compte de coordination pour l'établissement ${etabId}`);
  return { ...u, gestionnaire: u.role === 'gestionnaire', admin: ['gestionnaire', 'admin_etab'].includes(u.role), langue: 'fr' };
}

async function menage(pool, { journal = console.log } = {}) {
  if (!estDemo()) throw new Error('Réservé à l’environnement de démonstration (ARRIMO_ENV=demo).');
  const ch = require('../src/chsld');
  const co = async (id) => (await pool.query('SELECT * FROM coordinations WHERE id = $1', [id])).rows[0];
  const vieux = (await pool.query(`SELECT c.*, r.statut AS r_statut FROM coordinations c JOIN residents r ON r.id = c.resident_id
    WHERE c.cloturee_le IS NULL AND c.statut NOT IN ('annulee', 'refusee', 'expiree') AND c.modifie_le < now() - interval '24 hours' ORDER BY c.id`)).rows;
  for (const c0 of vieux) {
    try {
      const orig = await utilisateurDe(pool, c0.origine_id); const dest = await utilisateurDe(pool, c0.destination_id);
      if (c0.type === 'hospitalisation') {
        let c = c0;
        if (['envoyee', 'acceptee'].includes(c.statut)) { await ch.actionCoordination(pool, orig, c.id, { etablissement_id: c.origine_id, action: 'annuler', version: c.version }); journal(`${c.numero} : annulée (jamais partie)`); continue; }
        if (c.statut === 'en_cours') { c = await ch.actionCoordination(pool, dest, c.id, { etablissement_id: c.destination_id, action: 'confirmer_reception', version: c.version }); journal(`${c.numero} : arrivée confirmée`); }
        c = await co(c.id);
        if (c.statut === 'recue' && !c.orientation) {
          const lit = (await pool.query(`SELECT l.id, l.version, l.type_id FROM lits l JOIN unites un ON un.id = l.unite_id WHERE l.etablissement_id = $1 AND l.etat = 'libre' AND l.actif
            AND un.nom !~* 'intensi|urgence|pédiat|pediat|obst|natal' ORDER BY l.id LIMIT 1`, [c.destination_id])).rows[0];
          if (lit) { await ch.actionCoordination(pool, dest, c.id, { etablissement_id: c.destination_id, action: 'orienter', orientation: 'admission', type_id: lit.type_id, lit_id: lit.id, version_lit: lit.version, version: c.version }); journal(`${c.numero} : admis (lit)`); }
        }
      } else if (c0.type === 'retour' && c0.statut === 'recue') {
        if (c0.r_statut === 'retour_a_reintegrer') {
          // Préparation de la chambre terminée (tâches ouvertes du lit), chambre vérifiée, réintégration
          const r = (await pool.query('SELECT lit_id FROM residents WHERE id = $1', [c0.resident_id])).rows[0];
          for (const t of (await pool.query(`SELECT id, version FROM taches_etab WHERE lit_id = $1 AND statut IN ('a_faire', 'en_cours')`, [r.lit_id])).rows) {
            await ch.statutTache(pool, dest, t.id, { statut: 'faite', version: t.version });
          }
          let c = await co(c0.id);
          if (!c.chambre_verifiee_le) c = await ch.actionCoordination(pool, dest, c.id, { etablissement_id: c.destination_id, action: 'verifier_chambre', version: c.version }).catch(() => c);
          c = await co(c0.id);
          await ch.actionCoordination(pool, dest, c.id, { etablissement_id: c.destination_id, action: 'reintegrer', identite_verifiee: true, conditions_accueil: true, version: c.version });
          journal(`${c0.numero} : réintégré`);
        } else if (c0.r_statut === 'present') {
          // Ancien retour d'une version précédente : le résident est déjà dans sa chambre ; le parcours est simplement clos
          await pool.query('UPDATE coordinations SET cloturee_le = now(), version = version + 1, modifie_le = now() WHERE id = $1', [c0.id]);
          await pool.query('INSERT INTO coordination_etapes (coordination_id, statut, etablissement_id, par, detail) VALUES ($1, $2, $3, $4, $5)', [c0.id, 'cloturee', c0.destination_id, dest.id, 'Clôture (ménage de démonstration)']);
          if (c0.liee_id) await pool.query('UPDATE coordinations SET cloturee_le = COALESCE(cloturee_le, now()), version = version + 1, modifie_le = now() WHERE id = $1', [c0.liee_id]);
          journal(`${c0.numero} : clôturé (résident déjà présent)`);
        }
      }
    } catch (e) { journal(`${c0.numero} : non traité (${e.code || e.message})`); }
  }
  // Préalertes ouvertes depuis plus de 24 h : remise confirmée par l'hôpital (l'ambulance redevient disponible)
  const pa = require('../src/prealertes');
  for (const p of (await pool.query(`SELECT * FROM prealertes WHERE statut NOT IN ('cloturee', 'annulee', 'remplacee') AND cree_le < now() - interval '24 hours'`)).rows) {
    try {
      const h = await utilisateurDe(pool, p.destination_id);
      if (p.statut === 'arrivee') await pa.agir(pool, h, p.id, { etablissement_id: p.destination_id, action: 'confirmer_remise' });
      journal(`${p.numero} : remise confirmée`);
    } catch (e) { journal(`${p.numero} : non traitée (${e.code || e.message})`); }
  }
  // Unités hors service depuis plus de 24 h : remises en service (disponibles)
  const { transaction } = require('../src/db'); const vh = require('../src/vehicules');
  for (const v of (await pool.query(`SELECT ev.unite_id, un.numero FROM etats_vehicules ev JOIN unites_secours un ON un.id = ev.unite_id WHERE ev.etat = 'hors_service' AND ev.modifie_le < now() - interval '24 hours'`)).rows) {
    await transaction(pool, (c) => vh.fixer(c, v.unite_id, 'disponible', { source: 'equipage' })); journal(`${v.numero} : disponible`);
  }
}

if (require.main === module) {
  const pool = creerPool(process.env.DATABASE_URL);
  menage(pool).then(() => pool.end()).catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });
}
module.exports = { menage };
