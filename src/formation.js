/**
 * Partie C4 : formation et go-live, côté environnement (appelé par la console SH avec la clé de service).
 *  - generer : patients et mouvements fictifs dans la structure importée d'un hôpital, pour la formation.
 *    Recette seulement : refusé en production et en démonstration (testé). Chaque changement passe par src/regles.js.
 *  - exporterStructure : la structure et les comptes validés en recette, au format des modèles CSV (aucune donnée de patient),
 *    pour les importer en production au go-live.
 *  - comptes : les comptes d'un établissement (nom, courriel, rôle), sans mot de passe, pour le rapport de go-live.
 */
const { transaction, ErreurHttp } = require('./db');
const { changerEtat, changerEtatCiviere } = require('./regles');
const env = require('./environnement');
const { MODELES } = require('./import');

const DETAIL = 'Formation (données fictives)';
const hasard = (n) => Math.floor(Math.random() * n);
// Références fictives de formation : P-9xxxx (format du pays, sans lien avec un vrai patient)
const reference = () => `P-${90000 + hasard(10000)}`;
const ROLES_EXPORT = ['coordonnateur', 'entretien', 'admin_etab'];

/** Le générateur n'existe qu'en recette (et sur un poste de développement). */
function exigerRecette() {
  if (!['recette', 'developpement'].includes(env.environnement())) throw new ErreurHttp(403, 'formation_recette_seulement');
}

async function tenter(pool, fn) {
  try { return await transaction(pool, fn); } catch { return null; }   // lit pris entre-temps, référence déjà utilisée : on passe
}

/** Génère des patients et des mouvements fictifs. Retourne les compteurs. */
async function generer(pool, etabId, { occupation = 0.7 } = {}) {
  exigerRecette();
  const e = (await pool.query('SELECT id, nom, module_actif FROM etablissements WHERE id = $1', [etabId])).rows[0];
  if (!e) throw new ErreurHttp(404, 'etab_introuvable');
  if (!e.module_actif) throw new ErreurHttp(403, 'module_inactif', { etab: e.nom });
  const n = { admissions: 0, conges: 0, nettoyages: 0, civieres: 0, demandes: 0 };
  // 1. Lits : environ 70 % occupés par des patients fictifs, une partie avec un congé prévu aujourd'hui
  const lits = (await pool.query(`SELECT id FROM lits WHERE etablissement_id = $1 AND etat = 'libre' ORDER BY random()`, [etabId])).rows;
  const aOccuper = lits.slice(0, Math.min(300, Math.round(lits.length * occupation)));
  for (const [i, l] of aOccuper.entries()) {
    const conge = i % 5 === 0;
    const sortie = new Date(Date.now() + (conge ? 2 + hasard(8) : 24 + hasard(96)) * 3600000);
    if (await tenter(pool, async (c) => {
      await changerEtat(c, pool, null, l.id, 'reserve', { patientRef: reference(), detail: DETAIL });
      return changerEtat(c, pool, null, l.id, 'occupe', { detail: DETAIL, sortiePrevue: sortie });
    })) { n.admissions += 1; if (conge) n.conges += 1; }
  }
  // 2. Quelques départs : lits à nettoyer (file de l'entretien)
  const partis = (await pool.query(`SELECT id FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' ORDER BY random() LIMIT $2`,
    [etabId, Math.max(1, Math.round(aOccuper.length * 0.1))])).rows;
  for (const l of partis) if (await tenter(pool, (c) => changerEtat(c, pool, null, l.id, 'nettoyage', { detail: DETAIL }))) n.nettoyages += 1;
  // 3. Urgence : la moitié des civières occupées
  const civs = (await pool.query(`SELECT id FROM civieres WHERE etablissement_id = $1 AND etat = 'libre' ORDER BY categorie DESC, code`, [etabId])).rows;
  const occupees = [];
  for (const cv of civs.slice(0, Math.ceil(civs.length / 2))) {
    if (await tenter(pool, (c) => changerEtatCiviere(c, pool, null, cv.id, 'occupee', { patientRef: reference(), detail: DETAIL }))) { n.civieres += 1; occupees.push(cv.id); }
  }
  // 4. File d'admission : des patients de l'urgence attendent un lit (type d'unité qui existe dans l'hôpital)
  const types = (await pool.query('SELECT DISTINCT type_id FROM unites WHERE etablissement_id = $1', [etabId])).rows.map((r) => r.type_id);
  for (const [i, civiereId] of occupees.slice(0, 4).entries()) {
    if (!types.length) break;
    const r = await pool.query(
      `INSERT INTO demandes_admission (etablissement_id, provenance, type_id, patient_ref, priorite, civiere_id)
       SELECT $1, 'urgence', $2, patient_ref, $3, id FROM civieres WHERE id = $4 AND etat = 'occupee' RETURNING id`,
      [etabId, types[i % types.length], ['p1', 'p2', 'p2', 'p3'][i], civiereId]).catch(() => ({ rows: [] }));
    n.demandes += r.rows.length;
  }
  return n;
}

const oui = (v) => (v ? 'oui' : 'non');
const ligneCsv = (vals) => vals.map((v) => (/[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(';');
const csv = (type, lignes) => `${[MODELES[type].colonnes.join(';'), ...lignes.map(ligneCsv)].join('\n')}\n`;

/** Structure et comptes d'un établissement, au format des modèles d'import. Aucune donnée de patient, aucun mot de passe. */
async function exporterStructure(pool, etabId) {
  const q = (sql) => pool.query(sql, [etabId]).then((r) => r.rows);
  const departements = await q(`SELECT code,nom,attributs,actif FROM departements WHERE etablissement_id=$1 ORDER BY id`);
  const services = await q(`SELECT s.code,s.nom,d.nom AS departement,s.attributs,s.actif FROM services s LEFT JOIN departements d ON d.id=s.departement_id WHERE s.etablissement_id=$1 ORDER BY s.id`);
  const unites = await q(`SELECT u.nom, t.code, s.nom AS service, d.nom AS departement,u.attributs,u.actif FROM unites u JOIN types_unite t ON t.id = u.type_id LEFT JOIN services s ON s.id=u.service_id
    LEFT JOIN departements d ON d.id=u.departement_id WHERE u.etablissement_id = $1 ORDER BY u.id`);
  const etages = await q(`SELECT u.nom,g.code,g.nom AS etage,g.aile,g.attributs,g.actif FROM etages g JOIN unites u ON u.id=g.unite_id WHERE u.etablissement_id=$1 ORDER BY g.id`);
  const chambres = await q(`SELECT u.nom,ch.numero,g.nom AS etage,ch.type_chambre,ch.capacite_declaree,ch.accessible,ch.attributs,ch.restrictions,ch.statut_operationnel,ch.actif FROM chambres ch JOIN unites u ON u.id=ch.unite_id
    LEFT JOIN etages g ON g.id=ch.etage_id WHERE u.etablissement_id = $1 ORDER BY ch.id`);
  const lits = await q(`SELECT u.nom, ch.numero, l.code, l.isolement, l.pression_negative, l.ventilation, l.telemetrie,l.categorie,l.attributs,l.actif FROM lits l
    JOIN chambres ch ON ch.id = l.chambre_id JOIN unites u ON u.id = ch.unite_id WHERE l.etablissement_id = $1 ORDER BY l.id`);
  const civieres = await q(`SELECT c.code,c.categorie,u.nom AS unite,c.attributs,c.actif FROM civieres c LEFT JOIN unites u ON u.id=c.unite_id WHERE c.etablissement_id = $1 ORDER BY c.id`);
  const comptes = (await pool.query(`SELECT u.nom, u.email, u.role FROM utilisateurs u JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id
    WHERE ue.etablissement_id = $1 AND u.actif AND u.role = ANY($2::text[]) ORDER BY u.id`, [etabId, ROLES_EXPORT])).rows;
  return {
    departements: csv('departements', departements.map((x) => [x.nom,x.code,JSON.stringify(x.attributs||{}),oui(x.actif)])),
    services: csv('services', services.map((x) => [x.nom,x.code,x.departement||'',JSON.stringify(x.attributs||{}),oui(x.actif)])),
    unites: csv('unites', unites.map((x) => [x.nom, x.code,x.service||'',x.departement||'',JSON.stringify(x.attributs||{}),oui(x.actif)])),
    etages: csv('etages', etages.map((x) => [x.nom,x.etage,x.aile||'',JSON.stringify(x.attributs||{}),oui(x.actif)])),
    chambres: csv('chambres', chambres.map((x) => [x.nom,x.numero,x.etage||'',x.type_chambre||'',x.capacite_declaree??'',oui(x.accessible),JSON.stringify(x.attributs||{}),JSON.stringify(x.restrictions||{}),x.statut_operationnel||'actif',oui(x.actif)])),
    lits: csv('lits', lits.map((x) => [x.nom, x.numero, x.code,oui(x.isolement),oui(x.pression_negative),oui(x.ventilation),oui(x.telemetrie),x.categorie||'',JSON.stringify(x.attributs||{}),oui(x.actif)])),
    civieres: csv('civieres', civieres.map((x) => [x.code, x.categorie,x.unite||'',JSON.stringify(x.attributs||{}),oui(x.actif)])),
    utilisateurs: csv('utilisateurs', comptes.map((x) => [x.nom, x.email, x.role])),
  };
}

/** Comptes d'un établissement, sans mot de passe (rapport de go-live). */
async function comptes(pool, etabId) {
  return (await pool.query(`SELECT u.nom, u.email AS courriel, u.role, u.mdp_temporaire, u.invitation_en_attente, u.cree_le FROM utilisateurs u
    JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id WHERE ue.etablissement_id = $1 AND u.actif ORDER BY u.nom`, [etabId])).rows;
}

module.exports = { generer, exporterStructure, comptes, exigerRecette, DETAIL };
