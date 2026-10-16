/**
 * Double authentification par code à 6 chiffres (TOTP, RFC 6238), compatible avec
 * Google Authenticator, Microsoft Authenticator, 1Password, etc. Aucune dépendance externe.
 */
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encoder(buf) {
  let bits = 0; let valeur = 0; let sortie = '';
  for (const octet of buf) {
    valeur = (valeur << 8) | octet; bits += 8;
    while (bits >= 5) { sortie += ALPHABET[(valeur >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) sortie += ALPHABET[(valeur << (5 - bits)) & 31];
  return sortie;
}

function base32Decoder(texte) {
  const propre = String(texte).replace(/=+$/, '').toUpperCase();
  let bits = 0; let valeur = 0; const sortie = [];
  for (const c of propre) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error('Secret invalide');
    valeur = (valeur << 5) | i; bits += 5;
    if (bits >= 8) { sortie.push((valeur >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(sortie);
}

const nouveauSecret = () => base32Encoder(crypto.randomBytes(20));

function codePourPas(secret, pas) {
  const compteur = Buffer.alloc(8);
  compteur.writeBigUInt64BE(BigInt(pas));
  const h = crypto.createHmac('sha1', base32Decoder(secret)).update(compteur).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}

const pasActuel = (maintenant = Date.now()) => Math.floor(maintenant / 30000);

/** Vérifie un code (tolérance ±30 s). Retourne le pas utilisé, ou null. Refuse un pas déjà utilisé (rejeu). */
function verifierCode(secret, code, dernierPas = 0, maintenant = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return null;
  const p = pasActuel(maintenant);
  for (const d of [0, -1, 1]) {
    const pas = p + d;
    if (pas <= Number(dernierPas)) continue;
    const attendu = codePourPas(secret, pas);
    if (crypto.timingSafeEqual(Buffer.from(attendu), Buffer.from(c))) return pas;
  }
  return null;
}

const uri = (secret, compte, emetteur = 'Arrimo') =>
  `otpauth://totp/${encodeURIComponent(emetteur)}:${encodeURIComponent(compte)}?secret=${secret}&issuer=${encodeURIComponent(emetteur)}&algorithm=SHA1&digits=6&period=30`;

module.exports = { nouveauSecret, verifierCode, codePourPas, pasActuel, uri, base32Encoder, base32Decoder };
