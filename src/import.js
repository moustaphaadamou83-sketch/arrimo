/**
 * Import CSV de la structure et des comptes d'un établissement (partie C3).
 * Cinq modèles : unités, chambres, lits (avec équipement), civières, utilisateurs. Aucune donnée de patient.
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
const { hacher, motDePasseTemporaire } = require('./auth');
const { journaliser } = require('./regles');

const MAX_LIGNES = 5000;
const ROLES = ['coordonnateur', 'entretien', 'admin_etab'];
const CATEGORIES = { reguliere: 'reguliere', 'régulière': 'reguliere', regular: 'reguliere', debordement: 'debordement', 'débordement': 'debordement', corridor: 'debordement', overflow: 'debordement' };
const EQUIPEMENTS = ['isolement', 'pression_negative', 'ventilation', 'telemetrie'];
const CODE = /^[\w.-]{1,30}$/;
const COURRIEL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Modèles : colonnes (obligatoires d'abord) et exemples fictifs
const MODELES = {
  unites: { colonnes: ['unite', 'type_unite'], obligatoires: ['unite', 'type_unite'],
    exemples: [['Soins intensifs', 'SI'], ['Médecine 3e', 'MED'], ['Chirurgie', 'CHIR']] },
  chambres: { colonnes: ['unite', 'chambre'], obligatoires: ['unite', 'chambre'],
    exemples: [['Médecine 3e', '301'], ['Médecine 3e', '302'], ['Soins intensifs', '101']] },
  lits: { colonnes: ['unite', 'chambre', 'lit', ...EQUIPEMENTS], obligatoires: ['unite', 'chambre', 'lit'],
    exemples: [['Médecine 3e', '301', 'MED-301A', 'oui', 'non', 'non', 'non'], ['Médecine 3e', '301', 'MED-301B', 'non', 'non', 'non', 'oui'],
      ['Soins intensifs', '101', 'SI-101', 'oui', 'oui', 'oui', 'oui']] },
  civieres: { colonnes: ['civiere', 'categorie'], obligatoires: ['civiere', 'categorie'],
    exemples: [['URG-01', 'reguliere'], ['URG-02', 'reguliere'], ['COR-01', 'debordement']] },
  utilisateurs: { colonnes: ['nom', 'courriel', 'role'], obligatoires: ['nom', 'courriel', 'role'],
    exemples: [['Coordination des lits', 'coordination@hopital.exemple', 'coordonnateur'], ['Équipe d’entretien', 'entretien@hopital.exemple', 'entretien']] },
};
// Noms de colonnes qui trahiraient une donnée de patient : le fichier est refusé
// Colonne qui porte la clé de chaque ligne (pour signaler un doublon)
const COLONNE_CLE = { unites: 'unite', chambres: 'chambre', lits: 'lit', civieres: 'civiere', utilisateurs: 'courriel' };
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
  const unites = (await db.query('SELECT id, nom, type_id FROM unites WHERE etablissement_id = $1', [etabId])).rows;
  const chambres = (await db.query('SELECT ch.id, ch.numero, ch.unite_id FROM chambres ch JOIN unites u ON u.id = ch.unite_id WHERE u.etablissement_id = $1', [etabId])).rows;
  const uniteDe = (nom) => unites.find((u) => sansAccents(u.nom) === sansAccents(nom));
  const typeDe = (v) => types.find((t) => [t.code, t.nom, t.nom_en].filter(Boolean).some((x) => sansAccents(x) === sansAccents(v)));
  const vus = new Map();
  const lignes = brut.slice(1);
  for (const [k, valeurs] of lignes.entries()) {
    const n = k + 2;   // numéro de ligne dans le fichier (la ligne 1 porte les noms de colonnes)
    const v = Object.fromEntries(entetes.map((h, i) => [h, valeurs[i] ?? '']));
    const avant = erreurs.length;
    for (const c of m.obligatoires) if (!v[c]) err(n, c, 'valeur_requise');
    for (const [c, x] of Object.entries(v)) if (VALEUR_PATIENT.some((re) => re.test(x))) err(n, c, 'donnees_patient');
    if (erreurs.length > avant) continue;
    let cle; let action; let d;
    if (type === 'unites') {
      const t = typeDe(v.type_unite);
      if (!t) { err(n, 'type_unite', 'type_unite_inconnu', { valeur: v.type_unite }); continue; }
      cle = sansAccents(v.unite);
      const u = uniteDe(v.unite);
      if (u && u.type_id !== t.id) { err(n, 'type_unite', 'unite_autre_type', { valeur: v.unite }); continue; }
      action = u ? 'inchange' : 'creer';
      d = { nom: v.unite, type_id: t.id };
    } else if (type === 'chambres') {
      const u = uniteDe(v.unite);
      if (!u) { err(n, 'unite', 'unite_inconnue', { valeur: v.unite }); continue; }
      cle = `${u.id}|${sansAccents(v.chambre)}`;
      action = chambres.some((c) => c.unite_id === u.id && sansAccents(c.numero) === sansAccents(v.chambre)) ? 'inchange' : 'creer';
      d = { unite_id: u.id, numero: v.chambre };
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
      const l = (await db.query('SELECT id, chambre_id, isolement, pression_negative, ventilation, telemetrie FROM lits WHERE etablissement_id = $1 AND upper(code) = $2', [etabId, cle])).rows[0];
      if (l && l.chambre_id !== ch.id) { err(n, 'chambre', 'lit_autre_chambre', { valeur: v.lit }); continue; }
      action = !l ? 'creer' : EQUIPEMENTS.some((e) => l[e] !== eq[e]) ? 'maj' : 'inchange';
      d = { code: v.lit, chambre_id: ch.id, lit_id: l?.id, ...eq };
    } else if (type === 'civieres') {
      if (!CODE.test(v.civiere)) { err(n, 'civiere', 'code_invalide', { valeur: v.civiere }); continue; }
      const cat = CATEGORIES[sansAccents(v.categorie)] || CATEGORIES[String(v.categorie).toLowerCase()];
      if (!cat) { err(n, 'categorie', 'categorie_inconnue', { valeur: v.categorie }); continue; }
      cle = v.civiere.toUpperCase();
      const c = (await db.query('SELECT id, categorie FROM civieres WHERE etablissement_id = $1 AND upper(code) = $2', [etabId, cle])).rows[0];
      action = !c ? 'creer' : c.categorie !== cat ? 'maj' : 'inchange';
      d = { code: v.civiere, categorie: cat, civiere_id: c?.id };
    } else if (type === 'utilisateurs') {
      const courriel = v.courriel.toLowerCase();
      if (!COURRIEL.test(courriel)) { err(n, 'courriel', 'courriel_invalide', { valeur: v.courriel }); continue; }
      const role = sansAccents(v.role);
      if (!ROLES.includes(role)) { err(n, 'role', 'role_inconnu', { valeur: v.role }); continue; }
      cle = courriel;
      const u = (await db.query(`SELECT u.id, u.nom, u.role, array_agg(ue.etablissement_id) FILTER (WHERE ue.etablissement_id IS NOT NULL) AS etabs
        FROM utilisateurs u LEFT JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id WHERE u.email = $1 GROUP BY u.id`, [courriel])).rows[0];
      if (u && (u.role === 'gestionnaire' || !(u.etabs || []).includes(etabId))) { err(n, 'courriel', 'courriel_autre_etab', { valeur: courriel }); continue; }
      action = !u ? 'creer' : u.nom !== v.nom || u.role !== role ? 'maj' : 'inchange';
      d = { email: courriel, nom: v.nom, role, utilisateur_id: u?.id };
    }
    if (vus.has(cle)) { err(n, COLONNE_CLE[type], 'doublon', { premiere: vus.get(cle) }); continue; }
    vus.set(cle, n);
    actions.push({ ligne: n, action, cle });
    donnees.push({ ligne: n, action, ...d });
  }
  const resume = { creer: 0, maj: 0, inchange: 0 };
  for (const a of actions) resume[a.action] += 1;
  return { lignes: lignes.length, erreurs, actions, resume, empreinte, donnees };
}

/** Importe dans une transaction, après une nouvelle vérification identique. Retourne le résumé et, pour les comptes, les mots de passe temporaires. */
async function importer(pool, utilisateur, etabId, type, contenu, empreinte, journalAdmin) {
  return transaction(pool, async (c) => {
    await c.query('SELECT id FROM etablissements WHERE id = $1 FOR UPDATE', [etabId]);   // un import à la fois par établissement
    const v = await verifier(c, etabId, type, contenu);
    if (v.erreurs.length) throw new ErreurHttp(400, 'import_erreurs', { n: v.erreurs.length });
    if (v.empreinte !== empreinte) throw new ErreurHttp(409, 'import_fichier_change');
    const comptes = [];
    for (const d of v.donnees.filter((x) => x.action !== 'inchange')) {
      if (type === 'unites') {
        await c.query('INSERT INTO unites (etablissement_id, type_id, nom) VALUES ($1, $2, $3)', [etabId, d.type_id, d.nom]);
      } else if (type === 'chambres') {
        await c.query('INSERT INTO chambres (unite_id, numero) VALUES ($1, $2)', [d.unite_id, d.numero]);
      } else if (type === 'lits' && d.action === 'creer') {
        const l = (await c.query(
          `INSERT INTO lits (chambre_id, unite_id, type_id, etablissement_id, code, isolement, pression_negative, ventilation, telemetrie)
           SELECT ch.id, u.id, u.type_id, u.etablissement_id, $2, $3, $4, $5, $6 FROM chambres ch JOIN unites u ON u.id = ch.unite_id
            WHERE ch.id = $1 RETURNING id`, [d.chambre_id, d.code, d.isolement, d.pression_negative, d.ventilation, d.telemetrie])).rows[0];
        await journaliser(c, { litId: l.id, utilisateurId: utilisateur.id, action: 'Création', nouveau: 'libre', detail: 'Import CSV' });
      } else if (type === 'lits') {
        await c.query('UPDATE lits SET isolement = $2, pression_negative = $3, ventilation = $4, telemetrie = $5 WHERE id = $1',
          [d.lit_id, d.isolement, d.pression_negative, d.ventilation, d.telemetrie]);
        await journaliser(c, { litId: d.lit_id, utilisateurId: utilisateur.id, action: 'Équipement modifié', detail: 'Import CSV' });
      } else if (type === 'civieres' && d.action === 'creer') {
        const cv = (await c.query('INSERT INTO civieres (etablissement_id, code, categorie) VALUES ($1, $2, $3) RETURNING id', [etabId, d.code, d.categorie])).rows[0];
        await journaliser(c, { civiereId: cv.id, etablissementId: etabId, utilisateurId: utilisateur.id, action: 'Création', nouveau: 'libre', detail: 'Import CSV' });
      } else if (type === 'civieres') {
        await c.query('UPDATE civieres SET categorie = $2 WHERE id = $1', [d.civiere_id, d.categorie]);
      } else if (type === 'utilisateurs' && d.action === 'creer') {
        const temporaire = motDePasseTemporaire();
        const u = (await c.query(`INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role, mdp_temporaire) VALUES ($1, $2, $3, $4, true) RETURNING id`,
          [d.email, d.nom, hacher(temporaire), d.role])).rows[0];
        await c.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u.id, etabId]);
        comptes.push({ nom: d.nom, courriel: d.email, role: d.role, mot_de_passe_temporaire: temporaire });
      } else if (type === 'utilisateurs') {
        await c.query('UPDATE utilisateurs SET nom = $2, role = $3 WHERE id = $1', [d.utilisateur_id, d.nom, d.role]);
      }
    }
    await journalAdmin(c, utilisateur, 'Import CSV', type,
      `créations : ${v.resume.creer} · mises à jour : ${v.resume.maj} · inchangées : ${v.resume.inchange} · empreinte ${empreinte.slice(0, 12)}`, etabId);
    return { resume: v.resume, lignes: v.lignes, ...(type === 'utilisateurs' ? { comptes } : {}) };
  });
}

module.exports = { MODELES, MAX_LIGNES, modele, lireCsv, verifier, importer, ouiNon };
