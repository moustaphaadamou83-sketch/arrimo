'use strict';
/**
 * Calcul des montants des devis et factures : en cents entiers pour éviter les erreurs d'arrondi,
 * taxes appliquées sur le sous-total taxable selon le pays et la province du client (table sh_taxes).
 */
const PERIODICITES = ['unique', 'mensuel', 'annuel'];
const PROVINCES = {
  QC: ['qc', 'quebec', 'québec'], ON: ['on', 'ontario'], NB: ['nb', 'nouveau-brunswick', 'new brunswick'], NS: ['ns', 'nouvelle-écosse', 'nouvelle-ecosse', 'nova scotia'],
  NL: ['nl', 'terre-neuve-et-labrador', 'newfoundland and labrador'], PE: ['pe', 'île-du-prince-édouard', 'ile-du-prince-edouard', 'prince edward island'],
  BC: ['bc', 'colombie-britannique', 'british columbia'], AB: ['ab', 'alberta'], SK: ['sk', 'saskatchewan'], MB: ['mb', 'manitoba'],
  YT: ['yt', 'yukon'], NT: ['nt', 'territoires du nord-ouest', 'northwest territories'], NU: ['nu', 'nunavut'],
};

const cents = (x) => Math.round(Number(x) * 100);
const versMontant = (c) => Number((c / 100).toFixed(2));

/** Code de province à partir du texte libre de la fiche (« Québec », « QC »…), ou null. */
function codeRegion(texte) {
  const t = String(texte || '').trim().toLowerCase();
  if (!t) return null;
  return Object.keys(PROVINCES).find((k) => PROVINCES[k].includes(t)) || null;
}

/** Normalise et valide les lignes saisies ; lève une erreur avec un message clair. */
function lignesPropres(lignes, tarifs = new Map()) {
  if (!Array.isArray(lignes) || !lignes.length || lignes.length > 100) throw Object.assign(new Error('Le document doit contenir de 1 à 100 lignes.'), { statut: 400 });
  return lignes.map((l) => {
    const t = l.code ? tarifs.get(String(l.code)) : null;
    const ligne = {
      code: l.code ? String(l.code).slice(0, 40) : null,
      description: String(l.description ?? t?.libelle ?? '').trim().slice(0, 240),
      quantite: Number(l.quantite ?? 1),
      prix_unitaire: Number(l.prix_unitaire ?? t?.prix_unitaire),
      periodicite: String(l.periodicite ?? t?.periodicite ?? 'unique'),
      remise_pct: Number(l.remise_pct ?? 0),
      taxable: l.taxable === undefined ? (t ? t.taxable : true) : l.taxable !== false,
    };
    if (!ligne.description || !Number.isFinite(ligne.quantite) || ligne.quantite <= 0 || ligne.quantite > 100000
      || !Number.isFinite(ligne.prix_unitaire) || ligne.prix_unitaire < 0 || ligne.prix_unitaire > 1e9
      || !PERIODICITES.includes(ligne.periodicite) || !Number.isFinite(ligne.remise_pct) || ligne.remise_pct < 0 || ligne.remise_pct > 100) {
      throw Object.assign(new Error('Une ligne est invalide : description, quantité positive, prix, périodicité et remise entre 0 et 100 %.'), { statut: 400 });
    }
    ligne.montant = versMontant(Math.round(cents(ligne.prix_unitaire) * ligne.quantite * (1 - ligne.remise_pct / 100)));
    return ligne;
  });
}

/** Taxes applicables à un client : taux propres à sa province, sinon taux national (« * ») ; hors Canada, aucune. */
async function taxesPour(db, pays, region) {
  const p = String(pays || 'CA').toUpperCase();
  const r = codeRegion(region);
  const requete = `SELECT code, nom, taux FROM sh_taxes WHERE pays_code = $1 AND region = $2 ORDER BY ordre, code`;
  const propres = r ? (await db.query(requete, [p, r])).rows : [];
  return propres.length ? propres : (await db.query(requete, [p, '*'])).rows;
}

/** Totaux d'un ensemble de lignes avec les taxes données. */
function totaux(lignes, taxes) {
  const st = lignes.reduce((n, l) => n + cents(l.montant), 0);
  const taxable = lignes.filter((l) => l.taxable).reduce((n, l) => n + cents(l.montant), 0);
  const detail = taxes.map((t) => ({ code: t.code, nom: t.nom, taux: Number(t.taux), montant: versMontant(Math.round(taxable * Number(t.taux) / 100)) }));
  const tx = detail.reduce((n, t) => n + cents(t.montant), 0);
  return { sous_total: versMontant(st), taxes: detail, total: versMontant(st + tx) };
}

/** Numéro de facture séquentiel sans trou, par année (verrou de ligne dans la transaction appelante). */
async function prochainNumero(c, prefixe, annee) {
  const cle = `${prefixe}-${annee}`;
  const { rows } = await c.query(`INSERT INTO sh_compteurs (cle, valeur) VALUES ($1, 1)
    ON CONFLICT (cle) DO UPDATE SET valeur = sh_compteurs.valeur + 1 RETURNING valeur`, [cle]);
  return `${cle}-${String(rows[0].valeur).padStart(4, '0')}`;
}

/** Ajoute des mois à une date AAAA-MM-JJ (fin de mois respectée). */
function ajouterMois(jourIso, mois) {
  const [a, m, j] = String(jourIso).slice(0, 10).split('-').map(Number);
  const cible = new Date(Date.UTC(a, m - 1 + mois, 1));
  const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(j, dernier));
  return cible.toISOString().slice(0, 10);
}
function ajouterJours(jourIso, jours) {
  const d = new Date(`${String(jourIso).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

module.exports = { PERIODICITES, codeRegion, lignesPropres, taxesPour, totaux, prochainNumero, ajouterMois, ajouterJours, cents, versMontant };
