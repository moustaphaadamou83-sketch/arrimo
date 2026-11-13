/**
 * Envoi de courriels (mot de passe oublié). Inactif tant que SMTP_URL n'est pas configuré :
 *   SMTP_URL=smtps://utilisateur:motdepasse@smtp.exemple.ca:465   COURRIEL_EXPEDITEUR="Arrimo <no-reply@exemple.ca>"
 *   ARRIMO_URL=https://arrimo.exemple.ca   (adresse publique, pour le lien du courriel)
 * Les tests remplacent le transport par une fonction qui garde les messages.
 */
let transportTest = null;
let transportSmtp = null, transportSmtpUrl = null;

const actif = (urlPublique, env = process.env) => !!(transportTest || (env.SMTP_URL && (urlPublique || env.ARRIMO_URL || require('./environnement').urlPublique())));

function definirTransport(fn) { transportTest = fn; }

/** ics (facultatif) : { methode: 'REQUEST' | 'CANCEL', contenu } — invitation de calendrier jointe (text/calendar). */
async function envoyer({ a, sujet, texte, ics, de }, env = process.env) {
  if (transportTest) return transportTest({ a, sujet, texte, ...(ics ? { ics } : {}), ...(de ? { de } : {}) });
  if (!env.SMTP_URL) throw Object.assign(new Error('Transport courriel non configuré.'), { code: 'SMTP_NON_CONFIGURE' });
  if (!transportSmtp || transportSmtpUrl !== env.SMTP_URL) { transportSmtp = require('nodemailer').createTransport(env.SMTP_URL); transportSmtpUrl = env.SMTP_URL; }
  return transportSmtp.sendMail({ from: de || env.COURRIEL_EXPEDITEUR || 'Arrimo <no-reply@localhost>', to: a, subject: sujet, text: texte,
    ...(ics ? { icalEvent: { method: ics.methode, filename: ics.methode === 'CANCEL' ? 'annulation.ics' : 'invitation.ics', content: ics.contenu } } : {}) });
}

module.exports = { actif, envoyer, definirTransport };
