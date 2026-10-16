/**
 * Envoi de courriels (mot de passe oublié). Inactif tant que SMTP_URL n'est pas configuré :
 *   SMTP_URL=smtps://utilisateur:motdepasse@smtp.exemple.ca:465   COURRIEL_EXPEDITEUR="Arrimo <no-reply@exemple.ca>"
 *   ARRIMO_URL=https://arrimo.exemple.ca   (adresse publique, pour le lien du courriel)
 * Les tests remplacent le transport par une fonction qui garde les messages.
 */
let transportTest = null;
let transportSmtp = null;

const actif = () => !!(transportTest || (process.env.SMTP_URL && process.env.ARRIMO_URL));

function definirTransport(fn) { transportTest = fn; }

async function envoyer({ a, sujet, texte }) {
  if (transportTest) return transportTest({ a, sujet, texte });
  if (!transportSmtp) transportSmtp = require('nodemailer').createTransport(process.env.SMTP_URL);
  return transportSmtp.sendMail({ from: process.env.COURRIEL_EXPEDITEUR || 'Arrimo <no-reply@localhost>', to: a, subject: sujet, text: texte });
}

module.exports = { actif, envoyer, definirTransport };
