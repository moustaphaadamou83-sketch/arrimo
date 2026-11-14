'use strict';
/**
 * Mise à jour en direct des écrans Secours, Liaison Secours et suivi des établissements (13 nov. 2026).
 * Flux SSE lu par fetch (jeton dans l'en-tête Authorization, jamais dans l'adresse). Le serveur n'envoie qu'un signal
 * « secours » sans aucune donnée : chaque écran relit alors ses informations par les mêmes routes, avec les mêmes droits.
 * Monté hors du routeur API : une connexion longue ne retarde pas la remise à zéro de la démo.
 */
const { EventEmitter } = require('node:events');

const bus = new EventEmitter();
bus.setMaxListeners(0);
const ROLES = ['paramedic', 'superviseur_secours', 'repartiteur', 'coordonnateur', 'gestionnaire', 'admin_etab', 'equipe_soins'];
let attente = null;

/** Signale un changement (regroupé sur 300 ms pour ne pas multiplier les relectures). */
function signaler() {
  if (attente) return;
  attente = setTimeout(() => { attente = null; bus.emit('secours', Date.now()); }, 300); attente.unref?.();
}

function brancher(req, res) {
  if (!ROLES.includes(req.utilisateur.role)) { res.status(204).end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 5000\n\n');
  const envoyer = (t) => res.write(`event: secours\ndata: ${t}\n\n`);
  // Minuterie de maintien qui ne retient jamais l'arrêt du processus ; nettoyage à la fermeture de la réponse ou de la connexion
  const veille = setInterval(() => res.write(': veille\n\n'), 25000); veille.unref?.();
  bus.on('secours', envoyer);
  const fin = () => { clearInterval(veille); bus.off('secours', envoyer); };
  res.on('close', fin); req.on('close', fin);
}

module.exports = { signaler, brancher, bus };
