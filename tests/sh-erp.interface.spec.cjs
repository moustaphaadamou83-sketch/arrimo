const { demarrerServeur } = require('./serveur-test.cjs');
/**
 * Console SH, écrans ERP dans un vrai navigateur (Chromium, Playwright), politique de sécurité appliquée.
 * Ordinateur, tablette et téléphone : chaque écran est contrôlé (débordement, contraste, boutons ≥ 40 px sur téléphone,
 * modale à l'écran, aucune erreur de console) puis capturé dans captures/<largeur>/sh-erp-*.png.
 * Le parcours passe par les vrais boutons et formulaires : organisation, opportunité, Kanban, devis, approbation,
 * contrat, signature avec dépôt du PDF, facture émise et payée, ticket, document, équipe, notifications. Données fictives.
 *
 *   TEST_DATABASE_URL=postgres:///arrimo_test node --test tests/sh-erp.interface.spec.cjs
 */
// Comme le service (src/sh/server.js) : processus en UTC, dates métier dans le fuseau du Québec.
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { creerAppSh } = require('../src/sh/app');
const { viderBase } = require('../db/vider');
const { viderBaseSh } = require('../db/sh-vider');
const { configurationBase } = require('../db/configuration-base');
const { premierCompteSh } = require('../db/sh-premier-compte');
const invitations = require('../src/sh/invitations');
const totp = require('../src/totp');
const courriel = require('../src/courriel');

const URL_TEST = process.env.INTERFACE_DATABASE_URL || process.env.TEST_DATABASE_URL;
const CLE_MFA = Buffer.alloc(32, 5).toString('base64');
const MDP = 'Console-ERP-2026';
const LARGEURS_DISPONIBLES = [
  { nom: 'ordinateur', width: 1366, height: 800 },
  { nom: 'tablette', width: 820, height: 1180, tactile: true },
  { nom: 'telephone', width: 390, height: 844, tactile: true, mobile: true },
];
const SELECTION_LARGEURS=process.env.SH_UI_VIEWPORTS?.split(',').map(x=>x.trim()).filter(Boolean);
const LARGEURS=SELECTION_LARGEURS?.length?LARGEURS_DISPONIBLES.filter(x=>SELECTION_LARGEURS.includes(x.nom)):LARGEURS_DISPONIBLES;
const DOSSIER = path.join(__dirname, '..', 'captures');
const courriels = [];
let pool; let serveur; let serveurSh; let base; let baseSh; let navigateur; let dossierDocs;

async function appel(jeton, methode, chemin, corps) {
  const r = await fetch(`${baseSh}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  const c = await r.json().catch(() => null);
  assert.ok(r.ok, `${methode} ${chemin} → ${r.status} ${JSON.stringify(c)}`);
  return c;
}
async function session(email) {
  const { token } = await appel(null, 'POST', '/connexion', { email, mot_de_passe: MDP });
  const { secret } = await appel(token, 'POST', '/moi/2fa/preparer');
  await appel(token, 'POST', '/moi/2fa/activer', { code: totp.codePourPas(secret, totp.pasActuel()) });
  return token;
}
const dernierJeton = () => courriels.at(-1).texte.match(/#invitation=([a-f0-9]{64})/)[1];

test.before(async () => {
  assert.ok(URL_TEST, 'TEST_DATABASE_URL requis');
  process.env.SH_API_KEY = 'cle-erp-ui-0123456789abcdef';
  process.env.SH_PUBLIC_URL = 'https://sh.test.invalid';
  process.env.SH_MFA_ENCRYPTION_KEY = CLE_MFA;
  process.env.SH_INITIAL_ADMIN_EMAIL = 'admin.ui@sh.exemple';
  process.env.ARRIMO_ENV = 'recette';
  delete process.env.ARRIMO_DEMO;
  courriel.definirTransport(async (m) => { courriels.push(m); });
  pool = creerPool(URL_TEST);
  await viderBase(pool);
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  await configurationBase(pool);
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  dossierDocs = fs.mkdtempSync(path.join(os.tmpdir(), 'arrimo-sh-ui-docs-'));
  serveurSh = await demarrerServeur(creerAppSh(pool, { env: { SH_PUBLIC_URL: 'https://sh.test.invalid', SH_MFA_ENCRYPTION_KEY: CLE_MFA, SH_DOCUMENTS_DIR: dossierDocs,
    SH_ENV_RECETTE_URL: base, SH_ENV_RECETTE_CLE: process.env.SH_API_KEY, SH_ENV_RECETTE_PUBLIC: 'https://recette.arrimo.exemple' } }));
  baseSh = `http://127.0.0.1:${serveurSh.address().port}`;
  navigateur = await chromium.launch();
});
test.after(async () => {
  await navigateur?.close(); serveurSh?.close(); serveur?.close(); await pool?.end();
  courriel.definirTransport(null);
  if (dossierDocs) fs.rmSync(dossierDocs, { recursive: true, force: true });
});

/** Mêmes contrôles que tests/interface.spec.js, appliqués aux écrans ERP. */
async function verifier(page, L, nom) {
  const m = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth; const debordent = [];
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest('.tableau, .onglets')) return;
      if (r.right > vw + 1 || r.left < -1) debordent.push(`${el.tagName.toLowerCase()}.${el.className} (${Math.round(r.left)}→${Math.round(r.right)})`);
    });
    const boutons = [...document.querySelectorAll('button, .btn, select, input:not([type=checkbox]):not([type=radio]):not([type=file])')]
      .filter((b) => b.offsetParent !== null && !b.closest('[hidden]')).map((b) => ({ h: b.getBoundingClientRect().height, t: (b.textContent || b.id || '').trim().slice(0, 30) }));
    const rgb = (c) => { const x = c.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/); return x ? [+x[1], +x[2], +x[3], x[4] === undefined ? 1 : +x[4]] : null; };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const fondDe = (el) => { const couches = []; for (let e = el; e; e = e.parentElement) { const st = getComputedStyle(e); if (st.backgroundImage !== 'none' && !couches.length) return null; const c = rgb(st.backgroundColor); if (c && c[3] > 0) { couches.push(c); if (c[3] >= 1) break; } }
      let fond = [255, 255, 255]; for (const c of couches.reverse()) fond = fond.map((v, i) => c[i] * c[3] + v * (1 - c[3])); return fond; };
    const textes = []; const contrastes = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const el = n.parentElement; const txt = n.textContent.trim();
      if (!txt || !el || el.closest('script, style, [hidden], option')) continue;
      const r0 = el.getBoundingClientRect(); const st = getComputedStyle(el);
      if (!r0.width || st.visibility === 'hidden' || st.display === 'none') continue;
      textes.push(txt);
      if (el.closest('.toast, :disabled')) continue;
      let opaque = true; for (let e = el; e; e = e.parentElement) if (+getComputedStyle(e).opacity < 1) { opaque = false; break; }
      if (!opaque) continue;
      const fond = fondDe(el); const coul = rgb(st.color); if (!fond || !coul) continue;
      const c = coul[3] < 1 ? coul.map((v, i) => (i < 3 ? v * coul[3] + fond[i] * (1 - coul[3]) : 1)) : coul;
      const [a, b] = [lum(c), lum(fond)].sort((x, y) => y - x); const ratio = (a + 0.05) / (b + 0.05);
      const taille = parseFloat(st.fontSize); const min = taille >= 24 || (taille >= 18.66 && +st.fontWeight >= 700) ? 3 : 4.5;
      if (ratio < min - 0.01) contrastes.push(`« ${txt.slice(0, 40)} » ${ratio.toFixed(2)}:1`);
    }
    const boite = document.querySelector('#modale:not([hidden]) .boite')?.getBoundingClientRect();
    return { page: document.documentElement.scrollWidth, vw, debordent: debordent.slice(0, 5), boutons, pluriels: textes.filter((x) => /\(s\)|\(e\)|\(es\)/.test(x)), contrastes: [...new Set(contrastes)].slice(0, 8),
      boite: boite && { haut: boite.top, bas: boite.bottom, gauche: boite.left, droite: boite.right, vh: window.innerHeight } };
  });
  assert.ok(m.page <= m.vw, `${L.nom}/${nom} : la page déborde (${m.page} > ${m.vw}) ${m.debordent.join(', ')}`);
  assert.deepStrictEqual(m.debordent, [], `${L.nom}/${nom} : éléments hors de l'écran`);
  assert.deepStrictEqual(m.pluriels, [], `${L.nom}/${nom} : « (s) » dans l'interface`);
  assert.deepStrictEqual(m.contrastes, [], `${L.nom}/${nom} : contraste insuffisant`);
  if (m.boite) assert.ok(m.boite.haut >= 0 && m.boite.bas <= m.boite.vh && m.boite.gauche >= 0 && m.boite.droite <= m.vw, `${L.nom}/${nom} : modale hors de l'écran`);
  if (L.mobile) assert.deepStrictEqual(m.boutons.filter((b) => b.h < 40), [], `${L.nom}/${nom} : boutons de moins de 40 px`);
  assert.deepStrictEqual(page.erreurs, [], `${L.nom}/${nom} : erreurs dans la console`);
  const d = path.join(DOSSIER, L.nom); fs.mkdirSync(d, { recursive: true });
  await page.screenshot({ path: path.join(d, `${nom}.png`) });
}

async function ouvrirPage(L, jeton) {
  const ctx = await navigateur.newContext({ locale: 'fr-CA', viewport: { width: L.width, height: L.height }, hasTouch: !!L.tactile, isMobile: !!L.mobile, acceptDownloads: true });
  await ctx.addInitScript((t) => { try { sessionStorage.setItem('sh-token', t); } catch { /* */ } }, jeton);
  const page = await ctx.newPage();
  page.erreurs = [];
  page.on('console', (x) => { if (x.type() === 'error') page.erreurs.push(x.text()); });
  page.on('pageerror', (e) => page.erreurs.push(String(e)));
  await page.goto(baseSh);
  await page.waitForSelector('#ecran-app:not([hidden])');
  await page.waitForSelector('body[data-pret="1"]', { state: 'attached' });
  const rendus = () => page.evaluate(() => Number(document.body.dataset.rendus || 0));
  page.rendu = async (fn) => { const avant = await rendus(); await fn(); for (let t = 0; t < 300 && (await rendus()) <= avant; t += 1) await page.waitForTimeout(50); };
  page.vue = (v) => page.rendu(() => page.click(`#onglets [data-v="${v}"]`));
  page.titre = async () => (await page.locator('#contenu h2').first().textContent()).trim();
  page.viderToasts = () => page.evaluate(() => { document.querySelector('#toasts').innerHTML = ''; });
  page.valider = async (libelle) => page.rendu(() => page.locator('#modale .actions button', { hasText: libelle }).click());
  return page;
}

test('ERP SH dans le navigateur : parcours complet par les écrans, 3 largeurs', { timeout: 600000 }, async () => {
  for (const L of LARGEURS) {
    await viderBaseSh(pool);
    await pool.query(`UPDATE etablissements SET code = 'X-' || id, sous_domaine = NULL WHERE code LIKE 'HOP-UI%'`);
    await premierCompteSh(pool, 'admin.ui@sh.exemple', 'Administration fictive');
    await invitations.consommer(pool, { jeton: dernierJeton(), nouveau: MDP }, process.env);
    const admin = await session('admin.ui@sh.exemple');
    await appel(admin, 'POST', '/equipe', { nom: 'Commercial fictif', email: 'commercial.ui@sh.exemple', role: 'commercial' });
    await invitations.consommer(pool, { jeton: dernierJeton(), nouveau: MDP }, process.env);
    const commercial = await session('commercial.ui@sh.exemple');
    const membreCommercial=(await appel(admin,'GET','/equipe')).find(u=>u.email==='commercial.ui@sh.exemple');
    await appel(admin, 'POST', '/tarifs', { code: 'implantation', libelle: 'Implantation et paramétrage', prix_unitaire: 15000 });
    await appel(admin, 'POST', '/tarifs', { code: 'licence-lits', libelle: 'Licence lits et transferts', prix_unitaire: 1200, periodicite: 'mensuel' });
    const hop = await appel(admin, 'POST', '/hopitaux', { nom: 'Hôpital fictif UI', environnement: 'recette', code_etab: `HOP-UI${L.nom[0].toUpperCase()}`, latitude: 46, longitude: -71.5, ville: 'Ville UI' });

    const page = await ouvrirPage(L, admin);
    // Onglets réservés : l'administration voit tout
    for (const v of ['facturation', 'hebergement', 'rapports', 'documents', 'calendrier', 'equipe']) assert.strictEqual(await page.isVisible(`#onglets [data-v="${v}"]`) || L.mobile, true, v);

    // CRM : organisation et deux opportunités par les formulaires
    await page.vue('crm');
    assert.strictEqual(await page.titre(), 'CRM');
    await page.click('[data-action="org-nouvelle"]');
    await page.fill('#o-nom', 'Centre hospitalier fictif UI'); await page.fill('#o-ville', 'Ville UI'); await page.fill('#o-region','Québec');
    await page.valider('Créer');
    assert.match(await page.textContent('#contenu'), /Centre hospitalier fictif UI/);
    assert.deepStrictEqual(await appel(commercial,'GET','/crm/organisations'),[],'Un rôle seul ne donne accès à aucun client.');
    const organisation=(await appel(admin,'GET','/crm/organisations')).find(o=>o.nom==='Centre hospitalier fictif UI');
    await appel(admin,'POST',`/equipe/${membreCommercial.id}/affectations`,{type:'client',organisation_id:organisation.id});
    for (const titre of ['Projet A fictif', 'Projet B fictif']) {
      await page.click('[data-action="opp-nouvelle"]');
      await page.fill('#p-titre', titre); await page.fill('#p-montant', '20000');
      await page.valider('Créer');
    }
    // Kanban : « Avancer » sur la carte B déplace B, pas la première carte de la liste (régression corrigée)
    const idB = await page.getAttribute('.sh-kanban-card:has-text("Projet B fictif")', 'data-opp');
    await page.rendu(() => page.click(`.sh-kanban-card[data-opp="${idB}"] [data-action="opp-avancer"]`));
    assert.ok(await page.isVisible(`[data-colonne="analyse"] .sh-kanban-card[data-opp="${idB}"]`), `B est passée en Analyse : ${await page.textContent('#toasts')} ${page.erreurs.join(' ')} ${idB}`);
    assert.ok(await page.isVisible('[data-colonne="qualification"] .sh-kanban-card:has-text("Projet A fictif")'), 'A reste en Qualification');
    await page.viderToasts();
    await verifier(page, L, 'sh-erp-01-crm');
    // Devis depuis la carte B, avec le tarif d'implantation
    await page.click(`.sh-kanban-card[data-opp="${idB}"] [data-action="opp-devis"]`);
    await page.selectOption('#q-code-0', 'implantation');
    await page.selectOption('#q-code-1', 'licence-lits');
    await verifier(page, L, 'sh-erp-02-devis');
    await page.valider('Créer le brouillon');

    // Devis et contrats : approbation, contrat, signature avec dépôt du PDF signé
    await page.vue('contrats');
    assert.match(await page.textContent('#contenu'), /Brouillon/);
    await page.rendu(() => page.click('[data-action="devis-approuver"]'));
    assert.match(await page.textContent('#contenu'), /Approuvé/);
    await page.click('[data-action="devis-contrat"]');
    await page.valider('Préparer');
    await page.viderToasts();
    await verifier(page, L, 'sh-erp-03-contrats');
    const [telechargement] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="contrat-pdf"]')]);
    assert.match(telechargement.suggestedFilename(), /^contrat-ARR-.*\.pdf$/);
    await page.click('[data-action="contrat-signer"]');
    await page.fill('#sg-par', 'Signataire fictif');
    await page.setInputFiles('#sg-fichier', { name: 'contrat-signe.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% contrat fictif\n%%EOF\n') });
    await page.valider('Enregistrer');
    assert.match(await page.textContent('#contenu'), /Signé/);
    await page.viderToasts();

    // Facturation : facture de frais uniques émise puis payée
    await page.vue('facturation');
    assert.strictEqual(await page.titre(), 'Facturation');
    assert.match(await page.textContent('#contenu'),/Profils fiscaux par pays et région/);
    assert.match(await page.textContent('#contenu'),/CA \/ QC/);
    assert.match(await page.textContent('#contenu'),/CA \/ BC/);
    await page.click('[data-action="f-emettre"]');
    await page.valider('Émettre');
    assert.match(await page.textContent('#contenu'), /FAC-\d{4}-0001/);
    await page.click('[data-action="f-payer"]');
    await verifier(page, L, 'sh-erp-04-paiement');
    await page.valider('Enregistrer');
    assert.match(await page.textContent('#contenu'), /Payée/);
    await page.viderToasts();
    await verifier(page, L, 'sh-erp-05-facturation');

    // Projets et tâches : le projet issu de la signature, statut d'une tâche changé dans le tableau
    await page.vue('projets');
    await page.rendu(() => page.click('[data-action="p-ouvrir"]'));
    assert.match(await page.textContent('#contenu'), /Implantation · Centre hospitalier fictif UI/);
    await page.rendu(() => page.locator('[data-tache-statut]').first().selectOption('en_cours'));
    await page.viderToasts();
    await verifier(page, L, 'sh-erp-06-projet');
    // Cycle de vie par les vrais écrans, sur un projet fictif sans contrat.
    await page.rendu(()=>page.click('#b-retour-projets'));
    await page.click('[data-action="p-nouveau"]');
    await page.selectOption('#pr-hop',String(hop.id));await page.fill('#pr-nom','Projet archive fictif UI');
    await page.valider('Créer');
    await page.rendu(()=>page.locator('[data-action="p-ouvrir"]',{hasText:'Projet archive fictif UI'}).click());
    await page.click('[data-action="pj-modifier"]');await page.selectOption('#mp-statut','termine');await page.valider('Enregistrer');
    await page.click('[data-action="pj-archiver"]');await page.valider('Archiver');
    assert.match(await page.textContent('#contenu'),/Projet archivé/);
    assert.strictEqual(await page.locator('[data-action="pj-modifier"]').count(),0);
    await page.viderToasts();await verifier(page,L,'sh-erp-06a-projet-archive');
    await page.rendu(()=>page.click('#b-retour-projets'));
    assert.strictEqual(await page.locator('[data-action="p-ouvrir"]',{hasText:'Projet archive fictif UI'}).count(),0);
    await page.rendu(()=>page.click('[data-action="p-archives"]'));
    await page.rendu(()=>page.locator('[data-action="p-ouvrir"]',{hasText:'Projet archive fictif UI'}).click());
    await page.click('[data-action="pj-restaurer"]');await page.valider('Restaurer');
    assert.strictEqual(await page.locator('[data-action="pj-modifier"]').count(),1);
    await page.vue('taches');
    assert.strictEqual(await page.titre(), 'Tâches');
    await page.rendu(() => page.uncheck('#ft-moi'));
    assert.ok(await page.locator('[data-tache-statut]').count() >= 6);
    await verifier(page, L, 'sh-erp-07-taches');
    await page.vue('calendrier');
    assert.strictEqual(await page.titre(), 'Calendrier');
    await page.rendu(() => page.click('#cal-suiv'));
    await verifier(page, L, 'sh-erp-08-calendrier');

    // Support : ticket créé puis ouvert
    await page.vue('support');
    await page.click('[data-action="tk-nouveau"]');
    await page.selectOption('#tk-type', 'incident'); await page.selectOption('#tk-grav', 'critique');
    await page.fill('#tk-titre', 'Incident fictif UI');
    await page.valider('Créer');
    assert.match(await page.textContent('#contenu'), /Incident fictif UI/);
    assert.ok(await page.isVisible('[data-colonne="nouveau"] .sh-kanban-card:has-text("Incident fictif UI")'),'le Kanban support contient les nouveaux tickets');
    assert.ok(await page.isVisible('[data-colonne="assigne"]'),'la colonne Assigné est disponible');
    await page.click('[data-action="tk-ouvrir"]');
    await page.waitForSelector('#tm-statut');
    await verifier(page, L, 'sh-erp-09-ticket');
    await page.selectOption('#tm-statut', 'en_cours');
    await page.valider('Enregistrer');
    await page.viderToasts();

    // Documents : dépôt, puis téléchargement déchiffré
    await page.vue('documents');
    await page.click('[data-action="doc-depot"]');
    await page.setInputFiles('#dd-fichier', { name: 'procedure-fictive.txt', mimeType: 'text/plain', buffer: Buffer.from('Procédure fictive.\n') });
    await page.selectOption('#dd-cat', 'technique');
    await page.selectOption('#dd-hop', String(hop.id));
    await page.valider('Déposer');
    assert.match(await page.textContent('#contenu'), /procedure-fictive\.txt/);
    const [doc] = await Promise.all([page.waitForEvent('download'), page.click('tr:has-text("procedure-fictive.txt") [data-action="doc-dl"]')]);
    assert.strictEqual(fs.readFileSync(await doc.path(), 'utf8'), 'Procédure fictive.\n');
    await page.viderToasts();
    await verifier(page, L, 'sh-erp-10-documents');

    // Hébergement, rapports, équipe, fiche hôpital, notifications
    await page.vue('hebergement');
    await page.rendu(() => page.click('[data-action="heb-verifier"]'));
    assert.match(await page.textContent('#contenu'), /répond/);
    await page.viderToasts();
    await verifier(page, L, 'sh-erp-11-hebergement');
    await page.vue('rapports');
    assert.match(await page.textContent('#contenu'), /Pipeline commercial/);
    await verifier(page, L, 'sh-erp-12-rapports');
    await page.vue('equipe');
    await page.click('[data-action="eq-nouvelle"]');
    await page.fill('#eq-nom', 'Équipe fictive UI');
    await page.check('#modale [data-membre]');
    await page.valider('Enregistrer');
    assert.match(await page.textContent('#contenu'), /Équipe fictive UI/);
    await page.viderToasts();
    await verifier(page, L, 'sh-erp-13-equipe');
    await page.vue('hopitaux');
    await page.rendu(() => page.click(`[data-h="${hop.id}"]`));
    await page.waitForSelector('.complement-hopital');
    await page.click('[data-action="ss-nouvelle"]');
    await page.fill('#sn-debut', '2026-12-01T09:00'); await page.fill('#sn-titre', 'Séance fictive UI');
    await page.valider('Planifier');
    await page.waitForSelector('.complement-hopital');
    assert.match(await page.textContent('#seances'), /Séance fictive UI/);
    await page.viderToasts();
    await verifier(page, L, 'sh-erp-14-hopital');
    await page.click('#b-notifications');
    await page.waitForSelector('#modale:not([hidden]) .liste-notifs, #modale:not([hidden]) .note');
    await verifier(page, L, 'sh-erp-15-notifications');
    await page.click('#modale .actions button:has-text("Fermer")');
    await page.vue('accueil');
    assert.strictEqual(await page.titre(), 'Accueil');
    await verifier(page, L, 'sh-erp-16-accueil');
    await page.vue('compte');
    // Apparence sombre : préférence enregistrée par compte, appliquée, contrastes AA sur chaque onglet visible
    // Le choix s'applique et s'enregistre dès le clic, sans bouton « Enregistrer ».
    assert.equal(await page.locator('#f-apparence button[type="submit"]').count(),0);
    const reponseApparence=page.waitForResponse(r=>r.url().includes('/api/moi/apparence')&&r.request().method()==='PUT');
    await page.check('input[name="m-apparence"][value="sombre"]');
    assert.equal((await reponseApparence).status(),200);
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='sombre');
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'sombre');
    assert.equal((await pool.query("SELECT apparence FROM sh_utilisateurs WHERE email='admin.ui@sh.exemple'")).rows[0].apparence,'sombre');
    const ongletsSombres=await page.evaluate(()=>[...document.querySelectorAll('#onglets [data-v]')].filter(b=>!b.hidden&&b.offsetParent!==null).map(b=>b.dataset.v));
    assert.ok(ongletsSombres.length>=8,`onglets visibles : ${ongletsSombres}`);
    for(const v of ongletsSombres){await page.vue(v);await page.viderToasts();await verifier(page,L,`sh-sombre-${v}`);}
    await page.vue('compte');
    // Bouton de l'en-tête : sombre → automatique, immédiat et enregistré.
    const reponseTheme=page.waitForResponse(r=>r.url().includes('/api/moi/apparence')&&r.request().method()==='PUT');
    await page.click('#b-theme');
    assert.equal((await reponseTheme).status(),200);
    await page.waitForFunction(()=>document.documentElement.dataset.apparence==='automatique');
    assert.equal((await pool.query("SELECT apparence FROM sh_utilisateurs WHERE email='admin.ui@sh.exemple'")).rows[0].apparence,'automatique');
    // Paramètres : le choix direct s'applique aussi immédiatement.
    if(ongletsSombres.includes('parametres')){await page.vue('parametres');
      const rp=page.waitForResponse(r=>r.url().includes('/api/moi/apparence')&&r.request().method()==='PUT');
      await page.check('input[name="pa-apparence"][value="sombre"]');assert.equal((await rp).status(),200);
      await page.waitForFunction(()=>document.documentElement.dataset.theme==='sombre');
      const rr=page.waitForResponse(r=>r.url().includes('/api/moi/apparence')&&r.request().method()==='PUT');
      await page.check('input[name="pa-apparence"][value="automatique"]');assert.equal((await rr).status(),200);
      await page.vue('compte');}
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'clair','automatique suit le système (clair dans ce navigateur)');
    await page.fill('#m-fuseau','Africa/Lome');
    const reponseFuseau=page.waitForResponse(r=>r.url().includes('/api/moi/fuseau-horaire')&&r.request().method()==='PUT');
    await page.click('#f-fuseau button[type="submit"]');
    const resultatFuseau=await reponseFuseau;
    assert.equal(resultatFuseau.status(),200,`Enregistrement du fuseau : ${resultatFuseau.status()} ${await resultatFuseau.text()}; toasts=${await page.locator('#toasts').innerText()}`);
    await page.waitForFunction(()=>document.querySelector('#m-fuseau')?.value==='Africa/Lome');
    assert.equal((await pool.query("SELECT fuseau_horaire FROM sh_utilisateurs WHERE email='admin.ui@sh.exemple'")).rows[0].fuseau_horaire,'Africa/Lome');
    await page.context().close();

    // Rôle commercial : facturation et hébergement masqués, CRM visible
    const pc = await ouvrirPage(L, commercial);
    assert.strictEqual(await pc.locator('#onglets [data-v="facturation"]').isHidden(), true);
    assert.strictEqual(await pc.locator('#onglets [data-v="hebergement"]').isHidden(), true);
    assert.strictEqual(await pc.locator('#onglets [data-v="crm"]').isHidden(), false);
    await pc.vue('crm');
    assert.match(await pc.textContent('#contenu'), /Projet A fictif/);
    await verifier(pc, L, 'sh-erp-17-commercial');
    await pc.context().close();
  }
});
