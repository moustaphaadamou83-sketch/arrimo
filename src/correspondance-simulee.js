'use strict';
/**
 * Scénario D (cahier 2, sections 10.3 à 10.5 ; décision de Moustafa du 12 nov. 2026) : correspondance d'une préalerte avec un
 * dossier par un SYSTÈME HOSPITALIER SIMULÉ, en démonstration seulement (refus prouvé ailleurs, y compris en recette).
 * Le simulateur cherche parmi les fiches fictives de l'hôpital (src/patients.js) :
 * - correspondance confirmée : une seule fiche, prénom, nom et date de naissance identiques ;
 * - correspondance incertaine : fiches proches (nom et date, ou prénom et date) ; une personne vérifie et choisit ;
 * - aucune correspondance : la préalerte continue avec son numéro temporaire, l'accueil n'est jamais bloqué.
 * Aucune identification sur un nom ressemblant seul. L'identité n'est visible que par l'hôpital ; le journal, les notifications
 * et l'historique ne contiennent que le statut ; l'ambulance et le CCS ne voient rien de la correspondance.
 */
const { transaction, ErreurHttp } = require('./db');
const { environnement } = require('./environnement');
const { journaliser } = require('./regles');
const { lireIdentite } = require('./patients');

function exigerDemo() {
  if (environnement() !== 'demo') throw new ErreurHttp(403, 'correspondance_reserve_demo');
}
const evenement = (c, id, type, u, detail) => c.query('INSERT INTO prealerte_evenements (prealerte_id, type, detail, utilisateur_id) VALUES ($1, $2, $3, $4)', [id, type, JSON.stringify(detail), u.id]);

async function prealerteHopital(pool, u, id, etabId) {
  const pa = require('./prealertes');
  const p = (await pool.query('SELECT * FROM prealertes WHERE id = $1', [Number(id)])).rows[0];
  if (!p) throw new ErreurHttp(404, 'prealerte_introuvable');
  if (!['coordonnateur', 'gestionnaire', 'admin_etab', 'equipe_soins'].includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  await pa.fiche(pool, u, p.id, { etablissement_id: etabId });   // mêmes droits que la fiche (hôpital destinataire, module actif)
  if (!pa.OUVERTES.includes(p.statut)) throw new ErreurHttp(409, 'prealerte_close');
  return p;
}
/** Interroge le système simulé avec l'identité saisie par l'hôpital (fictive). */
async function rechercher(pool, u, id, b) {
  exigerDemo();
  const p = await prealerteHopital(pool, u, id, b.etablissement_id);
  const ident = lireIdentite(b);
  const fiches = (await pool.query(`SELECT id, reference, prenom, nom, date_naissance FROM patients WHERE etablissement_id = $1 AND date_naissance = $2
    AND (lower(nom) = lower($3) OR lower(prenom) = lower($4))`, [p.destination_id, ident.date_naissance, ident.nom, ident.prenom])).rows;
  const exactes = fiches.filter((f) => f.nom.toLowerCase() === ident.nom.toLowerCase() && f.prenom.toLowerCase() === ident.prenom.toLowerCase());
  const statut = exactes.length === 1 ? 'confirmee' : fiches.length ? 'incertaine' : 'aucune';
  return transaction(pool, async (c) => {
    const n = (await c.query(`UPDATE prealertes SET correspondance_statut = $2, correspondance_patient_id = $3, correspondance_candidats = $4, correspondance_le = now(), correspondance_par = $5,
      version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`,
    [p.id, statut, statut === 'confirmee' ? exactes[0].id : null, statut === 'incertaine' ? fiches.map((f) => f.id) : null, u.id])).rows[0];
    await evenement(c, p.id, 'correspondance', u, { statut, source: 'systeme_hospitalier_simule' });
    await journaliser(c, { etablissementId: p.destination_id, utilisateurId: u.id, action: 'Correspondance de dossier (simulation)', detail: `${p.numero} · ${statut}` });
    return presenter(n, statut === 'confirmee' ? exactes : statut === 'incertaine' ? fiches : []);
  });
}
/** Correspondance incertaine : une personne choisit la fiche parmi les candidates (jamais automatique). */
async function confirmer(pool, u, id, b) {
  exigerDemo();
  const p = await prealerteHopital(pool, u, id, b.etablissement_id);
  if (p.correspondance_statut !== 'incertaine' || !(p.correspondance_candidats || []).includes(Number(b.patient_id))) throw new ErreurHttp(409, 'prealerte_statut_incompatible');
  return transaction(pool, async (c) => {
    const n = (await c.query(`UPDATE prealertes SET correspondance_statut = 'confirmee', correspondance_patient_id = $2, correspondance_candidats = NULL, correspondance_le = now(), correspondance_par = $3,
      version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`, [p.id, Number(b.patient_id), u.id])).rows[0];
    await evenement(c, p.id, 'correspondance', u, { statut: 'confirmee', source: 'verification_humaine' });
    await journaliser(c, { etablissementId: p.destination_id, utilisateurId: u.id, action: 'Correspondance de dossier vérifiée (simulation)', detail: p.numero });
    const f = (await c.query('SELECT id, reference, prenom, nom, date_naissance FROM patients WHERE id = $1', [n.correspondance_patient_id])).rows;
    return presenter(n, f);
  });
}
function presenter(p, fiches) {
  return { id: p.id, numero: p.numero, version: p.version, correspondance: { statut: p.correspondance_statut, simulation: true,
    fiches: fiches.map((f) => ({ id: f.id, reference: f.reference, prenom: f.prenom, nom: f.nom, date_naissance: String(f.date_naissance instanceof Date ? f.date_naissance.toISOString() : f.date_naissance).slice(0, 10) })) } };
}
/** Pour la fiche de l'hôpital (démo) : la fiche fictive retenue ou les candidates. */
async function pourHopital(db, p) {
  if (environnement() !== 'demo' || !p.correspondance_statut) return null;
  const ids = p.correspondance_patient_id ? [p.correspondance_patient_id] : (p.correspondance_candidats || []);
  const fiches = ids.length ? (await db.query('SELECT id, reference, prenom, nom, date_naissance FROM patients WHERE id = ANY($1)', [ids])).rows : [];
  return presenter(p, fiches).correspondance;
}
module.exports = { rechercher, confirmer, pourHopital };
