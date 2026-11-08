const { creerPool } = require('./db');
const { creerApp } = require('./app');
const { detecterBlocages } = require('./services');
const demo = require('./demo');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL manquant (voir .env.example).');
  process.exit(1);
}
const pool = creerPool(url);
const app = creerApp(pool);
const port = Number(process.env.PORT || 3010);
// Par défaut, écoute seulement en local : Nginx fait le pont avec Internet en HTTPS
const hote = process.env.HOST || '127.0.0.1';

{
  const env = require('./environnement');
  if (env.estProduction()) {
    const problemes = env.problemesProduction();
    if (problemes.length) { console.error(`Démarrage refusé en production : ${problemes.join(' ; ')}`); process.exit(1); }
  }
}
app.listen(port, hote, () => console.log(`Arrimo sur ${hote}:${port}`));

// Détection des blocages toutes les 15 minutes (et une fois au démarrage).
// Sur le serveur de démonstration, recalage des horloges de la démo d'abord, si personne ne l'utilise.
const intervalle = Number(process.env.BLOCAGES_MINUTES || 15) * 60000;
const tourner = () => demo.tacheDeFond(() => demo.recaler(pool)
  .then((min) => { if (min) console.log(`Démo recalée de ${min} min.`); })
  .catch((e) => console.error('Recalage de la démo :', e.message))
  .then(async () => {
    const debut = Date.now();
    const changes = await detecterBlocages(pool);
    // Heure réelle du contrôle : l'interface affiche « dernier contrôle », jamais « données actualisées » sans lecture
    await require('./vigilance').noterControle(pool, 'blocages', debut, { lits_modifies: changes });
  })
  .catch((e) => console.error('Détection des blocages :', e.message)));
tourner();
setInterval(tourner, intervalle);

setInterval(() => require('./famille').relancer(pool).catch((e) => console.error('Relances famille :', e.code || e.name)), 15 * 60000).unref();
setInterval(() => require('./portail-notifications').envoyer(pool).catch((e) => console.error('Notifications du portail :', e.code || e.name)), 60000).unref();

// Démonstration : la capacité des hôpitaux sans compte évolue doucement (toutes les 3 minutes par défaut)
const { simuler } = require('./simulation');
if (demo.estDemo()) {
  setInterval(() => demo.tacheDeFond(() => simuler(pool)).catch((e) => console.error('Simulation de la démo :', e.message)), Number(process.env.SIMULATION_MINUTES || 3) * 60000);
}
