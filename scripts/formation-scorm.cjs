/* Module Formation, lot 8 (22 nov. 2026) : export SCORM 1.2 d'un parcours, PRÉPARÉ, NON ACTIVÉ (aucune route ; script seulement).
   Chaque capsule devient un objet SCO qui ouvre la capsule dans Arrimo (/formation#capsule/CODE) ; la plateforme de l'établissement
   reçoit « terminé » quand la personne revient. Usage : node scripts/formation-scorm.cjs <parcours> <fr|en> <url Arrimo> <fichier.zip> */
const fs = require('fs');
const { zip } = require('../src/zip');
const CAT = require('../src/formation-catalogue');
const [code, langue = 'fr', base = 'https://arrimo.example', sortie] = process.argv.slice(2);
const p = CAT.parcours(code); if (!p || !sortie) { console.error('Usage : <parcours> <fr|en> <url Arrimo> <fichier.zip>'); process.exit(2); }
const L = langue === 'en' ? 'en' : 'fr';
const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const caps = p.capsules.map(CAT.capsule).filter((c) => c.pret);
const manifeste = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="arrimo-${p.code}" version="1.2" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="arrimo"><organization identifier="arrimo"><title>${esc(`Arrimo · ${p.nom[L]}`)}</title>
${caps.map((c) => `    <item identifier="I-${c.code}" identifierref="R-${c.code}"><title>${esc(`${c.code} · ${c.titre[L]}`)}</title></item>`).join('\n')}
  </organization></organizations>
  <resources>
${caps.map((c) => `    <resource identifier="R-${c.code}" type="webcontent" adlcp:scormtype="sco" href="${c.code}.html"><file href="${c.code}.html"/></resource>`).join('\n')}
  </resources>
</manifest>`;
const sco = (c) => `<!doctype html><html lang="${L}"><meta charset="utf-8"><title>${esc(c.titre[L])}</title>
<script>var api=null;for(var w=window;w&&!api;w=w.parent===w?null:w.parent){api=w.API||null}if(api){api.LMSInitialize('');}
function fini(){if(api){api.LMSSetValue('cmi.core.lesson_status','completed');api.LMSCommit('');api.LMSFinish('');}}</script>
<body style="font-family:system-ui;padding:24px"><h1>${esc(c.titre[L])}</h1><p>${esc(c.objectif[L])}</p>
<p><a href="${esc(base)}/formation#capsule/${c.code}" target="_blank" rel="noopener">${L === 'en' ? 'Open the lesson in Arrimo' : 'Ouvrir la capsule dans Arrimo'}</a></p>
<p><button onclick="fini()">${L === 'en' ? 'I have finished this lesson' : 'J’ai terminé cette capsule'}</button></p></body></html>`;
const fichiers = [{ nom: 'imsmanifest.xml', contenu: Buffer.from(manifeste) }, ...caps.map((c) => ({ nom: `${c.code}.html`, contenu: Buffer.from(sco(c)) }))];
fs.writeFileSync(sortie, zip(Object.fromEntries(fichiers.map((f) => [f.nom, f.contenu]))));
console.log(`SCORM 1.2 : ${caps.length} capsules → ${sortie} (non publié ; à activer plus tard)`);
