'use strict';
/**
 * OG dans un CHSLD : même moteur (copilote.question), mêmes droits que l'interface. Réponses construites uniquement
 * à partir des données enregistrées et autorisées. OG consulte, explique et prépare ; il ne décide jamais de
 * l'admissibilité, d'une priorité clinique, d'un transfert médical ni de l'attribution définitive d'une place.
 * Les noms de résidents ne sont affichés qu'aux personnes de l'établissement (démonstration et recette).
 */
const ch = require('./chsld');
const { environnement } = require('./environnement');
const norm = (q) => String(q || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fictifs = () => ['demo', 'recette'].includes(environnement()) || process.env.ARRIMO_PATIENTS_FICTIFS === '1';
// Contexte conversationnel : dernier résident évoqué, par utilisateur et établissement (en mémoire, sans persistance)
const CONTEXTE = new Map();
const cle = (u, e) => `${u.id}:${e}`;

function T(L, fr, en) { return L === 'en' ? en : fr; }
const nomResident = (r) => (fictifs() ? `${r.prenom} ${r.nom} (${r.reference})` : r.reference);

async function chercherResident(pool, u, etabId, qn, brut) {
  const ref = String(brut).match(/\bR-\d{5}\b/i);
  const liste = await ch.listeResidents(pool, u, etabId, { statut: 'tous', q: ref ? ref[0].toUpperCase() : undefined });
  if (ref) return liste.filter((r) => r.reference === ref[0].toUpperCase());
  // Recherche par nom : mots de la question qui correspondent à un prénom et un nom enregistrés
  const mots = new Set(qn.split(/[^a-z0-9-]+/).filter((m) => m.length > 2));
  return liste.filter((r) => mots.has(norm(r.nom)) && (mots.has(norm(r.prenom)) || liste.filter((x) => norm(x.nom) === norm(r.nom)).length === 1));
}

async function repondre(pool, u, etabId, q, L) {
  const qn = norm(q);
  const ctx = CONTEXTE.get(cle(u, etabId)) || {};
  const memoriser = (r) => CONTEXTE.set(cle(u, etabId), { residentId: r.id, ref: r.reference });
  const local = (reponse, extra = {}) => ({ mode: 'local', reponse, sources: ['arrimo'], ...extra });

  // Décisions qui ne relèvent pas d'OG : refus explicite, avec ce qu'il peut faire à la place
  if (/(admissib|eligib|priorit\w* clinique|clinical priority|decide|decider|choisis qui|who should get|attribue definitivement|assign permanently|transfert medical|medical transfer)/.test(qn)) {
    return local(T(L, 'Je ne décide pas de l’admissibilité, d’une priorité clinique, d’un transfert médical ni de l’attribution définitive d’une place : ces décisions reviennent aux personnes et aux mécanismes habilités. Je peux afficher les informations enregistrées et préparer une démarche à confirmer.',
      'I do not decide eligibility, clinical priority, medical transfers or the final assignment of a place: those decisions belong to authorized people and mechanisms. I can show recorded information and prepare a step for confirmation.'), { intentions: ['decision_humaine'] });
  }
  // Enregistrer un nouveau résident : OG ouvre un brouillon guidé (formulaire), rien n'est enregistré sans vérification
  if (/(enregistr|nouveau resident|nouvelle residente|new resident|register a resident|register a new|admettre un nouveau|accueil d.un nouveau)/.test(qn) && !/demande/.test(qn)) {
    return local(T(L, 'J’ouvre le formulaire d’enregistrement. Vérifiez chaque champ ; je vérifie les doublons et vos droits avant l’enregistrement.', 'I am opening the registration form. Check each field; I check duplicates and your permissions before saving.'), { intentions: ['nouveau_resident'], formulaire: 'nouveau_resident' });
  }
  // Places
  if (/(chambre|lit|place|bed|room)s?\b.*(disponible|libre|available|free|vacant)|(disponible|libre|available|free)s?\b.*(chambre|lit|place|bed|room)|combien de (lits|places|chambres)|how many (beds|places|rooms)/.test(qn)) {
    const places = await ch.places(pool, u, etabId);
    const libres = places.filter((p) => p.etat === 'libre');
    const parUnite = [...new Set(libres.map((p) => p.unite))].map((un) => `• ${un} : ${libres.filter((p) => p.unite === un).map((p) => p.code).join(', ')}`);
    return local(T(L, `${libres.length} place(s) libre(s) sur ${places.filter((p) => p.etat !== 'indispo').length} en service.${parUnite.length ? `\n${parUnite.join('\n')}` : ''}\nUne place libre n’est pas une admission : l’attribution suit les étapes habituelles.`,
      `${libres.length} available place(s) out of ${places.filter((p) => p.etat !== 'indispo').length} in service.${parUnite.length ? `\n${parUnite.join('\n')}` : ''}\nAn available place is not an admission: assignment follows the usual steps.`), { intentions: ['places'], ouvrir: 'c-chambres' });
  }
  if (/(nettoy|preparation|clean|housekeep)/.test(qn) && !/(prepare une tache|prepare a task|tache d.entretien)/.test(qn)) {
    const places = (await ch.places(pool, u, etabId)).filter((p) => p.etat === 'nettoyage');
    return local(places.length ? T(L, `${places.length} chambre(s) à nettoyer ou en préparation :\n${places.map((p) => `• ${p.code} (${p.unite}, chambre ${p.chambre})`).join('\n')}`, `${places.length} room(s) to clean or being prepared:\n${places.map((p) => `• ${p.code} (${p.unite}, room ${p.chambre})`).join('\n')}`)
      : T(L, 'Aucune chambre en nettoyage actuellement.', 'No room is being cleaned right now.'), { intentions: ['nettoyage'], ouvrir: 'nettoyage' });
  }
  // Préparer une tâche d'entretien pour une chambre : proposition à confirmer
  const tacheChambre = qn.match(/(?:tache|task)[^0-9]*(?:chambre|room)\s*([a-z0-9-]+)/);
  if (tacheChambre) {
    const places = (await ch.places(pool, u, etabId)).filter((p) => norm(p.chambre) === tacheChambre[1] || norm(p.code).startsWith(tacheChambre[1]));
    if (!places.length) return local(T(L, `Je ne trouve pas la chambre ${tacheChambre[1]} dans cet établissement.`, `I cannot find room ${tacheChambre[1]} in this facility.`), { intentions: ['tache'] });
    return local(T(L, `Voici une tâche d’entretien à confirmer pour la chambre ${places[0].chambre}. Rien n’est créé avant votre confirmation.`, `Here is a housekeeping task to confirm for room ${places[0].chambre}. Nothing is created before you confirm.`),
      { intentions: ['tache'], proposition_chsld: { type: 'tache', corps: { type: 'entretien', titre: T(L, `Entretien de la chambre ${places[0].chambre}`, `Housekeeping, room ${places[0].chambre}`), lit_id: places[0].id, assigne_role: 'entretien' } } });
  }
  // Résidents hospitalisés, retours prévus, échanges
  if (/(hospitalis|a l.hopital|in hospital|hospitalized|hospitalised)/.test(qn) && !/(dans quel|which hospital|ou se trouve|where is)/.test(qn)) {
    const liste = await ch.listeResidents(pool, u, etabId, { statut: 'hospitalise' });
    const co = await ch.listeCoordinations(pool, u, etabId, {});
    return local(liste.length ? T(L, `${liste.length} résident(s) hospitalisé(s), place conservée :\n${liste.map((r) => { const c = co.find((x) => x.type === 'hospitalisation' && x.resident_ref === r.reference && ['en_cours', 'recue'].includes(x.statut)); return `• ${nomResident(r)}${c ? ` · ${c.destination} (${c.statut === 'recue' ? 'réception confirmée' : 'départ confirmé'})` : ''}`; }).join('\n')}`,
      `${liste.length} resident(s) in hospital, place held:\n${liste.map((r) => { const c = co.find((x) => x.type === 'hospitalisation' && x.resident_ref === r.reference && ['en_cours', 'recue'].includes(x.statut)); return `• ${nomResident(r)}${c ? ` · ${c.destination} (${c.statut === 'recue' ? 'arrival confirmed' : 'departure confirmed'})` : ''}`; }).join('\n')}`)
      : T(L, 'Aucun résident n’est hospitalisé actuellement.', 'No resident is currently in hospital.'), { intentions: ['hospitalisations'], ouvrir: 'c-mouvements' });
  }
  if (/(retour|return)s?\b/.test(qn) && /(prevu|prevus|annonce|today|aujourd|planned|expected|attendu)/.test(qn)) {
    const co = (await ch.listeCoordinations(pool, u, etabId, {})).filter((c) => c.type === 'retour' && c.entrante && ['envoyee', 'acceptee', 'en_cours'].includes(c.statut));
    const auj = /(aujourd|today)/.test(qn) ? co.filter((c) => c.retour_prevu_le && new Date(c.retour_prevu_le).toDateString() === new Date().toDateString()) : co;
    return local(auj.length ? T(L, `${auj.length} retour(s) ${/(aujourd|today)/.test(qn) ? 'prévu(s) aujourd’hui' : 'annoncé(s)'} :\n${auj.map((c) => `• ${c.resident_ref} depuis ${c.origine}${c.retour_prevu_le ? ` · ${new Date(c.retour_prevu_le).toLocaleString('fr-CA')}` : ''} · ${c.statut}`).join('\n')}`,
      `${auj.length} return(s) ${/(aujourd|today)/.test(qn) ? 'planned today' : 'announced'}:\n${auj.map((c) => `• ${c.resident_ref} from ${c.origine}${c.retour_prevu_le ? ` · ${new Date(c.retour_prevu_le).toLocaleString('en-CA')}` : ''} · ${c.statut}`).join('\n')}`)
      : T(L, 'Aucun retour d’hospitalisation n’est annoncé.', 'No return from hospital is announced.'), { intentions: ['retours'], ouvrir: 'c-mouvements' });
  }
  if (/(demande|request)s? d?.?(hebergement|placement)|(hebergement|placement) request|attend\w* (une )?confirmation|awaiting confirmation/.test(qn)) {
    const d = await ch.listeDemandes(pool, u, etabId);
    const attente = d.filter((x) => ['place_proposee', 'en_verification', 'documents_manquants', 'recue'].includes(x.statut));
    return local(attente.length ? T(L, `${attente.length} demande(s) d’hébergement ouverte(s) :\n${attente.map((x) => `• ${x.numero} · ${x.statut.replace('_', ' ')}${x.statut === 'documents_manquants' ? ` (manque : ${x.documents.filter((y) => !y.recu).map((y) => y.code).join(', ')})` : ''}`).join('\n')}`,
      `${attente.length} open placement request(s):\n${attente.map((x) => `• ${x.numero} · ${x.statut.replace('_', ' ')}${x.statut === 'documents_manquants' ? ` (missing: ${x.documents.filter((y) => !y.recu).map((y) => y.code).join(', ')})` : ''}`).join('\n')}`)
      : T(L, 'Aucune demande d’hébergement ouverte.', 'No open placement request.'), { intentions: ['demandes'], ouvrir: 'c-demandes' });
  }
  if (/(echange|demande|transfert|exchange|request|transfer).*(chsld|entre les|between)|(chsld).*(echange|attente|pending|en cours)/.test(qn)) {
    const co = (await ch.listeCoordinations(pool, u, etabId, {})).filter((c) => c.type === 'transfert_chsld' && ['envoyee', 'acceptee', 'en_cours'].includes(c.statut));
    return local(co.length ? T(L, `${co.length} échange(s) en cours avec le réseau CHSLD :\n${co.map((c) => `• ${c.numero} · ${c.resident_ref} · ${c.origine} → ${c.destination} · ${c.statut}`).join('\n')}`,
      `${co.length} exchange(s) in progress with the CHSLD network:\n${co.map((c) => `• ${c.numero} · ${c.resident_ref} · ${c.origine} → ${c.destination} · ${c.statut}`).join('\n')}`)
      : T(L, 'Aucun échange en cours entre CHSLD.', 'No exchange in progress between CHSLDs.'), { intentions: ['reseau_chsld'], ouvrir: 'c-reseau' });
  }
  // Résident nommé ou en contexte : fiche, contacts, autorisations, hôpital, retour
  let residents = await chercherResident(pool, u, etabId, qn, q);
  if (!residents.length && ctx.residentId && /(ce resident|cette residente|ses|sa |son |il |elle |this resident|his|her|their|contacts?|autoris|hopital|hospital|retour|return|message|fille|fils|daughter|son\b)/.test(qn)) {
    residents = (await ch.listeResidents(pool, u, etabId, { statut: 'tous', q: ctx.ref })).filter((r) => r.id === ctx.residentId);
  }
  if (residents.length > 1) return local(T(L, `Plusieurs résidents correspondent : ${residents.map(nomResident).join(', ')}. Précisez la référence.`, `Several residents match: ${residents.map(nomResident).join(', ')}. Specify the reference.`), { intentions: ['resident'] });
  if (residents.length === 1) {
    const f = await ch.ficheResident(pool, u, residents[0].id); const r = f.resident; memoriser(r);
    const contacts = f.contacts;
    if (/(contact|proche|prevenir|famille|family|notify)/.test(qn) && !/(autoris|allowed|message|rappel|callback)/.test(qn)) {
      const p = contacts.slice(0, /(deux|two|2)/.test(qn) ? 2 : contacts.length);
      return local(p.length ? T(L, `Contacts de ${nomResident(r)} :\n${p.map((k) => `• ${k.prenom} ${k.nom} (${k.relation})${k.principal ? ', principal' : `, rang ${k.rang}`} · ${[k.telephone, k.courriel].filter(Boolean).join(' · ')}`).join('\n')}\nÊtre à prévenir n’autorise pas à consulter le dossier.`,
        `Contacts for ${nomResident(r)}:\n${p.map((k) => `• ${k.prenom} ${k.nom} (${k.relation})${k.principal ? ', primary' : `, rank ${k.rang}`} · ${[k.telephone, k.courriel].filter(Boolean).join(' · ')}`).join('\n')}\nBeing a contact to notify does not allow access to the record.`)
        : T(L, `Aucun contact enregistré pour ${nomResident(r)}.`, `No contact recorded for ${nomResident(r)}.`), { intentions: ['contacts'] });
    }
    if (/(autoris|allowed|permission|qui peut recevoir|who can receive)/.test(qn)) {
      const a = contacts.filter((k) => k.autorisations.length);
      return local(a.length ? T(L, `Personnes autorisées à recevoir des informations sur ${nomResident(r)} :\n${a.map((k) => `• ${k.prenom} ${k.nom} (${k.relation}) : ${k.autorisations.join(', ')}${k.representant_legal ? ` · représentant légal ${k.representant_verifie_le ? '(mandat vérifié)' : '(mandat à vérifier)'}` : ''}`).join('\n')}`,
        `People authorized to receive information about ${nomResident(r)}:\n${a.map((k) => `• ${k.prenom} ${k.nom} (${k.relation}): ${k.autorisations.join(', ')}${k.representant_legal ? ` · legal representative ${k.representant_verifie_le ? '(mandate verified)' : '(mandate to verify)'}` : ''}`).join('\n')}`)
        : T(L, `Aucun proche n’est autorisé à recevoir des informations sur ${nomResident(r)}.`, `No family member is authorized to receive information about ${nomResident(r)}.`), { intentions: ['autorisations'] });
    }
    if (/(message|rappel|callback|call back|ecrire)/.test(qn)) {
      const rel = ['fille', 'fils', 'conjoint', 'soeur', 'frere'].find((x) => qn.includes(x)) || { daughter: 'fille', son: 'fils', spouse: 'conjoint', sister: 'soeur', brother: 'frere' }[Object.keys({ daughter: 1, son: 1, spouse: 1, sister: 1, brother: 1 }).find((x) => new RegExp(`\\b${x}\\b`).test(qn))];
      const k = contacts.find((x) => (!rel || x.relation === rel) && x.autorisations.includes('administratif'));
      if (!k) return local(T(L, `Aucun proche${rel ? ` (${rel})` : ''} n’est autorisé pour les échanges administratifs : je ne prépare rien.`, `No family member${rel ? ` (${rel})` : ''} is authorized for administrative exchanges: I am not preparing anything.`), { intentions: ['communication_refusee'] });
      return local(T(L, `Voici une demande de rappel à confirmer pour ${k.prenom} ${k.nom} (${k.relation}). Rien n’est envoyé par courriel ou SMS.`, `Here is a callback request to confirm for ${k.prenom} ${k.nom} (${k.relation}). Nothing is sent by email or SMS.`),
        { intentions: ['communication'], proposition_chsld: { type: 'communication', resident_id: r.id, corps: { contact_id: k.id, type: 'rappel_demande', categorie: 'administratif', sujet: T(L, 'Demande de rappel de l’établissement', 'Callback request from the facility') } } });
    }
    if (/(hopital|hospital|ou se trouve|where is)/.test(qn) && r.statut === 'hospitalise') {
      return local(f.localisation ? T(L, `D’après la dernière hospitalisation ${f.localisation.confirmee ? 'confirmée par l’hôpital' : 'au départ confirmé (réception non encore confirmée)'}, ${nomResident(r)} est à ${f.localisation.hopital} (${f.localisation.numero}).`,
        `According to the latest hospital stay ${f.localisation.confirmee ? 'confirmed by the hospital' : 'at confirmed departure (arrival not yet confirmed)'}, ${nomResident(r)} is at ${f.localisation.hopital} (${f.localisation.numero}).`)
        : T(L, 'Aucune hospitalisation confirmée n’est enregistrée : je ne peux pas indiquer d’hôpital.', 'No confirmed hospital stay is recorded: I cannot name a hospital.'), { intentions: ['localisation'] });
    }
    if (/(prepare|preparer) (le )?(retour|return)/.test(qn)) {
      const retour = f.coordinations.find((c) => c.type === 'retour' && ['envoyee', 'acceptee', 'en_cours'].includes(c.statut));
      return local(retour ? T(L, `Le retour de ${nomResident(r)} est ${retour.statut === 'envoyee' ? 'proposé par l’hôpital : il attend votre acceptation dans Transferts et hospitalisations' : retour.statut === 'acceptee' ? 'accepté : la chambre est à préparer, l’hôpital confirmera le départ' : 'en cours : confirmez l’arrivée à la réception'} (${retour.numero}).`,
        `${nomResident(r)}’s return is ${retour.statut === 'envoyee' ? 'proposed by the hospital: it awaits your acceptance in Transfers and hospital stays' : retour.statut === 'acceptee' ? 'accepted: prepare the room; the hospital will confirm departure' : 'in progress: confirm arrival at reception'} (${retour.numero}).`)
        : T(L, `Le retour est préparé par l’hôpital qui a reçu ${nomResident(r)}. Aucune demande de retour n’est enregistrée pour l’instant ; la place reste conservée.`, `The return is prepared by the hospital that received ${nomResident(r)}. No return request is recorded yet; the place remains held.`), { intentions: ['retour'], ouvrir: 'c-mouvements' });
    }
    const derniers = f.mouvements.filter((m) => m.type !== 'modification').slice(0, 3);
    return local(T(L, `${nomResident(r)} · ${r.statut}${f.lit ? ` · ${f.lit.unite}, chambre ${f.lit.chambre}, ${f.lit.code}` : ''}.\n${contacts.length} contact(s).${derniers.length ? `\nDerniers mouvements : ${derniers.map((m) => m.type).join(', ')}.` : ''}`,
      `${nomResident(r)} · ${r.statut}${f.lit ? ` · ${f.lit.unite}, room ${f.lit.chambre}, ${f.lit.code}` : ''}.\n${contacts.length} contact(s).${derniers.length ? `\nLatest movements: ${derniers.map((m) => m.type).join(', ')}.` : ''}`), { intentions: ['resident'], ouvrir: 'c-residents', resident_id: r.id });
  }
  if (/(retrouve|trouve|cherche|find|search|ou est|where is)/.test(qn)) return local(T(L, 'Je ne trouve aucun résident correspondant dans cet établissement.', 'I cannot find a matching resident in this facility.'), { intentions: ['resident'] });
  // Aide
  return local(T(L, 'Je peux vous aider avec : places disponibles, chambres en nettoyage, résidents hospitalisés, retours prévus, demandes d’hébergement, échanges entre CHSLD, recherche d’un résident, ses contacts et autorisations, une tâche d’entretien, une demande de rappel à un proche, ou l’enregistrement d’un nouveau résident.',
    'I can help with: available places, rooms being cleaned, residents in hospital, planned returns, placement requests, exchanges between CHSLDs, finding a resident, their contacts and permissions, a housekeeping task, a callback request to a family member, or registering a new resident.'), { intentions: ['aide'] });
}
module.exports = { repondre };
