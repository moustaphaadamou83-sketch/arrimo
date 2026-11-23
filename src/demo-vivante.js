'use strict';
/**
 * Démo vivante (22 nov. 2026, retour de Moustafa sur la démo de l'Hôpital A) — ENVIRONNEMENT DE DÉMONSTRATION SEULEMENT.
 * Garde en place, à toute heure, des scénarios fictifs qui font partie de l'état de référence de la démo :
 *  - Chrono (Hôpital A) : une ambulance en route (arrivée dans ~6 min), une ambulance à la porte depuis ~23 min (chrono rouge),
 *    au moins un passage terminé dans les 12 dernières heures ; une ambulance restée plus de 50 min est clôturée avec des heures plausibles.
 *  - Transports (Hôpital A) : un retour à domicile demain 10 h, confirmé ; un départ NSA en attente de réponse du transporteur.
 *  - Bourse : une RPA, une RI, une maison de soins palliatifs, un programme d'hospitalisation à domicile et une ressource en santé mentale,
 *    avec places libres et à venir et des capacités différentes (lève-personne, unité sécurisée, oxygène) ; créées par la même fonction
 *    que la console SH (creerEtablissement), journalisées.
 *  - Région de la démo : Mauricie-et-Centre-du-Québec (CA-QC-04).
 * Les heures sont recalées à chaque passage (toutes les 5 minutes et au démarrage) : la démo reste parlante après une remise à zéro.
 * Aucune donnée réelle, aucun diagnostic ; heures dans l'Horloge avec la source « systeme ».
 */
const { transaction } = require('./db');
const { environnement } = require('./environnement');
const horloge = require('./horloge');

const HOPITAL = 'HX';
const REGION = 'CA-QC-04';
const MARQUE = 'demo-vivante';
// Ressources de la Bourse : position relative à l'Hôpital A (degrés), capacités, places libres déclarées, places à venir (jours)
const RESSOURCES = [
  { code: 'RPA-TIL', nom: 'Résidence des Tilleuls (fictive)', local: 'rpa', libelle: 'RPA', libelle_en: 'RPA', d: [0.02, 0.01], capacites: ['marchette'], libres: 3, a_venir: [5] },
  { code: 'RI-RUIS', nom: 'RI du Ruisseau (fictive)', local: 'ri', libelle: 'Ressource intermédiaire', libelle_en: 'Intermediate resource', d: [-0.05, 0.04], capacites: ['marchette', 'fauteuil', 'leve_personne'], libres: 1, a_venir: [3, 9] },
  { code: 'PAL-AUBE', nom: 'Maison de soins palliatifs L’Aube (fictive)', local: 'soins_palliatifs', libelle: 'Maison de soins palliatifs', libelle_en: 'Palliative care home', d: [0.11, -0.08], capacites: ['fauteuil', 'leve_personne', 'oxygene'], libres: 1, a_venir: [2] },
  { code: 'HAD-VDP', nom: 'Hospitalisation à domicile Val-des-Pins (fictive)', local: 'hospitalisation_domicile', libelle: 'Hospitalisation à domicile', libelle_en: 'Hospital at home', d: [0.005, -0.006], capacites: ['oxygene'], libres: 4, a_venir: [] },
  { code: 'SM-PHARE', nom: 'Ressource en santé mentale Le Phare (fictive)', local: 'sante_mentale', libelle: 'Ressource en santé mentale', libelle_en: 'Mental health resource', d: [-0.03, -0.05], capacites: ['unite_securisee', 'marchette'], libres: 2, a_venir: [7] },
];

async function region(pool) {
  const r = (await pool.query('SELECT id FROM regions WHERE code = $1', [REGION])).rows[0];
  if (!r) return null;
  const ancienne = (await pool.query("SELECT id FROM regions WHERE code = 'CA-QC-06'")).rows[0];
  // La démo avait été rangée par erreur à Montréal (06) : tout ce qui y était passe en Mauricie-et-Centre-du-Québec (04), une seule fois
  for (const t of ['etablissements', 'organisations_secours', 'directions_regionales']) {
    await pool.query(`UPDATE ${t} SET region_id = $1 WHERE region_id IS NULL OR region_id = $2`, [r.id, ancienne?.id ?? -1]);
  }
  return r.id;
}

async function ressources(pool, hop, regionId) {
  const { creerEtablissement } = require('./admin');
  for (const x of RESSOURCES) {
    let e = (await pool.query('SELECT id FROM etablissements WHERE code = $1', [x.code])).rows[0];
    if (!e) {
      e = await creerEtablissement(pool, { code: x.code, nom: x.nom, ville: hop.ville, latitude: Number(hop.latitude) + x.d[0], longitude: Number(hop.longitude) + x.d[1],
        config_id: hop.profil_config_id || hop.config_id, type_etablissement: 'chsld', type_local_code: x.local, type_libelle: x.libelle, type_libelle_en: x.libelle_en, modules: {} },
      (c, n) => c.query(`INSERT INTO journal_admin (utilisateur_id, etablissement_id, action, cible, detail) VALUES (NULL, $1, 'Établissement créé', $2, 'ressource fictive de la Bourse · démonstration (src/demo-vivante.js)')`, [n.id, `${n.code} · ${n.nom}`]));
      await pool.query('UPDATE etablissements SET module_actif = true, region_id = $2 WHERE id = $1', [e.id, regionId]);
    }
    await pool.query(`INSERT INTO ressource_profils (etablissement_id, capacites, langues, delai_admission_jours, places_libres_declarees, circuit, statut_ressource)
      VALUES ($1, $2, '{fr}', 1, $3, $4, $5) ON CONFLICT (etablissement_id) DO NOTHING`, [e.id, x.capacites, x.libres, x.local === 'rpa' ? 'direct' : 'mecanisme_acces', x.local === 'rpa' ? 'prive' : 'public']);
    // Places à venir : toujours dans les 14 prochains jours (recalées si les dates sont passées)
    const ouvertes = (await pool.query("SELECT count(*)::int n FROM places_a_venir WHERE etablissement_id = $1 AND statut = 'ouverte' AND date_prevue >= current_date", [e.id])).rows[0].n;
    if (ouvertes < x.a_venir.length) {
      await pool.query("UPDATE places_a_venir SET statut = 'annulee' WHERE etablissement_id = $1 AND statut = 'ouverte' AND date_prevue < current_date", [e.id]);
      for (const j of x.a_venir.slice(ouvertes)) await pool.query("INSERT INTO places_a_venir (etablissement_id, date_prevue, certitude) VALUES ($1, current_date + $2::int, 'probable')", [e.id, j]);
    }
  }
}

/* Véhicules réservés à la simulation (23 nov. 2026) : jamais ceux des équipages de démonstration (DM-101 à DM-103). Sinon une préalerte
   entretenue en permanence occupait un véhicule utilisé par une personne et faussait ses parcours. */
const SIMULATION = ['SIM-01', 'SIM-02', 'SIM-03'];
async function unitesSimulation(c) {
  const org = (await c.query("SELECT id FROM organisations_secours WHERE 'ambulance' = ANY(profils) AND actif ORDER BY id LIMIT 1")).rows[0];
  if (!org) return;
  for (const n of SIMULATION) await c.query("INSERT INTO unites_secours (organisation_id, numero, plaque) VALUES ($1, $2, 'fictive') ON CONFLICT (organisation_id, numero) DO NOTHING", [org.id, n]);
}
async function unitesLibres(c) {
  return (await c.query(`SELECT u.id, u.organisation_id, u.numero FROM unites_secours u JOIN organisations_secours o ON o.id = u.organisation_id
    WHERE 'ambulance' = ANY(o.profils) AND u.actif AND u.numero = ANY($1) AND NOT EXISTS (SELECT 1 FROM passages_chrono p WHERE p.unite_id = u.id AND p.statut IN ('detecte', 'a_la_porte'))
      AND NOT EXISTS (SELECT 1 FROM prealertes pa WHERE pa.unite_id = u.id AND pa.statut IN ('envoyee', 'recue', 'consultee', 'prise_en_compte', 'preparation', 'preparation_terminee'))
    ORDER BY u.id`, [SIMULATION])).rows;
}
/** Heures plausibles et variées d'un passage simulé, stables pour un même numéro (aucune série identique). */
const dureesSimulees = (n) => { const x = (Number(n) * 7919) % 97; const h12 = 2 + (x % 5); const h13 = h12 + 4 + (x % 7); const h14 = h13 + 6 + (x % 13); return [h12, h13, h14, h14 + 7 + (x % 11)]; };
const minutes = (m) => new Date(Date.now() + m * 60000);
async function passage(c, hop, u, { h11, etapes, termine }) {
  const numero = `CH-${String((await c.query("SELECT nextval('passage_chrono_seq') AS n")).rows[0].n).padStart(6, '0')}`;
  const p = (await c.query(`INSERT INTO passages_chrono (numero, etablissement_id, unite_id, organisation_id, statut, source, cree_le, modifie_le)
    VALUES ($1, $2, $3, $4, $5, 'position', $6, $7) RETURNING id`, [numero, hop.id, u.id, u.organisation_id, termine ? 'termine' : 'a_la_porte', h11, termine ? new Date(h11.getTime() + etapes[3] * 60000) : h11])).rows[0];
  await horloge.marquer(c, { objet: 'passage_chrono', objetId: p.id, etape: 'H11', heure: h11, source: 'systeme' });
  for (const [i, e] of ['H12', 'H13', 'H14', 'H15'].entries()) {
    if (etapes[i] != null) await horloge.marquer(c, { objet: 'passage_chrono', objetId: p.id, etape: e, heure: new Date(h11.getTime() + etapes[i] * 60000), source: 'systeme' });
  }
  return p;
}

async function chrono(pool, hop) {
  if ((hop.modules || {}).chrono !== true) return;
  await transaction(pool, async (c) => {
    await unitesSimulation(c);
    // 0. Anciennes préalertes de simulation sur les véhicules des équipages : closes (elles n'ont jamais correspondu à un parcours réel)
    await c.query(`UPDATE prealertes SET statut = 'cloturee', cloturee_le = now(), version = version + 1, modifie_le = now() WHERE cle_idempotence LIKE $1
      AND statut NOT IN ('cloturee', 'annulee', 'remplacee') AND unite_id NOT IN (SELECT id FROM unites_secours WHERE numero = ANY($2))`, [`${MARQUE}%`, SIMULATION]);
    // 1. Une ambulance de simulation (passage sans position ni clic : créé ici) laissée à la porte plus de 50 min est clôturée avec des heures plausibles (la démo ne s'encombre pas)
    const vieux = (await c.query(`SELECT p.id, h.heure AS h11 FROM passages_chrono p JOIN v_horodatages_courants h ON h.objet = 'passage_chrono' AND h.objet_id = p.id AND h.etape = 'H11'
      JOIN unites_secours u ON u.id = p.unite_id
      WHERE p.etablissement_id = $1 AND p.statut = 'a_la_porte' AND h.heure < now() - interval '50 minutes' AND p.source = 'position' AND p.premiere_position_le IS NULL
        AND (u.numero = ANY($2) OR p.cree_le < now() - interval '50 minutes') FOR UPDATE OF p`, [hop.id, SIMULATION])).rows;
    for (const v of vieux) {
      const faites = (await c.query("SELECT etape FROM v_horodatages_courants WHERE objet = 'passage_chrono' AND objet_id = $1", [v.id])).rows.map((x) => x.etape);
      const d = dureesSimulees(v.id);
      for (const [e, m] of [['H12', d[0]], ['H13', d[1]], ['H14', d[2]], ['H15', d[3]]]) if (!faites.includes(e)) await horloge.marquer(c, { objet: 'passage_chrono', objetId: v.id, etape: e, heure: new Date(new Date(v.h11).getTime() + m * 60000), source: 'systeme' });
      await c.query("UPDATE passages_chrono SET statut = 'termine', version = version + 1, modifie_le = now() WHERE id = $1", [v.id]);
    }
    let libres = await unitesLibres(c);
    // 2. Une ambulance à la porte depuis ~23 min, triage commencé et fini, civière pas encore libérée : chrono rouge
    const aLaPorte = (await c.query("SELECT 1 FROM passages_chrono WHERE etablissement_id = $1 AND statut = 'a_la_porte'", [hop.id])).rowCount;
    if (!aLaPorte && libres.length) { await passage(c, hop, libres.shift(), { h11: minutes(-23), etapes: [3, 9, null, null] }); }
    // 3. Au moins un passage terminé dans les 12 dernières heures
    const termine = (await c.query("SELECT 1 FROM passages_chrono WHERE etablissement_id = $1 AND statut = 'termine' AND modifie_le > now() - interval '12 hours'", [hop.id])).rowCount;
    if (!termine && libres.length) { const u = libres[0]; const p = await passage(c, hop, u, { h11: minutes(-180), etapes: [4, 10, 17, 29], termine: true }); await c.query('UPDATE passages_chrono SET modifie_le = $2 WHERE id = $1', [p.id, minutes(-151)]); }
    // 4. Une ambulance en route : arrivée toujours prévue dans ~6 min (la préalerte de démonstration est recalée à chaque passage)
    libres = await unitesLibres(c);
    const route = (await c.query(`SELECT pa.id FROM prealertes pa WHERE pa.destination_id = $1 AND pa.cle_idempotence LIKE $2
      AND pa.statut IN ('envoyee', 'recue', 'consultee', 'prise_en_compte', 'preparation', 'preparation_terminee')
      AND NOT EXISTS (SELECT 1 FROM passages_chrono p WHERE p.prealerte_id = pa.id) ORDER BY pa.id DESC LIMIT 1`, [hop.id, `${MARQUE}%`])).rows[0];
    let id = route?.id;
    if (!id && libres.length) {
      const u = libres[0];
      const n = `PA-${String((await c.query("SELECT nextval('prealerte_seq') AS n")).rows[0].n).padStart(6, '0')}`;
      id = (await c.query(`INSERT INTO prealertes (numero, organisation_id, unite_id, destination_id, statut, priorite, categorie, heure_prevue, recue_le, cle_idempotence)
        VALUES ($1, $2, $3, $4, 'recue', 'urgente', 'medicale', $5, now(), $6) RETURNING id`, [n, u.organisation_id, u.id, hop.id, minutes(6), `${MARQUE}-${Date.now()}`])).rows[0].id;
      await horloge.marquer(c, { objet: 'prealerte', objetId: id, etape: 'demande', heure: new Date(), source: 'systeme' });
    }
    if (id) {
      await c.query('UPDATE prealertes SET heure_prevue = $2, modifie_le = now() WHERE id = $1', [id, minutes(6)]);
      await c.query(`INSERT INTO eta_prealertes (prealerte_id, minutes, distance_km, source, position_le) VALUES ($1, 6, 4.2, 'vol_oiseau', now())
        ON CONFLICT (prealerte_id) DO UPDATE SET minutes = 6, distance_km = 4.2, position_le = now(), calcule_le = now()`, [id]);
    }
  });
}

async function transports(pool, hop) {
  if ((hop.modules || {}).transport_planifie !== true) return;
  const org = (await pool.query("SELECT id FROM organisations_secours WHERE 'ambulance' = ANY(profils) AND actif ORDER BY id LIMIT 1")).rows[0];
  if (!org) return;
  const dest = (await pool.query("SELECT id FROM etablissements WHERE code = 'CHSLD-ERA'")).rows[0];
  // Demain à l'heure de Montréal
  const demain = async (h, m = 0) => (await pool.query("SELECT ((now() AT TIME ZONE 'America/Toronto')::date + 1 + make_time($1, $2, 0)) AT TIME ZONE 'America/Toronto' AS d", [h, m])).rows[0].d;
  const scenarios = [
    { motif: 'retour_domicile', ref: 'P-40121', vehicule: 'transport_adapte', debut: await demain(10), fin: await demain(10, 30), libelle: 'Domicile (adresse fictive)', confirme: true },
    { motif: 'depart_nsa', ref: 'P-40122', vehicule: 'ambulance', debut: await demain(13), fin: await demain(15), dest: dest?.id, libelle: 'Ressource d’hébergement (fictive)', confirme: false },
  ];
  for (const s of scenarios) {
    if ((await pool.query("SELECT 1 FROM demandes_transport WHERE origine_id = $1 AND motif_transport = $2 AND cle_idempotence LIKE $3 AND statut IN ('demandee', 'acceptee') AND plage_debut > now()",
      [hop.id, s.motif, `${MARQUE}%`])).rowCount) continue;
    await transaction(pool, async (c) => {
      await c.query(`UPDATE demandes_transport SET statut = 'annulee', version = version + 1, modifie_le = now() WHERE origine_id = $1 AND motif_transport = $2 AND cle_idempotence LIKE $3
        AND statut IN ('demandee', 'acceptee') AND plage_debut <= now()`, [hop.id, s.motif, `${MARQUE}%`]);
      const n = `DT-${String((await c.query("SELECT nextval('transport_demande_seq') AS n")).rows[0].n).padStart(6, '0')}`;
      const d = (await c.query(`INSERT INTO demandes_transport (numero, organisation_id, origine_id, destination_id, destination_libelle, resident_ref, heure_souhaitee, motif_transport, type_vehicule,
          plage_debut, plage_fin, statut, acceptee_le, plage_confirmee_debut, plage_confirmee_fin, cle_idempotence, cree_le)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $7, $10, $11, $12, $13, $14, $15, now() - interval '20 hours') RETURNING id`,
      [n, org.id, hop.id, s.dest || null, s.dest ? null : s.libelle, s.ref, s.debut, s.motif, s.vehicule, s.fin, s.confirme ? 'acceptee' : 'demandee', s.confirme ? new Date() : null,
        s.confirme ? s.debut : null, s.confirme ? s.fin : null, `${MARQUE}-${s.motif}-${Date.now()}`])).rows[0];
      await c.query("INSERT INTO demande_transport_evenements (demande_id, type, detail) VALUES ($1, 'demandee', $2)", [d.id, JSON.stringify({ motif_transport: s.motif, demo: true })]);
      await horloge.marquer(c, { objet: 'demande_transport', objetId: d.id, etape: 'demande', heure: new Date(Date.now() - 20 * 3600000), source: 'systeme' });
      if (s.confirme) await c.query("INSERT INTO demande_transport_evenements (demande_id, type, detail) VALUES ($1, 'acceptee', $2)", [d.id, JSON.stringify({ plage_confirmee: true, demo: true })]);
    });
  }
}

/** Un passage d'entretien : rien en dehors de la démonstration ; une erreur dans un scénario n'empêche pas les autres. */
async function entretenir(pool) {
  if (environnement() !== 'demo') return { statut: 'hors_demo' };
  const hop = (await pool.query('SELECT id, ville, latitude, longitude, config_id, profil_config_id, modules FROM etablissements WHERE code = $1 AND actif', [HOPITAL])).rows[0];
  if (!hop) return { statut: 'sans_hopital_a' };
  const fait = {};
  const etape = async (nom, f) => { try { await f(); fait[nom] = 'ok'; } catch (e) { fait[nom] = e.code || e.message; } };
  let regionId = null;
  await etape('region', async () => { regionId = await region(pool); });
  await etape('ressources', () => ressources(pool, hop, regionId));
  await etape('chrono', () => chrono(pool, hop));
  await etape('transports', () => transports(pool, hop));
  return fait;
}
module.exports = { entretenir, RESSOURCES, REGION };
