/**
 * Construit la présentation autonome (un seul fichier HTML, images incluses) et son PDF.
 *   node scripts/presentation.js      (après npm run test:interface, qui produit les captures)
 * Entrée : docs/presentation/source.html · Sortie : docs/presentation/arrimo-presentation.html et .pdf
 * Vérifie : 10 diapositives, rien ne dépasse d'une diapositive, aucune mention interdite.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const racine = path.join(__dirname, '..');
const dossier = path.join(racine, 'docs', 'presentation');
const CAPTURES = {
  copilote: 'captures/ordinateur/01-copilote-x.png',
  ailleurs: 'captures/ordinateur/04-chercher-ailleurs.png',
  transferts: 'captures/ordinateur/06-transferts-x.png',
  nettoyage: 'captures/tablette/07-nettoyage-entretien.png',
};

(async () => {
  let html = fs.readFileSync(path.join(dossier, 'source.html'), 'utf8');
  const logo = fs.readFileSync(path.join(racine, 'public', 'logo.svg'), 'utf8').replace('<svg', '<svg width="34" height="34" aria-hidden="true"');
  html = html.split('{{logo}}').join(logo);
  // Vérifiée sur le texte, avant d'insérer les images (le base64 peut contenir n'importe quelle suite de lettres)
  if (/odoo|afrique/i.test(html)) throw new Error('Mention interdite dans la présentation.');
  html = html.replace(/\{\{img:(\w+)\}\}/g, (m, k) => {
    const f = path.join(racine, CAPTURES[k]);
    if (!fs.existsSync(f)) throw new Error(`Capture manquante : ${CAPTURES[k]} (lancez d'abord npm run test:interface)`);
    return `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
  });
  const sortie = path.join(dossier, 'arrimo-presentation.html');
  fs.writeFileSync(sortie, html);

  const nav = await chromium.launch();
  const page = await nav.newPage({ viewport: { width: 1320, height: 800 } });
  await page.goto(`file://${sortie}`);
  const diapos = await page.$$eval('.diapo', (ds) => ds.map((d, i) => {
    const r = d.getBoundingClientRect();
    const hors = [...d.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && (b.bottom > r.bottom + 1 || b.right > r.right + 1); })
      .map((e) => `${e.tagName}.${e.className}`).slice(0, 3);
    return { n: i + 1, hors };
  }));
  if (diapos.length !== 10) throw new Error(`${diapos.length} diapositives au lieu de 10`);
  const probleme = diapos.filter((d) => d.hors.length);
  if (probleme.length) throw new Error(`Contenu qui dépasse : ${JSON.stringify(probleme)}`);
  for (let i = 0; i < diapos.length; i += 1) {
    await (await page.$$('.diapo'))[i].screenshot({ path: path.join(racine, 'captures', `presentation-${String(i + 1).padStart(2, '0')}.png`) });
  }
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: path.join(dossier, 'arrimo-presentation.pdf'), width: '1280px', height: '720px', printBackground: true });
  await nav.close();
  console.log(`Présentation : ${path.relative(racine, sortie)} (${Math.round(fs.statSync(sortie).size / 1024)} ko) et arrimo-presentation.pdf`);
})().catch((e) => { console.error(e.message); process.exit(1); });
