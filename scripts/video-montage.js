/**
 * Montage de la vidéo de démonstration : écrans titres, sous-titres incrustés, séquences, MP4 H.264.
 *   FFMPEG=/chemin/ffmpeg node scripts/video-montage.js <dossier des séquences> <sortie.mp4>
 * Les sous-titres et les écrans titres sont des images rendues dans la police de l'interface (Public Sans),
 * aux couleurs de la charte, puis incrustées par ffmpeg. Pas de musique, pas de voix.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const [dossier, sortie] = process.argv.slice(2);
const { langue, sequences, etapes } = JSON.parse(fs.readFileSync(path.join(dossier, 'etapes.json'), 'utf8'));
const RACINE = path.join(__dirname, '..');
const logo = fs.readFileSync(path.join(RACINE, 'public', 'logo.svg'), 'utf8');
const POLICE = `@font-face { font-family: "Public Sans"; font-weight: 100 900; src: url("file://${path.join(RACINE, 'public', 'polices', 'public-sans-latin-wght-normal.woff2')}") format("woff2"); }
  @font-face { font-family: "Public Sans"; font-weight: 100 900; unicode-range: U+0100-02AF; src: url("file://${path.join(RACINE, 'public', 'polices', 'public-sans-latin-ext-wght-normal.woff2')}") format("woff2"); }`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ff = (args) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart'];

(async () => {
  const travail = path.join(dossier, 'montage');
  fs.mkdirSync(travail, { recursive: true });
  const nav = await chromium.launch();
  const page = await nav.newPage({ viewport: { width: 1920, height: 1080 } });
  const rendre = async (html, fichier, transparent) => {
    const f = path.join(travail, `${fichier}.html`);
    fs.writeFileSync(f, `<!doctype html><meta charset="utf-8"><style>${POLICE} html,body{margin:0;width:1920px;height:1080px;font-family:"Public Sans",sans-serif;-webkit-font-smoothing:antialiased}
      body{background:${transparent ? 'transparent' : 'linear-gradient(160deg,#0E5E6F,#159895)'}}</style>${html}`);
    await page.goto(`file://${f}`);
    await page.evaluate(() => document.fonts.ready);
    const png = path.join(travail, `${fichier}.png`);
    await page.screenshot({ path: png, omitBackground: transparent });
    return png;
  };
  // Écrans titres (3 s)
  const carte = (texte, sous) => `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;color:#fff;text-align:center">
    <div style="width:180px;height:180px">${logo.replace('<svg ', '<svg width="180" height="180" ')}</div>
    <div style="font-size:104px;font-weight:700;letter-spacing:-.02em">${esc(texte)}</div>
    <div style="font-size:44px;font-weight:500;color:#E6F4F6;max-width:1500px">${esc(sous)}</div></div>`;
  const debut = await rendre(carte('Arrimo', langue === 'en' ? 'The right bed, for the right patient, at the right time' : 'Le bon lit, pour le bon patient, au bon moment'), 'titre-debut');
  const fin = await rendre(carte('Arrimo', 'senseafri61@gmail.com'), 'titre-fin');
  // Sous-titres : bandeau en bas, couleurs de la charte
  const soustitre = (texte) => `<div style="position:absolute;left:0;right:0;bottom:64px;display:flex;justify-content:center">
    <div style="max-width:1560px;background:rgba(14,94,111,.95);color:#fff;font-size:42px;font-weight:600;line-height:1.3;padding:20px 44px;border-radius:18px;
      border-left:10px solid #57C5B6;box-shadow:0 10px 30px rgba(0,0,0,.25);text-align:center">${esc(texte)}</div></div>`;
  for (const [i, e] of etapes.entries()) e.png = await rendre(soustitre(e.texte), `st-${i}`, true);
  await nav.close();

  const morceaux = [];
  const carteVideo = (png, nom) => {
    const f = path.join(travail, `${nom}.mp4`);
    ff(['-loop', '1', '-t', '3', '-i', png, '-vf', 'fade=t=in:st=0:d=0.5,fade=t=out:st=2.5:d=0.5,format=yuv420p', ...ENC, f]);
    return f;
  };
  morceaux.push(carteVideo(debut, 'debut'));
  for (const s of sequences) {
    const sts = etapes.filter((e) => e.sequence === s.nom);
    const duree = s.fin - s.debut;
    // Tablette : l'écran est posé au centre d'un cadre ; ordinateur : plein écran
    let base = s.largeur === 1920 ? '[0:v]setpts=PTS-STARTPTS,fps=30' : '[0:v]setpts=PTS-STARTPTS,fps=30,scale=-2:860,pad=iw+36:ih+36:18:18:color=0x1F2937,pad=1920:1080:(ow-iw)/2:20:color=0xF5F8FA';
    base += `,fade=t=in:st=0:d=0.4,fade=t=out:st=${(duree - 0.5).toFixed(2)}:d=0.5[v0]`;
    const filtres = [base];
    // Un sous-titre commence quand le curseur part ; l'écran change au clic, environ 1,6 s plus tard
    const DECALAGE = 1.6;
    // Le tout premier sous-titre décrit l'écran d'ouverture ; les autres séquences commencent par un clic sur un onglet
    const premiere = s === sequences[0];
    const debutDe = (k) => (k === 0 && premiere ? 0 : Math.min(duree, Math.max(0, sts[k].debut - s.debut) + DECALAGE));
    sts.forEach((e, k) => {
      const a = debutDe(k); const b = k + 1 < sts.length ? debutDe(k + 1) : duree;
      filtres.push(`[v${k}][${k + 1}:v]overlay=0:0:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'[v${k + 1}]`);
    });
    const f = path.join(travail, `${s.nom}.mp4`);
    ff(['-ss', s.debut.toFixed(2), '-t', duree.toFixed(2), '-i', s.video, ...sts.flatMap((e) => ['-i', e.png]),
      '-filter_complex', filtres.join(';'), '-map', `[v${sts.length}]`, ...ENC, f]);
    morceaux.push(f);
  }
  morceaux.push(carteVideo(fin, 'fin'));
  const liste = path.join(travail, 'liste.txt');
  fs.writeFileSync(liste, morceaux.map((m) => `file '${m}'`).join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', liste, '-c', 'copy', '-movflags', '+faststart', sortie]);
  console.log(`Vidéo : ${sortie}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
