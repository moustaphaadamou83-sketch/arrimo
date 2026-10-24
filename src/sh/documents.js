'use strict';
/**
 * Stockage des documents SH : chaque fichier est chiffré (AES-256-GCM) avant d'être écrit sur disque,
 * dans SH_DOCUMENTS_DIR, hors du dossier servi. La clé est dérivée (HKDF) de SH_MFA_ENCRYPTION_KEY :
 * aucun nouveau secret à gérer, et la même sauvegarde de clé protège les deux usages.
 * La base garde seulement les métadonnées, l'empreinte SHA-256 du contenu clair et la référence de stockage.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cleMfa } = require('./security');

const TAILLE_MAX = 10 * 1024 * 1024;
const TYPES = {
  pdf: { mime: 'application/pdf', signature: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  png: { mime: 'image/png', signature: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { mime: 'image/jpeg', signature: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', signature: (b) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', signature: (b) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) },
  csv: { mime: 'text/csv', signature: texteSansBinaire },
  txt: { mime: 'text/plain', signature: texteSansBinaire },
};
TYPES.jpeg = TYPES.jpg;
function texteSansBinaire(b) { return !b.includes(0) && Buffer.from(b.toString('utf8'), 'utf8').equals(b); }

// Qui peut lire chaque catégorie : l'administration voit tout ; « confidentiel » restreint à l'administration.
const CATEGORIES = {
  contrat: ['administration', 'commercial', 'finance'],
  devis: ['administration', 'commercial', 'finance'],
  facture: ['administration', 'finance'],
  technique: ['administration', 'implantation', 'support'],
  formation: ['administration', 'formation', 'implantation'],
  support: ['administration', 'support', 'implantation'],
  general: ['administration', 'commercial', 'implantation', 'formation', 'support', 'finance'],
};

const cleDocuments = (env) => Buffer.from(crypto.hkdfSync('sha256', cleMfa(env), Buffer.from('arrimo-sh'), Buffer.from('documents-v1'), 32));
const dossier = (env) => {
  const d = String(env.SH_DOCUMENTS_DIR || '').trim();
  if (!d || !path.isAbsolute(d)) throw Object.assign(new Error('Le stockage des documents n’est pas configuré (SH_DOCUMENTS_DIR).'), { statut: 503 });
  return d;
};

function peutLire(role, doc) {
  if (role === 'administration') return true;
  if (doc.confidentiel) return false;
  return (CATEGORIES[doc.categorie] || ['administration']).includes(role);
}

/** Vérifie nom, extension et signature du contenu. Rend { nom, extension, mime, octets }. */
function valider(nom, base64) {
  const propre = String(nom || '').normalize('NFC').replace(/[\\/\0<>:"|?*\u0000-\u001f]/g, '_').trim().slice(0, 160);
  const extension = path.extname(propre).slice(1).toLowerCase();
  const type = TYPES[extension];
  if (!propre || !type) throw Object.assign(new Error('Type de fichier refusé : PDF, PNG, JPEG, DOCX, XLSX, CSV ou TXT.'), { statut: 400 });
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw Object.assign(new Error('Contenu du fichier mal encodé.'), { statut: 400 });
  const octets = Buffer.from(base64, 'base64');
  if (!octets.length) throw Object.assign(new Error('Le fichier est vide.'), { statut: 400 });
  if (octets.length > TAILLE_MAX) throw Object.assign(new Error('Fichier trop gros : 10 Mo au plus.'), { statut: 413 });
  if (!type.signature(octets)) throw Object.assign(new Error('Le contenu ne correspond pas à l’extension du fichier.'), { statut: 400 });
  return { nom: propre, extension, mime: type.mime, octets };
}

/** Chiffre et écrit le fichier ; rend { stockage_ref, empreinte }. Écriture atomique (fichier temporaire puis renommage). */
async function ecrire(octets, env) {
  const d = dossier(env);
  await fs.promises.mkdir(d, { recursive: true, mode: 0o700 });
  const empreinte = crypto.createHash('sha256').update(octets).digest('hex');
  const ref = `${crypto.randomBytes(16).toString('hex')}.bin`;
  const iv = crypto.randomBytes(12);
  const ch = crypto.createCipheriv('aes-256-gcm', cleDocuments(env), iv);
  const chiffre = Buffer.concat([ch.update(octets), ch.final()]);
  const tmp = path.join(d, `.${ref}.tmp`);
  await fs.promises.writeFile(tmp, Buffer.concat([Buffer.from('ASD1'), iv, ch.getAuthTag(), chiffre]), { mode: 0o600, flag: 'wx' });
  await fs.promises.rename(tmp, path.join(d, ref));
  return { stockage_ref: ref, empreinte };
}

/** Lit, déchiffre et contrôle l'empreinte du fichier. */
async function lire(doc, env) {
  if (!/^[a-f0-9]{32}\.bin$/.test(doc.stockage_ref)) throw Object.assign(new Error('Référence de stockage invalide.'), { statut: 500 });
  const brut = await fs.promises.readFile(path.join(dossier(env), doc.stockage_ref)).catch(() => {
    throw Object.assign(new Error('Fichier introuvable dans le stockage.'), { statut: 410 });
  });
  if (brut.subarray(0, 4).toString('latin1') !== 'ASD1') throw Object.assign(new Error('Fichier de stockage illisible.'), { statut: 500 });
  const de = crypto.createDecipheriv('aes-256-gcm', cleDocuments(env), brut.subarray(4, 16));
  de.setAuthTag(brut.subarray(16, 32));
  let clair;
  try { clair = Buffer.concat([de.update(brut.subarray(32)), de.final()]); } catch { throw Object.assign(new Error('Intégrité du fichier compromise.'), { statut: 500 }); }
  if (crypto.createHash('sha256').update(clair).digest('hex') !== doc.empreinte) throw Object.assign(new Error('Empreinte du fichier différente : document altéré.'), { statut: 500 });
  return clair;
}

module.exports = { CATEGORIES, TAILLE_MAX, peutLire, valider, ecrire, lire };
