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
// Synchronisation avec rattrapage (refonte unifiée, 26 nov. 2026) : chaque signal porte un numéro de séquence et son heure d'émission ;
// un écran qui se reconnecte avec « Last-Event-ID » est prévenu tout de suite s'il a manqué des signaux (ou si le serveur a redémarré).
const demarrage = Date.now();
let sequence = 0; let premierDemande = null;
const mesures = { emis: 0, delais_regroupement_ms: [] };

/** Signale un changement (regroupé sur 300 ms pour ne pas multiplier les relectures). */
function signaler() {
  if (attente) return;
  premierDemande = Date.now();
  attente = setTimeout(() => {
    attente = null; sequence += 1; mesures.emis += 1;
    mesures.delais_regroupement_ms.push(Date.now() - premierDemande); if (mesures.delais_regroupement_ms.length > 200) mesures.delais_regroupement_ms.shift();
    bus.emit('secours', { id: `${demarrage}-${sequence}`, t: Date.now() });
  }, 300); attente.unref?.();
}
/** Le dernier identifiant reçu par l'écran est-il en retard sur le serveur (ou d'une instance précédente) ? */
function enRetard(dernier) {
  if (!dernier) return false;
  const [inst, n] = String(dernier).split('-');
  if (inst !== String(demarrage)) return true;          // serveur redémarré : état inconnu, relecture
  return Number(n) < sequence;
}
function etat() {
  const d = [...mesures.delais_regroupement_ms].sort((a, b) => a - b);
  const p = (q) => (d.length ? d[Math.min(d.length - 1, Math.floor(q * d.length))] : null);
  return { instance: demarrage, sequence, emis: mesures.emis, abonnes: bus.listenerCount('secours'), regroupement_ms: { p50: p(0.5), p95: p(0.95), p99: p(0.99) } };
}

function brancher(req, res) {
  if (!ROLES.includes(req.utilisateur.role)) { res.status(204).end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 5000\n\n');
  const envoyer = (s) => res.write(`id: ${s.id}\nevent: secours\ndata: ${JSON.stringify({ t: s.t })}\n\n`);
  // Rattrapage : signaux manqués pendant la coupure → un signal immédiat (l'écran relit tout par les routes habituelles)
  if (enRetard(req.get('last-event-id'))) res.write(`id: ${demarrage}-${sequence}\nevent: secours\ndata: ${JSON.stringify({ t: Date.now(), rattrapage: true })}\n\n`);
  // Minuterie de maintien qui ne retient jamais l'arrêt du processus ; nettoyage à la fermeture de la réponse ou de la connexion
  const veille = setInterval(() => res.write(': veille\n\n'), 25000); veille.unref?.();
  bus.on('secours', envoyer);
  const fin = () => { clearInterval(veille); bus.off('secours', envoyer); };
  res.on('close', fin); req.on('close', fin);
}

module.exports = { signaler, brancher, bus, etat, enRetard };
