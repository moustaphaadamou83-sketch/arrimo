'use strict';
/**
 * Documents commerciaux en PDF : devis, contrat et facture (pdfkit, police Public Sans, charte Arrimo).
 * L'émetteur et ses numéros de taxes viennent de la configuration (SH_EMETTEUR_*) ; absents, le document l'indique.
 */
const path = require('path');
const PDFDocument = require('pdfkit');
const { traduire } = require('../../public-sh/i18n/localisation');

const C = { principal: '#0E5E6F', texte: '#1F2937', texte2: '#5B6B7F', bordure: '#E2E8F0', doux: '#EEF4F6' };
const POLICES = path.join(__dirname, 'polices');
const FUSEAU = process.env.SH_FUSEAU || 'America/Toronto';
const PERIODES = { unique: 'unique', mensuel: 'par mois', annuel: 'par année' };

const propre = (v) => String(v ?? '').replace(/[  ]/g, ' ');
const date = (d,langue='fr') => (d ? propre(new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString(langue==='en'?'en-CA':'fr-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: FUSEAU })) : '—');
const {formatterMontant}=require('../../public-sh/finances');
const argent = (n, devise = 'CAD') => propre(formatterMontant(n,devise,'fr-CA'));
const taux = (t) => propre(new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 3 }).format(t));

function emetteur(env = process.env) {
  return {
    nom: env.SH_EMETTEUR_NOM || 'Arrimo · SH',
    adresse: env.SH_EMETTEUR_ADRESSE || null,
    courriel: env.SH_EMETTEUR_COURRIEL || null,
    taxes: env.SH_EMETTEUR_TAXES || null,
  };
}

/**
 * @param {object} d { type: 'devis'|'contrat'|'facture', titre, reference, client, champs: [[k, v]], lignes, totaux, devise, mentions: [texte], signatures }
 * @returns {Promise<Buffer>}
 */
function documentCommercial(d, env = process.env) {
  const langue=env.SH_DOCUMENT_LANGUE==='en'?'en':'fr';
  const libelle=s=>traduire(s,langue);
  const montant=(n,devise)=>propre(formatterMontant(n,devise,langue==='en'?'en-CA':'fr-CA'));
  const em = emetteur(env);
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 60, left: 54, right: 54 }, bufferPages: true,
    info: { Title: `${libelle(d.titre)} ${d.reference}`, Author: em.nom, Subject: libelle(d.titre), Producer: 'Arrimo' } });
  doc.registerFont('normal', path.join(POLICES, 'public-sans-latin-400-normal.woff'));
  doc.registerFont('gras', path.join(POLICES, 'public-sans-latin-700-normal.woff'));
  const morceaux = [];
  doc.on('data', (b) => morceaux.push(b));
  const fini = new Promise((ok) => doc.on('end', () => ok(Buffer.concat(morceaux))));
  const L = doc.page.width - 108; const x0 = 54;
  const place = (h0) => { if (doc.y + h0 > doc.page.height - 76) doc.addPage(); };

  doc.rect(0, 0, doc.page.width, 92).fill(C.principal);
  doc.font('gras').fontSize(20).fillColor('#FFFFFF').text(propre(libelle(d.titre)), x0, 28);
  doc.font('normal').fontSize(10).fillColor('#D7ECEF').text(`${propre(d.reference)} · ${propre(em.nom)}`, x0, 56);

  doc.y = 112;
  const yBloc = doc.y;
  doc.font('gras').fontSize(9).fillColor(C.texte2).text(libelle('ÉMETTEUR'), x0, yBloc);
  doc.font('normal').fontSize(10).fillColor(C.texte).text([em.nom, em.adresse, em.courriel].filter(Boolean).map(propre).join('\n'), x0, doc.y + 2, { width: L / 2 - 10 });
  doc.font('normal').fontSize(8.5).fillColor(C.texte2).text(libelle(em.taxes ? `Numéros de taxes : ${propre(em.taxes)}` : 'Numéros de taxes de l’émetteur : à compléter dans la configuration.'), x0, doc.y + 2, { width: L / 2 - 10 });
  const yGauche = doc.y;
  doc.font('gras').fontSize(9).fillColor(C.texte2).text('CLIENT', x0 + L / 2 + 10, yBloc);
  doc.font('normal').fontSize(10).fillColor(C.texte).text([d.client.nom, d.client.adresse, [d.client.ville, d.client.region].filter(Boolean).join(', '), d.client.courriel].filter(Boolean).map(propre).join('\n'),
    x0 + L / 2 + 10, doc.y + 2, { width: L / 2 - 10 });
  doc.y = Math.max(yGauche, doc.y) + 14;

  for (const [k, v] of d.champs || []) {
    place(16);
    const y = doc.y;
    doc.font('normal').fontSize(9).fillColor(C.texte2).text(propre(libelle(k)), x0, y, { width: 150 });
    doc.font('normal').fontSize(10).fillColor(C.texte).text(propre(libelle(v ?? '—')), x0 + 155, y, { width: L - 155 });
    doc.y = Math.max(doc.y, y + 14);
  }
  doc.moveDown(0.8);

  if (d.lignes?.length) {
    const cols = [{ t: 'Description', l: 0.42 }, { t: 'Périodicité', l: 0.13 }, { t: 'Qté', l: 0.08, a: 'right' }, { t: 'Prix unitaire', l: 0.14, a: 'right' }, { t: 'Remise', l: 0.09, a: 'right' }, { t: 'Montant', l: 0.14, a: 'right' }];
    const largeurs = cols.map((c) => c.l * L);
    const entete = () => {
      place(30); const y = doc.y; doc.rect(x0, y, L, 18).fill(C.doux); let x = x0;
      cols.forEach((c, i) => { doc.font('gras').fontSize(7.5).fillColor(C.texte2).text(libelle(c.t).toUpperCase(), x + 4, y + 5, { width: largeurs[i] - 8, align: c.a || 'left' }); x += largeurs[i]; });
      doc.y = y + 20;
    };
    entete();
    for (const l of d.lignes) {
      const vals = [l.description, libelle(PERIODES[l.periodicite] || l.periodicite), String(l.quantite), montant(l.prix_unitaire, d.devise), l.remise_pct ? `${taux(l.remise_pct)} %` : '—', montant(l.montant, d.devise)];
      const h = Math.max(...vals.map((v, i) => doc.font('normal').fontSize(9).heightOfString(propre(v), { width: largeurs[i] - 8 }))) + 8;
      if (doc.y + h > doc.page.height - 76) { doc.addPage(); entete(); }
      const y = doc.y; let x = x0;
      vals.forEach((v, i) => { doc.font('normal').fontSize(9).fillColor(C.texte).text(propre(v), x + 4, y + 4, { width: largeurs[i] - 8, align: cols[i].a || 'left' }); x += largeurs[i]; });
      doc.moveTo(x0, y + h).lineTo(x0 + L, y + h).lineWidth(0.5).strokeColor(C.bordure).stroke();
      doc.y = y + h + 1;
    }
  }
  if (d.totaux) {
    doc.moveDown(0.6);
    const lignesTot = [['Sous-total', montant(d.totaux.sous_total, d.devise)], ...(d.totaux.taxes || []).map((t) => [`${t.nom} (${taux(t.taux)} %)`, montant(t.montant, d.devise)])];
    if (!(d.totaux.taxes || []).length) lignesTot.push(['Taxes', 'aucune taxe applicable']);
    lignesTot.push(['Total', montant(d.totaux.total, d.devise)]);
    if (d.totaux.paye != null) lignesTot.push(['Payé', montant(d.totaux.paye, d.devise)], ['Solde dû', montant(d.totaux.solde, d.devise)]);
    for (const [k, v] of lignesTot) {
      place(16); const y = doc.y; const gras = k === 'Total' || k === 'Solde dû';
      doc.font(gras ? 'gras' : 'normal').fontSize(gras ? 10.5 : 9.5).fillColor(C.texte).text(propre(libelle(k)), x0 + L * 0.5, y, { width: L * 0.3 });
      doc.font(gras ? 'gras' : 'normal').fontSize(gras ? 10.5 : 9.5).text(propre(libelle(v)), x0 + L * 0.8, y, { width: L * 0.2, align: 'right' });
      doc.y = y + 15;
    }
    // Provenance de chaque taux figée sur le document : source, période d'effet et date de vérification.
    const sources = (d.totaux.taxes || []).filter((t) => t.source_nom);
    if (sources.length) {
      place(20 + sources.length * 24); doc.moveDown(0.4);
      doc.font('gras').fontSize(8.5).fillColor(C.texte2).text(propre(libelle('Provenance fiscale')), x0, doc.y, { width: L });
      for (const t of sources) {
        const periode = `${libelle('en vigueur du')} ${date(t.valide_de)}${t.valide_jusqua ? ` ${libelle('au')} ${date(t.valide_jusqua)}` : ` (${libelle('sans échéance')})`}`;
        doc.font('normal').fontSize(8).fillColor(C.texte2).text(propre(`${t.nom} ${taux(t.taux)} % · ${t.source_nom} · ${periode} · ${libelle('vérifié le')} ${date(t.verifie_le)} · ${t.source_url || ''}`), x0, doc.y, { width: L });
      }
    }
  }
  for (const m of d.mentions || []) { place(30); doc.moveDown(0.5); doc.font('normal').fontSize(8.5).fillColor(C.texte2).text(propre(libelle(m)), x0, doc.y, { width: L }); }
  if (d.signatures) {
    place(90); doc.moveDown(2); const y = doc.y + 30;
    [['Pour l’émetteur', x0], ['Pour le client', x0 + L / 2 + 10]].forEach(([t, x]) => {
      doc.moveTo(x, y).lineTo(x + L / 2 - 20, y).lineWidth(0.8).strokeColor(C.texte2).stroke();
      doc.font('normal').fontSize(8.5).fillColor(C.texte2).text(`${libelle(t)} : ${libelle('nom, signature et date')}`, x, y + 4);
    });
  }
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(i);
    const marge = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    const y = doc.page.height - 40;
    doc.font('normal').fontSize(8).fillColor(C.texte2)
      .text(`${propre(libelle(d.titre))} ${propre(d.reference)} · ${propre(em.nom)} · ${libelle('aucune donnée de patient')}`, x0, y, { width: L * 0.75, lineBreak: false })
      .text(`Page ${i + 1} / ${pages.count}`, x0 + L * 0.75, y, { width: L * 0.25, align: 'right', lineBreak: false });
    doc.page.margins.bottom = marge;
  }
  doc.end();
  return fini;
}

module.exports = { documentCommercial, date, argent };
