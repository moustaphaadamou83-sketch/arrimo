'use strict';
// Contrôles du lanceur : entrée privée JSON sur stdin, aucun secret dans les diagnostics.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const ident = (x) => `"${String(x).replaceAll('"', '""')}"`;
const copie = (x) => /^arrimo_publication_restore_[a-z0-9_]+$/.test(x);
// Seule exception au contrôle « données existantes » : ajouts du catalogue SH par les migrations 37 (types d'établissement) et 38 (Liaison CHSLD).
// Liste fermée ; les lignes déjà présentes doivent rester identiques (colonnes d'origine), aucune suppression ni renommage.
const AJOUTS_CATALOGUE_SH = new Set(['comptes', 'documents', 'support', 'journal', 'parametres', 'admissions_hopital', 'nsa', 'nettoyage',
  'national', 'residents', 'chambres', 'demandes_hebergement', 'entretien_chsld', 'taches', 'proches', 'hospitalisations', 'reseau_chsld',
  'portail_proches', 'messagerie_securisee', 'appels_video',
  // Préhospitalier et Liaison Établissements (migration SH 45, 12 nov. 2026)
  'liaison_secours', 'transport_ambulancier', 'profil_ccs', 'profil_ambulance',
  // Migration 38 : module hospitalier Liaison CHSLD (une ligne ajoutée, aucune ligne existante modifiée)
  'liaison_chsld']);
async function lignesCatalogue(c, cols) {
  const r = await c.query(`SELECT code, row_to_json(x)::text AS ligne FROM (SELECT ${cols.map(ident).join(',')} FROM public.sh_modules_catalogue) x`);
  return new Map(r.rows.map((x) => [x.code, x.ligne]));
}
function verifierCible(url, nom) {
  const u = new URL(url);
  assert.ok(['postgres:', 'postgresql:'].includes(u.protocol));
  assert.ok(['', 'localhost', '127.0.0.1', '[::1]'].includes(u.hostname), 'PostgreSQL local requis');
  assert.equal(decodeURIComponent(u.pathname.slice(1)), nom);
  const host = u.searchParams.get('host');
  assert.ok(!host || ['localhost', '127.0.0.1', '::1', '/var/run/postgresql'].includes(host));
  for(const k of u.searchParams.keys())assert.equal(u.searchParams.getAll(k).length,1,'Paramètre PostgreSQL dupliqué');
  assert.ok([...u.searchParams.keys()].every((k) => ['host','sslmode','application_name'].includes(k)));
}
async function colonnes(c) {
  const r = await c.query(`SELECT table_name::text AS table_name, array_agg(column_name::text ORDER BY ordinal_position) AS cols FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname='public') GROUP BY table_name ORDER BY table_name`);
  return Object.fromEntries(r.rows.map((x) => [x.table_name, x.cols]));
}
async function empreintes(c, cols) {
  const r = {};
  for (const [t, cs] of Object.entries(cols)) {
    r[t] = (await c.query(`SELECT count(*)::text AS n, md5(coalesce(string_agg(md5(row_to_json(x)::text),'' ORDER BY md5(row_to_json(x)::text)),'')) AS hash
      FROM (SELECT ${cs.map(ident).join(',')} FROM public.${ident(t)}) x`)).rows[0];
  }
  return r;
}
async function migration(c, p) {
  const cols = await colonnes(c);
  // Les métadonnées de migration SH peuvent recevoir les versions nouvelles, pas les données métier.
  const catalogue = p.type === 'sh' && cols.sh_modules_catalogue?.includes('code') ? cols.sh_modules_catalogue : null;
  const metier = Object.fromEntries(Object.entries(cols).filter(([t]) => t !== 'sh_migrations' && !(catalogue && t === 'sh_modules_catalogue')));
  for (const t of Object.keys(cols)) await c.query(`LOCK TABLE public.${ident(t)} IN SHARE ROW EXCLUSIVE MODE`);
  const avant = await empreintes(c, metier);
  const catalogueAvant = catalogue ? await lignesCatalogue(c, catalogue) : null;
  const sequences = (await c.query("SELECT sequencename,last_value::text FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
  if (p.type === 'sh') {
    await c.query(fs.readFileSync(path.join(p.code, 'db/sh-schema.sql'), 'utf8'));
    // Même transaction : le wrapper évite toute transaction imbriquée du pool.
    const { migrerSh } = require(path.join(p.code, 'src/sh/migrations'));
    await migrerSh({ connect: async () => ({ query: (...a) => {
      if (['BEGIN','COMMIT','ROLLBACK'].includes(String(a[0]))) return Promise.resolve({ rows: [] });
      return c.query(...a);
    }, release() {} }) }, p.env);
  } else {
    for (const f of ['20261025-priorites.sql','20261025-simulation.sql']) await c.query(fs.readFileSync(path.join(p.code,'db/migrations',f),'utf8'));
  }
  assert.deepEqual(await empreintes(c, metier), avant, 'Données existantes modifiées : publication refusée');
  const ajouts = [];
  if (catalogue) {
    const apres = await lignesCatalogue(c, catalogue);
    for (const [code, ligne] of catalogueAvant) assert.equal(apres.get(code), ligne, 'Données existantes modifiées : publication refusée');
    for (const code of apres.keys()) if (!catalogueAvant.has(code)) {
      assert.ok(AJOUTS_CATALOGUE_SH.has(code), 'Ajout non prévu au catalogue SH : publication refusée');
      ajouts.push(code);
    }
  }
  const apresSequences=(await c.query("SELECT sequencename,last_value::text FROM pg_sequences WHERE schemaname='public' AND sequencename=ANY($1::text[]) ORDER BY sequencename",[sequences.map(x=>x.sequencename)])).rows;
  assert.deepEqual(apresSequences,sequences,'Compteurs existants modifiés : publication refusée');
  return { donnees_preservees: true, tables: Object.keys(metier).length + (catalogue ? 1 : 0), catalogue_ajouts: ajouts.sort() };
}
async function base(p) {
  verifierCible(p.url, p.nom);
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: p.url, max: 1, connectionTimeoutMillis: 10000 });
  const c = await pool.connect();
  try {
    await c.query("SET TIME ZONE 'UTC'");
    const info = (await c.query('SELECT current_database() AS base,current_user AS role,inet_server_addr()::text AS adresse')).rows[0];
    assert.equal(info.base, p.nom);
    if (p.role) assert.equal(info.role, p.role);
    if (p.operation === 'identite') return info;
    if (p.operation === 'creer-copie') {
      assert.ok(copie(p.cible)); assert.ok(p.proprietaire);
      await c.query(`CREATE DATABASE ${ident(p.cible)} OWNER ${ident(p.proprietaire)} TEMPLATE template0`);
      await c.query(`REVOKE CONNECT ON DATABASE ${ident(p.cible)} FROM PUBLIC`);
      return { copie_creee: p.cible };
    }
    if (p.operation === 'sauvegarde') {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const snapshot = (await c.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
      const cols = await colonnes(c);
      // Le dump ET les empreintes partagent le même snapshot malgré les écritures hospitalières concurrentes.
      // libpq n'interprète pas une URL fournie via PGDATABASE : passer des variables PG* distinctes
      // (le mot de passe reste hors de la ligne de commande).
      const uu = new URL(p.url);
      const envDump = { ...process.env, PGCONNECT_TIMEOUT: '10',
        PGHOST: uu.searchParams.get('host') || uu.hostname || '/var/run/postgresql',
        PGPORT: uu.port || '5432', PGDATABASE: p.nom };
      if (uu.username) envDump.PGUSER = decodeURIComponent(uu.username);
      if (uu.password) envDump.PGPASSWORD = decodeURIComponent(uu.password);
      if (uu.searchParams.get('sslmode')) envDump.PGSSLMODE = uu.searchParams.get('sslmode');
      execFileSync('pg_dump', ['--format=custom','--no-owner','--snapshot='+snapshot,'--file='+p.dump], {
        env: envDump, stdio: ['ignore','ignore','pipe'], timeout: 600000 });
      const contenu = await empreintes(c, cols);
      await c.query('COMMIT');
      return { colonnes: cols, contenu };
    }
    if (p.operation === 'empreintes') return { contenu: await empreintes(c, p.colonnes) };
    if (p.operation === 'migrer') {
      assert.ok(copie(p.nom) || p.public_autorise === true, 'Base publique sans preuves de préparation');
      if (!copie(p.nom)) assert.ok(p.preuves?.restauration && p.preuves?.migration_copie && p.preuves?.ancien_code);
      await c.query('BEGIN');
      try {
        await c.query("SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s'");
        const r = await migration(c, p);
        await c.query('COMMIT'); return r;
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    }
    if (p.operation === 'fermer-sessions-test') {
      // Seulement les jetons obtenus par connexion normale du lanceur ; aucun compte supprimé.
      const crypto = require('node:crypto');
      for (const token of p.tokens || []) {
        const h = crypto.createHash('sha256').update(token).digest('hex');
        if (p.type === 'sh') await c.query('DELETE FROM sh_sessions WHERE token=$1 AND token_hache', [h]);
        else await c.query('DELETE FROM sessions WHERE token=ANY($1::text[])', [[token, 'h:'+h]]);
      }
      return { sessions_test_fermees: true };
    }
    throw new Error('Operation inconnue');
  } finally { c.release(); await pool.end(); }
}
async function connexion(p) {
  const r = await fetch(p.base+'/api/connexion'+(p.jeton ? '/2fa' : ''), {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify(p.jeton ? { jeton:p.jeton, code:p.otp } : {email:p.email,mot_de_passe:p.password}), signal:AbortSignal.timeout(20000) });
  assert.equal(r.status,200,'Connexion autorisée requise');
  return r.json();
}
async function acces(p) {
  const r=await fetch(p.base+'/api/moi',{headers:{Authorization:'Bearer '+p.token},signal:AbortSignal.timeout(20000)});
  assert.equal(r.status,200);const m=await r.json();assert.equal(m.utilisateur.mdp_temporaire,false,'Mot de passe temporaire : intervention du titulaire requise');
  if(p.type==='sh'){assert.equal(m.utilisateur.role,'administration');assert.equal(m.utilisateur.totp_actif,true);return {role:'administration'};}
  assert.ok(m.etablissements.length);return {role:m.utilisateur.role,etablissements:m.etablissements.map(e=>e.id),gestionnaire:m.utilisateur.gestionnaire};
}
async function navigateur(p) {
  // Le briefing Copilote peut bloquer le basculement de vue sur un grand réseau (~30 s) : marge d'attente.
  const ATTENTE_VUE = 60000;
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless:true });
  const compteRendus = [];
  try {
    for (const compte of p.comptes) {
      const ctx = await browser.newContext({ viewport:{width:1366,height:900}, ignoreHTTPSErrors:false });
      const page = await ctx.newPage();
      const erreurs = [];
      page.on('pageerror', () => erreurs.push('erreur JavaScript'));
      page.on('console', (m) => { if (m.type()==='error') erreurs.push('console.error'); });
      await page.addInitScript(({token,sh}) => {
        (sh ? sessionStorage : localStorage).setItem(sh ? 'sh-token' : 'arrimo-token', token);
      }, { token:compte.token, sh:p.type==='sh' });
      await page.goto(p.base,{ waitUntil:'networkidle',timeout:45000 });
      const headers = {Authorization:'Bearer '+compte.token};
      const appel = async (chemin, options={}) => {
        const r = await ctx.request.get(p.base+'/api'+chemin,{headers,timeout:20000,...options});
        assert.equal(r.status(),200, 'API autorisée indisponible : '+chemin.split('?')[0]); return r.json();
      };
      const moi = await appel('/moi');
      if (p.type==='sh') {
        assert.equal(moi.utilisateur?.role || moi.role || moi.u?.role, 'administration', 'Compte SH administration requis');
        await page.locator('#ecran-app:not([hidden])').waitFor({timeout:30000});
        for (const vue of ['accueil','hopitaux','crm','contrats','projets','taches','support']) {
          const tab = page.locator(`#onglets [data-v="${vue}"]`);
          await tab.click(); await page.locator('#contenu h2').waitFor({timeout:ATTENTE_VUE});
        }
        for (const chemin of ['/hopitaux','/environnements','/journal']) await appel(chemin);
      } else {
        await page.locator('body[data-pret="1"]').waitFor({timeout:30000});
        if (p.type==='demo' && compte.nom !== 'reseau') assert.equal(moi.etablissements.length,1,'Isolation du dashboard');
        if (compte.nom==='reseau') assert.equal(moi.utilisateur.gestionnaire,true);
        const etab = moi.etablissements[0]?.id; assert.ok(etab,'Aucun établissement autorisé');
        for (const chemin of ['/admissions','/lits','/civieres','/conges','/nsa','/transferts','/copilote/briefing']) await appel(chemin+'?etablissement_id='+etab);
        if (p.type==='demo' && compte.interdit) {
          const interdit = await ctx.request.get(p.base+'/api/lits?etablissement_id='+compte.interdit,{headers});
          assert.equal(interdit.status(),403,'Accès interétablissement non autorisé');
        }
        for (const vue of compte.nom==='reseau' ? ['reseau','national'] : ['copilote','admissions','lits','urgence','vigilance','nettoyage','nsa','transferts']) {
          const tab = page.locator(`#onglets [data-v="${vue}"]`);
          await tab.click(); await page.locator(`#v-${vue}:not([hidden])`).waitFor({timeout:ATTENTE_VUE});
        }
        if (p.type==='demo') {
          const q = await ctx.request.post(p.base+'/api/copilote/question',{ headers, data:{etablissement_id:etab,question:'Quels lits sont disponibles et quelles demandes attendent un lit ?'} });
          assert.equal(q.status(),200); assert.ok((await q.json()).reponse);
        }
      }
      assert.deepEqual(erreurs,[], 'Erreurs JavaScript après publication');
      // Captures publiques uniquement sur le jeu explicitement fictif de la démo.
      if (p.type==='demo') {
        const vue=compte.nom==='reseau'?'reseau':'copilote';
        await page.locator(`#onglets [data-v="${vue}"]`).click();
        await page.locator(`#v-${vue}:not([hidden])`).waitFor({timeout:ATTENTE_VUE});
        await page.screenshot({ path:path.join(p.captures,'dashboard-'+compte.nom+'.png'),fullPage:true });
      }
      compteRendus.push({ compte:compte.nom, navigateur:true, lectures_metier:true, erreurs_javascript:0 });
      await ctx.close();
    }
    return { controles:compteRendus };
  } finally { await browser.close(); }
}
async function local(p) {
  assert.ok(copie(p.nom),'Smoke local exige une copie restaurée');
  verifierCible(p.url,p.nom);
  for (const [k,v] of Object.entries(p.env)) process.env[k]=v;
  process.env.DATABASE_URL=p.url;process.env.SH_DATABASE_URL=p.url;
  // Aucun serveur de démarrage : ni recalage, simulation, supervision, notification ou connecteur sortant.
  const { creerPool } = require(path.join(p.code,'src/db'));
  const pool=creerPool(p.url);
  const app=p.type==='sh' ? require(path.join(p.code,'src/sh/app')).creerAppSh(pool,{env:p.env}) : require(path.join(p.code,'src/app')).creerApp(pool);
  const server=require('node:http').createServer(app);
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base='http://127.0.0.1:'+server.address().port;
    const s=await fetch(base+'/api/sante');assert.equal(s.status,200);assert.equal((await s.json()).base,'ok');
    const page=await fetch(base+'/');assert.equal(page.status,200);
    const priv=await fetch(base+'/api/moi');assert.equal(priv.status,401);
    for(const compte of p.comptes){
      // Les sessions existantes ont été copiées avec le snapshot ; aucune identité créée ou modifiée.
      const r=await fetch(base+'/api/moi',{headers:{Authorization:'Bearer '+compte.token}});assert.equal(r.status,200,'Compatibilité des sessions sur copie');
      const m=await r.json();
      if(p.type!=='sh')for(const suffix of ['/lits','/admissions','/civieres','/transferts','/nsa']){
        const x=await fetch(base+'/api'+suffix+'?etablissement_id='+m.etablissements[0].id,{headers:{Authorization:'Bearer '+compte.token}});assert.equal(x.status,200);
      }
    }
    return { ancien_ou_nouveau_code_compatible:true, authentification_preservee:true };
  } finally { await new Promise(r=>server.close(r));await pool.end(); }
}
async function main(p) {
  if(p.operation==='connexion')return connexion(p);
  if(p.operation==='acces')return acces(p);
  if(p.operation==='navigateur')return navigateur(p);
  if(p.operation==='local')return local(p);
  return base(p);
}
if(require.main===module){
 let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{
  Promise.resolve().then(()=>main(JSON.parse(input))).then(r=>process.stdout.write(JSON.stringify(r))).catch(e=>{console.error('CONTROLE_ECHOUE '+(e.code||e.name||'erreur'));process.exitCode=1;});
 });
}
module.exports={verifierCible,copie,AJOUTS_CATALOGUE_SH};
