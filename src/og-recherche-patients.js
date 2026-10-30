'use strict';

const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const { journaliser } = require('./regles');
const s = require('./services');
const { environnement } = require('./environnement');

function exigerModePatient() {
  if (!['demo', 'recette'].includes(environnement()) && process.env.ARRIMO_PATIENTS_FICTIFS !== '1') {
    throw new ErreurHttp(403, 'patients_reserve_demo');
  }
}

const normaliser = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-CA').replace(/[^a-z0-9]+/g, ' ').trim();
const normaliserPhrase = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[’']/g, ' ').replace(/[^a-z0-9\s/#\-]/g, ' ').replace(/\s+/g, ' ').trim();
const VERBES_RECHERCHE = /\b(?:cherche(?:r|z)?|recherche(?:r|z)?|retrouve(?:r|z)?|trouve(?:r|z)?|localise(?:r|z)?|identifie(?:r|z)?|affiche(?:r|z)?|montre(?:r|z)?|ouvr(?:e|ir|ez)|consulte(?:r|z)?|visualise(?:r|z)?|donne(?:r|z)?|voir|voyez|find|get|fetch|search|lookup|locate|show|open|view|display|retrieve|identify|see|bring(?:\s+up)?|pull(?:\s+up)?|look\s+(?:up|for))\b/i;
const MOTS_SANS_IDENTITE = new Set(['a','an','the','le','la','les','un','une','des','du','de','au','for','of','with','by','name','nom','named','called','patient','patients','dossier','fiche','record','file','profile','me','moi','nous','please','svp','s','son','sa','ses','his','her','their','him','elle','il','where','what','who','status','history','movement','room','bed','lit','transfert','transfer','admission','attente','waiting','list']);
function extraireRecherche(question) {
  let q = normaliserPhrase(question).replace(/^\s*(?:hey\s+)?og\s+/, '').trim();
  const m = VERBES_RECHERCHE.exec(q);
  if (!m) return null;
  let terme = q.slice(m.index + m[0].length).trim().replace(/^[\s:;,\-]+|[\s?!.;,]+$/g, ' ');
  let suffixe;
  do { suffixe=terme; terme=terme.replace(/\s+(?:s|dossier|fiche|record|file|profile|patient|patients|please|svp)$/i,'').trim(); } while(terme!==suffixe);
  const prefixes = /^(?:me|moi|nous|please|svp|s il te plait|a|an|the|le|la|les|un|une|des|du|de|au|for|of|with|by|name|nom|patient|patients|dossier|fiche|record|file|profile|named|called|nomme|appele|numero|number|reference|identifiant|identifier|id)\s+/i;
  let precedent;
  do { precedent = terme; terme = terme.replace(prefixes, '').trim(); } while (terme !== precedent);
  if (!terme || terme.length < 2 || terme.length > 120) return null;
  if (/\b(?:lit|lits|bed|beds|chambre|chambres|room|rooms|service|unit|transfert|transferts|transfer|transfers|admission|admissions|civiere|civieres|stretcher|stretchers|waiting list|nettoyage|cleaning)\b/i.test(terme)) return null;
  if (/\b(?:TR-\d+|ADMISSION\s*(?:N[°O]\s*|#\s*)\d+)\b/i.test(terme)) return null;
  const tokens = terme.split(/\s+/).filter(Boolean);
  if (!tokens.some(x => !MOTS_SANS_IDENTITE.has(x.toLowerCase()))) return null;
  return terme;
}
function estQuestionSuivi(question) {
  const q=normaliserPhrase(question);
  const sujet=/\b(?:patient|dossier|fiche|record|file|il|elle|lui|son|sa|ses|he|she|him|her|they|them|their)\b/.test(q);
  const fait=/\b(?:ou est|ou se trouve|dans quel|depuis quand|combien de temps|statut|admis|admission|transfere\w*|mouvement\w*|historique\w*|lit|civiere|quelle chambre|where|room|location|since when|how long|status|admitted|transfer\w*|movement\w*|history|bed|stretcher|record|file|dossier|fiche)\b/.test(q);
  return sujet&&fait;
}
function distance(a, b) {
  const ligne = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonale = ligne[0]; ligne[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const haut = ligne[j];
      ligne[j] = Math.min(ligne[j] + 1, ligne[j - 1] + 1, diagonale + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonale = haut;
    }
  }
  return ligne[b.length];
}
function scoreNom(nom, recherche) {
  if (!recherche || nom === recherche) return recherche ? 1 : 0;
  if (nom.includes(recherche)) return 0.92;
  const mots = nom.split(' '); const requetes = recherche.split(' ');
  let total = 0;
  for (const r of requetes) {
    const meilleur = Math.max(...mots.map(m => m.startsWith(r) ? 0.85 : 1 - distance(m, r) / Math.max(m.length, r.length)));
    if (meilleur < 0.68) return 0;
    total += meilleur;
  }
  return total / requetes.length;
}
function estDate(q) { return /^\d{4}-\d{2}-\d{2}$/.test(String(q)); }
function presentation(p) {
  return { id: p.id, reference: p.reference, prenom: p.prenom, nom: p.nom };
}

/** Recherche limitée à un établissement explicitement autorisé. Les noms et dates ne sont jamais renvoyés par les listes d'OG. */
async function rechercher(pool, utilisateur, etabId, requete) {
  exigerModePatient(); exigerEtablissement(utilisateur, etabId);
  const etab = await s.etablissement(pool, etabId); s.exigerActif(etab);
  const q = String(requete || '').trim().slice(0, 120);
  if (q.length < 2) throw new ErreurHttp(400, 'recherche_trop_courte');
  const dateDansTexte = /(?:^|\s)(\d{4}-\d{2}-\d{2})$/.exec(q);
  const date = estDate(q) ? q : dateDansTexte?.[1] || null;
  const texteNom = estDate(q) ? '' : dateDansTexte ? q.slice(0,dateDansTexte.index).trim() : q;
  const norm = normaliser(texteNom);
  const identifiant = texteNom.toUpperCase();
  const rows = (await pool.query(`SELECT p.id,p.reference,p.reference_locale,p.prenom,p.nom,p.date_naissance
    FROM patients p
    WHERE p.etablissement_id=$1
    ORDER BY CASE WHEN p.reference=$2 OR upper(coalesce(p.reference_locale,''))=$2 THEN 0 ELSE 1 END,
      p.modifie_le DESC,p.id LIMIT 501`, [etabId, identifiant])).rows;
  const tronque = rows.length > 500; rows.length = Math.min(rows.length, 500);
  const uniques = [...new Map(rows.map(p => [p.id,p])).values()];
  const candidats = uniques.map(p => ({ p, score: Math.max(scoreNom(normaliser(`${p.prenom} ${p.nom}`), norm), scoreNom(normaliser(`${p.nom} ${p.prenom}`), norm)) }))
    .filter(({ p, score }) => (date ? String(p.date_naissance).slice(0,10) === date : true)
      && (norm ? score >= 0.68 || p.reference.toUpperCase() === identifiant || p.reference_locale?.toUpperCase() === identifiant : !!date))
    .sort((a,b) => Number(b.p.reference.toUpperCase()===identifiant || b.p.reference_locale?.toUpperCase()===identifiant)
      - Number(a.p.reference.toUpperCase()===identifiant || a.p.reference_locale?.toUpperCase()===identifiant) || b.score-a.score || a.p.id-b.p.id);
  const plus = candidats.length>10 || tronque;
  const resultat = candidats.slice(0,10).map(({p}) => presentation(p));
  await journaliser(pool, { etablissementId: etabId, utilisateurId: utilisateur.id, action: 'Recherche patient OG' });
  return { resultats: resultat, ambigue: candidats.length > 1, limite: plus };
}

/** Fiche opérationnelle, avec toutes les lectures re-vérifiées dans le même établissement. */
async function consulter(pool, utilisateur, etabId, patientId) {
  exigerModePatient(); exigerEtablissement(utilisateur, etabId);
  const etab = await s.etablissement(pool, etabId); s.exigerActif(etab);
  const p = (await pool.query(`SELECT id,reference,reference_locale,prenom,nom,date_naissance,parcours,arrivee_le,cree_le,modifie_le
    FROM patients WHERE id=$1 AND etablissement_id=$2`, [patientId, etabId])).rows[0];
  if (!p) throw new ErreurHttp(404, 'patient_introuvable');
  const [lits, civieres, admissions, transferts, alertes, historique] = await Promise.all([
    pool.query(`SELECT l.code AS lit,l.etat,l.etat_depuis,u.nom AS unite,ch.numero AS chambre FROM lits l
      JOIN unites u ON u.id=l.unite_id JOIN chambres ch ON ch.id=l.chambre_id
      WHERE l.etablissement_id=$1 AND l.patient_ref=$2 AND l.etat IN ('occupe','reserve') ORDER BY l.id`, [etabId,p.reference]),
    pool.query(`SELECT code,etat,arrivee_le FROM civieres WHERE etablissement_id=$1 AND patient_ref=$2 AND etat='occupee' ORDER BY id`,[etabId,p.reference]),
    pool.query(`SELECT id,statut,cree_le,priorite FROM demandes_admission WHERE etablissement_id=$1
      AND (patient_id=$2 OR patient_ref=$3) ORDER BY cree_le DESC,id DESC`,[etabId,p.id,p.reference]),
    pool.query(`SELECT id,numero,statut,patient_ref,origine_id,destination_id,date_demande,date_validation,date_depart,date_reception,
        origine.nom AS origine_nom,destination.nom AS destination_nom
      FROM transferts t JOIN etablissements origine ON origine.id=t.origine_id JOIN etablissements destination ON destination.id=t.destination_id
      WHERE t.patient_ref=$1 AND (t.origine_id=$2 OR t.destination_id=$2)
      ORDER BY t.date_demande DESC,t.id DESC`,[p.reference,etabId]),
    pool.query(`SELECT date,message,lu FROM notifications WHERE etablissement_id=$1 AND transfert_id IN
      (SELECT id FROM transferts WHERE patient_ref=$2 AND (origine_id=$1 OR destination_id=$1)) ORDER BY date DESC LIMIT 50`,[etabId,p.reference]),
    pool.query(`SELECT date,action,ancien_etat,nouvel_etat,detail,transfert_id FROM journal WHERE etablissement_id=$1
      AND (detail ILIKE '%'||$2||'%' OR transfert_id IN
        (SELECT id FROM transferts WHERE patient_ref=$2 AND (origine_id=$1 OR destination_id=$1)))
      ORDER BY date DESC,id DESC LIMIT 100`,[etabId,p.reference]),
  ]);
  const refPattern=new RegExp(`(?<![A-Z0-9])${p.reference.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![A-Z0-9])`,'i');
  const mouvements=historique.rows.filter(x=>x.transfert_id||refPattern.test(x.detail||''));
  await journaliser(pool, { etablissementId: etabId, utilisateurId: utilisateur.id, action: 'Consultation fiche patient OG' });
  return { patient: { ...p, date_naissance: String(p.date_naissance).slice(0,10) }, etablissement: { id:etab.id,nom:etab.nom },
    lits:lits.rows,civieres:civieres.rows,admissions:admissions.rows,transferts:transferts.rows,alertes:alertes.rows,historique:mouvements };
}

module.exports = { rechercher, consulter, normaliser, normaliserPhrase, extraireRecherche, estQuestionSuivi, distance, scoreNom };
