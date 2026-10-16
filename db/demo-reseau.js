/**
 * Démonstration : un réseau de 20 hôpitaux fictifs (noms, villes, adresses et positions inventés ; aucune donnée réelle).
 *   Hôpital X : sous pression (urgence débordée, soins intensifs saturés, NSA élevés) — compte hopital.x@demo.arrimo
 *   Hôpital Y : a de la place, reçoit les transferts — compte hopital.y@demo.arrimo
 *   18 autres hôpitaux sans compte, de charges variées : 3 à moins de 10 km de X, 2 à moins de 10 km de Y, 13 entre 10 et 150 km.
 *   Leur capacité évolue d'elle-même (src/simulation.js) pour que la démo vive. Compte réseau : reseau@demo.arrimo.
 * Pour la démo, un seul compte par hôpital gère tout (lits, civières, urgence, nettoyage, transferts) ; les rôles restent dans le produit.
 * Noms modifiables : DEMO_NOM_X, DEMO_VILLE_X, DEMO_NOM_Y, DEMO_VILLE_Y.
 * Usage : node db/demo-reseau.js  (base vide)    ou    npm run demo:reset  (remet la démo à zéro)
 */
const fs = require('fs');
const path = require('path');
const { creerPool, transaction } = require('../src/db');
const { hacher } = require('../src/auth');
const { creerTransfert, avancerTransfert, detecterBlocages } = require('../src/services');
const { creerDemande } = require('../src/terrain');
const { creerConnecteur } = require('../src/connecteurs');

const MDP = process.env.DEMO_MOT_DE_PASSE || 'Demo-Arrimo-2026';
const X = { code: 'HX', nom: process.env.DEMO_NOM_X || 'Hôpital X', ville: process.env.DEMO_VILLE_X || 'Ville X', adresse: '1200, boulevard des Érables', lat: 45.40, lon: -71.89 };
const Y = { code: 'HY', nom: process.env.DEMO_NOM_Y || 'Hôpital Y', ville: process.env.DEMO_VILLE_Y || 'Ville Y', adresse: '85, rue du Lac-Clair', lat: 45.27, lon: -72.15 };
// Les 18 autres hôpitaux : [code, nom, ville, adresse, latitude, longitude, partage, taille (× plan), charge (0 à 1), civières [régulières, débordement, patients]]
// Distances depuis X (45,40 ; -71,89) : HA 4,5 km, HB 5,4 km, HC 6,6 km ; depuis Y : HD 4,5 km, HE 5,4 km ; les autres de 19 à 125 km.
const AUTRES = [
  ['HA', 'Hôpital du Bois-Joli', 'Bois-Joli', '410, rue des Merisiers', 45.430, -71.930, 'complet', 0.6, 0.78, [8, 2, 6]],
  ['HB', 'Centre hospitalier Val-des-Cèdres', 'Val-des-Cèdres', '22, chemin du Moulin', 45.360, -71.850, 'complet', 0.8, 0.96, [10, 4, 13]],
  ['HC', 'Hôpital Sainte-Aurore', 'Sainte-Aurore-des-Monts', '3005, boulevard Laurier-Est', 45.455, -71.860, 'agrege', 0.5, 0.7, [6, 2, 4]],
  ['HD', 'Hôpital de la Pointe-aux-Hérons', 'Pointe-aux-Hérons', '17, rue du Quai', 45.300, -72.110, 'complet', 0.5, 0.65, [6, 2, 3]],
  ['HE', 'Centre de santé Lac-Brunet', 'Lac-Brunet', '940, route des Pins', 45.235, -72.200, 'complet', 0.4, 0.88, [5, 2, 6]],
  ['HF', 'Hôpital de Rivière-Claire', 'Rivière-Claire', '5, place de l’Église', 45.520, -71.700, 'complet', 0.7, 0.72, [8, 2, 6]],
  ['HG', 'Hôpital régional du Mont-Argent', 'Mont-Argent', '1500, avenue du Sommet', 45.200, -71.600, 'complet', 1.0, 0.92, [16, 6, 21]],
  ['HH', 'Centre hospitalier des Trois-Pins', 'Trois-Pins', '260, rue Principale', 45.650, -72.050, 'complet', 0.6, 0.6, [8, 2, 4]],
  ['HI', 'Hôpital Saint-Aurèle', 'Saint-Aurèle', '77, rang du Ruisseau', 45.100, -72.400, 'complet', 0.5, 0.82, [6, 2, 6]],
  ['HJ', 'Hôpital de Beaurivage-Nord', 'Beaurivage-Nord', '1010, rue de la Rivière', 45.800, -71.950, 'agrege', 0.6, 0.75, [8, 2, 7]],
  ['HK', 'Centre hospitalier du Haut-Fleuri', 'Haut-Fleuri', '48, boulevard du Parc', 45.400, -72.600, 'complet', 0.8, 0.98, [12, 4, 16]],
  ['HL', 'Hôpital des Collines-Bleues', 'Collines-Bleues', '330, montée des Bleuets', 45.000, -71.800, 'complet', 0.5, 0.55, [6, 2, 2]],
  ['HM', 'Hôpital de Saint-Clovis-du-Lac', 'Saint-Clovis-du-Lac', '12, rue des Pionniers', 45.900, -71.400, 'complet', 0.6, 0.85, [8, 2, 8]],
  ['HN', 'Centre hospitalier Grand-Héron', 'Grand-Héron', '2400, boulevard des Hérons', 45.600, -73.000, 'complet', 1.0, 0.94, [18, 6, 24]],
  ['HO', 'Hôpital de Val-Saint-Rémi', 'Val-Saint-Rémi', '61, rue Notre-Dame', 46.200, -71.900, 'complet', 0.7, 0.68, [8, 2, 5]],
  ['HP', 'Hôpital du Bassin-Doré', 'Bassin-Doré', '150, avenue des Tilleuls', 45.350, -73.400, 'complet', 0.9, 0.8, [12, 4, 11]],
  ['HQ', 'Centre hospitalier de Lac-aux-Outardes', 'Lac-aux-Outardes', '7, chemin du Lac', 46.400, -72.500, 'aucun', 0.5, 0.7, [6, 2, 4]],
  ['HR', 'Hôpital de la Haute-Clairière', 'Haute-Clairière', '880, rue Champêtre', 46.500, -71.600, 'complet', 0.6, 0.62, [8, 2, 4]],
].map(([code, nom, ville, adresse, lat, lon, partage, taille, charge, civ]) => ({ code, nom, ville, adresse, lat, lon, partage, taille, charge, civ }));

const NOMS_EN = { SI: 'Intensive care', MED: 'Medicine', CHIR: 'Surgery', MAT: 'Maternity' };
// Plan des unités : [code type, nom, chambres, lits par chambre, étage, équipement]
const PLAN = [
  ['SI', 'Soins intensifs', 8, 1, 1, { ventilation: true, telemetrie: true }],
  ['MED', 'Médecine', 10, 2, 2, {}],
  ['CHIR', 'Chirurgie', 8, 2, 3, {}],
  ['MAT', 'Maternité', 6, 2, 4, {}],
];
// Occupation visée par hôpital et par unité (part de lits occupés ou réservés)
const CHARGE = { HX: { SI: 1.0, MED: 0.97, CHIR: 0.9, MAT: 0.8 }, HY: { SI: 0.62, MED: 0.72, CHIR: 0.7, MAT: 0.55 } };

let graine = 4242;
const rnd = () => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648; };
const ref = () => `P-${String(10000 + Math.floor(rnd() * 89999))}`;

async function demoReseau(pool, { silencieux = false, comptesRoles = false } = {}) {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  if ((await pool.query('SELECT count(*)::int AS n FROM etablissements')).rows[0].n) {
    throw new Error('La base contient déjà des données. Utilisez npm run demo:reset pour repartir de zéro.');
  }
  const hash = hacher(MDP);
  const ids = {};
  const types = {};
  await transaction(pool, async (c) => {
    const cfg = (await c.query(`INSERT INTO config_pays (code, nom) VALUES ('QC', 'Québec (Canada)') RETURNING id`)).rows[0].id;
    for (const [i, [code, nom]] of PLAN.entries()) {
      types[code] = (await c.query('INSERT INTO types_unite (config_id, code, nom, ordre, nom_en) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [cfg, code, nom, i + 1, NOMS_EN[code]])).rows[0].id;
    }
    for (const h of [X, Y, ...AUTRES]) {
      ids[h.code] = (await c.query(
        `INSERT INTO etablissements (code, nom, ville, adresse, latitude, longitude, config_id, partage, module_actif)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id`, [h.code, h.nom, h.ville, h.adresse, h.lat, h.lon, cfg, h.partage || 'complet'])).rows[0].id;
      // Un seul compte par hôpital pour la démo (X et Y) ; les comptes par rôle ne servent qu'aux tests
      if (h === X || h === Y) {
        const sfx = h.code === 'HX' ? 'x' : 'y';
        const comptes = [[`hopital.${sfx}`, h.nom, 'coordonnateur']];
        if (comptesRoles) comptes.push([`entretien.${sfx}`, `Entretien · ${h.nom}`, 'entretien']);
        for (const [login, nom, role] of comptes) {
          const u = (await c.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1,$2,$3,$4) RETURNING id',
            [`${login}@demo.arrimo`, nom, hash, role])).rows[0].id;
          await c.query('INSERT INTO utilisateur_etablissements VALUES ($1,$2)', [u, ids[h.code]]);
        }
      }
      // Unités, chambres, lits (les autres hôpitaux : plan réduit selon leur taille ; les plus petits n'ont pas de soins intensifs)
      for (const [code, nom, nbChPlan, nbLits, etage, equip] of PLAN) {
        const nbCh = h.taille ? Math.round(nbChPlan * h.taille) : nbChPlan;
        if (!nbCh || (h.taille && h.taille < 0.6 && code === 'SI')) continue;
        const unite = (await c.query('INSERT INTO unites (etablissement_id, type_id, nom) VALUES ($1,$2,$3) RETURNING id', [ids[h.code], types[code], nom])).rows[0].id;
        const lits = [];
        for (let ch = 1; ch <= nbCh; ch += 1) {
          const num = `${etage}${String(ch).padStart(2, '0')}`;
          const chambre = (await c.query('INSERT INTO chambres (unite_id, numero) VALUES ($1,$2) RETURNING id', [unite, num])).rows[0].id;
          for (let k = 0; k < nbLits; k += 1) lits.push({ chambre, code: `${code}-${num}${nbLits > 1 ? 'AB'[k] : ''}`, ch });
        }
        const charge = CHARGE[h.code] ? CHARGE[h.code][code] : Math.min(1, h.charge + (code === 'SI' ? 0.08 : code === 'MAT' ? -0.12 : 0));
        for (const [i, l] of lits.entries()) {
          // Chez Y, les premières chambres (isolement, pression négative) restent libres : elles servent au scénario de transfert
          const p = h.code === 'HY' ? 1 - (i + 1) / lits.length : i / lits.length;
          let etat = p < charge ? 'occupe' : 'libre';
          if (etat === 'occupe' && i % 9 === 4) etat = 'nettoyage';
          if (etat === 'occupe' && i % 13 === 7) etat = 'reserve';
          if (i === lits.length - 1 && code !== 'SI') etat = 'indispo';
          const isole = l.ch <= 2;
          const r = await c.query(
            `INSERT INTO lits (chambre_id, unite_id, type_id, etablissement_id, code, etat, patient_ref, etat_depuis, sortie_prevue,
                               isolement, pression_negative, ventilation, telemetrie, motif_indispo)
             VALUES ($1,$2,$3,$4,$5,$6,$7, now() - make_interval(mins => $8::int), $9, $10, $11, $12, $13, $14) RETURNING id`,
            [l.chambre, unite, types[code], ids[h.code], l.code, etat,
              ['occupe', 'reserve'].includes(etat) ? ref() : null,
              etat === 'nettoyage' ? 10 + Math.floor(rnd() * 40) : etat === 'reserve' ? 15 + Math.floor(rnd() * 40) : 60 + Math.floor(rnd() * 4000),
              etat === 'occupe' ? new Date(Date.now() + (6 + Math.floor(rnd() * 90)) * 3600000) : null,
              isole, l.ch === 1, !!equip.ventilation, !!equip.telemetrie || (code === 'MED' && l.ch <= 3),
              etat === 'indispo' ? (h.code === 'HX' || h.charge > 0.9 ? 'personnel' : 'equipement') : null]);
          lits[i].id = r.rows[0].id;
          await c.query(`INSERT INTO journal (lit_id, etablissement_id, action, nouvel_etat, detail, date)
                         VALUES ($1,$2,'Création',$3,'Données de démonstration', now() - interval '31 days')`, [r.rows[0].id, ids[h.code], etat]);
        }
      }
    }
    // Hôpital X : NSA nombreux (environ 15 % des occupés), congés du jour non confirmés, blocages à repérer
    await c.query(`UPDATE lits SET nsa_depuis = now() - make_interval(days => 4 + (id * 11) % 58), sortie_prevue = NULL,
                     nsa_orientation = (ARRAY['chsld','chsld','chsld','ri','readaptation','domicile','palliatif'])[1 + (id % 7)]
                   WHERE etablissement_id = $1 AND etat = 'occupe' AND type_id IN ($2, $3) AND id % 6 = 0`, [ids.HX, types.MED, types.CHIR]);
    await c.query(`UPDATE lits SET nsa_depuis = now() - interval '9 days', nsa_orientation = 'ri', sortie_prevue = NULL
                   WHERE id = (SELECT min(id) FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' AND type_id = $2)`, [ids.HY, types.MED]);
    await c.query(`UPDATE lits SET sortie_prevue = now() + interval '2 hours' + make_interval(mins => (id % 4) * 45), conge_statut = 'prevu'
                   WHERE id IN (SELECT id FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' AND nsa_depuis IS NULL
                                AND type_id IN ($2, $3) ORDER BY id DESC LIMIT 4)`, [ids.HX, types.MED, types.CHIR]);
    await c.query(`UPDATE lits SET sortie_prevue = now() - interval '6 hours', conge_statut = 'confirme'
                   WHERE id = (SELECT max(id) FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' AND nsa_depuis IS NULL AND type_id = $2)`, [ids.HX, types.MAT]);
    await c.query(`UPDATE lits SET etat_depuis = now() - interval '170 minutes'
                   WHERE id = (SELECT min(id) FROM lits WHERE etablissement_id = $1 AND etat = 'nettoyage')`, [ids.HX]);
    await c.query(`UPDATE lits SET etat_depuis = now() - interval '215 minutes'
                   WHERE id = (SELECT min(id) FROM lits WHERE etablissement_id = $1 AND etat = 'reserve')`, [ids.HX]);
    await c.query(`UPDATE lits SET sortie_prevue = now() + interval '90 minutes', conge_statut = 'confirme'
                   WHERE id = (SELECT min(id) FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' AND type_id = $2)`, [ids.HX, types.SI]);
    await c.query(`UPDATE lits SET etat = 'indispo', patient_ref = NULL, sortie_prevue = NULL, motif_indispo = 'personnel',
                          etat_depuis = now() - interval '30 hours'
                   WHERE id IN (SELECT id FROM lits WHERE etablissement_id = $1 AND type_id = $2 AND etat = 'libre' ORDER BY code DESC LIMIT 2)`, [ids.HX, types.CHIR]);

    // Deux mois d'historique terminé pour les indicateurs et leur tendance (le mois le plus ancien est un peu moins bon)
    const coordo = async (sfx) => (await c.query('SELECT id FROM utilisateurs WHERE email = $1', [`hopital.${sfx}@demo.arrimo`])).rows[0].id;
    const ux = await coordo('x'); const uy = await coordo('y');
    for (let j = 1; j <= 58; j += 1) {
      const ancien = j > 30;
      const vers = j % 5 === 0 ? 'X' : 'Y';
      const o = vers === 'Y' ? ids.HX : ids.HY; const d = vers === 'Y' ? ids.HY : ids.HX;
      const refuse = j % 9 === 0;
      const valid = 12 + Math.floor(rnd() * 70) + (ancien ? 25 : 0); const total = valid + 50 + Math.floor(rnd() * 120) + (ancien ? 40 : 0);
      const t = (await c.query(
        `INSERT INTO transferts (numero, patient_ref, origine_id, destination_id, type_id, urgent, statut, distance_km, demande_par,
                                 date_demande, date_validation, date_depart, date_reception, transport_info, motif_refus_code, motif_refus)
         VALUES ('TR-' || lpad(nextval('transfert_seq')::text, 5, '0'), $1, $2, $3, $4, $5, $6, 25, $7,
                 now() - make_interval(days => $8::int, hours => 3),
                 now() - make_interval(days => $8::int, hours => 3) + make_interval(mins => $9::int),
                 CASE WHEN $6 = 'recu' THEN now() - make_interval(days => $8::int, hours => 3) + make_interval(mins => $9::int + 25) END,
                 CASE WHEN $6 = 'recu' THEN now() - make_interval(days => $8::int, hours => 3) + make_interval(mins => $10::int) END,
                 CASE WHEN $6 = 'recu' THEN 'Ambulance (M2)' END,
                 CASE WHEN $6 = 'refuse' THEN 'pas_de_personnel' END,
                 CASE WHEN $6 = 'refuse' THEN 'Pas d’infirmière disponible cette nuit' END)
         RETURNING id`,
        [ref(), o, d, [types.SI, types.MED, types.CHIR, types.MAT][j % 4], j % 4 === 0, refuse ? 'refuse' : 'recu', vers === 'Y' ? ux : uy, j, valid, total])).rows[0];
      void t;
      // admissions terminées
      await c.query(
        `INSERT INTO demandes_admission (etablissement_id, provenance, type_id, patient_ref, priorite, statut, cree_le, assignee_le, terminee_le)
         VALUES ($1, 'urgence', $2, $3, $4, 'admise', now() - make_interval(days => $5::int, hours => 8),
                 now() - make_interval(days => $5::int, hours => 8) + make_interval(mins => $6::int),
                 now() - make_interval(days => $5::int, hours => 8) + make_interval(mins => $6::int + 20))`,
        [j % 3 === 0 ? ids.HY : ids.HX, types.MED, ref(), j % 4 === 0 ? 'p1' : 'p2', j, (j % 3 === 0 ? 45 + j : 180 + (j % 30) * 9) + (ancien ? 70 : 0)]);
    }
    // nettoyages mesurés : paires « nettoyage » puis « libre » dans le journal
    const pourNettoyage = (await c.query(
      `SELECT id, etablissement_id, n FROM (SELECT id, etablissement_id, row_number() OVER (PARTITION BY etablissement_id ORDER BY id) AS n FROM lits) x
        WHERE n <= 50 ORDER BY n, etablissement_id`)).rows;
    for (const [i, l] of pourNettoyage.entries()) {
      const ancien = Number(l.n) > 25;
      const jour = 1 + (i % 27) + (ancien ? 30 : 0);
      const duree = (l.etablissement_id === ids.HX ? 70 + (i * 7) % 60 : 35 + (i * 5) % 25) + (ancien ? 15 : 0);
      await c.query(`INSERT INTO journal (lit_id, etablissement_id, action, ancien_etat, nouvel_etat, detail, date)
                     VALUES ($1, $2, 'Changement d’état', 'occupe', 'nettoyage', 'Départ du patient', now() - make_interval(days => $3::int, hours => 5))`,
      [l.id, l.etablissement_id, jour]);
      await c.query(`INSERT INTO journal (lit_id, etablissement_id, action, ancien_etat, nouvel_etat, detail, date)
                     VALUES ($1, $2, 'Changement d’état', 'nettoyage', 'libre', 'Nettoyage confirmé', now() - make_interval(days => $3::int, hours => 5) + make_interval(mins => $4::int))`,
      [l.id, l.etablissement_id, jour, duree]);
    }
    await c.query(`INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ('reseau@demo.arrimo', 'Coordination régionale (démo)', $1, 'gestionnaire')`, [hash]);
    // Charge visée de chaque hôpital sans compte : la simulation la maintient à peu près (src/simulation.js)
    await c.query(`INSERT INTO demo_etat (id, reference, simulation) VALUES (1, now(), $1)
                   ON CONFLICT (id) DO UPDATE SET reference = now(), simulation = EXCLUDED.simulation`,
    [JSON.stringify(Object.fromEntries(AUTRES.map((h) => [h.code, { lits: h.charge, civ: h.civ[2] }])))]);

    // Civières de l'urgence. X : urgence débordée (patients en corridor, séjours de plus de 24 h et 48 h). Y : de la place.
    // [régulières, débordement, patients sur civière, heures sur civière (les premiers) ]
    const URG = { HX: [18, 8, 24, [56, 50, 38, 31, 27, 26, 22, 19, 16, 14, 12, 11, 9, 8, 7, 6, 5, 4, 3.5, 3, 2.5, 2, 1.5, 1]], HY: [12, 4, 8, [20, 9, 7, 5, 4, 3, 2, 1]] };
    // Autres hôpitaux : durées sur civière de 1 à 40 h selon la charge
    for (const h of AUTRES) URG[h.code] = [h.civ[0], h.civ[1], h.civ[2], Array.from({ length: h.civ[2] }, (_, k) => Math.max(0.5, (h.charge > 0.9 ? 40 : 20) * (1 - k / h.civ[2])))];
    for (const [code, [nReg, nDeb, nOcc, heures]] of Object.entries(URG)) {
      const civs = [];
      for (let i = 1; i <= nReg; i += 1) civs.push({ code: `URG-${String(i).padStart(2, '0')}`, categorie: 'reguliere' });
      for (let i = 1; i <= nDeb; i += 1) civs.push({ code: `COR-${String(i).padStart(2, '0')}`, categorie: 'debordement' });
      // Les régulières se remplissent d'abord ; une régulière en nettoyage et une hors service chez X
      const occ = civs.filter((x) => x.categorie === 'reguliere').concat(civs.filter((x) => x.categorie === 'debordement'));
      let k = 0;
      for (const [i, cv] of occ.entries()) {
        let etat = 'libre'; let h = null;
        if (code === 'HX' && i === 3) etat = 'nettoyage';
        else if (code === 'HX' && i === 5) etat = 'indispo';
        else if (k < nOcc) { etat = 'occupee'; h = heures[k]; k += 1; }
        const r = await c.query(
          `INSERT INTO civieres (etablissement_id, code, categorie, etat, patient_ref, arrivee_le, etat_depuis, motif_indispo)
           VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::float IS NULL THEN NULL ELSE now() - make_interval(secs => $6::float * 3600) END,
                   now() - make_interval(mins => $7::int), $8) RETURNING id`,
          [ids[code], cv.code, cv.categorie, etat, etat === 'occupee' ? ref() : null, h,
            etat === 'occupee' ? Math.round(h * 60) : etat === 'nettoyage' ? 25 : 300, etat === 'indispo' ? 'equipement' : null]);
        cv.id = r.rows[0].id; cv.etat = etat; cv.heures = h;
        await c.query(`INSERT INTO journal (civiere_id, etablissement_id, action, nouvel_etat, detail, date)
                       VALUES ($1, $2, 'Création', $3, 'Données de démonstration', now() - interval '31 days')`, [cv.id, ids[code], etat]);
      }
      // Séjours terminés du dernier mois : durée moyenne sur civière (X ≈ 20 h, Y ≈ 8 h)
      for (let j = 0; j < (['HX', 'HY'].includes(code) ? 80 : 20); j += 1) {
        const cv = civs[j % civs.length];
        const ancien = j >= 40;
        const duree = (code === 'HX' ? 8 + ((j * 7) % 30) : 3 + ((j * 5) % 11)) + (ancien ? 4 : 0);
        const debut = `now() - make_interval(days => ${2 + (j % 27) + (ancien ? 31 : 0)}, hours => ${j % 9})`;
        await c.query(`INSERT INTO journal (civiere_id, etablissement_id, action, ancien_etat, nouvel_etat, detail, date)
                       VALUES ($1, $2, 'Civière', 'libre', 'occupee', 'Données de démonstration', ${debut})`, [cv.id, ids[code]]);
        await c.query(`INSERT INTO journal (civiere_id, etablissement_id, action, ancien_etat, nouvel_etat, detail, date)
                       VALUES ($1, $2, 'Civière', 'occupee', 'nettoyage', 'Données de démonstration', ${debut} + make_interval(hours => $3::int))`,
        [cv.id, ids[code], duree]);
      }
    }
    // Huit semaines d'historique horaire pour les prévisions (X et Y) : départs en fin de matinée, admissions l'après-midi et le soir,
    // arrivées à l'urgence en journée. Chaque départ est suivi de son nettoyage (paire mesurée).
    const POIDS_DEPART = [0, 0, 0, 0, 0, 0, 0, 1, 2, 4, 7, 9, 9, 8, 6, 4, 2, 1, 1, 0, 0, 0, 0, 0];
    const POIDS_ADMISSION = [1, 1, 0, 0, 0, 0, 0, 1, 1, 2, 3, 4, 5, 6, 7, 7, 7, 6, 6, 5, 5, 4, 3, 2];
    const POIDS_URGENCE = [2, 1, 1, 1, 1, 1, 2, 3, 5, 7, 8, 8, 8, 7, 7, 7, 7, 8, 8, 7, 6, 5, 4, 3];
    const tirerHeure = (poids) => { let x = rnd() * poids.reduce((a, b) => a + b, 0); for (let h = 0; h < 24; h += 1) { x -= poids[h]; if (x < 0) return h; } return 12; };
    const evts = { lit: [], etab: [], ancien: [], nouveau: [], detail: [], date: [], civ: [] };
    const ajouterEvt = (lit, civ, etab, ancien, nouveau, quand) => {
      evts.lit.push(lit); evts.civ.push(civ); evts.etab.push(etab); evts.ancien.push(ancien); evts.nouveau.push(nouveau);
      evts.detail.push('Historique de démonstration'); evts.date.push(quand.toISOString());
    };
    const minuit = new Date(); minuit.setHours(0, 0, 0, 0);
    for (const code of ['HX', 'HY']) {
      const litsH = (await c.query('SELECT id, type_id FROM lits WHERE etablissement_id = $1 ORDER BY id', [ids[code]])).rows;
      const civsH = (await c.query('SELECT id FROM civieres WHERE etablissement_id = $1 ORDER BY id', [ids[code]])).rows;
      const parJourLits = Math.round(litsH.length / (code === 'HX' ? 6 : 4.5));
      const parJourCiv = code === 'HX' ? 30 : 16;
      for (let jour = 1; jour <= 56; jour += 1) {
        const base = new Date(minuit.getTime() - jour * 86400000);
        const ancien = jour > 30;
        for (let k = 0; k < parJourLits; k += 1) {
          const l = litsH[Math.floor(rnd() * litsH.length)];
          const d = new Date(base.getTime() + (tirerHeure(POIDS_DEPART) * 60 + Math.floor(rnd() * 60)) * 60000);
          ajouterEvt(l.id, null, ids[code], 'occupe', 'nettoyage', d);
          const net = (code === 'HX' ? 70 + Math.floor(rnd() * 60) : 35 + Math.floor(rnd() * 25)) + (ancien ? 15 : 0);
          ajouterEvt(l.id, null, ids[code], 'nettoyage', 'libre', new Date(d.getTime() + net * 60000));
          const a = litsH[Math.floor(rnd() * litsH.length)];
          ajouterEvt(a.id, null, ids[code], 'reserve', 'occupe', new Date(base.getTime() + (tirerHeure(POIDS_ADMISSION) * 60 + Math.floor(rnd() * 60)) * 60000));
        }
        for (let k = 0; k < parJourCiv; k += 1) {
          const v = civsH[Math.floor(rnd() * civsH.length)];
          ajouterEvt(null, v.id, ids[code], 'libre', 'occupee', new Date(base.getTime() + (tirerHeure(POIDS_URGENCE) * 60 + Math.floor(rnd() * 60)) * 60000));
          // X : les départs de l'urgence sont un peu moins nombreux que les arrivées en soirée (l'urgence se remplit le soir)
          ajouterEvt(null, v.id, ids[code], 'occupee', 'nettoyage', new Date(base.getTime() + (tirerHeure(code === 'HX' ? POIDS_DEPART : POIDS_URGENCE) * 60 + Math.floor(rnd() * 60)) * 60000));
        }
      }
    }
    await c.query(`INSERT INTO journal (lit_id, civiere_id, etablissement_id, action, ancien_etat, nouvel_etat, detail, date)
      SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::timestamptz[])`,
    [evts.lit, evts.civ, evts.etab, evts.lit.map((l) => (l ? 'Changement d’état' : 'Civière')), evts.ancien, evts.nouveau, evts.detail, evts.date]);
  });

  // Situation en cours, créée par les vraies règles de l'application
  const utilisateur = async (email) => {
    const r = await pool.query(`SELECT u.id, u.role, array_agg(ue.etablissement_id) AS etabs FROM utilisateurs u
      JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id WHERE email = $1 GROUP BY u.id`, [email]);
    return { ...r.rows[0], gestionnaire: false };
  };
  const coX = await utilisateur('hopital.x@demo.arrimo');
  const urgX = coX;
  const coY = await utilisateur('hopital.y@demo.arrimo');
  // File d'attente à l'urgence de X
  const file = [
    ['SI', 'p1', 380, { ventilation: true }], ['MED', 'p2', 300, {}], ['MED', 'p1', 140, { isolement: true }],
    ['CHIR', 'p2', 75, {}], ['MED', 'p3', 50, {}], ['MAT', 'p2', 20, {}],
  ];
  // Chaque patient de la file attend sur une civière de l'urgence, arrivé avant sa demande de lit
  const civX = (await pool.query(`SELECT id, arrivee_le FROM civieres WHERE etablissement_id = $1 AND etat = 'occupee' ORDER BY arrivee_le`, [ids.HX])).rows;
  for (const [i, [t, prio, ilya, besoins]] of file.entries()) {
    const civ = civX[[2, 4, 6, 9, 12, 15][i]];
    const d = await creerDemande(pool, urgX, { etablissement_id: ids.HX, type_id: types[t], priorite: prio, provenance: 'urgence', civiere_id: civ.id, besoins });
    await pool.query('UPDATE demandes_admission SET cree_le = now() - make_interval(mins => $2) WHERE id = $1', [d.id, ilya]);
  }
  // Une demande à l'urgence de Y aussi
  const urgY = coY;
  const civY = (await pool.query(`SELECT id FROM civieres WHERE etablissement_id = $1 AND etat = 'occupee' ORDER BY arrivee_le DESC LIMIT 1 OFFSET 5`, [ids.HY])).rows[0];
  const dY = await creerDemande(pool, urgY, { etablissement_id: ids.HY, type_id: types.CHIR, priorite: 'p2', provenance: 'urgence', civiere_id: civY.id });
  await pool.query(`UPDATE demandes_admission SET cree_le = now() - interval '35 minutes' WHERE id = $1`, [dY.id]);
  // Files d'attente des autres hôpitaux chargés : patients sur civière qui attendent un lit
  for (const h of AUTRES.filter((x) => x.charge >= 0.85)) {
    const systeme = { id: null, role: 'coordonnateur', etabs: [ids[h.code]], gestionnaire: false };
    const civs = (await pool.query(`SELECT id FROM civieres WHERE etablissement_id = $1 AND etat = 'occupee' ORDER BY arrivee_le LIMIT $2`,
      [ids[h.code], Math.round((h.charge - 0.8) * 30)])).rows;
    for (const [k, cv] of civs.entries()) {
      const d = await creerDemande(pool, systeme, { etablissement_id: ids[h.code], type_id: types[k % 3 === 2 ? 'CHIR' : 'MED'], priorite: k % 4 === 0 ? 'p1' : 'p2',
        provenance: 'urgence', civiere_id: cv.id });
      await pool.query('UPDATE demandes_admission SET cree_le = now() - make_interval(mins => $2) WHERE id = $1', [d.id, 30 + k * 55]);
    }
  }
  // Transferts en cours entre X et Y, à différentes étapes
  const t1 = await creerTransfert(pool, coX, { origine_id: ids.HX, destination_id: ids.HY, type_id: types.MED, patient_ref: ref(), urgent: false });
  void t1;   // en attente de la réponse de Y
  const t2 = await creerTransfert(pool, coX, { origine_id: ids.HX, destination_id: ids.HY, type_id: types.SI, patient_ref: ref(), urgent: true, besoins: { ventilation: true } });
  await avancerTransfert(pool, coY, t2.id, 'accepter');
  await avancerTransfert(pool, coX, t2.id, 'transport');
  await avancerTransfert(pool, coX, t2.id, 'depart');
  await pool.query(`UPDATE transferts SET date_demande = now() - interval '70 minutes', date_validation = now() - interval '52 minutes',
                    date_depart = now() - interval '15 minutes',
                    arrivee_prevue = now() - interval '15 minutes' + make_interval(mins => minutes_route) WHERE id = $1`, [t2.id]);
  await pool.query(`UPDATE transferts SET date_demande = now() - interval '25 minutes' WHERE id = $1`, [t1.id]);
  await detecterBlocages(pool);
  await pool.query('UPDATE demo_etat SET reference = now() WHERE id = 1');
  const conX = await creerConnecteur(pool, `Interface ADT · ${X.nom} (démo)`, ids.HX);
  const conR = await creerConnecteur(pool, 'Coordination régionale (démo, lecture)', null);

  const acces = [
    'ARRIMO · DÉMONSTRATION · RÉSEAU DE 20 HÔPITAUX (données fictives)',
    `Mot de passe de tous les comptes : ${MDP}`,
    '',
    `  hopital.x@demo.arrimo    ${X.nom} (sous pression) : lits, civières, urgence, nettoyage, transferts`,
    `  hopital.y@demo.arrimo    ${Y.nom} (a de la place)`,
    '  reseau@demo.arrimo       coordination régionale (tous les établissements)',
    'Les 18 autres hôpitaux n’ont pas de compte : leur capacité évolue d’elle-même.',
    '',
    `Clé du connecteur ADT de ${X.nom} : ${conX.cle}`,
    `Clé du connecteur réseau (lecture) : ${conR.cle}`,
  ].join('\n');
  if (!silencieux) console.log(acces);
  return { ids, types, acces };
}

if (require.main === module) {
  const pool = creerPool(process.env.DATABASE_URL);
  demoReseau(pool).then(() => pool.end()).catch((e) => { console.error(e.message); pool.end(); process.exit(1); });
}
module.exports = { demoReseau };
