'use strict';

// Brouillons éphémères pour la création supervisée de patients fictifs.
// Aucun champ n'est journalisé; seule la confirmation appelle l'API métier.
const crypto = require('node:crypto');
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const patients = require('./patients');
const DUREE_MS = 5 * 60 * 1000;
const MAX_PAR_UTILISATEUR = 10;
const brouillons = new Map();
const reservations = new Map();

function purger(now = Date.now()) {
  for (const [id, d] of brouillons) if (d.expire <= now && d.etat !== 'creation') brouillons.delete(id);
}
function acces(d, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  if (!d || d.utilisateurId !== utilisateur.id || d.etabId !== etabId) throw new ErreurHttp(404, 'brouillon_introuvable');
  if (d.expire <= Date.now()) { brouillons.delete(d.id); throw new ErreurHttp(410, 'brouillon_expire'); }
}
function presenter(d) {
  return { id:d.id, expire_le:new Date(d.expire).toISOString(), patient:{prenom:d.identite.prenom,nom:d.identite.nom,date_naissance:d.identite.date_naissance,
    reference_locale:d.identite.reference_locale}, doublons_possibles:d.doublons.map(x=>x.reference), necessite_confirmation_doublons:d.doublons.length>0,
    ...(d.etat==='cree'?{cree:true, resultat:d.resultat}: {}) };
}
async function creerBrouillon(db, utilisateur, etabId, entree) {
  patients.exigerFictifs(); exigerEtablissement(utilisateur, etabId); purger();
  const cle=`${utilisateur.id}:${etabId}`;
  const actifs=[...brouillons.values()].filter(d=>d.utilisateurId===utilisateur.id&&d.etabId===etabId&&d.expire>Date.now()&&d.etat!=='cree').length+(reservations.get(cle)||0);
  if (actifs>=MAX_PAR_UTILISATEUR) throw new ErreurHttp(429,'trop_brouillons_patient');
  const identite=patients.lireIdentite(entree);reservations.set(cle,(reservations.get(cle)||0)+1);
  try {
    const doublons=await patients.semblables(db,etabId,identite);
    const id=crypto.randomUUID(); const d={id,utilisateurId:utilisateur.id,etabId,identite,doublons,expire:Date.now()+DUREE_MS,etat:'brouillon',resultat:null,promesse:null};
    brouillons.set(id,d); return presenter(d);
  } finally {const restant=(reservations.get(cle)||1)-1;if(restant)reservations.set(cle,restant);else reservations.delete(cle);}
}
async function confirmerBrouillon(db, utilisateur, etabId, id, accepterDoublons=false) {
  const d=brouillons.get(String(id)); acces(d,utilisateur,etabId);
  if(d.etat==='cree')return presenter(d);
  if(d.etat==='creation')return d.promesse;
  // Revalider les doublons juste avant l'écriture. Toute évolution du jeu de
  // correspondances nécessite une nouvelle revue et un nouveau clic explicite.
  const actuels=await patients.semblables(db,etabId,d.identite);
  const refsActuels=[...new Set(actuels.map(x=>x.reference))].sort();
  const refsVus=[...new Set(d.doublons.map(x=>x.reference))].sort();
  if(JSON.stringify(refsActuels)!==JSON.stringify(refsVus)){
    d.doublons=actuels;return {...presenter(d),confirmation_requise:true,doublons_modifies:true};
  }
  if(d.doublons.length&&!accepterDoublons)return {...presenter(d),confirmation_requise:true};
  d.etat='creation';
  d.promesse=(async()=>{
    try {
      const resultat=await patients.creerPatient(db,utilisateur,etabId,{...d.identite,confirmer_doublon:d.doublons.length>0});
      d.resultat=resultat;d.etat='cree';d.expire=Date.now()+DUREE_MS;return presenter(d);
    } catch(e) { d.etat='brouillon';d.promesse=null;if(e.code==='patient_doublon_possible'){d.doublons=await patients.semblables(db,etabId,d.identite);return {...presenter(d),confirmation_requise:true,doublons_modifies:true};}throw e; }
  })();
  return d.promesse;
}
function annulerBrouillon(utilisateur, etabId, id) {
  const d=brouillons.get(String(id));acces(d,utilisateur,etabId);
  if(d.etat==='creation')throw new ErreurHttp(409,'brouillon_en_creation');
  brouillons.delete(d.id);return {annule:true};
}
module.exports={creerBrouillon,confirmerBrouillon,annulerBrouillon,purger,_brouillons:brouillons};
