'use strict';
/**
 * Demandes du site ↔ CRM.
 *  - prospect(c, demande) : chaque demande crée (ou complète) un prospect : organisation, contact, demande rattachée, note d'historique.
 *    Pas de doublon : le contact est retrouvé par son courriel ; l'organisation par le contact, sinon par son nom exact.
 *    Une fiche existante est complétée (champs vides seulement), jamais écrasée.
 *  - Courriels des demandes : accusé de réception automatique (FR ou EN, sans donnée de la demande, au plus un par adresse et par 24 h)
 *    et réponses de l'équipe, par une file avec reprises. Le texte des réponses est conservé : c'est l'historique du contact.
 *  - Expéditeurs : SH_COURRIEL_NOREPLY (accusés) et SH_COURRIEL_CONTACT (réponses), sinon COURRIEL_EXPEDITEUR. Aucun secret ici.
 */
const crypto = require('node:crypto');
const { transaction } = require('../db');
const courriel = require('../courriel');

const ACCUSE = {
  fr: { sujet: 'Arrimo · Nous avons bien reçu votre demande',
    texte: (ref) => `Bonjour,\n\nNous avons bien reçu votre demande (référence ${ref}). Un membre de notre équipe vous contactera dans les prochains jours ouvrables.\n\nL’équipe Arrimo\nSenseAfri Group\n\nCeci est un message automatique, merci de ne pas y répondre.` },
  en: { sujet: 'Arrimo · We have received your request',
    texte: (ref) => `Hello,\n\nWe have received your request (reference ${ref}). A member of our team will contact you within the next business days.\n\nThe Arrimo team\nSenseAfri Group\n\nThis is an automated message; please do not reply.` },
};
const reference = (id) => `D-${String(id).padStart(6, '0')}`;
const langueCourriel = (d) => (['fr', 'en'].includes(d.langue_contact) ? d.langue_contact : d.langue === 'en' ? 'en' : 'fr');

async function prospect(c, d) {
  let contact = (await c.query('SELECT * FROM sh_crm_contacts WHERE lower(courriel) = lower($1) ORDER BY id LIMIT 1 FOR UPDATE', [d.courriel])).rows[0];
  let org = contact ? (await c.query('SELECT * FROM sh_crm_organisations WHERE id = $1 FOR UPDATE', [contact.organisation_id])).rows[0] : null;
  if (!org) org = (await c.query('SELECT * FROM sh_crm_organisations WHERE lower(nom) = lower($1) ORDER BY id LIMIT 1 FOR UPDATE', [d.organisation])).rows[0];
  let orgCree = false;
  if (!org) {
    org = (await c.query(`INSERT INTO sh_crm_organisations (nom, type, pays_code, ville, etape, origine, notes)
      VALUES ($1, 'prospect', $2, $3, 'prospect', 'site', $4) RETURNING *`,
    [d.organisation, d.pays_code || 'CA', d.ville, d.type_organisation ? `Type d’organisation déclaré : ${d.type_organisation}` : null])).rows[0];
    orgCree = true;
  } else {
    await c.query('UPDATE sh_crm_organisations SET ville = COALESCE(ville, $2), modifie_le = now() WHERE id = $1', [org.id, d.ville]);
  }
  if (!contact) {
    contact = (await c.query(`INSERT INTO sh_crm_contacts (organisation_id, nom, fonction, courriel, telephone, pays_code, ville, langue_contact)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [org.id, d.nom, d.fonction, d.courriel, d.telephone, d.pays_code, d.ville, d.langue_contact])).rows[0];
  } else {
    await c.query(`UPDATE sh_crm_contacts SET fonction = COALESCE(fonction, $2), telephone = COALESCE(telephone, $3), pays_code = COALESCE(pays_code, $4),
      ville = COALESCE(ville, $5), langue_contact = COALESCE(langue_contact, $6), modifie_le = now() WHERE id = $1`,
    [contact.id, d.fonction, d.telephone, d.pays_code, d.ville, d.langue_contact]);
  }
  await c.query('UPDATE sh_demandes_site SET organisation_id = $2, contact_id = $3 WHERE id = $1', [d.id, org.id, contact.id]);
  await c.query(`INSERT INTO sh_activites (organisation_id, type, titre, contenu, terminee_le) VALUES ($1, 'note', $2, $3, now())`,
    [org.id, `Demande du site ${reference(d.id)} (${d.type})`, `Reçue par le formulaire du site. Contact : ${d.nom}.`]);
  return { organisation_id: org.id, contact_id: contact.id, organisation_creee: orgCree };
}

async function mettreEnFile(c, { demande = null, organisation = null, genre, destinataire, langue, sujet, texte, par = null }) {
  return (await c.query(`INSERT INTO sh_demandes_courriels (demande_id, organisation_id, genre, destinataire, langue, sujet, texte, cree_par, cle)
    VALUES ($1,$2,$3,lower($4),$5,$6,$7,$8,$9) RETURNING id`, [demande, organisation, genre, destinataire, langue, sujet, texte, par, crypto.randomUUID()])).rows[0].id;
}

/** Accusé de réception d'une nouvelle demande (au plus un par adresse et par 24 heures). */
async function accuser(c, d) {
  const deja = (await c.query(`SELECT 1 FROM sh_demandes_courriels WHERE genre = 'accuse' AND lower(destinataire) = lower($1) AND cree_le > now() - interval '24 hours'`, [d.courriel])).rowCount;
  if (deja) return false;
  const l = langueCourriel(d);
  await mettreEnFile(c, { demande: d.id, organisation: d.organisation_id, genre: 'accuse', destinataire: d.courriel, langue: l, sujet: ACCUSE[l].sujet, texte: ACCUSE[l].texte(reference(d.id)) });
  return true;
}

async function executer(pool, { env = process.env, limite = 30 } = {}) {
  if (!courriel.actif(env.SH_PUBLIC_URL, env)) return { actif: false, envoyes: 0, echecs: 0 };
  const lignes = await transaction(pool, async (c) => {
    const rows = (await c.query(`SELECT * FROM sh_demandes_courriels WHERE (etat = 'en_attente' AND prochaine_tentative <= now()) OR (etat = 'envoi' AND verrou_jusqua < now())
      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $1`, [Math.max(1, Math.min(100, limite))])).rows;
    for (const x of rows) await c.query("UPDATE sh_demandes_courriels SET etat = 'envoi', tentatives = tentatives + 1, verrou_jusqua = now() + interval '2 minutes' WHERE id = $1", [x.id]);
    return rows;
  });
  let envoyes = 0, echecs = 0;
  for (const x of lignes) {
    try {
      const de = x.genre === 'accuse' ? env.SH_COURRIEL_NOREPLY : env.SH_COURRIEL_CONTACT;
      await courriel.envoyer({ a: x.destinataire, sujet: x.sujet, texte: x.texte, ...(de ? { de } : {}) }, env);
      await pool.query("UPDATE sh_demandes_courriels SET etat = 'envoye', envoye_le = now(), verrou_jusqua = NULL, dernier_code = NULL WHERE id = $1", [x.id]); envoyes += 1;
    } catch (e) {
      const t = (await pool.query('SELECT tentatives FROM sh_demandes_courriels WHERE id = $1', [x.id])).rows[0]?.tentatives || 1;
      const code = String(e.code || e.name || 'ERREUR').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'ERREUR';
      await pool.query('UPDATE sh_demandes_courriels SET etat = $2, verrou_jusqua = NULL, prochaine_tentative = now() + make_interval(secs => $3::int), dernier_code = $4 WHERE id = $1',
        [x.id, t >= 8 ? 'abandonne' : 'en_attente', Math.min(21600, 30 * 2 ** Math.min(t - 1, 10)), code]); echecs += 1;
    }
  }
  return { actif: true, envoyes, echecs };
}

module.exports = { prospect, accuser, mettreEnFile, executer, reference, langueCourriel, ACCUSE };
