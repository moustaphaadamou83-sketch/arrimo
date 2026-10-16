const { creerPool } = require('./db');
const { creerApp } = require('./app');
const { detecterBlocages } = require('./services');

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

// Détection des blocages toutes les 15 minutes (et une fois au démarrage)
const intervalle = Number(process.env.BLOCAGES_MINUTES || 15) * 60000;
const tourner = () => detecterBlocages(pool).catch((e) => console.error('Détection des blocages :', e.message));
tourner();
setInterval(tourner, intervalle);
