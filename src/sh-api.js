/**
 * API réservée à la console SH (siège), avec la clé de service de cet environnement (en-tête X-SH-Key = SH_API_KEY du .env).
 * La console ne reçoit que la structure, les comptes et des compteurs : jamais de référence patient.
 * Chaque action est inscrite au journal d'administration de l'environnement, avec le courriel du membre SH (« par »).
 *   GET  /api/sh/etablissements                  établissements et compteurs (unités, chambres, lits, civières, comptes)
 *   POST /api/sh/etablissements                  nouvel établissement (inactif)
 *   PUT  /api/sh/etablissements/{code}           module_actif (avec motif pour une désactivation), partage, sous_domaine
 *   GET  /api/sh/import/modeles/{type}           modèle CSV
 *   POST /api/sh/import/verifier | importer      import CSV (mêmes règles que l'administration)
 */
const crypto = require('crypto');
const { ErreurHttp, transaction } = require('./db');
const { journalAdmin, creerEtablissement } = require('./admin');
const imp = require('./import');
const formation = require('./formation');
const env = require('./environnement');
const motdepasse = require('./motdepasse');
const courriel = require('./courriel');

// Noms réservés : ne peuvent pas servir de lien d'hôpital
const RESERVES = ['www', 'sh', 'pilote', 'recette', 'api', 'demo', 'admin', 'mail'];
const SOUS_DOMAINE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

function exigerCle(req) {
  const cle = process.env.SH_API_KEY;
  const fournie = String(req.get('x-sh-key') || '');
  if (!cle) throw new ErreurHttp(503, 'sh_non_configure');
  const ok = fournie.length === cle.length && crypto.timingSafeEqual(Buffer.from(fournie), Buffer.from(cle));
  if (!ok) throw new ErreurHttp(401, 'cle_sh_invalide');
}
/** Auteur de l'action côté SH (courriel), repris dans le journal de l'environnement. */
const parSh = (b) => `console SH · ${String((b && b.par) || 'inconnu').slice(0, 120)}`;
const systeme = { id: null };

function brancherSh(api, pool, route) {
  const sh = (fn) => route(async (req, res) => { exigerCle(req); return fn(req, res); });
  const etabParCode = async (code) => {
    const e = (await pool.query('SELECT id, code, nom, partage, module_actif, sous_domaine FROM etablissements WHERE code = $1', [String(code || '').trim().toUpperCase()])).rows[0];
    if (!e) throw new ErreurHttp(404, 'etab_introuvable');
    return e;
  };

  api.get('/sh/capacites', sh(async () => ({ api: 1, invitationsSecurisees: true, courrielActif: courriel.actif(), configurationOperationnelle: true,
    selectionPays:true,profilsPays:require('./profils-pays').profilsAvecPays((await pool.query("SELECT id,code,nom FROM config_pays WHERE code NOT LIKE '%-CHSLD' ORDER BY id")).rows), typesEtablissement:true })));

  // Licence OG décidée dans SH (module OG souscrit et ses fonctions) ; les réglages de l'établissement sont conservés.
  api.get('/sh/etablissements/:code/og-licence', sh(async (req) => require('./og-configuration').lire(pool, (await etabParCode(req.params.code)).id)));
  api.put('/sh/etablissements/:code/og-licence', sh(async (req) => {
    const e = await etabParCode(req.params.code);
    const r = await require('./og-configuration').definirLicence(pool, e.id, req.body.licence);
    await journalAdmin(pool, systeme, 'Licence OG transmise par SH', e.nom, `${JSON.stringify(r.licence)} · ${parSh(req.body)}`, e.id);
    return r;
  }));
  api.get('/sh/etablissements/:code/configuration-operationnelle', sh(async (req) => {
    const e = await etabParCode(req.params.code);
    const etat = (await pool.query('SELECT modules, vocation, config_id, type_etablissement FROM etablissements WHERE id=$1', [e.id])).rows[0];
    const catalogue = (await pool.query('SELECT code, nom, groupe_age FROM specialites_catalogue ORDER BY ordre')).rows;
    const specialites = (await pool.query('SELECT code, nom, groupe_age FROM types_unite WHERE config_id=$1 ORDER BY ordre', [etat.config_id])).rows;
    const referentiel = (await pool.query('SELECT revision, categories, approuve_le FROM admission_referentiels WHERE etablissement_id=$1', [e.id])).rows[0] || null;
    return { modules: etat.modules, vocation: etat.vocation, version: require('./configuration-operationnelle').empreinte(etat), catalogue, specialites, referentiel_priorites: referentiel,
      type_etablissement: etat.type_etablissement, modules_modifiables: require('./configuration-operationnelle').modulesDuType(etat.type_etablissement) };
  }));
  api.put('/sh/etablissements/:code/configuration-operationnelle', sh(async (req) => {
    const configuration = require('./configuration-operationnelle');
    const e = await etabParCode(req.params.code);
    return transaction(pool, async (c) => {
      const avant = (await c.query('SELECT modules, vocation, type_etablissement FROM etablissements WHERE id=$1 FOR UPDATE', [e.id])).rows[0];
      const b = configuration.normaliser(req.body, avant.type_etablissement);
      if (typeof req.body.version !== 'string' || req.body.version !== configuration.empreinte(avant)) throw new ErreurHttp(409, 'configuration_operationnelle_conflit');
      const modules = configuration.fusionner(avant.modules, b.modules, avant.type_etablissement);
      const r = (await c.query('UPDATE etablissements SET modules=$2::jsonb, vocation=$3 WHERE id=$1 RETURNING modules,vocation', [e.id, modules, b.vocation])).rows[0];
      await journalAdmin(c, systeme, 'Configuration opérationnelle SH modifiée', e.nom, `${JSON.stringify({ avant, apres: r })} · ${parSh(req.body)}`, e.id);
      return { ...r, version: configuration.empreinte(r) };
    });
  }));

  api.get('/sh/etablissements', sh(async () => {
    const rows=(await pool.query(
    `SELECT e.id, e.code, e.nom, e.ville, e.adresse, e.partage, e.module_actif, e.sous_domaine,COALESCE(e.profil_config_id,e.config_id) config_id,profil.code configuration_code,
            e.type_etablissement, e.modules,
            (SELECT count(*)::int FROM unites u WHERE u.etablissement_id = e.id) AS unites,
            (SELECT count(*)::int FROM chambres ch JOIN unites u ON u.id = ch.unite_id WHERE u.etablissement_id = e.id) AS chambres,
            (SELECT count(*)::int FROM lits l WHERE l.etablissement_id = e.id) AS lits,
            (SELECT count(*)::int FROM civieres c WHERE c.etablissement_id = e.id) AS civieres,
            (SELECT count(*)::int FROM utilisateur_etablissements ue JOIN utilisateurs us ON us.id = ue.utilisateur_id AND us.actif
              WHERE ue.etablissement_id = e.id) AS comptes
       FROM etablissements e JOIN config_pays profil ON profil.id=COALESCE(e.profil_config_id,e.config_id) WHERE e.actif ORDER BY e.nom`)).rows;
    const profils=require('./profils-pays').profilsAvecPays(rows.map(e=>({id:e.config_id,code:e.configuration_code})));
    const paysParProfil=new Map(profils.map(p=>[p.id,p.pays_code]));
    return rows.map(e=>({...e,pays_code:paysParProfil.get(e.config_id)}));
  }));

  api.post('/sh/etablissements', sh((req) => {
    if(req.body.pays_code===undefined)throw new ErreurHttp(400,'profil_pays_requis');
    return creerEtablissement(pool, req.body, async (c, e) => {
    await journalAdmin(c, systeme, 'Établissement créé', `${e.code} · ${e.nom}`, parSh(req.body), e.id);
    // Recette : l'établissement sert aux tests et à la formation, il est donc ouvert dès sa création.
    // En production, il reste inactif jusqu'à l'activation par la console (étapes avant le go-live cochées).
    if (env.environnement() === 'recette') {
      await c.query('UPDATE etablissements SET module_actif = true WHERE id = $1', [e.id]);
      e.module_actif = true;
      await journalAdmin(c, systeme, 'Établissement modifié', e.nom, `module activé pour les tests et la formation (recette) · ${parSh(req.body)}`, e.id);
    }
  });}));

  /* ---------- C4 : formation (recette seulement), structure validée pour le go-live, comptes pour le rapport ---------- */
  api.post('/sh/formation/generer', sh(async (req) => {
    formation.exigerRecette();
    const e = await etabParCode(req.body.code);
    const n = await formation.generer(pool, e.id);
    await journalAdmin(pool, systeme, 'Données de formation générées', e.nom,
      `admissions : ${n.admissions} · congés prévus : ${n.conges} · nettoyages : ${n.nettoyages} · civières : ${n.civieres} · demandes de lit : ${n.demandes} · ${parSh(req.body)}`, e.id);
    return n;
  }));
  api.get('/sh/etablissements/:code/structure', sh(async (req) => formation.exporterStructure(pool, (await etabParCode(req.params.code)).id)));
  api.get('/sh/etablissements/:code/structure/detaillee', sh(async (req) => {
    const e = await etabParCode(req.params.code); const q = (sql) => pool.query(sql, [e.id]).then(r => r.rows);
    const [departements,services,unites,etages,chambres,lits,civieres] = await Promise.all([
      q('SELECT nom AS departement,code,attributs AS attributs_json,actif FROM departements WHERE etablissement_id=$1 ORDER BY nom'),
      q('SELECT s.nom AS service,s.code,d.nom AS departement,s.attributs AS attributs_json,s.actif FROM services s LEFT JOIN departements d ON d.id=s.departement_id WHERE s.etablissement_id=$1 ORDER BY s.nom'),
      q(`SELECT u.nom AS unite,t.code AS type_unite,s.nom AS service,d.nom AS departement,u.attributs AS attributs_json,u.actif FROM unites u JOIN types_unite t ON t.id=u.type_id LEFT JOIN services s ON s.id=u.service_id LEFT JOIN departements d ON d.id=u.departement_id WHERE u.etablissement_id=$1 ORDER BY u.nom`),
      q(`SELECT u.nom AS unite,g.nom AS etage,g.aile,g.attributs AS attributs_json,g.actif FROM etages g JOIN unites u ON u.id=g.unite_id WHERE u.etablissement_id=$1 ORDER BY u.nom,g.nom`),
      q(`SELECT u.nom AS unite,ch.numero AS chambre,g.nom AS etage,ch.type_chambre,ch.capacite_declaree AS capacite,CASE WHEN ch.accessible THEN 'oui' ELSE 'non' END AS accessible,ch.attributs AS attributs_json,ch.restrictions AS restrictions_json,ch.statut_operationnel,ch.actif FROM chambres ch JOIN unites u ON u.id=ch.unite_id LEFT JOIN etages g ON g.id=ch.etage_id WHERE u.etablissement_id=$1 ORDER BY u.nom,ch.numero`),
      q(`SELECT u.nom AS unite,ch.numero AS chambre,l.code AS lit,l.isolement,l.pression_negative,l.ventilation,l.telemetrie,l.categorie,l.attributs AS attributs_json,l.actif FROM lits l JOIN chambres ch ON ch.id=l.chambre_id JOIN unites u ON u.id=ch.unite_id WHERE l.etablissement_id=$1 ORDER BY u.nom,ch.numero,l.code`),
      q(`SELECT c.code AS civiere,c.categorie,u.nom AS unite,c.attributs AS attributs_json,c.actif FROM civieres c LEFT JOIN unites u ON u.id=c.unite_id WHERE c.etablissement_id=$1 ORDER BY c.code`),
    ]);
    return { departements,services,unites,etages,chambres,lits,civieres };
  }));
  api.get('/sh/etablissements/:code/comptes', sh(async (req) => formation.comptes(pool, (await etabParCode(req.params.code)).id)));

  api.put('/sh/etablissements/:code', sh(async (req) => {
    const b = req.body || {};
    const e = await etabParCode(req.params.code);
    const sets = []; const vals = [e.id]; const detail = [];
    if (b.module_actif !== undefined) {
      const actif = !!b.module_actif;
      const motif = String(b.motif || '').trim();
      // Désactivation demandée par la console : motif obligatoire
      if (!actif && b.par && motif.length < 3) throw new ErreurHttp(400, 'motif_desactivation');
      vals.push(actif); sets.push(`module_actif = $${vals.length}`);
      detail.push(`module ${actif ? 'activé' : 'désactivé'}${motif ? ` · motif : ${motif.slice(0, 300)}` : ''}`);
    }
    if (b.partage !== undefined) {
      if (!['complet', 'agrege', 'aucun'].includes(b.partage)) throw new ErreurHttp(400, 'partage_invalide');
      vals.push(b.partage); sets.push(`partage = $${vals.length}`); detail.push(`partage ${b.partage}`);
    }
    if (b.sous_domaine !== undefined) {
      const sd = b.sous_domaine == null || b.sous_domaine === '' ? null : String(b.sous_domaine).trim().toLowerCase();
      if (sd && (!SOUS_DOMAINE.test(sd) || RESERVES.includes(sd))) throw new ErreurHttp(400, 'sous_domaine_invalide');
      if (sd && (await pool.query('SELECT 1 FROM etablissements WHERE sous_domaine = $1 AND id <> $2', [sd, e.id])).rows[0]) throw new ErreurHttp(409, 'sous_domaine_pris');
      vals.push(sd); sets.push(`sous_domaine = $${vals.length}`); detail.push(`lien ${sd || 'retiré'}`);
    }
    // Configuration modulaire préparée par SH : modules désactivés (false) et vocation de l'établissement
    if (b.modules !== undefined) {
      const m = {};
      for (const k of ['urgence', 'nsa', 'nettoyage', 'national']) if (b.modules && b.modules[k] === false) m[k] = false;
      vals.push(m); sets.push(`modules = $${vals.length}::jsonb`); detail.push(`modules désactivés : ${Object.keys(m).join(', ') || 'aucun'}`);
    }
    if (b.vocation !== undefined) {
      if (!['general', 'pediatrique', 'specialise'].includes(b.vocation)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'vocation' });
      vals.push(b.vocation); sets.push(`vocation = $${vals.length}`); detail.push(`vocation ${b.vocation}`);
    }
    if (!sets.length) throw new ErreurHttp(400, 'rien_a_modifier');
    const r = (await pool.query(`UPDATE etablissements SET ${sets.join(', ')} WHERE id = $1 RETURNING id, code, nom, partage, module_actif, sous_domaine, modules, vocation`, vals)).rows[0];
    await journalAdmin(pool, systeme, 'Établissement modifié', r.nom, `${detail.join(' · ')} · ${parSh(b)}`, r.id);
    return r;
  }));

  // Catalogue des spécialités et activation pour la configuration de l'établissement (types d'unité, groupe d'âge)
  api.get('/sh/specialites', sh(async () => (await pool.query('SELECT * FROM specialites_catalogue ORDER BY ordre')).rows));
  api.post('/sh/etablissements/:code/specialites', sh(async (req) => {
    const e = await etabParCode(req.params.code);
    const sp = (await pool.query('SELECT * FROM specialites_catalogue WHERE code = $1', [String(req.body?.specialite || '')])).rows[0];
    if (!sp) throw new ErreurHttp(400, 'specialite_inconnue');
    const cfg = (await pool.query('SELECT config_id FROM etablissements WHERE id = $1', [e.id])).rows[0].config_id;
    const r = (await pool.query(`INSERT INTO types_unite (config_id, code, nom, nom_en, ordre, groupe_age, specialite) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (config_id, code) DO UPDATE SET groupe_age = EXCLUDED.groupe_age, specialite = EXCLUDED.specialite RETURNING id, code, nom, groupe_age`,
    [cfg, sp.code, sp.nom, sp.nom_en, sp.ordre, sp.groupe_age, sp.famille])).rows[0];
    await journalAdmin(pool, systeme, 'Spécialité activée', sp.nom, parSh(req.body || {}), e.id);
    return r;
  }));
  api.get('/sh/import/modeles/:type', async (req, res, next) => {
    try {
      exigerCle(req);
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="arrimo-${req.params.type}.csv"` }).send(imp.modele(req.params.type));
    } catch (e) { next(e); }
  });
  api.post('/sh/import/verifier', sh(async (req) => {
    const e = await etabParCode(req.body.code);
    const v = await imp.verifier(pool, e.id, String(req.body.type || ''), String(req.body.contenu || ''));
    return { lignes: v.lignes, erreurs: v.erreurs.slice(0, 500), nb_erreurs: v.erreurs.length, actions: v.actions.slice(0, 500), resume: v.resume, empreinte: v.empreinte };
  }));
  api.post('/sh/import/importer', sh(async (req) => {
    const e = await etabParCode(req.body.code);
    // Journal de l'environnement : l'auteur est le membre SH
    const journal = (c, u, action, cible, detail, etab) => journalAdmin(c, systeme, action, cible, `${detail} · ${parSh(req.body)}`, etab);
    const type = String(req.body.type || '');
    if (req.body.invitations === true && type !== 'utilisateurs') throw new ErreurHttp(400, 'parametre_invalide', { nom: 'type' });
    if (req.body.invitations === true && !courriel.actif()) throw new ErreurHttp(503, 'courriel_non_configure');
    const r = await imp.importer(pool, systeme, e.id, type, String(req.body.contenu || ''), String(req.body.empreinte || ''), journal,
      { invitations: req.body.invitations === true });
    if (req.body.invitations === true) {
      for (const compte of r.comptes || []) await motdepasse.inviter(pool, compte.courriel, compte.nom, req.body.par);
      return { lignes: r.lignes, resume: r.resume, invitations_envoyees: (r.comptes || []).length };
    }
    return r;
  }));
}

/** Lien propre d'un hôpital : <sous_domaine>.<hôte de l'environnement> mène à son établissement. */
async function etablissementDuLien(pool, hoteDemande, hoteEnv) {
  const h = String(hoteDemande || '').toLowerCase();
  if (!hoteEnv || !h.endsWith(`.${hoteEnv}`)) return null;
  const sd = h.slice(0, -(hoteEnv.length + 1));
  if (!SOUS_DOMAINE.test(sd)) return null;
  return (await pool.query('SELECT id, nom FROM etablissements WHERE sous_domaine = $1 AND actif', [sd])).rows[0] || null;
}

module.exports = { brancherSh, etablissementDuLien, SOUS_DOMAINE, RESERVES };
