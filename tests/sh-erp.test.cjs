const { demarrerServeur } = require('./serveur-test.cjs');
/**
 * Console SH : ERP de bout en bout, sur une vraie base PostgreSQL (TEST_DATABASE_URL), données fictives seulement.
 * Parcours : Prospect → Devis → Contrat → Projet → Tâches → Hôpital D → Import CSV/Excel → Utilisateurs → Modules
 *            → Formation → Go Live (recette vers une production de test) → Support → Facturation,
 * puis documents, rapports, hébergement, calendrier, notifications, équipes et contrôles de sécurité par rôle.
 *
 *   TEST_DATABASE_URL=postgres:///arrimo_test node --test tests/sh-erp.test.cjs
 */
// Comme le service (src/sh/server.js) : processus en UTC, dates métier dans le fuseau du Québec.
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { creerAppSh } = require('../src/sh/app');
const { viderBase } = require('../db/vider');
const { viderBaseSh } = require('../db/sh-vider');
const { configurationBase } = require('../db/configuration-base');
const { premierCompteSh } = require('../db/sh-premier-compte');
const invitations = require('../src/sh/invitations');
const { migrerSh, ERP_VERSION } = require('../src/sh/migrations');
const xlsx = require('../src/sh/xlsx');
const totp = require('../src/totp');
const courriel = require('../src/courriel');

const URL_TEST = process.env.TEST_DATABASE_URL;
const CLE_MFA = Buffer.alloc(32, 9).toString('base64');
const MDP = 'Console-ERP-2026';
let pool; let poolProd; let serveur; let serveurProd; let serveurSh; let base; let baseProd; let baseSh; let dossierDocs;
const courriels = [];
const jetons = {};

const enEnv = (e) => { process.env.ARRIMO_ENV = e; };
async function appel(jeton, methode, chemin, corps, { brut = false } = {}) {
  const r = await fetch(`${baseSh}/api${chemin}`, { method: methode,
    headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  if (brut) return { statut: r.status, type: r.headers.get('content-type'), octets: Buffer.from(await r.arrayBuffer()), entetes: r.headers };
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
/** Appel qui doit réussir ; rend le corps. */
async function ok(role, methode, chemin, corps) {
  const r = await appel(jetons[role], methode, chemin, corps);
  assert.ok(r.statut === 200, `${role} ${methode} ${chemin} → ${r.statut} ${JSON.stringify(r.corps)}`);
  return r.corps;
}
const statut = async (role, methode, chemin, corps) => (await appel(role ? jetons[role] : null, methode, chemin, corps)).statut;

/** Session complète (mot de passe choisi + double authentification), comme un vrai membre de l'équipe SH. */
async function ouvrirSession(email) {
  let r = await appel(null, 'POST', '/connexion', { email, mot_de_passe: MDP });
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  const jeton = r.corps.token;
  const { secret } = (await appel(jeton, 'POST', '/moi/2fa/preparer')).corps;
  assert.strictEqual((await appel(jeton, 'POST', '/moi/2fa/activer', { code: totp.codePourPas(secret, totp.pasActuel()) })).statut, 200);
  r = await appel(null, 'POST', '/connexion', { email, mot_de_passe: MDP });
  assert.strictEqual(r.corps.etape, '2fa');
  r = await appel(null, 'POST', '/connexion/2fa', { jeton: r.corps.jeton, code: totp.codePourPas(secret, totp.pasActuel() + 1) });
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  return r.corps.token;
}
const dernierJeton = () => courriels.at(-1).texte.match(/#invitation=([a-f0-9]{64})/)[1];
const pdfMinimal = (texte) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% ${texte}\ntrailer<</Root 1 0 R>>\n%%EOF\n`);

test.before(async () => {
  assert.ok(URL_TEST, 'TEST_DATABASE_URL requis');
  process.env.SH_API_KEY = 'cle-erp-sh-0123456789abcdef';
  process.env.ARRIMO_URL = 'https://arrimo.test.invalid';
  process.env.SH_PUBLIC_URL = 'https://sh.test.invalid';
  process.env.SH_MFA_ENCRYPTION_KEY = CLE_MFA;
  process.env.SH_INITIAL_ADMIN_EMAIL = 'admin.erp@sh.exemple';
  delete process.env.ARRIMO_DEMO;
  courriel.definirTransport(async (m) => { courriels.push(m); });
  pool = creerPool(URL_TEST);
  // Recette vide (configuration de base) et « production » de test sur un schéma séparé de la même base de test.
  await viderBase(pool);
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await configurationBase(pool);
  await pool.query('DROP SCHEMA IF EXISTS prod_erp CASCADE; CREATE SCHEMA prod_erp');
  poolProd = new Pool({ connectionString: URL_TEST, options: '-c search_path=prod_erp' });
  await poolProd.query(schema);
  await configurationBase(poolProd);
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  serveurProd = await demarrerServeur(creerApp(poolProd)); baseProd = `http://127.0.0.1:${serveurProd.address().port}`;
  dossierDocs = fs.mkdtempSync(path.join(os.tmpdir(), 'arrimo-sh-docs-'));
  await viderBaseSh(pool);
  await premierCompteSh(pool, 'admin.erp@sh.exemple', 'Administration fictive');
  await invitations.consommer(pool, { jeton: dernierJeton(), nouveau: MDP }, process.env);
  serveurSh = await demarrerServeur(creerAppSh(pool, { env: {
    SH_PUBLIC_URL: 'https://sh.test.invalid', SH_MFA_ENCRYPTION_KEY: CLE_MFA, SH_DOCUMENTS_DIR: dossierDocs,
    SH_ENV_RECETTE_URL: base, SH_ENV_RECETTE_CLE: process.env.SH_API_KEY, SH_ENV_RECETTE_PUBLIC: 'https://recette.arrimo.exemple',
    SH_ENV_PRODUCTION_URL: baseProd, SH_ENV_PRODUCTION_CLE: process.env.SH_API_KEY, SH_ENV_PRODUCTION_PUBLIC: 'https://arrimo.exemple',
    SH_EMETTEUR_NOM: 'SH fictive inc.',
  } }));
  baseSh = `http://127.0.0.1:${serveurSh.address().port}`;
  jetons.admin = await ouvrirSession('admin.erp@sh.exemple');
  // Personnel : un compte par rôle, chacun par invitation individuelle.
  for (const role of ['commercial', 'finance', 'implantation', 'formation', 'support']) {
    const email = `${role}.erp@sh.exemple`;
    await ok('admin', 'POST', '/equipe', { nom: `${role[0].toUpperCase()}${role.slice(1)} fictif`, email, role });
    await invitations.consommer(pool, { jeton: dernierJeton(), nouveau: MDP }, process.env);
    jetons[role] = await ouvrirSession(email);
  }
});
test.after(async () => {
  serveurSh?.close(); serveur?.close(); serveurProd?.close();
  await poolProd?.end(); await pool?.end();
  courriel.definirTransport(null);
  if (dossierDocs) fs.rmSync(dossierDocs, { recursive: true, force: true });
});

const ids = {};
const membres = {};

test('migration ERP : version 6, rejouable sans effet, rôle Finance accepté', async () => {
  const r = await migrerSh(pool, process.env);
  assert.deepStrictEqual([ERP_VERSION, r.appliquee], [6, false]);
  assert.ok((await pool.query('SELECT 1 FROM sh_migrations WHERE version=6')).rowCount);
  assert.strictEqual((await pool.query(`SELECT role FROM sh_utilisateurs WHERE email='finance.erp@sh.exemple'`)).rows[0].role, 'finance');
  for (const u of await ok('admin', 'GET', '/personnel')) membres[u.role] = u.id;
  assert.strictEqual(Object.keys(membres).length, 6);
});

test('sécurité : session, double authentification et matrice des rôles', async () => {
  assert.strictEqual(await statut(null, 'GET', '/facturation/factures'), 401);
  assert.strictEqual((await appel('jeton-invente', 'GET', '/projets')).statut, 401);
  const refus = [
    ['commercial', 'GET', '/facturation/factures'], ['support', 'POST', '/tarifs', { code: 'x1', libelle: 'X', prix_unitaire: 1 }],
    ['finance', 'POST', '/hopitaux/1/relier'], ['formation', 'GET', '/facturation/resume'], ['implantation', 'POST', '/facturation/generer'],
    ['commercial', 'POST', '/crm/devis/1/valider'], ['support', 'POST', '/crm/contrats/1/signe', { signataire: 'x', document_ref: 'y' }],
    ['finance', 'GET', '/hebergement'], ['commercial', 'GET', '/permissions'], ['support', 'POST', '/equipes', { nom: 'x' }],
    ['formation', 'POST', '/documents/1/archiver'], ['commercial', 'GET', '/rapports/export?section=factures'],
  ];
  for (const [role, m, chemin, corps] of refus) assert.strictEqual(await statut(role, m, chemin, corps), 403, `${role} ${m} ${chemin} doit être refusé`);
  const matrice = await ok('admin', 'GET', '/permissions');
  assert.ok(matrice.roles.includes('finance') && matrice.routes.length > 100);
});

test('tarification : grille de prix et taxes canadiennes', async () => {
  await ok('admin', 'POST', '/tarifs', { code: 'implantation', libelle: 'Implantation et paramétrage', prix_unitaire: 15000, periodicite: 'unique' });
  await ok('finance', 'POST', '/tarifs', { code: 'licence-lits', libelle: 'Licence Arrimo · lits et transferts', prix_unitaire: 1200, periodicite: 'mensuel', unite: 'établissement' });
  await ok('finance', 'POST', '/tarifs', { code: 'formation-jour', libelle: 'Journée de formation', prix_unitaire: 1500, periodicite: 'unique', unite: 'jour' });
  assert.strictEqual(await statut('finance', 'POST', '/tarifs', { code: 'Mauvais Code', libelle: 'x', prix_unitaire: 1 }), 400);
  assert.strictEqual((await ok('commercial', 'GET', '/tarifs')).length, 3);
  const taxes = await ok('finance', 'GET', '/facturation/taxes');
  assert.deepStrictEqual(taxes.filter((t) => t.region === 'QC').map((t) => [t.code, Number(t.taux)]), [['TPS', 5], ['TVQ', 9.975]]);
});

test('CRM : prospect, contact décideur, relance attribuée et notifiée', async () => {
  const org = await ok('commercial', 'POST', '/crm/organisations', { nom: 'Centre hospitalier fictif D', region: 'Québec', ville: 'Ville D', adresse: '1 rue Fictive', courriel_facturation: 'Comptes@CH-D.exemple' });
  ids.org = org.id;
  assert.strictEqual(org.courriel_facturation, 'comptes@ch-d.exemple');
  await ok('commercial', 'POST', `/crm/organisations/${org.id}/contacts`, { nom: 'Décideuse fictive D', fonction: 'Direction', courriel: 'direction@ch-d.exemple', decideur: true });
  assert.strictEqual(await statut('commercial', 'POST', `/crm/organisations/${org.id}/contacts`, { nom: 'Doublon', courriel: 'direction@ch-d.exemple' }), 409);
  const opp = await ok('commercial', 'POST', '/crm/opportunites', { organisation_id: org.id, titre: 'Implantation Arrimo · CH D', probabilite: 30, responsable_id: membres.commercial });
  ids.opp = opp.id;
  const demain = new Date(Date.now() + 86400000).toISOString();
  const relance = await ok('admin', 'POST', `/crm/opportunites/${opp.id}/activites`, { type: 'relance', titre: 'Relancer la direction fictive', echeance: demain, responsable_id: membres.commercial });
  const aFaire = await ok('commercial', 'GET', '/crm/activites?a_faire=1&moi=1');
  assert.ok(aFaire.some((a) => a.id === relance.id), 'la relance apparaît dans la liste à faire du commercial');
  assert.ok((await ok('commercial', 'GET', '/notifications')).notifications.some((n) => n.type === 'relance'), 'le commercial est notifié');
  await ok('commercial', 'PUT', `/crm/activites/${relance.id}`, { terminee: true });
  assert.ok(!(await ok('commercial', 'GET', '/crm/activites?a_faire=1')).some((a) => a.id === relance.id));
  assert.strictEqual(await statut('commercial', 'PUT', `/crm/opportunites/${opp.id}`, { statut: 'perdue' }), 400, 'motif obligatoire pour une perte');
  assert.strictEqual((await ok('commercial', 'PUT', `/crm/opportunites/${opp.id}`, { statut: 'analyse' })).probabilite, 30, 'la probabilité est conservée si elle n’est pas fournie');
  const fiche = await ok('commercial', 'GET', `/crm/organisations/${org.id}`);
  assert.deepStrictEqual([fiche.contacts.length, fiche.opportunites.length, fiche.activites.length], [1, 1, 1]);
});

test('devis : tarifs, taxes du Québec, approbation, envoi, acceptation et PDF', async () => {
  const lignes = [{ code: 'implantation', quantite: 1 }, { code: 'licence-lits', quantite: 1 }, { code: 'formation-jour', quantite: 2 }];
  assert.strictEqual(await statut('commercial', 'POST', `/crm/opportunites/${ids.opp}/devis`, { lignes: [{ description: 'x', quantite: -1, prix_unitaire: 5 }] }), 400);
  const d = await ok('commercial', 'POST', `/crm/opportunites/${ids.opp}/devis`, { lignes });
  ids.devis = d.id;
  // 15 000 + 1 200 + 2 × 1 500 = 19 200 ; TPS 5 % = 960 ; TVQ 9,975 % = 1 915,20 ; total 22 075,20
  assert.deepStrictEqual([Number(d.sous_total), d.taxes.map((t) => [t.code, t.montant]), Number(d.total)], [19200, [['TPS', 960], ['TVQ', 1915.2]], 22075.2]);
  assert.strictEqual((await ok('commercial', 'GET', '/crm/opportunites')).find((o) => o.id === ids.opp).statut, 'proposition', 'un devis fait avancer l’opportunité');
  assert.strictEqual(await statut('commercial', 'PUT', `/crm/devis/${d.id}/statut`, { statut: 'envoye' }), 409, 'un brouillon ne s’envoie pas avant approbation');
  await ok('commercial', 'PUT', `/crm/devis/${d.id}/statut`, { statut: 'a_valider' });
  assert.ok((await ok('admin', 'GET', '/notifications')).notifications.some((n) => n.type === 'devis'), 'l’administration est notifiée du devis à approuver');
  assert.strictEqual(await statut('commercial', 'POST', `/crm/devis/${d.id}/valider`), 403);
  await ok('admin', 'POST', `/crm/devis/${d.id}/valider`);
  await ok('commercial', 'PUT', `/crm/devis/${d.id}/statut`, { statut: 'envoye' });
  await ok('commercial', 'PUT', `/crm/devis/${d.id}/statut`, { statut: 'accepte' });
  const pdf = await appel(jetons.commercial, 'GET', `/crm/devis/${d.id}/pdf`, null, { brut: true });
  assert.strictEqual(pdf.statut, 200);
  assert.match(pdf.type, /application\/pdf/);
  assert.strictEqual(pdf.octets.subarray(0, 5).toString(), '%PDF-');
});

test('contrat : préparation, document signé déposé, signature → projet, tâches et facturation', async () => {
  const c = await ok('commercial', 'POST', `/crm/opportunites/${ids.opp}/contrats`, { devis_id: ids.devis, duree_mois: 12, preavis_jours: 60 });
  ids.contrat = c.id;
  assert.strictEqual((await ok('commercial', 'POST', `/crm/opportunites/${ids.opp}/contrats`, { devis_id: ids.devis })).id, c.id, 'idempotent');
  await ok('commercial', 'PUT', `/crm/contrats/${c.id}`, { statut: 'pret_a_signer' });
  const contratPdf = await appel(jetons.commercial, 'GET', `/crm/contrats/${c.id}/pdf`, null, { brut: true });
  assert.strictEqual(contratPdf.octets.subarray(0, 5).toString(), '%PDF-');
  const doc = await ok('commercial', 'POST', '/documents', { nom: 'contrat-signe-ch-d.pdf', categorie: 'contrat', organisation_id: ids.org, contrat_id: c.id,
    contenu_base64: pdfMinimal('contrat fictif signé').toString('base64') });
  assert.strictEqual(await statut('admin', 'POST', `/crm/contrats/${c.id}/signe`, { signataire: 'Décideuse fictive D' }), 400, 'pièce de signature exigée');
  const s = await ok('admin', 'POST', `/crm/contrats/${c.id}/signe`, { signataire: 'Décideuse fictive D', document_id: doc.id });
  assert.strictEqual(s.taches_creees, 6);
  assert.strictEqual(s.abonnements_crees, 1, 'la licence mensuelle devient un abonnement');
  assert.ok(s.facture_initiale, 'les frais uniques donnent une facture brouillon');
  assert.strictEqual(s.projet.hopital_id, null, 'le projet existe avant la fiche établissement');
  assert.strictEqual(s.contrat.statut, 'signe');
  ids.projet = s.projet.id; ids.factureInitiale = s.facture_initiale;
  const rejoue = await ok('admin', 'POST', `/crm/contrats/${c.id}/signe`, { signataire: 'Décideuse fictive D', document_id: doc.id });
  assert.deepStrictEqual([rejoue.abonnements_crees, rejoue.facture_initiale], [0, null], 'rejouer la signature ne duplique pas la facturation');
  assert.strictEqual((await pool.query('SELECT count(*)::int n FROM sh_taches WHERE projet_id=$1', [ids.projet])).rows[0].n, 6);
  const detail = await ok('finance', 'GET', `/crm/contrats/${c.id}`);
  assert.strictEqual(detail.abonnements.length, 1);
  assert.ok(detail.date_fin && detail.renouvellement_le, 'période et préavis calculés à la signature');
  assert.ok((await ok('finance', 'GET', '/notifications')).notifications.some((n) => n.type === 'facturation'), 'la finance est notifiée');
  assert.strictEqual((await ok('commercial', 'GET', '/crm/opportunites')).find((o) => o.id === ids.opp).statut, 'gagnee');
});

test('projet et tâches : jalons, attribution notifiée, droits sur ses propres tâches, commentaires', async () => {
  const p = await ok('implantation', 'GET', `/projets/${ids.projet}`);
  assert.strictEqual(p.taches.length, 6);
  const jalon = await ok('implantation', 'POST', `/projets/${ids.projet}/jalons`, { nom: 'Recette validée', echeance: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10) });
  await ok('implantation', 'PUT', `/projets/${ids.projet}`, { statut: 'en_cours', responsable_id: membres.implantation });
  const tFormation = p.taches.find((t) => t.code_auto === 'formation');
  const echeance = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  await ok('implantation', 'PUT', `/taches/${tFormation.id}`, { responsable_id: membres.formation, priorite: 'haute', echeance });
  const notes = await ok('formation', 'GET', '/notifications');
  assert.ok(notes.non_lues >= 1 && notes.notifications.some((n) => n.type === 'tache'));
  await ok('formation', 'POST', '/notifications/lues', {});
  assert.strictEqual((await ok('formation', 'GET', '/notifications')).non_lues, 0);
  assert.strictEqual((await ok('formation', 'PUT', `/taches/${tFormation.id}`, { statut: 'en_cours' })).priorite, 'haute', 'mise à jour partielle : la priorité est conservée');
  const autre = p.taches.find((t) => t.code_auto === 'modules');
  assert.strictEqual(await statut('formation', 'PUT', `/taches/${autre.id}`, { statut: 'terminee' }), 403, 'une tâche d’un autre reste intouchable');
  await ok('formation', 'POST', `/taches/${tFormation.id}/commentaires`, { commentaire: 'Séances à planifier avec la coordination fictive.' });
  assert.strictEqual((await ok('implantation', 'GET', `/taches/${tFormation.id}/commentaires`)).length, 1);
  assert.ok((await ok('formation', 'GET', '/taches?moi=1')).some((t) => t.id === tFormation.id));
  const cal = await ok('formation', 'GET', `/calendrier?debut=${new Date().toISOString().slice(0, 10)}&fin=${new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)}`);
  assert.ok(cal.evenements.some((e) => e.type === 'tache' && e.id === tFormation.id && e.a_moi));
  assert.ok(cal.evenements.some((e) => e.type === 'jalon' && e.id === jalon.id));
  assert.strictEqual(await statut('implantation', 'PUT', `/projets/${ids.projet}`, { statut: 'termine' }), 409, 'pas de clôture avec des tâches ouvertes');
});

test('hôpital D : créé depuis le CRM, relié en recette, import CSV et Excel, utilisateurs, modules', async () => {
  enEnv('recette');
  const h = await ok('commercial', 'POST', `/crm/organisations/${ids.org}/hopital`, { environnement: 'recette', code_etab: 'HOP-D', sous_domaine: 'hopital-d',
    latitude: 46.2, longitude: -71.3, raison_sociale: 'Centre hospitalier fictif D', identifiant_legal: 'NEQ-FICTIF-D', utilisateurs_prevus: 3, utilisateurs_autorises: 5 });
  ids.hopital = h.id;
  assert.strictEqual(await statut('commercial', 'POST', `/crm/organisations/${ids.org}/hopital`, { environnement: 'recette', code_etab: 'HOP-D2' }), 409);
  assert.strictEqual(h.contact_nom, 'Décideuse fictive D', 'le décideur CRM devient le contact de la fiche');
  const p = await ok('implantation', 'GET', `/projets/${ids.projet}`);
  assert.strictEqual(p.hopital_id, h.id, 'le projet est rattaché à la nouvelle fiche');
  assert.strictEqual(p.taches.find((t) => t.code_auto === 'donnees_administratives').statut, 'terminee');
  let f = await ok('implantation', 'GET', `/hopitaux/${h.id}`);
  assert.ok(f.etapes[0].verifications.find((v) => v.code === 'contrat_signe').faite, 'contrat signé coché automatiquement');
  await ok('implantation', 'POST', `/hopitaux/${h.id}/relier`);
  const csv = {
    unites: 'unite;type_unite\nMédecine D;MED\nChirurgie D;CHIR\n',
    chambres: 'unite;chambre\nMédecine D;101\nMédecine D;102\nChirurgie D;201\n',
    civieres: 'civiere;categorie\nD-C1;reguliere\nD-C2;debordement\n',
    utilisateurs: 'nom;courriel;role\nCoordination fictive D;coord@ch-d.exemple;coordonnateur\nEntretien fictif D;entretien@ch-d.exemple;entretien\nAdministration fictive D;admin@ch-d.exemple;admin_etab\n',
  };
  for (const type of ['unites', 'chambres']) {
    const v = await ok('implantation', 'POST', `/hopitaux/${h.id}/import/verifier`, { type, contenu: csv[type] });
    assert.strictEqual(v.nb_erreurs, 0, JSON.stringify(v.erreurs));
    await ok('implantation', 'POST', `/hopitaux/${h.id}/import/importer`, { type, contenu: csv[type], empreinte: v.empreinte });
  }
  // Lits par classeur Excel : analyse des colonnes, vérification, import
  const classeur = xlsx.xlsxDepuisLignes([['unite', 'chambre', 'lit', 'isolement', 'pression_negative', 'ventilation', 'telemetrie'],
    ['Médecine D', '101', 'D-101A', 'oui', 'non', 'non', 'non'], ['Médecine D', '102', 'D-102A', 'non', 'non', 'non', 'oui'], ['Chirurgie D', '201', 'D-201A', 'non', 'oui', 'non', 'non']]).toString('base64');
  const analyse = await ok('implantation', 'POST', `/hopitaux/${h.id}/import/analyser`, { type: 'lits', contenu_xlsx: classeur });
  assert.strictEqual(analyse.apercu.length, 3);
  const vx = await ok('implantation', 'POST', `/hopitaux/${h.id}/import/verifier`, { type: 'lits', contenu_xlsx: classeur });
  assert.strictEqual(vx.nb_erreurs, 0, JSON.stringify(vx.erreurs));
  await ok('implantation', 'POST', `/hopitaux/${h.id}/import/importer`, { type: 'lits', contenu_xlsx: classeur, empreinte: vx.empreinte });
  for (const type of ['civieres', 'utilisateurs']) {
    const v = await ok('implantation', 'POST', `/hopitaux/${h.id}/import/verifier`, { type, contenu: csv[type] });
    assert.strictEqual(v.nb_erreurs, 0, JSON.stringify(v.erreurs));
    const r = await ok('implantation', 'POST', `/hopitaux/${h.id}/import/importer`, { type, contenu: csv[type], empreinte: v.empreinte });
    if (type === 'utilisateurs') assert.strictEqual(r.invitations_envoyees, 3, 'invitations individuelles, aucun mot de passe transmis');
  }
  const e = (await pool.query(`SELECT id FROM etablissements WHERE code='HOP-D'`)).rows[0];
  const compte = async (table) => (await pool.query(`SELECT count(*)::int n FROM ${table} WHERE etablissement_id=$1`, [e.id])).rows[0].n;
  assert.deepStrictEqual([await compte('unites'), await compte('lits')], [2, 3]);
  assert.strictEqual(await statut('commercial', 'PUT', `/hopitaux/${h.id}/modules`, { modules: [{ code: 'lits', licence: 'souscrit' }] }), 403, 'souscription réservée à l’administration');
  await ok('admin', 'PUT', `/hopitaux/${h.id}/modules`, { modules: [{ code: 'lits', licence: 'souscrit' }, { code: 'civieres', licence: 'souscrit' }, { code: 'transferts', licence: 'souscrit' }] });
  const taches = Object.fromEntries((await ok('implantation', 'GET', `/projets/${ids.projet}`)).taches.map((t) => [t.code_auto, t.statut]));
  assert.deepStrictEqual([taches.import_structure, taches.utilisateurs, taches.modules], ['terminee', 'terminee', 'terminee'], 'import, comptes et modules terminent leurs tâches');
  f = await ok('implantation', 'GET', `/hopitaux/${h.id}`);
  assert.strictEqual(f.comptes.invites, 3);
});

test('formation : séance, participants issus des comptes Arrimo, présence et validation', async () => {
  const debut = new Date(Date.now() + 3 * 86400000).toISOString();
  const s = await ok('formation', 'POST', `/hopitaux/${ids.hopital}/formation/sessions`, { role: 'coordination', titre: 'Coordination des lits · CH D', debut, duree_minutes: 120, lieu: 'Salle fictive', formateur_id: membres.formation });
  assert.strictEqual(await statut('formation', 'POST', `/hopitaux/${ids.hopital}/formation/sessions`, { role: 'inconnu', debut }), 400);
  const ajout = await ok('formation', 'POST', `/formation/sessions/${s.id}/participants`, { depuis_comptes: true });
  assert.strictEqual(ajout.ajoutes, 1, 'le compte de coordination de D est inscrit');
  assert.strictEqual((await ok('formation', 'POST', `/formation/sessions/${s.id}/participants`, { depuis_comptes: true })).ajoutes, 0, 'sans doublon');
  await ok('formation', 'POST', `/formation/sessions/${s.id}/participants`, { participants: [{ nom: 'Personne fictive externe', courriel: 'externe@ch-d.exemple' }] });
  const sessions = await ok('implantation', 'GET', `/hopitaux/${ids.hopital}/formation/sessions`);
  const [p1, p2] = sessions[0].participants;
  assert.strictEqual(await statut('formation', 'PUT', `/formation/participants/${p1.id}`, { valide: true }), 409, 'un absent ne peut pas être validé');
  await ok('formation', 'PUT', `/formation/participants/${p1.id}`, { present: true, valide: true });
  await ok('formation', 'PUT', `/formation/participants/${p2.id}`, { present: true, valide: true, note: 'Validé en séance fictive.' });
  await ok('formation', 'PUT', `/formation/sessions/${s.id}`, { statut: 'realisee' });
  const f = await ok('formation', 'GET', `/hopitaux/${ids.hopital}`);
  for (const el of f.formation.flatMap((r) => r.elements)) await ok('formation', 'PUT', `/formation/${el.id}`, { faite: true });
  assert.strictEqual((await ok('implantation', 'GET', `/projets/${ids.projet}`)).taches.find((t) => t.code_auto === 'formation').statut, 'terminee');
  const cal = await ok('formation', 'GET', `/calendrier?debut=${new Date().toISOString().slice(0, 10)}&fin=${new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)}`);
  assert.ok(cal.evenements.some((e) => e.type === 'formation' && e.id === s.id));
});

test('activation et Go Live : recette activée, structure transférée à la production de test, projet clos', async () => {
  let f = await ok('implantation', 'GET', `/hopitaux/${ids.hopital}`);
  for (const x of f.etapes.filter((et) => et.rang < 6).flatMap((et) => et.verifications).filter((x) => !x.faite)) await ok('implantation', 'PUT', `/verifications/${x.id}`, { faite: true });
  enEnv('recette');
  assert.strictEqual(await statut('implantation', 'POST', `/hopitaux/${ids.hopital}/activation`), 403, 'activation réservée à l’administration');
  await ok('admin', 'POST', `/hopitaux/${ids.hopital}/activation`);
  f = await ok('admin', 'GET', `/hopitaux/${ids.hopital}`);
  assert.strictEqual(f.statut, 'actif');
  const pre = await ok('admin', 'POST', `/hopitaux/${ids.hopital}/golive/preflight`);
  assert.strictEqual(pre.possible, true, JSON.stringify(pre.bloqueurs));
  enEnv('production');
  const g = await ok('admin', 'POST', `/hopitaux/${ids.hopital}/golive`);
  assert.strictEqual(g.resultats.find((r) => r.type === 'lits').resume.creer, 3);
  const prod = (await poolProd.query(`SELECT module_actif FROM etablissements WHERE code='HOP-D'`)).rows[0];
  assert.strictEqual(prod.module_actif, false, 'en production, l’établissement reste inactif jusqu’à l’activation');
  const p = await ok('implantation', 'GET', `/projets/${ids.projet}`);
  assert.strictEqual(p.taches.find((t) => t.code_auto === 'golive').statut, 'terminee');
  assert.strictEqual(p.avancement, 100, 'les six tâches modèle se sont terminées avec les étapes réelles');
  await ok('implantation', 'PUT', `/projets/${ids.projet}`, { statut: 'termine' });
  enEnv('recette');
});

test('support : incident critique, délai de service, affectation, messages, résolution et historique', async () => {
  const t = await ok('implantation', 'POST', '/support/tickets', { hopital_id: ids.hopital, type: 'incident', gravite: 'critique', titre: 'Écran des lits indisponible (fictif)', description: 'Signalé lors de la formation fictive.' });
  assert.strictEqual(t.priorite, 'urgente');
  const heures = (new Date(t.echeance) - new Date(t.cree_le)) / 3600000;
  assert.ok(Math.abs(heures - 4) < 0.01, 'urgence : prise en charge sous 4 heures');
  assert.ok((await ok('support', 'GET', '/notifications')).notifications.some((n) => n.type === 'support'), 'l’équipe support est notifiée');
  assert.strictEqual(await statut('implantation', 'PUT', `/support/tickets/${t.id}`, { statut: 'en_cours' }), 403);
  await ok('support', 'PUT', `/support/tickets/${t.id}`, { responsable_id: membres.support, statut: 'en_cours' });
  await ok('support', 'POST', `/support/tickets/${t.id}/messages`, { message: 'Cache navigateur vidé ; vérification en cours.' });
  assert.strictEqual(await statut('support', 'PUT', `/support/tickets/${t.id}`, { statut: 'ferme' }), 400, 'résolution décrite avant fermeture');
  assert.strictEqual(await statut('support', 'PUT', `/support/tickets/${t.id}`, { statut: 'ferme', resolution: 'x' }), 409, 'fermeture après résolution seulement');
  await ok('support', 'PUT', `/support/tickets/${t.id}`, { statut: 'resolu', resolution: 'Cache du poste fictif vidé, service rétabli.' });
  await ok('support', 'PUT', `/support/tickets/${t.id}`, { statut: 'ferme' });
  const d = await ok('support', 'GET', `/support/tickets/${t.id}`);
  assert.strictEqual(d.messages.length, 1);
  assert.deepStrictEqual(d.evenements.filter((e) => e.champ === 'statut').map((e) => e.apres), ['en_cours', 'resolu', 'ferme']);
  assert.ok(d.resolu_le);
  const suivi = await ok('support', 'GET', `/hopitaux/${ids.hopital}/suivi`);
  assert.ok(suivi.tickets.some((x) => x.id === t.id) && suivi.projets.length === 1 && !suivi.factures, 'vue 360 limitée au rôle');
});

test('facturation : frais uniques, abonnement, numérotation, paiements partiels, PDF, résumé', async () => {
  assert.strictEqual(await statut('finance', 'GET', `/facturation/factures/${ids.factureInitiale}/pdf`), 409, 'pas de PDF pour un brouillon');
  const f1 = await ok('finance', 'POST', `/facturation/factures/${ids.factureInitiale}/emettre`);
  const annee = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }).slice(0, 4);
  assert.strictEqual(f1.numero, `FAC-${annee}-0001`);
  // Frais uniques : 15 000 + 3 000 = 18 000 ; TPS 900 ; TVQ 1 795,50 ; total 20 695,50
  assert.deepStrictEqual([Number(f1.sous_total), Number(f1.total), f1.etat], [18000, 20695.5, 'emise']);
  const [abo] = await ok('finance', 'GET', '/facturation/abonnements');
  assert.strictEqual(Number(abo.montant_periode), 1200);
  const f2 = await ok('finance', 'POST', `/facturation/abonnements/${abo.id}/facturer`);
  assert.deepStrictEqual([Number(f2.total), f2.statut], [1379.7, 'brouillon'], '1 200 + TPS 60 + TVQ 119,70');
  assert.strictEqual((await ok('finance', 'POST', '/facturation/generer')).factures_creees, 0, 'la période suivante n’est pas encore due');
  const f2e = await ok('finance', 'POST', `/facturation/factures/${f2.id}/emettre`);
  assert.strictEqual(f2e.numero, `FAC-${annee}-0002`, 'numérotation séquentielle sans trou');
  assert.strictEqual(await statut('finance', 'POST', `/facturation/factures/${f1.id}/paiements`, { montant: 999999, mode: 'virement' }), 409, 'pas de paiement au-delà du solde');
  assert.strictEqual(await statut('finance', 'POST', `/facturation/factures/${f1.id}/paiements`, { montant: 10, mode: 'bitcoin' }), 400);
  let p = await ok('finance', 'POST', `/facturation/factures/${f1.id}/paiements`, { montant: 10000, mode: 'virement', reference: 'VIR-FICTIF-1' });
  assert.deepStrictEqual([p.etat, Number(p.solde)], ['partiellement_payee', 10695.5]);
  assert.strictEqual(await statut('finance', 'POST', `/facturation/factures/${f1.id}/annuler`, { motif: 'erreur' }), 409, 'facture payée en partie : non annulable');
  p = await ok('finance', 'POST', `/facturation/factures/${f1.id}/paiements`, { montant: 10695.5, mode: 'cheque', reference: 'CHQ-FICTIF-2' });
  assert.deepStrictEqual([p.etat, Number(p.solde)], ['payee', 0]);
  const pdf = await appel(jetons.finance, 'GET', `/facturation/factures/${f1.id}/pdf`, null, { brut: true });
  assert.strictEqual(pdf.octets.subarray(0, 5).toString(), '%PDF-');
  const brouillon = await ok('finance', 'POST', '/facturation/factures', { organisation_id: ids.org, lignes: [{ description: 'Journée supplémentaire fictive', quantite: 1, prix_unitaire: 500 }] });
  await ok('finance', 'POST', `/facturation/factures/${brouillon.id}/annuler`, { motif: 'Saisie de test fictive' });
  const resume = await ok('finance', 'GET', '/facturation/resume');
  assert.strictEqual(Number(resume.mrr.find((m) => m.devise === 'CAD').mrr), 1200);
  assert.strictEqual(Number(resume.encaisse_mois.find((m) => m.devise === 'CAD').total), 20695.5);
  assert.strictEqual(resume.abonnements_a_facturer, 0);
  const suivi = await ok('finance', 'GET', `/hopitaux/${ids.hopital}/suivi`);
  assert.strictEqual(suivi.factures.length, 3, 'les factures sont rattachées à l’établissement créé après la signature');
});

test('contrat : renouvellement et résiliation journalisés', async () => {
  const avant = await ok('admin', 'GET', `/crm/contrats/${ids.contrat}`);
  const r = await ok('admin', 'POST', `/crm/contrats/${ids.contrat}/renouveler`);
  assert.ok(String(r.date_fin) > String(avant.date_fin));
  assert.strictEqual((await ok('admin', 'GET', `/crm/contrats/${ids.contrat}`)).renouvellements.length, 1);
  assert.strictEqual(await statut('admin', 'POST', `/crm/contrats/${ids.contrat}/resilier`, {}), 400);
  assert.ok((await pool.query(`SELECT 1 FROM sh_journal WHERE action='Contrat renouvelé'`)).rowCount);
});

test('documents : chiffrés sur disque, versions, accès par catégorie, intégrité contrôlée', async () => {
  const contenu = pdfMinimal('procédure technique fictive');
  const d1 = await ok('implantation', 'POST', '/documents', { nom: 'procedure-installation.pdf', categorie: 'technique', hopital_id: ids.hopital, contenu_base64: contenu.toString('base64') });
  const fichierDisque = fs.readFileSync(path.join(dossierDocs, (await pool.query('SELECT stockage_ref FROM sh_documents WHERE id=$1', [d1.id])).rows[0].stockage_ref));
  assert.ok(!fichierDisque.includes(Buffer.from('procédure technique fictive')), 'le contenu n’est jamais écrit en clair');
  const d2 = await ok('implantation', 'POST', '/documents', { nom: 'procedure-installation.pdf', categorie: 'technique', remplace_id: d1.id, contenu_base64: pdfMinimal('version 2').toString('base64') });
  assert.strictEqual(d2.version, 2);
  assert.strictEqual((await ok('support', 'GET', `/documents/${d2.id}/versions`)).length, 2);
  const liste = await ok('support', 'GET', `/documents?hopital_id=${ids.hopital}`);
  assert.deepStrictEqual(liste.filter((x) => x.groupe === d1.groupe).map((x) => x.version), [2], 'seule la dernière version est listée');
  const telecharge = await appel(jetons.support, 'GET', `/documents/${d1.id}/fichier`, null, { brut: true });
  assert.ok(telecharge.octets.equals(contenu), 'déchiffré à l’identique');
  assert.match(telecharge.entetes.get('content-security-policy'), /sandbox/);
  assert.strictEqual((await appel(jetons.commercial, 'GET', `/documents/${d1.id}/fichier`, null, { brut: true })).statut, 404, 'catégorie technique fermée au commercial');
  assert.strictEqual(await statut('support', 'POST', '/documents', { nom: 'facture.pdf', categorie: 'facture', contenu_base64: contenu.toString('base64') }), 403);
  const conf = await ok('admin', 'POST', '/documents', { nom: 'note-confidentielle.txt', categorie: 'general', confidentiel: true, contenu_base64: Buffer.from('Note fictive').toString('base64') });
  assert.ok(!(await ok('commercial', 'GET', '/documents')).some((x) => x.id === conf.id), 'document confidentiel invisible hors administration');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
  assert.strictEqual(await statut('implantation', 'POST', '/documents', { nom: 'faux.pdf', categorie: 'technique', contenu_base64: png }), 400, 'signature du contenu vérifiée');
  assert.strictEqual(await statut('implantation', 'POST', '/documents', { nom: 'script.html', categorie: 'technique', contenu_base64: Buffer.from('<script>').toString('base64') }), 400);
  // Altération sur disque : détectée au téléchargement
  const ref = (await pool.query('SELECT stockage_ref FROM sh_documents WHERE id=$1', [d2.id])).rows[0].stockage_ref;
  const brut = fs.readFileSync(path.join(dossierDocs, ref)); brut[brut.length - 1] ^= 0xff; fs.writeFileSync(path.join(dossierDocs, ref), brut);
  assert.strictEqual((await appel(jetons.support, 'GET', `/documents/${d2.id}/fichier`, null, { brut: true })).statut, 500);
  await ok('admin', 'POST', `/documents/${d2.id}/archiver`);
});

test('personnel : équipes avec chef, membres et notifications ciblées', async () => {
  const e = await ok('admin', 'POST', '/equipes', { nom: 'Implantation Québec (fictive)', membres: [{ utilisateur_id: membres.implantation, chef: true }, { utilisateur_id: membres.formation }] });
  assert.strictEqual(await statut('admin', 'POST', '/equipes', { nom: 'implantation québec (fictive)' }), 409);
  assert.strictEqual(await statut('admin', 'PUT', `/equipes/${e.id}`, { nom: 'X', membres: [{ utilisateur_id: 99999 }] }), 400);
  const liste = await ok('support', 'GET', '/equipes');
  assert.deepStrictEqual(liste[0].membres.map((m) => [m.role, m.chef]), [['implantation', true], ['formation', false]]);
});

test('hébergement : supervision des environnements et disponibilité sur 24 h', async () => {
  const r = await ok('support', 'POST', '/hebergement/verifier');
  assert.deepStrictEqual(r.map((x) => [x.code, x.ok]), [['recette', true], ['production', true]]);
  const h = await ok('implantation', 'GET', '/hebergement');
  const recette = h.environnements.find((x) => x.code === 'recette');
  assert.deepStrictEqual([recette.disponibilite_24h, recette.dernier_releve.version], [100, '1.0.0']);
  assert.strictEqual(h.sauvegardes.configure, false, 'état des sauvegardes signalé comme non configuré, sans valeur inventée');
});

test('rapports : indicateurs par rôle et export CSV protégé contre les formules', async () => {
  const admin = await ok('admin', 'GET', '/rapports/indicateurs');
  assert.strictEqual(admin.taux_conversion, 100);
  assert.strictEqual(admin.contrats.actifs, 1);
  assert.strictEqual(Number(admin.mrr[0].mrr), 1200);
  assert.strictEqual(admin.support.incidents_ouverts, 0);
  assert.ok(admin.formation.find((x) => x.id === ids.hopital).participants_valides === 2);
  const support = await ok('support', 'GET', '/rapports/indicateurs');
  assert.ok(support.support && !support.factures && !support.pipeline, 'le support ne voit ni facturation ni pipeline');
  await ok('commercial', 'POST', '/crm/organisations', { nom: '=HYPERLINK("http://exemple.invalid")' });
  const opp = await ok('commercial', 'POST', '/crm/opportunites', { organisation_id: (await ok('commercial', 'GET', '/crm/organisations')).find((o) => o.nom.startsWith('=')).id, titre: 'Test injection' });
  assert.ok(opp.id);
  const exp = await appel(jetons.commercial, 'GET', '/rapports/export?section=pipeline', null, { brut: true });
  assert.strictEqual(exp.statut, 200);
  const texte = exp.octets.toString('utf8');
  assert.ok(texte.includes(`"'=HYPERLINK`), 'formule neutralisée dans l’export');
  const factures = (await appel(jetons.finance, 'GET', '/rapports/export?section=factures', null, { brut: true })).octets.toString('utf8');
  assert.strictEqual(factures.trim().split('\r\n').length, 4, 'en-tête + 3 factures non brouillon');
});

test('journal : chaque étape du parcours est tracée, et le journal reste immuable', async () => {
  const actions = new Set((await pool.query('SELECT action FROM sh_journal')).rows.map((r) => r.action));
  for (const a of ['Organisation CRM créée', 'Devis créé', 'Devis approuvé', 'Contrat marqué signé', 'Hôpital créé depuis le CRM', 'Import CSV', 'Module activé', 'Go-live',
    'Incident déclaré', 'Facture émise', 'Paiement enregistré', 'Document déposé', 'Participant validé', 'Équipe créée']) assert.ok(actions.has(a), `journal : ${a}`);
  await assert.rejects(pool.query(`UPDATE sh_journal SET action='x'`));
});

test('Go Live : pannes successives à la création, aux civières et aux comptes, reprises sans doublon ni état incohérent', async () => {
  enEnv('recette');
  const h = await ok('admin', 'POST', '/hopitaux', { nom: 'Hôpital E fictif', environnement: 'recette', code_etab: 'HOP-E', latitude: 46.4, longitude: -71.1, ville: 'Ville E', utilisateurs_autorises: 5 });
  await ok('admin', 'POST', `/hopitaux/${h.id}/relier`);
  const fichiers = { unites: 'unite;type_unite\nMédecine E;MED\n', chambres: 'unite;chambre\nMédecine E;301\n', lits: 'unite;chambre;lit\nMédecine E;301;E-301A\nMédecine E;301;E-301B\n',
    civieres: 'civiere;categorie\nE-C1;reguliere\n', utilisateurs: 'nom;courriel;role\nCoordination E;coord@e.exemple;coordonnateur\nEntretien E;entretien@e.exemple;entretien\n' };
  for (const [type, contenu] of Object.entries(fichiers)) {
    const v = await ok('admin', 'POST', `/hopitaux/${h.id}/import/verifier`, { type, contenu });
    await ok('admin', 'POST', `/hopitaux/${h.id}/import/importer`, { type, contenu, empreinte: v.empreinte });
  }
  // Étapes de contrôle validées directement (le parcours détaillé est couvert par le test d'activation)
  await pool.query(`UPDATE verifications v SET faite=true, par='test', quand=now() FROM etapes e WHERE e.id=v.etape_id AND e.hopital_id=$1 AND e.rang < 6`, [h.id]);
  await pool.query('UPDATE formation_elements SET faite=true WHERE hopital_id=$1', [h.id]);
  const prodE = async () => (await poolProd.query(`SELECT (SELECT count(*)::int FROM etablissements WHERE code='HOP-E') etab,
    (SELECT count(*)::int FROM lits l JOIN etablissements e ON e.id=l.etablissement_id WHERE e.code='HOP-E') lits,
    (SELECT count(*)::int FROM civieres c JOIN etablissements e ON e.id=c.etablissement_id WHERE e.code='HOP-E') civieres,
    (SELECT count(*)::int FROM utilisateurs u JOIN utilisateur_etablissements ue ON ue.utilisateur_id=u.id JOIN etablissements e ON e.id=ue.etablissement_id WHERE e.code='HOP-E') comptes`)).rows[0];
  const original = global.fetch;
  const pannes = [
    ['création de l’établissement', (url, o) => url.endsWith('/api/sh/etablissements') && o.method === 'POST'],
    ['import des civières', (url, o) => url.endsWith('/api/sh/import/importer') && JSON.parse(o.body).type === 'civieres'],
    ['import des comptes', (url, o) => url.endsWith('/api/sh/import/importer') && JSON.parse(o.body).type === 'utilisateurs'],
  ];
  enEnv('production');
  try {
    for (const [nom, cible] of pannes) {
      let declenchee = false;
      global.fetch = async (url, o = {}) => {
        if (!declenchee && String(url).startsWith(`${baseProd}/`) && cible(String(url), o)) { declenchee = true; return new Response(JSON.stringify({ erreur: `panne simulée : ${nom}` }), { status: 503, headers: { 'content-type': 'application/json' } }); }
        return original(url, o);
      };
      const r = await appel(jetons.admin, 'POST', `/hopitaux/${h.id}/golive`);
      global.fetch = original;
      assert.ok(declenchee, `panne injectée : ${nom}`);
      assert.strictEqual(r.statut, 502, `${nom} : ${JSON.stringify(r.corps)}`);
      const op = (await pool.query(`SELECT statut FROM sh_golive_operations WHERE hopital_id=$1`, [h.id])).rows;
      assert.deepStrictEqual(op.map((x) => x.statut), ['interrompu'], `${nom} : une seule opération, interrompue`);
      assert.strictEqual((await pool.query('SELECT environnement FROM hopitaux WHERE id=$1', [h.id])).rows[0].environnement, 'recette', `${nom} : la fiche reste en recette`);
      const p = await prodE();
      assert.ok(p.etab <= 1 && p.lits <= 2 && p.civieres <= 1 && p.comptes <= 2, `${nom} : pas de doublon partiel ${JSON.stringify(p)}`);
    }
    const fin = await appel(jetons.admin, 'POST', `/hopitaux/${h.id}/golive`);
    assert.strictEqual(fin.statut, 200, JSON.stringify(fin.corps));
    assert.deepStrictEqual(await prodE(), { etab: 1, lits: 2, civieres: 1, comptes: 2 }, 'reprise complète, sans doublon');
    assert.deepStrictEqual((await pool.query(`SELECT statut FROM sh_golive_operations WHERE hopital_id=$1`, [h.id])).rows.map((x) => x.statut), ['termine']);
    assert.strictEqual((await pool.query('SELECT environnement FROM hopitaux WHERE id=$1', [h.id])).rows[0].environnement, 'production');
    assert.strictEqual((await appel(jetons.admin, 'POST', `/hopitaux/${h.id}/golive`)).statut, 409, 'un second Go Live est refusé');
  } finally { global.fetch = original; enEnv('recette'); }
});
