/**
 * Rapport de go-live (PDF, pdfkit, licence MIT ; police Public Sans, licence OFL).
 * Établissement, dates des 7 étapes, imports, comptes créés (sans mot de passe), formation, responsables et signatures.
 * Aucune donnée de patient : le rapport ne contient que la structure, les comptes et le suivi du projet.
 */
const path = require('path');
const PDFDocument = require('pdfkit');

const C = { principal: '#0E5E6F', secondaire: '#159895', texte: '#1F2937', texte2: '#5B6B7F', bordure: '#E2E8F0', doux: '#EEF4F6' };
const POLICES = path.join(__dirname, 'polices');
const FUSEAU = process.env.SH_FUSEAU || 'America/Toronto';
const ENVS = { demo: 'Démonstration', recette: 'Recette', production: 'Production' };
const TYPES = { unites: 'Unités', chambres: 'Chambres', lits: 'Lits', civieres: 'Civières', utilisateurs: 'Comptes' };
const ROLES = { coordonnateur: 'Coordination', entretien: 'Entretien', admin_etab: 'Administration', gestionnaire: 'Gestion du réseau' };

// Espaces fines insécables de la mise en forme française : remplacées par des espaces insécables, présentes dans la police
const propre = (v) => String(v ?? '').replace(/ /g, ' ');
const date = (d) => (d ? propre(new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: FUSEAU })) : '—');
const dateHeure = (d) => (d ? propre(new Date(d).toLocaleString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: FUSEAU })) : '—');
const nb = (n) => propre(new Intl.NumberFormat('fr-CA').format(n ?? 0));

/**
 * @param {object} r { hopital, etapes, imports, activations, comptes (ou null si l'environnement ne répond pas), formation, genere_par }
 * @returns {Promise<Buffer>}
 */
function rapportGolive(r) {
  const h = r.hopital;
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 54, left: 54, right: 54 }, bufferPages: true,
    info: { Title: `Rapport de go-live · ${h.nom}`, Author: 'Arrimo · Console SH', Subject: 'Rapport de go-live', Producer: 'Arrimo' } });
  doc.registerFont('normal', path.join(POLICES, 'public-sans-latin-400-normal.woff'));
  doc.registerFont('gras', path.join(POLICES, 'public-sans-latin-700-normal.woff'));
  const morceaux = [];
  doc.on('data', (b) => morceaux.push(b));
  const fini = new Promise((ok) => doc.on('end', () => ok(Buffer.concat(morceaux))));
  const L = doc.page.width - 108;
  const x0 = 54;

  const place = (h0) => { if (doc.y + h0 > doc.page.height - 70) doc.addPage(); };
  const titre = (t) => {
    place(60);
    doc.moveDown(0.8);
    doc.font('gras').fontSize(13).fillColor(C.principal).text(t, x0, doc.y);
    doc.moveTo(x0, doc.y + 3).lineTo(x0 + L, doc.y + 3).lineWidth(1).strokeColor(C.bordure).stroke();
    doc.moveDown(0.6);
  };
  const champs = (paires) => {
    for (const [k, v] of paires) {
      place(18);
      const y = doc.y;
      doc.font('normal').fontSize(9).fillColor(C.texte2).text(k, x0, y, { width: 150 });
      doc.font('normal').fontSize(10).fillColor(C.texte).text(propre(v || '—'), x0 + 155, y, { width: L - 155 });
      doc.y = Math.max(doc.y, y + 14);
    }
  };
  /** Tableau simple : en-tête en capitales, lignes séparées, saut de page avec répétition de l'en-tête. */
  const tableau = (colonnes, lignes, vide = 'Aucun.') => {
    const largeurs = colonnes.map((c) => c.l * L);
    const entete = () => {
      place(40);
      const y = doc.y;
      // Hauteur selon le libellé le plus long (sur deux lignes au besoin)
      const h0 = Math.max(...colonnes.map((c, i) => doc.font('gras').fontSize(7.5).heightOfString(c.t.toUpperCase(), { width: largeurs[i] - 8, characterSpacing: 0.4 }))) + 10;
      doc.rect(x0, y, L, h0).fill(C.doux);
      let x = x0;
      colonnes.forEach((c, i) => { doc.font('gras').fontSize(7.5).fillColor(C.texte2).text(c.t.toUpperCase(), x + 4, y + 5, { width: largeurs[i] - 8, characterSpacing: 0.4 }); x += largeurs[i]; });
      doc.y = y + h0 + 2;
    };
    if (!lignes.length) { place(16); doc.font('normal').fontSize(9.5).fillColor(C.texte2).text(vide, x0, doc.y); doc.moveDown(0.3); return; }
    entete();
    for (const ligne of lignes) {
      const hauteur = Math.max(...ligne.map((v, i) => doc.font('normal').fontSize(9).heightOfString(propre(v), { width: largeurs[i] - 8 }))) + 8;
      if (doc.y + hauteur > doc.page.height - 70) { doc.addPage(); entete(); }
      const y = doc.y;
      let x = x0;
      ligne.forEach((v, i) => { doc.font('normal').fontSize(9).fillColor(C.texte).text(propre(v), x + 4, y + 4, { width: largeurs[i] - 8 }); x += largeurs[i]; });
      doc.moveTo(x0, y + hauteur).lineTo(x0 + L, y + hauteur).lineWidth(0.5).strokeColor(C.bordure).stroke();
      doc.y = y + hauteur + 1;
    }
  };

  // En-tête
  doc.rect(0, 0, doc.page.width, 92).fill(C.principal);
  doc.font('gras').fontSize(20).fillColor('#FFFFFF').text('Rapport de go-live', x0, 30);
  doc.font('normal').fontSize(10).fillColor('#D7ECEF').text(`Arrimo · ${propre(h.nom)} · généré le ${dateHeure(new Date())}`, x0, 58);
  doc.y = 116;

  titre('Établissement');
  const activation = (r.activations || []).find((a) => a.action === 'activation');
  champs([
    ['Hôpital', h.nom], ['Code d’établissement', h.code_etab], ['Adresse', [h.adresse, h.ville].filter(Boolean).join(', ')],
    ['Environnement', ENVS[h.environnement]], ['Lien d’accès', h.lien], ['Contact à l’hôpital', [h.contact_nom, h.contact_courriel, h.contact_telephone].filter(Boolean).join(' · ')],
    ['Go-live', h.golive_le ? `${dateHeure(h.golive_le)} · ${h.golive_par}` : 'pas encore fait'],
    ['Module activé', activation ? `${dateHeure(activation.quand)} · ${activation.par}` : 'pas encore activé'],
  ]);

  titre('Les 7 étapes de l’implantation');
  tableau([{ t: 'Étape', l: 0.26 }, { t: 'Prévue', l: 0.18 }, { t: 'Réelle', l: 0.18 }, { t: 'Responsable', l: 0.24 }, { t: 'Cochés', l: 0.14 }],
    r.etapes.map((e) => [`${e.rang}. ${e.nom}`, date(e.date_prevue), date(e.date_reelle), e.responsable || '—',
      `${e.verifications.filter((v) => v.faite).length} / ${e.verifications.length}`]));

  titre('Imports');
  tableau([{ t: 'Date', l: 0.2 }, { t: 'Environnement', l: 0.17 }, { t: 'Fichier', l: 0.12 }, { t: 'Lignes', l: 0.09 }, { t: 'Créations', l: 0.12 }, { t: 'Mises à jour', l: 0.13 }, { t: 'Par', l: 0.17 }],
    [...r.imports].reverse().map((i) => [dateHeure(i.quand), ENVS[i.environnement] || '—', TYPES[i.type] || i.type, nb(i.lignes), nb(i.creations), nb(i.mises_a_jour), i.auteur]),
    'Aucun import.');

  titre('Comptes de l’établissement (sans mot de passe)');
  if (r.comptes == null) {
    doc.font('normal').fontSize(9.5).fillColor(C.texte2).text('L’environnement ne répond pas : liste des comptes indisponible.', x0, doc.y);
  } else {
    tableau([{ t: 'Nom', l: 0.28 }, { t: 'Courriel', l: 0.36 }, { t: 'Rôle', l: 0.18 }, { t: 'Mot de passe', l: 0.18 }],
      r.comptes.map((c) => [c.nom, c.courriel, ROLES[c.role] || c.role, c.mdp_temporaire ? 'temporaire, à changer' : 'choisi par la personne']), 'Aucun compte.');
    doc.font('normal').fontSize(8.5).fillColor(C.texte2).text('Les mots de passe temporaires ne figurent jamais dans ce rapport : ils ont été remis une seule fois, par un moyen sûr.', x0, doc.y + 2, { width: L });
  }

  titre('Formation');
  for (const f of r.formation) {
    place(50);
    const faits = f.elements.filter((e) => e.faite).length;
    doc.font('gras').fontSize(10.5).fillColor(C.texte).text(`${f.nom} · ${faits} / ${f.elements.length}`, x0, doc.y);
    doc.font('normal').fontSize(9).fillColor(C.texte2)
      .text(`Séance : ${date(f.seance_le)} · formateur : ${propre(f.formateur || '—')} · personnes formées : ${f.personnes == null ? '—' : nb(f.personnes)}`, x0, doc.y + 1);
    doc.moveDown(0.2);
    for (const e of f.elements) {
      place(14);
      // Case dessinée (pleine si l'élément est coché) : pas de symbole hors de la police
      const y = doc.y;
      doc.rect(x0 + 8, y + 2, 7, 7).lineWidth(0.8).strokeColor(C.principal);
      if (e.faite) doc.fillAndStroke(C.principal, C.principal); else doc.stroke();
      doc.font('normal').fontSize(9).fillColor(C.texte).text(`${propre(e.libelle)}${e.faite ? ` · ${propre(e.par)}, ${dateHeure(e.quand)}` : ' · à faire'}`, x0 + 22, y, { width: L - 22 });
    }
    doc.moveDown(0.5);
  }

  titre('Responsables');
  champs([['Responsable SH du go-live', h.golive_par || r.genere_par], ['Responsable à l’hôpital', h.contact_nom]]);
  place(90);
  doc.moveDown(1.5);
  const ySig = doc.y + 30;
  [['Pour SH', x0], ['Pour l’hôpital', x0 + L / 2 + 10]].forEach(([t, x]) => {
    doc.moveTo(x, ySig).lineTo(x + L / 2 - 20, ySig).lineWidth(0.8).strokeColor(C.texte2).stroke();
    doc.font('normal').fontSize(8.5).fillColor(C.texte2).text(`${t} : signature et date`, x, ySig + 4);
  });

  // Pied de page sur chaque page
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(i);
    // Le pied est sous la marge du bas : marge levée le temps de l'écrire, sinon pdfkit ajouterait une page
    const marge = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 40;
    doc.font('normal').fontSize(8).fillColor(C.texte2)
      .text(`Arrimo · Rapport de go-live · ${propre(h.nom)} · aucune donnée de patient`, x0, y, { width: L * 0.75, lineBreak: false })
      .text(`Page ${i + 1} / ${pages.count}`, x0 + L * 0.75, y, { width: L * 0.25, align: 'right', lineBreak: false });
    doc.page.margins.bottom = marge;
  }
  doc.end();
  return fini;
}

module.exports = { rapportGolive };
