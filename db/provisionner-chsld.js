'use strict';
/**
 * Deux CHSLD fictifs créés depuis Arrimo SH (jamais configurés à la main sur le serveur) :
 *   1. provisionner() : uniquement les API de la console SH — fiche (type CHSLD, modules), relier à l'environnement,
 *      import CSV de la structure (unités, chambres individuelles et doubles, lits) et des comptes, liste de contrôle, activation.
 *   2. peupler() : uniquement les API d'Arrimo, avec les comptes du personnel — résidents, contacts, demandes,
 *      hospitalisation à l'Hôpital B et retour, transfert inter-CHSLD, tâches. Données synthétiques seulement.
 */
const CHSLD = [
  { code: 'CHSLD-ERA', nom: 'CHSLD des Érables', ville: 'Val-des-Pins', latitude: 45.392, longitude: -71.905, prefixe: 'ERA', courriel: 'erables',
    unites: [['Unité des Pins', 'HLD', 14, 5], ['Unité des Lilas', 'HLD', 10, 5], ['Unité prothétique Le Phare', 'PROT', 16, 0]] },
  { code: 'CHSLD-STL', nom: 'CHSLD du Saint-Laurent', ville: 'Mont-Clair', latitude: 45.288, longitude: -72.135, prefixe: 'STL', courriel: 'saint-laurent',
    unites: [['Unité du Fleuve', 'HLD', 18, 9], ['Unité des Îles', 'HLD', 12, 9], ['Unité Transition', 'TEMP', 24, 0]] },
];
// [unité, type, chambres individuelles, chambres doubles] : 60 lits pour les Érables (14+2×5, 10+2×5, 16) ; 90 pour le Saint-Laurent (18+2×9, 12+2×9, 24)
const ROLES = [['Direction', 'direction', 'admin_etab'], ['Coordination de l’hébergement', 'coordination', 'coordonnateur'], ['Équipe de soins', 'soins', 'equipe_soins'], ['Entretien', 'entretien', 'entretien']];
const courrielDe = (c, r) => `${r}.${c.courriel}@chsld.example.invalid`;

function csvChsld(c) {
  const lignes = { departements: ['departement;code', 'Hébergement;HEB'], services: ['service;code;departement', 'Hébergement de longue durée;HLD;Hébergement'],
    unites: ['unite;type_unite;service;departement'], chambres: ['unite;chambre;type_chambre;capacite'], lits: ['unite;chambre;lit'], utilisateurs: ['nom;courriel;role'] };
  c.unites.forEach(([unite, type, simples, doubles], iu) => {
    lignes.unites.push(`${unite};${type};HLD;Hébergement`);
    let n = (iu + 1) * 100;
    for (let i = 0; i < simples; i += 1) { n += 1; lignes.chambres.push(`${unite};${n};individuelle;1`); lignes.lits.push(`${unite};${n};${c.prefixe}-${n}`); }
    for (let i = 0; i < doubles; i += 1) { n += 1; lignes.chambres.push(`${unite};${n};double;2`); lignes.lits.push(`${unite};${n};${c.prefixe}-${n}A`, `${unite};${n};${c.prefixe}-${n}B`); }
  });
  for (const [nom, cle] of ROLES) lignes.utilisateurs.push(`${nom} · ${c.nom};${courrielDe(c, cle)};${ROLES.find((r) => r[1] === cle)[2]}`);
  return Object.fromEntries(Object.entries(lignes).map(([k, v]) => [k, `${v.join('\n')}\n`]));
}

/** Crée et active les deux CHSLD par la console SH. `sh(methode, chemin, corps)` appelle l'API SH avec un compte administrateur. */
async function provisionner(sh, { environnement = 'pilote', modules = {} } = {}) {
  const resultats = [];
  for (const c of CHSLD) {
    const h = await sh('POST', '/hopitaux', { type_etablissement: 'chsld', modules, nom: c.nom, code_etab: c.code, environnement, pays_code: 'CA', ville: c.ville,
      latitude: c.latitude, longitude: c.longitude, utilisateurs_prevus: ROLES.length, utilisateurs_autorises: ROLES.length + 4, contact_nom: `Direction fictive · ${c.nom}` });
    await sh('POST', `/hopitaux/${h.id}/relier`, {});
    const csv = csvChsld(c);
    for (const type of ['departements', 'services', 'unites', 'chambres', 'lits', 'utilisateurs']) {
      const v = await sh('POST', `/hopitaux/${h.id}/import/verifier`, { type, contenu: csv[type] });
      if (v.nb_erreurs) throw new Error(`${c.code} ${type} : ${JSON.stringify(v.erreurs).slice(0, 400)}`);
      await sh('POST', `/hopitaux/${h.id}/import/importer`, { type, contenu: csv[type], empreinte: v.empreinte });
    }
    let fiche = await sh('GET', `/hopitaux/${h.id}`);
    for (const el of fiche.formation.flatMap((x) => x.elements)) await sh('PUT', `/formation/${el.id}`, { faite: true });
    fiche = await sh('GET', `/hopitaux/${h.id}`);
    for (const v of fiche.etapes.filter((e) => e.rang < 6).flatMap((e) => e.verifications).filter((v) => !v.faite)) await sh('PUT', `/verifications/${v.id}`, { faite: true });
    await sh('POST', `/hopitaux/${h.id}/activation`, {});
    resultats.push({ ...c, hopital_id: h.id, comptes: Object.fromEntries(ROLES.map(([, cle, role]) => [cle, { courriel: courrielDe(c, cle), role }])) });
  }
  return resultats;
}

const PRENOMS = ['Jeanne', 'Paul', 'Lucienne', 'Roger', 'Gisèle', 'Marcel', 'Thérèse', 'Gaston', 'Yvette', 'Rolland', 'Simone', 'Fernand', 'Cécile', 'Lucien', 'Rita', 'Gérard', 'Pierrette', 'Armand', 'Jacqueline', 'Raymond'];
const NOMS = ['Tremblay', 'Gagnon', 'Roy', 'Côté', 'Bouchard', 'Gauthier', 'Morin', 'Lavoie', 'Fortin', 'Gagné', 'Ouellet', 'Pelletier', 'Bélanger', 'Lévesque', 'Bergeron', 'Leblanc', 'Paquette', 'Girard', 'Simard', 'Boucher'];
/**
 * Données opérationnelles saisies par le personnel (API d'Arrimo). `api(qui, methode, chemin, corps)` : qui = clé de session.
 * Scénarios : Jean Dupont (Érables, deux contacts aux autorisations distinctes), Gilles Martin (Saint-Laurent, hospitalisé à l'Hôpital B,
 * retour proposé par l'hôpital), transfert inter-CHSLD en attente, demandes d'hébergement, places en préparation, tâches.
 */
async function peupler(api, { erables, stLaurent, hopitalB }) {
  const etab = async (qui) => (await api(qui, 'GET', '/moi')).etablissements[0].id;
  const ids = { era: await etab('era'), stl: await etab('stl') };
  const places = async (qui, e) => (await api(qui, 'GET', `/chsld/places?etablissement_id=${e}`));
  async function admettre(qui, e, identite, { contacts = [], arrivee = true } = {}) {
    const libre = (await places(qui, e)).find((p) => p.etat === 'libre');
    const r = await api(qui, 'POST', '/chsld/residents', { etablissement_id: e, ...identite, contacts });
    const r2 = await api(qui, 'POST', `/chsld/residents/${r.id}/reserver-place`, { lit_id: libre.id, version: libre.version, version_resident: r.version });
    return arrivee ? api(qui, 'POST', `/chsld/residents/${r.id}/arrivee`, { version: r2.version }) : r2;
  }
  const naissance = (i) => `19${30 + (i % 15)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`;
  // Jean Dupont : deux proches, autorisations distinctes (la fille reçoit l'administratif et les mouvements ; le fils est seulement à prévenir)
  const dupont = await admettre('era', ids.era, { prenom: 'Jean', nom: 'Dupont', date_naissance: '1938-04-02', langue: 'fr', accessibilite: ['deambulateur'] }, { contacts: [
    { prenom: 'Marie', nom: 'Dupont', relation: 'fille', telephone: '555-0101', courriel: 'marie.dupont@example.invalid', principal: true, rang: 1, proche_aidant: true, autorisations: ['administratif', 'hebergement', 'mouvements', 'rendez_vous'], disponibilites: 'En semaine après 17 h' },
    { prenom: 'Luc', nom: 'Dupont', relation: 'fils', telephone: '555-0102', rang: 2, autorisations: [] }] });
  // Remplissage réaliste : 50 résidents aux Érables, 76 au Saint-Laurent
  for (let i = 0; i < 49; i += 1) await admettre('era', ids.era, { prenom: PRENOMS[i % 20], nom: `${NOMS[(i * 7) % 20]}-Era${i}`, date_naissance: naissance(i) },
    { contacts: [{ prenom: 'Proche', nom: NOMS[(i * 3) % 20], relation: ['fille', 'fils', 'conjoint', 'soeur'][i % 4], telephone: `555-1${String(i).padStart(3, '0')}`, principal: true, autorisations: i % 3 ? ['administratif'] : [] }] });
  const martin = await admettre('stl', ids.stl, { prenom: 'Gilles', nom: 'Martin', date_naissance: '1942-09-15', langue: 'fr' }, { contacts: [
    { prenom: 'Sylvie', nom: 'Martin', relation: 'conjoint', telephone: '555-0201', principal: true, autorisations: ['administratif', 'mouvements'] }] });
  for (let i = 0; i < 75; i += 1) await admettre('stl', ids.stl, { prenom: PRENOMS[(i + 5) % 20], nom: `${NOMS[(i * 11) % 20]}-Stl${i}`, date_naissance: naissance(i + 3) },
    { contacts: [{ prenom: 'Proche', nom: NOMS[(i * 5) % 20], relation: ['fils', 'fille', 'frere', 'ami'][i % 4], courriel: `proche.stl${i}@example.invalid`, principal: true, autorisations: i % 2 ? ['administratif', 'mouvements'] : [] }] });
  // Accueils prévus (place réservée, arrivée à confirmer)
  await admettre('era', ids.era, { prenom: 'Yolande', nom: 'Bérubé', date_naissance: '1940-06-11', arrivee_prevue: new Date(Date.now() + 86400000).toISOString().slice(0, 10) }, { arrivee: false,
    contacts: [{ prenom: 'Nadia', nom: 'Bérubé', relation: 'petit_enfant', telephone: '555-0301', principal: true, autorisations: ['administratif'] }] });
  // Places en préparation et bloquée (fin d'hébergement, changement de chambre, travaux)
  const listeEra = await api('era', 'GET', `/chsld/residents?etablissement_id=${ids.era}`);
  const fin = listeEra.find((r) => r.nom.endsWith('-Era3'));
  await api('era', 'POST', `/chsld/residents/${fin.id}/sortie`, { version: fin.version, motif: 'autre_milieu' });
  const libre = (await places('era', ids.era)).find((p) => p.etat === 'libre');
  await api('era', 'POST', `/lits/${libre.id}/action`, { action: 'hors_service', version: libre.version, motif: 'travaux' });
  // Demandes d'hébergement : documents manquants, en vérification
  await api('era', 'POST', '/chsld/demandes', { etablissement_id: ids.era, provenance: 'mecanisme_acces', reference_externe: 'MA-2026-0412', prenom: 'Réjean', nom: 'Côté', date_naissance: '1937-02-20', documents_recus: ['formulaire_mecanisme', 'identite'] });
  const d2 = await api('stl', 'POST', '/chsld/demandes', { etablissement_id: ids.stl, provenance: 'hopital', reference_externe: 'MA-2026-0418', prenom: 'Huguette', nom: 'Lapointe', date_naissance: '1935-11-03',
    documents_recus: ['formulaire_mecanisme', 'identite', 'carte_assurance_maladie', 'mandat_representant', 'consentement_hebergement'] });
  await api('stl', 'POST', `/chsld/demandes/${d2.id}/action`, { action: 'verifier', version: d2.version });
  // Gilles Martin : départ vers l'Hôpital B, réception confirmée par l'hôpital, retour proposé par l'hôpital
  const fm = (await api('stl', 'GET', `/chsld/residents/${martin.id}`)).resident;
  const co = await api('stl', 'POST', `/chsld/residents/${martin.id}/hospitalisation`, { hopital_id: hopitalB, identite_verifiee: true, motif_admin: 'Transfert vers l’urgence demandé par l’équipe', version: fm.version });
  const co2 = await api('stl', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.stl, action: 'confirmer_depart', version: co.version });
  const co3 = await api('b', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: hopitalB, action: 'confirmer_reception', version: co2.version });
  const retour = await api('b', 'POST', `/coordinations/${co.id}/retour`, { retour_prevu_le: new Date(Date.now() + 2 * 86400000).toISOString(), motif_admin: 'Congé prévu' });
  // Transfert inter-CHSLD : demande du Saint-Laurent vers les Érables, en attente de la confirmation des responsables
  const stlListe = await api('stl', 'GET', `/chsld/residents?etablissement_id=${ids.stl}`);
  const aTransferer = stlListe.find((r) => r.nom.endsWith('-Stl1'));
  const tr = await api('stl', 'POST', `/chsld/residents/${aTransferer.id}/transfert-chsld`, { destination_id: ids.era, motif_admin: 'Rapprochement familial demandé', version: aTransferer.version });
  // Tâches et transmissions
  await api('era', 'POST', '/chsld/taches', { etablissement_id: ids.era, type: 'transmission', titre: 'Transmission de soir : visite de la famille Dupont prévue samedi', assigne_role: 'equipe_soins' });
  await api('stl', 'POST', '/chsld/taches', { etablissement_id: ids.stl, type: 'relance', titre: 'Relancer le mécanisme d’accès pour MA-2026-0418', assigne_role: 'coordonnateur', echeance: new Date(Date.now() - 3600000).toISOString() });
  return { ids, dupont: dupont.id, martin: martin.id, hospitalisation: co3.id, retour: retour.id, transfert: tr.id };
}
module.exports = { CHSLD, ROLES, csvChsld, provisionner, peupler, courrielDe };
