/**
 * Enregistrement de la vidéo de démonstration (Playwright, 1920 × 1080) sur le serveur de démonstration.
 *   ARRIMO_URL=https://arrimo.senseafri.com DEMO_MOT_DE_PASSE=… node scripts/video-demo.js <fr|en> <dossier>
 * - Connexion par l'API, hors écran : la session est déposée dans le navigateur avant l'ouverture de la page.
 *   Aucun courriel, mot de passe, clé ou code n'apparaît à l'écran ni dans la sortie du script.
 * - Curseur dessiné dans la page (Playwright ne filme pas le curseur), pause de 2 à 3 s après chaque action.
 * - Produit un fichier vidéo par séquence et etapes.json (début, fin et sous-titre de chaque étape, en secondes).
 * - LIBERER_LIT : commande qui libère un lit dans un hôpital voisin sans compte (même règles que la simulation),
 *   pour montrer le bandeau « disponibilité à côté ».
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { chromium } = require('playwright');

const BASE = process.env.ARRIMO_URL || 'https://arrimo.senseafri.com';
const MDP = process.env.DEMO_MOT_DE_PASSE;
const [langue = 'fr', dossier = path.join(__dirname, '..', 'captures', 'video')] = process.argv.slice(2);
const T = (fr, en) => (langue === 'en' ? en : fr);
const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function jeton(email) {
  const r = await fetch(`${BASE}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, mot_de_passe: MDP }) });
  const d = await r.json();
  if (!d.token) throw new Error(`Connexion refusée (${r.status})`);
  await fetch(`${BASE}/api/moi/premiers-pas`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}` } });
  return d.token;
}

// Curseur visible et effet de clic, dessinés dans la page
const CURSEUR = () => {
  const poser = () => {
    if (document.getElementById('curseur-video')) return;
    const c = document.createElement('div');
    c.id = 'curseur-video';
    c.style.cssText = 'position:fixed;left:-50px;top:-50px;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;'
      + 'background:rgba(87,197,182,.35);border:3px solid #0E5E6F;box-shadow:0 0 0 2px #fff;pointer-events:none;z-index:2147483647;transition:transform .12s';
    document.documentElement.appendChild(c);
    document.addEventListener('mousemove', (e) => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
    document.addEventListener('mousedown', () => { c.style.transform = 'scale(.7)'; }, true);
    document.addEventListener('mouseup', () => { c.style.transform = 'scale(1)'; }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', poser); else poser();
};

(async () => {
  if (!MDP) throw new Error('DEMO_MOT_DE_PASSE manquant');
  fs.mkdirSync(dossier, { recursive: true });
  const nav = await chromium.launch();
  const etapes = [];
  const sequences = [];

  /** Ouvre une séquence filmée, déjà connectée. Retourne la page et une fonction pour noter les étapes. */
  async function sequence(nom, email, vue = { width: 1920, height: 1080 }) {
    const token = await jeton(email);
    const ctx = await nav.newContext({ viewport: vue, deviceScaleFactor: 1, recordVideo: { dir: path.join(dossier, nom), size: vue }, hasTouch: vue.width < 1000 });
    await ctx.addInitScript(({ tok, l }) => {
      try { localStorage.setItem('arrimo-token', tok); localStorage.setItem('arrimo-langue', l); } catch { /* */ }
      window.ARRIMO_VEILLE_MS = 2000;
    }, { tok: token, l: langue });
    await ctx.addInitScript(CURSEUR);
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(BASE);
    await page.waitForSelector('body[data-pret="1"]');
    await page.mouse.move(vue.width / 2, vue.height / 2);
    await pause(800);
    const seq = { nom, debut: (Date.now() - t0) / 1000, ctx, page, t0, vue };
    sequences.push(seq);
    let courante = null;
    seq.etape = (texte) => {
      const t = (Date.now() - t0) / 1000;
      if (courante) courante.fin = t;
      courante = texte ? { sequence: nom, debut: t, texte } : null;
      if (courante) etapes.push(courante);
    };
    seq.terminer = async () => {
      seq.etape(null);
      seq.fin = (Date.now() - t0) / 1000;
      await page.close();
      seq.video = await page.video().path();
      await ctx.close();
    };
    return seq;
  }

  /** Déplace le curseur lentement jusqu'à l'élément, clique, puis laisse le temps de voir le résultat. */
  async function clic(page, cible, apres = 2500) {
    const loc = typeof cible === 'string' ? page.locator(cible).first() : cible;
    await loc.scrollIntoViewIfNeeded();
    await pause(300);
    const b = await loc.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 28 });
    await pause(450);
    await page.mouse.down(); await pause(90); await page.mouse.up();
    await pause(apres);
  }
  async function survoler(page, cible, apres = 1500) {
    const loc = typeof cible === 'string' ? page.locator(cible).first() : cible;
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    await page.mouse.move(b.x + Math.min(b.width / 2, 160), b.y + Math.min(b.height / 2, 40), { steps: 24 });   // petits éléments : leur centre
    await pause(apres);
  }
  const defiler = async (page, y, apres = 2200) => { await page.evaluate((v) => window.scrollTo({ top: v, behavior: 'smooth' }), y); await pause(apres); };
  const versElement = async (page, sel, apres = 2200, marge = 90) => {
    const y = await page.evaluate(([s, m]) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect().top + window.scrollY - m : 0; }, [sel, marge]);
    await defiler(page, y, apres);
  };

  // ---------------------------------------------------------------- A. Hôpital X : Copilote, urgence, disponibilité, national, transfert
  const a = await sequence('a-hopital-x', 'hopital.x@demo.arrimo');
  const x = a.page;
  a.etape(T('Hôpital X : le Copilote résume la situation en un coup d’œil', 'Hospital X: the Copilot sums up the situation at a glance'));
  await survoler(x, '#v-copilote .niveau', 3000);
  await survoler(x, '#v-copilote .ensemble', 3000);
  a.etape(T('Les 5 recommandations les plus importantes, et les prévisions à 4, 12 et 24 h', 'The 5 most important recommendations, and the 4, 12 and 24 h forecast'));
  await versElement(x, '#v-copilote .deux', 2000);
  await survoler(x, '#v-copilote .reco', 2500);
  await survoler(x, '#v-copilote .tableau.prev', 3500);
  await defiler(x, 0, 1200);

  a.etape(T('Urgence : civières, corridor, patients depuis plus de 24 h et 48 h', 'ER: stretchers, hallway, patients waiting over 24 h and 48 h'));
  await clic(x, '#onglets [data-v="urgence"]', 3000);
  await survoler(x, '#v-urgence .tuiles', 2500);
  await versElement(x, '#v-urgence .civieres', 3500);
  await defiler(x, 0, 1000);

  // Asynchrone : un appel bloquant fige l'horodatage des images de Playwright et décale les sous-titres
  if (process.env.LIBERER_LIT) await promisify(exec)(process.env.LIBERER_LIT);
  await x.waitForSelector('#bandeau-dispo:not([hidden])', { timeout: 30000 });
  // Le sous-titre suit l'apparition du bandeau, quel que soit son délai
  a.etape(T('Un lit se libère à 5 km : Arrimo prévient en direct', 'A bed frees up 5 km away: Arrimo alerts in real time'));
  await pause(800);
  await survoler(x, '#bandeau-dispo', 3500);
  await clic(x, '#b-dispo-fermer', 800);

  a.etape(T('Tableau national : du plus proche au plus loin, avec le temps de route', 'National dashboard: nearest first, with drive time'));
  await clic(x, '#onglets [data-v="national"]', 2500);
  const sel = x.locator('#n-type');
  await survoler(x, sel, 400);
  await sel.selectOption({ index: 2 });
  await pause(1800);
  await clic(x, '#n-libre', 2800);
  await versElement(x, '#v-national .etabs', 3000, 120);
  await defiler(x, 0, 1000);
  a.etape(T('La carte : le niveau d’alerte de chaque hôpital', 'The map: each hospital’s alert level'));
  await clic(x, '[data-nv="carte"]', 1000);
  await x.waitForSelector('.leaflet-interactive', { timeout: 20000 });
  await pause(1500);
  await versElement(x, '#carte-nat', 4500, 140);
  await defiler(x, 0, 800);

  a.etape(T('Patient en isolement : Arrimo propose l’hôpital le plus proche qui a la bonne chambre', 'Isolation patient: Arrimo proposes the nearest hospital with the right room'));
  await clic(x, '#onglets [data-v="admissions"]', 2200);
  const fiche = x.locator('#v-admissions .fiche', { hasText: T('isolement', 'isolation') }).first();
  await clic(x, fiche.locator('[data-a="ailleurs"]'), 3500);
  await clic(x, '#modale .btn.pri', 3000);
  await a.terminer();

  // ---------------------------------------------------------------- B. Hôpital Y : accepter, chambre prête, heure d'arrivée
  const b = await sequence('b-hopital-y', 'hopital.y@demo.arrimo');
  const y = b.page;
  b.etape(T('Hôpital Y accepte la demande en un clic, sans appel', 'Hospital Y accepts the request in one click, no phone call'));
  await clic(y, '#onglets [data-v="transferts"]', 2500);
  await clic(y, '#v-transferts [data-etape="accepter"]', 3000);
  b.etape(T('« Chambre prête » : aucun dossier à créer, Hôpital X est avisé', '“Room ready”: no record to create, Hospital X is notified'));
  await clic(y, '#v-transferts [data-etape="chambre_prete"]', 3500);
  b.etape(T('Patient en route : heure d’arrivée prévue et compte à rebours', 'Patient on the way: expected arrival time and countdown'));
  await survoler(y, '#v-transferts [data-eta] .ic', 5000);   // sur l'horloge : l'heure d'arrivée reste lisible
  await b.terminer();

  // ---------------------------------------------------------------- C. Tablette : nettoyage priorisé
  const c = await sequence('c-tablette', 'hopital.x@demo.arrimo', { width: 820, height: 1180 });
  const tab = c.page;
  c.etape(T('Sur tablette : on nettoie d’abord ce qui débloque des patients', 'On a tablet: clean first what frees up patients'));
  await clic(tab, '#onglets [data-v="nettoyage"]', 3000);
  await survoler(tab, '#v-nettoyage .net-item', 2500);
  await clic(tab, '#v-nettoyage .net-item [data-fini]', 3500);
  await c.terminer();

  // ---------------------------------------------------------------- D. Hôpital X : indicateurs
  const d = await sequence('d-indicateurs', 'hopital.x@demo.arrimo');
  const xi = d.page;
  d.etape(T('Indicateurs : cibles et tendances pour mesurer les progrès', 'Indicators: targets and trends to measure progress'));
  await clic(xi, '#onglets [data-v="indicateurs"]', 3500);
  await versElement(xi, '#v-indicateurs .titre-section:nth-of-type(2)', 4000, 100);
  await defiler(xi, 99999, 4000);
  await d.terminer();

  await nav.close();
  const res = sequences.map((s) => ({ nom: s.nom, video: s.video, debut: s.debut, fin: s.fin, largeur: s.vue.width, hauteur: s.vue.height }));
  fs.writeFileSync(path.join(dossier, 'etapes.json'), JSON.stringify({ langue, sequences: res, etapes }, null, 2));
  console.log(`Séquences : ${res.map((s) => `${s.nom} ${Math.round(s.fin - s.debut)} s`).join(', ')}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
