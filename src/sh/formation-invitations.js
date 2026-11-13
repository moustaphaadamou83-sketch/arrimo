'use strict';
/**
 * Formation : comment le client et les participants l'apprennent.
 *  - Rôles formés (contenus, objectifs, prérequis, comptes Arrimo correspondants), y compris CHSLD et résidences, ambulance et CCS.
 *  - Invitation de calendrier (.ics, RFC 5545) : même UID pour toute la vie de la séance ; SEQUENCE augmente à chaque report
 *    ou annulation, donc le calendrier du participant met à jour (ou retire) l'événement au lieu d'en créer un second.
 *  - File d'envoi (sh_formation_courriels) avec reprises, comme les courriels du support ; rien n'est envoyé sans SMTP configuré.
 *  - Lien de réponse à usage unique pour chaque participant (jeton aléatoire ; seule son empreinte est conservée ;
 *    expire au début de la séance) : je serai présent, je propose un autre moment, je ne pourrai pas venir.
 * Aucune donnée de patient ni de résident n'est jamais incluse.
 */
const crypto = require('node:crypto');
const { transaction } = require('../db');
const courriel = require('../courriel');

const ROLES = {
  coordination: { libelle: 'Coordination des lits', comptes: ['coordonnateur'],
    objectifs: 'Lire la capacité, confirmer les lits, gérer la file d’admission, les congés et les transferts ; utiliser OG (propose, vous décidez).',
    prerequis: 'Compte Arrimo actif ; poste ou tablette avec un navigateur récent.' },
  urgence: { libelle: 'Urgence et civières', comptes: ['coordonnateur'],
    objectifs: 'Suivre les civières, les durées de séjour (> 24 h, > 48 h), demander un lit et suivre les préalertes ambulancières.',
    prerequis: 'Compte Arrimo actif.' },
  entretien: { libelle: 'Entretien (nettoyage des lits)', comptes: ['entretien'],
    objectifs: 'Prendre un lit à nettoyer, signaler la fin du nettoyage, comprendre les priorités.', prerequis: 'Tablette ou téléphone de l’unité.' },
  administration: { libelle: 'Administration de l’établissement', comptes: ['admin_etab'],
    objectifs: 'Gérer les comptes et les rôles, la structure (unités, chambres, lits), la double authentification et le journal.',
    prerequis: 'Compte administrateur ; liste des personnes à créer.' },
  chsld: { libelle: 'Coordination CHSLD et résidences (RPA, RI, RTF)', comptes: ['coordonnateur', 'equipe_soins'],
    objectifs: 'Suivre les résidents, préparer un départ vers l’hôpital, demander un transport, accueillir un retour, tenir les proches informés.',
    prerequis: 'Compte Arrimo actif ; liste des chambres à jour.' },
  paramedic: { libelle: 'Équipe ambulancière (Arrimo Ambulance)', comptes: ['paramedic'],
    objectifs: 'Choisir son véhicule, envoyer une préalerte, suivre la réponse de l’hôpital, signaler l’arrivée, gérer les transports demandés.',
    prerequis: 'Téléphone ou tablette du véhicule ; application installée depuis le navigateur.' },
  superviseur_secours: { libelle: 'Supervision ambulancière', comptes: ['superviseur_secours'],
    objectifs: 'Suivre les unités et les préalertes, répartir les transports demandés par les établissements, lire les indicateurs.',
    prerequis: 'Compte Arrimo actif.' },
  repartiteur: { libelle: 'Répartition (CCS)', comptes: ['repartiteur'],
    objectifs: 'Vue régionale des préalertes et des disponibilités déclarées des urgences, demandes de transport, coordination avec les hôpitaux.',
    prerequis: 'Compte Arrimo actif ; poste du centre de communication.' },
};
const ROLES_FORMATION = Object.keys(ROLES);

const empreinte = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------------------------------------------------------------- calendrier (.ics) */
const echapper = (t) => String(t ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const dateIcs = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Pliage à 75 octets (RFC 5545 §3.1), sans couper un caractère UTF-8. */
function plier(ligne) {
  const out = []; let cur = ''; let octets = 0;
  for (const ch of ligne) {
    const n = Buffer.byteLength(ch);
    if (octets + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; octets = 0; }
    cur += ch; octets += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
function expediteur(env) {
  const m = String(env.COURRIEL_EXPEDITEUR || '').match(/<([^>]+)>/) || String(env.COURRIEL_EXPEDITEUR || '').match(/(\S+@\S+)/);
  return m ? m[1] : 'no-reply@arrimo.invalid';
}
/** Invitation (REQUEST) ou annulation (CANCEL) d'une séance. */
function ics(s, { methode = 'REQUEST', destinataire, env = process.env, maintenant = new Date() } = {}) {
  const fin = new Date(new Date(s.debut).getTime() + Number(s.duree_minutes || 90) * 60000);
  const description = [s.objectifs && `Objectifs : ${s.objectifs}`, s.prerequis && `Prérequis : ${s.prerequis}`, s.visio_url && `Visio : ${s.visio_url}`,
    'Formation Arrimo. Aucune donnée de patient.'].filter(Boolean).join('\n');
  const lignes = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Arrimo//Console SH//FR', 'CALSCALE:GREGORIAN', `METHOD:${methode}`, 'BEGIN:VEVENT',
    `UID:formation-${s.uid}@arrimo`, `SEQUENCE:${Number(s.sequence) || 0}`, `DTSTAMP:${dateIcs(maintenant)}`, `DTSTART:${dateIcs(s.debut)}`, `DTEND:${dateIcs(fin)}`,
    `SUMMARY:${echapper(s.titre)}`, ...(s.lieu || s.visio_url ? [`LOCATION:${echapper(s.lieu || s.visio_url)}`] : []), `DESCRIPTION:${echapper(description)}`,
    ...(s.visio_url ? [`URL:${echapper(s.visio_url)}`] : []),
    `ORGANIZER;CN=Arrimo:mailto:${expediteur(env)}`, ...(destinataire ? [`ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${destinataire}`] : []),
    `STATUS:${methode === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`, 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR'];
  return lignes.map(plier).join('\r\n') + '\r\n';
}

/** Date lisible dans le fuseau de l'établissement client. */
function quand(debut, fuseau) {
  const tz = fuseau || 'America/Toronto';
  try {
    return `${new Intl.DateTimeFormat('fr-CA', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(new Date(debut))} (heure de ${tz.split('/').pop().replace(/_/g, ' ')})`;
  } catch { return new Date(debut).toISOString(); }
}

/* ---------------------------------------------------------------- file d'envoi */
/** Destinataires d'un événement : participants avec courriel (ou un seul) et contacts « formation » du client (sinon « général »). */
async function planifier(c, sessionId, evenement, { participantId = null } = {}) {
  const s = (await c.query('SELECT id, hopital_id, sequence FROM sh_formation_sessions WHERE id=$1', [sessionId])).rows[0];
  if (!s) return 0;
  // Un envoi plus récent remplace les courriels encore en attente de la même séance (et du même participant).
  await c.query(`UPDATE sh_formation_courriels SET etat='remplace', verrou_jusqua=NULL WHERE session_id=$1 AND etat='en_attente' AND ($2::bigint IS NULL OR participant_id=$2)`, [s.id, participantId]);
  const participants = (await c.query(`SELECT id, lower(courriel) courriel FROM sh_formation_participants WHERE session_id=$1 AND courriel IS NOT NULL
    AND ($2::bigint IS NULL OR id=$2) AND (reponse <> 'decline' OR $3 = 'annulation')`, [s.id, participantId, evenement])).rows;
  let contacts = [];
  if (!participantId) {
    const tous = (await c.query("SELECT lower(courriel) courriel, lower(categorie) categorie FROM sh_contacts WHERE hopital_id=$1 AND courriel IS NOT NULL", [s.hopital_id])).rows;
    contacts = tous.filter((x) => x.categorie === 'formation');
    if (!contacts.length) contacts = tous.filter((x) => ['general', 'général', 'principal'].includes(x.categorie));
  }
  const vus = new Set(); let n = 0;
  for (const x of [...participants.map((p) => ({ ...p, participant: p.id })), ...contacts.map((p) => ({ ...p, participant: null }))]) {
    if (!x.courriel || !EMAIL.test(x.courriel) || x.courriel.length > 254 || vus.has(x.courriel)) continue;
    vus.add(x.courriel);
    await c.query('INSERT INTO sh_formation_courriels(session_id, participant_id, destinataire, evenement, sequence, cle) VALUES($1,$2,$3,$4,$5,$6)',
      [s.id, x.participant, x.courriel, evenement, s.sequence, crypto.randomUUID()]);
    n += 1;
  }
  return n;
}

const SUJETS = { invitation: 'Invitation', modification: 'Mise à jour', annulation: 'Annulation' };
function corps(s, x, lien) {
  const r = ROLES[s.role];
  const l = [
    x.evenement === 'annulation' ? `La séance de formation Arrimo « ${s.titre} » est annulée.${s.annulation_motif ? `\nMotif : ${s.annulation_motif}` : ''}`
      : x.evenement === 'modification' ? `La séance de formation Arrimo « ${s.titre} » a été modifiée. Voici les informations à jour.` : `Invitation à une séance de formation Arrimo : « ${s.titre} ».`,
    '', `Établissement : ${s.hopital}`, `Date : ${quand(s.debut, s.fuseau_horaire)}`, `Durée : ${s.duree_minutes} minutes`,
    ...(s.lieu ? [`Lieu : ${s.lieu}`] : []), ...(s.visio_url ? [`Visio : ${s.visio_url}`] : []), ...(s.formateur ? [`Formateur : ${s.formateur}`] : []),
    ...(r ? [`Public : ${r.libelle}`] : []),
  ];
  if (x.evenement !== 'annulation') {
    if (s.objectifs || r?.objectifs) l.push('', `Objectifs : ${s.objectifs || r.objectifs}`);
    if (s.prerequis || r?.prerequis) l.push(`Prérequis : ${s.prerequis || r.prerequis}`);
    l.push('', 'L’invitation de calendrier est jointe : ouvrez-la pour ajouter la séance à votre agenda.');
    if (lien) l.push('', 'Merci de confirmer votre présence (lien personnel, à usage unique) :', lien);
  } else l.push('', 'Le fichier joint retire la séance de votre agenda.');
  l.push('', 'Arrimo · aucune donnée de patient n’est incluse dans ce courriel.');
  return l.join('\n');
}

async function executer(pool, { env = process.env, limite = 30 } = {}) {
  if (!courriel.actif(env.SH_PUBLIC_URL, env)) return { actif: false, envoyes: 0, echecs: 0 };
  const lignes = await transaction(pool, async (c) => {
    const rows = (await c.query(`SELECT m.* FROM sh_formation_courriels m WHERE (m.etat='en_attente' AND m.prochaine_tentative<=now()) OR (m.etat='envoi' AND m.verrou_jusqua<now())
      ORDER BY m.id FOR UPDATE SKIP LOCKED LIMIT $1`, [Math.max(1, Math.min(100, limite))])).rows;
    for (const x of rows) await c.query("UPDATE sh_formation_courriels SET etat='envoi', tentatives=tentatives+1, verrou_jusqua=now()+interval '2 minutes' WHERE id=$1", [x.id]);
    return rows;
  });
  let envoyes = 0, echecs = 0;
  for (const x of lignes) {
    try {
      const s = (await pool.query(`SELECT s.*, h.nom hopital, h.fuseau_horaire, u.nom formateur FROM sh_formation_sessions s JOIN hopitaux h ON h.id=s.hopital_id
        LEFT JOIN sh_utilisateurs u ON u.id=s.formateur_id WHERE s.id=$1`, [x.session_id])).rows[0];
      // Une invitation devenue sans objet (séance annulée entre-temps, déjà passée) n'est pas envoyée.
      if (!s || (x.evenement !== 'annulation' && (s.statut !== 'planifiee' || new Date(s.debut) < new Date()))) {
        await pool.query("UPDATE sh_formation_courriels SET etat='remplace', verrou_jusqua=NULL WHERE id=$1", [x.id]); continue;
      }
      let lien = null;
      if (x.participant_id && x.evenement !== 'annulation' && env.SH_PUBLIC_URL) {
        const jeton = crypto.randomBytes(32).toString('base64url');
        const r = await pool.query("UPDATE sh_formation_participants SET jeton_hache=$2, jeton_expire=$3 WHERE id=$1 AND reponse <> 'decline'", [x.participant_id, empreinte(jeton), s.debut]);
        if (r.rowCount) lien = `${env.SH_PUBLIC_URL.replace(/\/$/, '')}/formation-reponse.html#jeton=${jeton}`;
      }
      await courriel.envoyer({ a: x.destinataire, sujet: `Arrimo · ${SUJETS[x.evenement]} : ${s.titre}`, texte: corps(s, x, lien),
        ics: { methode: x.evenement === 'annulation' ? 'CANCEL' : 'REQUEST', contenu: ics(s, { methode: x.evenement === 'annulation' ? 'CANCEL' : 'REQUEST', destinataire: x.destinataire, env }) } }, env);
      await pool.query("UPDATE sh_formation_courriels SET etat='envoye', envoye_le=now(), verrou_jusqua=NULL, dernier_code=NULL WHERE id=$1", [x.id]); envoyes += 1;
    } catch (e) {
      const tentatives = (await pool.query('SELECT tentatives FROM sh_formation_courriels WHERE id=$1', [x.id])).rows[0]?.tentatives || 1;
      const code = String(e.code || e.name || 'ERREUR').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'ERREUR';
      await pool.query('UPDATE sh_formation_courriels SET etat=$2, verrou_jusqua=NULL, prochaine_tentative=now()+make_interval(secs=>$3::int), dernier_code=$4 WHERE id=$1',
        [x.id, tentatives >= 8 ? 'abandonne' : 'en_attente', Math.min(21600, 30 * 2 ** Math.min(tentatives - 1, 10)), code]); echecs += 1;
    }
  }
  return { actif: true, envoyes, echecs };
}

/* ---------------------------------------------------------------- réponse du participant (page publique) */
const REPONSES = ['confirme', 'autre_moment', 'decline'];
async function participantParJeton(db, jeton, verrou = '') {
  if (typeof jeton !== 'string' || !/^[A-Za-z0-9_-]{30,80}$/.test(jeton)) return null;
  return (await db.query(`SELECT p.id, p.nom, p.reponse, p.session_id, s.titre, s.debut, s.duree_minutes, s.lieu, s.visio_url, s.statut, s.formateur_id, s.hopital_id,
      h.nom hopital, h.fuseau_horaire FROM sh_formation_participants p JOIN sh_formation_sessions s ON s.id=p.session_id JOIN hopitaux h ON h.id=s.hopital_id
    WHERE p.jeton_hache=$1 AND p.jeton_expire > now() AND s.statut='planifiee' ${verrou}`, [empreinte(jeton)])).rows[0] || null;
}
const lienInvalide = () => Object.assign(new Error('Ce lien n’est plus valide (déjà utilisé, expiré ou séance modifiée). Demandez une nouvelle invitation à votre formateur.'), { statut: 410 });

function brancherPublic(api, pool, { notifier, journal }) {
  api.post('/formation-reponse/lire', async (req, res, next) => {
    try {
      const p = await participantParJeton(pool, req.body?.jeton);
      if (!p) throw lienInvalide();
      res.json({ titre: p.titre, etablissement: p.hopital, quand: quand(p.debut, p.fuseau_horaire), duree_minutes: p.duree_minutes, lieu: p.lieu, visio_url: p.visio_url, nom: p.nom, reponse: p.reponse });
    } catch (e) { next(e); }
  });
  api.post('/formation-reponse/repondre', async (req, res, next) => {
    try {
      const reponse = REPONSES.includes(req.body?.reponse) ? req.body.reponse : null;
      if (!reponse) throw Object.assign(new Error('Réponse invalide.'), { statut: 400 });
      const note = String(req.body?.note || '').trim().slice(0, 500) || null;
      if (reponse === 'autre_moment' && !note) throw Object.assign(new Error('Indiquez le ou les moments qui vous conviendraient.'), { statut: 400 });
      const r = await transaction(pool, async (c) => {
        const p = await participantParJeton(c, req.body?.jeton, 'FOR UPDATE OF p');
        if (!p) throw lienInvalide();
        // Usage unique : le jeton est effacé dès la réponse enregistrée.
        await c.query('UPDATE sh_formation_participants SET reponse=$2, reponse_le=now(), reponse_note=$3, jeton_hache=NULL, jeton_expire=NULL WHERE id=$1', [p.id, reponse, note]);
        const libelle = { confirme: 'présence confirmée', autre_moment: 'propose un autre moment', decline: 'ne pourra pas venir' }[reponse];
        await journal(c, null, 'Réponse à une invitation de formation', `${p.titre} · ${p.nom}`, libelle, p.hopital_id);
        return { ok: true, reponse, avis: p.formateur_id ? { id: p.formateur_id, hopital: p.hopital_id, titre: `Formation « ${p.titre} » : ${p.nom} ${libelle}` } : null };
      });
      // Avis au formateur, hors transaction : un échec de notification n'annule pas la réponse enregistrée.
      if (r.avis) await notifier(pool, r.avis.id, { ressourceType: 'hopital', ressourceId: r.avis.hopital, type: 'formation', titre: r.avis.titre, lien: 'calendrier' }).catch(() => {});
      res.json({ ok: true, reponse: r.reponse });
    } catch (e) { next(e); }
  });
}

module.exports = { ROLES, ROLES_FORMATION, ics, quand, planifier, executer, brancherPublic, empreinte };
