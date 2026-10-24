/**
 * Import CSV de la structure et des comptes d'un établissement (partie C3).
 * Modèles administratifs : services, unités, chambres, lits, civières, utilisateurs. Aucune donnée de patient.
 *
 * En deux temps :
 *   1. verifier  : lit le fichier, rapporte chaque erreur (ligne, colonne, code), annonce ce qui sera créé, mis à jour
 *                  ou laissé tel quel ; rien n'est écrit. Retourne l'empreinte du fichier.
 *   2. importer  : seulement si la vérification est sans erreur et que l'empreinte n'a pas changé ; tout ou rien
 *                  (une transaction), journalisé. Réimporter met à jour par la clé de chaque ligne, sans doublon,
 *                  et ne supprime jamais rien.
 * Comptes créés : un mot de passe temporaire chacun, retourné une seule fois, jamais conservé en clair.
 * Format : UTF-8 (avec ou sans BOM), séparateur « ; » (Excel en français) ou « , », première ligne = noms de colonnes.
 */
const crypto = require('crypto');
const { transaction, ErreurHttp } = require('./db');
const { hacherAsync, motDePasseTemporaire } = require('./auth');
const { journaliser } = require('./regles');

const MAX_LIGNES = 5000;
const ROLES = ['coordonnateur', 'entretien', 'admin_etab'];
const CATEGORIES = { reguliere: 'reguliere', 'régulière': 'reguliere', regular: 'reguliere', debordement: 'debordement', 'débordement': 'debordement', corridor: 'debordement', overflow: 'debordement' };
const EQUIPEMENTS = ['isolement', 'pression_negative', 'ventilation', 'telemetrie'];
const CODE = /^[\w.-]{1,30}$/;
const COURRIEL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Modèles : colonnes (obligatoires d'abord) et exemples fictifs
const MODELES = {
  departements: { colonnes: ['departement', 'code', 'attributs_json', 'actif'], obligatoires: ['departement', 'code'],
    exemples: [['Soins aigus', 'AIGUS'], ['Urgence', 'URG'], ['Services diagnostiques', 'DIAG']] },
  services: { colonnes: ['service', 'code', 'departement', 'attributs_json', 'actif'], obligatoires: ['service', 'code'],
    exemples: [['Urgence', 'URG', 'Urgence'], ['Médecine', 'MED', 'Soins aigus'], ['Soins intensifs', 'SI', 'Soins aigus']] },
  unites: { colonnes: ['unite', 'type_unite', 'service', 'departement', 'attributs_json', 'actif'], obligatoires: ['unite', 'type_unite'],
    exemples: [['Soins intensifs', 'SI', 'SI', 'Soins aigus'], ['Médecine 3e', 'MED', 'MED', 'Soins aigus'], ['Chirurgie', 'CHIR', 'CHIR', 'Soins aigus']] },
  etages: { colonnes: ['unite', 'etage', 'aile', 'attributs_json', 'actif'], obligatoires: ['unite', 'etage'],
    exemples: [['Médecine 3e', '3', 'Nord'], ['Médecine 3e', '3S', 'Sud'], ['Soins intensifs', '1', '']] },
  chambres: { colonnes: ['unite', 'chambre', 'etage', 'type_chambre', 'capacite', 'accessible', 'attributs_json', 'restrictions_json', 'statut_operationnel', 'actif'], obligatoires: ['unite', 'chambre'],
    exemples: [['Médecine 3e', '301', '3', 'double', '2', 'non'], ['Médecine 3e', '302', '3', 'simple', '1', 'oui'], ['Soins intensifs', '101', '1', 'surveillance', '1', 'non']] },
  lits: { colonnes: ['unite', 'chambre', 'lit', ...EQUIPEMENTS, 'categorie', 'attributs_json', 'actif'], obligatoires: ['unite', 'chambre', 'lit'],
    exemples: [['Médecine 3e', '301', 'MED-301A', 'oui', 'non', 'non', 'non', 'standard'], ['Médecine 3e', '301', 'MED-301B', 'non', 'non', 'non', 'oui', 'standard'],
      ['Soins intensifs', '101', 'SI-101', 'oui', 'oui', 'oui', 'oui', 'soins intensifs']] },
  civieres: { colonnes: ['civiere', 'categorie', 'unite', 'attributs_json', 'actif'], obligatoires: ['civiere', 'categorie'],
    exemples: [['URG-01', 'reguliere', 'Urgence'], ['URG-02', 'reguliere', 'Urgence'], ['COR-01', 'debordement', '']] },
  utilisateurs: { colonnes: ['nom', 'courriel', 'role'], obligatoires: ['nom', 'courriel', 'role'],
    exemples: [['Coordination des lits', 'coordination@hopital.exemple', 'coordonnateur'], ['Équipe d’entretien', 'entretien@hopital.exemple', 'entretien']] },
};
// Noms de colonnes qui trahiraient une donnée de patient : le fichier est refusé
// Colonne qui porte la clé de chaque ligne (pour signaler un doublon)
const COLONNE_CLE = { departements: 'code', services: 'code', unites: 'unite', etages: 'etage', chambres: 'chambre', lits: 'lit', civieres: 'civiere', utilisateurs: 'courriel' };
const COLONNES_PATIENT = /patient|prenom|prénom|naissance|diagnos|ramq|\bnam\b|dossier|sexe|adresse_patient|telephone_patient/i;
const VALEUR_PATIENT = [/\bP-\d{5}\b/, /\b[A-Z]{4}\s?\d{4}\s?\d{4}\b/];   // référence patient, numéro d'assurance maladie

const sansAccents = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Modèle CSV téléchargeable (séparateur « ; », avec BOM pour Excel). */
function modele(type) {
  const m = MODELES[type];
  if (!m) throw new ErreurHttp(404, 'import_type_inconnu');
  const cell = (v) => (/[;"\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
  return `﻿${[m.colonnes, ...m.exemples].map((l) => l.map(cell).join(';')).join('\r\n')}\r\n`;
}

/** Lecture CSV : guillemets, séparateur « ; » ou « , » (deviné sur la première ligne), fins de ligne Windows. */
function lireCsv(texte) {
  const t = String(texte || '').replace(/^﻿/, '');
  const premiere = t.split(/\r?\n/, 1)[0] || '';
  const sep = (premiere.match(/;/g) || []).length >= (premiere.match(/,/g) || []).length ? ';' : ',';
  const lignes = []; let ligne = []; let champ = ''; let guill = false;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (guill) {
      if (c === '"' && t[i + 1] === '"') { champ += '"'; i += 1; } else if (c === '"') guill = false; else champ += c;
    } else if (c === '"') guill = true;
    else if (c === sep) { ligne.push(champ); champ = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i += 1;
      ligne.push(champ); lignes.push(ligne); ligne = []; champ = '';
    } else champ += c;
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes.map((l) => l.map((v) => v.trim()));
}

function ouiNon(v) {
  const x = sansAccents(v);
  if (['', 'non', 'n', '0', 'faux', 'no', 'false'].includes(x)) return false;
  if (['oui', 'o', '1', 'vrai', 'yes', 'y', 'true', 'x'].includes(x)) return true;
  return null;
}

/**
 * Vérifie un fichier pour un établissement, à partir de l'état actuel de la base (`db`).
 * Retourne { lignes, erreurs: [{ ligne, colonne, code, vars }], actions: [{ ligne, action, cle }], resume, empreinte, donnees }.
 */
async function verifier(db, etabId, type, contenu) {
  const m = MODELES[type];
  if (!m) throw new ErreurHttp(400, 'import_type_inconnu');
  const etab = (await db.query('SELECT id, config_id, nom FROM etablissements WHERE id = $1', [etabId])).rows[0];
  if (!etab) throw new ErreurHttp(404, 'etab_introuvable');
  const empreinte = crypto.createHash('sha256').update(`${type}|${etabId}|${String(contenu || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').trim()}`).digest('hex');
  const erreurs = []; const actions = []; const donnees = [];
  const err = (ligne, colonne, code, vars = {}) => erreurs.push({ ligne, colonne, code, vars });
  const objetJson = (valeur, colonne, ligne, courant = {}) => {
    if (!entetes.includes(colonne) || !valeur) return courant || {};
    try {
      const o = JSON.parse(valeur);
      const ks = o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : [];
      if (!o || typeof o !== 'object' || Array.isArray(o) || ks.length > 50 || Buffer.byteLength(valeur) > 8192 || ks.some(k => /patient|diagnos|naissance|dossier|ramq|\bnam\b/i.test(k))) throw Error();
      return o;
    } catch { err(ligne, colonne, 'structure_attributs_invalides'); return null; }
  };
  const actifCsv = (v, courant, ligne) => {
    if (v === undefined || v === '') return courant ?? true;
    const n = ouiNon(v); if (n === null) { err(ligne, 'actif', 'oui_non', { valeur: v }); return courant ?? true; }
    return n;
  };
  const brut = lireCsv(contenu).filter((l) => l.some((v) => v !== ''));
  if (!brut.length) { err(1, null, 'fichier_vide'); return { lignes: 0, erreurs, actions, resume: {}, empreinte, donnees }; }
  const entetes = brut[0].map((h) => sansAccents(h).replace(/\s+/g, '_'));
  for (const [i, h] of entetes.entries()) {
    if (COLONNES_PATIENT.test(h)) err(1, brut[0][i], 'donnees_patient');
    else if (!m.colonnes.includes(h)) err(1, brut[0][i], 'colonne_inconnue');
  }
  for (const c of m.obligatoires) if (!entetes.includes(c)) err(1, c, 'colonne_manquante');
  if (brut.length - 1 > MAX_LIGNES) err(1, null, 'trop_de_lignes', { max: MAX_LIGNES });
  if (erreurs.length) return { lignes: brut.length - 1, erreurs, actions, resume: {}, empreinte, donnees };

  // Données de référence actuelles de l'établissement
  const types = (await db.query('SELECT id, code, nom, nom_en FROM types_unite WHERE config_id = $1', [etab.config_id])).rows;
  const departements = (await db.query('SELECT id,code,nom,actif,attributs FROM departements WHERE etablissement_id = $1', [etabId])).rows;
  const unites = (await db.query('SELECT id, nom, type_id, service_id, departement_id,actif,attributs FROM unites WHERE etablissement_id = $1', [etabId])).rows;
  const services = (await db.query('SELECT id,code,nom,departement_id,actif,attributs FROM services WHERE etablissement_id = $1', [etabId])).rows;
  const etages = (await db.query('SELECT g.id,g.code,g.nom,g.aile,g.unite_id,g.actif,g.attributs FROM etages g JOIN unites u ON u.id=g.unite_id WHERE u.etablissement_id = $1', [etabId])).rows;
  const chambres = (await db.query(`SELECT ch.id,ch.numero,ch.unite_id,ch.etage_id,ch.type_chambre,ch.capacite_declaree,ch.accessible,ch.attributs,ch.restrictions,ch.statut_operationnel,ch.actif,
    (SELECT count(*)::int FROM lits l WHERE l.chambre_id=ch.id AND l.actif) AS lits_actifs
    FROM chambres ch JOIN unites u ON u.id=ch.unite_id WHERE u.etablissement_id=$1`, [etabId])).rows;
  const uniteDe = (nom) => unites.find((u) => sansAccents(u.nom) === sansAccents(nom));
  const typeDe = (v) => types.find((t) => [t.code, t.nom, t.nom_en].filter(Boolean).some((x) => sansAccents(x) === sansAccents(v)));
  const serviceDe = (v) => services.find((s) => sansAccents(s.code) === sansAccents(v) || sansAccents(s.nom) === sansAccents(v));
  const departementDe = (v) => departements.find((d) => sansAccents(d.code) === sansAccents(v) || sansAccents(d.nom) === sansAccents(v));
  const etageDe = (uniteId, v) => etages.find((g) => g.unite_id === uniteId && (sansAccents(g.code) === sansAccents(v) || sansAccents(g.nom) === sansAccents(v)));
  const vus = new Map();
  const litsParChambre = new Map(chambres.map((c) => [c.id, c.lits_actifs || 0]));
  const lignes = brut.slice(1);
  for (const [k, valeurs] of lignes.entries()) {
    const n = k + 2;   // numéro de ligne dans le fichier (la ligne 1 porte les noms de colonnes)
    const v = Object.fromEntries(entetes.map((h, i) => [h, valeurs[i] ?? '']));
    const avant = erreurs.length;
    for (const c of m.obligatoires) if (!v[c]) err(n, c, 'valeur_requise');
    for (const [c, x] of Object.entries(v)) if (VALEUR_PATIENT.some((re) => re.test(x))) err(n, c, 'donnees_patient');
    if (erreurs.length > avant) continue;
    let cle; let action; let d;
    if (type === 'departements') {
      if (!CODE.test(v.code)) { err(n, 'code', 'code_invalide', { valeur:v.code }); continue; }
      cle=sansAccents(v.code).toUpperCase(); const departement=departements.find(x=>sansAccents(x.code)===sansAccents(v.code));
      const attributs=objetJson(v.attributs_json,'attributs_json',n,departement?.attributs); if(!attributs)continue;
      const actif=actifCsv(v.actif,departement?.actif,n);
      if(departement&&!actif&&(await db.query(`SELECT 1 FROM unites WHERE departement_id=$1 AND actif UNION ALL SELECT 1 FROM services WHERE departement_id=$1 AND actif LIMIT 1`,[departement.id])).rows[0]){err(n,'actif','structure_unite_utilisee');continue;}
      action=!departement?'creer':departement.nom!==v.departement||JSON.stringify(departement.attributs||{})!==JSON.stringify(attributs)||departement.actif!==actif?'maj':'inchange';
      donnees.push({ ligne:n, action, cle, code:v.code.toUpperCase(), nom:v.departement, departement_id:departement?.id, attributs, actif });
      if (vus.has(cle)) { err(n, 'code', 'doublon', { premiere: vus.get(cle) }); donnees.pop(); continue; }
      vus.set(cle,n); actions.push({ ligne:n, action, cle }); continue;
    } else if (type === 'services') {
      if (!CODE.test(v.code)) { err(n, 'code', 'code_invalide', { valeur:v.code }); continue; }
      cle=sansAccents(v.code).toUpperCase();const s=services.find(x=>sansAccents(x.code)===sansAccents(v.code));
      const deptExplicite=v.departement?departementDe(v.departement):null;
      if(v.departement&&!deptExplicite){err(n,'departement','departement_inconnu',{valeur:v.departement});continue;}
      const dept=deptExplicite; const attributs=objetJson(v.attributs_json,'attributs_json',n,s?.attributs);if(!attributs)continue;const actif=actifCsv(v.actif,s?.actif,n);
      if(s&&!actif&&(await db.query('SELECT 1 FROM unites WHERE service_id=$1 AND actif LIMIT 1',[s.id])).rows[0]){err(n,'actif','structure_unite_utilisee');continue;}
      action=!s?'creer':(s.nom!==v.service|| (s.departement_id||null)!==(dept?.id||null)||JSON.stringify(s.attributs||{})!==JSON.stringify(attributs)||s.actif!==actif)?'maj':'inchange';d={code:v.code.toUpperCase(),nom:v.service,departement_id:dept?.id||null,service_id:s?.id,attributs,actif};
    } else if (type === 'unites') {
      const t = typeDe(v.type_unite);
      if (!t) { err(n, 'type_unite', 'type_unite_inconnu', { valeur: v.type_unite }); continue; }
      cle = sansAccents(v.unite);
      const u = uniteDe(v.unite);
      if (u && u.type_id !== t.id) { err(n, 'type_unite', 'unite_autre_type', { valeur: v.unite }); continue; }
      const service = v.service ? serviceDe(v.service) : null;
      if(v.service&&!service){err(n,'service','service_inconnu',{valeur:v.service});continue;}
      const deptExplicite=v.departement?departementDe(v.departement):null;
      const deptService=service?.departement_id?departements.find(x=>x.id===service.departement_id):null;
      const dept=deptExplicite||deptService;
      if(v.departement&&!dept){err(n,'departement','departement_inconnu',{valeur:v.departement});continue;}
      if(service&&dept&&(service.departement_id||null)!==dept.id){err(n,'service','service_autre_departement',{valeur:v.service});continue;}
      action = !u ? 'creer' : (u.service_id || null)!==(service?.id||null) || (u.departement_id||null)!==(dept?.id||null) ? 'maj' : 'inchange';
      const attributs=objetJson(v.attributs_json,'attributs_json',n,u?.attributs);if(!attributs)continue;const actif=actifCsv(v.actif,u?.actif,n);
      if(u&&!actif&&(await db.query(`SELECT 1 FROM lits WHERE unite_id=$1 AND etat<>'indispo' UNION ALL SELECT 1 FROM civieres WHERE unite_id=$1 AND etat<>'indispo' LIMIT 1`,[u.id])).rows[0]){err(n,'actif','structure_unite_utilisee');continue;}
      if(u&& (u.service_id||null)===(service?.id||null)&&(u.departement_id||null)===(dept?.id||null)) action=JSON.stringify(u.attributs||{})!==JSON.stringify(attributs)||u.actif!==actif?'maj':'inchange';
      d = { nom: v.unite, type_id: t.id,service_id:service?.id||null,departement_id:dept?.id||null,unite_id:u?.id,attributs,actif };
    } else if (type === 'etages') {
      const u=uniteDe(v.unite); if(!u){err(n,'unite','unite_inconnue',{valeur:v.unite});continue;}
      cle=`${u.id}|${sansAccents(v.etage)}`; const g=etageDe(u.id,v.etage);
      const attributs=objetJson(v.attributs_json,'attributs_json',n,g?.attributs);if(!attributs)continue;const actif=actifCsv(v.actif,g?.actif,n);
      if(g&&!actif&&(await db.query(`SELECT 1 FROM chambres WHERE etage_id=$1 AND (actif OR statut_operationnel='actif') LIMIT 1`,[g.id])).rows[0]){err(n,'actif','structure_etage_utilise');continue;}
      action=!g?'creer':(g.aile||'')!==(v.aile||'')||JSON.stringify(g.attributs||{})!==JSON.stringify(attributs)||g.actif!==actif?'maj':'inchange'; d={unite_id:u.id,code:v.etage.toUpperCase(),nom:v.etage,aile:v.aile||null,etage_id:g?.id,attributs,actif};
    } else if (type === 'chambres') {
      const u = uniteDe(v.unite);
      if (!u) { err(n, 'unite', 'unite_inconnue', { valeur: v.unite }); continue; }
      cle = `${u.id}|${sansAccents(v.chambre)}`;
      const floor=v.etage?etageDe(u.id,v.etage):null;
      if(v.etage&&!floor){err(n,'etage','etage_inconnu',{valeur:v.etage});continue;}
      const ch=chambres.find((c) => c.unite_id === u.id && sansAccents(c.numero) === sansAccents(v.chambre));
      let capacity=ch?.capacite_declaree??null;
      if(v.capacite){capacity=Number(v.capacite);if(!Number.isInteger(capacity)||capacity<1||capacity>100){err(n,'capacite','capacite_invalide',{valeur:v.capacite});continue;}}
      if(capacity!==null&&capacity<(ch?.lits_actifs||0)){err(n,'capacite','capacite_depassee',{valeur:capacity});continue;}
      const access=v.accessible?ouiNon(v.accessible):ch?.accessible??false;
      if(v.accessible&&access===null){err(n,'accessible','oui_non',{valeur:v.accessible});continue;}
      action=!ch?'creer':(ch.etage_id||null)!==(floor?.id||null)||ch.type_chambre!==(v.type_chambre||null)||ch.capacite_declaree!==capacity||ch.accessible!==!!access?'maj':'inchange';
      const attributs=objetJson(v.attributs_json,'attributs_json',n,ch?.attributs);const restrictions=objetJson(v.restrictions_json,'restrictions_json',n,ch?.restrictions);if(!attributs||!restrictions)continue;const actif=actifCsv(v.actif,ch?.actif,n);const statut=v.statut_operationnel||ch?.statut_operationnel||'actif';
      if(!['actif','maintenance','ferme'].includes(statut)){err(n,'statut_operationnel','structure_chambre_occupee');continue;}
      action=!ch?'creer':(ch.etage_id||null)!==(floor?.id||null)||ch.type_chambre!==(v.type_chambre||null)||ch.capacite_declaree!==capacity||ch.accessible!==!!access||JSON.stringify(ch.attributs||{})!==JSON.stringify(attributs)||JSON.stringify(ch.restrictions||{})!==JSON.stringify(restrictions)||ch.statut_operationnel!==statut||ch.actif!==actif?'maj':'inchange';
      if(ch&&(!actif||statut!=='actif')&&(statut==='actif'||(await db.query("SELECT 1 FROM lits WHERE chambre_id=$1 AND etat<>'indispo' LIMIT 1",[ch.id])).rows[0])){err(n,'actif','structure_chambre_occupee');continue;}
      d = { unite_id:u.id, numero:v.chambre, chambre_id:ch?.id, etage_id:floor?.id||null,type_chambre:v.type_chambre||null,capacite_declaree:capacity,accessible:!!access,attributs,restrictions,statut_operationnel:statut,actif };
    } else if (type === 'lits') {
      if (!CODE.test(v.lit)) { err(n, 'lit', 'code_invalide', { valeur: v.lit }); continue; }
      const u = uniteDe(v.unite);
      if (!u) { err(n, 'unite', 'unite_inconnue', { valeur: v.unite }); continue; }
      const ch = chambres.find((c) => c.unite_id === u.id && sansAccents(c.numero) === sansAccents(v.chambre));
      if (!ch) { err(n, 'chambre', 'chambre_inconnue', { valeur: v.chambre }); continue; }
      const eq = {};
      for (const e of EQUIPEMENTS) {
        const b = ouiNon(v[e] ?? '');
        if (b === null) err(n, e, 'oui_non', { valeur: v[e] });
        eq[e] = !!b;
      }
      if (erreurs.length > avant) continue;
      cle = v.lit.toUpperCase();
      const l = (await db.query('SELECT id, chambre_id, isolement, pression_negative, ventilation, telemetrie,categorie,attributs,actif,etat FROM lits WHERE etablissement_id = $1 AND upper(code) = $2', [etabId, cle])).rows[0];
      if (l && l.chambre_id !== ch.id) { err(n, 'chambre', 'lit_autre_chambre', { valeur: v.lit }); continue; }
      const ajouter = !l;
      if(ajouter&&ch.capacite_declaree!==null&&(litsParChambre.get(ch.id)||0)>=ch.capacite_declaree){err(n,'chambre','capacite_depassee',{valeur:ch.capacite_declaree});continue;}
      const attributs=objetJson(v.attributs_json,'attributs_json',n,l?.attributs);if(!attributs)continue;const actif=actifCsv(v.actif,l?.actif,n);const categorie=v.categorie||l?.categorie||null;
      if(l&&!actif&&l.etat!=='indispo'){err(n,'actif','structure_lit_occupe');continue;}
      action = !l ? 'creer' : EQUIPEMENTS.some((e) => l[e] !== eq[e])||l.categorie!==categorie||JSON.stringify(l.attributs||{})!==JSON.stringify(attributs)||l.actif!==actif ? 'maj' : 'inchange';
      d = { code: v.lit, chambre_id: ch.id, lit_id: l?.id, compter_lit:ajouter, categorie,attributs,actif, ...eq };
    } else if (type === 'civieres') {
      if (!CODE.test(v.civiere)) { err(n, 'civiere', 'code_invalide', { valeur: v.civiere }); continue; }
      const cat = CATEGORIES[sansAccents(v.categorie)] || CATEGORIES[String(v.categorie).toLowerCase()];
      if (!cat) { err(n, 'categorie', 'categorie_inconnue', { valeur: v.categorie }); continue; }
      cle = v.civiere.toUpperCase();
      const c = (await db.query('SELECT id, categorie, unite_id,attributs,actif,etat FROM civieres WHERE etablissement_id = $1 AND upper(code) = $2', [etabId, cle])).rows[0];
      const unit=v.unite?uniteDe(v.unite):null;if(v.unite&&!unit){err(n,'unite','unite_inconnue',{valeur:v.unite});continue;}
      const attributs=objetJson(v.attributs_json,'attributs_json',n,c?.attributs);if(!attributs)continue;const actif=actifCsv(v.actif,c?.actif,n);
      if(c&&!actif&&c.etat!=='indispo'){err(n,'actif','structure_civiere_utilisee');continue;}
      action = !c ? 'creer' : c.categorie !== cat || (c.unite_id||null)!==(unit?.id||null)||JSON.stringify(c.attributs||{})!==JSON.stringify(attributs)||c.actif!==actif ? 'maj' : 'inchange';
      d = { code: v.civiere, categorie: cat, civiere_id: c?.id, unite_id:unit?.id||null,attributs,actif };
    } else if (type === 'utilisateurs') {
      const courriel = v.courriel.toLowerCase();
      if (!COURRIEL.test(courriel)) { err(n, 'courriel', 'courriel_invalide', { valeur: v.courriel }); continue; }
      const role = sansAccents(v.role);
      if (!ROLES.includes(role)) { err(n, 'role', 'role_inconnu', { valeur: v.role }); continue; }
      cle = courriel;
      const u = (await db.query(`SELECT u.id, u.nom, u.role, array_agg(ue.etablissement_id) FILTER (WHERE ue.etablissement_id IS NOT NULL) AS etabs
        FROM utilisateurs u LEFT JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id WHERE u.email = $1 GROUP BY u.id`, [courriel])).rows[0];
      // Un compte existant n'est modifiable que s'il appartient à cet établissement seul : un compte partagé avec un autre
      // établissement promu ici obtiendrait aussi des droits là-bas (même règle que la modification directe d'un compte).
      if (u && (u.role === 'gestionnaire' || !(u.etabs || []).length || !(u.etabs || []).every((e) => e === etabId))) { err(n, 'courriel', 'courriel_autre_etab', { valeur: courriel }); continue; }
      action = !u ? 'creer' : u.nom !== v.nom || u.role !== role ? 'maj' : 'inchange';
      d = { email: courriel, nom: v.nom, role, utilisateur_id: u?.id };
    }
    if (vus.has(cle)) { err(n, COLONNE_CLE[type], 'doublon', { premiere: vus.get(cle) }); continue; }
    vus.set(cle, n);
    if(type==='lits'&&d.compter_lit) litsParChambre.set(d.chambre_id,(litsParChambre.get(d.chambre_id)||0)+1);
    actions.push({ ligne: n, action, cle });
    donnees.push({ ligne: n, action, ...d });
  }
  const resume = { creer: 0, maj: 0, inchange: 0 };
  for (const a of actions) resume[a.action] += 1;
  return { lignes: lignes.length, erreurs, actions, resume, empreinte, donnees };
}

/** Importe dans une transaction, après une nouvelle vérification identique. Retourne le résumé et, pour les comptes, les mots de passe temporaires. */
async function importer(pool, utilisateur, etabId, type, contenu, empreinte, journalAdmin, options = {}) {
  return transaction(pool, async (c) => {
    await c.query('SELECT id FROM etablissements WHERE id = $1 FOR UPDATE', [etabId]);   // un import à la fois par établissement
    const v = await verifier(c, etabId, type, contenu);
    if (v.erreurs.length) throw new ErreurHttp(400, 'import_erreurs', { n: v.erreurs.length });
    if (v.empreinte !== empreinte) throw new ErreurHttp(409, 'import_fichier_change');
    const comptes = [];
    for (const d of v.donnees.filter((x) => x.action !== 'inchange')) {
      if (type === 'services') {
        await c.query(`INSERT INTO services(etablissement_id,code,nom,departement_id,attributs,actif) VALUES($1,$2,$3,$4,$5::jsonb,$6)
          ON CONFLICT(etablissement_id,code) DO UPDATE SET nom=EXCLUDED.nom,departement_id=EXCLUDED.departement_id,attributs=EXCLUDED.attributs,actif=EXCLUDED.actif`,[etabId,d.code,d.nom,d.departement_id,JSON.stringify(d.attributs),d.actif]);
      } else if (type === 'departements') {
        await c.query(`INSERT INTO departements(etablissement_id,code,nom,attributs,actif) VALUES($1,$2,$3,$4::jsonb,$5)
          ON CONFLICT(etablissement_id,code) DO UPDATE SET nom=EXCLUDED.nom,attributs=EXCLUDED.attributs,actif=EXCLUDED.actif,modifie_le=now()`,[etabId,d.code,d.nom,JSON.stringify(d.attributs),d.actif]);
      } else if (type === 'unites' && d.action === 'creer') {
        await c.query('INSERT INTO unites (etablissement_id, type_id, service_id, departement_id, nom,attributs,actif) VALUES ($1, $2, $3, $4, $5,$6::jsonb,$7)', [etabId, d.type_id,d.service_id,d.departement_id,d.nom,JSON.stringify(d.attributs),d.actif]);
      } else if (type === 'unites') {
        await c.query('UPDATE unites SET service_id=$2,departement_id=$3,attributs=$4::jsonb,actif=$5 WHERE id=$1',[d.unite_id,d.service_id,d.departement_id,JSON.stringify(d.attributs),d.actif]);
      } else if (type === 'etages' && d.action !== 'inchange') {
        if (d.etage_id) await c.query('UPDATE etages SET aile=$2,attributs=$3::jsonb,actif=$4,modifie_le=now() WHERE id=$1',[d.etage_id,d.aile,JSON.stringify(d.attributs),d.actif]);
        else await c.query(`INSERT INTO etages(unite_id,code,nom,aile,attributs,actif) VALUES($1,$2,$3,$4,$5::jsonb,$6)
          ON CONFLICT(unite_id,code) DO UPDATE SET nom=EXCLUDED.nom,aile=EXCLUDED.aile,attributs=EXCLUDED.attributs,actif=EXCLUDED.actif,modifie_le=now()`,[d.unite_id,d.code,d.nom,d.aile,JSON.stringify(d.attributs),d.actif]);
      } else if (type === 'chambres') {
        if(d.action==='creer') await c.query(`INSERT INTO chambres(unite_id,numero,etage_id,type_chambre,capacite_declaree,accessible,attributs,restrictions,statut_operationnel,actif)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)`,[d.unite_id,d.numero,d.etage_id,d.type_chambre,d.capacite_declaree,d.accessible,JSON.stringify(d.attributs),JSON.stringify(d.restrictions),d.statut_operationnel,d.actif]);
        else await c.query(`UPDATE chambres SET etage_id=$2,type_chambre=$3,capacite_declaree=$4,accessible=$5,attributs=$6::jsonb,restrictions=$7::jsonb,statut_operationnel=$8,actif=$9 WHERE id=$1`,
          [d.chambre_id,d.etage_id,d.type_chambre,d.capacite_declaree,d.accessible,JSON.stringify(d.attributs),JSON.stringify(d.restrictions),d.statut_operationnel,d.actif]);
      } else if (type === 'lits' && d.action === 'creer') {
        const l = (await c.query(
          `INSERT INTO lits (chambre_id, unite_id, type_id, etablissement_id, code, categorie, isolement, pression_negative, ventilation, telemetrie,attributs,actif)
           SELECT ch.id, u.id, u.type_id, u.etablissement_id, $2, $3,$4,$5,$6,$7,$8::jsonb,$9 FROM chambres ch JOIN unites u ON u.id = ch.unite_id
            WHERE ch.id = $1 RETURNING id`, [d.chambre_id, d.code,d.categorie, d.isolement, d.pression_negative, d.ventilation, d.telemetrie,JSON.stringify(d.attributs),d.actif])).rows[0];
        await journaliser(c, { litId: l.id, utilisateurId: utilisateur.id, action: 'Création', nouveau: 'libre', detail: 'Import CSV' });
      } else if (type === 'lits') {
        await c.query('UPDATE lits SET categorie=$2,isolement = $3, pression_negative = $4, ventilation = $5, telemetrie = $6,attributs=$7::jsonb,actif=$8 WHERE id = $1',
          [d.lit_id,d.categorie, d.isolement, d.pression_negative, d.ventilation, d.telemetrie,JSON.stringify(d.attributs),d.actif]);
        await journaliser(c, { litId: d.lit_id, utilisateurId: utilisateur.id, action: 'Équipement modifié', detail: 'Import CSV' });
      } else if (type === 'civieres' && d.action === 'creer') {
        const cv = (await c.query('INSERT INTO civieres (etablissement_id, code, categorie,unite_id,attributs,actif) VALUES ($1, $2, $3,$4,$5::jsonb,$6) RETURNING id', [etabId, d.code, d.categorie,d.unite_id,JSON.stringify(d.attributs),d.actif])).rows[0];
        await journaliser(c, { civiereId: cv.id, etablissementId: etabId, utilisateurId: utilisateur.id, action: 'Création', nouveau: 'libre', detail: 'Import CSV' });
      } else if (type === 'civieres') {
        await c.query('UPDATE civieres SET categorie = $2,unite_id=$3,attributs=$4::jsonb,actif=$5 WHERE id = $1', [d.civiere_id, d.categorie,d.unite_id,JSON.stringify(d.attributs),d.actif]);
      } else if (type === 'utilisateurs' && d.action === 'creer') {
        const temporaire = options.invitations ? require('node:crypto').randomBytes(32).toString('hex') : motDePasseTemporaire();
        const u = (await c.query(`INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role, mdp_temporaire, invitation_en_attente) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [d.email, d.nom, await hacherAsync(temporaire), d.role, !options.invitations, !!options.invitations])).rows[0];
        await c.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u.id, etabId]);
        comptes.push({ nom: d.nom, courriel: d.email, role: d.role, invitation_en_attente: !!options.invitations,
          ...(!options.invitations ? { mot_de_passe_temporaire: temporaire } : {}) });
      } else if (type === 'utilisateurs') {
        await c.query('UPDATE utilisateurs SET nom = $2, role = $3 WHERE id = $1', [d.utilisateur_id, d.nom, d.role]);
      }
    }
    if (type === 'utilisateurs' && options.invitations) {
      // Rend les reprises idempotentes : réinvite aussi les comptes déjà importés mais toujours en attente.
      comptes.length = 0;
      const emails = v.donnees.map((x) => x.email).filter(Boolean);
      const pending = emails.length ? (await c.query(`SELECT u.nom,u.email AS courriel,u.role,u.invitation_en_attente
        FROM utilisateurs u JOIN utilisateur_etablissements ue ON ue.utilisateur_id=u.id
        WHERE ue.etablissement_id=$1 AND u.actif AND u.invitation_en_attente AND lower(u.email)=ANY($2::text[])
        ORDER BY u.email`, [etabId, emails])).rows : [];
      comptes.push(...pending);
    }
    await journalAdmin(c, utilisateur, 'Import CSV', type,
      `créations : ${v.resume.creer} · mises à jour : ${v.resume.maj} · inchangées : ${v.resume.inchange} · empreinte ${empreinte.slice(0, 12)}`, etabId);
    return { resume: v.resume, lignes: v.lignes, ...(type === 'utilisateurs' ? { comptes } : {}) };
  });
}

module.exports = { MODELES, MAX_LIGNES, modele, lireCsv, verifier, importer, ouiNon };
