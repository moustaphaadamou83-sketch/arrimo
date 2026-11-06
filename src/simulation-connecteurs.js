/** Connecteurs fictifs : une session humaine ET une clé d'établissement sont nécessaires.
 * Les workflows d'Arrimo restent la seule source des changements métier.
 */
const crypto = require('node:crypto');
const { transaction, ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const env = require('./environnement');
const terrain = require('./terrain');
const priorites = require('./priorites');
const services = require('./services');
const regles = require('./regles');

const CHAMPS = {
  arrivee_urgence: ['patient', 'civiere', 'version', 'arrivee_le'],
  demande_lit: ['patient', 'type_unite', 'demande', 'civiere', 'groupe_age', 'besoins', 'provenance'],
  priorite_validee: ['demande', 'code', 'revision', 'version', 'motif'],
  attribution: ['demande', 'lit', 'version'], admission: ['demande', 'lit', 'version'],
  etat_lit: ['lit', 'action', 'version', 'motif'],
  conge: ['lit', 'patient', 'version'],
  conge_prevu: ['lit', 'patient', 'version', 'date'], conge_confirme: ['lit', 'patient', 'version', 'date'],
  nettoyage: ['genre', 'ressource', 'version'],
  transfert: ['demande', 'destination', 'transfert', 'urgent'],
  transfert_etape: ['transfert', 'etape', 'motif', 'motif_code'], reception: ['transfert'],
};
const GENRES = ['patient', 'lit', 'civiere', 'type_unite', 'demande', 'transfert', 'etablissement'];
const objet = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function reference(v) {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(v)) throw new ErreurHttp(400, 'simulation_reference_invalide');
  return v;
}
function dateUTC(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)) throw new ErreurHttp(400, 'date_invalide');
  const d = new Date(v); const attendu = v.includes('.') ? v : v.replace('Z', '.000Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString() !== attendu) throw new ErreurHttp(400, 'date_invalide');
  return d.toISOString();
}
function normaliser(ev) {
  if (!objet(ev) || Object.keys(ev).some((k) => !['identifiant', 'flux', 'sequence', 'date_source', 'evenement', 'confirmation', 'donnees'].includes(k))
    || !Object.hasOwn(CHAMPS, ev.evenement) || !objet(ev.donnees) || Object.keys(ev.donnees).some((k) => !CHAMPS[ev.evenement].includes(k))) throw new ErreurHttp(400, 'simulation_evenement_invalide');
  if (ev.confirmation !== true) throw new ErreurHttp(400, 'priorites_confirmation_requise');
  if (!Number.isSafeInteger(ev.sequence) || ev.sequence < 1) throw new ErreurHttp(400, 'simulation_sequence_invalide');
  const d = { ...ev.donnees };
  for (const k of ['patient', 'civiere', 'type_unite', 'demande', 'lit', 'destination', 'transfert', 'ressource']) if (d[k] !== undefined) reference(d[k]);
  if (d.besoins !== undefined && (!objet(d.besoins) || Object.keys(d.besoins).some((k) => !['isolement', 'pression_negative', 'ventilation', 'telemetrie'].includes(k) || typeof d.besoins[k] !== 'boolean'))) throw new ErreurHttp(400, 'simulation_evenement_invalide');
  for (const k of ['date', 'arrivee_le']) if (d[k] !== undefined) d[k] = dateUTC(d[k]);
  if (ev.evenement === 'demande_lit' && !['adulte', 'pediatrique', 'neonatal'].includes(d.groupe_age)) throw new ErreurHttp(400, 'simulation_evenement_invalide');
  if (d.version !== undefined && (!Number.isSafeInteger(d.version) || d.version < 0)) throw new ErreurHttp(400, 'priorites_version_requise');
  if (['attribution', 'admission', 'arrivee_urgence', 'etat_lit', 'conge', 'conge_prevu', 'conge_confirme', 'nettoyage', 'priorite_validee'].includes(ev.evenement) && d.version === undefined) throw new ErreurHttp(400, 'priorites_version_requise');
  if (ev.evenement === 'transfert' && typeof d.urgent !== 'boolean') throw new ErreurHttp(400, 'simulation_evenement_invalide');
  return { identifiant: reference(ev.identifiant), flux: reference(ev.flux), sequence: ev.sequence, date_source: dateUTC(ev.date_source), evenement: ev.evenement, confirmation: true, donnees: d };
}
function canoniser(v) {
  if (Array.isArray(v)) return v.map(canoniser);
  if (objet(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canoniser(v[k])]));
  return v;
}
const empreinte = (ev) => crypto.createHash('sha256').update(JSON.stringify(canoniser(ev))).digest('hex');
function exigerSimulation(u, con) {
  if (!['demo', 'recette'].includes(env.environnement())) throw new ErreurHttp(403, 'simulation_environnement_interdit');
  if (!con.etablissement_id || !['coordonnateur', 'admin_etab', 'gestionnaire'].includes(u.role)) throw new ErreurHttp(403, 'simulation_interdite');
  exigerEtablissement(u, con.etablissement_id);
}
function exigerAdmin(u) {
  if (!u.admin || !['admin_etab', 'gestionnaire'].includes(u.role)) throw new ErreurHttp(403, 'reserve_admin');
  if (env.exige2faAdmin() && !u.totp_actif) throw new ErreurHttp(403, 'admin_exige_2fa');
}
async function configurer(pool, u, id, b) {
  exigerAdmin(u);
  if (b.confirmation !== true || typeof b.actif !== 'boolean') throw new ErreurHttp(400, 'priorites_confirmation_requise');
  return transaction(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`arrimo-connecteur:${id}`]);
    const con = (await c.query('SELECT * FROM connecteurs WHERE id=$1 AND actif FOR SHARE', [id])).rows[0];
    if (!con) throw new ErreurHttp(404, 'connecteur_introuvable');
    exigerSimulation(u, con);
    await c.query(`INSERT INTO connecteurs_simulation_config(connecteur_id,actif,configure_par) VALUES($1,$2,$3)
      ON CONFLICT(connecteur_id) DO UPDATE SET actif=EXCLUDED.actif,configure_par=EXCLUDED.configure_par,configure_le=now()`, [id, b.actif, u.id]);
    await regles.journaliser(c, { etablissementId: con.etablissement_id, utilisateurId: u.id, action: 'Configuration du connecteur simulé', detail: JSON.stringify({ connecteur_id: id, actif: b.actif }) });
    return { connecteur_id: id, actif: b.actif };
  });
}
async function verifierActif(c, con) {
  const r = await c.query(`SELECT s.connecteur_id FROM connecteurs_simulation_config s JOIN connecteurs c ON c.id=s.connecteur_id
    JOIN etablissements e ON e.id=c.etablissement_id WHERE c.id=$1 AND c.etablissement_id=$2 AND c.actif AND s.actif AND e.actif AND e.module_actif FOR SHARE OF s,c`, [con.id, con.etablissement_id]);
  if (!r.rows[0]) throw new ErreurHttp(403, 'simulation_interdite');
}
async function verifierValeur(c, con, genre, valeur) {
  const etab = con.etablissement_id;
  if (genre === 'patient') {
    const r = (await c.query('SELECT cfg.reference_regex FROM etablissements e JOIN config_pays cfg ON cfg.id=e.config_id WHERE e.id=$1', [etab])).rows[0];
    if (!r || !new RegExp(r.reference_regex).test(valeur)) throw new ErreurHttp(400, 'simulation_reference_invalide');
    return valeur;
  }
  if (!/^[1-9]\d*$/.test(String(valeur)) || !Number.isSafeInteger(Number(valeur))) throw new ErreurHttp(400, 'simulation_reference_invalide');
  const requetes = {
    lit: 'SELECT id FROM lits WHERE id=$1 AND etablissement_id=$2',
    civiere: 'SELECT id FROM civieres WHERE id=$1 AND etablissement_id=$2',
    demande: 'SELECT id FROM demandes_admission WHERE id=$1 AND etablissement_id=$2',
    transfert: 'SELECT id FROM transferts WHERE id=$1 AND (origine_id=$2 OR destination_id=$2)',
    type_unite: 'SELECT t.id FROM types_unite t JOIN etablissements e ON e.config_id=t.config_id WHERE t.id=$1 AND e.id=$2',
    etablissement: "SELECT d.id FROM etablissements d JOIN etablissements o ON o.config_id=d.config_id WHERE d.id=$1 AND o.id=$2 AND d.id<>o.id AND d.actif AND d.module_actif AND d.partage<>'aucun'",
  };
  if (!Object.hasOwn(requetes, genre) || !(await c.query(requetes[genre], [Number(valeur), etab])).rows[0]) throw new ErreurHttp(403, 'simulation_correspondance_interdite');
  return Number(valeur);
}
async function lier(c, con, u, genre, ref, valeur) {
  if (!GENRES.includes(genre)) throw new ErreurHttp(400, 'simulation_reference_invalide');
  reference(ref); await verifierValeur(c, con, genre, String(valeur));
  const r = await c.query(`INSERT INTO connecteurs_correspondances(connecteur_id,genre,reference_externe,valeur_locale,cree_par)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING valeur_locale`, [con.id, genre, ref, String(valeur), u.id]);
  if (!r.rows[0]) {
    const avant = (await c.query('SELECT valeur_locale FROM connecteurs_correspondances WHERE connecteur_id=$1 AND genre=$2 AND reference_externe=$3', [con.id, genre, ref])).rows[0];
    if (avant?.valeur_locale !== String(valeur)) throw new ErreurHttp(409, 'simulation_correspondance_conflit');
  }
  return { genre, reference_externe: ref, valeur_locale: String(valeur) };
}
async function correspondance(pool, u, con, b) {
  exigerSimulation(u, con); exigerAdmin(u);
  if (b.confirmation !== true) throw new ErreurHttp(400, 'priorites_confirmation_requise');
  return transaction(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`arrimo-connecteur:${con.id}`]);
    await verifierActif(c, con);
    const r = await lier(c, con, u, b.genre, b.reference_externe, b.valeur_locale);
    await regles.journaliser(c, { etablissementId: con.etablissement_id, utilisateurId: u.id, action: 'Correspondance de simulation enregistrée', detail: JSON.stringify({ connecteur_id: con.id, ...r }) });
    return r;
  });
}
async function resoudre(c, con, genre, ref) {
  reference(ref);
  const r = (await c.query('SELECT valeur_locale FROM connecteurs_correspondances WHERE connecteur_id=$1 AND genre=$2 AND reference_externe=$3', [con.id, genre, ref])).rows[0];
  if (!r) throw new ErreurHttp(409, 'simulation_correspondance_absente');
  return verifierValeur(c, con, genre, r.valeur_locale);
}
async function appliquer(c, pool, u, con, ev) {
  const b = ev.donnees; const chercher = (genre, ref) => resoudre(c, con, genre, ref);
  const lit = async () => (await c.query('SELECT * FROM lits WHERE id=$1 AND etablissement_id=$2 FOR UPDATE', [await chercher('lit', b.lit), con.etablissement_id])).rows[0];
  let r;
  if (ev.evenement === 'arrivee_urgence') {
    r = await regles.changerEtatCiviere(c, pool, u.id, await chercher('civiere', b.civiere), 'occupee', { versionAttendue: b.version, patientRef: await chercher('patient', b.patient), arrivee: b.arrivee_le || ev.date_source, detail: 'Arrivée fictive synchronisée' });
  } else if (ev.evenement === 'demande_lit') {
    r = await terrain.creerDemande(pool, u, { etablissement_id: con.etablissement_id, patient_ref: await chercher('patient', b.patient),
      type_id: await chercher('type_unite', b.type_unite), groupe_age: b.groupe_age, besoins: b.besoins,
      provenance: b.provenance, civiere_id: b.civiere ? await chercher('civiere', b.civiere) : undefined }, c);
    await lier(c, con, u, 'demande', b.demande, r.id);
  } else if (ev.evenement === 'priorite_validee') {
    r = await priorites.valider(pool, u, await chercher('demande', b.demande), { code: b.code, revision: b.revision, version: b.version, motif: b.motif, confirmation: true }, c);
  } else if (ev.evenement === 'attribution') {
    r = await terrain.assignerLit(pool, u, await chercher('demande', b.demande), await chercher('lit', b.lit), b.version, c);
  } else if (ev.evenement === 'admission') {
    const demande = await chercher('demande', b.demande); const litId = await chercher('lit', b.lit);
    const d = (await c.query('SELECT lit_id,statut FROM demandes_admission WHERE id=$1 FOR UPDATE', [demande])).rows[0];
    if (!d || d.lit_id !== litId) throw new ErreurHttp(409, 'simulation_version_conflit');
    if (d.statut !== 'admise') {
      const version = (await c.query('SELECT version FROM lits WHERE id=$1 FOR UPDATE', [litId])).rows[0]?.version;
      if (version !== b.version) throw new ErreurHttp(409, 'simulation_version_conflit');
    }
    r = await terrain.admettreDemande(pool, u, demande, c);
  } else if (['conge', 'conge_prevu', 'conge_confirme'].includes(ev.evenement)) {
    const l = await lit();
    if (l.patient_ref !== await chercher('patient', b.patient)) throw new ErreurHttp(409, 'simulation_patient_conflit');
    if (l.version !== b.version) throw new ErreurHttp(409, 'simulation_version_conflit');
    if (ev.evenement === 'conge') r = await regles.changerEtat(c, pool, u.id, l.id, 'nettoyage', { versionAttendue: b.version, detail: 'Départ fictif synchronisé' });
    else {
      r = await terrain.majConge(pool, u, l.id, ev.evenement === 'conge_confirme' ? 'confirme' : 'prevu', dateUTC(b.date), c);
      r.version = (await c.query('UPDATE lits SET version=version+1 WHERE id=$1 RETURNING version', [l.id])).rows[0].version;
    }
  } else if (ev.evenement === 'etat_lit') {
    if (!['hors_service', 'remettre'].includes(b.action)) throw new ErreurHttp(400, 'simulation_evenement_invalide');
    r = await regles.changerEtat(c, pool, u.id, await chercher('lit', b.lit), regles.ACTIONS_LIT[b.action], { versionAttendue: b.version, motif: b.motif, detail: 'État fictif synchronisé' });
  } else if (ev.evenement === 'nettoyage') {
    if (!['lit', 'civiere'].includes(b.genre)) throw new ErreurHttp(400, 'simulation_evenement_invalide');
    const id = await chercher(b.genre, b.ressource);
    const ressource = (await c.query(`SELECT etat FROM ${b.genre === 'lit' ? 'lits' : 'civieres'} WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (ressource?.etat !== 'nettoyage') throw new ErreurHttp(409, 'nettoyage_impossible');
    r = b.genre === 'lit' ? await regles.changerEtat(c, pool, u.id, id, 'libre', { versionAttendue: b.version, detail: 'Nettoyage fictif confirmé' })
      : await regles.changerEtatCiviere(c, pool, u.id, id, 'libre', { versionAttendue: b.version, detail: 'Nettoyage fictif confirmé' });
    // Les transitions vers libre restent contrôlées par le moteur métier.
  } else if (ev.evenement === 'transfert') {
    r = await terrain.transfererDemande(pool, u, await chercher('demande', b.demande), { destination_id: await chercher('etablissement', b.destination), urgent: b.urgent }, c);
    await lier(c, con, u, 'transfert', b.transfert, r.id);
  } else if (['transfert_etape', 'reception'].includes(ev.evenement)) {
    const etape = ev.evenement === 'reception' ? 'reception' : b.etape;
    if (!['accepter', 'refuser', 'chambre_prete', 'transport', 'depart', 'reception'].includes(etape)) throw new ErreurHttp(400, 'simulation_evenement_invalide');
    r = await services.avancerTransfert(pool, u, await chercher('transfert', b.transfert), etape, { motif: b.motif, motif_code: b.motif_code }, c);
  }
  return Object.fromEntries(['id', 'statut', 'etat', 'version', 'priorite_version', 'numero', 'deja_admise'].filter((k) => r?.[k] !== undefined).map((k) => [k, r[k]]));
}
async function recevoir(pool, u, con, entree) {
  exigerSimulation(u, con); const ev = normaliser(entree); const hash = empreinte(ev);
  return transaction(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`arrimo-connecteur:${con.id}`]);
    await verifierActif(c, con);
    const ancien = (await c.query('SELECT * FROM connecteurs_simulation_evenements WHERE connecteur_id=$1 AND identifiant=$2 FOR UPDATE', [con.id, ev.identifiant])).rows[0];
    if (ancien && ancien.acteur_id !== u.id) throw new ErreurHttp(403, 'simulation_acteur_conflit');
    if (ancien && ancien.empreinte !== hash) {
      await regles.journaliser(c, { etablissementId: con.etablissement_id, utilisateurId: u.id, action: 'Conflit de simulation', refuse: true, detail: JSON.stringify({ connecteur_id: con.id, identifiant: ev.identifiant, code: 'simulation_identifiant_conflit' }) });
      return { statut: 'conflit', code: 'simulation_identifiant_conflit', http_status: 409 };
    }
    if (ancien?.statut === 'applique') return { statut: 'deja_recu', resultat: ancien.resultat, http_status: 200 };
    if (!ancien) await c.query(`INSERT INTO connecteurs_simulation_evenements(connecteur_id,identifiant,flux,sequence,empreinte,evenement,donnees,acteur_id,date_source,statut)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'en_attente')`, [con.id, ev.identifiant, ev.flux, ev.sequence, hash, ev.evenement, ev, u.id, ev.date_source]);
    else await c.query('UPDATE connecteurs_simulation_evenements SET tentatives=tentatives+1,dernier_essai_le=now() WHERE connecteur_id=$1 AND identifiant=$2', [con.id, ev.identifiant]);
    await c.query('INSERT INTO connecteurs_simulation_flux(connecteur_id,flux) VALUES($1,$2) ON CONFLICT DO NOTHING', [con.id, ev.flux]);
    const flux = (await c.query('SELECT derniere_sequence,derniere_date_source FROM connecteurs_simulation_flux WHERE connecteur_id=$1 AND flux=$2 FOR UPDATE', [con.id, ev.flux])).rows[0];
    const attendue = Number(flux.derniere_sequence) + 1;
    let statut; let code; let resultat = null; let http = 409;
    if (ev.sequence > attendue) { statut = 'en_attente'; code = 'simulation_predecesseur_absent'; }
    else if (ev.sequence < attendue) { statut = 'conflit'; code = 'simulation_sequence_perimee'; }
    else if (flux.derniere_date_source && new Date(ev.date_source) < new Date(flux.derniere_date_source)) { statut = 'conflit'; code = 'simulation_source_perimee'; }
    else {
      await c.query('SAVEPOINT simulation_metier');
      try { resultat = await appliquer(c, pool, u, con, ev); statut = 'applique'; }
      catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT simulation_metier');
        if (!e.statut || e.statut >= 500) throw e;
        code = e.code || 'simulation_evenement_invalide';
        http = e.statut;
        statut = code === 'simulation_correspondance_absente' ? 'en_attente' : e.statut === 409 ? 'conflit' : 'rejete';
      }
      await c.query('RELEASE SAVEPOINT simulation_metier');
    }
    if (statut === 'applique') await c.query('UPDATE connecteurs_simulation_flux SET derniere_sequence=$3,derniere_date_source=$4 WHERE connecteur_id=$1 AND flux=$2', [con.id, ev.flux, ev.sequence, ev.date_source]);
    await c.query(`UPDATE connecteurs_simulation_evenements SET statut=$3,detail=$4,resultat=$5,
      traite_le=CASE WHEN $3='applique' THEN now() ELSE NULL END WHERE connecteur_id=$1 AND identifiant=$2`, [con.id, ev.identifiant, statut, code || null, resultat]);
    await regles.journaliser(c, { etablissementId: con.etablissement_id, utilisateurId: u.id, action: 'Événement hospitalier simulé', refuse: statut === 'rejete' || statut === 'conflit',
      detail: JSON.stringify({ connecteur_id: con.id, identifiant: ev.identifiant, evenement: ev.evenement, flux: ev.flux, sequence: ev.sequence, date_source: ev.date_source, statut, code }) });
    return { statut, code, resultat, sequence_attendue: statut === 'applique' ? attendue + 1 : attendue, date_source: ev.date_source, http_status: statut === 'applique' ? 200 : statut === 'en_attente' ? 202 : http };
  });
}
async function supervision(pool, u, etab) {
  exigerEtablissement(u, etab);
  if (!['coordonnateur', 'admin_etab', 'gestionnaire'].includes(u.role)) throw new ErreurHttp(403, 'simulation_interdite');
  const r = await pool.query(`SELECT c.id,c.nom,count(e.*) FILTER(WHERE e.statut='applique')::int AS appliques,
    count(e.*) FILTER(WHERE e.statut='en_attente')::int AS en_attente,count(e.*) FILTER(WHERE e.statut IN ('conflit','rejete'))::int AS a_verifier,
    max(e.date_source) FILTER(WHERE e.statut='applique') AS derniere_date_source,max(e.traite_le) AS dernier_traitement
    FROM connecteurs c JOIN connecteurs_simulation_config s ON s.connecteur_id=c.id
    LEFT JOIN connecteurs_simulation_evenements e ON e.connecteur_id=c.id WHERE c.etablissement_id=$1 GROUP BY c.id ORDER BY c.id`, [etab]);
  return { lu_le: new Date().toISOString(), connecteurs: r.rows, simulation: true };
}
async function journal(pool, u, con) {
  exigerSimulation(u, con);
  return (await pool.query(`SELECT identifiant,flux,sequence,evenement,acteur_id,date_source,recu_le,dernier_essai_le,traite_le,tentatives,statut,detail
    FROM connecteurs_simulation_evenements WHERE connecteur_id=$1 ORDER BY recu_le DESC,identifiant LIMIT 100`, [con.id])).rows;
}
module.exports = { normaliser, empreinte, dateUTC, reference, exigerSimulation, configurer, correspondance, recevoir, appliquer, supervision, journal };
