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

app.listen(port, hote, () => console.log(`Arrimo sur ${hote}:${port}`));

// Détection des blocages toutes les 15 minutes (et une fois au démarrage).
// Sur le serveur de démonstration, recalage des horloges de la démo d'abord, si personne ne l'utilise.
const intervalle = Number(process.env.BLOCAGES_MINUTES || 15) * 60000;
const tourner = () => demo.recaler(pool)
  .then((min) => { if (min) console.log(`Démo recalée de ${min} min.`); })
  .catch((e) => console.error('Recalage de la démo :', e.message))
  .then(() => detecterBlocages(pool))
  .catch((e) => console.error('Détection des blocages :', e.message));
tourner();
setInterval(tourner, intervalle);

// Démonstration : la capacité des hôpitaux sans compte évolue doucement (toutes les 3 minutes par défaut)
const { simuler } = require('./simulation');
if (demo.estDemo()) {
  setInterval(() => simuler(pool).catch((e) => console.error('Simulation de la démo :', e.message)), Number(process.env.SIMULATION_MINUTES || 3) * 60000);
}
