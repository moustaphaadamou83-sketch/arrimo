'use strict';
/**
 * Budgets, coûts et marges par projet. Chaque montant garde sa devise : aucune conversion implicite,
 * les synthèses sont présentées par devise. Les revenus sont les factures émises (hors taxes) du contrat du projet.
 */
const {transaction}=require('../db');
const {NATURES,CATEGORIES}=require('./finances-projets-migrations');
const erreur=(statut,message)=>Object.assign(new Error(message),{statut});
const id=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw erreur(400,'Identifiant invalide.');return n;};
const arrondi=n=>Math.round(n*100)/100;

/** Synthèse par devise : budget, coûts prévus et réels, revenus HT, marge et écart au budget. */
function synthese(lignes,revenus){
  const parDevise=new Map();
  const ligne=d=>{if(!parDevise.has(d))parDevise.set(d,{devise:d,budget:0,cout_prevu:0,cout_reel:0,revenus:0});return parDevise.get(d);};
  for(const l of lignes)ligne(l.devise)[l.nature]+=Number(l.montant);
  for(const r of revenus)ligne(r.devise).revenus+=Number(r.montant);
  return [...parDevise.values()].sort((a,b)=>a.devise.localeCompare(b.devise)).map(x=>{
    const marge=arrondi(x.revenus-x.cout_reel);
    return {devise:x.devise,budget:arrondi(x.budget),cout_prevu:arrondi(x.cout_prevu),cout_reel:arrondi(x.cout_reel),revenus:arrondi(x.revenus),
      marge,taux_marge:x.revenus>0?arrondi(100*marge/x.revenus):null,
      ecart_budget:arrondi(x.budget-x.cout_reel),consommation_budget:x.budget>0?arrondi(100*x.cout_reel/x.budget):null,
      marge_prevue:arrondi(x.revenus-x.cout_prevu)};
  });
}

function brancher(api,pool,route,journal){
  async function projet(db,projetId){
    const p=(await db.query('SELECT id,contrat_id,hopital_id FROM sh_projets WHERE id=$1',[projetId])).rows[0];
    if(!p)throw erreur(404,'Projet introuvable.');return p;
  }
  async function revenus(db,p){
    if(!p.contrat_id)return [];
    return (await db.query(`SELECT devise,sum(sous_total)::numeric(14,2) montant FROM sh_factures
      WHERE contrat_id=$1 AND statut='emise' GROUP BY devise`,[p.contrat_id])).rows;
  }
  api.get('/projets/:id/finances',route(async req=>{
    const p=await projet(pool,id(req.params.id));
    const lignes=(await pool.query(`SELECT f.*,u.nom cree_par_nom FROM sh_projet_finances f LEFT JOIN sh_utilisateurs u ON u.id=f.cree_par
      WHERE f.projet_id=$1 ORDER BY f.jour DESC,f.id DESC`,[p.id])).rows;
    const r=await revenus(pool,p);
    return {lignes,revenus:r,synthese:synthese(lignes,r),natures:NATURES,categories:CATEGORIES};
  }));
  api.post('/projets/:id/finances',route(async req=>{
    const b=req.body||{},nature=String(b.nature||''),categorie=String(b.categorie||''),libelle=String(b.libelle||'').trim().slice(0,200);
    if(!NATURES.includes(nature)||!CATEGORIES.includes(categorie)||libelle.length<2)throw erreur(400,'Nature, catégorie et libellé (2 caractères au moins) requis.');
    const devise=require('./international').normaliserDevise(b.devise||'CAD');
    require('./montants').verifierMontantDevise(b.montant,devise);
    if(Number(b.montant)<0)throw erreur(400,'Montant positif requis.');
    const jour=/^\d{4}-\d{2}-\d{2}$/.test(String(b.jour||''))?String(b.jour):require('./commercial').aujourdhui();
    return transaction(pool,async c=>{
      const p=await projet(c,id(req.params.id));
      const ligne=(await c.query(`INSERT INTO sh_projet_finances(projet_id,nature,categorie,libelle,montant,devise,jour,cree_par)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[p.id,nature,categorie,libelle,Number(b.montant),devise,jour,req.u.id])).rows[0];
      await journal(c,req.u,'Finances de projet modifiées',`projet ${p.id}`,`${nature} · ${categorie} · ${ligne.montant} ${devise}`,p.hopital_id);
      return ligne;
    });
  }));
  api.delete('/projets/:id/finances/:ligne',route(async req=>transaction(pool,async c=>{
    const p=await projet(c,id(req.params.id));
    const r=(await c.query('DELETE FROM sh_projet_finances WHERE id=$1 AND projet_id=$2 RETURNING nature,montant,devise',[id(req.params.ligne),p.id])).rows[0];
    if(!r)throw erreur(404,'Ligne financière introuvable.');
    await journal(c,req.u,'Finances de projet modifiées',`projet ${p.id}`,`suppression ${r.nature} · ${r.montant} ${r.devise}`,p.hopital_id);
    return {ok:true};
  })));
  /** Portefeuille : marges de chaque projet visible, par devise. */
  api.get('/finances/projets',route(async()=>{
    const projets=(await pool.query(`SELECT p.id,p.nom,p.statut,p.contrat_id,h.nom hopital FROM sh_projets p LEFT JOIN hopitaux h ON h.id=p.hopital_id
      WHERE p.archive_le IS NULL ORDER BY p.id`)).rows;
    const lignes=(await pool.query('SELECT projet_id,nature,devise,sum(montant)::numeric(14,2) montant FROM sh_projet_finances GROUP BY 1,2,3')).rows;
    const factures=(await pool.query(`SELECT p.id projet_id,f.devise,sum(f.sous_total)::numeric(14,2) montant FROM sh_projets p
      JOIN sh_factures f ON f.contrat_id=p.contrat_id AND f.statut='emise' GROUP BY 1,2`)).rows;
    return projets.map(p=>({...p,reference:`PRJ-${String(p.id).padStart(6,'0')}`,
      synthese:synthese(lignes.filter(l=>l.projet_id==p.id),factures.filter(f=>f.projet_id==p.id))})).filter(p=>p.synthese.length);
  }));
}
module.exports={brancher,synthese};
