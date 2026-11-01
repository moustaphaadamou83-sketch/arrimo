'use strict';
/**
 * Module hospitalier « Liaison CHSLD » : un seul module, commun à tous les hôpitaux, activable depuis SH.
 * Il ne crée aucun moteur parallèle : il lit et fait avancer les coordinations CHSLD ↔ hôpital (src/chsld.js),
 * avec les mêmes verrous, versions, journaux et notifications. Les transferts interhospitaliers restent à part.
 * Règles :
 * - Une demande transmise n'est pas une arrivée : chaque étape est confirmée par une personne (horodatage = preuve).
 * - Aucune orientation clinique automatique, aucune priorité clinique : l'orientation est une décision humaine.
 * - L'hôpital ne voit que la référence du résident (R-00000), jamais son nom.
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const TE = require('./types-etablissement');
const ch = require('./chsld');

const GERER = ['coordonnateur', 'admin_etab', 'gestionnaire'];
const OUVERTS = ['preparee', 'envoyee', 'acceptee', 'en_cours'];

/** Hôpital accessible, module Liaison CHSLD actif ; sinon refus (le module n'existe pas pour cet utilisateur). */
async function etabHopital(db, u, etabId) {
  exigerEtablissement(u, etabId);
  const e = (await db.query('SELECT id, nom, type_etablissement, module_actif, modules FROM etablissements WHERE id = $1', [etabId])).rows[0];
  if (!e) throw new ErreurHttp(404, 'etab_introuvable');
  if ((e.type_etablissement || 'hopital') !== 'hopital') throw new ErreurHttp(409, 'etab_non_hopital');
  if (!TE.moduleActif(e, 'liaison_chsld')) throw new ErreurHttp(403, 'module_desactive', { module: 'liaison_chsld' });
  if (![...GERER, 'equipe_soins'].includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  return e;
}

/**
 * Étape du parcours, déduite uniquement des statuts et horodatages enregistrés :
 * transmise → reçue par l'hôpital → acceptée (ou refusée) → départ confirmé → arrivée confirmée → admission ou urgence
 * → retour en préparation → clôturée ; annulée, expirée.
 */
function etapeLiaison(c, retour) {
  if (c.type === 'retour') return { envoyee: 'retour_propose', acceptee: 'retour_accepte', en_cours: 'retour_en_route', recue: 'retour_recu' }[c.statut] || c.statut;
  if (['refusee', 'annulee', 'expiree'].includes(c.statut)) return c.statut;
  if (c.cloturee_le) return 'cloturee';
  if (c.statut === 'envoyee') return c.recue_hopital_le ? 'recue_hopital' : 'transmise';
  if (c.statut === 'acceptee') return 'acceptee';
  if (c.statut === 'en_cours') return 'depart_confirme';
  if (c.statut === 'recue') {
    if (retour && OUVERTS.includes(retour.statut)) return 'retour_preparation';
    return c.orientation || 'arrivee_confirmee';
  }
  return c.statut;
}
/** Dernière étape réellement confirmée et son horodatage (ce qu'OG cite ; jamais une localisation supposée). */
function derniereConfirmation(c) {
  const e = (c.etapes || []).at(-1);
  return e ? { statut: e.statut, date: e.date } : { statut: c.statut, date: c.modifie_le };
}
/** Actions proposées à l'hôpital selon l'étape et le rôle (le serveur revérifie chacune). */
function actionsHopital(c, u, retour) {
  if (!GERER.includes(u.role) && u.role !== 'equipe_soins') return [];
  const gerer = GERER.includes(u.role);
  if (c.type === 'retour') return c.statut === 'acceptee' ? ['confirmer_depart', ...(gerer ? ['annuler'] : [])] : c.statut === 'envoyee' ? ['incident', ...(gerer ? ['annuler'] : [])] : [];
  if (c.cloturee_le) return [];
  const a = [];
  if (c.statut === 'envoyee') { if (!c.recue_hopital_le) a.push('accuser_reception'); if (gerer) a.push('accepter', 'refuser'); }
  if (c.statut === 'acceptee' && gerer) a.push('refuser');
  if (c.statut === 'en_cours') a.push('confirmer_reception', 'incident');
  if (c.statut === 'recue') {
    if (!c.orientation && gerer) a.push('orienter');
    if (gerer && !(retour && OUVERTS.includes(retour.statut))) a.push('retour');
    a.push('incident');
  }
  return a;
}

/** Les quatre onglets du module, pour l'hôpital courant : arrivées, à accueillir, hospitalisations et retours, historique. */
async function vue(pool, u, etabId) {
  await etabHopital(pool, u, etabId);
  const toutes = await ch.listeCoordinations(pool, u, etabId, { toutes: true });
  const hosp = toutes.filter((c) => c.type === 'hospitalisation' && c.entrante);
  const retours = toutes.filter((c) => c.type === 'retour' && !c.entrante);
  const retourDe = (h) => retours.filter((r) => r.liee_id === h.id).sort((x, y) => new Date(y.cree_le) - new Date(x.cree_le))[0] || null;
  const fiche = (c, r = null) => ({ ...c, etape: etapeLiaison(c, r), derniere: derniereConfirmation(c), actions: actionsHopital(c, u, r),
    retour: r ? { id: r.id, numero: r.numero, statut: r.statut, etape: etapeLiaison(r), retour_prevu_le: r.retour_prevu_le, version: r.version, actions: actionsHopital(r, u) } : null });
  const arrivees = hosp.filter((c) => ['envoyee', 'acceptee'].includes(c.statut)).map((c) => fiche(c));
  const aAccueillir = hosp.filter((c) => c.statut === 'en_cours' || (c.statut === 'recue' && !c.orientation && !c.cloturee_le && !retourDe(c))).map((c) => fiche(c, retourDe(c)));
  const enCours = hosp.filter((c) => c.statut === 'recue' && !c.cloturee_le && (c.orientation || retourDe(c))).map((c) => fiche(c, retourDe(c)));
  const historique = hosp.filter((c) => ['refusee', 'annulee', 'expiree'].includes(c.statut) || c.cloturee_le).map((c) => fiche(c, retourDe(c)));
  return { arrivees, a_accueillir: aAccueillir, hospitalisations: enCours, historique,
    compteurs: { arrivees: arrivees.length, a_accueillir: aAccueillir.length, hospitalisations: enCours.length, retours: enCours.filter((c) => c.retour).length } };
}

module.exports = { vue, etabHopital, etapeLiaison, derniereConfirmation, OUVERTS };
