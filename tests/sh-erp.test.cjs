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
let pool; let poolProd; let poolPilote; let serveur; let serveurProd; let serveurPilote; let serveurSh; let base; let baseProd; let basePilote; let baseSh; let dossierDocs;
const courriels = [];
const jetons = {};

let envSh;
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
  await pool.query('CREATE SCHEMA pilote_erp');
  poolPilote=new Pool({connectionString:URL_TEST,options:'-c search_path=pilote_erp'});
  await poolPilote.query(schema);await configurationBase(poolPilote);
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  serveurProd = await demarrerServeur(creerApp(poolProd)); baseProd = `http://127.0.0.1:${serveurProd.address().port}`;
  serveurPilote=await demarrerServeur(creerApp(poolPilote));basePilote=`http://127.0.0.1:${serveurPilote.address().port}`;
  dossierDocs = fs.mkdtempSync(path.join(os.tmpdir(), 'arrimo-sh-docs-'));
  await viderBaseSh(pool);
  await premierCompteSh(pool, 'admin.erp@sh.exemple', 'Administration fictive');
  await invitations.consommer(pool, { jeton: dernierJeton(), nouveau: MDP }, process.env);
  serveurSh = await demarrerServeur(creerAppSh(pool, { env: envSh = {
    SH_PUBLIC_URL: 'https://sh.test.invalid', SH_MFA_ENCRYPTION_KEY: CLE_MFA, SH_DOCUMENTS_DIR: dossierDocs,
    SH_ENV_RECETTE_URL: base, SH_ENV_RECETTE_CLE: process.env.SH_API_KEY, SH_ENV_RECETTE_PUBLIC: 'https://recette.arrimo.exemple',
    SH_ENV_PRODUCTION_URL: baseProd, SH_ENV_PRODUCTION_CLE: process.env.SH_API_KEY, SH_ENV_PRODUCTION_PUBLIC: 'https://arrimo.exemple',
    SH_ENV_PILOTE_URL:basePilote,SH_ENV_PILOTE_CLE:process.env.SH_API_KEY,SH_ENV_PILOTE_PUBLIC:'https://pilote.example.invalid',
    SH_EMETTEUR_NOM: 'SH fictive inc.',
  } }));
  baseSh = `http://127.0.0.1:${serveurSh.address().port}`;
  jetons.admin = await ouvrirSession('admin.erp@sh.exemple');
  // Personnel : un compte par rôle, chacun par invitation individuelle.
  for (const role of ['commercial', 'finance', 'implantation', 'formation', 'support']) {
    const email = `${role}.erp@sh.exemple`;
    await ok('admin', 'POST', '/equipe', { nom: `${role[0].toUpperCase()}${role.slice(1)} fictif`, email, role });
    await invitations.consommer(pool, { jeton: dernierJeton(), nouveau: MDP }, process.env);
    // Cette ancienne recette transverse utilise des responsables explicitement globaux.
    const affecte=(await pool.query('SELECT id FROM sh_utilisateurs WHERE email=$1',[email])).rows[0];
    await pool.query("INSERT INTO sh_affectations(utilisateur_id,type) VALUES($1,'global')",[affecte.id]);
    jetons[role] = await ouvrirSession(email);
  }
});
test.after(async () => {
  serveurSh?.close(); serveur?.close(); serveurProd?.close();serveurPilote?.close();
  await poolProd?.end();await poolPilote?.end(); await pool?.end();
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
  assert.ok(taxes.filter((t)=>t.region==='QC').every(t=>t.source_url?.startsWith('https://')&&t.verifie_le&&t.valide_de),'Chaque taux appliqué doit conserver provenance et dates.');
  const profils=await ok('finance','GET','/facturation/profils-fiscaux');
  assert.equal(profils.find(p=>p.pays_code==='CA'&&p.region==='QC').statut,'valide');
  assert.equal(profils.find(p=>p.pays_code==='CA'&&p.region==='BC').statut,'a_verifier','La PST provinciale ne doit pas être omise silencieusement.');
  assert.equal(await statut('finance','POST','/facturation/taxes',{pays_code:'TG',region:'*',code:'TVA',nom:'TVA',taux:18,valide_de:'2026-10-29',source_nom:'Source',source_url:'https://example.invalid',motif:'Taux de démonstration'}),403,'Seule l’administration gère le référentiel fiscal.');
  const paysSansProfil=await ok('admin','POST','/crm/organisations',{nom:'Client fictif sans profil fiscal',pays_code:'TG',region:'Maritime'});
  assert.equal(await statut('finance','POST','/facturation/factures',{organisation_id:paysSansProfil.id,lignes:[{description:'Service fictif',quantite:1,prix_unitaire:100}]}),409,'Une configuration absente ne vaut jamais une exonération.');
  const sansRegion=await ok('admin','POST','/crm/organisations',{nom:'Client canadien fictif sans province',pays_code:'CA'});
  assert.equal(await statut('finance','POST','/facturation/factures',{organisation_id:sansRegion.id,lignes:[{description:'Service fictif',quantite:1,prix_unitaire:100}]}),409,'Le profil fiscal canadien exige le lieu de fourniture régional.');
  assert.equal(await statut('admin','POST','/facturation/profils-fiscaux',{pays_code:'TG',region:'*',statut:'valide',source_nom:'Source',source_url:'http://example.invalid',motif:'Ne doit pas passer'}),400,'Un profil vérifié ne peut pas citer une source HTTP non chiffrée.');
  const clientAb=await ok('admin','POST','/crm/organisations',{nom:'Client fictif Alberta',pays_code:'CA',region:'AB'});
  const fAb=await ok('finance','POST','/facturation/factures',{organisation_id:clientAb.id,lignes:[{description:'Service fictif',quantite:1,prix_unitaire:100}]});
  assert.deepStrictEqual(fAb.taxes.map(t=>[t.code,t.taux,t.source_nom]),[['TPS',5,'Agence du revenu du Canada']],'AB : TPS nationale sourcée seulement.');
  assert.equal(Number(fAb.total),105);
  // Laissée en brouillon : les rapports n'incluent pas les brouillons.
  for(const region of ['BC','MB','SK']){
    const client=await ok('admin','POST','/crm/organisations',{nom:`Client fictif ${region} profil à vérifier`,pays_code:'CA',region});
    const refus=await appel(jetons.finance,'POST','/facturation/factures',{organisation_id:client.id,lignes:[{description:'Service fictif',quantite:1,prix_unitaire:100}]});
    assert.equal(refus.statut,409,`${region} : un profil « à vérifier » bloque la facture.`);
    assert.match(refus.corps.erreur||JSON.stringify(refus.corps),/doit être vérifié/);
  }
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
  // Des financiers de clients/pays différents ne doivent pas recevoir la référence de ce contrat.
  const autreClient=await ok('admin','POST','/crm/organisations',{nom:'Autre client confidentiel de recette',pays_code:'TG'});
  const sondes=[];
  const roleVide=(await pool.query("INSERT INTO sh_roles_personnalises(nom,base_role,permissions) VALUES('Finance sans factures','finance','{}') RETURNING id")).rows[0];
  const roleFactures=(await pool.query("INSERT INTO sh_roles_personnalises(nom,base_role,permissions) VALUES('Finance avec factures','finance',ARRAY['GET /facturation/factures']) RETURNING id")).rows[0];
  for(const [nom,affectation,autorise,role]of [
    ['client',{type:'client',organisation_id:ids.org},true,null],['pays-ca',{type:'pays',pays_code:'CA'},true,null],
    ['autre-client',{type:'client',organisation_id:autreClient.id},false,null],['pays-tg',{type:'pays',pays_code:'TG'},false,null],
    ['sans-perimetre',null,false,null],['sans-factures',{type:'client',organisation_id:ids.org},false,roleVide.id],
    ['avec-factures',{type:'client',organisation_id:ids.org},true,roleFactures.id]
  ]){
    const u=(await pool.query("INSERT INTO sh_utilisateurs(email,nom,role,mot_de_passe_hash,mdp_temporaire,totp_actif,role_personnalise_id) VALUES($1,$2,'finance','fixture-sans-connexion',false,true,$3) RETURNING id",[`finance.${nom}@example.invalid`,nom,role])).rows[0];
    if(affectation)await ok('admin','POST',`/equipe/${u.id}/affectations`,affectation);
    sondes.push({...u,nom,autorise,role_personnalise_id:role});
  }
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
  for(const u of sondes){
    const n=(await pool.query("SELECT count(*)::int n FROM sh_notifications WHERE utilisateur_id=$1 AND cle=$2",[u.id,`contrat-signe-${c.id}`])).rows[0].n;
    assert.strictEqual(n,u.autorise?1:0,`Notification financière : ${u.nom}`);
  }
  const restreint=require('../src/sh/perimetre-pool').creerPoolPerimetre(pool);
  const sondeClient=sondes.find(u=>u.nom==='client');
  const lire=(u)=>restreint.executer({...u,role:'finance',methode:'GET'},async()=>(await restreint.query('SELECT id FROM sh_notifications WHERE utilisateur_id=$1 AND cle=$2',[u.id,`contrat-signe-${c.id}`])).rowCount);
  assert.strictEqual(await lire(sondeClient),1);
  const aff=(await ok('admin','GET',`/equipe/${sondeClient.id}/affectations`))[0];
  await ok('admin','POST',`/equipe/${sondeClient.id}/affectations/${aff.id}/retirer`,{});
  assert.strictEqual(await lire(sondeClient),0,'Une notification passée devient invisible après retrait du client.');
  const permis=sondes.find(u=>u.nom==='avec-factures');assert.strictEqual(await lire(permis),1);
  await pool.query("UPDATE sh_roles_personnalises SET permissions='{}' WHERE id=$1",[roleFactures.id]);
  assert.strictEqual(await lire(permis),0,'Une notification passée devient invisible après retrait de permission.');
  await pool.query("INSERT INTO sh_notifications(utilisateur_id,type,titre,lien,cle) VALUES($1,'facturation','Ancienne notification sans client','facturation','legacy-confidentiel')",[sondeClient.id]);
  await ok('admin','POST',`/equipe/${sondeClient.id}/affectations`,{type:'global'});
  await restreint.executer({...sondeClient,role:'finance',methode:'GET'},async()=>assert.strictEqual((await restreint.query("SELECT id FROM sh_notifications WHERE cle='legacy-confidentiel'")).rowCount,0,'Une ancienne notification sans périmètre fiable reste masquée.'));
  await restreint.executer({...sondeClient,role:'finance',methode:'GET'},async()=>{
    await assert.rejects(restreint.query("SELECT sh_notifier_employe($1,'support','Écriture interdite','support',NULL,NULL)",[membres.administration]),e=>e.code==='42501','Le contexte lecture ne peut notifier un autre employé.');
  });
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

test('activation et Go Live : recette activée, structure transférée à la production de test, projet clos', async (t) => {
  let f = await ok('implantation', 'GET', `/hopitaux/${ids.hopital}`);
  for (const x of f.etapes.filter((et) => et.rang < 6).flatMap((et) => et.verifications).filter((x) => !x.faite)) await ok('implantation', 'PUT', `/verifications/${x.id}`, { faite: true });
  enEnv('recette');
  assert.strictEqual(await statut('implantation', 'POST', `/hopitaux/${ids.hopital}/activation`), 403, 'activation réservée à l’administration');
  await ok('admin', 'POST', `/hopitaux/${ids.hopital}/activation`);
  f = await ok('admin', 'GET', `/hopitaux/${ids.hopital}`);
  assert.strictEqual(f.statut, 'actif');
  const configurationAvant=await ok('admin','GET',`/hopitaux/${ids.hopital}/configuration-operationnelle`);
  await ok('admin','PUT',`/hopitaux/${ids.hopital}/configuration-operationnelle`,{
    modules:{urgence:true,nsa:false,nettoyage:true,national:false},vocation:'pediatrique',version:configurationAvant.version});
  const mappingAvant=process.env.ARRIMO_PROFILS_PAYS;
  process.env.ARRIMO_PROFILS_PAYS=JSON.stringify({...JSON.parse(mappingAvant||'{}'),'CA-TEST':'CA'});
  const autreProfil=(await poolProd.query("INSERT INTO config_pays(code,nom) VALUES('CA-TEST','Autre profil canadien fictif') RETURNING id")).rows[0];
  t.after(async()=>{
    await poolProd.query('DELETE FROM config_pays WHERE id=$1',[autreProfil.id]);
    if(mappingAvant===undefined)delete process.env.ARRIMO_PROFILS_PAYS;else process.env.ARRIMO_PROFILS_PAYS=mappingAvant;
  });
  const profilsProd=await ok('admin','GET',`/hopitaux/${ids.hopital}/golive/profils-pays`);
  assert.strictEqual(profilsProd.length,2);
  const config_id=profilsProd.find(p=>p.code==='QC').id;
  const ambigu=await ok('admin','POST',`/hopitaux/${ids.hopital}/golive/preflight`);
  assert.strictEqual(ambigu.possible,false);
  assert.ok(ambigu.bloqueurs.includes('profil_pays_cible_incompatible'));
  assert.strictEqual(await statut('admin','POST',`/hopitaux/${ids.hopital}/golive`),409);
  assert.strictEqual((await poolProd.query("SELECT count(*)::int n FROM etablissements WHERE code='HOP-D'")).rows[0].n,0);
  const pre = await ok('admin', 'POST', `/hopitaux/${ids.hopital}/golive/preflight`,{config_id});
  assert.strictEqual(pre.possible, true, JSON.stringify(pre.bloqueurs));
  enEnv('production');
  const g = await ok('admin', 'POST', `/hopitaux/${ids.hopital}/golive`,{config_id});
  assert.strictEqual((await ok('admin','GET',`/hopitaux/${ids.hopital}`)).statut,'implantation','La fiche SH attend l’activation de production.');
  assert.strictEqual(g.resultats.find((r) => r.type === 'lits').resume.creer, 3);
  const prod = (await poolProd.query(`SELECT module_actif,modules,vocation FROM etablissements WHERE code='HOP-D'`)).rows[0];
  assert.strictEqual(prod.module_actif, false, 'en production, l’établissement reste inactif jusqu’à l’activation');
  assert.deepStrictEqual(prod.modules,{nsa:false,national:false});assert.strictEqual(prod.vocation,'pediatrique');
  assert.deepStrictEqual(g.configuration.modules,{urgence:true,nsa:false,nettoyage:true,national:false,liaison_chsld:true});
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
  await ok('support', 'PUT', `/support/tickets/${t.id}`, { responsable_id: membres.support });
  const affectes=await ok('support','GET','/support/tickets?statut=assigne');
  assert.ok(affectes.some(x=>x.id===t.id&&x.statut==='ouvert'&&x.responsable_id===membres.support),'un ticket ouvert avec responsable apparaît dans la colonne Assigné');
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
  for (const t of f1.taxes) {
    assert.ok(t.source_url?.startsWith('https://') && t.source_nom && t.verifie_le && t.valide_de, `${t.code} : provenance et période figées sur la facture`);
  }
  assert.equal(f1.taxes.find((t) => t.code === 'TVQ').source_nom, 'Revenu Québec');
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
  // Une nouvelle version de règle ferme la période en cours sans réécrire la facture émise.
  const tvq = (await ok('finance', 'GET', '/facturation/taxes')).find((t) => t.region === 'QC' && t.code === 'TVQ' && !t.valide_jusqua);
  await ok('admin', 'POST', '/facturation/taxes', { pays_code: 'CA', region: 'QC', code: 'TVQ', nom: 'TVQ', taux: Number(tvq.taux), valide_de: '2099-01-01',
    source_nom: tvq.source_nom, source_url: tvq.source_url, motif: 'Version future fictive : test de conservation' });
  const fermee = (await ok('finance', 'GET', '/facturation/taxes')).find((t) => t.id === tvq.id);
  assert.match(String(fermee.valide_jusqua), /^2098-12-31/, 'la règle précédente est close la veille');
  assert.deepStrictEqual((await ok('finance', 'GET', `/facturation/factures/${f1.id}`)).taxes, f1.taxes, 'la facture émise conserve taux, période et source');
  assert.equal((await ok('finance', 'GET', '/facturation/taxes')).find((t) => t.region === 'QC' && t.code === 'TVQ' && String(t.valide_de).startsWith('2099')).ordre, tvq.ordre, 'l’ordre de calcul est conservé');
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
  assert.deepStrictEqual(r.map((x) => [x.code, x.ok]), [['recette', true], ['pilote',true], ['production', true]]);
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
  assert.ok(Object.hasOwn(admin.support,'prise_en_charge_sla_pct')&&Object.hasOwn(admin.support,'resolution_sla_pct'),'les rapports exposent les taux SLA et leurs dénominateurs');
  assert.ok(admin.formation.find((x) => x.id === ids.hopital).participants_valides === 2);
  const support = await ok('support', 'GET', '/rapports/indicateurs');
  assert.ok(support.support && !support.factures && !support.pipeline, 'le support ne voit ni facturation ni pipeline');
  assert.ok(support.support.prises_en_charge_sla_eligibles>=1&&support.support.prises_en_charge_sla_respectees>=1,'les échéances et délais mesurés alimentent les rapports support');
  await ok('commercial', 'POST', '/crm/organisations', { nom: '=HYPERLINK("http://exemple.invalid")' });
  const opp = await ok('commercial', 'POST', '/crm/opportunites', { organisation_id: (await ok('commercial', 'GET', '/crm/organisations')).find((o) => o.nom.startsWith('=')).id, titre: 'Test injection' });
  assert.ok(opp.id);
  for(const devise of ['USD','XOF'])await ok('commercial','POST','/crm/opportunites',{organisation_id:opp.organisation_id,titre:'Pipeline '+devise,montant:100,devise,probabilite:50});
  const multi=await ok('admin','GET','/rapports/indicateurs');
  for(const devise of ['USD','XOF']){
    const groupe=multi.pipeline.find(p=>p.statut==='qualification'&&p.devise===devise);
    assert.ok(groupe,devise);assert.strictEqual(Number(groupe.valeur),100);assert.strictEqual(Number(groupe.ponderee),50);
  }
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
test('référentiel international : route protégée, client non canadien et devise automatique',async t=>{
  const correspondanceAvant=process.env.ARRIMO_PROFILS_PAYS;
  process.env.ARRIMO_PROFILS_PAYS=JSON.stringify({...JSON.parse(correspondanceAvant||'{}'),TG:'TG'});
  t.after(()=>{if(correspondanceAvant===undefined)delete process.env.ARRIMO_PROFILS_PAYS;else process.env.ARRIMO_PROFILS_PAYS=correspondanceAvant;});
  assert.strictEqual(await statut(null,'GET','/references/internationales'),401);
  const refs=await ok('admin','GET','/references/internationales');assert.strictEqual(refs.pays.length,249);
  const org=await ok('commercial','POST','/crm/organisations',{nom:'Client international fictif',pays_code:'TG'});
  const opp=await ok('commercial','POST','/crm/opportunites',{organisation_id:org.id,titre:'Pilote international fictif'});
  assert.strictEqual(opp.devise,'XOF');
  assert.strictEqual(await statut('commercial','POST','/crm/organisations',{nom:'Pays invalide',pays_code:'ZZ'}),400);
  const tg=(await pool.query("INSERT INTO config_pays(code,nom) VALUES('TG','Profil Togo fictif') RETURNING id")).rows[0];
  await pool.query("INSERT INTO types_unite(config_id,code,nom,nom_en,ordre) VALUES($1,'MED','Médecine fictive','Fictitious medicine',1)",[tg.id]);
  const h=await ok('admin','POST',`/crm/organisations/${org.id}/hopital`,{code_etab:'TEST-TG',environnement:'recette',latitude:6.1,longitude:1.2});
  const profils=await ok('admin','GET',`/hopitaux/${h.id}/profils-pays`);
  assert.deepStrictEqual(profils.map(p=>p.id),[tg.id]);
  const qc=(await pool.query("SELECT id FROM config_pays WHERE code='QC'")).rows[0];
  assert.strictEqual(await statut('admin','POST',`/hopitaux/${h.id}/relier`,{config_id:qc.id}),409);
  assert.strictEqual((await pool.query("SELECT count(*)::int n FROM etablissements WHERE code='TEST-TG'")).rows[0].n,0);
  await ok('admin','POST',`/hopitaux/${h.id}/relier`,{config_id:tg.id});
  const etab=(await pool.query("SELECT id,config_id FROM etablissements WHERE code='TEST-TG'")).rows[0];
  assert.strictEqual(etab.config_id,tg.id);
  assert.strictEqual(await statut('admin','PUT',`/hopitaux/${h.id}`,{pays_code:'CA'}),409);
  assert.strictEqual((await ok('admin','GET',`/hopitaux/${h.id}`)).pays_code,'TG');
  for(const [type,contenu]of Object.entries({unites:'unite;type_unite\nMédecine Test;MED\n',chambres:'unite;chambre\nMédecine Test;101\n',lits:'unite;chambre;lit\nMédecine Test;101;TG-101\n'})){
    const v=await ok('admin','POST',`/hopitaux/${h.id}/import/verifier`,{type,contenu});
    await ok('admin','POST',`/hopitaux/${h.id}/import/importer`,{type,contenu,empreinte:v.empreinte});
  }
  const email='coord.pays@example.invalid',mdp='Fictif-Pays-2026';
  const u=(await pool.query("INSERT INTO utilisateurs(email,nom,role,mot_de_passe_hash,mdp_temporaire) VALUES($1,'Coordination Test TG','coordonnateur',$2,false) RETURNING id",[email,await require('../src/auth').hacherAsync(mdp)])).rows[0];
  await pool.query('INSERT INTO utilisateur_etablissements(utilisateur_id,etablissement_id) VALUES($1,$2)',[u.id,etab.id]);
  const connexion=await fetch(base+'/api/connexion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,mot_de_passe:mdp})});
  assert.strictEqual(connexion.status,200);const token=(await connexion.json()).token;assert.ok(token);
  const headers={Authorization:'Bearer '+token};
  const reseau=await fetch(base+`/api/reseau?depuis=${etab.id}`,{headers});assert.strictEqual(reseau.status,200);
  const vue=await reseau.json();assert.deepStrictEqual(vue.etablissements.map(e=>e.id),[etab.id]);
  const canadien=(await pool.query("SELECT id FROM etablissements WHERE config_id=$1 LIMIT 1",[qc.id])).rows[0];
  assert.ok(canadien);assert.strictEqual((await fetch(base+`/api/reseau?depuis=${canadien.id}`,{headers})).status,403);
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

test('Pilote Hôpital Test : client, équipe, structure, invitations, formation, OG vocal simulé, promotion et archivage',{timeout:180000},async t=>{
  const variables=['ARRIMO_ENV','ARRIMO_PATIENTS_FICTIFS','ARRIMO_OG_VOCAL_FICTIF'];
  const avant=Object.fromEntries(variables.map(k=>[k,process.env[k]]));
  t.after(()=>{for(const k of variables){if(avant[k]===undefined)delete process.env[k];else process.env[k]=avant[k];}});
  enEnv('pilote');process.env.ARRIMO_PATIENTS_FICTIFS='1';process.env.ARRIMO_OG_VOCAL_FICTIF='1';
  const org=await ok('admin','POST','/crm/organisations',{nom:'Pilote Hôpital Test',pays_code:'CA'});
  const h=await ok('admin','POST',`/crm/organisations/${org.id}/hopital`,{code_etab:'PILOTE-TEST',environnement:'pilote',latitude:46.1,longitude:-71.1});
  const projet=await ok('admin','POST','/projets',{hopital_id:h.id,nom:'Pilote Hôpital Test',type_projet:'pilote',responsable_id:membres.implantation,membres:[membres.implantation,membres.formation]});
  const critique=await ok('admin','POST',`/projets/${projet.id}/taches`,{titre:'Validation du pilote fictif',responsable_id:membres.implantation,critique_golive:true});
  await ok('admin','POST',`/hopitaux/${h.id}/relier`);
  const etab=(await poolPilote.query("SELECT id,module_actif FROM etablissements WHERE code='PILOTE-TEST'")).rows[0];
  assert.strictEqual(etab.module_actif,false,'Le pilote reste inactif avant validation explicite.');
  assert.strictEqual((await pool.query("SELECT count(*)::int n FROM etablissements WHERE code='PILOTE-TEST'")).rows[0].n,0,'La recette voisine est préservée.');
  const csv={departements:'departement;code\nSoins Test;SOINS\n',services:'service;code;departement\nMédecine Test;MED-TEST;Soins Test\n',unites:'unite;type_unite;service;departement\nUnité Test;MED;Médecine Test;Soins Test\n',chambres:'unite;chambre\nUnité Test;101\nUnité Test;102\n',lits:'unite;chambre;lit\nUnité Test;101;TEST-101\nUnité Test;102;TEST-102\n',civieres:'civiere;categorie\nTEST-C1;reguliere\n',utilisateurs:'nom;courriel;role\nCoordination Pilote Test;coord.pilote@example.invalid;coordonnateur\nEntretien Pilote Test;entretien.pilote@example.invalid;entretien\nAdministration Pilote Test;admin.pilote@example.invalid;admin_etab\n'};
  let invitationCoord;
  for(const [type,contenu]of Object.entries(csv)){
    const v=await ok('admin','POST',`/hopitaux/${h.id}/import/verifier`,{type,contenu});assert.strictEqual(v.nb_erreurs,0,JSON.stringify(v.erreurs));
    const r=await ok('admin','POST',`/hopitaux/${h.id}/import/importer`,{type,contenu,empreinte:v.empreinte});
    if(type==='utilisateurs'){
      assert.strictEqual(r.invitations_envoyees,3);
      invitationCoord=courriels.findLast(m=>m.a==='coord.pilote@example.invalid').texte.match(/#reinit=([a-f0-9]{64})/)[1];
    }
  }
  const config=await ok('admin','GET',`/hopitaux/${h.id}/configuration-operationnelle`);
  await ok('admin','PUT',`/hopitaux/${h.id}/configuration-operationnelle`,{version:config.version,vocation:'general',modules:{urgence:true,nsa:false,nettoyage:true,national:false}});
  // Licence OG détaillée (cahier OG §19) : le vocal fictif du pilote doit être inclus explicitement.
  // Provisionnement OG (cahier OG §19, §20.6) : la licence part de SH vers l'établissement relié, isolé de la recette voisine.
  const og1=await ok('admin','PUT',`/hopitaux/${h.id}/modules`,{modules:['lits','civieres','transferts','og'].map(code=>({code,licence:'souscrit',...(code==='og'?{parametres:{vocal:true,dictee:true,conversation:true,actions:true}}:{})}))});
  assert.strictEqual(og1.og_licence?.transmise,true,JSON.stringify(og1.og_licence));
  const licPilote=()=>poolPilote.query('SELECT licence,reglages FROM og_configurations WHERE etablissement_id=$1',[etab.id]).then(r=>r.rows[0]);
  assert.deepStrictEqual(Object.entries((await licPilote()).licence).filter(([,v])=>v).map(([k])=>k).sort(),['actions','conversation','dictee','texte','vocal']);
  assert.strictEqual((await pool.query("SELECT count(*)::int n FROM og_configurations o JOIN etablissements e ON e.id=o.etablissement_id WHERE e.code='PILOTE-TEST'")).rows[0].n,0,'aucune configuration OG dans la recette voisine');
  // Réglage local de l'établissement (nom d'assistant), puis nouvelle licence SH : la personnalisation est conservée.
  await poolPilote.query("UPDATE og_configurations SET reglages='{\"personnalisation\":{\"nom\":\"Aya\"}}'::jsonb WHERE etablissement_id=$1",[etab.id]);
  const og2=await ok('admin','PUT',`/hopitaux/${h.id}/modules`,{modules:['lits','civieres','transferts','og'].map(code=>({code,licence:'souscrit',...(code==='og'?{parametres:{vocal:true,dictee:true,conversation:true}}:{})}))});
  assert.strictEqual(og2.og_licence.transmise,true);
  const apres=await licPilote();
  assert.deepStrictEqual([apres.licence.actions,apres.licence.vocal,apres.reglages.personnalisation.nom],[false,true,'Aya'],'licence mise à jour, personnalisation préservée');
  const seance=await ok('admin','POST',`/hopitaux/${h.id}/formation/sessions`,{role:'coordination',titre:'Formation Pilote Hôpital Test',debut:new Date(Date.now()+3600000).toISOString(),duree_minutes:60,formateur_id:membres.formation});
  await ok('admin','POST',`/formation/sessions/${seance.id}/participants`,{depuis_comptes:true});
  const sessions=await ok('admin','GET',`/hopitaux/${h.id}/formation/sessions`);
  for(const p of sessions[0].participants)await ok('admin','PUT',`/formation/participants/${p.id}`,{present:true,valide:true});
  await ok('admin','PUT',`/formation/sessions/${seance.id}`,{statut:'realisee'});
  let fiche=await ok('admin','GET',`/hopitaux/${h.id}`);
  for(const e of fiche.formation.flatMap(x=>x.elements))await ok('admin','PUT',`/formation/${e.id}`,{faite:true});
  fiche=await ok('admin','GET',`/hopitaux/${h.id}`);
  for(const v of fiche.etapes.filter(e=>e.rang<6).flatMap(e=>e.verifications).filter(v=>!v.faite))await ok('admin','PUT',`/verifications/${v.id}`,{faite:true});
  assert.strictEqual(await statut('admin','POST',`/hopitaux/${h.id}/activation`),409,'La tâche critique bloque aussi le pilote.');
  await ok('admin','PUT',`/taches/${critique.id}`,{statut:'terminee'});
  await ok('admin','POST',`/hopitaux/${h.id}/activation`);
  async function hospitalier(method,path,body,token){
    const r=await fetch(basePilote+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
    const j=await r.json();assert.strictEqual(r.status,200,JSON.stringify(j));return j;
  }
  const mdp='Pilote-Fictif-2026';
  await hospitalier('POST','/mot-de-passe/reinitialiser',{jeton:invitationCoord,nouveau:mdp});
  const token=(await hospitalier('POST','/connexion',{email:'coord.pilote@example.invalid',mot_de_passe:mdp})).token;assert.ok(token);
  const gen=await ok('admin','POST',`/hopitaux/${h.id}/formation/generer`);assert.ok(gen.admissions>0);
  const texte=await hospitalier('POST','/copilote/question',{etablissement_id:etab.id,question:'Combien de lits de médecine sont occupés ?'},token);assert.ok(texte.reponse);
  const navigateur=await require('playwright').chromium.launch();
  try{
    const page=await navigateur.newPage();
    await page.addInitScript(({token,id})=>{
      localStorage.setItem('arrimo-token',token);localStorage.setItem('arrimo-ctx',String(id));window.__paroles=[];
      window.SpeechRecognition=class{constructor(){window.__reco=this;}start(){this.onstart?.();}abort(){}};
      window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
      Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{lang:'fr-CA',localService:true}],cancel(){},speak(u){window.__paroles.push(u.text);u.onstart?.();}},configurable:true});
    },{token,id:etab.id});
    await page.goto(basePilote);await page.waitForSelector('body[data-pret="1"]');
    if(await page.locator('#b-premiers-pas-ok').isVisible())await page.click('#b-premiers-pas-ok');
    await page.click('#og-open');await page.waitForSelector('#og-vocal:not([hidden])');
    // Autorisation vocale personnelle (Paramètres → OG), puis dictée par le bouton à icône.
    await page.evaluate(()=>window.ArrimoOgVoixPrefs.ecrire({consentement:true,automatique:true,langue:'fr-CA'}));await page.click('#og-dicter');
    await page.evaluate(()=>{window.__reco.onresult({results:[[{transcript:'Combien de lits de médecine sont occupés ?'}]]});window.__reco.onend();});
    const reponse=page.waitForResponse(r=>r.url().endsWith('/api/copilote/question'));
    await page.click('#og-envoyer');assert.ok((await(await reponse).json()).reponse);
    await page.waitForFunction(()=>window.__paroles.length>0);
  }finally{await navigateur.close();}
  // Deuxième production déclarée par simple réglage : le choix est explicite et la clé de ce pays part vers son adresse.
  const CIBLE={cible:'production_xx'},urlXx=baseProd.replace('127.0.0.1','localhost'),clesXx=[],appelsProdH=[];
  Object.assign(envSh,{SH_PRODUCTIONS:'production_xx:Production fictive',SH_ENV_PRODUCTION_XX_URL:urlXx,SH_ENV_PRODUCTION_XX_CLE:'cle-production-xx',SH_ENV_PRODUCTION_XX_PUBLIC:'https://xx.exemple'});
  const fetchReel=global.fetch;
  global.fetch=async(url,options)=>{
    const u=String(url);
    if(u.startsWith(urlXx)){clesXx.push(options?.headers?.['X-SH-Key']);return fetchReel(u.replace(urlXx,baseProd),{...options,headers:{...options.headers,'X-SH-Key':process.env.SH_API_KEY}});}
    if(u.startsWith(baseProd)&&options?.headers?.['X-SH-Key'])appelsProdH.push(u);
    return fetchReel(url,options);
  };
  t.after(()=>{global.fetch=fetchReel;for(const k of ['SH_PRODUCTIONS','SH_ENV_PRODUCTION_XX_URL','SH_ENV_PRODUCTION_XX_CLE','SH_ENV_PRODUCTION_XX_PUBLIC'])delete envSh[k];});
  assert.deepStrictEqual((await ok('admin','GET',`/hopitaux/${h.id}`)).golive.productions.map(x=>x.code),['production','production_xx']);
  const sansChoix=await ok('admin','POST',`/hopitaux/${h.id}/golive/preflight`);
  assert.ok(sansChoix.bloqueurs.includes('production_a_choisir'),JSON.stringify(sansChoix.bloqueurs));
  assert.strictEqual(await statut('admin','POST',`/hopitaux/${h.id}/golive`),409);
  assert.strictEqual(await statut('admin','POST',`/hopitaux/${h.id}/golive/preflight`,{cible:'production_zz'}),400);
  assert.strictEqual(await statut('admin','POST',`/hopitaux/${h.id}/golive`,{cible:'recette'}),400);
  const pre=await ok('admin','POST',`/hopitaux/${h.id}/golive/preflight`,CIBLE);assert.strictEqual(pre.possible,true,JSON.stringify(pre.bloqueurs));
  enEnv('production');
  // Bloquer le premier transfert après sa prise d'opération, puis changer l'empreinte
  // source : le second doit être refusé même avec une autre configuration.
  const fetchAvant=global.fetch;
  let liberer,signaler;
  const barriere=new Promise(r=>{liberer=r;}),entree=new Promise(r=>{signaler=r;});
  global.fetch=async(url,options)=>{
    if(String(url)===urlXx+'/api/sh/etablissements'&&options?.method==='POST'&&JSON.parse(options.body).code==='PILOTE-TEST'){
      signaler();await barriere;
    }
    return fetchAvant(url,options);
  };
  const premier=appel(jetons.admin,'POST',`/hopitaux/${h.id}/golive`,CIBLE);
  try{
    await Promise.race([entree,new Promise((_,rej)=>{const timer=setTimeout(()=>rej(new Error('Go Live non démarré')),10000);timer.unref();})]);
    await poolPilote.query("UPDATE etablissements SET modules=jsonb_set(modules,'{nsa}','true') WHERE id=$1",[etab.id]);
    const second=await appel(jetons.admin,'POST',`/hopitaux/${h.id}/golive`,CIBLE);
    assert.strictEqual(second.statut,409,JSON.stringify(second.corps));
    assert.strictEqual((await pool.query("SELECT count(*)::int n FROM sh_golive_operations WHERE hopital_id=$1 AND statut='en_cours'",[h.id])).rows[0].n,1);
  }finally{
    await poolPilote.query("UPDATE etablissements SET modules=jsonb_set(modules,'{nsa}','false') WHERE id=$1",[etab.id]);
    liberer();global.fetch=fetchAvant;
  }
  const termine=await premier;assert.strictEqual(termine.statut,200,JSON.stringify(termine.corps));
  assert.strictEqual((await pool.query('SELECT environnement FROM hopitaux WHERE id=$1',[h.id])).rows[0].environnement,'production_xx');
  assert.deepStrictEqual((await pool.query('SELECT cible FROM sh_golive_operations WHERE hopital_id=$1',[h.id])).rows.map(o=>o.cible),['production_xx']);
  assert.ok(clesXx.length>3&&clesXx.every(c=>c==='cle-production-xx'),'Seule la clé de ce pays part vers sa production.');
  assert.deepStrictEqual(appelsProdH.filter(u=>u.includes('PILOTE-TEST')),[],'L’autre production ne reçoit rien.');
  await assert.rejects(pool.query("UPDATE hopitaux SET environnement='production_xxx' WHERE id=$1",[h.id]),/hopitaux_environnement_check/);
  await assert.rejects(pool.query("UPDATE hopitaux SET environnement='autre' WHERE id=$1",[h.id]),/hopitaux_environnement_check/);
  await pool.query("UPDATE hopitaux SET environnement='pilote' WHERE id=$1",[h.id]);
  try{
    assert.strictEqual(await statut('admin','POST',`/hopitaux/${h.id}/golive`,CIBLE),409,'Une opération achevée ne doit pas être réouverte sur une ancienne source.');
    assert.deepStrictEqual((await pool.query('SELECT statut FROM sh_golive_operations WHERE hopital_id=$1',[h.id])).rows.map(o=>o.statut),['termine']);
  }finally{await pool.query("UPDATE hopitaux SET environnement='production' WHERE id=$1",[h.id]);}
  const prod=(await poolProd.query("SELECT id,module_actif,modules FROM etablissements WHERE code='PILOTE-TEST'")).rows[0];
  assert.strictEqual(prod.module_actif,false);assert.strictEqual(prod.modules.nsa,false);
  assert.strictEqual((await poolProd.query('SELECT count(*)::int n FROM lits WHERE etablissement_id=$1 AND patient_ref IS NOT NULL',[prod.id])).rows[0].n,0,'Aucun patient fictif promu.');
  assert.strictEqual((await poolProd.query('SELECT count(*)::int n FROM lits WHERE etablissement_id=$1',[prod.id])).rows[0].n,2);
  assert.strictEqual((await poolProd.query('SELECT count(*)::int n FROM utilisateur_etablissements WHERE etablissement_id=$1',[prod.id])).rows[0].n,3);
  const publicProd=await fetch(baseProd+'/api/public').then(r=>r.json());assert.strictEqual(publicProd.og_vocal_fictif,false,'La voix fictive reste refusée en production malgré les drapeaux de test.');
  await ok('admin','PUT',`/projets/${projet.id}`,{statut:'termine'});
  await ok('admin','POST',`/projets/${projet.id}/archiver`);
  await ok('admin','POST',`/projets/${projet.id}/restaurer`);
  await ok('admin','POST',`/projets/${projet.id}/archiver`);
  await ok('admin','POST',`/projets/${projet.id}/demander-suppression`,{motif:'Fin de simulation isolée du pilote fictif.'});
  assert.strictEqual(await statut('admin','POST',`/projets/${projet.id}/supprimer`,{confirmation:`SUPPRIMER PRJ-${String(projet.id).padStart(6,'0')}`}),409);
  const finPilote=await ok('admin','GET',`/hopitaux/${h.id}`);
  assert.strictEqual(finPilote.environnement,'production');assert.strictEqual(finPilote.statut,'implantation');
});

test('taux de change : import daté depuis la source officielle (simulée), immuabilité et équivalent CAD figé à l’émission', async () => {
  const http = require('node:http');
  const jourToronto = (decalage = 0) => new Date(Date.now() + decalage * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  let observations = [{ d: jourToronto(-1), FXUSDCAD: { v: '1.3985' }, FXEURCAD: { v: '1.5601' } }, { d: jourToronto(), FXUSDCAD: { v: '1.4000' }, FXXXXCAD: { v: '9' } }];
  const source = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ observations })); });
  await new Promise((r) => source.listen(0, '127.0.0.1', r));
  const avant = process.env.SH_CHANGE_VALET_URL;
  process.env.SH_CHANGE_VALET_URL = `http://127.0.0.1:${source.address().port}/valet/observations/`;
  try {
    assert.strictEqual(await statut('commercial', 'POST', '/facturation/change/actualiser', {}), 403);
    assert.deepStrictEqual(await ok('finance', 'POST', '/facturation/change/actualiser', {}), { ajoutes: 3, identiques: 0, divergents: [] }, 'devise inconnue de la liste officielle ignorée');
    observations = [{ d: jourToronto(), FXUSDCAD: { v: '1.5000' } }];
    const second = await ok('finance', 'POST', '/facturation/change/actualiser', {});
    assert.deepStrictEqual([second.ajoutes, second.divergents.length], [0, 1], 'une révision publiée est signalée, jamais appliquée');
    const change = await ok('finance', 'GET', '/facturation/change');
    const usd = change.derniers.find((t) => t.devise === 'USD');
    assert.deepStrictEqual([String(usd.jour).slice(0, 10), Number(usd.cad_par_unite), usd.source_nom], [jourToronto(), 1.4, 'Banque du Canada']);
    await assert.rejects(pool.query("UPDATE sh_taux_change SET cad_par_unite=2 WHERE devise='USD'"), /modification interdite/);
    await assert.rejects(pool.query("DELETE FROM sh_taux_change WHERE devise='USD'"), /modification interdite/);
    const enUsd = await ok('finance', 'POST', '/facturation/factures', { organisation_id: ids.org, devise: 'USD', lignes: [{ description: 'Service fictif en USD', quantite: 1, prix_unitaire: 1000 }] });
    const emiseUsd = await ok('finance', 'POST', `/facturation/factures/${enUsd.id}/emettre`);
    assert.deepStrictEqual([emiseUsd.change.devise, emiseUsd.change.cad_par_unite, emiseUsd.change.jour, emiseUsd.change.source_nom, emiseUsd.change.serie],
      ['USD', '1.4000000000', jourToronto(), 'Banque du Canada', 'FXUSDCAD']);
    assert.strictEqual(emiseUsd.change.total_cad, Number((Number(emiseUsd.total) * 1.4).toFixed(2)));
    const enXof = await ok('finance', 'POST', '/facturation/factures', { organisation_id: ids.org, devise: 'XOF', lignes: [{ description: 'Service fictif en XOF', quantite: 1, prix_unitaire: 1000 }] });
    assert.deepStrictEqual((await ok('finance', 'POST', `/facturation/factures/${enXof.id}/emettre`)).change, { devise: 'XOF', indisponible: true }, 'aucun taux supposé pour une devise non publiée');
    const enCad = await ok('finance', 'POST', '/facturation/factures', { organisation_id: ids.org, lignes: [{ description: 'Service fictif en CAD', quantite: 1, prix_unitaire: 10 }] });
    assert.strictEqual((await ok('finance', 'POST', `/facturation/factures/${enCad.id}/emettre`)).change, null);
    const pdf = await appel(jetons.finance, 'GET', `/facturation/factures/${emiseUsd.id}/pdf`, null, { brut: true });
    assert.strictEqual(pdf.octets.subarray(0, 5).toString(), '%PDF-');
  } finally {
    if (avant === undefined) delete process.env.SH_CHANGE_VALET_URL; else process.env.SH_CHANGE_VALET_URL = avant;
    await new Promise((r) => source.close(r));
  }
});

test('apparence SH : préférence par compte, valeurs contrôlées, journalisée', async () => {
  assert.strictEqual((await ok('finance', 'GET', '/moi')).utilisateur.apparence, 'automatique');
  assert.strictEqual(await statut('finance', 'PUT', '/moi/apparence', { apparence: 'violet' }), 400);
  assert.deepStrictEqual(await ok('finance', 'PUT', '/moi/apparence', { apparence: 'soleil' }), { apparence: 'soleil' });
  assert.strictEqual((await ok('finance', 'GET', '/moi')).utilisateur.apparence, 'soleil');
  assert.strictEqual((await ok('commercial', 'GET', '/moi')).utilisateur.apparence, 'automatique', 'les autres comptes ne changent pas');
  assert.ok((await pool.query("SELECT 1 FROM sh_journal WHERE action='Préférence d’apparence modifiée'")).rowCount);
  await ok('finance', 'PUT', '/moi/apparence', { apparence: 'automatique' });
});

test('paramètres SH modifiables (validés, journalisés) et suppression d’un employé archivé avec historique conservé', async () => {
  const p0 = await ok('admin', 'GET', '/parametres');
  assert.deepStrictEqual([p0.modifiables.emetteur_nom.valeur, p0.modifiables.emetteur_nom.source], ['SH fictive inc.', 'configuration']);
  assert.strictEqual(await statut('finance', 'PUT', '/parametres/session_heures', { valeur: '2' }), 403);
  assert.strictEqual(await statut('admin', 'PUT', '/parametres/session_heures', { valeur: '13' }), 400);
  assert.strictEqual(await statut('admin', 'PUT', '/parametres/smtp_mot_de_passe', { valeur: 'x' }), 404, 'aucun secret modifiable');
  assert.strictEqual(await statut('admin', 'PUT', '/parametres/emetteur_courriel', { valeur: 'pas-un-courriel' }), 400);
  assert.strictEqual((await ok('admin', 'PUT', '/parametres/emetteur_nom', { valeur: 'SH éditée inc.' })).source, 'base');
  assert.strictEqual((await ok('admin', 'GET', '/parametres')).general.nom, 'SH éditée inc.');
  await ok('admin', 'PUT', '/parametres/session_heures', { valeur: '2' });
  assert.ok((await pool.query("SELECT 1 FROM sh_journal WHERE action='Paramètre SH modifié' AND cible='session_heures'")).rowCount);

  // Nouveau membre : sa session suit la durée enregistrée ; il laisse une trace dans le journal.
  const email = 'ancien.erp@sh.exemple';
  await ok('admin', 'POST', '/equipe', { nom: 'Ancien membre fictif', email, role: 'support' });
  await invitations.consommer(pool, { jeton: dernierJeton(), nouveau: MDP }, process.env);
  const jeton = await ouvrirSession(email);
  const duree = (await pool.query('SELECT extract(epoch FROM s.expire_le - s.cree_le) / 3600 h FROM sh_sessions s JOIN sh_utilisateurs u ON u.id = s.utilisateur_id WHERE u.email = $1 ORDER BY s.id DESC LIMIT 1', [email])).rows[0].h;
  assert.ok(Math.abs(Number(duree) - 2) < 0.01, `durée de session ${duree} h`);
  assert.strictEqual((await appel(jeton, 'PUT', '/moi/langue', { langue: 'en' })).statut, 200);
  const membre = (await pool.query('SELECT id FROM sh_utilisateurs WHERE email = $1', [email])).rows[0].id;

  assert.strictEqual(await statut('admin', 'POST', `/equipe/${membre}/demander-suppression`, { motif: 'Départ fictif de l’équipe' }), 409, 'archivage préalable');
  await ok('admin', 'POST', `/equipe/${membre}/archiver`);
  assert.strictEqual(await statut('admin', 'POST', `/equipe/${membre}/demander-suppression`, { motif: 'court' }), 400);
  assert.strictEqual(await statut('admin', 'POST', `/equipe/${membre}/supprimer`, { confirmation: `SUPPRIMER ${email}` }), 409, 'demande requise');
  await ok('admin', 'POST', `/equipe/${membre}/demander-suppression`, { motif: 'Départ fictif de l’équipe' });
  assert.strictEqual(await statut('admin', 'POST', `/equipe/${membre}/supprimer`, { confirmation: `SUPPRIMER ${email}` }), 409, 'politique de conservation requise');
  await ok('admin', 'PUT', '/parametres/employes_conservation_jours', { valeur: '30' });
  assert.strictEqual(await statut('admin', 'POST', `/equipe/${membre}/supprimer`, { confirmation: `SUPPRIMER ${email}` }), 409, 'délai de conservation');
  await ok('admin', 'PUT', '/parametres/employes_conservation_jours', { valeur: '0' });
  assert.strictEqual(await statut('admin', 'POST', `/equipe/${membre}/supprimer`, { confirmation: 'SUPPRIMER autre@exemple' }), 400);
  await ok('admin', 'POST', `/equipe/${membre}/supprimer`, { confirmation: `SUPPRIMER ${email}` });
  const apres = (await pool.query('SELECT nom, email, fonction, actif, totp_secret, supprime_le FROM sh_utilisateurs WHERE id = $1', [membre])).rows[0];
  assert.deepStrictEqual([apres.nom, apres.email, apres.fonction, apres.actif, apres.totp_secret], [`Ancien membre n° ${membre}`, `supprime-${membre}@supprime.invalid`, null, false, null]);
  assert.ok(apres.supprime_le);
  assert.strictEqual((await pool.query('SELECT count(*)::int n FROM sh_sessions WHERE utilisateur_id = $1', [membre])).rows[0].n, 0);
  assert.ok((await pool.query("SELECT 1 FROM sh_journal WHERE utilisateur_id = $1 AND action = 'Préférence linguistique modifiée'", [membre])).rowCount, 'historique conservé');
  assert.strictEqual(await statut('admin', 'POST', `/equipe/${membre}/restaurer`), 409);
  assert.strictEqual((await appel(null, 'POST', '/connexion', { email, mot_de_passe: MDP })).statut, 401);
  await pool.query('DELETE FROM sh_parametres');
});

test('finances de projet : budgets, coûts, revenus facturés HT et marges par devise, droits et journal', async () => {
  const id = ids.projet, url = `/projets/${id}/finances`;
  const arr = (n) => Math.round(n * 100) / 100;
  assert.strictEqual(await statut('commercial', 'GET', url), 403);
  assert.strictEqual(await statut('implantation', 'POST', url, { nature: 'budget', categorie: 'autre', libelle: 'Budget', montant: 1, devise: 'CAD' }), 403, 'lecture seule pour l’implantation');
  assert.strictEqual(await statut('finance', 'POST', url, { nature: 'magie', categorie: 'autre', libelle: 'Budget', montant: 1 }), 400);
  assert.strictEqual(await statut('finance', 'POST', url, { nature: 'budget', categorie: 'autre', libelle: 'Budget', montant: 1.001, devise: 'CAD' }), 400, 'précision de la devise');
  await ok('finance', 'POST', url, { nature: 'budget', categorie: 'main_oeuvre', libelle: 'Budget implantation fictif', montant: 25000, devise: 'CAD', jour: '2026-10-01' });
  await ok('finance', 'POST', url, { nature: 'cout_prevu', categorie: 'main_oeuvre', libelle: 'Consultants prévus', montant: 12000, devise: 'CAD' });
  const reel = await ok('finance', 'POST', url, { nature: 'cout_reel', categorie: 'deplacements', libelle: 'Déplacements réels', montant: 3000.5, devise: 'CAD' });
  await ok('finance', 'POST', url, { nature: 'cout_reel', categorie: 'licences', libelle: 'Licence tierce fictive', montant: 500, devise: 'USD' });
  const revenus = Number((await pool.query("SELECT COALESCE(sum(sous_total),0) s FROM sh_factures WHERE contrat_id=$1 AND statut='emise' AND devise='CAD'", [ids.contrat])).rows[0].s);
  assert.ok(revenus > 0, 'le contrat du projet a des factures émises');
  const f = await ok('implantation', 'GET', url);
  const cad = f.synthese.find((s) => s.devise === 'CAD'), usd = f.synthese.find((s) => s.devise === 'USD');
  assert.deepStrictEqual([cad.budget, cad.cout_prevu, cad.cout_reel, cad.revenus], [25000, 12000, 3000.5, revenus]);
  assert.deepStrictEqual([cad.marge, cad.taux_marge, cad.consommation_budget, cad.ecart_budget], [arr(revenus - 3000.5), arr(100 * (revenus - 3000.5) / revenus), arr(100 * 3000.5 / 25000), arr(25000 - 3000.5)]);
  assert.deepStrictEqual([usd.cout_reel, usd.revenus, usd.marge, usd.taux_marge], [500, 0, -500, null], 'aucune conversion entre devises');
  const portefeuille = await ok('finance', 'GET', '/finances/projets');
  assert.deepStrictEqual(portefeuille.find((p) => p.id == id).synthese.map((s) => s.devise), ['CAD', 'USD']);
  assert.strictEqual(await statut('implantation', 'GET', '/finances/projets'), 403);
  await ok('finance', 'DELETE', `${url}/${reel.id}`);
  assert.strictEqual((await ok('finance', 'GET', url)).synthese.find((s) => s.devise === 'CAD').cout_reel, 0);
  assert.strictEqual(await statut('finance', 'DELETE', `${url}/${reel.id}`), 404);
  assert.ok((await pool.query("SELECT count(*)::int n FROM sh_journal WHERE action='Finances de projet modifiées'")).rows[0].n >= 5);
});

test('tâches : temps estimé et réalisé, checklist, validation des critères et annulation motivée', async () => {
  const p = ids.projet;
  const avantAvancement = (await ok('implantation', 'GET', `/projets/${p}`)).avancement;
  const t = await ok('implantation', 'POST', `/projets/${p}/taches`, { titre: 'Recette utilisateur fictive', responsable_id: membres.support, criteres_acceptation: 'Trois parcours validés par le client fictif' });
  assert.strictEqual(await statut('support', 'PUT', `/taches/${t.id}/estimation`, { minutes: 60 }), 403, 'estimation réservée à l’implantation');
  assert.deepStrictEqual(await ok('implantation', 'PUT', `/taches/${t.id}/estimation`, { minutes: 240 }), { temps_estime_minutes: 240 });
  const c1 = await ok('support', 'POST', `/taches/${t.id}/checklist`, { libelle: 'Parcours admission' });
  await ok('support', 'POST', `/taches/${t.id}/checklist`, { libelle: 'Parcours transfert' });
  assert.strictEqual(await statut('support', 'POST', `/taches/${t.id}/temps`, { minutes: 0, jour: '2026-10-29' }), 400);
  assert.strictEqual(await statut('support', 'POST', `/taches/${t.id}/temps`, { minutes: 30, jour: '2999-01-01' }), 400, 'pas de date future');
  const s1 = await ok('support', 'POST', `/taches/${t.id}/temps`, { minutes: 90, jour: '2026-10-29', note: 'Préparation' });
  await ok('implantation', 'POST', `/taches/${t.id}/temps`, { minutes: 200, jour: '2026-10-29' });
  let suivi = await ok('support', 'GET', `/taches/${t.id}/suivi`);
  assert.deepStrictEqual([suivi.temps_estime_minutes, suivi.temps_realise_minutes, suivi.ecart_minutes, suivi.checklist_ouverte], [240, 290, 50, 2]);
  const autreSaisie = suivi.temps.find((x) => x.minutes === 200).id;
  assert.strictEqual(await statut('support', 'DELETE', `/taches/${t.id}/temps/${autreSaisie}`), 403, 'on ne retire que ses propres saisies');
  await ok('support', 'DELETE', `/taches/${t.id}/temps/${s1.id}`);
  // Clôture : critères → validation ; checklist complète exigée.
  assert.strictEqual(await statut('support', 'PUT', `/taches/${t.id}`, { statut: 'terminee' }), 403, 'critères d’acceptation : validation requise');
  await ok('support', 'PUT', `/taches/${t.id}`, { statut: 'en_validation' });
  assert.strictEqual(await statut('implantation', 'PUT', `/taches/${t.id}`, { statut: 'terminee' }), 409, 'checklist incomplète');
  await ok('support', 'PUT', `/taches/${t.id}/checklist/${c1.id}`, { faite: true });
  suivi = await ok('support', 'GET', `/taches/${t.id}/suivi`);
  for (const c of suivi.checklist.filter((x) => !x.faite)) await ok('support', 'PUT', `/taches/${t.id}/checklist/${c.id}`, { faite: true });
  const validee = await ok('implantation', 'PUT', `/taches/${t.id}`, { statut: 'terminee' });
  assert.strictEqual(validee.validee_par, membres.implantation, 'validation tracée');
  assert.strictEqual(await statut('support', 'POST', `/taches/${t.id}/checklist`, { libelle: 'Après clôture' }), 409, 'tâche close figée');
  // Annulation : motif et rôle exigés ; une tâche annulée ne compte plus dans l’avancement ni dans les retards.
  const t2 = await ok('implantation', 'POST', `/projets/${p}/taches`, { titre: 'Tâche abandonnée fictive', responsable_id: membres.support, echeance: '2026-01-01' });
  assert.strictEqual(await statut('support', 'PUT', `/taches/${t2.id}`, { statut: 'annulee', motif: 'Plus nécessaire' }), 403);
  assert.strictEqual(await statut('implantation', 'PUT', `/taches/${t2.id}`, { statut: 'annulee' }), 400);
  const annulee = await ok('implantation', 'PUT', `/taches/${t2.id}`, { statut: 'annulee', motif: 'Périmètre retiré du contrat fictif' });
  assert.strictEqual(annulee.annulee_motif, 'Périmètre retiré du contrat fictif');
  const listees = await ok('implantation', 'GET', `/taches?projet_id=${p}`);
  assert.strictEqual(listees.find((x) => x.id === t2.id)?.en_retard ?? false, false, 'une tâche annulée n’est pas en retard');
  const projet = await ok('implantation', 'GET', `/projets/${p}`);
  assert.ok(projet.avancement >= avantAvancement, 'l’annulation ne fait pas baisser l’avancement');
  assert.ok((await pool.query("SELECT 1 FROM sh_journal WHERE action='Temps de tâche saisi'")).rowCount);
});

test('projets : étape Kanban du cahier, états en attente et suspendu, registre des risques et décisions', async () => {
  const p = ids.projet;
  assert.strictEqual((await ok('implantation', 'GET', `/projets/${p}`)).etape, null, 'projet existant : à classer, aucune étape inventée');
  assert.strictEqual(await statut('implantation', 'PUT', `/projets/${p}/etape`, { etape: 'lune' }), 400);
  assert.strictEqual(await statut('support', 'PUT', `/projets/${p}/etape`, { etape: 'cadrage' }), 403);
  await ok('implantation', 'PUT', `/projets/${p}/etape`, { etape: 'tests_uat' });
  assert.strictEqual((await ok('implantation', 'GET', '/projets')).find((x) => x.id === p).etape, 'tests_uat');
  assert.ok((await pool.query("SELECT 1 FROM sh_journal WHERE action='Étape de projet modifiée' AND detail LIKE '%tests_uat'")).rowCount);
  const statutAvant = (await ok('implantation', 'GET', `/projets/${p}`)).statut;
  await ok('implantation', 'PUT', `/projets/${p}`, { statut: 'suspendu' });
  await ok('implantation', 'PUT', `/projets/${p}`, { statut: statutAvant });
  assert.strictEqual(await statut('implantation', 'POST', `/projets/${p}/registre`, { type: 'risque', titre: 'Retard fournisseur' }), 400, 'gravité et probabilité requises');
  assert.strictEqual(await statut('implantation', 'POST', `/projets/${p}/registre`, { type: 'decision', titre: 'Report du lancement' }), 400, 'auteur et date requis');
  const risque = await ok('implantation', 'POST', `/projets/${p}/registre`, { type: 'risque', titre: 'Retard du connecteur fictif', gravite: 'elevee', probabilite: 'moderee', echeance: '2026-11-30' });
  await ok('implantation', 'POST', `/projets/${p}/registre`, { type: 'decision', titre: 'Lancement par unité pilote', decide_par: 'Comité fictif', decide_le: '2026-10-28' });
  assert.strictEqual(await statut('support', 'POST', `/projets/${p}/registre`, { type: 'decision', titre: 'Non autorisé', decide_par: 'X', decide_le: '2026-10-28' }), 403);
  assert.strictEqual((await ok('support', 'GET', `/projets/${p}/registre`)).length, 2, 'lecture pour l’équipe du projet');
  assert.strictEqual((await ok('implantation', 'PUT', `/projets/${p}/registre/${risque.id}`, { statut: 'clos' })).statut, 'clos');
  assert.strictEqual(await statut('commercial', 'GET', `/projets/${p}/registre`), 403);
});

test('équipe : compétences et zones (administration), charge réelle calculée depuis les tâches ouvertes', async () => {
  const sup = membres.support;
  assert.strictEqual(await statut('implantation', 'PUT', `/equipe/${sup}/competences`, { competences: [] }), 403, 'modification réservée à l’administration');
  assert.strictEqual(await statut('admin', 'PUT', `/equipe/${sup}/competences`, { competences: [{ competence: 'HL7', niveau: 'genie' }] }), 400);
  assert.strictEqual(await statut('admin', 'PUT', `/equipe/${sup}/competences`, { competences: [{ competence: 'HL7', niveau: 'expert' }, { competence: 'hl7', niveau: 'notions' }] }), 400, 'doublon insensible à la casse');
  await ok('admin', 'PUT', `/equipe/${sup}/competences`, { competences: [{ competence: 'Interfaces HL7', niveau: 'expert' }, { competence: 'Formation des équipes', niveau: 'autonome' }], zones: ['Québec', 'Ontario', 'Québec'] });
  const tous = await ok('implantation', 'GET', '/equipe/competences');
  const s = tous.find((m) => m.id === sup);
  assert.deepStrictEqual([s.competences.length, s.zones], [2, ['Québec', 'Ontario']]);
  const attendu = (await pool.query(`SELECT count(*)::int n FROM sh_taches WHERE responsable_id=$1 AND statut NOT IN ('terminee','annulee')`, [sup])).rows[0].n;
  assert.strictEqual(s.charge.taches_ouvertes, attendu, 'charge issue des tâches réelles');
  assert.deepStrictEqual((await ok('implantation', 'GET', '/equipe/competences?q=hl7')).map((m) => m.id), [sup], 'recherche par compétence');
  assert.deepStrictEqual((await ok('implantation', 'GET', '/equipe/competences?q=ontario')).map((m) => m.id), [sup], 'recherche par zone');
  assert.strictEqual(await statut('commercial', 'GET', '/equipe/competences'), 403);
});

test('recherche globale limitée aux droits et au périmètre ; filtres enregistrables propres à chaque utilisateur', async () => {
  assert.strictEqual(await statut('support', 'GET', '/recherche?q=a'), 400, 'deux caractères au moins');
  const admin = await ok('admin', 'GET', '/recherche?q=fictif');
  assert.ok(admin.resultats.some((r) => r.type === 'projet') && admin.resultats.some((r) => r.type === 'organisation'), JSON.stringify(admin.resultats.map((r) => r.type)));
  const support = await ok('support', 'GET', '/recherche?q=fictif');
  assert.ok(!support.resultats.some((r) => ['organisation', 'contrat', 'facture'].includes(r.type)), 'pas de données commerciales ni financières pour le support');
  assert.ok(support.resultats.filter((r) => r.type === 'tache').every((r) => r.id), 'tâches du support : seulement les siennes');
  const tachesSupport = (await pool.query("SELECT id FROM sh_taches WHERE responsable_id=$1", [membres.support])).rows.map((r) => r.id);
  assert.ok(support.resultats.filter((r) => r.type === 'tache').every((r) => tachesSupport.includes(r.id)));
  const finance = await ok('finance', 'GET', `/recherche?q=${encodeURIComponent('FAC-')}`);
  assert.ok(finance.resultats.every((r) => r.type === 'facture') && finance.resultats.length > 0);
  assert.strictEqual((await ok('admin', 'GET', `/recherche?q=${encodeURIComponent('%_')}`)).resultats.length, 0, 'jokers échappés : aucune correspondance artificielle');
  // Filtres enregistrables
  assert.strictEqual(await statut('finance', 'POST', '/moi/filtres', { vue: 'Facturation!', nom: 'x', filtres: {} }), 400);
  const f = await ok('finance', 'POST', '/moi/filtres', { vue: 'facturation', nom: 'Retards', filtres: { etat: 'en_retard' } });
  await ok('finance', 'POST', '/moi/filtres', { vue: 'facturation', nom: 'Retards', filtres: { etat: 'emise' } });
  assert.deepStrictEqual((await ok('finance', 'GET', '/moi/filtres?vue=facturation')).map((x) => [x.nom, x.filtres.etat]), [['Retards', 'emise']], 'même nom : mise à jour');
  assert.deepStrictEqual(await ok('admin', 'GET', '/moi/filtres'), [], 'filtres non partagés');
  assert.strictEqual(await statut('admin', 'DELETE', `/moi/filtres/${f.id}`), 404, 'on ne retire que ses filtres');
  await ok('finance', 'DELETE', `/moi/filtres/${f.id}`);
});

test('déploiement en 17 étapes : dépendances, preuve obligatoire, non-applicabilité motivée, avancement réel, droits', async () => {
  const h = ids.hopital, url = `/hopitaux/${h}/deploiement`;
  let d = await ok('implantation', 'GET', url);
  assert.strictEqual(d.etapes.length, 17);
  assert.deepStrictEqual([d.avancement, d.prochaines], [0, ['cadrage']], 'seule la première étape est prête au départ');
  assert.strictEqual(await statut('support', 'PUT', `${url}/cadrage`, { statut: 'en_cours' }), 403);
  assert.strictEqual(await statut('implantation', 'PUT', `${url}/inconnue`, { statut: 'en_cours' }), 404);
  assert.strictEqual(await statut('implantation', 'PUT', `${url}/cadrage`, { statut: 'terminee' }), 409, 'preuve obligatoire');
  assert.strictEqual(await statut('implantation', 'POST', `${url}/cadrage/preuves`, { type: 'lien', valeur: 'http://non-chiffre.exemple' }), 400);
  await ok('implantation', 'POST', `${url}/cadrage/preuves`, { type: 'note', valeur: 'Charte de projet fictive validée' });
  d = await ok('implantation', 'PUT', `${url}/cadrage`, { statut: 'terminee', responsable_id: membres.implantation, livrables: 'Charte de projet' });
  assert.ok(d.prochaines.includes('etablissements') && d.prochaines.includes('modules'));
  assert.strictEqual(d.avancement, 6, '1 étape sur 17');
  await ok('implantation', 'POST', `${url}/uat/preuves`, { type: 'note', valeur: 'Procès-verbal UAT fictif' });
  assert.strictEqual(await statut('implantation', 'PUT', `${url}/uat`, { statut: 'terminee' }), 409, 'dépendances non terminées');
  assert.strictEqual(await statut('implantation', 'PUT', `${url}/tests`, { statut: 'non_applicable', motif: 'Sans objet ici' }), 400, 'seule la connexion peut être non applicable');
  assert.strictEqual(await statut('implantation', 'PUT', `${url}/connexions`, { statut: 'non_applicable', motif: 'court' }), 400);
  d = await ok('implantation', 'PUT', `${url}/connexions`, { statut: 'non_applicable', motif: 'Aucun système existant à relier pour ce pilote fictif' });
  assert.strictEqual(d.avancement, 12, 'non applicable compte dans l’avancement réel');
  d = await ok('implantation', 'PUT', `${url}/etablissements`, { statut: 'bloquee' });
  assert.ok(d.actions_bloquantes.some((a) => a.code === 'etablissements' && a.raison === 'bloquee'));
  assert.ok((await ok('formation', 'GET', url)).etapes.find((e) => e.code === 'cadrage').preuves.length === 1, 'lecture pour la formation');
  assert.ok((await pool.query("SELECT count(*)::int n FROM sh_journal WHERE action IN ('Étape de déploiement modifiée','Preuve de déploiement ajoutée')")).rows[0].n >= 5);
});

test('tâches : collaborateurs multiples notifiés, qui voient et font avancer la tâche comme le responsable', async () => {
  const t = await ok('implantation', 'POST', `/projets/${ids.projet}/taches`, { titre: 'Tâche collective fictive', responsable_id: membres.support });
  assert.strictEqual(await statut('formation', 'POST', `/taches/${t.id}/checklist`, { libelle: 'Avant collaboration' }), 403, 'pas encore collaborateur');
  assert.strictEqual(await statut('support', 'PUT', `/taches/${t.id}/collaborateurs`, { utilisateurs: [membres.formation] }), 403, 'réservé à l’implantation');
  await ok('implantation', 'PUT', `/taches/${t.id}/collaborateurs`, { utilisateurs: [membres.formation, membres.formation] });
  assert.deepStrictEqual((await ok('formation', 'GET', `/taches/${t.id}/suivi`)).collaborateurs.map((c) => c.id), [membres.formation]);
  assert.ok((await pool.query("SELECT 1 FROM sh_notifications WHERE utilisateur_id=$1 AND titre LIKE 'Collaboration demandée%'", [membres.formation])).rowCount, 'collaborateur notifié');
  assert.ok((await ok('formation', 'GET', '/taches?moi=1')).some((x) => x.id === t.id && x.collaborateur), 'visible dans « mes tâches »');
  await ok('formation', 'POST', `/taches/${t.id}/checklist`, { libelle: 'Préparer le support fictif' });
  await ok('formation', 'PUT', `/taches/${t.id}`, { statut: 'en_cours' });
  await ok('implantation', 'PUT', `/taches/${t.id}/collaborateurs`, { utilisateurs: [] });
  assert.strictEqual(await statut('formation', 'PUT', `/taches/${t.id}`, { statut: 'a_faire' }), 403, 'retiré : plus de droit');
});
