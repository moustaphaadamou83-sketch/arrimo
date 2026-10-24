/* Seuls des agrégats numériques et des questions prédéfinies peuvent quitter Arrimo. */
const normaliser = (q) => String(q || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const QUESTIONS = new Map([
  ['what should i do', 'Summarize operational priorities using only the provided aggregates.'],
  ['what should i do first', 'Summarize operational priorities using only the provided aggregates.'],
  ['is the network overloaded', 'Summarize network pressure using only the provided aggregates.'],
  ['que faire', 'Résume les priorités opérationnelles à partir des agrégats fournis.'],
  ['que faire en priorite', 'Résume les priorités opérationnelles à partir des agrégats fournis.'],
  ['le reseau deborde t il', 'Résume la pression du réseau à partir des agrégats fournis.'],
]);

function questionPredefinie(q) { return QUESTIONS.get(normaliser(q)) || null; }
const nombre = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const niveau = (v) => ['vert', 'jaune', 'orange', 'rouge'].includes(v) ? v : 'inconnu';

function agregatsIa(contexte = {}) {
  const b = contexte.briefing || {};
  const r = contexte.reseau || {};
  const a = b.alerte || {};
  const i = b.indicateurs || {};
  const recos = Array.isArray(b.recommandations) ? b.recommandations : [];
  return {
    alerte: {
      niveau: niveau(a.niveau), pression: nombre(a.pression), dotes: nombre(a.dotes),
      libres: nombre(a.libres), en_attente: nombre(a.en_attente),
      attente_longue: nombre(a.attente_longue), fermes_personnel: nombre(a.fermes_personnel),
    },
    indicateurs: {
      prevus: nombre(i.prevus), nettoyage: nombre(i.nettoyage), nsa: nombre(i.nsa), taux_nsa: nombre(i.taux_nsa),
    },
    recommandations: {
      urgentes: recos.filter(x => x.priorite === 1).length,
      importantes: recos.filter(x => x.priorite === 2).length,
      a_faire: recos.filter(x => x.priorite === 3).length,
    },
    reseau: (Array.isArray(r.etablissements) ? r.etablissements : []).slice(0, 100).map((e, index) => ({
      repere: index + 1, origine: e.moi === true, niveau: niveau(e.niveau),
      pression: nombre(e.pression), libres: nombre(e.libres), en_attente: nombre(e.en_attente),
    })),
    delestages_possibles: Array.isArray(r.delestages) ? r.delestages.length : 0,
  };
}

module.exports = { questionPredefinie, agregatsIa };
