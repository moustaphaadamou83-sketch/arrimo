'use strict';
/**
 * Module 🎓 Formation — lot 5 (22 nov. 2026) : attestation PDF par parcours réussi (FR/EN), satisfaction en fin de parcours,
 * superutilisateurs par établissement (reçoivent les questions en premier), tableau du formateur (vu, pratiqué, réussi, besoin d'aide ;
 * par personne, rôle et module ; CSV). Aucune donnée de patient.
 */
const PDFDocument = require('pdfkit');
const { ErreurHttp } = require('./db');
const CAT = require('./formation-catalogue');
const fp = require('./formation-parcours');

const L = (l) => (l === 'en' ? 'en' : 'fr');
const T = {
  fr: { titre: 'Attestation de formation', delivre: 'Arrimo atteste que', reussi: 'a réussi le parcours', le: 'le', numero: 'Numéro', capsules: 'Capsules réussies', role: 'Rôle',
    note: 'Formation sur données fictives. Chaque capsule : vidéo, exercice guidé noté et mini-test.', non: 'Parcours non terminé.' },
  en: { titre: 'Training certificate', delivre: 'Arrimo certifies that', reussi: 'has completed the path', le: 'on', numero: 'Number', capsules: 'Lessons passed', role: 'Role',
    note: 'Training on fictitious data. Each lesson: video, graded guided exercise and quick test.', non: 'Path not completed.' },
};

/** Le parcours est-il terminé pour cette personne ? (toutes ses capsules prêtes et visibles réussies) */
async function parcoursTermine(pool, u, code, langue) {
  const m = await fp.moi(pool, u, langue);
  if (!m.actif) throw new ErreurHttp(403, 'module_desactive', { module: 'formation' });
  const p = m.parcours.find((x) => x.code === code);
  if (!p) throw new ErreurHttp(404, 'objet_introuvable');
  return { p, termine: p.total > 0 && p.reussies === p.total };
}

async function attestation(pool, u, code, langue) {
  const l = L(langue); const { p, termine } = await parcoursTermine(pool, u, code, l);
  if (!termine) throw new ErreurHttp(409, 'parametre_invalide', { nom: 'parcours' });
  let a = (await pool.query('SELECT * FROM formation_attestations WHERE utilisateur_id = $1 AND parcours = $2', [u.id, code])).rows[0];
  if (!a) {
    const n = (await pool.query("SELECT nextval('formation_attestation_seq') AS n")).rows[0].n;
    a = (await pool.query('INSERT INTO formation_attestations (numero, utilisateur_id, parcours) VALUES ($1, $2, $3) ON CONFLICT (utilisateur_id, parcours) DO UPDATE SET parcours = EXCLUDED.parcours RETURNING *',
      [`AT-${String(n).padStart(6, '0')}`, u.id, code])).rows[0];
  }
  const nom = (await pool.query('SELECT nom FROM utilisateurs WHERE id = $1', [u.id])).rows[0]?.nom || '';
  const t = T[l]; const date = new Date(a.emise_le).toLocaleDateString(l === 'en' ? 'en-CA' : 'fr-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Toronto' });
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 50, info: { Title: `${t.titre} · ${p.nom}`, Author: 'Arrimo' } });
  const morceaux = []; doc.on('data', (d) => morceaux.push(d));
  const fin = new Promise((ok) => doc.on('end', ok));
  const W = doc.page.width; const H = doc.page.height;
  doc.rect(0, 0, W, H).fill('#F5F8FA');
  doc.rect(0, 0, W, 90).fill('#0E5E6F'); doc.rect(0, 86, W, 4).fill('#57C5B6');
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(26).text('Arrimo', 50, 32);
  doc.font('Helvetica').fontSize(13).text(t.titre, 50, 38, { align: 'right', width: W - 100 });
  doc.fillColor('#64748B').fontSize(14).text(t.delivre, 50, 150, { align: 'center', width: W - 100 });
  doc.fillColor('#1F2937').font('Helvetica-Bold').fontSize(34).text(nom, 50, 180, { align: 'center', width: W - 100 });
  doc.fillColor('#64748B').font('Helvetica').fontSize(14).text(t.reussi, 50, 240, { align: 'center', width: W - 100 });
  doc.fillColor('#0E5E6F').font('Helvetica-Bold').fontSize(26).text(p.nom, 50, 268, { align: 'center', width: W - 100 });
  doc.fillColor('#1F2937').font('Helvetica').fontSize(13).text(`${t.le} ${date} · ${t.capsules} : ${p.reussies}/${p.total} · ${t.numero} : ${a.numero}`, 50, 320, { align: 'center', width: W - 100 });
  doc.moveTo(W / 2 - 120, 380).lineTo(W / 2 + 120, 380).strokeColor('#159895').lineWidth(2).stroke();
  doc.fillColor('#64748B').fontSize(10).text(t.note, 50, H - 70, { align: 'center', width: W - 100 });
  doc.end(); await fin;
  return { pdf: Buffer.concat(morceaux), nom_fichier: `${a.numero}-${code}.pdf` };
}

async function satisfaction(pool, u, code, b = {}) {
  const { termine } = await parcoursTermine(pool, u, code, 'fr');
  if (!termine) throw new ErreurHttp(409, 'parametre_invalide', { nom: 'parcours' });
  const note = Number(b.note); const com = b.commentaire == null ? null : String(b.commentaire).trim().slice(0, 500) || null;
  if (!Number.isInteger(note) || note < 1 || note > 5) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'note' });
  await pool.query(`INSERT INTO formation_satisfaction (utilisateur_id, parcours, note, commentaire) VALUES ($1, $2, $3, $4)
    ON CONFLICT (utilisateur_id, parcours) DO UPDATE SET note = EXCLUDED.note, commentaire = EXCLUDED.commentaire, cree_le = now()`, [u.id, code, note, com]);
  return { ok: true };
}

/** Personnes habilitées au suivi d'un établissement : administrateur, gestionnaire, superutilisateur désigné. */
async function exigerSuivi(pool, u, etabId) {
  const id = Number(etabId);
  if (!Number.isSafeInteger(id) || id < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  if (u.gestionnaire) return id;
  if (!(u.etabs || []).map(Number).includes(id)) throw new ErreurHttp(403, 'etab_interdit');
  if (u.role === 'admin_etab') return id;
  if ((await pool.query('SELECT 1 FROM formation_superutilisateurs WHERE etablissement_id = $1 AND utilisateur_id = $2', [id, u.id])).rowCount) return id;
  throw new ErreurHttp(403, 'role_insuffisant');
}

/** Tableau du formateur : chaque personne de l'établissement, ses parcours, vu / pratiqué / réussi, besoin d'aide ; par rôle et par module. */
async function suivi(pool, u, etabId, langue) {
  const l = L(langue); const id = await exigerSuivi(pool, u, etabId);
  const gens = (await pool.query(`SELECT u.id, u.nom, u.email, u.role, (SELECT array_agg(etablissement_id) FROM utilisateur_etablissements x WHERE x.utilisateur_id = u.id) AS etabs,
      EXISTS (SELECT 1 FROM formation_superutilisateurs s WHERE s.etablissement_id = $1 AND s.utilisateur_id = u.id) AS superutilisateur
    FROM utilisateurs u JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id AND ue.etablissement_id = $1 WHERE u.actif ORDER BY u.nom`, [id])).rows;
  const prog = (await pool.query('SELECT * FROM formation_progression WHERE utilisateur_id = ANY($1)', [gens.map((g) => g.id)])).rows;
  const echecs = (await pool.query(`SELECT utilisateur_id, capsule, count(*) FILTER (WHERE NOT reussi)::int ratees FROM formation_essais WHERE utilisateur_id = ANY($1) GROUP BY 1, 2`, [gens.map((g) => g.id)])).rows;
  const lignes = [];
  for (const g of gens) {
    const m = await fp.moi(pool, { id: g.id, role: g.role, etabs: g.etabs || [], gestionnaire: g.role === 'gestionnaire' }, l);
    const codes = new Set((m.parcours || []).flatMap((p) => p.capsules.filter((c) => c.etat !== 'preparation').map((c) => c.code)));
    const pr = prog.filter((x) => x.utilisateur_id === g.id && codes.has(x.capsule));
    const bloquees = echecs.filter((x) => x.utilisateur_id === g.id && x.ratees >= 2 && !pr.find((p) => p.capsule === x.capsule && p.reussi_le)).map((x) => x.capsule);
    const derniere = pr.reduce((d, x) => (x.maj_le > d ? x.maj_le : d), null);
    lignes.push({ id: g.id, nom: g.nom, role: g.role, superutilisateur: g.superutilisateur, parcours: (m.parcours || []).map((p) => p.nom),
      total: codes.size, vues: pr.filter((x) => x.vu_le).length, pratiquees: pr.filter((x) => x.pratique_le).length, reussies: pr.filter((x) => x.reussi_le).length,
      besoin_aide: bloquees.length > 0, capsules_bloquees: bloquees, derniere_activite: derniere });
  }
  // Par module : capsules réussies par l'équipe
  const parModule = {};
  for (const c of CAT.CAPSULES.filter((x) => x.pret)) {
    const mod = c.module || 'socle'; const k = parModule[mod] || (parModule[mod] = { module: mod, reussies: 0 });
    k.reussies += prog.filter((x) => x.capsule === c.code && x.reussi_le).length;
  }
  const parRole = {};
  for (const x of lignes) { const k = parRole[x.role] || (parRole[x.role] = { role: x.role, personnes: 0, reussies: 0, total: 0 }); k.personnes += 1; k.reussies += x.reussies; k.total += x.total; }
  const sat = (await pool.query('SELECT round(avg(note), 1)::float moyenne, count(*)::int n FROM formation_satisfaction WHERE utilisateur_id = ANY($1)', [gens.map((g) => g.id)])).rows[0];
  return { etablissement_id: id, personnes: lignes, par_role: Object.values(parRole), par_module: Object.values(parModule), satisfaction: sat };
}
function csv(s, langue) {
  const en = L(langue) === 'en'; const c = (v) => { const x = String(v ?? ''); return /[;"\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const tete = en ? ['Name', 'Role', 'Paths', 'Lessons', 'Watched', 'Practised', 'Passed', 'Needs help', 'Super-user', 'Last activity'] : ['Nom', 'Rôle', 'Parcours', 'Capsules', 'Vues', 'Pratiquées', 'Réussies', 'Besoin d’aide', 'Superutilisateur', 'Dernière activité'];
  const oui = en ? 'yes' : 'oui'; const non = en ? 'no' : 'non';
  const lignes = s.personnes.map((x) => [x.nom, x.role, x.parcours.join(' + '), x.total, x.vues, x.pratiquees, x.reussies, x.besoin_aide ? oui : non, x.superutilisateur ? oui : non, x.derniere_activite ? new Date(x.derniere_activite).toISOString().slice(0, 10) : ''].map(c).join(';'));
  return `﻿${[tete.join(';'), ...lignes].join('\r\n')}\r\n`;
}
async function designer(pool, u, b = {}) {
  const id = Number(b.etablissement_id);
  if (!u.gestionnaire && !(u.role === 'admin_etab' && (u.etabs || []).map(Number).includes(id))) throw new ErreurHttp(403, 'role_insuffisant');
  const cible = Number(b.utilisateur_id);
  if (!(await pool.query('SELECT 1 FROM utilisateur_etablissements WHERE utilisateur_id = $1 AND etablissement_id = $2', [cible, id])).rowCount) throw new ErreurHttp(404, 'objet_introuvable');
  if (b.actif) await pool.query('INSERT INTO formation_superutilisateurs (etablissement_id, utilisateur_id, designe_par) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, cible, u.id]);
  else await pool.query('DELETE FROM formation_superutilisateurs WHERE etablissement_id = $1 AND utilisateur_id = $2', [id, cible]);
  await pool.query("INSERT INTO journal_admin (utilisateur_id, etablissement_id, action, cible, detail) VALUES ($1, $2, 'Formation : superutilisateur', $3, $4)", [u.id, id, String(cible), b.actif ? 'désigné' : 'retiré']);
  return { ok: true };
}
/** Superutilisateurs de mes établissements : à qui poser une question en premier. */
async function mesSuperutilisateurs(pool, u) {
  if (!(u.etabs || []).length) return [];
  return (await pool.query(`SELECT DISTINCT u.nom, u.email FROM formation_superutilisateurs s JOIN utilisateurs u ON u.id = s.utilisateur_id AND u.actif
    WHERE s.etablissement_id = ANY($1) AND u.id <> $2 ORDER BY u.nom LIMIT 6`, [u.etabs.map(Number), u.id])).rows;
}
module.exports = { attestation, satisfaction, suivi, csv, designer, mesSuperutilisateurs };
