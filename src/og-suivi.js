'use strict';
// Projection de lecture : un transfert commun autorise son suivi, jamais une
// recherche libre dans les dossiers ou les lits de l'établissement voisin.
const { exigerEtablissement } = require('./auth');
const { ErreurHttp } = require('./db');
const { traducteurTypes } = require('./langue');
const { EVENEMENTS,ETATS,nomEtablissement } = require('./og-localisation');
const statut = {demande:'Demandé',validee:'Accepté',transport:'Transport organisé',en_route:'En route',recu:'Reçu',refuse:'Refusé'};
const date = x => x ? new Date(x).toISOString() : null;
const minutes = n => `${Math.round(Number(n) * 10) / 10} min`;
function estRechercheCapacite(question) {
  const q=String(question).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  return /\b(?:lits?|beds?)\b/.test(q) && /(?:\b(?:cherch\w*|trouv\w*|recherch\w*|propos\w*) (?:un |des |de |d.un |du )|disponib|compatib|besoin d.un lit|options? de lit|\bfind\b|\bsearch\b|\bavailable\b|\bneed\b|bed options)/.test(q);
}

async function repondreSuivi(db, utilisateur, etabId, question) {
  exigerEtablissement(utilisateur, etabId);
  const texte = String(question).toUpperCase();
  const refs = [...new Set(texte.match(/\bP-\d{1,12}\b/g) || [])];
  const numeros = [...new Set(texte.match(/\bTR-\d{1,12}\b/g) || [])];
  const id = /\bPATIENT\s+(?:INTERNE\s+|ID\s*|N[°O]\s*|#\s*)(\d+)\b/.exec(texte)?.[1];
  const admission = /\bADMISSION\s*(?:N[°O]\s*|#\s*|ID\s*)(\d+)\b/.exec(texte)?.[1];
  if (!refs.length && !numeros.length && !id && !admission) return null;
  const en=utilisateur.langue==='en',langue=en?'en':'fr';
  const T=(fr,anglais)=>en?anglais:fr;
  const type=await traducteurTypes(db,langue);
  const etab=nom=>nomEtablissement(nom,langue);
  const etat=code=>en?(ETATS[code]||code):code;
  const action=texte=>en?(EVENEMENTS[texte]||texte):texte;
  // Une demande de capacité pour un patient reste une recherche de capacités ;
  // elle ne réserve rien et passe par le moteur de recommandations existant.
  if (!numeros.length && estRechercheCapacite(question)) return null;
  const local = (await db.query('SELECT nom,actif,module_actif FROM etablissements WHERE id=$1',[etabId])).rows[0];
  if (!local || !local.actif) throw new ErreurHttp(404,'etab_introuvable');
  if (!local.module_actif) throw new ErreurHttp(403,'module_inactif',{etab:local.nom});
  if (id && !refs.length && !numeros.length) {
    const p = (await db.query('SELECT reference FROM patients WHERE id=$1 AND etablissement_id=$2',[id,etabId])).rows[0];
    if (p) refs.push(p.reference);
  }
  const demandes = refs.length ? refs : [null];
  const blocs = [], sources = new Set(), faits = [], manquants = [];
  for (const ref of demandes) {
    const tr = (await db.query(`SELECT t.*, o.nom AS origine_nom,dest.nom AS destination_nom,
        ty.nom AS service_demande, da.patient_id, da.id AS admission_id,da.statut AS admission_statut,pa.arrivee_le AS patient_arrivee_le,
        da.cree_le AS admission_creee_le,cv.code AS civiere_origine,
        (cv.patient_ref=t.patient_ref AND cv.etat='occupee'
          AND (t.date_depart IS NULL OR cv.arrivee_le<=t.date_depart)) AS encore_sur_civiere,
        l.code AS lit_attribue,l.etat AS lit_etat,l.code AS lit_code,l.etat_depuis AS lit_etat_depuis,
        (l.transfert_id=t.id AND l.patient_ref=t.patient_ref AND l.etablissement_id=t.destination_id
          AND l.etat IN ('occupe','reserve')) AS lien_lit_actuel,
        un.nom AS service_actuel,ch.numero AS chambre
      FROM transferts t
      JOIN etablissements o ON o.id=t.origine_id JOIN etablissements dest ON dest.id=t.destination_id
      JOIN types_unite ty ON ty.id=t.type_id
      LEFT JOIN demandes_admission da ON da.id=t.demande_admission_id AND da.etablissement_id=t.origine_id AND da.patient_ref=t.patient_ref
      LEFT JOIN patients pa ON pa.id=da.patient_id AND pa.etablissement_id=t.origine_id AND pa.reference=t.patient_ref
      LEFT JOIN civieres cv ON cv.id=da.civiere_id AND cv.etablissement_id=t.origine_id
      LEFT JOIN lits l ON l.id=t.lit_id AND l.etablissement_id=t.destination_id
      LEFT JOIN unites un ON un.id=l.unite_id LEFT JOIN chambres ch ON ch.id=l.chambre_id
      WHERE ($1::boolean OR t.origine_id=$2 OR t.destination_id=$2)
        AND ($3::text IS NULL OR t.patient_ref=$3)
        AND (cardinality($4::text[])=0 OR t.numero=ANY($4::text[]))
        AND ($5::int IS NULL OR da.patient_id=$5) AND ($6::int IS NULL OR da.id=$6)
      ORDER BY t.date_demande,t.id`, [!!utilisateur.gestionnaire,etabId,ref,numeros,id || null,admission || null])).rows;
    sources.add('Transferts communs (liens internes et état courant)');
    // Identités locales uniquement ; aucun nom, date de naissance ou autre identité
    // personnelle de l'établissement receveur n'est lu ou renvoyé.
    const ps = ref && !numeros.length ? (await db.query(`SELECT id,reference,parcours,arrivee_le FROM patients
      WHERE etablissement_id=$1 AND reference=$2 AND ($3::int IS NULL OR id=$3)`,[etabId,ref,id || null])).rows : [];
    const lits = ref && !numeros.length ? (await db.query(`SELECT l.id,l.transfert_id,l.code,l.etat,l.etat_depuis,un.nom AS unite,ch.numero AS chambre FROM lits l
      JOIN unites un ON un.id=l.unite_id JOIN chambres ch ON ch.id=l.chambre_id
      WHERE l.etablissement_id=$1 AND l.patient_ref=$2 AND l.etat IN ('occupe','reserve') ORDER BY l.id`,[etabId,ref])).rows : [];
    const cvs = ref && !numeros.length ? (await db.query("SELECT id,code,arrivee_le FROM civieres WHERE etablissement_id=$1 AND patient_ref=$2 AND etat='occupee' ORDER BY id",[etabId,ref])).rows : [];
    const ds = ref && !numeros.length ? (await db.query("SELECT id,patient_id,civiere_id,statut,cree_le,terminee_le FROM demandes_admission WHERE etablissement_id=$1 AND patient_ref=$2 AND statut IN ('attente','assignee','admise') ORDER BY cree_le DESC,id DESC",[etabId,ref])).rows : [];
    const identites = new Set(tr.map(x => x.patient_id ? `patient:${x.patient_id}` : x.admission_id ? `admission:${x.admission_id}` : `transfert:${x.id}`));
    for (const p of ps) identites.add(`patient:${p.id}`);
    // Une occurrence locale sans lien avec un transfert homonyme ne doit pas
    // disparaître derrière ce transfert, notamment pour le compte régional.
    if (tr.length) {
      for (const l of lits) if (!ps.length && !tr.some(t=>t.id===l.transfert_id)) identites.add(`lit-local:${l.id}`);
      for (const d of ds) if (!tr.some(t=>t.admission_id===d.id)) identites.add(d.patient_id ? `patient:${d.patient_id}` : `admission:${d.id}`);
      for (const cv of cvs) if (!ps.length && !tr.some(t=>t.civiere_origine===cv.code && t.origine_id===etabId) && !ds.some(d=>d.civiere_id===cv.id)) identites.add(`civiere-locale:${cv.id}`);
    }
    if (!numeros.length && (identites.size>1 || lits.length>1 || cvs.length>1 || tr.filter(x=>x.lien_lit_actuel && x.lit_etat==='occupe').length>1)) {
      blocs.push(T(`Référence ${ref || 'demandée'} ambiguë : plusieurs identifiants internes accessibles. Précisez le numéro de transfert ou le patient interne : ${[...identites].join(', ')}. Aucun dossier n’est sélectionné arbitrairement.`,
        `Ambiguous reference ${ref || 'requested'}: multiple accessible internal identifiers. Specify the transfer number or internal patient: ${[...identites].join(', ')}. No record is selected arbitrarily.`));
      manquants.push(T('identifiant interne ou numéro de transfert','internal identifier or transfer number')); continue;
    }
    if (tr.length) {
      for (const t of tr) {
        const statutEn={demande:'Requested',validee:'Accepted',transport:'Transport arranged',en_route:'In transit',recu:'Received',refuse:'Declined'};
        const lignes = [T(`Patient ${t.patient_ref} — transfert ${t.numero} : ${t.origine_nom} → ${t.destination_nom}.`,`Patient ${t.patient_ref} — transfer ${t.numero}: ${etab(t.origine_nom)} → ${etab(t.destination_nom)}.`),
          T(`Identifiant de suivi : ${t.patient_id ? 'patient interne '+t.patient_id : t.admission_id ? 'admission n° '+t.admission_id : 'transfert interne '+t.id}.`,
            `Tracking identifier: ${t.patient_id?'internal patient '+t.patient_id:t.admission_id?'admission #'+t.admission_id:'internal transfer '+t.id}.`),
          T(`Service demandé : ${t.service_demande}.`,`Requested department: ${type(t.service_demande)}.`),
          T(`Statut du transfert : ${statut[t.statut]}.`,`Transfer status: ${statutEn[t.statut]||t.statut}.`),
          t.admission_statut?T(`Demande d’admission à l’origine : ${t.admission_statut}.`,`Admission request at origin: ${etat(t.admission_statut)}.`):T('Demande d’admission liée : non enregistrée.','Linked admission request: not recorded.')];
        if (t.statut==='recu') {
          if (t.lien_lit_actuel && t.lit_etat==='occupe') {
            lignes.push(T(`Situation actuelle vérifiée : admis ; établissement ${t.destination_nom} ; service ${t.service_actuel} ; chambre ${t.chambre} ; lit ${t.lit_code}.`,
              `Verified current location: admitted; hospital ${etab(t.destination_nom)}; department ${type(t.service_actuel)}; Room ${t.chambre}; Bed ${t.lit_code}.`),
              ...(t.lit_etat_depuis ? [T(`Lit occupé depuis : ${date(t.lit_etat_depuis)}.`,`Bed occupied since: ${date(t.lit_etat_depuis)}.`)] : []),
              T('Statut du lit : occupé. Admission à destination : admis.','Bed status: occupied. Admission at destination: admitted.'));
          } else {
            lignes.push(T(`Dernière situation connue : réception enregistrée à ${t.destination_nom}${t.date_reception ? ' le '+date(t.date_reception) : ''}.`,
              `Last recorded location: receipt at ${etab(t.destination_nom)}${t.date_reception?' on '+date(t.date_reception):''}.`),
              T('L’occupation actuelle du lit par ce patient n’est pas établie ; une réception passée ne prouve pas une admission actuelle.','Current bed occupancy by this patient is not established; a past receipt does not prove a current admission.'));
            manquants.push(T('localisation actuelle après la dernière réception','current location after the last receipt'));
          }
        } else if (t.statut==='en_route') lignes.push(T(`Situation du patient : départ confirmé de ${t.origine_nom}, en transport vers ${t.destination_nom} ; réception non confirmée.`,
          `Patient status: departure confirmed from ${etab(t.origine_nom)}, in transit to ${etab(t.destination_nom)}; receipt not confirmed.`));
        else if (t.statut==='refuse') lignes.push(T('Transfert refusé : aucun départ ni admission à destination ne peut être déduit de ce transfert.','Transfer declined: neither departure nor admission at destination can be inferred from this transfer.'));
        else lignes.push(T(`Patient non encore reçu à ${t.destination_nom} ; ${t.date_depart ? 'départ enregistré' : 'départ non confirmé'}.`,
          `Patient not yet received at ${etab(t.destination_nom)}; ${t.date_depart?'departure recorded':'departure not confirmed'}.`));
        if (t.lien_lit_actuel && t.lit_etat==='reserve') lignes.push(T(`Lit réservé à destination : ${t.lit_code} ; service ${t.service_actuel} ; chambre ${t.chambre}. Un lit réservé ne signifie pas que le patient est admis ou déjà arrivé.`,
          `Bed reserved at destination: ${t.lit_code}; department ${type(t.service_actuel)}; room ${t.chambre}. A reserved bed does not mean the patient is admitted or has arrived.`));
        if (t.civiere_origine) lignes.push(t.encore_sur_civiere
          ? T(`Le patient occupe encore la civière ${t.civiere_origine} de ${t.origine_nom}.`,`The patient still occupies stretcher ${t.civiere_origine} at ${etab(t.origine_nom)}.`)
          : T(`Le patient n’occupe plus la civière ${t.civiere_origine} de ${t.origine_nom}. Civière et lit hospitalier sont distincts.`,`The patient no longer occupies stretcher ${t.civiere_origine} at ${etab(t.origine_nom)}. A stretcher and a hospital bed are distinct.`));
        const chrono = [t.patient_arrivee_le && ['Arrivée enregistrée à l’origine',t.patient_arrivee_le],t.admission_creee_le && ['Demande de lit',t.admission_creee_le],
          ['Demande de transfert',t.date_demande],['Acceptation',t.date_validation],
          ['Chambre prête',t.date_chambre_prete],['Départ confirmé',t.date_depart],['Réception',t.date_reception]]
          .filter(x=>x && x[1]).sort((a,b)=>new Date(a[1])-new Date(b[1]));
        lignes.push(T('Parcours enregistré :\n','Recorded journey:\n')+chrono.map(([a,le])=>`• ${date(le)} : ${action(a)}.`).join('\n'));
        const journal = (await db.query('SELECT date,action FROM journal WHERE transfert_id=$1 AND NOT refuse ORDER BY date,id',[t.id])).rows;
        if (journal.length) lignes.push(T('Historique du transfert :\n','Transfer history:\n')+journal.map(j=>`• ${date(j.date)} : ${action(j.action)}.`).join('\n'));
        sources.add('Journal du transfert commun');
        lignes.push(t.minutes_route != null && t.route_actualise_le ? T(`Trajet estimé à la demande : ${t.distance_km ?? 'non renseignée'} km ; ${minutes(t.minutes_route)}${t.route_fournisseur ? ' ; '+t.route_fournisseur : ''} (sans trafic en temps réel).`,
          `Route estimated at request time: ${t.distance_km??'not recorded'} km; ${minutes(t.minutes_route)}${t.route_fournisseur?' ; '+t.route_fournisseur:''} (no live traffic).`):T('Trajet estimé : non enregistré.','Route estimate: not recorded.'));
        lignes.push(T(`Temps écoulé depuis la création du transfert : ${minutes(Math.max(0,(Date.now()-new Date(t.date_demande))/60000))}.`,`Time elapsed since transfer creation: ${minutes(Math.max(0,(Date.now()-new Date(t.date_demande))/60000))}.`));
        lignes.push(t.date_depart && t.date_reception?T(`Durée réelle du transport (départ → réception) : ${minutes((new Date(t.date_reception)-new Date(t.date_depart))/60000)}.`,`Recorded transport duration (departure → receipt): ${minutes((new Date(t.date_reception)-new Date(t.date_depart))/60000)}.`):T('Durée réelle du transport : non mesurable avant départ et réception confirmés.','Actual transport duration: cannot be measured before confirmed departure and receipt.'));
        blocs.push(lignes.join('\n')); faits.push(T(`suivi autorisé ${t.numero}`,`authorized tracking ${t.numero}`));
      }
      continue;
    }
    if (!ref || numeros.length || admission) {
      blocs.push(T('Aucun transfert accessible correspondant aux identifiants demandés. Aucune situation extérieure au périmètre autorisé n’est divulguée.','No accessible transfer matches the requested identifiers. No information outside the authorized scope is disclosed.'));continue;
    }
    sources.add('Lits, civières, dossiers et admissions de l’établissement autorisé');
    if (lits.length>1 || cvs.length>1 || new Set(ds.map(x=>x.patient_id).filter(Boolean)).size>1) {
      blocs.push(T(`Référence ${ref} ambiguë : plusieurs situations locales. Précisez le patient interne ou l’admission ; aucune sélection arbitraire.`,`Ambiguous reference ${ref}: multiple local records. Specify the internal patient or admission; no arbitrary selection.`));manquants.push(T('identifiant interne du patient','internal patient identifier'));continue;
    }
    if (!lits.length && !cvs.length && !ds.length && !ps.length) {
      blocs.push(T(`Aucune situation active accessible pour ${ref} dans ${local.nom}. Une absence de résultat ne signifie pas que le patient n’existe pas ailleurs.`,`No accessible active record for ${ref} at ${etab(local.nom)}. No result does not mean the patient does not exist elsewhere.`));continue;
    }
    blocs.push([`Patient ${ref} — ${etab(local.nom)}.`,ps[0]?T(`Patient interne ${ps[0].id} ; parcours enregistré : ${ps[0].parcours}.`,`Internal patient ${ps[0].id}; recorded journey: ${etat(ps[0].parcours)}.`):'',
      lits[0]?T(`Statut : ${lits[0].etat==='occupe'?'admis':'lit réservé, admission à confirmer'} ; lit ${lits[0].code} (${lits[0].unite}) ; chambre ${lits[0].chambre}.`,`Status: ${lits[0].etat==='occupe'?'admitted':'bed reserved, admission to be confirmed'}; bed ${lits[0].code} (${type(lits[0].unite)}); room ${lits[0].chambre}.`):T('Aucun lit occupé ou réservé enregistré ici.','No occupied or reserved bed recorded here.'),
      lits[0]?.etat==='occupe' && lits[0].etat_depuis ? T(`Lit occupé depuis : ${date(lits[0].etat_depuis)}.`,`Bed occupied since: ${date(lits[0].etat_depuis)}.`):'',
      cvs[0]?T(`Civière ${cvs[0].code}${cvs[0].arrivee_le ? ' depuis '+date(cvs[0].arrivee_le) : ''} ; patient encore aux urgences.`,`Stretcher ${cvs[0].code}${cvs[0].arrivee_le?' since '+date(cvs[0].arrivee_le):''}; patient still in emergency.`):T('Aucune civière occupée enregistrée pour ce patient.','No occupied stretcher recorded for this patient.'),
      ds.length?ds.map(d=>T(`Admission n° ${d.id} : ${d.statut}${d.statut==='admise'&&d.terminee_le?' ; confirmée le '+date(d.terminee_le):''}.`,`Admission #${d.id}: ${etat(d.statut)}${d.statut==='admise'&&d.terminee_le?' ; confirmed on '+date(d.terminee_le):''}.`)).join('\n'):T('Aucune demande d’admission enregistrée.','No admission request recorded.')].filter(Boolean).join('\n'));
  }
  const nomsSources={'Transferts communs (liens internes et état courant)':'Shared transfers (internal links and current state)','Journal du transfert commun':'Shared transfer audit log','Lits, civières, dossiers et admissions de l’établissement autorisé':'Beds, stretchers, records and admissions of the authorized facility'};
  return {mode:'local',moteur:'og-outils',langue,intentions:['patient'],reponse:blocs.join('\n\n'),sources:[...sources].map(module=>({module:en?(nomsSources[module]||module):module,lu_le:new Date().toISOString()})),faits,estimations:[],manquants};
}
module.exports={repondreSuivi,estRechercheCapacite};
