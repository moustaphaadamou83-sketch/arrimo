'use strict';
const OgLangue=require('../public/og-langue');
/** Langue de la réponse : demande explicite (« réponds en anglais »), sinon langue de la question,
 *  sinon préférence de conversation (question ambiguë, ex. une référence seule). Aucun appel de traduction externe. */
function langueDemandee(question,langue='fr'){return OgLangue.langueReponse(question,langue);}
const EVENEMENTS={
  'Référence transmise':'Reference sent','Transfert validé':'Transfer approved','Chambre prête':'Room ready',
  'Transport organisé':'Transport arranged','Civière':'Stretcher','Départ confirmé':'Departure confirmed',
  'Changement d’état':'Status change','Patient reçu':'Patient received','Transfert refusé':'Transfer declined',
  'Admission enregistrée':'Admission recorded','Arrivée enregistrée à l’origine':'Arrival recorded at origin',
  'Demande de lit':'Bed request','Demande de transfert':'Transfer request','Acceptation':'Acceptance','Réception':'Receipt',
};
const ETATS={attente:'waiting',assignee:'assigned',admise:'admitted',admis:'admitted',transferee:'transferred',annulee:'cancelled',
  urgence:'emergency',hospitalisation:'inpatient',externe:'external',occupe:'occupied',reserve:'reserved'};
const nomEtablissement=(nom,langue)=>langue==='en'?String(nom).replace(/^Hôpital ([ABC]) — /,'Hospital $1 — '):nom;
module.exports={langueDemandee,EVENEMENTS,ETATS,nomEtablissement};
