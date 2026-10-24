'use strict';
const crypto = require('node:crypto');

const empreinte = (valeur) => crypto.createHash('sha256').update(String(valeur)).digest('hex');

function cleMfa(env = process.env) {
  const brut = String(env.SH_MFA_ENCRYPTION_KEY || '');
  if (!brut) throw new Error('SH_MFA_ENCRYPTION_KEY_REQUIRED');
  const cle = Buffer.from(brut, 'base64');
  if (cle.length !== 32) throw new Error('SH_MFA_ENCRYPTION_KEY_INVALID');
  return cle;
}

function chiffrerSecret(secret, env = process.env) {
  if (!secret) return null;
  if (String(secret).startsWith('enc:v1:')) return String(secret);
  const iv = crypto.randomBytes(12);
  const ch = crypto.createCipheriv('aes-256-gcm', cleMfa(env), iv);
  const texte = Buffer.concat([ch.update(String(secret), 'utf8'), ch.final()]);
  return `enc:v1:${iv.toString('base64')}:${ch.getAuthTag().toString('base64')}:${texte.toString('base64')}`;
}

function dechiffrerSecret(valeur, env = process.env) {
  if (!valeur) return null;
  const [prefixe, version, iv64, tag64, texte64] = String(valeur).split(':');
  if (prefixe !== 'enc' || version !== 'v1' || !iv64 || !tag64 || !texte64) throw new Error('SH_MFA_SECRET_FORMAT_INVALID');
  const de = crypto.createDecipheriv('aes-256-gcm', cleMfa(env), Buffer.from(iv64, 'base64'));
  de.setAuthTag(Buffer.from(tag64, 'base64'));
  return Buffer.concat([de.update(Buffer.from(texte64, 'base64')), de.final()]).toString('utf8');
}

module.exports = { empreinte, cleMfa, chiffrerSecret, dechiffrerSecret };
