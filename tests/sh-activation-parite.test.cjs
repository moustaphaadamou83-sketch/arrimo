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
const BASELINE_B=process.env.SH_PARITE_BASELINE_RELEASE||'/opt/arrimo-demo/releases/lot1-20261028t211000z';
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
  assert.match(new URL(URL_TEST).pathname,/^\/arrimo_sh_lot1_test_[a-z0-9_]+$/);
  pool = creerPool(URL_TEST);
  assert.strictEqual((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0); 
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
  process.env.DEMO_MOT_DE_PASSE=MDP;
  await require('../db/demo-trio').preparerDemoTrio(poolPilote,{silencieux:true,fichierAcces:path.resolve('.local/acces-parite-fictifs.txt')});
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  serveurProd = await demarrerServeur(creerApp(poolProd)); baseProd = `http://127.0.0.1:${serveurProd.address().port}`;
  serveurPilote=await demarrerServeur(creerApp(poolPilote));basePilote=`http://127.0.0.1:${serveurPilote.address().port}`;
  dossierDocs = fs.mkdtempSync(path.join(os.tmpdir(), 'arrimo-sh-docs-'));
  await viderBaseSh(pool);
  await premierCompteSh(pool, 'admin.erp@sh.exemple', 'Administration fictive');
  await invitations.consommer(pool, { jeton: dernierJeton(), nouveau: MDP }, process.env);
  serveurSh = await demarrerServeur(creerAppSh(pool, { env: {
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

test('activation réelle SH et parité avec Hôpital B, sans données publiques',{timeout:240000},async t=>{
  enEnv('pilote');process.env.ARRIMO_PATIENTS_FICTIFS='1';process.env.ARRIMO_OG_VOCAL_FICTIF='1';
  const restaurationRouteur=require('./routeur-fictif.cjs').activer();t.after(restaurationRouteur);
  const preuve={fictif:true,etapes:[],source_b_avant_publication:require('node:fs').realpathSync(BASELINE_B),connexion_reelle:false};
  const h=await ok('admin','POST','/hopitaux',{nom:'Hôpital Nouveau Parité Fictif',code_etab:'PARITE-NEW',environnement:'pilote',pays_code:'CA',latitude:45.28,longitude:-72.16,ville:'Ville fictive'});
  await ok('admin','POST',`/hopitaux/${h.id}/relier`);
  const csv={departements:'departement;code\nSoins Parité;SOINS\n',services:'service;code;departement\nMédecine Parité;MED-P;Soins Parité\n',unites:'unite;type_unite;service;departement\nUnité Parité;MED;Médecine Parité;Soins Parité\n',chambres:'unite;chambre\nUnité Parité;P101\nUnité Parité;P102\n',lits:'unite;chambre;lit\nUnité Parité;P101;PAR-101\nUnité Parité;P102;PAR-102\n',civieres:'civiere;categorie\nPAR-C1;reguliere\nPAR-C2;reguliere\n',utilisateurs:'nom;courriel;role\nCoordination Parité;coord.parite@example.invalid;coordonnateur\nEntretien Parité;entretien.parite@example.invalid;entretien\nAdministration Parité;admin.parite@example.invalid;admin_etab\n'};
  const invitationsHop={};
  for(const [type,contenu]of Object.entries(csv)){
    const v=await ok('admin','POST',`/hopitaux/${h.id}/import/verifier`,{type,contenu});assert.strictEqual(v.nb_erreurs,0,JSON.stringify(v.erreurs));
    await ok('admin','POST',`/hopitaux/${h.id}/import/importer`,{type,contenu,empreinte:v.empreinte});
  }
  for(const email of ['coord.parite@example.invalid','entretien.parite@example.invalid','admin.parite@example.invalid'])invitationsHop[email]=courriels.findLast(m=>m.a===email).texte.match(/#reinit=([a-f0-9]{64})/)[1];
  let fiche=await ok('admin','GET',`/hopitaux/${h.id}`);
  for(const el of fiche.formation.flatMap(x=>x.elements))await ok('admin','PUT',`/formation/${el.id}`,{faite:true});
  fiche=await ok('admin','GET',`/hopitaux/${h.id}`);
  for(const v of fiche.etapes.filter(e=>e.rang<6).flatMap(e=>e.verifications).filter(v=>!v.faite))await ok('admin','PUT',`/verifications/${v.id}`,{faite:true});
  await ok('admin','POST',`/hopitaux/${h.id}/activation`);
  const nouvel=(await poolPilote.query("SELECT * FROM etablissements WHERE code='PARITE-NEW'")).rows[0];
  const b=(await poolPilote.query("SELECT * FROM etablissements WHERE code='HY'")).rows[0];assert.ok(nouvel.module_actif);
  const sessions={};
  async function api(qui,method,path,body,status=200){const r=await fetch(basePilote+'/api'+path,{method,headers:{'Content-Type':'application/json',...(sessions[qui]?{Authorization:'Bearer '+sessions[qui]}:{})},body:body?JSON.stringify(body):undefined});const j=await r.json();assert.strictEqual(r.status,status,`${qui} ${method} ${path} : ${JSON.stringify(j)}`);return j;}
  await t.test('invitations consommées et connexions réelles de trois membres du personnel',async()=>{
    for(const [qui,email]of Object.entries({new:'coord.parite@example.invalid',entretien:'entretien.parite@example.invalid',admin:'admin.parite@example.invalid'})){
      await api(null,'POST','/mot-de-passe/reinitialiser',{jeton:invitationsHop[email],nouveau:MDP});
      const r=await api(null,'POST','/connexion',{email,mot_de_passe:MDP});assert.ok(r.token);sessions[qui]=r.token;
      const moi=await api(qui,'GET','/moi');assert.deepStrictEqual(moi.etablissements.map(e=>e.id),[nouvel.id]);assert.strictEqual(moi.utilisateur.mdp_temporaire,false);
    }
    sessions.b=(await api(null,'POST','/connexion',{email:'hopital.b@demo.arrimo',mot_de_passe:MDP})).token;assert.ok(sessions.b);
    preuve.connexion_reelle=true;preuve.etapes.push('activation SH et comptes invités connectés');
  });
  await t.test('mêmes modules et mêmes fichiers applicatifs pour B et le nouvel établissement',async()=>{
    assert.deepStrictEqual(nouvel.modules,b.modules);
    for(const qui of ['new','b'])for(const route of ['/lits','/admissions','/civieres','/transferts','/nettoyage','/nsa','/conges','/structure','/copilote/briefing'])await api(qui,'GET',route+'?etablissement_id='+(qui==='new'?nouvel.id:b.id));
    preuve.assets={};const crypto=require('node:crypto');
    for(const file of ['app.js','og.js','og-vocal.js','og-vocal-moteur.js','support-client.js','i18n/fr.js','i18n/en.js']){
      const bytes=Buffer.from(await(await fetch(basePilote+'/'+file)).arrayBuffer());assert.deepStrictEqual(bytes,fs.readFileSync(path.resolve('public',file)));preuve.assets[file]=crypto.createHash('sha256').update(bytes).digest('hex');
    }
    preuve.etapes.push('modules et assets communs');
  });
  let demande,litNew,civNew,ref='P-99101';
  await t.test('admission réelle, lit occupé, civière puis lit nettoyés avec le compte entretien',async()=>{
    litNew=(await poolPilote.query('SELECT * FROM lits WHERE etablissement_id=$1 ORDER BY id LIMIT 1',[nouvel.id])).rows[0];civNew=(await poolPilote.query('SELECT * FROM civieres WHERE etablissement_id=$1 ORDER BY id LIMIT 1',[nouvel.id])).rows[0];
    await api('new','POST',`/civieres/${civNew.id}/action`,{action:'placer',version:civNew.version,patient_ref:ref});
    demande=await api('new','POST','/admissions',{etablissement_id:nouvel.id,civiere_id:civNew.id,type_id:litNew.type_id,patient_ref:ref});
    await api('new','POST',`/admissions/${demande.id}/assigner`,{lit_id:litNew.id,version:litNew.version});await api('new','POST',`/admissions/${demande.id}/admettre`,{});
    assert.strictEqual((await poolPilote.query('SELECT etat FROM lits WHERE id=$1',[litNew.id])).rows[0].etat,'occupe');
    await api('entretien','GET','/lits?etablissement_id='+nouvel.id,undefined,403);
    let cv=(await poolPilote.query('SELECT * FROM civieres WHERE id=$1',[civNew.id])).rows[0];assert.strictEqual(cv.etat,'nettoyage');
    await api('entretien','POST',`/civieres/${cv.id}/action`,{action:'nettoyage_ok',version:cv.version});
    for(const langue of ['fr','en']){
      const r=await api('new','POST','/copilote/question',{etablissement_id:nouvel.id,question:'Where is patient '+ref+'?',langue});assert.match(r.reponse,/PAR-101/);assert.equal(r.langue,'en');assert.match(r.reponse,/Verified current location|bed|room/i); // question anglaise → réponse anglaise (cahier du 31 oct.)
    }
    const l=(await poolPilote.query('SELECT * FROM lits WHERE id=$1',[litNew.id])).rows[0];await api('new','POST',`/lits/${l.id}/action`,{action:'liberer',version:l.version});
    const dirty=(await poolPilote.query('SELECT * FROM lits WHERE id=$1',[l.id])).rows[0];assert.strictEqual(dirty.etat,'nettoyage');await api('entretien','POST',`/lits/${l.id}/action`,{action:'nettoyage_ok',version:dirty.version});
    assert.strictEqual((await poolPilote.query('SELECT etat FROM lits WHERE id=$1',[l.id])).rows[0].etat,'libre');preuve.etapes.push('admission, OG FR/EN, nettoyage avec rôle restreint');
  });
  await t.test('transfert du nouvel hôpital vers B par les comptes respectifs et réception effective',async()=>{
    const cv=(await poolPilote.query('SELECT * FROM civieres WHERE id=$1',[civNew.id])).rows[0];await api('new','POST',`/civieres/${cv.id}/action`,{action:'placer',version:cv.version,patient_ref:'P-99102'});
    const d=await api('new','POST','/admissions',{etablissement_id:nouvel.id,civiere_id:cv.id,type_id:litNew.type_id,patient_ref:'P-99102'});
    const dest=(await poolPilote.query("SELECT * FROM lits WHERE etablissement_id=$1 AND type_id=$2 AND etat='libre' ORDER BY id LIMIT 1",[b.id,litNew.type_id])).rows[0];assert.ok(dest);
    await poolPilote.query('UPDATE lits SET disponibilite_confirmee_le=now() WHERE id=$1',[dest.id]);
    const tr=await api('new','POST',`/admissions/${d.id}/transferer`,{destination_id:b.id,lit_id:dest.id,version:dest.version});
    await api('b','POST',`/transferts/${tr.id}/accepter`,{});await api('new','POST',`/transferts/${tr.id}/transport`,{});await api('new','POST',`/transferts/${tr.id}/depart`,{});await api('b','POST',`/transferts/${tr.id}/reception`,{});
    assert.strictEqual((await poolPilote.query('SELECT statut FROM transferts WHERE id=$1',[tr.id])).rows[0].statut,'recu');preuve.etapes.push('transfert accepté, départ et réception par B');
  });
  await t.test('isolation en lecture, écriture, OG et permissions du personnel',async()=>{
    for(const [qui,id]of [['new',b.id],['b',nouvel.id]]){
      for(const route of ['/lits','/admissions','/civieres','/nettoyage','/structure'])await api(qui,'GET',route+'?etablissement_id='+id,undefined,403);
      await api(qui,'POST','/copilote/question',{etablissement_id:id,question:ref},403);
    }
    const etatAvant=(await poolPilote.query('SELECT * FROM lits WHERE id=$1',[litNew.id])).rows[0];
    await api('b','POST',`/lits/${litNew.id}/action`,{action:'hors_service',motif:'Injection fictive refusée'},404);
    assert.deepStrictEqual((await poolPilote.query('SELECT * FROM lits WHERE id=$1',[litNew.id])).rows[0],etatAvant);
    const hidden=await api('b','POST','/copilote/question',{etablissement_id:b.id,question:ref,langue:'en'});assert.doesNotMatch(hidden.reponse,/PAR-101|Hôpital Nouveau/);preuve.etapes.push('isolation API/OG et écritures refusées');
  });
  await t.test('connexion navigateur réelle et interface disponible identique FR/EN pour B et le nouveau',async()=>{
    const browser=await require('playwright').chromium.launch({headless:true});const menus={};
    try{for(const [qui,email]of [['b','hopital.b@demo.arrimo'],['new','coord.parite@example.invalid']]){
      const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(basePilote);await page.fill('#c-email',email);await page.fill('#c-mdp',MDP);await page.click('#f-connexion button[type=submit]');await page.waitForSelector('body[data-pret="1"]');
      if(await page.locator('#b-premiers-pas-ok').isVisible())await page.click('#b-premiers-pas-ok');
      menus[qui]=await page.locator('#onglets button').evaluateAll(bs=>bs.filter(b=>!b.hidden).map(b=>b.dataset.v));
      for(const langue of ['fr','en']){
        await page.click('#b-menu');await page.selectOption('#langue-barre',langue);await page.click('#b-menu');
        await page.click('#og-open');await page.fill('#og-question',langue==='fr'?'Où se trouve P-99102 ?':'Where is patient P-99102?');
        const response=page.waitForResponse(r=>r.url().endsWith('/api/copilote/question'));await page.click('#og-envoyer');
        const reponse=(await(await response).json()).reponse;assert.match(reponse,langue==='en'?/Transfer status|Status:|bed|Room|received/i:/transfert|lit|chambre/i);
        await page.screenshot({path:path.resolve('.local','parite-'+qui+'-'+langue+'.png')});await page.click('#og-close');
      }
      assert.deepStrictEqual(errors,[]);await context.close();
    }assert.deepStrictEqual(menus.new,menus.b);preuve.menus=menus;preuve.etapes.push('vraie connexion Chromium B/nouveau et OG');}finally{await browser.close();}
  });
  await t.test('bascule commune entre deux versions applicatives sans écrasement des configurations',async()=>{
    const snapshot=async()=>(await poolPilote.query('SELECT id,code,nom,modules,vocation,config_id,module_actif,partage,sous_domaine FROM etablissements WHERE id=ANY($1::int[]) ORDER BY id',[[nouvel.id,b.id]])).rows;
    const avant=await snapshot();const crypto=require('node:crypto');const hash=async()=>crypto.createHash('sha256').update(Buffer.from(await(await fetch(basePilote+'/app.js')).arrayBuffer())).digest('hex');const nouvelleEmpreinte=await hash();
    await new Promise(r=>serveurPilote.close(r));serveurPilote=await demarrerServeur(require(path.join(BASELINE_B,'src/app.js')).creerApp(poolPilote));basePilote=`http://127.0.0.1:${serveurPilote.address().port}`;
    const ancienneEmpreinte=await hash();assert.notStrictEqual(ancienneEmpreinte,nouvelleEmpreinte,'Deux versions réelles sont exercées');
    for(const qui of ['new','b'])await api(qui,'GET','/moi');
    await new Promise(r=>serveurPilote.close(r));serveurPilote=await demarrerServeur(creerApp(poolPilote));basePilote=`http://127.0.0.1:${serveurPilote.address().port}`;
    assert.strictEqual(await hash(),nouvelleEmpreinte);assert.deepStrictEqual(await snapshot(),avant);
    for(const [qui,id]of [['new',nouvel.id],['b',b.id]]){await api(qui,'GET','/moi');await api(qui,'GET','/lits?etablissement_id='+id);}
    preuve.mise_a_jour={ancienneEmpreinte,nouvelleEmpreinte,configurations_preservees:true,sessions_preservees:true};preuve.etapes.push('mise à jour commune de deux tenants et conservation des configurations');
  });
  preuve.scenarios_executes=true;fs.writeFileSync(path.resolve('.local/activation-parite-rapport.json'),JSON.stringify(preuve,null,2)+'\n');
});
