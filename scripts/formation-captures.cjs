/* Module Formation : (re)génère les captures des capsules depuis une COPIE de la démo (données fictives), FR et EN,
   avec la zone mise en évidence calculée d'après l'élément visé. Usage :
     node scripts/formation-captures.cjs <url de la copie> <fichier d'accès de la démo> [CODE ...]
   Écrit public/formation/captures/<CODE>/<n>-<langue>.jpg et public/formation/captures/manifeste.json. Mot de passe jamais affiché. */
const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || path.join(__dirname, '..', 'node_modules', 'playwright'));
const CAT = require('../src/formation-catalogue');
const [BASE, ACCES, ...CODES] = process.argv.slice(2);
const MDP = fs.readFileSync(ACCES, 'utf8').match(/Mot de passe[^:]*:\s*(\S+)/)[1];
const SORTIE = path.join(__dirname, '..', 'public', 'formation', 'captures');
const W = 1180; const H = 740;
(async () => {
  const fichier = path.join(SORTIE, 'manifeste.json');
  const manifeste = fs.existsSync(fichier) ? JSON.parse(fs.readFileSync(fichier, 'utf8')) : {};
  const nav = await chromium.launch(); let n = 0; const manques = [];
  for (const c of CAT.CAPSULES.filter((x) => x.pret && (!CODES.length || CODES.includes(x.code)))) {
    manifeste[c.code] = manifeste[c.code] || {};
    for (const L of ['fr', 'en']) {
      const ctx = await nav.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1.5, colorScheme: 'light', reducedMotion: 'reduce' }); const pg = await ctx.newPage();
      await pg.addInitScript((l) => { try { localStorage.setItem('arrimo-langue', l); } catch {} }, L);
      await pg.goto(BASE); await pg.fill('#c-email', c.compte); await pg.fill('#c-mdp', MDP); await pg.press('#c-mdp', 'Enter');
      await pg.waitForFunction(() => document.body.dataset.pret === '1' || (location.pathname === '/secours' && document.querySelector('#onglets-s button')) || (location.pathname === '/intervenant' && document.querySelector('#iv-contenu article, #iv-contenu .note')), null, { timeout: 30000 }); if (await pg.locator('#b-premiers-pas-ok').isVisible().catch(() => false)) await pg.click('#b-premiers-pas-ok');
      await pg.evaluate(() => { document.documentElement.dataset.theme = 'clair'; });
      fs.mkdirSync(path.join(SORTIE, c.code), { recursive: true });
      for (const [i, s] of c.scenes.entries()) {
        if (s.page) { if (new URL(pg.url()).pathname !== s.page) await pg.goto(BASE + s.page); await pg.waitForTimeout(1500); }
        else if (s.onglet) { await pg.evaluate((o) => document.querySelector(`#onglets-s [data-onglet="${o}"]`)?.click(), s.onglet); await pg.waitForTimeout(1600); }
        else { await pg.evaluate((v) => { const b = document.querySelector(`#onglets button[data-v="${v}"]`); if (b) b.click(); }, s.ecran); await pg.waitForTimeout(1600); }
        if (s.sous) { await pg.evaluate(([v, so]) => document.querySelector(`#v-${v} .module-sous-onglets [data-so="${so}"]`)?.click(), [s.ecran, s.sous]); await pg.waitForTimeout(400); }
        const r = await pg.evaluate((sel) => {
          const el = [...document.querySelectorAll(sel)].find((e) => { const b = e.getBoundingClientRect(); return b.width && b.height && getComputedStyle(e).visibility !== 'hidden'; });
          if (!el) return null; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect();
          return { x: b.left, y: b.top, w: b.width, h: b.height };
        }, s.cible);
        await pg.waitForTimeout(250);
        const r2 = r && await pg.evaluate((sel) => { const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width); const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, s.cible);
        await pg.screenshot({ path: path.join(SORTIE, c.code, `${i + 1}-${L}.jpg`), type: 'jpeg', quality: 80 });
        const pad = 6; const z = r2 && { x: Math.max(0, (r2.x - pad) / W * 100), y: Math.max(0, (r2.y - pad) / H * 100), w: Math.min(100, (r2.w + 2 * pad) / W * 100), h: Math.min(100, (r2.h + 2 * pad) / H * 100) };
        const arr = (v) => Math.round(v * 10) / 10;
        manifeste[c.code][i + 1] = { ...(manifeste[c.code][i + 1] || {}), [L]: z ? { x: arr(z.x), y: arr(z.y), w: arr(z.w), h: arr(z.h) } : null };
        if (!z) manques.push(`${c.code}.${i + 1}.${L} (${s.cible})`);
        n += 1;
      }
      await ctx.close();
    }
  }
  fs.writeFileSync(fichier, JSON.stringify(manifeste, null, 1));
  await nav.close();
  console.log(`${n} captures ; éléments non trouvés : ${manques.length ? manques.join(', ') : 'aucun'}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
