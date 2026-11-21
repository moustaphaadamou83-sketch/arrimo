'use strict';
/**
 * DSN natif (23 nov. 2026, décision de Moustafa) : synchronisation contrôlée entre le DSN et les modules opérationnels.
 * - Lits → DSN : un lit qui passe « occupé » avec la référence d'un patient du DSN crée (ou met à jour) son séjour ; un lit qui
 *   quitte « occupé » termine le séjour lié. Une simple réservation (transfert demandé) ne crée JAMAIS de séjour actif.
 * - DSN → Lits : voir dsn.js (le séjour réserve puis occupe un vrai lit par src/regles.js, verrou et version).
 * - Idempotence : verrou consultatif par patient ; un séjour actif au plus par patient ; liens uniques sur les transitions.
 * - Historique : dsn_evenements (immuable, sans contenu clinique) : type, source, objet, statut, auteur (ou système), heure.
 * Démo et recette seulement, établissements où le module « dsn » est actif ; ailleurs, aucun effet (jamais bloquant pour les lits).
 */
const env = require('./environnement');
const TE = require('./types-etablissement');

const ACTIFS = ['en_cours', 'sortie_preparee'];
const actif = () => ['demo', 'recette'].includes(env.environnement());

async function evenement(c, { patientId = null, etabId, type, source = 'dsn', objet = null, statut, auteurId = null }) {
  await c.query('INSERT INTO dsn_evenements (patient_id, etablissement_id, type, source, objet, statut, auteur_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [patientId, etabId, type, source, objet ? String(objet).slice(0, 120) : null, statut, auteurId || null]);
}
async function verrouPatient(c, patientId) { await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`arrimo-dsn-sejour:${patientId}`]); }
async function sejourActif(c, patientId) {
  return (await c.query(`SELECT * FROM dsn_elements WHERE patient_id = $1 AND genre = 'sejour' AND statut = ANY($2) AND remplace_par IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [patientId, ACTIFS])).rows[0];
}
/** Parcours du patient recalculé d'après ses séjours (jamais laissé « hospitalisé » sans séjour actif). */
async function recalculerParcours(c, patientId) {
  const s = await sejourActif(c, patientId);
  const p = (await c.query('SELECT parcours FROM patients WHERE id = $1', [patientId])).rows[0];
  const voulu = s ? 'hospitalise' : (p?.parcours === 'hospitalise' ? 'enregistre' : p?.parcours);
  if (p && voulu !== p.parcours) await c.query('UPDATE patients SET parcours = $2, modifie_le = now() WHERE id = $1', [patientId, voulu]);
}
async function numero(c) { return `DSN-${String((await c.query("SELECT nextval('dsn_numero_seq') AS n")).rows[0].n).padStart(6, '0')}`; }

/** Appelé par src/regles.js après chaque changement d'état d'un lit (même transaction). Ne bloque jamais l'opération sur le lit. */
async function apresLit(c, avant, apres, utilisateurId) {
  if (!actif()) return;
  const entree = apres.etat === 'occupe' && avant.etat !== 'occupe' && apres.patient_ref;
  const sortie = avant.etat === 'occupe' && apres.etat !== 'occupe';
  if (!entree && !sortie) return;
  const e = (await c.query('SELECT id, modules, type_etablissement FROM etablissements WHERE id = $1', [apres.etablissement_id])).rows[0];
  if (!e || !TE.moduleActif(e, 'dsn')) return;
  await c.query('SAVEPOINT dsn_sync');
  try {
    if (entree) {
      const p = (await c.query('SELECT id FROM patients WHERE etablissement_id = $1 AND reference = $2', [e.id, apres.patient_ref])).rows[0];
      if (p) {
        await verrouPatient(c, p.id);
        const s = await sejourActif(c, p.id);
        const unite = (await c.query('SELECT u.nom FROM unites u WHERE u.id = $1', [apres.unite_id])).rows[0]?.nom || '';
        if (!s) {
          await c.query(`INSERT INTO dsn_elements (numero, patient_id, etablissement_id, genre, donnees, statut, auteur_id, source) VALUES ($1, $2, $3, 'sejour', $4, 'en_cours', $5, 'lits')`,
            [await numero(c), p.id, e.id, JSON.stringify({ service: unite || 'Hospitalisation', lit: apres.code, lit_id: apres.id }), utilisateurId || null]);
          await evenement(c, { patientId: p.id, etabId: e.id, type: 'admission', source: 'lits', objet: `lit ${apres.code}`, statut: 'sejour_cree', auteurId: utilisateurId });
        } else if (Number(s.donnees.lit_id) !== apres.id) {
          // Changement de lit fait dans Lits : nouvelle version du séjour (l'ancienne reste)
          const n = (await c.query(`INSERT INTO dsn_elements (numero, patient_id, etablissement_id, genre, donnees, statut, version, remplace_id, auteur_id, motif, source)
            VALUES ($1, $2, $3, 'sejour', $4, $5, $6, $7, $8, 'Changement de lit (Lits)', 'lits') RETURNING id`,
          [s.numero.replace(/(-v\d+)?$/, `-v${s.version + 1}`), p.id, e.id, JSON.stringify({ ...s.donnees, lit: apres.code, lit_id: apres.id }), s.statut, s.version + 1, s.id, utilisateurId || null])).rows[0];
          await c.query('UPDATE dsn_elements SET remplace_par = $2 WHERE id = $1', [s.id, n.id]);
          await evenement(c, { patientId: p.id, etabId: e.id, type: 'changement_lit', source: 'lits', objet: `lit ${apres.code}`, statut: 'sejour_mis_a_jour', auteurId: utilisateurId });
        }
        await recalculerParcours(c, p.id);
      }
    }
    if (sortie) {
      // Le séjour lié à ce lit se termine (départ constaté par les règles des lits)
      const s = (await c.query(`SELECT * FROM dsn_elements WHERE genre = 'sejour' AND statut = ANY($1) AND remplace_par IS NULL AND etablissement_id = $2 AND (donnees->>'lit_id')::int = $3 FOR UPDATE`,
        [ACTIFS, e.id, avant.id])).rows[0];
      if (s) {
        await c.query("UPDATE dsn_elements SET statut = 'termine', donnees = donnees || $2::jsonb, modifie_le = now() WHERE id = $1", [s.id, JSON.stringify({ fin_le: new Date().toISOString() })]);
        await evenement(c, { patientId: s.patient_id, etabId: e.id, type: 'sortie_lit', source: 'lits', objet: `lit ${avant.code} → ${apres.etat}`, statut: 'sejour_termine', auteurId: utilisateurId });
        await recalculerParcours(c, s.patient_id);
      }
    }
    await c.query('RELEASE SAVEPOINT dsn_sync');
  } catch (err) {
    // Jamais bloquant pour les lits : l'échec est annulé seul et signalé (sans donnée clinique)
    await c.query('ROLLBACK TO SAVEPOINT dsn_sync');
    console.error('DSN, synchronisation des lits :', err.code || err.message);
  }
}

module.exports = { apresLit, evenement, verrouPatient, sejourActif, recalculerParcours, ACTIFS };
