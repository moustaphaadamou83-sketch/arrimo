/**
 * OG, copilote transversal : questions libres en français sur tout ce qu'Arrimo gère.
 * - Compréhension : intentions reconnues par indices pondérés et synonymes (pas une correspondance exacte de phrase),
 *   entités extraites (numéro de lit, type d'unité, durée, horizon, établissement), questions composées, contexte de la conversation.
 * - Réponses : uniquement des données lues par les fonctions métier existantes, avec leurs contrôles d'accès
 *   (établissement de l'utilisateur, partage réseau). OG n'invente aucun numéro de lit, aucune heure, aucune capacité.
 * - Chaque réponse distingue faits, estimations et données manquantes, et cite ses sources avec leur heure de lecture.
 * - OG ne décide rien : il propose des actions que l'utilisateur habilité réalise dans l'interface.
 */
const s = require('./services');
const t = require('./terrain');
const civ = require('./civieres');
const vig = require('./vigilance');
const suivi = require('./og-suivi');
const { exigerEtablissement } = require('./auth');

const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’']/g, ' ').replace(/[^a-z0-9\-\s?:]/g, ' ').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ contexte de conversation (mémoire courte, par utilisateur) */
const CONTEXTES = new Map();
const DUREE_CONTEXTE_MS = 30 * 60000;
function contexte(utilisateur, etabId) {
  const cle = `${utilisateur.id}:${etabId}`;
  const c = CONTEXTES.get(cle);
  if (c && Date.now() - c.le < DUREE_CONTEXTE_MS) return c;
  return null;
}
function memoriser(utilisateur, etabId, valeur) {
  if (CONTEXTES.size > 5000) CONTEXTES.clear();
  CONTEXTES.set(`${utilisateur.id}:${etabId}`, { ...valeur, le: Date.now() });
}

/* ------------------------------------------------------------------ entités */
// Synonymes usuels → code de type d'unité (catalogue). L'ordre compte : le plus spécifique d'abord.
const SYNONYMES_TYPES = [
  ['SIN', /(soins intensifs neonat|usi neonat|\bsin\b|reanimation neonat)/],
  ['NEO', /(neonat|nouveau-ne|nouveaux-nes|nourrisson)/],
  ['SIP', /(soins intensifs pediat|usi pediat|\bsip\b|reanimation pediat|intensifs? (pour |des )?enfants?)/],
  ['URG-PED', /(urgences? pediat)/],
  ['CHIR-PED', /(chirurgie pediat|chir ped)/],
  ['CARDIO-PED', /(cardio\w* pediat)/],
  ['NEURO-PED', /(neuro\w* pediat)/],
  ['HEMONC-PED', /(hemato\w*|oncolog\w*)/],
  ['PED', /(pediatri|enfants?\b|\bped\b)/],
  ['SI', /(soins intensifs|intensif|\busi\b|\bsi\b|reanimation|\brea\b)/],
  ['CHIR', /(chirurg|\bchir\b|bloc operatoire)/],
  ['MAT', /(maternit|obstetri|accouch|naissance)/],
  ['READ', /(readapt|reeduc)/],
  ['GER', /(geriatr|personnes? agees?)/],
  ['PSY', /(psychiatr|sante mentale)/],
  ['MED', /(medecine|\bmed\b|medical)/],
];

function typesMentionnes(qn, types) {
  const trouves = [];
  let reste = qn;
  for (const [code, re] of SYNONYMES_TYPES) {
    const m = reste.match(re);
    if (m) {
      const ty = types.find((x) => x.code === code);
      if (ty) trouves.push(ty);
      reste = reste.replace(re, ' ');
    }
  }
  // Noms de types configurés par l'établissement (catalogue extensible)
  for (const ty of types) {
    if (trouves.includes(ty)) continue;
    const n = norm(ty.nom);
    if (n.length >= 5 && reste.includes(n)) trouves.push(ty);
  }
  return trouves;
}

function dureeMentionnee(qn) {
  const m = qn.match(/(plus de|depuis plus de|au-dela de|superieur a|>|depuis|de plus de)\s*(\d+)\s*(h\b|heures?|min\b|minutes?|j\b|jours?)/)
    || qn.match(/(\d+)\s*(h\b|heures?|min\b|minutes?|j\b|jours?)/);
  if (!m) {
    if (/quatre heures/.test(qn)) return 240;
    if (/trois heures/.test(qn)) return 180;
    if (/deux heures/.test(qn)) return 120;
    if (/une heure/.test(qn)) return 60;
    return null;
  }
  const n = Number(m[m.length - 2]); const u = m[m.length - 1];
  return u.startsWith('min') ? n : u.startsWith('j') ? n * 1440 : n * 60;
}

function horizonMentionne(qn) {
  if (/demain/.test(qn)) return { jour: 'demain', libelle: 'demain' };
  if (/(aujourd hui|aujourdhui|ce jour|today)/.test(qn)) return { jour: 'aujourdhui', libelle: 'aujourd’hui' };
  if (/(ce soir|cette nuit)/.test(qn)) return { horizon: 12, libelle: 'd’ici ce soir (12 h)' };
  const m = qn.match(/(prochaines?|d ici|dans les?)\s*(\d+)\s*h/);
  if (m) { const h = Number(m[2]); return { horizon: h <= 4 ? 4 : h <= 12 ? 12 : h <= 24 ? 24 : 48, libelle: `dans les ${h} prochaines heures` }; }
  return null;
}

function nombreMentionne(qn) {
  const m = qn.match(/\b(\d{1,2})\s*(premieres?|principales?|situations?|priorites?)/) || qn.match(/(trois|3)\s*(situations|priorit|premi)/);
  if (!m) return null;
  return /trois|3/.test(m[1]) ? 3 : Number(m[1]);
}

/** Établissements cités : nom complet, mot distinctif, « hôpital C », ou lettre seule en majuscule dans la question d'origine. */
function etablissementsMentionnes(question, qn, etabs) {
  // Ne pas lire le suffixe A/B/C d’un code de lit comme un hôpital.
  question = String(question).replace(/\b[A-Z]{1,8}-[A-Z]{0,4}-?\d{1,12}[A-Z]?\b/gi, ' ');
  const res = [];
  for (const e of etabs) {
    const n = norm(e.nom);
    const lettre = n.match(/^hopital ([a-z])\b/)?.[1];
    const motsDistinctifs = n.split(/[\s—-]+/).filter((w) => w.length >= 6 && !['hopital', 'centre', 'hospitalier', 'regional', 'sante'].includes(w));
    const alias = (e.alias || []).map(norm);
    if (qn.includes(n) || motsDistinctifs.some((w) => qn.includes(w)) || alias.some((a) => new RegExp(`\\b${a}\\b`).test(qn))
      || (lettre && (new RegExp(`hopital ${lettre}\\b`).test(qn) || new RegExp(`(^|[^A-Za-zÀ-ÿ])${lettre.toUpperCase()}([^A-Za-zÀ-ÿ]|$)`).test(question)))) {
      res.push(e);
    }
  }
  return res;
}

function litsMentionnes(question, lits) {
  const codes = (String(question).toUpperCase().replace(/\bP-\d+\b/g, '').match(/\b[A-Z]{1,8}-?[A-Z]{0,4}-?\d{1,4}[A-Z]?\b/g) || []);
  const res = [];
  for (const c of codes) {
    const l = lits.find((x) => x.code.toUpperCase() === c || x.code.toUpperCase().replace(/-/g, '') === c.replace(/-/g, ''));
    if (l && !res.includes(l)) res.push(l);
  }
  return { trouves: res, inconnus: codes.filter((c) => !res.some((l) => l.code.toUpperCase().replace(/-/g, '') === c.replace(/-/g, ''))) };
}

/* ------------------------------------------------------------------ intentions (indices pondérés) */
const INTENTIONS = [
  ['synchronisation', [[/(synchron|synchro|connecteur|interoper|evenements? (extern|simul))/, 4]]],
  ['etat', [[/(etat actuel|etat de (mon|notre|l) ?(hopital|etablissement)|situation (actuelle|generale)|comment (va|se porte)|vue d ensemble|tableau de bord)/, 3], [/(\betat\b|resume)/, 1]]],
  ['priorites', [[/(priorit|classement|rang des demandes|ordre des demandes|plus urgent|que (dois|devons|faut)|quoi faire|par ou commencer|situations? (prioritaires?|critiques?))/, 3]]],
  ['actions', [[/(actions?.{0,25}(attendu|a faire|a mener|a realiser)|qu (est-ce qu|est ce qu)? ?on doit faire|que (devons|doit) (nous|on|l equipe) faire|taches?|attendu\w* de (notre|mon|l) equipe|a faire aujourd|liste de travail)/, 4]]],
  ['lit', [[/\blit\b.*(conge|prevu|confirme|etat|statut|reserv|occup)|(conge|statut|etat) du lit/, 2]]],
  ['conges', [[/(conges?|sorties? prevues?|departs? prevus?|vont se liberer|se liberer|liberations?|liberes? (aujourd|demain|ce soir|dans)|libereront|disponibilites? prevues?)/, 3]]],
  ['lits_occupes', [[/lits?.{0,60}occup/, 5]]],
  ['procedure', [[/(prochaine etape|etape suivante|apres l organisation|apres.{0,35}transport)/, 6]]],
  ['lits_libres', [[/(lits? (libres?|disponibles?|vacants?)|libres? en|disponibles? en|places? (libres?|disponibles?)|combien de lits)/, 3]]],
  ['reserves', [[/(reserves?|reservations?)/, 3]]],
  ['non_confirmes', [[/(non confirm|pas confirm|perime|confirmation|a confirmer|disponibilite (non|pas))/, 4]]],
  ['nettoyage', [[/(nettoy|menage|entretien|desinfect)/, 3]]],
  ['attente', [[/(attend\w* (un |d un )?lit|en attente d (un )?lit|file d admission|admissions? en attente|patients? qui attendent|attente)/, 3]]],
  ['civieres', [[/(civiere|brancard|corridor|couloir)/, 3]]],
  ['urgence', [[/(urgences?\b|\burg\b)/, 1]]],
  ['transferts', [[/(transferts?|demandes? de transfert)/, 2], [/(attend\w* (une )?reponse|a repondre|en attente|en cours)/, 1]]],
  ['pourquoi', [[/(pourquoi|plutot que|au lieu de|explique)/, 3]]],
  ['pediatrie', [[/(pediatri|enfants?|neonat)/, 1], [/(etablissements?|hopitaux|reseau|ailleurs|ou trouver|compatibles?)/, 1]]],
  ['alertes', [[/(alertes?|bloqu|blocages?|goulots?|problemes?|anomalies?)/, 3]]],
  ['capacites', [[/(capacit\w* par|par departement|par specialite|par service|par unite|par type)/, 4], [/(capacit|departements?|specialites?)/, 1]]],
  ['nsa', [[/(\bnsa\b|niveau de soins alternatif|chsld|hebergement|orientation)/, 3]]],
  ['previsions', [[/(satur|deborde|prevision|prevoir|sera(s|i)? (plein|sature)|ce soir.*(plein|sature))/, 3]]],
  ['reseau', [[/(niveaux? d alerte|reseau|voisins|autres hopitaux|dans la region)/, 2]]],
  ['destination', [[/(ou (envoyer|trouver|transferer|placer)|le plus proche|plus vite|ailleurs|meilleure option|quel (hopital|etablissement))/, 3]]],
];

function detecterIntentions(qn) {
  const scores = [];
  for (const [nom, indices] of INTENTIONS) {
    let sc = 0; let pos = Infinity;
    for (const [re, poids] of indices) {
      const m = qn.match(re);
      if (m) { sc += poids; pos = Math.min(pos, m.index); }
    }
    if (sc) scores.push({ nom, sc, pos });
  }
  return scores;
}

/** Choix des intentions à traiter, avec les règles de priorité entre intentions voisines. */
function choisir(scores, entites) {
  const a = new Map(scores.map((x) => [x.nom, x]));
  const has = (n) => a.has(n);
  // « Le lit X a-t-il un congé ? » : question sur un lit précis
  if (entites.lits.length && (has('conges') || has('lit') || has('reserves') || has('etat') || has('nettoyage') || !scores.length)) {
    a.delete('conges'); a.delete('etat'); a.delete('reserves'); a.delete('nettoyage');
    a.set('lit', { nom: 'lit', sc: 5, pos: 0 });
  }
  if (entites.lits.length && a.has('lit')) a.delete('lits_occupes');
  if (a.has('lits_occupes')) a.delete('lits_libres');
  if (has('procedure')) return ['procedure'];
  if (has('pourquoi') && (entites.lits.length || entites.litsInconnus?.length)) return entites.lits.length ? ['attribution_locale'] : [];
  if (has('non_confirmes')) { a.delete('lits_libres'); }
  if (has('pourquoi')) { a.delete('transferts'); a.delete('reseau'); a.delete('lits_libres'); a.delete('destination'); }
  if (has('priorites') && /(demand|admission|classement|rang|ordre)/.test(entites.qn)
    && !/(transfert|hopital [abc]|etablissement [abc]|plutot que|au lieu de)/.test(entites.qn)) a.delete('pourquoi');
  if (has('destination')) { a.delete('lits_libres'); a.delete('reseau'); if (has('pediatrie')) a.delete('destination'); }
  if (has('pediatrie') && (a.get('pediatrie').sc < 2) && !has('lits_libres')) a.delete('pediatrie');
  if (has('pediatrie') && has('lits_libres') && /etablissement|hopitaux|reseau|ailleurs/.test(entites.qn)) a.delete('lits_libres');
  else if (has('pediatrie') && has('lits_libres')) a.delete('pediatrie');
  if (has('actions')) { a.delete('priorites'); a.delete('attente'); a.delete('transferts'); a.delete('etat'); }
  if (has('etat') && a.get('etat').sc < 3 && a.size > 1) a.delete('etat');
  if (has('civieres')) a.delete('urgence');
  if (has('attente') && has('urgence')) a.delete('urgence');
  if (has('urgence') && a.size > 1) a.delete('urgence');
  if (has('transferts') && a.get('transferts').sc < 2) a.delete('transferts');
  if (has('conges') && has('lits_libres') && /(vont|va|prevu|liberer|demain|aujourd|ce soir)/.test(entites.qn)) a.delete('lits_libres');
  if (has('alertes') && has('reseau') && /niveau/.test(entites.qn)) a.delete('alertes');
  if (has('capacites') && a.get('capacites').sc < 2 && a.size > 1) a.delete('capacites');
  if (has('reserves') && has('conges')) a.delete('conges');
  if (has('previsions') && has('conges')) a.delete('previsions');
  if (has('nettoyage') && has('actions')) a.delete('nettoyage');
  return [...a.values()].sort((x, y) => x.pos - y.pos).map((x) => x.nom);
}

/* ------------------------------------------------------------------ mise en forme */
function fabriqueQuand(fuseau) {
  const fmtJour = new Intl.DateTimeFormat('fr-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' });
  const fmtH = new Intl.DateTimeFormat('fr-CA', { timeZone: fuseau, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const fmtD = new Intl.DateTimeFormat('fr-CA', { timeZone: fuseau, day: 'numeric', month: 'short' });
  const heure = (d) => fmtH.format(new Date(d)).replace(':', ' h ').replace(/^0/, '');
  return (d) => {
    if (!d) return 'heure non renseignée';
    const j = fmtJour.format(new Date(d)); const auj = fmtJour.format(new Date());
    const dem = fmtJour.format(new Date(Date.now() + 86400000)); const hier = fmtJour.format(new Date(Date.now() - 86400000));
    const prefixe = j === auj ? 'aujourd’hui' : j === dem ? 'demain' : j === hier ? 'hier' : `le ${fmtD.format(new Date(d))}`;
    return `${prefixe} à ${heure(d)}`;
  };
}
const duree = (min) => vig.dureeTexte(min);
const CONF = { capacite_confirmee: 'disponibilité confirmée', capacite_perimee: 'confirmation périmée', capacite_non_confirmee: 'disponibilité non confirmée' };
const STATUT_CONGE = { prevu: 'prévu', confirme: 'confirmé', attente_transport: 'en attente de transport', reporte: 'reporté', annule: 'annulé', realise: 'réalisé' };
const ETAT = { libre: 'libre', reserve: 'réservé', occupe: 'occupé', nettoyage: 'en nettoyage', indispo: 'hors service' };
const ORIENT = { chsld: 'CHSLD', ri: 'ressource intermédiaire', readaptation: 'réadaptation', domicile: 'domicile', palliatif: 'soins palliatifs', autre: 'autre' };

/* ------------------------------------------------------------------ moteur */
async function repondre(pool, utilisateur, etabId, question, { historique } = {}) {
  exigerEtablissement(utilisateur, etabId);
  const moteurPatients=require('./og-recherche-patients');
  const rechercheNom=moteurPatients.extraireRecherche(question);
  if (rechercheNom) {
    const en=utilisateur.langue==='en';
    // Identités fictives : démo et recette seulement. Ailleurs, OG répond sans erreur et sans chercher.
    // Contrôles sans requête d'abord (environnement), puis fonction OG « patients » de l'établissement.
    let autorise = true; try { require('./patients').exigerFictifs(); } catch { autorise = false; }
    if (autorise) autorise = (await require('./og-configuration').lire(pool, etabId)).effectif.patients;
    const resultat = autorise ? await moteurPatients.rechercher(pool, utilisateur, etabId, rechercheNom) : null;
    if (!resultat) return {mode:'local',moteur:'og-outils',intentions:['patient'],reponse:en?'Patient search by name is not available in this environment. Use the patient reference (for example P-00000).':'La recherche de patients par nom n’est pas disponible dans cet environnement. Utilisez la référence du patient (par exemple P-00000).',sources:[]};
    const reponse=resultat.resultats.length>1
      ? (en?'Several records match. Select the correct file; a name alone does not confirm identity.':'Plusieurs dossiers correspondent. Sélectionnez le bon dossier; le nom seul ne confirme pas l’identité.')
      : resultat.resultats.length
        ? (en?'Possible match. Verify identity before viewing.':'Correspondance proposée. Vérifiez l’identité avant consultation.')
        : (en?'No result in this hospital.':'Aucun résultat dans cet établissement.');
    return {mode:'local',moteur:'og-outils',intentions:['patient'],reponse,patients:resultat.resultats,limite:resultat.limite,sources:[{module:en?'Authorized patient records':'Dossiers patients autorisés',lu_le:new Date().toISOString()}],faits:[],estimations:[],manquants:[]};
  }
  const precedent=contexte(utilisateur,etabId);
  let questionSuivi=question;
  if (precedent?.suivi && !/\b(?:P|TR)-\d+\b/i.test(question) && !/\b[A-Z][A-Z-]*-\d+/i.test(question)
      && /^(?:et )?(?:ou est[- ]il|ou se trouve|dans quel|quel est son|est[- ]il|a[- ]t[- ]il|son |sa |le patient|quelle est sa)/.test(norm(question))) {
    questionSuivi=question+' '+precedent.suivi;
  }
  const parcours = await suivi.repondreSuivi(pool, utilisateur, etabId, questionSuivi);
  if (parcours) {
    memoriser(utilisateur,etabId,{intentions:['patient'],suivi:(questionSuivi.match(/\b(?:P|TR)-\d{1,12}\b/gi)||[]).join(' ')});
    return parcours;
  }
  const etab = await s.etablissement(pool, etabId);
  s.exigerActif(etab);
  const quand = fabriqueQuand(etab.config.fuseau);
  const qn = norm(question);
  const lu = new Map();       // sources consultées → heure de lecture
  const noter = (src) => lu.set(src, new Date());
  const cache = {};
  const charger = async (cle, fn, src) => { if (!(cle in cache)) { cache[cle] = await fn(); noter(src); } return cache[cle]; };
  const lits = () => charger('lits', () => s.litsEtablissement(pool, utilisateur, etabId), 'Lits');
  const types = (await pool.query('SELECT id, code, nom, groupe_age FROM types_unite WHERE config_id = $1 ORDER BY ordre', [etab.config_id])).rows;
  const reseauEtabs = (await pool.query(
    `SELECT id, nom, partage FROM etablissements WHERE config_id = $1 AND module_actif AND actif AND (partage <> 'aucun' OR id = $2)`,
    [etab.config_id, etabId])).rows;

  const entites = { qn, types: typesMentionnes(qn, types), duree: dureeMentionnee(qn), horizon: horizonMentionne(qn), nombre: nombreMentionne(qn),
    etabs: etablissementsMentionnes(question, qn, reseauEtabs.filter((e) => e.id !== etabId)), lits: [], litsInconnus: [] };
  const lm = litsMentionnes(question, await lits());
  entites.lits = lm.trouves; entites.litsInconnus = lm.inconnus;

  const references = [...new Set(String(question).toUpperCase().match(/\bP-\d{1,12}\b/g) || [])];
  const rechercheReseau = suivi.estRechercheCapacite(question) && (references.length || /\b(?:cherch\w*|trouv\w*|recherch\w*) (?:un|des|de) lit/.test(qn)) && !/chez nous|\bici\b|notre etablissement/.test(qn);
  const recherchePatient = references.length && rechercheReseau;
  let intentions = rechercheReseau ? ['pourquoi'] : references.length ? ['patient'] : choisir(detecterIntentions(qn), entites);
  // Un établissement cité n'autorise jamais la lecture de ses patients ou lits locaux.
  if (entites.etabs.length && intentions.some(x => ['patient', 'lits_occupes', 'lit', 'attribution_locale', 'civieres', 'attente', 'transferts'].includes(x))) {
    const cible = entites.etabs[0];
    exigerEtablissement(utilisateur, cible.id);
    if (entites.etabs.length > 1) return { mode: 'local', reponse: 'Précisez un seul établissement pour cette recherche.', sources: [] };
    return repondre(pool, utilisateur, cible.id, question, {});
  }
  // Références au contexte : « et en chirurgie ? », « et demain ? », « ce lit », « celui-ci »
  const ctx = contexte(utilisateur, etabId) || historique || null;
  let suite = false;
  const courte = qn.split(' ').length <= 6 || /^(et|aussi|pareil|meme chose|idem)\b/.test(qn);
  if (!intentions.length && !entites.litsInconnus.length && !references.length && courte && ctx && ctx.intentions?.length && (entites.types.length || entites.horizon || entites.duree || entites.etabs.length || entites.lits.length || /^(et|aussi|pareil|meme chose|idem)\b/.test(qn))) {
    const avecType = ['lits_libres', 'lits_occupes', 'attente', 'conges', 'alertes', 'reserves', 'pourquoi', 'pediatrie', 'capacites', 'destination', 'previsions'];
    intentions = entites.types.length ? ctx.intentions.filter((x) => avecType.includes(x)) : ctx.intentions;
    if (!intentions.length) intentions = ctx.intentions;
    suite = true;
  }
  const refLit = /(ce lit|celui-ci|celui ci|ce meme lit|le meme lit)/.test(qn) && !entites.lits.length;
  if (refLit && ctx?.lits?.length) {
    const l = (await lits()).find((x) => x.code === ctx.lits[0]);
    if (l) { entites.lits = [l]; intentions = ['lit', ...intentions.filter((x) => !['lit', 'conges', 'reserves', 'nettoyage', 'etat'].includes(x))]; }
  } else if (refLit) {
    return { mode: 'local', moteur: 'og-outils', intentions: [], reponse: 'De quel lit parlez-vous ? Indiquez son numéro (par exemple « MED-204A ») : OG ne devine pas un lit.', sources: [], faits: [], estimations: [], manquants: ['numéro de lit'] };
  }
  if (suite && !entites.types.length && ctx?.types?.length) entites.types = types.filter((x) => ctx.types.includes(x.code));

  const blocs = [];
  const faits = []; const estimations = []; const manquants = []; const actions = [];
  const outils = {
    async patient() {
      const ls = await lits();
      const file = await charger('file', () => t.fileAdmission(pool, utilisateur, etabId), 'Admissions');
      const { civieres } = await charger('civ', () => civ.listeCivieres(pool, utilisateur, etabId), 'Urgences');
      const transferts = await charger('transferts', () => s.listeTransferts(pool, utilisateur, etabId), 'Transferts');
      for (const ref of references) {
        const lit = ls.find(x => x.patient_ref === ref && ['occupe', 'reserve'].includes(x.etat));
        const demande = file.find(x => x.patient_ref === ref);
        const civiere = civieres.find(x => x.patient_ref === ref && x.etat === 'occupee');
        const tr = transferts.filter(x => x.patient_ref === ref);
        if (!lit && !demande && !civiere && !tr.length) {
          blocs.push(`Aucune situation active accessible pour ${ref} dans ${etab.nom}. Une absence de résultat ne signifie pas que le patient n’existe pas ailleurs.`);
          manquants.push('situation du patient dans le périmètre autorisé');
          continue;
        }
        blocs.push([`Patient ${ref} — ${etab.nom}.`,
          lit ? `Statut : ${lit.etat === 'occupe' ? 'admis' : 'lit réservé, admission à confirmer'} ; lit ${lit.code} (${lit.unite}).` : 'Aucun lit occupé ou réservé enregistré ici.',
          demande ? `Admission : ${demande.statut} ; ${demande.priorite_affichage}. ${demande.priorite_explication}` : '',
          civiere ? `Civière ${civiere.code} depuis ${duree(civiere.heures * 60)}.` : '',
          ...tr.map(x => `Transfert ${x.numero} : ${x.statut}.`)].filter(Boolean).join('\n'));
      }
    },
    async lits_occupes() {
      let ls = (await lits()).filter(x => x.etat === 'occupe');
      if (entites.types.length) ls = ls.filter(x => entites.types.some(ty => ty.id === x.type_id));
      blocs.push(`Lits occupés${entites.types.length ? ' en ' + entites.types.map(x => x.nom.toLowerCase()).join(', ') : ''} — ${etab.nom} : ${ls.length}.`);
    },
    async procedure() {
      if (!/transport/.test(qn)) {
        blocs.push('Précisez la procédure concernée : admission, attribution de lit ou transfert.');
        manquants.push('procédure concernée');
        return;
      }
      blocs.push('Après l’organisation du transport (statut transport), l’équipe habilitée confirme le départ réel : le transfert passe en route. L’établissement receveur confirme ensuite la réception (statut reçu). Le transport organisé ne prouve ni le départ ni l’arrivée ; chaque étape est validée par une personne habilitée dans Transferts.');
      noter('Procédure Transferts (moteur métier)');
    },
    async attribution_locale() {
      const file = await charger('file', () => t.fileAdmission(pool, utilisateur, etabId), 'Admissions');
      for (const lit of entites.lits) {
        const d = file.find(x => x.lit_suggere?.id === lit.id || x.lit_id === lit.id);
        blocs.push(`Lit ${lit.code} — ${etab.nom} : ${ETAT[lit.etat]}.`);
        if (d?.lit_suggere?.id === lit.id) {
          blocs.push(`Proposition locale actuelle pour ${d.patient_ref} : lit libre du type demandé, compatible avec le groupe d’âge et les besoins enregistrés. Le moteur départage ensuite par isolement, pression négative, ventilation, télémétrie, puis code du lit. ${d.priorite_affichage}. ${d.priorite_explication}`);
        } else {
          blocs.push('Règle locale actuelle : lit libre du type demandé, groupe d’âge et besoins compatibles ; départage par isolement, pression négative, ventilation, télémétrie, puis code.');
          manquants.push(`critères historiques de proposition de ${lit.code} non conservés dans cette réponse ; les critères actuels ne prouvent pas la justification passée`);
        }
        actions.push('Faire confirmer la compatibilité clinique et l’attribution par l’équipe habilitée.');
      }
    },
    async etat() {
      const al = await charger('alerte', () => t.niveauAlerte(pool, etabId, 'fr'), 'Accueil (niveau d’alerte)');
      const ls = await lits();
      const n = (e) => ls.filter((l) => l.etat === e).length;
      const libres = ls.filter((l) => l.etat === 'libre');
      const conf = libres.filter((l) => l.disponibilite_confirmation === 'capacite_confirmee').length;
      const file = await charger('file', () => t.fileAdmission(pool, utilisateur, etabId), 'Admissions');
      const tr = await charger('transferts', () => s.listeTransferts(pool, utilisateur, etabId), 'Transferts');
      const aRepondre = tr.filter((x) => x.destination_id === etabId && x.statut === 'demande').length;
      const nsa = await charger('nsa', () => t.listeNsa(pool, utilisateur, etabId), 'NSA');
      const v = await charger('vig', () => vig.blocages(pool, utilisateur, etabId), 'Alertes');
      const niv = { vert: 'vert', jaune: 'jaune', orange: 'orange', rouge: 'rouge' }[al.niveau];
      const lignes = [
        `${etab.nom} est au niveau ${niv.toUpperCase()} (pression ${al.pression} % : lits occupés + patients en attente, rapportés aux lits en service).`,
        `• Lits : ${n('libre')} libres (${conf} confirmés), ${n('reserve')} réservés, ${n('occupe')} occupés, ${n('nettoyage')} en nettoyage, ${n('indispo')} hors service.`,
        `• Admissions : ${file.filter((d) => d.statut === 'attente').length} patients attendent un lit, ${file.filter((d) => d.statut === 'assignee').length} ont un lit assigné.`,
      ];
      if (al.urgence) lignes.push(`• Urgence : ${al.urgence.occupees} civières occupées sur ${al.urgence.fonctionnelles} en service (${al.urgence.taux} %), ${al.urgence.en_corridor} en corridor, ${al.urgence.plus_24h} patients depuis plus de 24 h.`);
      lignes.push(`• Transferts : ${aRepondre} demandes reçues attendent votre réponse ; ${tr.filter((x) => x.statut !== 'recu' && x.statut !== 'refuse').length} transferts en cours.`);
      lignes.push(`• NSA : ${nsa.total} patients (${nsa.taux} % des lits occupés ; cible ${nsa.cible} %).`);
      if (v.alertes.length) lignes.push(`• Alertes : ${v.alertes.length} (${v.alertes.filter((x) => x.niveau === 'eleve').length} bloquantes). Demandez « Quelles alertes bloquent notre unité ? » pour le détail.`);
      blocs.push(lignes.join('\n'));
      faits.push('compteurs lus en direct dans la base');
    },
    async synchronisation() {
      const rapport = await charger('simulation', () => require('./simulation-connecteurs').supervision(pool, utilisateur, etabId), 'Journal des connecteurs simulés');
      blocs.push(rapport.connecteurs.length ? ['Connecteurs fictifs de votre établissement :', ...rapport.connecteurs.map((c) =>
        `• ${c.nom} : ${c.appliques} événements appliqués, ${c.en_attente} en attente, ${c.a_verifier} conflits ou rejets à vérifier. Dernière date source appliquée : ${c.derniere_date_source ? quand(c.derniere_date_source) : 'aucune'}. Dernier traitement Arrimo : ${c.dernier_traitement ? quand(c.dernier_traitement) : 'aucun'}.`),
        'Une lecture actuelle ne prouve pas que la source est fraîche. Les événements en attente ne sont pas appliqués ; leur rejeu exige le compte qui les a confirmés. Aucune intégration hospitalière réelle n’est attestée.'].join('\n') : 'Aucun connecteur simulé configuré pour cet établissement. Aucune intégration réelle n’est attestée.');
    },
    async priorites() {
      if (/(demand|patient|admission|classement|class\w*|rang|ordre)/.test(qn)) {
        const file = await charger('file', () => t.fileAdmission(pool, utilisateur, etabId), 'Admissions et priorités validées');
        const attente = file.filter((d) => d.statut === 'attente');
        blocs.push(attente.length ? ['Demandes en attente : priorités validées selon le référentiel de l’établissement, puis demandes à valider.',
          ...attente.slice(0, entites.nombre || 20).map((d, i) => `${i + 1}. Demande ${d.id} · ${d.patient_ref} · ${d.type_nom} · ${d.priorite_affichage}. ${d.priorite_explication}${d.lit_suggere ? ` Lit compatible proposé : ${d.lit_suggere.code} (âge, unité et équipements demandés).` : ' Aucun lit compatible libre local.'}`),
          'OG ne valide ni ne modifie les priorités. L’équipe confirme toute attribution.'].join('\n') : 'Aucune demande en attente.');
        return;
      }
      const b = await charger('briefing', () => require('./copilote').briefing(pool, utilisateur, etabId), 'Recommandations OG');
      const n = entites.nombre || 3;
      const recos = b.recommandations.slice(0, n);
      if (!recos.length) { blocs.push('Aucune situation prioritaire détectée dans les données actuelles.'); return; }
      blocs.push(`Les ${recos.length} situations prioritaires maintenant :\n${recos.map((r, i) => `${i + 1}. ${r.titre}${r.detail ? ` — ${String(r.detail).split('\n')[0]}` : ''}`).join('\n')}`);
      actions.push('Chaque recommandation propose une action dans l’onglet OG ; c’est vous qui la réalisez.');
    },
    async lit() {
      for (const l of entites.lits) {
        const j = (await pool.query(`SELECT date, action, detail FROM journal WHERE lit_id = $1 AND NOT refuse ORDER BY date DESC LIMIT 1`, [l.id])).rows[0];
        noter('Journal');
        const g = (await pool.query(`SELECT statut, sortie_prevue, depart_reel_le, maj_le FROM conges WHERE lit_id = $1 ORDER BY id DESC LIMIT 1`, [l.id])).rows[0];
        noter('Congés');
        const lignes = [`Lit ${l.code} (${l.unite}, chambre ${l.chambre}) : ${ETAT[l.etat]} depuis ${duree((Date.now() - new Date(l.etat_depuis)) / 60000)}${l.patient_ref ? ` · patient ${l.patient_ref}` : ''}.`];
        if (l.etat === 'occupe') {
          if (l.sortie_prevue || l.conge_statut) {
            const st = STATUT_CONGE[l.conge_statut || 'prevu'];
            const retard = l.sortie_prevue && new Date(l.sortie_prevue) < new Date();
            lignes.push(`• Congé ${st}${l.sortie_prevue ? ` pour ${quand(l.sortie_prevue)}` : ' (heure non renseignée)'}${retard ? ' — heure dépassée sans départ enregistré : vérification nécessaire (le lit reste occupé)' : ''}.`);
            lignes.push(l.conge_statut === 'confirme' ? '• Fait : congé confirmé par l’équipe.' : '• Le congé est prévu, pas encore confirmé : le lit n’est pas libre.');
          } else lignes.push('• Aucun congé prévu ni confirmé n’est enregistré pour ce lit.');
          if (l.nsa_depuis) lignes.push(`• Patient en NSA depuis ${duree((Date.now() - new Date(l.nsa_depuis)) / 60000)} (orientation : ${ORIENT[l.nsa_orientation] || l.nsa_orientation}).`);
        } else if (g && ['realise', 'annule'].includes(g.statut) && Date.now() - new Date(g.maj_le) < 86400000) {
          lignes.push(`• Dernier congé : ${STATUT_CONGE[g.statut]}${g.depart_reel_le ? `, départ réel ${quand(g.depart_reel_le)}` : ''}.`);
        }
        if (l.etat === 'libre') lignes.push(`• ${CONF[l.disponibilite_confirmation] || ''}${l.disponibilite_confirmee_le ? ` (${quand(l.disponibilite_confirmee_le)}${l.disponibilite_confirmee_par ? ` par ${l.disponibilite_confirmee_par}` : ''})` : ''}.`);
        if (l.etat === 'reserve') lignes.push(l.transfert_numero ? `• Réservé pour le transfert ${l.transfert_numero}.` : '• Réservation locale (voir Admissions si une demande y est liée).');
        if (l.etat === 'nettoyage') lignes.push(l.nettoyage_debut ? `• Nettoyage commencé ${quand(l.nettoyage_debut)}.` : '• Nettoyage pas encore commencé.');
        if (l.blocage_motif) lignes.push(`• Alerte : ${l.blocage_motif}.`);
        if (j) lignes.push(`• Dernier événement : ${j.action}${j.detail ? ` (${j.detail})` : ''}, ${quand(j.date)}.`);
        blocs.push(lignes.join('\n'));
      }
    },
    async conges() {
      const f = entites.horizon || { horizon: 24, libelle: 'dans les 24 prochaines heures' };
      const c = await charger(`conges-${f.jour || f.horizon}`, () => vig.conges(pool, utilisateur, etabId, f), 'Congés');
      let lignes = c.lignes.filter((x) => !['annule'].includes(x.statut));
      if (entites.types.length) lignes = lignes.filter((x) => entites.types.some((ty) => ty.code === x.type_code));
      const ouverts = lignes.filter((x) => x.statut !== 'realise');
      const faitsL = lignes.filter((x) => x.statut === 'realise');
      if (!ouverts.length && !faitsL.length) {
        blocs.push(`Aucun congé enregistré ${f.libelle}${entites.types.length ? ` en ${entites.types.map((x) => x.nom.toLowerCase()).join(', ')}` : ''}. Un lit n’apparaît ici que si un congé a été saisi.`);
        manquants.push('congés non saisis');
        return;
      }
      const l = [`Lits dont le départ est enregistré ${f.libelle} (${ouverts.length}) :`];
      for (const x of ouverts) {
        l.push(`• ${x.lit} — ${x.unite}, chambre ${x.chambre} : congé ${STATUT_CONGE[x.statut]} ${quand(x.sortie_prevue)}${x.verification ? ` · heure dépassée de ${duree(x.retard_min)}, vérification nécessaire` : ''}${x.disponibilite_estimee ? ` · disponible vers ${quand(x.disponibilite_estimee).replace(/^(aujourd’hui|demain|hier) à /, '')} (estimation : ${x.disponibilite_estimee_regle})` : ''}.`);
      }
      if (faitsL.length) l.push(`Départs déjà réalisés : ${faitsL.map((x) => `${x.lit} (${quand(x.depart_reel_le)})`).join(', ')}.`);
      l.push('Ces lits restent occupés jusqu’au départ réel ; un congé prévu n’est pas un lit libre.');
      blocs.push(l.join('\n'));
      faits.push('congés saisis (prévus ou confirmés)');
      if (ouverts.some((x) => x.disponibilite_estimee)) estimations.push('heure de disponibilité = congé confirmé + durée cible de nettoyage');
    },
    async lits_libres() {
      let ls = (await lits()).filter((l) => l.etat === 'libre');
      if (entites.types.length) ls = ls.filter((l) => entites.types.some((ty) => ty.id === l.type_id));
      const nomT = entites.types.length ? ` en ${entites.types.map((x) => x.nom.toLowerCase()).join(', ')}` : '';
      if (!ls.length) {
        blocs.push(`Aucun lit libre${nomT} chez ${etab.nom} en ce moment.${entites.types.length ? ' Demandez « Où trouver un lit … dans le réseau ? » pour chercher ailleurs.' : ''}`);
        return;
      }
      const groupe = (cle) => ls.filter((l) => l.disponibilite_confirmation === cle);
      const l = [`Lits libres${nomT} chez ${etab.nom} : ${ls.length}.`];
      for (const [cle, lib] of [['capacite_confirmee', 'Confirmés'], ['capacite_perimee', 'Confirmation périmée'], ['capacite_non_confirmee', 'Non confirmés']]) {
        const g = groupe(cle);
        if (g.length) l.push(`• ${lib} (${g.length}) : ${g.slice(0, 15).map((x) => `${x.code} (${x.unite})`).join(', ')}${g.length > 15 ? '…' : ''}`);
      }
      if (ls.some((x) => x.disponibilite_confirmation !== 'capacite_confirmee')) actions.push('Confirmer la disponibilité des lits non confirmés pour qu’ils soient visibles par le réseau.');
      blocs.push(l.join('\n'));
    },
    async reserves() {
      const seuil = entites.duree || 0;
      const ls = (await lits()).filter((l) => l.etat === 'reserve' && (Date.now() - new Date(l.etat_depuis)) / 60000 >= seuil);
      if (!ls.length) { blocs.push(`Aucun lit réservé${seuil ? ` depuis plus de ${duree(seuil)}` : ''}.`); return; }
      const dem = (await pool.query(`SELECT lit_id, id, provenance FROM demandes_admission WHERE etablissement_id = $1 AND statut = 'assignee'`, [etabId])).rows;
      blocs.push([`Lits réservés${seuil ? ` depuis plus de ${duree(seuil)}` : ''} (${ls.length}) :`, ...ls.map((l) => {
        const d = dem.find((x) => x.lit_id === l.id);
        const cause = l.transfert_numero ? `transfert ${l.transfert_numero}` : d ? `demande d’admission n° ${d.id} (${d.provenance})` : 'réservation locale sans demande liée';
        return `• ${l.code} (${l.unite}) — ${l.patient_ref}, depuis ${duree((Date.now() - new Date(l.etat_depuis)) / 60000)} · ${cause}`;
      })].join('\n'));
      if (ls.some((l) => (Date.now() - new Date(l.etat_depuis)) / 60000 > etab.config.reservation_max_min && !l.transfert_numero)) {
        actions.push(`Au-delà de ${duree(etab.config.reservation_max_min)} (seuil configuré), vérifier avec l’équipe si la réservation doit être maintenue ; rien n’est annulé automatiquement.`);
      }
    },
    async non_confirmes() {
      const ls = (await lits()).filter((l) => l.etat === 'libre' && l.disponibilite_confirmation !== 'capacite_confirmee');
      if (!ls.length) { blocs.push('Tous les lits libres ont une disponibilité confirmée et récente.'); return; }
      blocs.push([`Lits libres dont la disponibilité n’est pas confirmée ou est périmée (${ls.length}) — invisibles pour le réseau :`,
        ...ls.map((l) => `• ${l.code} (${l.unite}) : ${CONF[l.disponibilite_confirmation]}${l.disponibilite_confirmee_le ? `, dernière confirmation ${quand(l.disponibilite_confirmee_le)}` : ''}`)].join('\n'));
      actions.push(`Vérifier physiquement puis « Confirmer la disponibilité » (valable ${duree(etab.config.confirmation_lit_validite_min)}).`);
    },
    async nettoyage() {
      const n = await charger('nettoyage', () => t.fileNettoyage(pool, utilisateur, etabId), 'Nettoyage');
      if (!n.length) { blocs.push('Aucun lit ni civière à nettoyer.'); return; }
      blocs.push([`À nettoyer, par priorité (${n.length}) :`, ...n.map((x, i) => `${i + 1}. ${x.genre === 'civiere' ? `Civière ${x.code}` : `${x.code} (${x.unite}, chambre ${x.chambre})`} — depuis ${duree(x.age_min)}${x.nettoyage_debut ? ', commencé' : ''} · ${x.raison}`)].join('\n'));
    },
    async attente() {
      const file = (await charger('file', () => t.fileAdmission(pool, utilisateur, etabId), 'Admissions')).filter((d) => d.statut === 'attente');
      const seuil = entites.duree || 0;
      const f = file.filter((d) => d.attente_min >= seuil && (!entites.types.length || entites.types.some((ty) => ty.id === d.type_id)));
      if (!f.length) {
        const longs = seuil ? file.filter((d) => d.heures_civiere != null && d.heures_civiere * 60 >= seuil) : [];
        blocs.push(`Aucune demande de lit n’attend depuis plus de ${duree(seuil || 0)} (durée comptée depuis la demande de lit).${longs.length ? `\nÀ noter : ${longs.map((d) => `${d.patient_ref} est sur civière (${d.civiere_code}) depuis ${duree(d.heures_civiere * 60)}`).join(' ; ')}.` : ''}`);
        return;
      }
      blocs.push([`${f.length} patients attendent un lit${seuil ? ` depuis plus de ${duree(seuil)}` : ''} (durée depuis la demande de lit) :`, ...f.map((d) => `• ${d.patient_ref} · ${d.type_nom} · ${d.priorite_affichage} · attend depuis ${duree(d.attente_min)}${d.civiere_code ? ` · civière ${d.civiere_code}` : ''}${d.lit_suggere ? ` · lit compatible libre : ${d.lit_suggere.code}` : ' · aucun lit compatible libre ici'} · ${d.priorite_explication}`)].join('\n'));
      if (f.some((d) => !d.lit_suggere)) actions.push('Pour les demandes sans lit compatible ici : « Chercher ailleurs » dans Admissions.');
    },
    async civieres() {
      const { civieres, stats } = await charger('civ', () => civ.listeCivieres(pool, utilisateur, etabId), 'Urgence');
      if (!stats) { blocs.push(`${etab.nom} n’a pas de civière enregistrée.`); return; }
      const seuil = entites.duree || 0;
      const occ = civieres.filter((c) => c.etat === 'occupee');
      const corridor = occ.filter((c) => c.categorie === 'debordement');
      const l = [`Urgence de ${etab.nom} : ${stats.occupees} civières occupées sur ${stats.fonctionnelles} en service (${stats.taux} %), dont ${corridor.length} en corridor ; ${stats.libres} civières libres, ${stats.nettoyage} en nettoyage.`,
        `${stats.plus_24h} patients depuis plus de 24 h, ${stats.plus_48h} depuis plus de 48 h ; ${occ.filter((c) => c.demande_id).length} ont une demande de lit, ${occ.filter((c) => !c.demande_id).length} n’en ont pas.`];
      const strict = /plus de|au-dela|superieur/.test(qn);
      // Le service expose aussi des heures arrondies : le seuil utilise l’heure d’arrivée source.
      const minutesPresence = c => c.arrivee_le && Number.isFinite(Date.parse(c.arrivee_le))
        ? (Date.now() - Date.parse(c.arrivee_le)) / 60000 : c.heures * 60;
      const liste = (/corridor|couloir/.test(qn) ? corridor : occ).filter((c) => strict ? minutesPresence(c) > seuil : minutesPresence(c) >= seuil).sort((a, b) => minutesPresence(b) - minutesPresence(a));
      const file = await charger('file', () => t.fileAdmission(pool, utilisateur, etabId), 'Admissions (priorités validées)');
      if (!liste.length) l.push(`Aucune civière occupée ne correspond au seuil de ${duree(seuil)}.`);
      if (liste.length) l.push(...liste.slice(0, 15).map((c) => `• ${c.code}${c.categorie === 'debordement' ? ' (corridor)' : ''} — ${c.patient_ref} depuis ${duree(minutesPresence(c))}${c.demande_id ? ` · demande de lit (${c.type_nom.toLowerCase()})` : ' · sans demande de lit'}`));
      for (const c of liste.slice(0, 15)) {
        const d = file.find(x => x.civiere_id === c.id);
        l.push(`${c.code} : ${d?.priorite_affichage || 'Priorité clinique non validée'}.${d?.priorite_explication ? ' ' + d.priorite_explication : ''}`);
      }
      l.push('La durée d’attente ne mesure pas la gravité médicale. Les priorités et leur réévaluation restent réservées aux professionnels habilités.');
      l.push('Une longue présence sur civière n’est pas à elle seule une indication d’hospitalisation : à interpréter par l’équipe.');
      blocs.push(l.join('\n'));
    },
    async urgence() { return outils.civieres(); },
    async transferts() {
      const tr = await charger('transferts', () => s.listeTransferts(pool, utilisateur, etabId), 'Transferts');
      const recus = tr.filter((x) => x.destination_id === etabId && x.statut === 'demande');
      const envoyes = tr.filter((x) => x.origine_id === etabId && x.statut === 'demande');
      const cours = tr.filter((x) => ['validee', 'transport', 'en_route'].includes(x.statut));
      const l = [];
      if (/en cours|actuellement/.test(qn) && !/attente|demandes/.test(qn)) {
        blocs.push(cours.length ? `Transferts en cours (${cours.length}) :\n${cours.map(x => `• ${x.numero} : ${x.origine_nom} → ${x.destination_nom} ; ${{validee: 'validé', transport: 'transport organisé', en_route: 'en route'}[x.statut]}`).join('\n')}` : 'Aucun transfert validé, en transport organisé ou en route actuellement.');
        faits.push('les demandes en attente de validation sont exclues des transferts en cours');
        return;
      }
      l.push(recus.length ? `Demandes reçues qui attendent VOTRE réponse (${recus.length}) :\n${recus.map((x) => `• ${x.numero} de ${x.origine_nom} · ${x.type_nom.toLowerCase()} · lit ${x.lit_code || 'à attribuer'} · depuis ${duree((Date.now() - new Date(x.date_demande)) / 60000)}${x.urgent ? ' · URGENT' : ''}`).join('\n')}` : 'Aucune demande reçue en attente de votre réponse.');
      l.push(envoyes.length ? `Vos demandes en attente d’une réponse (${envoyes.length}) :\n${envoyes.map((x) => `• ${x.numero} vers ${x.destination_nom} · depuis ${duree((Date.now() - new Date(x.date_demande)) / 60000)}`).join('\n')}` : 'Aucune de vos demandes n’attend de réponse.');
      if (cours.length) l.push(`En cours (${cours.length}) : ${cours.map((x) => `${x.numero} (${{ validee: 'accepté', transport: 'transport organisé', en_route: 'en route' }[x.statut]})`).join(', ')}.`);
      blocs.push(l.join('\n'));
      if (recus.length) actions.push('Répondre aux demandes reçues (Transferts) : accepter ou refuser avec un motif.');
    },
    async pourquoi() {
      // Type recherché : cité, sinon celui du dernier transfert de l'établissement
      const tr = await charger('transferts', () => s.listeTransferts(pool, utilisateur, etabId), 'Transferts');
      const dernier = tr.filter((x) => x.origine_id === etabId).sort((a, b) => new Date(b.date_demande) - new Date(a.date_demande))[0];
      const demandes = recherchePatient ? (await charger('file', () => t.fileAdmission(pool, utilisateur, etabId), 'Admissions')).filter(x => references.includes(x.patient_ref)) : [];
      if (recherchePatient && references.length!==1 || demandes.length>1) {
        blocs.push('Plusieurs situations correspondent : précisez le patient interne ou la demande d’admission avant la recherche.');manquants.push('identifiant de la demande');return;
      }
      const demande = demandes[0];
      const ty = entites.types[0] || (demande && types.find(x=>x.id===demande.type_id)) || (!recherchePatient && dernier && types.find((x) => x.id === dernier.type_id)) || (!recherchePatient && types.find((x) => x.code === 'MED')) || (!recherchePatient && types[0]);
      if (!ty) {blocs.push('Précisez le service ou la demande de lit autorisée ; OG ne devine pas les besoins du patient.');manquants.push('service recherché');return;}
      const besoins = demande ? {isolement:demande.besoin_isolement,pression_negative:demande.besoin_pression_negative,ventilation:demande.besoin_ventilation,telemetrie:demande.besoin_telemetrie,groupe_age:demande.groupe_age}
        : !recherchePatient && dernier && !entites.types.length ? { ...(dernier.besoins || {}), groupe_age: dernier.groupe_age } : {};
      const r = await charger(`reco-${ty.id}`, () => s.recommander(pool, utilisateur, etabId, ty.id, besoins), 'Réseau (recherche)');
      const l = [`Recherche d’un lit de ${ty.nom.toLowerCase()} depuis ${etab.nom} — règle : capacité confirmée d’abord, puis niveau de tension, puis durée et distance routières.`];
      if (recherchePatient && !demande) {l.push('Besoins du patient non vérifiés dans une demande active accessible : ces options sont présentées par service ; la compatibilité individuelle reste à confirmer.');manquants.push('besoins du patient à confirmer');}
      const cites = entites.etabs.length ? entites.etabs : [];
      const ordre = r.suggestions;
      const propose = ordre.find((x) => x.recommande);
      l.push(propose ? `Établissement proposé maintenant : ${propose.nom}${propose.pourquoi ? ` — ${propose.pourquoi}` : ''}.` : 'Aucun établissement n’est proposé maintenant (aucune capacité confirmée avec route calculée).');
      for (const e of (cites.length ? cites : ordre.slice(0, 3).map((x) => ({ id: x.etablissement_id, nom: x.nom })))) {
        const x = ordre.find((y) => y.etablissement_id === e.id);
        const refus = tr.filter((y) => y.destination_id === e.id && y.statut === 'refuse' && y.origine_id === etabId).sort((a, b) => new Date(b.date_refus || b.date_demande) - new Date(a.date_refus || a.date_demande))[0];
        if (!x) {
          l.push(`• ${e.nom} : non proposé — aucune capacité compatible partagée (lit libre confirmé ou prévu) pour ce type${refus ? `; il a refusé ${refus.numero} (${refus.motif_refus || refus.motif_refus_code})` : ''}.`);
          continue;
        }
        const rang = ordre.indexOf(x) + 1;
        const ex = x.exclusions && (x.exclusions.age || x.exclusions.besoins) ? ` ; lits écartés : ${x.exclusions.age ? `${x.exclusions.age} pour le groupe d’âge` : ''}${x.exclusions.age && x.exclusions.besoins ? ', ' : ''}${x.exclusions.besoins ? `${x.exclusions.besoins} pour les besoins (équipement, isolement)` : ''}` : '';
        l.push(`• ${x.nom} — rang ${rang}${x.recommande ? ' (proposé)' : ''} : ${x.libres_confirmes ? `${x.libres_confirmes} lit(s) confirmé(s)` : x.libres_perimes ? 'confirmation périmée' : x.libres_non_confirmes ? 'lits libres non confirmés' : 'aucun lit libre, seulement des disponibilités prévues'}, niveau ${x.niveau}${x.statut_route === 'calcule' ? `, ${duree(x.minutes_route)} de route (${x.distance_km} km, routeur ${r.routage.fournisseur || ''})` : ', route non calculée'}${x.lit?.code ? ` ; lit partagé confirmé : ${x.lit.code}` : ''}${ex}${refus ? ` ; a refusé ${refus.numero} : « ${refus.motif_refus || refus.motif_refus_code} »` : ''}.`);
      }
      if (!ordre.length) l.push('Aucun établissement ne partage actuellement de capacité compatible.');
      l.push('Distance routière et durée viennent du routeur (sans trafic en temps réel) ; la décision et l’acceptation restent humaines.');
      l.push('Toute disponibilité doit être revérifiée avant réservation. OG ne réserve aucun lit et ne déclenche aucune admission ni aucun transfert.');
      l.push('La compatibilité clinique reste à valider par l’équipe receveuse.');
      blocs.push(l.join('\n'));
      faits.push('classement recalculé maintenant'); estimations.push('durée routière OSRM sans trafic');
    },
    async pediatrie() {
      const ped = types.filter((x) => ['pediatrique', 'neonatal'].includes(x.groupe_age));
      let cibles = entites.types.filter((x) => ped.includes(x));
      // « lits pédiatriques » au sens large : toutes les unités pédiatriques et néonatales, pas seulement la pédiatrie générale
      if (cibles.length === 1 && cibles[0].code === 'PED' && !/pediatrie generale/.test(qn)) cibles = [];
      const liste = cibles.length ? cibles : ped;
      if (!liste.length) { blocs.push('Aucune unité pédiatrique ou néonatale n’est configurée dans ce réseau.'); return; }
      const reseau = await charger('reseau', () => s.capaciteReseau(pool, utilisateur, etabId), 'Réseau');
      const l = ['Capacités pédiatriques et néonatales partagées (lits de groupe d’âge compatible seulement) :'];
      let trouve = false;
      for (const e of reseau.etablissements) {
        const u = e.unites.filter((x) => liste.some((ty) => ty.id === x.type_id) && (x.libres || x.prevus));
        if (!u.length) continue;
        trouve = true;
        l.push(`• ${e.nom}${e.moi ? ' (vous)' : ''} : ${u.map((x) => `${x.type_nom} ${x.libres_confirmes} confirmé(s)${x.libres - x.libres_confirmes > 0 ? ` + ${x.libres - x.libres_confirmes} à confirmer` : ''}${x.prevus ? `, ${x.prevus} prévu(s)` : ''}`).join(' ; ')}`);
      }
      if (!trouve) l.push('Aucun lit pédiatrique libre ou prévu n’est partagé actuellement.');
      l.push('« Potentiellement compatible » : type d’unité et groupe d’âge concordent ; la compatibilité clinique reste à valider par l’équipe receveuse.');
      blocs.push(l.join('\n'));
    },
    async alertes() {
      const v = await charger('vig', () => vig.blocages(pool, utilisateur, etabId), 'Alertes');
      let al = v.alertes;
      if (entites.types.length) al = al.filter((a) => entites.types.some((ty) => norm(a.unite || '').includes(norm(ty.nom).slice(0, 5))));
      if (!al.length) { blocs.push('Aucune alerte de blocage active.'); return; }
      blocs.push([`Alertes actives (${al.length}), les plus bloquantes d’abord :`, ...al.slice(0, 12).map((a) => `• [${{ eleve: 'rouge', modere: 'orange', faible: 'jaune' }[a.niveau]}] ${a.titre}\n   Origine : ${a.evenement} · seuil : ${a.seuil.regle}\n   ${a.cause.nature === 'fait' ? 'Fait' : 'Hypothèse'} : ${a.cause.texte}\n   Proposition : ${a.action} (${a.responsable})`)].join('\n'));
      if (v.controle_periodique.en_retard) manquants.push('contrôle périodique en retard : les alertes ci-dessus sont recalculées en direct');
    },
    async actions() {
      const v = await charger('vig', () => vig.blocages(pool, utilisateur, etabId), 'Alertes');
      const tr = await charger('transferts', () => s.listeTransferts(pool, utilisateur, etabId), 'Transferts');
      const file = await charger('file', () => t.fileAdmission(pool, utilisateur, etabId), 'Admissions');
      const c = await charger('conges-aujourdhui', () => vig.conges(pool, utilisateur, etabId, { jour: 'aujourdhui' }), 'Congés');
      const l = ['Actions attendues de votre équipe aujourd’hui (à décider et réaliser par les personnes habilitées) :'];
      let i = 0;
      const recus = tr.filter((x) => x.destination_id === etabId && x.statut === 'demande');
      if (recus.length) l.push(`${++i}. Répondre à ${recus.length} demande(s) de transfert : ${recus.map((x) => x.numero).join(', ')}.`);
      const pretes = tr.filter((x) => x.destination_id === etabId && x.statut === 'validee' && !x.date_chambre_prete);
      if (pretes.length) l.push(`${++i}. Indiquer « chambre prête » : ${pretes.map((x) => `${x.numero} (lit ${x.lit_code})`).join(', ')}.`);
      const arr = tr.filter((x) => x.destination_id === etabId && x.statut === 'en_route');
      if (arr.length) l.push(`${++i}. Réceptionner à l’arrivée : ${arr.map((x) => x.numero).join(', ')}.`);
      const assign = file.filter((d) => d.statut === 'attente' && d.lit_suggere);
      if (assign.length) l.push(`${++i}. Assigner un lit à ${assign.length} patient(s) en attente : ${assign.slice(0, 6).map((d) => `${d.patient_ref} → ${d.lit_suggere.code}`).join(', ')}.`);
      const adm = file.filter((d) => d.statut === 'assignee');
      if (adm.length) l.push(`${++i}. Finaliser l’admission (lit assigné) : ${adm.map((d) => `${d.patient_ref} (${d.lit_code})`).join(', ')}.`);
      const cg = c.lignes.filter((x) => x.verification);
      if (cg.length) l.push(`${++i}. Vérifier les congés dépassés : ${cg.map((x) => x.lit).join(', ')}.`);
      const parType = (ty) => v.alertes.filter((a) => a.type === ty);
      if (parType('nettoyage_en_attente').length) l.push(`${++i}. Nettoyage en attente : ${parType('nettoyage_en_attente').map((a) => a.ressource).join(', ')}.`);
      if (parType('disponibilite_perimee').length) l.push(`${++i}. Confirmer la disponibilité : ${parType('disponibilite_perimee').map((a) => a.ressource).join(', ')}.`);
      if (parType('reservation_prolongee').length) l.push(`${++i}. Vérifier les réservations prolongées : ${parType('reservation_prolongee').map((a) => a.ressource).join(', ')}.`);
      if (!i) l.push('Aucune action en attente dans les données actuelles.');
      blocs.push(l.join('\n'));
    },
    async capacites() {
      const ls = await lits();
      const st = await pool.query(`SELECT l.type_id, COALESCE(dp.nom, sv.nom, 'Sans département') AS departement
        FROM lits l JOIN unites u ON u.id = l.unite_id LEFT JOIN departements dp ON dp.id = u.departement_id LEFT JOIN services sv ON sv.id = u.service_id
        WHERE l.etablissement_id = $1`, [etabId]);
      noter('Structure');
      const groupes = new Map();
      for (const ty of types) {
        const g = ls.filter((l) => l.type_id === ty.id);
        if (!g.length) continue;
        const dep = [...new Set(st.rows.filter((x) => x.type_id === ty.id).map((x) => x.departement))].join(', ');
        groupes.set(ty.nom, `• ${ty.nom}${dep ? ` (${dep})` : ''} : ${g.filter((l) => l.etat !== 'indispo').length} en service · ${g.filter((l) => l.etat === 'libre').length} libres (${g.filter((l) => l.disponibilite_confirmation === 'capacite_confirmee').length} confirmés) · ${g.filter((l) => l.etat === 'occupe').length} occupés · ${g.filter((l) => l.etat === 'reserve').length} réservés · ${g.filter((l) => l.etat === 'nettoyage').length} en nettoyage`);
      }
      blocs.push([`Capacités de ${etab.nom} par spécialité :`, ...groupes.values()].join('\n'));
    },
    async nsa() {
      const n = await charger('nsa', () => t.listeNsa(pool, utilisateur, etabId), 'NSA');
      if (!n.total) { blocs.push('Aucun patient en NSA actuellement.'); return; }
      blocs.push([`${n.total} patients en NSA (${n.taux} % des lits occupés ; cible ${n.cible} %), ${n.jours_lits} jours-lits au total :`,
        ...n.lits.map((l) => `• ${l.code} (${l.unite}) — ${l.patient_ref}, depuis ${l.jours} j · orientation : ${ORIENT[l.nsa_orientation] || l.nsa_orientation}`)].join('\n'));
      actions.push('Coordination des orientations : suivre les places en CHSLD, ressources intermédiaires ou réadaptation (hors Arrimo).');
    },
    async previsions() {
      const historique = await require('./copilote').questionHistorique(pool, utilisateur, etabId, entites.horizon?.jour === 'demain' ? 'saturés demain' : 'saturés ce soir');
      noter('Prévisions');
      blocs.push(historique.reponse);
      estimations.push('prévisions statistiques sur l’historique (avec marge)');
    },
    async destination() {
      const ty = entites.types[0];
      const h = await require('./copilote').questionHistorique(pool, utilisateur, etabId, ty ? `ou trouver un lit de ${ty.nom} le plus proche` : question);
      noter('Réseau (recherche)');
      blocs.push(h.reponse);
      estimations.push('durée routière OSRM sans trafic');
    },
    async reseau() {
      const historique = await require('./copilote').questionHistorique(pool, utilisateur, etabId, 'niveaux d alerte du reseau');
      noter('Réseau');
      blocs.push(historique.reponse);
    },
  };

  if (entites.litsInconnus.length && !entites.lits.length && /\blit\b|pourquoi/.test(qn)) {
    blocs.push(`Je ne trouve pas de lit ${entites.litsInconnus.join(', ')} dans ${etab.nom}. Vérifiez le numéro (OG ne consulte que les lits de votre établissement).`);
    manquants.push('lit introuvable');
  }
  for (const nom of intentions) await outils[nom]();
  if (!blocs.length) return null;

  memoriser(utilisateur, etabId, { intentions, lits: entites.lits.length ? entites.lits.map((l) => l.code) : ctx?.lits || [],
    types: entites.types.length ? entites.types.map((x) => x.code) : (suite && ctx?.types) || [] });
  const sources = [...lu.entries()].map(([nom, d]) => ({ module: nom, lu_le: d.toISOString() }));
  const fmtH = new Intl.DateTimeFormat('fr-CA', { timeZone: etab.config.fuseau, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const pied = [];
  if (actions.length) pied.push(`À faire (décision humaine) : ${actions.join(' ')}`);
  if (estimations.length) pied.push(`Estimations : ${estimations.join(' ; ')}.`);
  if (manquants.length) pied.push(`Données manquantes : ${manquants.join(' ; ')}.`);
  pied.push(`Sources : ${sources.map((x) => x.module).join(', ')} — lues à ${fmtH.format(new Date()).replace(':', ' h ')}.`);
  return { mode: 'local', moteur: 'og-outils', intentions, reponse: `${blocs.join('\n\n')}\n\n${pied.join('\n')}`, sources, faits, estimations, manquants };
}

const AIDE = 'Je réponds à partir des données d’Arrimo de votre établissement (et de ce que le réseau partage). Par exemple :\n'
  + '• Quel est l’état actuel de mon hôpital ?\n• Quelles sont les trois situations prioritaires ?\n• Quels lits sont libres en soins intensifs ?\n'
  + '• Quels lits vont se libérer aujourd’hui ? · Le lit MED-204A a-t-il un congé prévu ?\n• Quels lits sont réservés depuis plus de deux heures ?\n'
  + '• Quels lits nécessitent un nettoyage ? · Combien de civières en corridor ?\n• Quelles demandes de transfert attendent une réponse ?\n'
  + '• Pourquoi l’hôpital C est-il proposé plutôt que B ? · Quels établissements ont des lits pédiatriques compatibles ?\n'
  + '• Quelles alertes bloquent notre unité ? · Quelles actions sont attendues de notre équipe aujourd’hui ?\n'
  + 'Je ne donne aucun avis clinique et je ne fais aucune action à votre place.';

module.exports = { AIDE, repondre, contexte, memoriser, norm, detecterIntentions, choisir, typesMentionnes, dureeMentionnee, horizonMentionne };
