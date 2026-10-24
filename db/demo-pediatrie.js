/**
 * Jeu fictif pédiatrique pour la démonstration A/B/C et les essais (aucune donnée réelle).
 * - Spécialités pédiatriques et néonatales activées depuis le catalogue (groupe d'âge porté par le type et par chaque lit).
 * - « Centre pédiatrique des Érables (fictif) » : hôpital à vocation pédiatrique, sans maternité ni unités adultes,
 *   avec ses modules propres (pas de module NSA adulte) et des civières pédiatriques.
 * - Hôpital C : une petite unité de pédiatrie générale et deux lits de chirurgie « tous âges ».
 * - Patients fictifs identifiés (noms manifestement fictifs) à l'urgence de A et du centre pédiatrique.
 */
const { transaction } = require('../src/db');

const TYPES_PED = ['PED', 'SIP', 'NEO', 'SIN', 'CHIR-PED', 'URG-PED'];
// [type, nom d'unité, chambres, lits par chambre, étage, équipement, lits libres confirmés]
const PLAN_PED = [
  ['PED', 'Pédiatrie générale', 5, 2, 2, {}, 2],
  ['SIP', 'Soins intensifs pédiatriques', 4, 1, 3, { ventilation: true, telemetrie: true }, 1],
  ['NEO', 'Néonatologie', 3, 2, 4, { telemetrie: true }, 1],
  ['SIN', 'Soins intensifs néonataux', 3, 1, 4, { ventilation: true, telemetrie: true }, 0],
  ['CHIR-PED', 'Chirurgie pédiatrique', 3, 1, 5, {}, 1],
];

async function activerTypes(c, cfgId, codes) {
  const ids = {};
  for (const code of codes) {
    const r = await c.query(
      `INSERT INTO types_unite (config_id, code, nom, nom_en, ordre, groupe_age, specialite)
       SELECT $1, code, nom, nom_en, ordre, groupe_age, famille FROM specialites_catalogue WHERE code = $2
       ON CONFLICT (config_id, code) DO UPDATE SET groupe_age = EXCLUDED.groupe_age, specialite = EXCLUDED.specialite RETURNING id`, [cfgId, code]);
    ids[code] = r.rows[0].id;
  }
  return ids;
}

async function creerUnite(c, etabId, typeId, groupe, [code, nom, nbCh, nbLits, etage, equip, libres], { departementId, occupationRefs, confirmePar }) {
  const unite = (await c.query('INSERT INTO unites (etablissement_id, type_id, nom, departement_id) VALUES ($1,$2,$3,$4) RETURNING id',
    [etabId, typeId, nom, departementId || null])).rows[0].id;
  const lits = [];
  for (let ch = 1; ch <= nbCh; ch += 1) {
    const num = `${etage}${String(ch).padStart(2, '0')}`;
    const chambre = (await c.query(`INSERT INTO chambres (unite_id, numero, type_chambre, capacite_declaree) VALUES ($1,$2,$3,$4) RETURNING id`,
      [unite, num, nbLits > 1 ? 'double' : 'individuelle', nbLits])).rows[0].id;
    for (let k = 0; k < nbLits; k += 1) lits.push({ chambre, code: `${code}-${num}${nbLits > 1 ? 'AB'[k] : ''}`, ch });
  }
  for (const [i, l] of lits.entries()) {
    const libre = i >= lits.length - libres;
    const ref = libre ? null : occupationRefs();
    const r = await c.query(
      `INSERT INTO lits (chambre_id, unite_id, type_id, etablissement_id, code, etat, patient_ref, etat_depuis, sortie_prevue, groupe_age,
                         isolement, pression_negative, ventilation, telemetrie, disponibilite_confirmee_le, disponibilite_confirmee_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() - make_interval(mins => $8::int), $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
      [l.chambre, unite, typeId, etabId, l.code, libre ? 'libre' : 'occupe', ref, 90 + i * 37,
        libre || i % 3 ? null : new Date(Date.now() + (8 + i * 5) * 3600000), groupe,
        l.ch === 1, l.ch === 1 && code !== 'NEO', !!equip.ventilation, !!equip.telemetrie,
        libre ? new Date(Date.now() - 10 * 60000) : null, libre ? confirmePar : null]);
    await c.query(`INSERT INTO journal (lit_id, etablissement_id, action, nouvel_etat, detail, date)
                   VALUES ($1,$2,'Création',$3,'Données de démonstration (pédiatrie fictive)', now() - interval '31 days')`,
    [r.rows[0].id, etabId, libre ? 'libre' : 'occupe']);
  }
  return unite;
}

/**
 * Ajoute le jeu pédiatrique à une base de démonstration A/B/C déjà créée.
 * `hash` : empreinte du mot de passe commun de démonstration (compte hopital.d).
 */
async function ajouterPediatrie(pool, { hash } = {}) {
  return transaction(pool, async (c) => {
    const hx = (await c.query(`SELECT id, config_id, latitude, longitude FROM etablissements WHERE code = 'HX'`)).rows[0];
    if (!hx) throw new Error('Démo A/B/C absente : créez-la d’abord.');
    const cfg = hx.config_id;
    const types = await activerTypes(c, cfg, TYPES_PED);
    let n = 0;
    const refs = () => `P-${String(61000 + (n += 7))}`;
    // Centre pédiatrique fictif, à une vingtaine de minutes de A
    const ped = (await c.query(
      `INSERT INTO etablissements (code, nom, ville, adresse, latitude, longitude, config_id, partage, module_actif, vocation, modules)
       VALUES ('HPED', 'Centre pédiatrique des Érables (fictif)', 'Ville D', '400, avenue des Érables (fictive)', $1, $2, $3, 'complet', true,
               'pediatrique', '{"nsa": false}'::jsonb) RETURNING id`, [Number(hx.latitude) + 0.06, Number(hx.longitude) + 0.09, cfg])).rows[0].id;
    let compteD = null;
    if (hash) {
      compteD = (await c.query(`INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ('hopital.d@demo.arrimo', 'Coordination Centre pédiatrique', $1, 'coordonnateur')
        RETURNING id`, [hash])).rows[0].id;
      await c.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [compteD, ped]);
    }
    const dep = (await c.query(`INSERT INTO departements (etablissement_id, code, nom) VALUES ($1, 'PED', 'Département de pédiatrie') RETURNING id`, [ped])).rows[0].id;
    for (const p of PLAN_PED) {
      await creerUnite(c, ped, types[p[0]], p[0] === 'NEO' || p[0] === 'SIN' ? 'neonatal' : 'pediatrique', p,
        { departementId: dep, occupationRefs: refs, confirmePar: compteD });
    }
    // Urgence pédiatrique : civières pédiatriques et deux de débordement
    for (let i = 1; i <= 8; i += 1) {
      const occupee = i <= 5;
      await c.query(`INSERT INTO civieres (etablissement_id, code, categorie, etat, patient_ref, arrivee_le, etat_depuis)
        VALUES ($1, $2, $3, $4, $5, $6, now() - interval '2 hours')`,
      [ped, i <= 6 ? `URG-P${String(i).padStart(2, '0')}` : `COR-P${i - 6}`, i <= 6 ? 'pediatrique' : 'debordement',
        occupee ? 'occupee' : 'libre', occupee ? refs() : null, occupee ? new Date(Date.now() - i * 2.5 * 3600000) : null]);
    }
    // Hôpital C : petite unité de pédiatrie générale ; deux lits de chirurgie « tous âges » (chambres mixtes)
    const hc = (await c.query(`SELECT id FROM etablissements WHERE code = 'HC'`)).rows[0].id;
    const compteC = (await c.query(`SELECT id FROM utilisateurs WHERE email = 'hopital.c@demo.arrimo'`)).rows[0]?.id || null;
    await creerUnite(c, hc, types.PED, 'pediatrique', ['PED', 'Pédiatrie (Hôpital C)', 2, 2, 6, {}, 1], { occupationRefs: refs, confirmePar: compteC });
    await c.query(`UPDATE lits SET groupe_age = 'tous' WHERE id IN (SELECT l.id FROM lits l JOIN types_unite t ON t.id = l.type_id
      WHERE l.etablissement_id = $1 AND t.code = 'CHIR' ORDER BY (l.etat = 'libre') DESC, l.code LIMIT 2)`, [hc]);
    // Patients fictifs identifiés (noms manifestement fictifs), à l'urgence de A et du centre pédiatrique
    const auj = new Date();
    const naissance = (ans, jours = 0) => new Date(auj.getFullYear() - ans, auj.getMonth(), auj.getDate() - jours).toISOString().slice(0, 10);
    const patients = [
      [hx.id, 'Camille', 'Exemple-Démo', naissance(7), 'urgence'],
      [hx.id, 'Gabriel', 'Fictif-Essai', naissance(46), 'urgence'],
      [ped, 'Noé', 'Démonstration', naissance(4), 'urgence'],
      [ped, 'Lou', 'Fictive', naissance(0, 9), 'urgence'],
    ];
    for (const [etab, prenom, nom, dn, parcours] of patients) {
      await c.query(`INSERT INTO patients (etablissement_id, reference, prenom, nom, date_naissance, arrivee_le, parcours)
        VALUES ($1, 'P-' || lpad(nextval('patient_seq')::text, 5, '0'), $2, $3, $4, now() - interval '3 hours', $5)`, [etab, prenom, nom, dn, parcours]);
    }
    return { etablissement_id: ped, types };
  });
}

/** Congé prévu du lit MED-204A de A (demain 14 h, heure locale) : sert au parcours « congé par lit » et aux questions à OG. */
async function congeMed204A(pool) {
  await transaction(pool, async (c) => {
    const l = (await c.query(`SELECT l.id, l.etat FROM lits l JOIN etablissements e ON e.id = l.etablissement_id WHERE e.code = 'HX' AND l.code = 'MED-204A'`)).rows[0];
    if (!l) return;
    if (l.etat !== 'occupe') {
      await c.query(`UPDATE lits SET etat = 'occupe', patient_ref = 'P-20404', transfert_id = NULL, motif_indispo = NULL, version = version + 1, etat_depuis = now() - interval '2 days'
        WHERE id = $1`, [l.id]);
    }
    await c.query(`UPDATE lits SET conge_statut = 'prevu', sortie_prevue = (date_trunc('day', now() AT TIME ZONE cfg.fuseau) + interval '1 day 14 hours') AT TIME ZONE cfg.fuseau
      FROM etablissements e JOIN config_pays cfg ON cfg.id = e.config_id WHERE lits.id = $1 AND e.id = lits.etablissement_id`, [l.id]);
    await require('../src/terrain').synchroniserConge(c, l.id, null);
  });
}

module.exports = { ajouterPediatrie, congeMed204A, activerTypes, TYPES_PED };
