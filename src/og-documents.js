'use strict';
/**
 * Lecture de documents par OG (cahier OG §5.2 C, §5.3, §5.7) : moteur Tesseract local, aucun envoi externe.
 * - Image PNG ou JPEG de 5 Mo au plus, vérifiée par sa signature ; fichier temporaire privé supprimé aussitôt.
 * - Seuls le nom, le prénom et la date de naissance sont proposés ; tout champ douteux est marqué « à vérifier ».
 * - Le texte lu est une donnée non fiable : il n'est ni interprété comme une consigne ni renvoyé en entier.
 * - Le résultat ne fait que préremplir un brouillon patient : la création exige toujours la confirmation humaine.
 */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const { journaliser } = require('./regles');
const TAILLE_MAX = 5 * 1024 * 1024;
const TYPES = ['carte_assurance_maladie', 'piece_identite', 'formulaire_admission'];

function signature(octets) {
  if (octets.length > 8 && octets[0] === 0x89 && octets[1] === 0x50 && octets[2] === 0x4e && octets[3] === 0x47) return 'png';
  if (octets.length > 3 && octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) return 'jpg';
  return null;
}
function lireTesseract(fichier) {
  return new Promise((ok, ko) => execFile('tesseract', [fichier, 'stdout', '-l', 'fra+eng', '--psm', '6'],
    { timeout: 20000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, OMP_THREAD_LIMIT: '1' } },
    (e, sortie) => (e ? ko(e) : ok(String(sortie)))));
}
const nettoyer = (v) => String(v || '').replace(/[^\p{L}\p{M}' -]/gu, ' ').replace(/\s+/g, ' ').trim();
function date(v) {
  const s = String(v || '');
  let m = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return [m[1], m[2], m[3]];
  m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  return m ? [m[3], m[2], m[1]] : null;
}
function iso(p) {
  if (!p) return null;
  const [a, mo, j] = p.map(Number); const d = new Date(Date.UTC(a, mo - 1, j));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j || a < 1900 || d > new Date()) return null;
  return `${a}-${String(mo).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
}
/** Extraction prudente depuis des libellés explicites ; aucune déduction hors du texte lu. */
function extraire(texte) {
  const lignes = String(texte).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 80);
  const apres = (re) => { for (const l of lignes) { const m = l.match(re); if (m) return m[1]; } return null; };
  const nom = nettoyer(apres(/^(?:nom(?: de famille)?|surname|last name|family name)\s*[:.\-]?\s*(.+)$/i));
  const prenom = nettoyer(apres(/^(?:pr[ée]nom(?:s)?|given names?|first name)\s*[:.\-]?\s*(.+)$/i));
  const brute = apres(/^(?:date de naissance|n[ée]e? le|naissance|date of birth|birth date|dob)\s*[:.\-]?\s*(.+)$/i);
  const naissance = iso(date(brute));
  const champs = { nom: nom || null, prenom: prenom || null, date_naissance: naissance };
  const incertains = [];
  if (!champs.nom || champs.nom.length < 2 || champs.nom.length > 60) incertains.push('nom');
  if (!champs.prenom || champs.prenom.length < 2 || champs.prenom.length > 60) incertains.push('prenom');
  if (!naissance) incertains.push('date_naissance');
  return { champs, incertains };
}
async function lireDocument(pool, u, etab, b) {
  exigerEtablissement(u, etab);
  require('./patients').exigerFictifs();
  await require('./og-configuration').exigerFonction(pool, etab, 'documents');
  const type = String(b.type_document || '');
  if (!TYPES.includes(type)) throw new ErreurHttp(400, 'og_document_type');
  const brut = String(b.image_base64 || '').replace(/^data:image\/(?:png|jpeg);base64,/, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(brut) || brut.length > Math.ceil(TAILLE_MAX * 4 / 3)) throw new ErreurHttp(400, 'og_document_invalide');
  const octets = Buffer.from(brut, 'base64');
  const format = signature(octets);
  if (!format || octets.length > TAILLE_MAX) throw new ErreurHttp(400, 'og_document_invalide');
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'arrimo-og-doc-'));
  const fichier = path.join(dossier, `document.${format}`);
  let texte;
  try {
    await fs.writeFile(fichier, octets, { mode: 0o600 });
    texte = await lireTesseract(fichier);
  } catch { throw new ErreurHttp(422, 'og_document_illisible'); }
  finally { await fs.rm(dossier, { recursive: true, force: true }); }
  const r = extraire(texte);
  // Journal sans image ni identité : seulement le type de document et le nombre de champs à vérifier.
  await journaliser(pool, { etablissementId: etab, utilisateurId: u.id, action: 'Document lu par OG', detail: `${type} · ${r.incertains.length} champ(s) à vérifier` });
  return { type_document: type, ...r, conserve: false };
}
module.exports = { lireDocument, extraire, signature, TYPES };
