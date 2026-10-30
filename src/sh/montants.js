'use strict';
/**
 * Calcul des montants des devis et factures : en unités monétaires entières selon la devise,
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
function precisionDevise(devise='CAD'){
  const precision=require('./international').decimalesDevise(devise);
  if(precision===null||precision>2)throw Object.assign(new Error('La facturation de cette devise n’est pas encore disponible.'),{statut:400,code:'devise_precision_non_supportee'});
  return precision;
}
function verifierMontantDevise(montant,devise='CAD'){
  const precision=precisionDevise(devise),valeur=Number(montant);
  const refuser=()=>{throw Object.assign(new Error('Le montant ne respecte pas la précision ou la limite de la devise.'),{statut:400});};
  if(!Number.isFinite(valeur))return refuser();
  const m=String(valeur).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if(!m)return refuser();
  let entier=BigInt(m[2]+(m[3]||''));
  const decalage=precision+Number(m[4]||0)-(m[3]||'').length;
  if(decalage<0){const diviseur=10n**BigInt(-decalage);if(entier%diviseur!==0n)return refuser();entier/=diviseur;}
  else entier*=10n**BigInt(decalage);
  // Les colonnes financières actuelles sont numeric(14,2) : 12 chiffres entiers.
  if(entier>10n**BigInt(12+precision)-1n)return refuser();
  return Number(m[1]?-entier:entier);
}

/** Code de province à partir du texte libre de la fiche (« Québec », « QC »…), ou null. */
function codeRegion(texte) {
  const t = String(texte || '').trim().toLowerCase();
  if (!t) return null;
  return Object.keys(PROVINCES).find((k) => PROVINCES[k].includes(t)) || (/^[a-z0-9][a-z0-9-]{1,9}$/i.test(t) ? t.toUpperCase() : null);
}

/** Normalise et valide les lignes saisies ; lève une erreur avec un message clair. */
function lignesPropres(lignes, tarifs = new Map(), devise='CAD') {
  const facteur=10**precisionDevise(devise);
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
    const montant=Math.round(verifierMontantDevise(ligne.prix_unitaire,devise)*ligne.quantite*(1-ligne.remise_pct/100));
    if(!Number.isSafeInteger(montant)||BigInt(montant)>10n**BigInt(12+precisionDevise(devise))-1n)throw Object.assign(new Error('Le montant ne respecte pas la précision ou la limite de la devise.'),{statut:400});
    ligne.montant=montant/facteur;
    return ligne;
  });
}

/** Seules les règles sourcées, datées et associées à un profil fiscal validé sont appliquées. */
async function taxesPour(db, pays, region, date) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))throw new Error('Date fiscale AAAA-MM-JJ requise.');
  const p=require('./international').normaliserPays(pays||'CA');
  const r=codeRegion(region);
  const regions=(await db.query('SELECT region FROM sh_profils_fiscaux WHERE pays_code=$1 AND region<>\'*\'', [p])).rows;
  if(regions.length&&!r)throw Object.assign(new Error('La région ou province fiscale du client est requise.'),{statut:409,code:'region_fiscale_requise'});
  let profil;
  if(r)profil=(await db.query('SELECT * FROM sh_profils_fiscaux WHERE pays_code=$1 AND region=$2',[p,r])).rows[0];
  if(!profil&&!regions.length)profil=(await db.query("SELECT * FROM sh_profils_fiscaux WHERE pays_code=$1 AND region='*'",[p])).rows[0];
  if(!profil)throw Object.assign(new Error(`Aucun profil fiscal configuré pour ${p}${r?`/${r}`:''}.`),{statut:409,code:'profil_fiscal_absent'});
  if(profil.statut==='a_verifier')throw Object.assign(new Error(`Le profil fiscal ${p}/${profil.region} doit être vérifié avant toute facturation.`),{statut:409,code:'profil_fiscal_a_verifier'});
  if(profil.statut==='exonere')return [];
  const requete=`SELECT code,nom,taux,source_nom,source_url,verifie_le,valide_de,valide_jusqua
    FROM sh_taxes WHERE pays_code=$1 AND region=$2 AND source_url IS NOT NULL AND verifie_le IS NOT NULL
      AND valide_de IS NOT NULL AND valide_de<=$3::date AND (valide_jusqua IS NULL OR valide_jusqua>=$3::date)
    ORDER BY ordre,code`;
  let lignes=(await db.query(requete,[p,profil.region,date])).rows;
  // Profil régional validé sans règle propre (ex. AB : TPS seule) : règles nationales sourcées du pays.
  if(!lignes.length&&profil.region!=='*'&&!(await db.query('SELECT 1 FROM sh_taxes WHERE pays_code=$1 AND region=$2 LIMIT 1',[p,profil.region])).rowCount)
    lignes=(await db.query(requete,[p,'*',date])).rows;
  if(!lignes.length)throw Object.assign(new Error(`Aucun taux sourcé et en vigueur pour le profil fiscal ${p}/${profil.region} à la date ${date}.`),{statut:409,code:'taux_fiscal_absent'});
  return lignes;
}

/** Totaux d'un ensemble de lignes avec les taxes données. */
function totaux(lignes, taxes,devise='CAD') {
  const facteur=10**precisionDevise(devise);
  const st = lignes.reduce((n, l) => n + verifierMontantDevise(l.montant,devise), 0);
  const taxable = lignes.filter((l) => l.taxable).reduce((n, l) => n + verifierMontantDevise(l.montant,devise), 0);
  if(!Number.isSafeInteger(st)||!Number.isSafeInteger(taxable))throw Object.assign(new Error('Le montant ne respecte pas la précision ou la limite de la devise.'),{statut:400});
  const detail = taxes.map(t=>{
    const taux=Number(t.taux);
    if(!Number.isFinite(taux)||taux<0||taux>=100)throw Object.assign(new Error('Taux de taxe invalide.'),{statut:400});
    const mineur=Number((BigInt(taxable)*BigInt(Math.round(taux*1000))+50000n)/100000n);
    return {code:t.code,nom:t.nom,taux,montant:mineur/facteur,...(t.source_url?{source_nom:t.source_nom,source_url:t.source_url,verifie_le:jourDe(t.verifie_le),valide_de:jourDe(t.valide_de),valide_jusqua:jourDe(t.valide_jusqua)}:{})};
  });
  const tx=detail.reduce((n,t)=>n+verifierMontantDevise(t.montant,devise),0);
  if(!Number.isSafeInteger(st+tx)||BigInt(st+tx)>10n**BigInt(12+precisionDevise(devise))-1n)throw Object.assign(new Error('Le montant ne respecte pas la précision ou la limite de la devise.'),{statut:400});
  return {sous_total:st/facteur,taxes:detail,total:(st+tx)/facteur};
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
/** AAAA-MM-JJ d'une colonne « date » lue par pg (minuit local) ou d'une chaîne. */
const jourDe = (d) => (d == null ? null : d instanceof Date
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10));
function ajouterJours(jourIso, jours) {
  const d = new Date(`${String(jourIso).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

module.exports = { jourDe, PERIODICITES, codeRegion, lignesPropres, taxesPour, totaux, prochainNumero, ajouterMois, ajouterJours, cents, versMontant,precisionDevise,verifierMontantDevise };
