const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const courriel = require('../src/courriel');

test('transport courriel : le message de récupération produit un MIME sans connexion réseau', async () => {
  const creer = nodemailer.createTransport;
  const ancien = process.env.SMTP_URL;
  const expediteur = process.env.COURRIEL_EXPEDITEUR;
  process.env.SMTP_URL = 'smtp://127.0.0.1:1';
  process.env.COURRIEL_EXPEDITEUR = 'Arrimo <demo@example.invalid>';
  nodemailer.createTransport = () => creer({ streamTransport: true, buffer: true, newline: 'unix' });
  try {
    const resultat = await courriel.envoyer({
      a: 'fictif@example.invalid', sujet: 'Arrimo : accès',
      texte: 'Lien fictif : http://127.0.0.1:3013/?jeton=fictif',
    });
    assert.deepEqual(resultat.envelope.to, ['fictif@example.invalid']);
    const mime = resultat.message.toString('utf8');
    assert.match(mime, /To: fictif@example.invalid/);
    assert.match(mime, /127\.0\.0\.1:3013/);
  } finally {
    nodemailer.createTransport = creer;
    if (ancien === undefined) delete process.env.SMTP_URL;
    else process.env.SMTP_URL = ancien;
    if (expediteur === undefined) delete process.env.COURRIEL_EXPEDITEUR;
    else process.env.COURRIEL_EXPEDITEUR = expediteur;
  }
});
