'use strict';
/**
 * Actions supervisées d'OG (cahier OG §14-15). Utilisateur → intention → outil autorisé → préparation (sans effet)
 * → confirmation explicite et authentifiée → API métier existante → journal → résultat vérifiable.
 * Le niveau d'autonomie est imposé ici, côté serveur, quelle que soit la formulation de la demande.
 * Aucune écriture SQL n'est générée : chaque outil appelle la fonction métier déjà utilisée par l'interface.
 */
const crypto = require('node:crypto');
const { ErreurHttp, transaction } = require('./db');
const { exigerEtablissement } = require('./auth');
const { journaliser } = require('./regles');
const DUREE_MS = 15 * 60 * 1000;
// Niveau 4 : jamais exécutable par OG (décision clinique, irréversible ou sur les droits).
const INTERDITES = new Set(['priorite_clinique', 'diagnostic', 'traitement', 'affectation_clinique_definitive', 'transfert_medical',
  'liberer_lit_occupe', 'fusion_dossiers', 'suppression_donnees', 'changer_droits']);
const T = (u, fr, en) => (u?.langue === 'en' ? en : fr);
const texte = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

const OUTILS = {
  // Niveau 3 : la demande entre dans la file d'admission ; l'attribution du lit reste une décision humaine.
  preparer_admission: {
    niveau: 3, validateur: (u) => T(u, 'coordination de l’établissement', 'facility bed coordination'),
    async preparer(pool, u, etab, e) {
      const s = require('./services'); const et = await s.etablissement(pool, etab);
      const ref = texte(e.patient_ref, 40).toUpperCase(), typeId = Number(e.type_id) || null;
      const types = (await pool.query('SELECT id, code, nom FROM types_unite WHERE config_id=$1 ORDER BY ordre', [et.config_id])).rows;
      // Unité citée dans la phrase (« en médecine ») : rapprochement avec les unités réelles, à vérifier dans la carte.
      const n = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const type = types.find((x) => x.id === typeId) || (e.type_texte ? types.filter((x) => n(e.type_texte).includes(n(x.nom))).sort((a, b) => b.nom.length - a.nom.length)[0] : null);
      const manquants = [], incertains = [];
      if (!ref) manquants.push('patient_ref'); else if (!new RegExp(et.config.reference_regex).test(ref)) incertains.push('patient_ref');
      if (!type) manquants.push('type_id');
      const libres = type ? Number((await pool.query("SELECT count(*)::int n FROM lits WHERE etablissement_id=$1 AND type_id=$2 AND etat='libre'", [etab, type.id])).rows[0].n) : null;
      return { entree: { patient_ref: ref, type_id: type?.id || null }, resume: { patient_ref: ref || null, unite: type?.nom || null, lits_libres: libres, mise_a_jour: new Date().toISOString() },
        manquants, incertains, options: { types: types.map(({ id, nom }) => ({ id, nom })) },
        consequence: T(u, 'Une demande d’admission est ajoutée à la file d’attente. Aucun lit n’est attribué : la coordination décide.', 'An admission request is added to the queue. No bed is assigned: coordination decides.') };
    },
    async executer(db, u, etab, e, pool) {
      const d = await require('./terrain').creerDemande(pool, u, { etablissement_id: etab, patient_ref: e.patient_ref, type_id: e.type_id }, db);
      return { demande_id: d.id, statut: d.statut, patient_ref: d.patient_ref };
    },
  },
  // Niveau 3 : demande de transfert avec lit confirmé réservé ; l'hôpital de destination accepte ou refuse.
  preparer_transfert: {
    niveau: 3, validateur: (u) => T(u, 'hôpital de destination, puis coordination', 'destination hospital, then coordination'),
    async preparer(pool, u, etab, e) {
      const s = require('./services'); const et = await s.etablissement(pool, etab);
      const n = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const ref = texte(e.patient_ref, 40).toUpperCase();
      const types = (await pool.query('SELECT id, nom FROM types_unite WHERE config_id=$1 ORDER BY ordre', [et.config_id])).rows;
      const type = types.find((x) => x.id === Number(e.type_id)) || (e.type_texte ? types.filter((x) => n(e.type_texte).includes(n(x.nom))).sort((a, b) => b.nom.length - a.nom.length)[0] : null);
      let destinations = [];
      if (type) destinations = (await s.recommander(pool, u, etab, type.id)).suggestions.filter((d) => d.libres_confirmes > 0).slice(0, 6)
        .map((d) => ({ id: d.etablissement_id, nom: d.nom, libres_confirmes: d.libres_confirmes, distance_km: d.distance_geographique_km, minutes_route: d.minutes_route }));
      const dest = destinations.find((d) => d.id === Number(e.destination_id)) || (e.type_texte ? destinations.find((d) => n(e.type_texte).includes(n(d.nom))) : null);
      const manquants = [], incertains = [];
      if (!ref) manquants.push('patient_ref'); else if (!new RegExp(et.config.reference_regex).test(ref)) incertains.push('patient_ref');
      if (!type) manquants.push('type_id');
      if (!dest) manquants.push('destination_id');
      return { entree: { patient_ref: ref, type_id: type?.id || null, destination_id: dest?.id || null },
        resume: { patient_ref: ref || null, unite: type?.nom || null, destination: dest?.nom || null, lits_confirmes: dest?.libres_confirmes ?? null, mise_a_jour: new Date().toISOString(),
          trajet: dest?.minutes_route != null ? T(u, `estimation ${dest.minutes_route} min (pas une durée réelle)`, `estimate ${dest.minutes_route} min (not an actual duration)`) : null },
        manquants, incertains, options: { types: types.map(({ id, nom }) => ({ id, nom })), destinations },
        consequence: T(u, 'Une demande de transfert est envoyée avec un lit confirmé réservé à destination. L’hôpital de destination doit l’accepter ; aucun état clinique ne change.',
          'A transfer request is sent with a confirmed bed held at the destination. The destination hospital must accept it; no clinical status changes.') };
    },
    async executer(db, u, etab, e, pool) {
      const tr = await require('./services').creerTransfert(pool, u, { origine_id: etab, destination_id: e.destination_id, type_id: e.type_id, patient_ref: e.patient_ref }, db);
      return { transfert_id: tr.id, numero: tr.numero, statut: tr.statut, patient_ref: tr.patient_ref };
    },
  },
  // Niveau 2 : relance d'un transfert en attente de réponse (même règle et même anti-répétition que l'interface).
  relancer_transfert: {
    niveau: 2, validateur: (u) => T(u, 'utilisateur de l’établissement d’origine', 'user at the origin facility'),
    async preparer(pool, u, etab, e) {
      const numero = texte(e.numero, 30).toUpperCase();
      const t = numero ? (await pool.query(`SELECT t.id, t.numero, t.statut, t.date_demande, t.derniere_relance_le, t.nombre_relances, d.nom destination
        FROM transferts t JOIN etablissements d ON d.id=t.destination_id WHERE t.numero=$1 AND t.origine_id=$2`, [numero, etab])).rows[0] : null;
      const manquants = [], incertains = [];
      if (!t) manquants.push('numero'); else if (t.statut !== 'demande') incertains.push('numero');
      const attente = t ? Math.round((Date.now() - new Date(t.derniere_relance_le || t.date_demande).getTime()) / 60000) : null;
      return { entree: { numero }, resume: t ? { numero: t.numero, destination: t.destination, statut: t.statut, relances: t.nombre_relances, minutes_depuis_derniere: attente } : { numero: numero || null },
        manquants, incertains,
        consequence: T(u, 'La destination reçoit une relance (numéro du transfert seulement, aucune donnée patient). Une seule relance toutes les 5 minutes.', 'The destination receives a reminder (transfer number only, no patient data). At most one reminder every 5 minutes.') };
    },
    async executer(db, u, etab, e, pool) {
      const t = (await db.query('SELECT id FROM transferts WHERE numero=$1 AND origine_id=$2', [e.numero, etab])).rows[0];
      const r = await require('./services').relancerTransfert(pool, u, t.id);
      return { numero: e.numero, relances: r.nombre_relances };
    },
  },
  // Niveau 2 : ticket de support envoyé à l'équipe SH par le canal existant ; le texte vient de l'utilisateur.
  ticket_support: {
    niveau: 2, validateur: (u) => T(u, 'utilisateur connecté', 'signed-in user'),
    async preparer(pool, u, etab, e) {
      const titre = texte(e.titre, 160), description = texte(e.description, 2000);
      const manquants = []; if (titre.length < 5) manquants.push('titre'); if (description.length < 10) manquants.push('description');
      // Pas de référence patient dans un ticket transmis à l'extérieur de l'établissement.
      const incertains = /\b[A-Z]{1,3}-\d{3,}\b/.test(`${titre} ${description}`) ? ['description'] : [];
      return { entree: { titre, description }, resume: { titre, description }, manquants, incertains,
        consequence: T(u, 'Un ticket est créé auprès du support Arrimo. Retirez toute référence patient avant confirmation.', 'A ticket is created with Arrimo support. Remove any patient reference before confirming.') };
    },
    async executer(pool, u, etab, e) {
      if (/\b[A-Z]{1,3}-\d{3,}\b/.test(`${e.titre} ${e.description}`)) throw new ErreurHttp(400, 'og_action_donnees_patient');
      const r = await require('./support-client').creerTicket(pool, u, etab, { titre: e.titre, description: e.description, type: 'question', priorite: 'normale' });
      return { ticket_id: r.id ?? null, reference: r.reference ?? null };
    },
  },
};

function outil(nom) {
  if (INTERDITES.has(nom)) throw new ErreurHttp(403, 'og_action_interdite');
  const o = OUTILS[nom]; if (!o) throw new ErreurHttp(400, 'og_action_inconnue'); return o;
}
async function preparer(pool, u, etab, b) {
  exigerEtablissement(u, etab);
  await require('./og-configuration').exigerFonction(pool, etab, 'actions');
  const nom = String(b.outil || ''); const o = outil(nom);
  const idem = texte(b.idempotence, 80); if (!/^[A-Za-z0-9_-]{8,80}$/.test(idem)) throw new ErreurHttp(400, 'og_action_idempotence');
  const deja = (await pool.query('SELECT * FROM og_actions WHERE utilisateur_id=$1 AND idempotence=$2', [u.id, idem])).rows[0];
  if (deja) return presenter(deja, null);
  const p = await o.preparer(pool, u, etab, b.entree || {});
  const id = crypto.randomUUID();
  const ligne = (await pool.query(`INSERT INTO og_actions (id, etablissement_id, utilisateur_id, outil, niveau, entree, idempotence, expire_le)
    VALUES ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(secs => $8)) RETURNING *`, [id, etab, u.id, nom, o.niveau, JSON.stringify(p.entree), idem, DUREE_MS / 1000])).rows[0];
  return presenter(ligne, { ...p, validateur: o.validateur(u) });
}
function presenter(l, p) {
  return { id: l.id, outil: l.outil, niveau: l.niveau, etat: l.etat, expire_le: l.expire_le, resultat: l.resultat, entree: l.entree,
    ...(p ? { resume: p.resume, manquants: p.manquants, incertains: p.incertains, consequence: p.consequence, validateur: p.validateur, options: p.options || {} } : {}) };
}
/** Confirmation explicite : permissions revérifiées, entrée corrigée revalidée, exécution unique (idempotente). */
async function confirmer(pool, u, etab, id, b) {
  exigerEtablissement(u, etab);
  if (b.confirmation !== true) throw new ErreurHttp(400, 'og_action_confirmation');
  await require('./og-configuration').exigerFonction(pool, etab, 'actions');
  return transaction(pool, async (c) => {
    const l = (await c.query('SELECT * FROM og_actions WHERE id=$1 AND etablissement_id=$2 AND utilisateur_id=$3 FOR UPDATE', [id, etab, u.id])).rows[0];
    if (!l) throw new ErreurHttp(404, 'og_action_introuvable');
    if (l.etat === 'executee') return presenter(l, null);
    if (l.etat !== 'preparee') throw new ErreurHttp(409, 'og_action_close');
    if (new Date(l.expire_le) < new Date()) { await c.query("UPDATE og_actions SET etat='annulee', termine_le=now() WHERE id=$1", [id]); throw new ErreurHttp(410, 'og_action_expiree'); }
    const o = outil(l.outil);
    const p = await o.preparer(c, u, etab, { ...l.entree, ...(b.entree || {}) });
    if (p.manquants.length || p.incertains.length) throw new ErreurHttp(409, 'og_action_incomplete');
    const resultat = await o.executer(c, u, etab, p.entree, pool);
    const fin = (await c.query("UPDATE og_actions SET etat='executee', entree=$2, resultat=$3, confirme_par=$4, termine_le=now() WHERE id=$1 RETURNING *",
      [id, JSON.stringify(p.entree), JSON.stringify(resultat), u.id])).rows[0];
    await journaliser(c, { etablissementId: etab, utilisateurId: u.id, action: 'Action OG confirmée', detail: `${l.outil} · niveau ${l.niveau}` });
    return presenter(fin, null);
  });
}
async function annuler(pool, u, etab, id) {
  exigerEtablissement(u, etab);
  const r = await pool.query("UPDATE og_actions SET etat='annulee', termine_le=now() WHERE id=$1 AND etablissement_id=$2 AND utilisateur_id=$3 AND etat='preparee' RETURNING id", [id, etab, u.id]);
  if (!r.rowCount) throw new ErreurHttp(404, 'og_action_introuvable');
  return { annulee: true };
}
module.exports = { OUTILS, INTERDITES, preparer, confirmer, annuler };
