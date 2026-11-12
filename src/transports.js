'use strict';
/**
 * Liaison Établissements (cahier 3, 12 nov. 2026) : demandes de transport vers une entreprise ambulancière.
 * Parcours distinct des préalertes : un établissement (CHSLD, RPA, RI, RTF) ou un hôpital demande le transport d'un résident
 * pour une coordination existante (hospitalisation vers l'hôpital, retour vers l'établissement).
 * Règles :
 * - La destination, l'orientation et l'acceptation du résident restent des décisions de la coordination (src/chsld.js) ;
 *   le transport ne confirme ni le départ ni l'arrivée de la coordination : chaque établissement les confirme lui-même.
 * - L'ambulance ne voit que la référence du résident, les lieux, l'heure souhaitée et les informations de transport en listes
 *   fermées (accessibilité, accompagnateur, langue) : jamais le nom, le dossier ni une donnée clinique.
 * - Chaque étape est horodatée, versionnée et inscrite dans un historique immuable ; isolation par organisation et établissement.
 */
const { transaction, ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const { journaliser } = require('./regles');
const pa = require('./prealertes');

const OUVERTES = ['demandee', 'acceptee', 'en_route', 'pris_en_charge'];
const ROLES_ETAB = ['coordonnateur', 'admin_etab', 'gestionnaire', 'equipe_soins'];
const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const evenement = (c, d, type, u, detail = {}) => c.query('INSERT INTO demande_transport_evenements (demande_id, type, detail, utilisateur_id) VALUES ($1, $2, $3, $4)',
  [d.id, type, JSON.stringify(detail), u ? u.id : null]);

/** Entreprises ambulancières de la région d'un établissement (un CHSLD utilise le profil dérivé « <profil>-CHSLD »). */
async function organisationsRegion(db, etabId) {
  return (await db.query(`SELECT o.id, o.nom FROM organisations_secours o JOIN config_pays c ON c.id = o.config_id
    WHERE 'ambulance' = ANY(o.profils) AND o.actif AND (o.config_id = (SELECT config_id FROM etablissements WHERE id = $1)
      OR c.code = regexp_replace((SELECT c2.code FROM config_pays c2 JOIN etablissements e ON e.config_id = c2.id WHERE e.id = $1), '-CHSLD$', ''))
    ORDER BY o.nom`, [etabId])).rows;
}
async function organisations(pool, u, etabId) {
  const id = entier(etabId); if (!id) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, id);
  if (!ROLES_ETAB.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  return organisationsRegion(pool, id);
}
const numero = async (c) => `DT-${String((await c.query("SELECT nextval('transport_demande_seq') AS n")).rows[0].n).padStart(6, '0')}`;

/** L'établissement d'origine de la coordination demande le transport (avant le départ confirmé). */
async function demander(pool, u, coordinationId, b) {
  const co0 = (await pool.query('SELECT * FROM coordinations WHERE id = $1', [entier(coordinationId)])).rows[0];
  if (!co0 || !['hospitalisation', 'retour'].includes(co0.type)) throw new ErreurHttp(404, 'coordination_introuvable');
  exigerEtablissement(u, co0.origine_id);
  if (!ROLES_ETAB.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const orgs = await organisationsRegion(pool, co0.origine_id);
  const org = orgs.find((o) => o.id === entier(b.organisation_id));
  if (!org) throw new ErreurHttp(404, 'organisation_introuvable');
  const cle = b.cle == null || b.cle === '' ? null : String(b.cle);
  if (cle && !/^[A-Za-z0-9_-]{8,64}$/.test(cle)) throw new ErreurHttp(400, 'cle_idempotence_invalide');
  const heure = b.heure_souhaitee ? new Date(b.heure_souhaitee) : null;
  if (heure && Number.isNaN(heure.getTime())) throw new ErreurHttp(400, 'date_invalide');
  return transaction(pool, async (c) => {
    const co = (await c.query('SELECT * FROM coordinations WHERE id = $1 FOR UPDATE', [co0.id])).rows[0];
    if (cle) {
      const deja = (await c.query('SELECT * FROM demandes_transport WHERE origine_id = $1 AND cle_idempotence = $2', [co.origine_id, cle])).rows[0];
      if (deja) return { ...deja, rejoue: true };
    }
    // Avant le départ : la coordination est transmise ou acceptée (le transport ne remplace pas ces étapes)
    if (!['envoyee', 'acceptee'].includes(co.statut)) throw new ErreurHttp(409, 'coordination_statut_incompatible');
    const ouverte = (await c.query('SELECT numero FROM demandes_transport WHERE coordination_id = $1 AND statut = ANY($2)', [co.id, OUVERTES])).rows[0];
    if (ouverte) throw new ErreurHttp(409, 'transport_deja_demande', { numero: ouverte.numero });
    const i = co.infos_operationnelles || {};
    const infos = { ...(i.accessibilite ? { accessibilite: i.accessibilite } : {}), ...(i.accompagnateur != null ? { accompagnateur: i.accompagnateur } : {}), ...(i.langue ? { langue: i.langue } : {}) };
    const d = (await c.query(`INSERT INTO demandes_transport (numero, coordination_id, organisation_id, origine_id, destination_id, resident_ref, heure_souhaitee, infos, cle_idempotence, cree_par)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [await numero(c), co.id, org.id, co.origine_id, co.destination_id, co.resident_ref, heure || co.retour_prevu_le || null, JSON.stringify(infos), cle, u.id])).rows[0];
    await evenement(c, d, 'demandee', u, { organisation: org.nom });
    await journaliser(c, { etablissementId: co.origine_id, utilisateurId: u.id, action: 'Transport demandé', detail: `${d.numero} · ${co.numero} · ${org.nom}` });
    // L'établissement de destination est averti qu'un transport est demandé pour cette coordination
    await require('./services').notifier(c, co.destination_id, null, 'transport_demande', { numero: d.numero, coordination: co.numero, ref: co.resident_ref, org: org.nom });
    return d;
  });
}

const CHAMPS = `d.*, o.nom AS organisation, un.numero AS unite, un.plaque, eo.nom AS origine, eo.adresse AS origine_adresse, eo.ville AS origine_ville,
  ed.nom AS destination, ed.ville AS destination_ville, co.numero AS coordination, co.type AS coordination_type, co.statut AS coordination_statut`;
const FROM = `FROM demandes_transport d JOIN organisations_secours o ON o.id = d.organisation_id LEFT JOIN unites_secours un ON un.id = d.unite_id
  JOIN etablissements eo ON eo.id = d.origine_id JOIN etablissements ed ON ed.id = d.destination_id JOIN coordinations co ON co.id = d.coordination_id`;

/** Demandes de transport visibles : ambulance (son organisation), établissement (origine ou destination), CCS (sa région, lecture). */
async function liste(pool, u, q = {}) {
  let filtre; let args;
  if (pa.ROLES_AMBULANCE.includes(u.role) || pa.ROLES_CCS.includes(u.role)) {
    const orgs = (await pool.query(`SELECT o.id, o.profils, o.config_id FROM utilisateur_organisations uo JOIN organisations_secours o ON o.id = uo.organisation_id
      WHERE uo.utilisateur_id = $1 AND o.actif`, [u.id])).rows;
    if (pa.ROLES_AMBULANCE.includes(u.role)) { const ids = orgs.filter((o) => o.profils.includes('ambulance')).map((o) => o.id); if (!ids.length) throw new ErreurHttp(403, 'organisation_interdite'); filtre = 'd.organisation_id = ANY($1)'; args = [ids]; }
    else { const cfg = orgs.filter((o) => o.profils.includes('ccs')).map((o) => o.config_id); if (!cfg.length) throw new ErreurHttp(403, 'organisation_interdite'); filtre = 'o.config_id = ANY($1)'; args = [cfg]; }
  } else {
    const id = entier(q.etablissement_id); if (!id) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
    exigerEtablissement(u, id);
    if (!ROLES_ETAB.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
    filtre = '(d.origine_id = $1 OR d.destination_id = $1)'; args = [id];
  }
  const rows = (await pool.query(`SELECT ${CHAMPS} ${FROM} WHERE ${filtre} AND (d.statut = ANY($2) OR d.modifie_le > now() - interval '24 hours')
    ORDER BY (d.statut = ANY($2)) DESC, d.heure_souhaitee NULLS LAST, d.id`, [...args, OUVERTES])).rows;
  const cote = pa.ROLES_AMBULANCE.includes(u.role) ? 'ambulance' : pa.ROLES_CCS.includes(u.role) ? 'ccs' : 'etablissement';
  return rows.map((d) => ({ ...d, actions: actions(d, u, cote, q.etablissement_id) }));
}
function actions(d, u, cote, etabId) {
  if (!OUVERTES.includes(d.statut)) return [];
  if (cote === 'ambulance') {
    return d.statut === 'demandee' ? ['accepter', 'refuser'] : d.statut === 'acceptee' ? ['en_route'] : d.statut === 'en_route' ? ['pris_en_charge'] : ['arrivee'];
  }
  if (cote === 'etablissement' && Number(etabId) === d.origine_id && ['demandee', 'acceptee', 'en_route'].includes(d.statut)) return ['annuler'];
  return [];
}
const MOTIFS = ['aucune_unite', 'hors_territoire', 'autre'];
// Libellés du journal (traduits par l'interface : journal_actions)
const ACTIONS_JOURNAL = { accepter: 'Transport accepté', refuser: 'Transport refusé', en_route: 'Ambulance en route', pris_en_charge: 'Résident pris en charge', arrivee: 'Transport arrivé', annuler: 'Transport annulé' };
/** Étapes du transport : l'ambulance accepte (unité), part, prend en charge, arrive ; l'établissement d'origine peut annuler avant la prise en charge. */
async function agir(pool, u, id, b) {
  const d0 = (await pool.query('SELECT * FROM demandes_transport WHERE id = $1', [entier(id)])).rows[0];
  if (!d0) throw new ErreurHttp(404, 'transport_introuvable');
  let cote;
  if (pa.ROLES_AMBULANCE.includes(u.role)) {
    const ok = (await pool.query(`SELECT 1 FROM utilisateur_organisations uo JOIN organisations_secours o ON o.id = uo.organisation_id WHERE uo.utilisateur_id = $1 AND o.id = $2 AND o.actif AND 'ambulance' = ANY(o.profils)`, [u.id, d0.organisation_id])).rowCount;
    if (!ok) throw new ErreurHttp(404, 'transport_introuvable');
    cote = 'ambulance';
  } else if (ROLES_ETAB.includes(u.role) && Number(b.etablissement_id) === d0.origine_id) { exigerEtablissement(u, d0.origine_id); cote = 'etablissement'; }
  else throw new ErreurHttp(403, 'role_insuffisant');
  const a = String(b.action || '');
  return transaction(pool, async (c) => {
    const d = (await c.query('SELECT * FROM demandes_transport WHERE id = $1 FOR UPDATE', [d0.id])).rows[0];
    if (!OUVERTES.includes(d.statut)) throw new ErreurHttp(409, 'transport_clos');
    if (b.version != null && Number(b.version) !== d.version) throw new ErreurHttp(409, 'version_perimee');
    const maj = async (sql, vals = []) => (await c.query(`UPDATE demandes_transport SET ${sql}, version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`, [d.id, ...vals])).rows[0];
    const attendu = { accepter: 'demandee', refuser: 'demandee', en_route: 'acceptee', pris_en_charge: 'en_route', arrivee: 'pris_en_charge' };
    let n; let detail = {};
    if (cote === 'ambulance') {
      if (!attendu[a]) throw new ErreurHttp(400, 'action_inconnue');
      if (d.statut !== attendu[a]) throw new ErreurHttp(409, 'transport_statut_incompatible');
      if (a === 'accepter') {
        const un = (await c.query('SELECT id, numero FROM unites_secours WHERE id = $1 AND organisation_id = $2 AND actif', [entier(b.unite_id), d.organisation_id])).rows[0];
        if (!un) throw new ErreurHttp(404, 'unite_introuvable');
        n = await maj("statut = 'acceptee', unite_id = $2, acceptee_le = now()", [un.id]); detail = { unite: un.numero };
      } else if (a === 'refuser') {
        const motif = MOTIFS.includes(b.motif) ? b.motif : 'autre';
        n = await maj("statut = 'refusee', motif_refus = $2", [motif]); detail = { motif };
      } else n = await maj(`statut = '${a}', ${a}_le = now()`);
    } else {
      if (a !== 'annuler') throw new ErreurHttp(400, 'action_inconnue');
      if (d.statut === 'pris_en_charge') throw new ErreurHttp(409, 'transport_statut_incompatible');
      n = await maj("statut = 'annulee'");
    }
    await evenement(c, n, a, u, detail);
    const co = (await c.query('SELECT numero FROM coordinations WHERE id = $1', [n.coordination_id])).rows[0];
    for (const etab of [n.origine_id, n.destination_id]) {
      await journaliser(c, { etablissementId: etab, utilisateurId: u.id || null, action: ACTIONS_JOURNAL[a], detail: `${n.numero} · ${co.numero}` });
    }
    // L'établissement d'origine suit son transport (cahier 3, étape 6) ; la destination est avertie de l'approche
    const vars = { numero: n.numero, coordination: co.numero, ref: n.resident_ref };
    if (cote === 'ambulance') await require('./services').notifier(c, n.origine_id, null, `transport_${a}`, vars);
    if (['pris_en_charge', 'annuler'].includes(a)) await require('./services').notifier(c, n.destination_id, null, `transport_${a}`, vars);
    return n;
  });
}
/** Historique d'une demande : mêmes droits et même période que la liste (ouvertes et dernières 24 h). */
async function fiche(pool, u, id, q = {}) {
  const visibles = await liste(pool, u, q);
  const d = visibles.find((x) => x.id === entier(id));
  if (!d) throw new ErreurHttp(404, 'transport_introuvable');
  const evenements = (await pool.query(`SELECT ev.type, ev.detail, ev.cree_le, us.nom AS par FROM demande_transport_evenements ev LEFT JOIN utilisateurs us ON us.id = ev.utilisateur_id
    WHERE ev.demande_id = $1 ORDER BY ev.id`, [d.id])).rows;
  return { ...d, evenements };
}
module.exports = { organisations, demander, liste, agir, fiche, OUVERTES };
