'use strict';
/**
 * Horloge (moteur commun, lot 0) : une heure marquée par étape, avec sa source et son auteur, jamais modifiée ni effacée.
 * Une correction est une nouvelle ligne (auteur + motif fermé) qui remplace la précédente à la lecture ; une étape absente
 * n'est jamais estimée. `marquer` s'appelle dans la même transaction que le changement d'état.
 */
const { ErreurHttp } = require('./db');

const OBJETS = ['prealerte', 'transfert', 'demande_transport', 'demande_hebergement', 'mission_ccs', 'passage_chrono', 'coordination', 'visite', 'dsn_transition'];
const ETAPES = ['H11', 'H12', 'H13', 'H14', 'H15', 'demande', 'decision', 'depart', 'arrivee', 'prise_en_charge', 'remise', 'reception'];
const SOURCES = ['position', 'clic', 'connecteur', 'systeme'];
const MOTIFS_CORRECTION = ['oubli', 'erreur_saisie', 'position_imprecise', 'panne_reseau', 'autre'];
// Heure refusée si elle est dans le futur (au-delà de 2 min de décalage d'horloge) ou plus vieille que 7 jours
const AVANCE_MAX_MS = 2 * 60000; const RETARD_MAX_MS = 7 * 24 * 3600000;

function controler(objet, etape, heure) {
  if (!OBJETS.includes(objet)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'objet' });
  if (!ETAPES.includes(etape)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etape' });
  const h = heure === undefined || heure === null ? new Date() : new Date(heure);
  if (Number.isNaN(h.getTime())) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'heure' });
  const ecart = h.getTime() - Date.now();
  if (ecart > AVANCE_MAX_MS) throw new ErreurHttp(400, 'heure_future');
  if (-ecart > RETARD_MAX_MS) throw new ErreurHttp(400, 'heure_trop_ancienne');
  return h;
}

/** Marque une étape. Idempotent : si l'étape a déjà une heure courante, elle est conservée et renvoyée (jamais écrasée). */
async function marquer(c, { objet, objetId, etape, heure, source = 'clic', auteurId = null, heureDetectee = null }) {
  if (!SOURCES.includes(source)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'source' });
  const h = controler(objet, etape, heure);
  // Verrou consultatif par objet : deux marquages simultanés de la même étape ne créent pas deux lignes
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`horloge:${objet}:${objetId}`]);
  const existante = (await c.query('SELECT * FROM v_horodatages_courants WHERE objet = $1 AND objet_id = $2 AND etape = $3', [objet, objetId, etape])).rows[0];
  if (existante) return { ...existante, deja: true };
  return (await c.query(`INSERT INTO horodatages (objet, objet_id, etape, heure, source, auteur_id, heure_detectee)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [objet, objetId, etape, h, source, auteurId, heureDetectee])).rows[0];
}

/** Corrige (ou ajoute après coup) l'heure d'une étape : nouvelle ligne tracée, l'ancienne reste lisible. */
async function corriger(c, { objet, objetId, etape, heure, motif, auteurId }) {
  if (!MOTIFS_CORRECTION.includes(motif)) throw new ErreurHttp(400, 'motif_correction_invalide');
  if (!auteurId) throw new ErreurHttp(403, 'auteur_obligatoire');
  const h = controler(objet, etape, heure);
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`horloge:${objet}:${objetId}`]);
  const avant = (await c.query('SELECT id, heure_detectee, heure FROM v_horodatages_courants WHERE objet = $1 AND objet_id = $2 AND etape = $3', [objet, objetId, etape])).rows[0];
  return (await c.query(`INSERT INTO horodatages (objet, objet_id, etape, heure, source, auteur_id, motif_correction, remplace_id, heure_detectee)
    VALUES ($1, $2, $3, $4, 'correction', $5, $6, $7, $8) RETURNING *`,
  [objet, objetId, etape, h, auteurId, motif, avant?.id || null, avant ? (avant.heure_detectee || avant.heure) : null])).rows[0];
}

/** Heures courantes d'un objet : { H11: {...}, H12: {...} } ; l'historique complet avec `historique: true`. */
async function lire(c, objet, objetId, { historique = false } = {}) {
  if (historique) return (await c.query('SELECT * FROM horodatages WHERE objet = $1 AND objet_id = $2 ORDER BY id', [objet, objetId])).rows;
  const rows = (await c.query('SELECT * FROM v_horodatages_courants WHERE objet = $1 AND objet_id = $2', [objet, objetId])).rows;
  return Object.fromEntries(rows.map((r) => [r.etape, r]));
}

/** Écart (en minutes) entre l'heure retenue et l'heure détectée, pour le contrôle des écarts ; null si rien à comparer. */
const ecartMinutes = (r) => (r && r.heure_detectee ? Math.round((new Date(r.heure) - new Date(r.heure_detectee)) / 60000) : null);

module.exports = { marquer, corriger, lire, ecartMinutes, OBJETS, ETAPES, SOURCES, MOTIFS_CORRECTION };
