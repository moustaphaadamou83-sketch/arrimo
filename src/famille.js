'use strict';
/**
 * Coordination Famille : demandes pratiques transformées en tâches, confirmations, visites par créneaux, journal de vie,
 * réglages par établissement, tableau de bord et relances. Données fictives (le portail reste limité à la démo et à la recette).
 * Aucune donnée clinique : une demande médicale urgente relève des circuits d'urgence, jamais de ce flux administratif.
 */
const { ErreurHttp, transaction } = require('./db');
const ch = require('./chsld');
const notifs = require('./portail-notifications');

const CATEGORIES_DEMANDE = ['vetements', 'lunettes', 'effets_personnels', 'objet_oublie', 'rencontre', 'administratif', 'autre'];
const STATUTS_DEMANDE = ['nouvelle', 'recue', 'attribuee', 'en_cours', 'attente_information', 'attente_proche', 'resolue', 'refusee', 'annulee', 'cloturee'];
const FINAUX = ['resolue', 'refusee', 'annulee', 'cloturee'];
const GESTION = ['coordonnateur', 'admin_etab', 'gestionnaire', 'equipe_soins'];
const DEFAUT = { delai_heures: 48, relances_max: 2, journal_vie: false, visites_creneaux: false };
const texte = (v, max, requis = false) => { if (v !== undefined && v !== null && typeof v !== 'string') throw new ErreurHttp(400, 'demande_invalide'); const s = String(v ?? '').trim(); if ((requis && !s) || s.length > max) throw new ErreurHttp(400, 'demande_invalide'); return s || null; };
const exigerCategorie = (p, cat) => { if (!p.autorisations.includes(cat)) throw new ErreurHttp(403, 'proche_non_autorise', { categorie: cat }); };

async function reglages(db, etabId) {
  const r = (await db.query('SELECT famille_config FROM etablissements WHERE id = $1', [etabId])).rows[0];
  return { ...DEFAUT, ...(r?.famille_config || {}) };
}
async function historiser(c, demandeId, statut, par, note) {
  await c.query('INSERT INTO demandes_famille_historique (demande_id, statut, par_utilisateur, note) VALUES ($1, $2, $3, $4)', [demandeId, statut, par || null, note || null]);
}

/* ---------------------------------------------------------------- côté proche */
async function creerDemande(pool, p, b) {
  exigerCategorie(p, 'administratif');
  if (!CATEGORIES_DEMANDE.includes(b?.categorie)) throw new ErreurHttp(400, 'demande_invalide');
  const t = texte(b.texte, 1000, true);
  const cfg = await reglages(pool, p.etablissement_id);
  return transaction(pool, async (c) => {
    const d = (await c.query(`INSERT INTO demandes_famille (etablissement_id, resident_id, contact_id, categorie, texte, statut, echeance)
      VALUES ($1, $2, $3, $4, $5, 'nouvelle', now() + make_interval(hours => $6)) RETURNING *`, [p.etablissement_id, p.resident_id, p.contact_id, b.categorie, t, cfg.delai_heures])).rows[0];
    // Tâche créée d'office pour la coordination : la demande ne se perd jamais dans une boîte de messages
    const tache = (await c.query(`INSERT INTO taches_etab (etablissement_id, type, titre, resident_id, assigne_role, echeance) VALUES ($1, 'demande_famille', $2, $3, 'coordonnateur', $4) RETURNING id`,
      [p.etablissement_id, `Demande de famille n° ${d.id} (${b.categorie})`, p.resident_id, d.echeance])).rows[0];
    await c.query('UPDATE demandes_famille SET tache_id = $2 WHERE id = $1', [d.id, tache.id]);
    await historiser(c, d.id, 'nouvelle', null, 'Créée par le proche');
    return { id: d.id, categorie: d.categorie, statut: d.statut, cree_le: d.cree_le, echeance: d.echeance };
  });
}
async function demandesProche(pool, p) {
  return (await pool.query(`SELECT d.id, d.categorie, d.texte, d.statut, d.reponse, d.cree_le, d.modifie_le FROM demandes_famille d
    WHERE d.resident_id = $1 AND d.contact_id = $2 ORDER BY d.cree_le DESC LIMIT 50`, [p.resident_id, p.contact_id])).rows;
}
async function annulerDemande(pool, p, id) {
  return transaction(pool, async (c) => {
    const d = (await c.query('SELECT * FROM demandes_famille WHERE id = $1 AND resident_id = $2 AND contact_id = $3 FOR UPDATE', [id, p.resident_id, p.contact_id])).rows[0];
    if (!d) throw new ErreurHttp(404, 'demande_introuvable');
    if (FINAUX.includes(d.statut)) throw new ErreurHttp(409, 'demande_close');
    await c.query(`UPDATE demandes_famille SET statut = 'annulee', modifie_le = now() WHERE id = $1`, [id]);
    if (d.tache_id) await c.query(`UPDATE taches_etab SET statut = 'annulee', version = version + 1 WHERE id = $1 AND statut IN ('a_faire', 'en_cours')`, [d.tache_id]);
    await historiser(c, id, 'annulee', null, 'Annulée par le proche');
    return { id, statut: 'annulee' };
  });
}
async function confirmationsProche(pool, p) {
  const { rows } = await pool.query(`SELECT id, sujet, explication, echeance, statut, reponse, repondu_le, cree_le FROM confirmations_famille
    WHERE resident_id = $1 AND contact_id = $2 ORDER BY cree_le DESC LIMIT 30`, [p.resident_id, p.contact_id]);
  await pool.query(`UPDATE confirmations_famille SET vue_le = now() WHERE resident_id = $1 AND contact_id = $2 AND vue_le IS NULL`, [p.resident_id, p.contact_id]);
  return rows;
}
async function repondreConfirmation(pool, p, id, b) {
  if (!['confirmee', 'indisponible', 'precisions'].includes(b?.reponse)) throw new ErreurHttp(400, 'confirmation_invalide');
  const precision = texte(b.precision, 500);
  const n = (await pool.query(`UPDATE confirmations_famille SET statut = $4, reponse = $5, repondu_le = now(), vue_le = COALESCE(vue_le, now())
    WHERE id = $1 AND resident_id = $2 AND contact_id = $3 AND statut = 'en_attente' AND (echeance IS NULL OR echeance > now()) RETURNING id, statut, repondu_le, etablissement_id`, [id, p.resident_id, p.contact_id, b.reponse, precision])).rows[0];
  if (!n) throw new ErreurHttp(409, 'confirmation_close');
  await require('./services').notifier(pool, n.etablissement_id, null, 'famille_confirmation', { n: id });
  return { id: n.id, statut: n.statut, repondu_le: n.repondu_le };
}
async function creneauxProche(pool, p) {
  return (await pool.query(`SELECT c.id, c.debut, c.fin, c.capacite, c.capacite - (SELECT count(*)::int FROM demandes_visite v WHERE v.creneau_id = c.id AND v.statut IN ('demandee', 'acceptee')) AS places
    FROM visites_creneaux c WHERE c.etablissement_id = $1 AND c.actif AND c.debut > now() ORDER BY c.debut LIMIT 50`, [p.etablissement_id])).rows;
}
/** Visite sur un créneau : capacité revérifiée sous verrou, jamais de double réservation au-delà de la capacité. */
async function reserverCreneau(pool, p, b) {
  exigerCategorie(p, 'rendez_vous');
  const participants = Number(b?.participants ?? 1);
  if (!Number.isInteger(participants) || participants < 1 || participants > 6) throw new ErreurHttp(400, 'visite_invalide');
  return transaction(pool, async (c) => {
    const cr = (await c.query('SELECT * FROM visites_creneaux WHERE id = $1 AND etablissement_id = $2 AND actif AND debut > now() FOR UPDATE', [Number(b.creneau_id), p.etablissement_id])).rows[0];
    if (!cr) throw new ErreurHttp(404, 'creneau_introuvable');
    const pris = (await c.query(`SELECT count(*)::int n FROM demandes_visite WHERE creneau_id = $1 AND statut IN ('demandee', 'acceptee')`, [cr.id])).rows[0].n;
    if (pris >= cr.capacite) throw new ErreurHttp(409, 'creneau_complet');
    if ((await c.query(`SELECT 1 FROM demandes_visite WHERE creneau_id = $1 AND contact_id = $2 AND statut IN ('demandee', 'acceptee')`, [cr.id, p.contact_id])).rowCount) throw new ErreurHttp(409, 'visite_deja_demandee');
    return (await c.query(`INSERT INTO demandes_visite (etablissement_id, resident_id, contact_id, souhaitee_le, creneau_id, participants) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, souhaitee_le, statut`,
      [p.etablissement_id, p.resident_id, p.contact_id, cr.debut, cr.id, participants])).rows[0];
  });
}
async function annulerVisite(pool, p, id) {
  const n = (await pool.query(`UPDATE demandes_visite SET statut = 'annulee', traite_le = now() WHERE id = $1 AND resident_id = $2 AND contact_id = $3 AND statut IN ('demandee', 'acceptee') AND souhaitee_le > now() RETURNING id, statut`, [id, p.resident_id, p.contact_id])).rows[0];
  if (!n) throw new ErreurHttp(409, 'visite_deja_traitee');
  return n;
}
async function journalVieProche(pool, p) {
  if (!(await reglages(pool, p.etablissement_id)).journal_vie || !p.autorisations.includes('hebergement')) return { actif: false, publications: [] };
  return { actif: true, publications: (await pool.query(`SELECT id, titre, texte, publie_le FROM journal_vie WHERE etablissement_id = $1 AND statut = 'publie' AND (resident_id IS NULL OR resident_id = $2) ORDER BY publie_le DESC LIMIT 30`, [p.etablissement_id, p.resident_id])).rows };
}
/**
 * OG Famille : répond à toute question d'un proche, à partir des seules données de ce proche et dans ses autorisations.
 * Jamais de santé, jamais d'information inventée, jamais d'action sans confirmation ; sinon il propose d'écrire à l'établissement.
 */
const NORM = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'`\-]/g, ' ').replace(/\s+/g, ' ').trim();
async function og(pool, p, b) {
  const q = NORM(b?.question).slice(0, 500);
  if (!q) throw new ErreurHttp(400, 'question_invalide');
  const en = b?.langue === 'en'; const T = (fr, an) => (en ? an : fr);
  const dt = (d) => (d ? new Date(d).toLocaleString(en ? 'en-CA' : 'fr-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' }) : '');
  const has = (re) => re.test(q); const cats = p.autorisations; const peut = (c) => cats.includes(c);
  const rep = (reponse, sujet, extra = {}) => ({ reponse, sujet, ...extra });
  const nom = p.r_prenom; const etab = p.etab_nom;
  const pasAutorise = (c) => rep(T(`Votre accès ne comprend pas cette information (« ${c} »). L’établissement peut élargir vos autorisations : écrivez-lui dans « Messages ».`, `Your access does not include this information (“${c}”). The facility can extend your permissions: write to it in “Messages”.`), 'autorisation');
  // Urgence : jamais par le portail
  if (has(/\b(urgen\w*|emergency|911|ambulance|chute|tombe|fell|ne respire|malaise|inconscient|unconscious|suicid)/)) {
    return rep(T('En cas d’urgence, appelez immédiatement le 911. Le portail n’est pas surveillé en continu et ne sert pas aux urgences.', 'In an emergency, call 911 right away. The portal is not monitored around the clock and is not for emergencies.'), 'urgence');
  }
  // Santé : jamais d'information clinique ; orienter vers l'équipe de soins
  if (has(/(diagnostic|diagnos|maladie|malade|sante|health|medic|traitement|treatment|symptom|douleur|pain|\ba mal\b|souffre|fievre|fever|covid|grippe|infection|operation|chirurg|surgery|analyse|test sanguin|blood|pression|tension|mange|manger|eat|dort|sleep|comment va|comment il va|comment elle va|how is (he|she|my)|etat de sante|moral|humeur|soins|care plan|plan de soins|docteur|medecin|doctor|nurse|infirmi)/)) {
    return rep(T(`Je ne donne aucune information de santé. Pour l’état de santé de ${nom}, adressez-vous à l’équipe de soins : écrivez dans « Messages » ou demandez un rappel. En cas d’urgence, appelez le 911.`,
      `I give no health information. For ${nom}’s health, contact the care team: write in “Messages” or ask for a call back. In an emergency, call 911.`), 'sante', { proposer_message: true });
  }
  // Notifications, application, compte, langue, confidentialité
  if (has(/(notif|alerte|prevenir|notify|push)/)) return rep(T('Onglet « Plus » → « Activer les notifications ». Elles sont discrètes : ni nom ni détail. Sur iPhone, ajoutez d’abord le portail à l’écran d’accueil.', '“More” tab → “Turn on notifications”. They are discreet: no name or detail. On iPhone, first add the portal to the home screen.'), 'notifications');
  if (has(/(install|application|appli|app\b|ecran d accueil|home screen|telecharg|download)/)) return rep(T('Sur iPhone : Safari → Partager → « Sur l’écran d’accueil ». Sur Android : Chrome → menu ⋮ → « Installer l’application ».', 'On iPhone: Safari → Share → “Add to Home Screen”. On Android: Chrome → ⋮ menu → “Install app”.'), 'application');
  if (has(/(mot de passe|password|connexion|login|compte|account|deconnect|log out|sign out)/)) return rep(T('Pour un mot de passe oublié ou un accès à modifier, demandez à l’établissement : il peut vous renvoyer une invitation. Pour vous déconnecter : onglet « Plus ».', 'For a forgotten password or access change, ask the facility: it can send you a new invitation. To sign out: the “More” tab.'), 'compte');
  if (has(/(anglais|english|francais|french|langue|language|sombre|dark|clair|light|theme)/)) return rep(T('Langue : boutons FR / EN en haut. Apparence claire ou sombre : onglet « Plus » → Paramètres.', 'Language: FR / EN buttons at the top. Light or dark: the “More” tab → Settings.'), 'parametres');
  if (has(/(confidential|vie privee|privacy|donnees|data|qui voit|who sees|securi)/)) return rep(T('Vous ne voyez que ce que l’établissement vous a autorisé à voir. Le portail n’affiche jamais de renseignement médical, de chambre ni de position en temps réel. L’établissement peut retirer votre accès à tout moment.', 'You only see what the facility has authorized. The portal never shows medical information, the room or a real-time location. The facility can remove your access at any time.'), 'confidentialite');
  // Demandes et besoins pratiques
  if (has(/(demande|request|vetement|clothes|habit|lunette|glasses|effets|affaires|belongings|objet|oubli|forgot|besoin|need|apporter|bring|linge|laundry)/)) {
    const d = await demandesProche(pool, p);
    const ouvertes = d.filter((x) => !FINAUX.includes(x.statut));
    if (has(/(comment|how|ou |where|puis je|can i|faire une|signaler|report)/) && !has(/(ou en est|statut|status|traite|handled|reponse|answer)/)) {
      return rep(peut('administratif') ? T('Ouvrez l’onglet « Demandes », choisissez la catégorie (vêtements, lunettes, effets personnels…), décrivez le besoin et envoyez : l’établissement reçoit une tâche suivie et vous voyez son statut.', 'Open the “Requests” tab, choose the category (clothing, glasses, belongings…), describe the need and send it: the facility gets a tracked task and you see its status.') : T('Votre accès ne permet pas de créer une demande. Écrivez à l’établissement dans « Messages ».', 'Your access does not allow requests. Write to the facility in “Messages”.'), 'demandes');
    }
    if (!d.length) return rep(T('Vous n’avez aucune demande. Pour en créer une : onglet « Demandes ».', 'You have no request. To create one: the “Requests” tab.'), 'demandes');
    const st = { nouvelle: T('nouvelle', 'new'), recue: T('reçue', 'received'), attribuee: T('attribuée', 'assigned'), en_cours: T('en cours', 'in progress'), attente_information: T('en attente d’information', 'waiting for information'), attente_proche: T('en attente de votre réponse', 'waiting for you'), resolue: T('résolue', 'resolved'), refusee: T('refusée', 'refused'), annulee: T('annulée', 'cancelled'), cloturee: T('clôturée', 'closed') };
    const liste = (has(/(vetement|clothes|habit)/) ? d.filter((x) => x.categorie === 'vetements') : ouvertes.length ? ouvertes : d).slice(0, 5);
    return rep((liste.length ? liste : d.slice(0, 3)).map((x) => `n° ${x.id} · ${x.categorie} · ${x.statut}${x.reponse ? ` · ${x.reponse}` : ''} (${st[x.statut] || x.statut})`).join('\n'), 'demandes');
  }
  // Où est mon proche, statut, hôpital, transfert, retour
  if (has(/(ou est|ou se trouve|il est ou|elle est ou|ou il est|ou elle est|where is|where s|situation|statut|status|hopital|hospital|hospitalis|transfer|transfert|retour|return|revient|revenu|reviendr|rentr|come back|coming back|arrive|parti|depart|left|chambre|room|present|absent|nouvelles de|news about|suivi|update|des nouvelles|toujours la|toujours au|toujours a |toujours dans|still there|still at|still in|encore la|encore au)/)) {
    if (!peut('hebergement') && !peut('mouvements')) return pasAutorise(T('situation et déplacements', 'situation and movements'));
    const s = await require('./portail-proches').situation(pool, p);
    if (!s) return pasAutorise(T('situation', 'situation'));
    if (has(/(chambre|room|numero de chambre)/) && !has(/(retour|return|rentre)/)) return rep(T('Le portail n’indique jamais le numéro de chambre. L’établissement vous le donnera lors de votre visite.', 'The portal never shows the room number. The facility will give it to you during your visit.'), 'chambre');
    const libelles = {
      present: T(`${nom} est présent(e) à ${etab}.`, `${nom} is at ${etab}.`),
      absence_temporaire: T(`${nom} est en absence temporaire.`, `${nom} is temporarily away.`),
      absent_etablissement: T(`${nom} est absent(e) de l’établissement pour le moment.`, `${nom} is away from the facility for now.`),
      transfert_preparation: T(`Un transfert de ${nom} vers ${s.hopital} est en préparation (demande du ${dt(s.depuis)}). Le départ n’est pas encore confirmé.`, `A transfer of ${nom} to ${s.hopital} is being prepared (requested on ${dt(s.depuis)}). Departure is not confirmed yet.`),
      hospitalise_depart_confirme: T(`${nom} est parti(e) vers ${s.hopital} le ${dt(s.depuis)}. L’arrivée n’est pas encore confirmée par l’hôpital.`, `${nom} left for ${s.hopital} on ${dt(s.depuis)}. Arrival is not yet confirmed by the hospital.`),
      hospitalise_confirme: T(`${nom} est hospitalisé(e) à ${s.hopital} ; arrivée confirmée le ${dt(s.depuis)}.`, `${nom} is in hospital at ${s.hopital}; arrival confirmed on ${dt(s.depuis)}.`),
      transfert_entre_hopitaux: T(`${nom} est en transfert vers ${s.hopital} ; départ confirmé le ${dt(s.depuis)}.`, `${nom} is being transferred to ${s.hopital}; departure confirmed on ${dt(s.depuis)}.`),
      retour_en_route: T(`${nom} est en route vers ${etab} ; départ de l’hôpital confirmé le ${dt(s.depuis)}.`, `${nom} is on the way to ${etab}; hospital departure confirmed on ${dt(s.depuis)}.`),
      arrivee_confirmee: T(`${nom} est arrivé(e) à ${etab} le ${dt(s.depuis)} ; le retour dans sa chambre reste à confirmer.`, `${nom} arrived at ${etab} on ${dt(s.depuis)}; return to the room is still to be confirmed.`),
      reintegre: T(`${nom} est de retour dans sa chambre depuis le ${dt(s.depuis)}.`, `${nom} has been back in their room since ${dt(s.depuis)}.`),
      autre: T('La situation est en cours de mise à jour par l’établissement.', 'The facility is updating the situation.'),
    };
    let r = libelles[s.statut] || libelles.autre;
    if (s.retour_prevu_le) r += T(` Retour prévu le ${dt(s.retour_prevu_le)} (prévision, pas une confirmation).`, ` Return planned on ${dt(s.retour_prevu_le)} (a plan, not a confirmation).`);
    else if (has(/(retour|return|revient|rentre|come back)/) && ['hospitalise_confirme', 'hospitalise_depart_confirme', 'transfert_entre_hopitaux'].includes(s.statut)) r += T(' Aucune date de retour n’est encore confirmée.', ' No return date is confirmed yet.');
    return rep(`${r}\n${T('Seules les étapes confirmées sont affichées ; ce n’est pas une position en temps réel.', 'Only confirmed steps are shown; this is not a real-time location.')}`, 'situation');
  }
  // Visites
  if (has(/(visit|venir voir|venir le voir|venir la voir|venir les voir|rendre visite|voir mon|voir ma|creneau|slot|horaire|heures de visite|visiting hours|rendez vous|appointment|passer le voir|passer la voir)/)) {
    if (!peut('rendez_vous')) return pasAutorise(T('visites', 'visits'));
    const prochaine = (await pool.query(`SELECT souhaitee_le, statut FROM demandes_visite WHERE resident_id = $1 AND contact_id = $2 AND statut IN ('demandee', 'acceptee') AND souhaitee_le > now() ORDER BY souhaitee_le LIMIT 1`, [p.resident_id, p.contact_id])).rows[0];
    const creneaux = await creneauxProche(pool, p); const libres = creneaux.filter((c) => c.places > 0);
    if (has(/(annul|cancel)/)) return rep(prochaine ? T(`Votre visite du ${dt(prochaine.souhaitee_le)} peut être annulée dans l’onglet « Visites », bouton « Annuler ».`, `Your visit on ${dt(prochaine.souhaitee_le)} can be cancelled in the “Visits” tab with “Cancel”.`) : T('Vous n’avez aucune visite à venir.', 'You have no upcoming visit.'), 'visites');
    let r = prochaine ? T(`Prochaine visite : ${dt(prochaine.souhaitee_le)} (${prochaine.statut === 'acceptee' ? 'confirmée' : 'en attente de confirmation'}).`, `Next visit: ${dt(prochaine.souhaitee_le)} (${prochaine.statut === 'acceptee' ? 'confirmed' : 'awaiting confirmation'}).`) : T('Aucune visite prévue pour l’instant.', 'No visit planned yet.');
    r += libres.length ? T(`\nCréneaux disponibles : ${libres.slice(0, 3).map((c) => dt(c.debut)).join(' ; ')}. Réservez dans l’onglet « Visites ».`, `\nAvailable slots: ${libres.slice(0, 3).map((c) => dt(c.debut)).join('; ')}. Book in the “Visits” tab.`)
      : T('\nAucun créneau n’est proposé : demandez une date dans l’onglet « Visites », l’établissement vous répondra.', '\nNo slot is offered: request a date in the “Visits” tab and the facility will reply.');
    return rep(r, 'visites');
  }
  // Messages
  if (has(/(message|repondu|reponse|answer|replied|ecrit|written|nouvelles du chsld|new messages|courriel|email|contacter|contact|joindre|reach|appeler|call|telephone|phone|rappel|call back|parler a|talk to|qui dois je|who should)/)) {
    const m = (await pool.query(`SELECT texte, cree_le FROM messages_proches WHERE resident_id = $1 AND contact_id = $2 AND sens = 'etablissement' AND categorie = ANY($3) ORDER BY cree_le DESC LIMIT 1`, [p.resident_id, p.contact_id, cats])).rows[0];
    const nl = (await pool.query(`SELECT count(*)::int n FROM messages_proches WHERE resident_id = $1 AND contact_id = $2 AND sens = 'etablissement' AND lu_le IS NULL AND categorie = ANY($3)`, [p.resident_id, p.contact_id, cats])).rows[0].n;
    if (has(/(contacter|contact|joindre|reach|appeler|call|telephone|phone|rappel|call back|parler a|talk to|qui dois je|who should)/)) {
      return rep(T(`Pour joindre ${etab} : onglet « Messages », écrivez votre question, ou touchez « Demander un rappel » pour qu’on vous rappelle. Le portail n’affiche pas de numéro de téléphone. En cas d’urgence, appelez le 911.`, `To reach ${etab}: the “Messages” tab, write your question, or tap “Ask for a call back”. The portal does not show a phone number. In an emergency, call 911.`), 'contact', { proposer_message: true });
    }
    return rep(m ? T(`${nl ? `${nl} nouveau(x) message(s). ` : ''}Dernier message de l’établissement (${dt(m.cree_le)}) : « ${m.texte} »`, `${nl ? `${nl} new message(s). ` : ''}Latest message from the facility (${dt(m.cree_le)}): “${m.texte}”`) : T('Vous n’avez pas encore de message de l’établissement.', 'You have no message from the facility yet.'), 'messages');
  }
  // Confirmations demandées
  if (has(/(confirm|repondre a|attend|waiting for me|ai je quelque chose|anything for me|action|a faire|to do|disponib|available|accompagn)/)) {
    const c = (await pool.query(`SELECT sujet, echeance FROM confirmations_famille WHERE resident_id = $1 AND contact_id = $2 AND statut = 'en_attente' AND (echeance IS NULL OR echeance > now()) ORDER BY cree_le`, [p.resident_id, p.contact_id])).rows;
    return rep(c.length ? T(`L’établissement attend votre réponse à : ${c.map((x) => `« ${x.sujet} »${x.echeance ? ` (avant le ${dt(x.echeance)})` : ''}`).join(' ; ')}. Répondez dans l’onglet « Demandes ».`, `The facility is waiting for your answer to: ${c.map((x) => `“${x.sujet}”${x.echeance ? ` (by ${dt(x.echeance)})` : ''}`).join('; ')}. Answer in the “Requests” tab.`) : T('Rien ne vous est demandé pour l’instant.', 'Nothing is asked of you right now.'), 'confirmations');
  }
  // Activités et vie quotidienne (non médical)
  if (has(/(activit|atelier|animation|sortie|fete|party|event|evenement|journal|vie quotidienne|daily life|que fait|what does|occupe|loisir)/)) {
    const a = (await pool.query(`SELECT titre, debut_le FROM activites_etab WHERE etablissement_id = $1 AND actif AND debut_le >= now() - interval '1 day' ORDER BY debut_le LIMIT 3`, [p.etablissement_id])).rows;
    const j = await journalVieProche(pool, p);
    let r = a.length ? T(`Activités à venir : ${a.map((x) => `${x.titre} (${dt(x.debut_le)})`).join(' ; ')}.`, `Upcoming activities: ${a.map((x) => `${x.titre} (${dt(x.debut_le)})`).join('; ')}.`) : T('Aucune activité annoncée pour l’instant.', 'No activity announced yet.');
    if (j.actif && j.publications.length) r += T(` Dernière nouvelle du journal de vie : « ${j.publications[0].titre} ».`, ` Latest life-journal news: “${j.publications[0].titre}”.`);
    return rep(r, 'activites');
  }
  if (has(/^(merci|thanks|thank you|bonjour|bonsoir|salut|hello|hi|allo)\b/)) return rep(T(`Bonjour ! Je peux vous dire où en est ${nom}, vos visites, vos demandes et vos messages. Que voulez-vous savoir ?`, `Hello! I can tell you how things stand for ${nom}, your visits, your requests and your messages. What would you like to know?`), 'accueil');
  if (has(/(que peux tu|que sais tu|aide|help|what can you|comment ca marche|how does)/)) return rep(T('Je réponds sur : la situation et les étapes confirmées, les visites, vos demandes, vos messages, les confirmations attendues, les activités, les notifications et l’application. Je ne donne aucune information de santé.', 'I answer about: situation and confirmed steps, visits, your requests, your messages, pending confirmations, activities, notifications and the app. I give no health information.'), 'aide');
  // Rien de reconnu : jamais d'invention ; proposition d'envoyer la question à l'établissement
  return rep(T(`Je n’ai pas cette information. Je peux envoyer votre question à ${etab} : l’équipe vous répondra dans « Messages ».`, `I do not have this information. I can send your question to ${etab}: the team will reply in “Messages”.`), 'inconnu', { proposer_message: true });
}

/* ---------------------------------------------------------------- côté personnel */
async function garde(pool, u, etabId) { await ch.etabChsld(pool, u, etabId, { roles: GESTION }); }
async function tableau(pool, u, etabId) {
  await garde(pool, u, etabId);
  const q = (sql) => pool.query(sql, [etabId]).then((r) => r.rows[0]);
  const [demandes, messages, reponse, confirmations, visites, retours] = await Promise.all([
    q(`SELECT count(*) FILTER (WHERE statut NOT IN ('resolue', 'refusee', 'annulee', 'cloturee'))::int ouvertes, count(*) FILTER (WHERE statut NOT IN ('resolue', 'refusee', 'annulee', 'cloturee') AND echeance < now())::int en_retard,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (resolue_le - cree_le)) / 60) FILTER (WHERE resolue_le IS NOT NULL) AS resolution_mediane_min FROM demandes_famille WHERE etablissement_id = $1`),
    q(`SELECT count(*)::int non_traites FROM messages_proches m JOIN residents r ON r.id = m.resident_id WHERE r.etablissement_id = $1 AND m.sens = 'proche' AND m.lu_le IS NULL`),
    q(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (rep.cree_le - m.cree_le)) / 60) AS mediane_min FROM messages_proches m JOIN residents r ON r.id = m.resident_id
       JOIN LATERAL (SELECT min(x.cree_le) cree_le FROM messages_proches x WHERE x.resident_id = m.resident_id AND x.contact_id = m.contact_id AND x.sens = 'etablissement' AND x.cree_le > m.cree_le) rep ON rep.cree_le IS NOT NULL
       WHERE r.etablissement_id = $1 AND m.sens = 'proche' AND m.cree_le > now() - interval '30 days'`),
    q(`SELECT count(*) FILTER (WHERE statut = 'en_attente')::int en_attente FROM confirmations_famille WHERE etablissement_id = $1`),
    q(`SELECT count(*) FILTER (WHERE statut = 'acceptee' AND souhaitee_le::date = now()::date)::int du_jour, count(*) FILTER (WHERE statut = 'demandee')::int a_traiter FROM demandes_visite WHERE etablissement_id = $1`),
    q(`SELECT count(*)::int planifies FROM coordinations WHERE destination_id = $1 AND type = 'retour' AND statut IN ('envoyee', 'acceptee', 'en_cours')`)]);
  const echecs = (await pool.query(`SELECT count(*)::int n FROM proches_notifications_journal j JOIN proches_acces a ON a.id = j.acces_id WHERE a.etablissement_id = $1 AND j.statut = 'echec' AND j.le > now() - interval '7 days'`, [etabId])).rows[0].n;
  return { demandes, messages: { ...messages, premiere_reponse_mediane_min: reponse.mediane_min }, confirmations, visites, retours, notifications_echouees: echecs,
    mesure: 'Chiffres calculés sur les données enregistrées dans Arrimo. Aucun nombre d’appels évités n’est estimé.' };
}
async function demandesEtab(pool, u, etabId) {
  await garde(pool, u, etabId);
  return (await pool.query(`SELECT d.id, d.categorie, d.texte, d.statut, d.reponse, d.note_interne, d.echeance, d.cree_le, d.tache_id, r.reference AS resident_ref, k.prenom, k.nom, (d.echeance < now() AND d.statut NOT IN ('resolue', 'refusee', 'annulee', 'cloturee')) AS en_retard
    FROM demandes_famille d JOIN residents r ON r.id = d.resident_id JOIN resident_contacts k ON k.id = d.contact_id WHERE d.etablissement_id = $1 ORDER BY (d.statut IN ('resolue', 'refusee', 'annulee', 'cloturee')), d.echeance LIMIT 300`, [etabId])).rows;
}
async function majDemande(pool, u, id, b) {
  if (!STATUTS_DEMANDE.includes(b?.statut) || b.statut === 'nouvelle') throw new ErreurHttp(400, 'demande_invalide');
  if (b.statut === 'refusee' && !texte(b.reponse, 500)) throw new ErreurHttp(400, 'motif_refus_requis');
  return transaction(pool, async (c) => {
    const d = (await c.query('SELECT * FROM demandes_famille WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!d) throw new ErreurHttp(404, 'demande_introuvable');
    await garde(c, u, d.etablissement_id);
    if (FINAUX.includes(d.statut) && b.statut !== 'cloturee') throw new ErreurHttp(409, 'demande_close');
    const reponse = b.reponse === undefined ? d.reponse : texte(b.reponse, 500);
    const note = b.note_interne === undefined ? d.note_interne : texte(b.note_interne, 1000);
    const n = (await c.query(`UPDATE demandes_famille SET statut = $2, reponse = $3, note_interne = $4, resolue_le = CASE WHEN $2 IN ('resolue', 'refusee') THEN COALESCE(resolue_le, now()) ELSE resolue_le END,
      modifie_le = now(), version = version + 1 WHERE id = $1 RETURNING *`, [id, b.statut, reponse, note])).rows[0];
    if (FINAUX.includes(b.statut) && d.tache_id) await c.query(`UPDATE taches_etab SET statut = 'faite', fait_par = $2, fait_le = now(), version = version + 1 WHERE id = $1 AND statut IN ('a_faire', 'en_cours')`, [d.tache_id, u.id]);
    await historiser(c, id, b.statut, u.id, null);
    if (reponse !== d.reponse || ['resolue', 'refusee', 'attente_proche'].includes(b.statut)) await notifs.signaler(c, d.resident_id, 'administratif', d.contact_id);
    return n;
  });
}
/** Une tâche de demande terminée dans l'écran des tâches résout la demande : une seule source de vérité, aucune double saisie. */
async function tacheTerminee(c, tache, u) {
  if (tache.type !== 'demande_famille') return;
  const d = (await c.query(`UPDATE demandes_famille SET statut = 'resolue', resolue_le = now(), modifie_le = now(), version = version + 1 WHERE tache_id = $1 AND statut NOT IN ('resolue', 'refusee', 'annulee', 'cloturee') RETURNING id, resident_id, contact_id`, [tache.id])).rows[0];
  if (d) { await historiser(c, d.id, 'resolue', u.id, 'Tâche terminée'); await notifs.signaler(c, d.resident_id, 'administratif', d.contact_id); }
}
async function creerConfirmation(pool, u, b) {
  const r = (await pool.query('SELECT id, etablissement_id FROM residents WHERE id = $1', [Number(b?.resident_id)])).rows[0];
  if (!r) throw new ErreurHttp(404, 'resident_introuvable');
  await garde(pool, u, r.etablissement_id);
  const k = (await pool.query('SELECT id FROM resident_contacts WHERE id = $1 AND resident_id = $2 AND actif', [Number(b.contact_id), r.id])).rows[0];
  if (!k) throw new ErreurHttp(404, 'contact_introuvable');
  const sujet = texte(b.sujet, 160, true); const explication = texte(b.explication, 1000);
  const echeance = b.echeance ? new Date(b.echeance) : null;
  if (echeance && (Number.isNaN(echeance.getTime()) || echeance < new Date())) throw new ErreurHttp(400, 'date_invalide');
  const n = (await pool.query(`INSERT INTO confirmations_famille (etablissement_id, resident_id, contact_id, sujet, explication, echeance, cree_par) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [r.etablissement_id, r.id, k.id, sujet, explication, echeance, u.id])).rows[0];
  await notifs.signaler(pool, r.id, 'administratif', k.id);
  return n;
}
/** Relances bornées : un rappel au dépassement de l'échéance, puis une escalade ; jamais plus que le réglage. */
async function relancer(pool) {
  const { rows } = await pool.query(`UPDATE demandes_famille d SET relances = relances + 1, derniere_relance_le = now()
    FROM etablissements e WHERE e.id = d.etablissement_id AND d.statut NOT IN ('resolue', 'refusee', 'annulee', 'cloturee') AND d.echeance < now()
      AND d.relances < COALESCE((e.famille_config->>'relances_max')::int, 2) AND (d.derniere_relance_le IS NULL OR d.derniere_relance_le < now() - interval '12 hours')
    RETURNING d.id, d.etablissement_id, d.relances`);
  for (const d of rows) await require('./services').notifier(pool, d.etablissement_id, null, d.relances > 1 ? 'famille_escalade' : 'famille_relance', { n: d.id });
  return rows.length;
}

function brancherProche(api, pool, route, s) {
  api.get('/proches/demandes', s, route((req) => demandesProche(pool, req.proche)));
  api.post('/proches/demandes', s, route((req) => creerDemande(pool, req.proche, req.body)));
  api.post('/proches/demandes/:id/annuler', s, route((req) => annulerDemande(pool, req.proche, Number(req.params.id))));
  api.get('/proches/confirmations', s, route((req) => confirmationsProche(pool, req.proche)));
  api.post('/proches/confirmations/:id/repondre', s, route((req) => repondreConfirmation(pool, req.proche, Number(req.params.id), req.body)));
  api.get('/proches/creneaux', s, route((req) => creneauxProche(pool, req.proche)));
  api.post('/proches/visites/creneau', s, route((req) => reserverCreneau(pool, req.proche, req.body)));
  api.post('/proches/visites/:id/annuler', s, route((req) => annulerVisite(pool, req.proche, Number(req.params.id))));
  api.get('/proches/journal-vie', s, route((req) => journalVieProche(pool, req.proche)));
  api.post('/proches/og', s, route((req) => og(pool, req.proche, req.body)));
}
function brancherPersonnel(api, pool, route, entier) {
  api.get('/famille/tableau', route((req) => tableau(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  // Messages des familles pour l'accueil de l'établissement : non lus d'abord, avec le résident et le proche
  api.get('/famille/messages', route(async (req) => { const e = entier(req.query.etablissement_id, 'etablissement_id'); await garde(pool, req.utilisateur, e);
    return (await pool.query(`SELECT m.id, m.resident_id, m.contact_id, m.categorie, m.texte, m.cree_le, (m.lu_le IS NULL) AS non_lu, r.reference AS resident_ref, r.prenom AS r_prenom, r.nom AS r_nom, k.prenom, k.nom, k.relation
      FROM messages_proches m JOIN residents r ON r.id = m.resident_id JOIN resident_contacts k ON k.id = m.contact_id
      WHERE r.etablissement_id = $1 AND m.sens = 'proche' ORDER BY (m.lu_le IS NULL) DESC, m.cree_le DESC LIMIT 50`, [e])).rows; }));
  api.post('/famille/messages/:id/lu', route(async (req) => { const id = entier(req.params.id, 'id');
    const m = (await pool.query('SELECT r.etablissement_id FROM messages_proches m JOIN residents r ON r.id = m.resident_id WHERE m.id = $1', [id])).rows[0];
    if (!m) throw new ErreurHttp(404, 'message_introuvable'); await garde(pool, req.utilisateur, m.etablissement_id);
    await pool.query('UPDATE messages_proches SET lu_le = COALESCE(lu_le, now()) WHERE id = $1', [id]); return { ok: true }; }));
  api.get('/famille/demandes', route((req) => demandesEtab(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.post('/famille/demandes/:id', route((req) => majDemande(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.post('/famille/confirmations', route((req) => creerConfirmation(pool, req.utilisateur, req.body)));
  api.get('/famille/confirmations', route(async (req) => { const e = entier(req.query.etablissement_id, 'etablissement_id'); await garde(pool, req.utilisateur, e);
    return (await pool.query(`SELECT c.*, r.reference AS resident_ref, k.prenom, k.nom FROM confirmations_famille c JOIN residents r ON r.id = c.resident_id JOIN resident_contacts k ON k.id = c.contact_id WHERE c.etablissement_id = $1 ORDER BY c.cree_le DESC LIMIT 200`, [e])).rows; }));
  api.post('/famille/creneaux', route(async (req) => { const b = req.body || {}; const e = entier(b.etablissement_id, 'etablissement_id'); await garde(pool, req.utilisateur, e);
    const debut = new Date(b.debut); const fin = new Date(b.fin); const cap = Number(b.capacite);
    if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime()) || fin <= debut || debut < new Date() || !Number.isInteger(cap) || cap < 1 || cap > 50) throw new ErreurHttp(400, 'creneau_invalide');
    return (await pool.query('INSERT INTO visites_creneaux (etablissement_id, debut, fin, capacite, cree_par) VALUES ($1, $2, $3, $4, $5) RETURNING *', [e, debut, fin, cap, req.utilisateur.id])).rows[0]; }));
  api.put('/famille/reglages', route(async (req) => { const b = req.body || {}; const e = entier(b.etablissement_id, 'etablissement_id');
    await ch.etabChsld(pool, req.utilisateur, e, { roles: ['coordonnateur', 'admin_etab', 'gestionnaire'] });
    const v = await reglages(pool, e);
    if (b.delai_heures !== undefined) { if (!Number.isInteger(b.delai_heures) || b.delai_heures < 1 || b.delai_heures > 720) throw new ErreurHttp(400, 'reglage_invalide'); v.delai_heures = b.delai_heures; }
    if (b.relances_max !== undefined) { if (!Number.isInteger(b.relances_max) || b.relances_max < 0 || b.relances_max > 5) throw new ErreurHttp(400, 'reglage_invalide'); v.relances_max = b.relances_max; }
    if (b.journal_vie !== undefined) { if (typeof b.journal_vie !== 'boolean') throw new ErreurHttp(400, 'reglage_invalide'); v.journal_vie = b.journal_vie; }
    await pool.query('UPDATE etablissements SET famille_config = $2 WHERE id = $1', [e, v]); return v; }));
  api.get('/famille/reglages', route(async (req) => { const e = entier(req.query.etablissement_id, 'etablissement_id'); await garde(pool, req.utilisateur, e); return reglages(pool, e); }));
  // Journal de vie : brouillon, publication par un responsable, retrait. Aucune photo : l'autorisation des personnes reconnaissables n'est pas encore gérée.
  api.post('/famille/journal-vie', route(async (req) => { const b = req.body || {}; const e = entier(b.etablissement_id, 'etablissement_id'); await garde(pool, req.utilisateur, e);
    const titre = texte(b.titre, 120, true); const t = texte(b.texte, 2000, true);
    const rid = b.resident_id ? Number(b.resident_id) : null;
    if (rid && !(await pool.query('SELECT 1 FROM residents WHERE id = $1 AND etablissement_id = $2', [rid, e])).rowCount) throw new ErreurHttp(404, 'resident_introuvable');
    return (await pool.query(`INSERT INTO journal_vie (etablissement_id, resident_id, titre, texte, auteur) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [e, rid, titre, t, req.utilisateur.id])).rows[0]; }));
  api.post('/famille/journal-vie/:id/:action', route(async (req) => { const id = entier(req.params.id, 'id'); const a = req.params.action;
    if (!['publier', 'retirer'].includes(a)) throw new ErreurHttp(404, 'action_inconnue');
    const j = (await pool.query('SELECT * FROM journal_vie WHERE id = $1', [id])).rows[0]; if (!j) throw new ErreurHttp(404, 'publication_introuvable');
    await ch.etabChsld(pool, req.utilisateur, j.etablissement_id, { roles: ['coordonnateur', 'admin_etab', 'gestionnaire'] });
    if (a === 'publier' && j.auteur === req.utilisateur.id && !req.utilisateur.gestionnaire && req.utilisateur.role !== 'admin_etab') throw new ErreurHttp(409, 'publication_autre_validateur');
    const n = (await pool.query(`UPDATE journal_vie SET statut = $2, valide_par = CASE WHEN $2 = 'publie' THEN $3::int ELSE valide_par END, publie_le = CASE WHEN $2 = 'publie' THEN now() ELSE publie_le END WHERE id = $1 RETURNING *`, [id, a === 'publier' ? 'publie' : 'retire', req.utilisateur.id])).rows[0];
    if (a === 'publier') { const dests = n.resident_id ? [n.resident_id] : (await pool.query(`SELECT id FROM residents WHERE etablissement_id = $1 AND statut NOT IN ('sorti', 'transfere')`, [n.etablissement_id])).rows.map((x) => x.id); for (const r of dests) await notifs.signaler(pool, r, 'hebergement'); }
    return n; }));
  api.get('/famille/journal-vie', route(async (req) => { const e = entier(req.query.etablissement_id, 'etablissement_id'); await garde(pool, req.utilisateur, e);
    return (await pool.query('SELECT j.*, a.nom AS auteur_nom FROM journal_vie j LEFT JOIN utilisateurs a ON a.id = j.auteur WHERE j.etablissement_id = $1 ORDER BY j.cree_le DESC LIMIT 100', [e])).rows; }));
}
module.exports = { brancherProche, brancherPersonnel, tacheTerminee, relancer, reglages, CATEGORIES_DEMANDE };
