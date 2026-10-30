'use strict';
/**
 * Taux de change datés, source officielle unique : Banque du Canada (API Valet, taux moyens quotidiens).
 * Un taux publié n'est jamais modifié ; une devise absente des séries officielles n'a aucun taux.
 */
const SOURCE_NOM = 'Banque du Canada';
const SOURCE_URL = 'https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/';
// SH_CHANGE_VALET_URL ne sert qu'aux tests (serveur local simulé) ; la provenance enregistrée reste la Banque du Canada.
const VALET = 'https://www.bankofcanada.ca/valet/observations/';
const DEVISES = ['AUD', 'BRL', 'CHF', 'CNY', 'EUR', 'GBP', 'HKD', 'IDR', 'INR', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PEN', 'PLN', 'SAR', 'SEK', 'SGD', 'THB', 'TRY', 'TWD', 'USD', 'VND', 'ZAR'];
// Un taux plus ancien que ce délai n'est pas utilisé : jours fériés et fins de semaine couverts, pas les séries arrêtées.
const ANCIENNETE_MAX_JOURS = 7;
const erreur = (statut, message, code) => Object.assign(new Error(message), { statut, code });

/** Importe les observations depuis `debut` (AAAA-MM-JJ). Rend { ajoutes, identiques, divergents }. */
async function importerBanqueCanada(db, { debut, fetch = globalThis.fetch } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(debut || ''))) throw erreur(400, 'Date de début AAAA-MM-JJ requise.');
  const series = DEVISES.map((d) => `FX${d}CAD`).join(',');
  const r = await fetch(`${process.env.SH_CHANGE_VALET_URL || VALET}${series}/json?start_date=${debut}`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw erreur(502, `Banque du Canada indisponible (HTTP ${r.status}).`, 'change_source_indisponible');
  const donnees = await r.json();
  if (!Array.isArray(donnees.observations)) throw erreur(502, 'Réponse de la Banque du Canada illisible.', 'change_source_illisible');
  const bilan = { ajoutes: 0, identiques: 0, divergents: [] };
  for (const o of donnees.observations) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.d)) continue;
    for (const devise of DEVISES) {
      const v = o[`FX${devise}CAD`]?.v;
      if (v == null || v === '' || !/^\d+(\.\d+)?$/.test(v) || Number(v) <= 0) continue;
      const ins = await db.query(`INSERT INTO sh_taux_change(devise,jour,cad_par_unite,source_nom,source_url,serie)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(devise,jour) DO NOTHING RETURNING id`, [devise, o.d, v, SOURCE_NOM, SOURCE_URL, `FX${devise}CAD`]);
      if (ins.rowCount) { bilan.ajoutes += 1; continue; }
      const ancien = (await db.query('SELECT cad_par_unite FROM sh_taux_change WHERE devise=$1 AND jour=$2', [devise, o.d])).rows[0];
      if (Number(ancien.cad_par_unite) === Number(v)) bilan.identiques += 1;
      else bilan.divergents.push({ devise, jour: o.d, conserve: ancien.cad_par_unite, publie: v });
    }
  }
  return bilan;
}

/** Taux applicable à une date : dernière publication à cette date ou avant, au plus ANCIENNETE_MAX_JOURS plus tôt. */
async function tauxPour(db, devise, jour) {
  if (devise === 'CAD') return null;
  const t = (await db.query(`SELECT devise,jour,cad_par_unite,source_nom,source_url,serie FROM sh_taux_change
    WHERE devise=$1 AND jour<=$2::date AND jour>$2::date-$3::int ORDER BY jour DESC LIMIT 1`, [devise, jour, ANCIENNETE_MAX_JOURS])).rows[0];
  return t || null;
}

module.exports = { DEVISES, SOURCE_NOM, SOURCE_URL, ANCIENNETE_MAX_JOURS, importerBanqueCanada, tauxPour };
