'use strict';
/**
 * HL7 v2 (ADT) reçu sur HTTPS (aucun port MLLP ouvert : accord de Moustafa requis pour tout port) : le moteur d'interface de
 * l'hôpital envoie le message brut ; Arrimo le traduit vers les événements existants (src/connecteurs.js), mêmes règles et
 * même idempotence (MSH-10). Seul l'identifiant PID-3 (référence pseudonymisée attendue) est lu : le nom (PID-5), la date de
 * naissance et tout autre champ d'identité ne sont jamais lus ni conservés.
 * Correspondances : A01 admission · A02 transfert interne · A03 congé · A04 arrivée à l'urgence (civière) · A16 congé prévu.
 * Lit et civière : composante « lit » de PV1-3 (PV1-6 pour l'emplacement précédent), égale au code Arrimo.
 */
const { ErreurHttp } = require('./db');

function analyser(texte) {
  const brut = String(texte || '').replace(/\r\n|\n/g, '\r').trim();
  if (!brut.startsWith('MSH')) throw new ErreurHttp(400, 'hl7_invalide');
  const sep = brut[3]; const comp = brut[4] || '^';
  const segments = {};
  for (const ligne of brut.split('\r').filter(Boolean)) {
    const champs = ligne.split(sep);
    // MSH : le séparateur est lui-même MSH-1 ; on décale pour garder la numérotation HL7
    if (champs[0] === 'MSH') champs.splice(1, 0, sep);
    if (!segments[champs[0]]) segments[champs[0]] = champs;
  }
  const champ = (seg, n, c = 1) => ((segments[seg] || [])[n] || '').split(comp)[c - 1] || '';
  return { segments, champ };
}
const EVENEMENTS = { A01: 'admission', A02: 'transfert_interne', A03: 'conge', A04: 'arrivee_urgence', A16: 'conge_prevu' };
const dateHl7 = (v) => {
  const m = String(v || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0))).toISOString() : null;
};
/** Message HL7 v2 → événement Arrimo (aucune identité). */
function traduire(texte) {
  const { champ } = analyser(texte);
  const type = champ('MSH', 9, 1); const declencheur = champ('MSH', 9, 2);
  const controle = champ('MSH', 10, 1);
  if (type !== 'ADT' || !EVENEMENTS[declencheur]) throw new ErreurHttp(400, 'hl7_evenement_non_pris_en_charge', { evenement: `${type}^${declencheur}` });
  if (!controle) throw new ErreurHttp(400, 'hl7_invalide');
  const ev = { identifiant: controle.slice(0, 120), evenement: EVENEMENTS[declencheur], patient_ref: champ('PID', 3, 1).slice(0, 40) };
  if (declencheur === 'A04') ev.civiere = champ('PV1', 3, 3); else ev.lit = champ('PV1', 3, 3);
  if (declencheur === 'A02') ev.lit_precedent = champ('PV1', 6, 3);
  if (declencheur === 'A04') ev.date = dateHl7(champ('PV1', 44, 1)) || dateHl7(champ('EVN', 2, 1));
  if (declencheur === 'A16') ev.date = dateHl7(champ('PV2', 9, 1)) || dateHl7(champ('EVN', 3, 1));
  return { ev, controle, recepteur: champ('MSH', 3, 1), emetteur: champ('MSH', 5, 1) };
}
/** Accusé HL7 (MSA) : AA accepté, AE erreur ; le texte d'erreur ne reprend jamais le contenu du message. */
function accuse(controle, code, texte = '') {
  const h = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `MSH|^~\\&|ARRIMO|ARRIMO|||${h}||ACK|${controle || ''}-ACK|P|2.5\rMSA|${code}|${controle || ''}${texte ? `|${String(texte).replace(/[|^~\\&\r\n]/g, ' ').slice(0, 80)}` : ''}\r`;
}
module.exports = { traduire, accuse, analyser, EVENEMENTS };
