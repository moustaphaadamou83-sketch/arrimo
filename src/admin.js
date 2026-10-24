/**
 * Mon compte (mot de passe, double authentification) et administration :
 * utilisateurs, structure (unités, chambres, lits), configuration pays, connecteurs, journal d'administration.
 *
 * Rôles : gestionnaire (tout le réseau) et admin_etab (ses établissements seulement).
 * Toute action d'administration exige la double authentification activée (ARRIMO_2FA_ADMIN=0 pour désactiver en test).
 */
const QRCode = require('qrcode');
const { transaction, ErreurHttp } = require('./db');
const { hacherAsync, changerMotDePasse, verifierRobustesse, motDePasseTemporaire, chiffrerSecretMfa, lireSecretMfa } = require('./auth');
const totp = require('./totp');
const { journaliser } = require('./regles');
const cx = require('./connecteurs');
const demo = require('./demo');
const s = require('./services');

const ROLES = ['coordonnateur', 'entretien', 'admin_etab', 'gestionnaire'];

async function journalAdmin(db, u, action, cible, detail, etablissementId = null) {
  await db.query(`INSERT INTO journal_admin (utilisateur_id, etablissement_id, action, cible, detail) VALUES ($1, $2, $3, $4, $5)`,
    [u.id, etablissementId, action, cible, detail]);
}

/** Nouvel établissement, créé inactif (l'activation suit l'implantation, console SH). journaliser(c, etab) écrit l'entrée du journal. */
async function creerEtablissement(pool, b, journaliserCreation) {
  const code = String(b.code || '').trim().toUpperCase();
  const nom = String(b.nom || '').trim();
  const lat = Number(b.latitude); const lon = Number(b.longitude);
  if (!/^[A-Z0-9-]{2,12}$/.test(code)) throw new ErreurHttp(400, 'code_etab_invalide');
  if (!nom) throw new ErreurHttp(400, 'nom_requis');
  if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180) || b.latitude === '' || b.longitude === '' || b.latitude == null || b.longitude == null) throw new ErreurHttp(400, 'position_invalide');
  const partage = b.partage || 'complet';
  if (!['complet', 'agrege', 'aucun'].includes(partage)) throw new ErreurHttp(400, 'partage_invalide');
  const config = (await pool.query('SELECT id FROM config_pays ORDER BY id LIMIT 1')).rows[0];
  if (!config) throw new ErreurHttp(400, 'config_introuvable');
  return transaction(pool, async (c) => {
    if ((await c.query('SELECT 1 FROM etablissements WHERE code = $1', [code])).rows[0]) throw new ErreurHttp(409, 'code_etab_existe');
    const e = (await c.query(`INSERT INTO etablissements (code, nom, ville, adresse, latitude, longitude, config_id, partage, module_actif)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false) RETURNING id, code, nom, ville, adresse, partage, module_actif`,
    [code, nom, String(b.ville || '').trim() || null, String(b.adresse || '').trim() || null, lat, lon, config.id, partage])).rows[0];
    await journaliserCreation(c, e);
    return e;
  });
}

function brancher(api, pool, route, entier, options = {}) {
  /* ---------------------------------------------------------------- mon compte */
  api.put('/moi/mot-de-passe', route(async (req) => {
    await changerMotDePasse(pool, req.utilisateur, req.body.actuel, req.body.nouveau);
    await journalAdmin(pool, req.utilisateur, 'Mot de passe changé', req.utilisateur.email, null);
  }));

  api.post('/moi/premiers-pas', route(async (req) => {
    await pool.query('UPDATE utilisateurs SET premiers_pas_vus = true WHERE id = $1', [req.utilisateur.id]);
  }));

  api.post('/moi/2fa/preparer', route(async (req) => {
    if (req.utilisateur.totp_actif) throw new ErreurHttp(409, 'deja_2fa');
    const secret = totp.nouveauSecret();
    await pool.query('UPDATE utilisateurs SET totp_secret = $2, totp_dernier_pas = 0 WHERE id = $1', [req.utilisateur.id, chiffrerSecretMfa(secret)]);
    const lien = totp.uri(secret, req.utilisateur.email);
    return { secret, uri: lien, qr_svg: await QRCode.toString(lien, { type: 'svg', margin: 1, width: 200 }) };
  }));

  api.post('/moi/2fa/activer', route(async (req) => {
    const u = (await pool.query('SELECT totp_secret, totp_actif FROM utilisateurs WHERE id = $1', [req.utilisateur.id])).rows[0];
    if (u.totp_actif) throw new ErreurHttp(409, 'deja_2fa');
    if (!u.totp_secret) throw new ErreurHttp(400, 'qr_dabord');
    const pas = totp.verifierCode(lireSecretMfa(u.totp_secret), req.body.code, 0);
    if (!pas) throw new ErreurHttp(400, 'code_incorrect_heure');
    await pool.query('UPDATE utilisateurs SET totp_actif = true, totp_dernier_pas = $2 WHERE id = $1', [req.utilisateur.id, pas]);
    await journalAdmin(pool, req.utilisateur, 'Double authentification activée', req.utilisateur.email, null);
  }));

  api.post('/moi/2fa/desactiver', route(async (req) => {
    const u = (await pool.query('SELECT totp_secret, totp_actif, totp_dernier_pas FROM utilisateurs WHERE id = $1', [req.utilisateur.id])).rows[0];
    if (!u.totp_actif) throw new ErreurHttp(409, 'pas_2fa');
    if (!totp.verifierCode(lireSecretMfa(u.totp_secret), req.body.code, u.totp_dernier_pas)) throw new ErreurHttp(400, 'code_incorrect');
    await pool.query('UPDATE utilisateurs SET totp_actif = false, totp_secret = NULL WHERE id = $1', [req.utilisateur.id]);
    await journalAdmin(pool, req.utilisateur, 'Double authentification désactivée', req.utilisateur.email, null);
  }));

  /* ---------------------------------------------------------------- garde d'administration */
  const exigerAdmin = (req) => {
    const u = req.utilisateur;
    if (!u.admin) throw new ErreurHttp(403, 'reserve_admin');
    if (process.env.ARRIMO_2FA_ADMIN !== '0' && !u.totp_actif) {
      throw new ErreurHttp(403, 'admin_exige_2fa');
    }
  };
  const exigerGestionnaire = (req) => {
    exigerAdmin(req);
    if (!req.utilisateur.gestionnaire) throw new ErreurHttp(403, 'reserve_gestionnaire');
  };
  const etabsGerables = async (u) => (u.gestionnaire
    ? (await pool.query('SELECT id FROM etablissements')).rows.map((r) => r.id)
    : u.etabs);
  const exigerEtabGerable = async (u, etabId) => {
    if (!(await etabsGerables(u)).includes(Number(etabId))) throw new ErreurHttp(403, 'etab_non_administre');
  };
  const attributsStructure = (v) => {
    const a = v == null ? {} : v;
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new ErreurHttp(400, 'structure_attributs_invalides');
    const texte = JSON.stringify(a);
    if (texte.length > 8192 || Object.keys(a).length > 50
      || Object.keys(a).some((k) => /patient|diagnos|naissance|assurance|dossier|adresse|telephone/i.test(k))) {
      throw new ErreurHttp(400, 'structure_attributs_invalides');
    }
    return texte;
  };

  /* -------- Référentiel hospitalier détaillé. Les états de lits/civières restent gérés par leurs workflows dédiés. */
  api.get('/admin/structure/detaillee', route(async (req) => {
    exigerAdmin(req);
    const etab = entier(req.query.etablissement_id, 'etablissement_id');
    await exigerEtabGerable(req.utilisateur, etab);
    const [departements, services, unites, etages, chambres, lits, civieres] = await Promise.all([
      pool.query('SELECT id, code, nom, actif, attributs FROM departements WHERE etablissement_id=$1 ORDER BY nom', [etab]),
      pool.query('SELECT id, code, nom, departement_id, actif, attributs FROM services WHERE etablissement_id=$1 ORDER BY nom', [etab]),
      pool.query(`SELECT u.id,u.nom,u.type_id,t.code AS type_code,t.nom AS type_nom,u.service_id,u.departement_id,u.actif,u.attributs,
        (SELECT count(*)::int FROM chambres ch WHERE ch.unite_id=u.id AND ch.actif) AS chambres,
        (SELECT count(*)::int FROM lits l WHERE l.unite_id=u.id AND l.actif) AS lits,
        (SELECT count(*)::int FROM civieres c WHERE c.unite_id=u.id AND c.actif) AS civieres
        FROM unites u JOIN types_unite t ON t.id=u.type_id WHERE u.etablissement_id=$1 ORDER BY u.nom`, [etab]),
      pool.query(`SELECT g.id,g.unite_id,g.code,g.nom,g.aile,g.actif,g.attributs,
        (SELECT count(*)::int FROM chambres ch WHERE ch.etage_id=g.id AND ch.actif) AS chambres
        FROM etages g JOIN unites u ON u.id=g.unite_id WHERE u.etablissement_id=$1 ORDER BY u.nom,g.code`, [etab]),
      pool.query(`SELECT ch.id,ch.unite_id,ch.etage_id,ch.numero,ch.type_chambre,ch.capacite_declaree,ch.accessible,
        ch.attributs,ch.restrictions,ch.statut_operationnel,ch.actif,
        (SELECT count(*)::int FROM lits l WHERE l.chambre_id=ch.id AND l.actif) AS lits_calcules
        FROM chambres ch JOIN unites u ON u.id=ch.unite_id WHERE u.etablissement_id=$1 ORDER BY u.nom,ch.numero`, [etab]),
      pool.query(`SELECT id,chambre_id,unite_id,code,etat,categorie,attributs,actif,disponibilite_confirmee_le,isolement,pression_negative,ventilation,telemetrie
        FROM lits WHERE etablissement_id=$1 ORDER BY code`, [etab]),
      pool.query('SELECT id,code,categorie,etat,unite_id,attributs,actif FROM civieres WHERE etablissement_id=$1 ORDER BY code', [etab]),
    ]);
    return { etablissement_id: etab, departements: departements.rows, services: services.rows, unites: unites.rows,
      etages: etages.rows, chambres: chambres.rows, lits: lits.rows, civieres: civieres.rows };
  }));

  api.post('/admin/departements', route(async (req) => {
    exigerAdmin(req);
    const etab = entier(req.body.etablissement_id, 'etablissement_id'); await exigerEtabGerable(req.utilisateur, etab);
    const code = String(req.body.code || '').trim().toUpperCase(), nom = String(req.body.nom || '').trim();
    if (!/^[A-Z0-9_-]{1,30}$/.test(code) || !nom) throw new ErreurHttp(400, 'structure_code_nom_invalides');
    try {
      const d = (await pool.query(`INSERT INTO departements(etablissement_id,code,nom,attributs) VALUES($1,$2,$3,$4::jsonb) RETURNING *`,
        [etab, code, nom, attributsStructure(req.body.attributs)])).rows[0];
      await journalAdmin(pool, req.utilisateur, 'Département créé', `${code} · ${nom}`, null, etab); return d;
    } catch (e) { if (e.code === '23505') throw new ErreurHttp(409, 'structure_code_existe'); throw e; }
  }));

  api.put('/admin/departements/:id', route(async (req) => {
    exigerAdmin(req); const id = entier(req.params.id, 'id');
    const ancien = (await pool.query('SELECT * FROM departements WHERE id=$1', [id])).rows[0];
    if (!ancien) throw new ErreurHttp(404, 'structure_introuvable'); await exigerEtabGerable(req.utilisateur, ancien.etablissement_id);
    const nom = String(req.body.nom ?? ancien.nom).trim(), actif = req.body.actif === undefined ? ancien.actif : !!req.body.actif;
    const d = (await pool.query(`UPDATE departements SET nom=$2,actif=$3,attributs=$4::jsonb,modifie_le=now() WHERE id=$1 RETURNING *`,
      [id, nom, actif, attributsStructure(req.body.attributs ?? ancien.attributs)])).rows[0];
    await journalAdmin(pool, req.utilisateur, 'Département modifié', d.code, `actif=${actif}`, ancien.etablissement_id); return d;
  }));

  api.post('/admin/services', route(async (req) => {
    exigerAdmin(req); const etab = entier(req.body.etablissement_id, 'etablissement_id'); await exigerEtabGerable(req.utilisateur, etab);
    const code = String(req.body.code || '').trim().toUpperCase(), nom = String(req.body.nom || '').trim();
    if (!/^[A-Z0-9_-]{1,30}$/.test(code) || !nom) throw new ErreurHttp(400, 'structure_code_nom_invalides');
    const deptId = req.body.departement_id == null ? null : entier(req.body.departement_id, 'departement_id');
    if (deptId && !(await pool.query('SELECT 1 FROM departements WHERE id=$1 AND etablissement_id=$2', [deptId, etab])).rows[0]) throw new ErreurHttp(400, 'structure_rattachement_invalide');
    try {
      const s = (await pool.query(`INSERT INTO services(etablissement_id,code,nom,departement_id,attributs) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *`,
        [etab, code, nom, deptId, attributsStructure(req.body.attributs)])).rows[0];
      await journalAdmin(pool, req.utilisateur, 'Service créé', `${code} · ${nom}`, null, etab); return s;
    } catch (e) { if (e.code === '23505') throw new ErreurHttp(409, 'structure_code_existe'); throw e; }
  }));
  api.put('/admin/services/:id', route(async (req) => {
    exigerAdmin(req); const id=entier(req.params.id,'id');
    const old=(await pool.query('SELECT * FROM services WHERE id=$1',[id])).rows[0];
    if(!old) throw new ErreurHttp(404,'structure_introuvable'); await exigerEtabGerable(req.utilisateur,old.etablissement_id);
    const deptId=req.body.departement_id===undefined?old.departement_id:(req.body.departement_id==null?null:entier(req.body.departement_id,'departement_id'));
    if(deptId&&!(await pool.query('SELECT 1 FROM departements WHERE id=$1 AND etablissement_id=$2',[deptId,old.etablissement_id])).rows[0]) throw new ErreurHttp(400,'structure_rattachement_invalide');
    const nom=String(req.body.nom??old.nom).trim(); if(!nom) throw new ErreurHttp(400,'structure_code_nom_invalides');
    const actif=req.body.actif===undefined?old.actif:!!req.body.actif;
    const r=(await pool.query(`UPDATE services SET nom=$2,departement_id=$3,actif=$4,attributs=$5::jsonb WHERE id=$1 RETURNING *`,
      [id,nom,deptId,actif,attributsStructure(req.body.attributs??old.attributs)])).rows[0];
    await journalAdmin(pool,req.utilisateur,'Service modifié',old.code,`actif=${actif}`,old.etablissement_id); return r;
  }));

  api.post('/admin/etages', route(async (req) => {
    exigerAdmin(req); const uniteId = entier(req.body.unite_id, 'unite_id');
    const u = (await pool.query('SELECT id,etablissement_id FROM unites WHERE id=$1', [uniteId])).rows[0];
    if (!u) throw new ErreurHttp(404, 'unite_introuvable'); await exigerEtabGerable(req.utilisateur, u.etablissement_id);
    const code = String(req.body.code || '').trim().toUpperCase(), nom = String(req.body.nom || '').trim(), aile = String(req.body.aile || '').trim() || null;
    if (!/^[A-Z0-9_-]{1,30}$/.test(code) || !nom) throw new ErreurHttp(400, 'structure_code_nom_invalides');
    try {
      const g = (await pool.query(`INSERT INTO etages(unite_id,code,nom,aile,attributs) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *`,
        [uniteId, code, nom, aile, attributsStructure(req.body.attributs)])).rows[0];
      await journalAdmin(pool, req.utilisateur, 'Étage créé', `${code} · ${nom}${aile ? ` · ${aile}` : ''}`, null, u.etablissement_id); return g;
    } catch (e) { if (e.code === '23505') throw new ErreurHttp(409, 'structure_code_existe'); throw e; }
  }));
  api.put('/admin/etages/:id', route(async (req) => {
    exigerAdmin(req); const id=entier(req.params.id,'id');
    const old=(await pool.query(`SELECT g.*,u.etablissement_id FROM etages g JOIN unites u ON u.id=g.unite_id WHERE g.id=$1`,[id])).rows[0];
    if(!old) throw new ErreurHttp(404,'structure_introuvable'); await exigerEtabGerable(req.utilisateur,old.etablissement_id);
    const nom=String(req.body.nom??old.nom).trim(); if(!nom) throw new ErreurHttp(400,'structure_code_nom_invalides');
    const actif=req.body.actif===undefined?old.actif:!!req.body.actif;
    if(!actif&&(await pool.query(`SELECT 1 FROM chambres WHERE etage_id=$1 AND (actif OR statut_operationnel='actif') LIMIT 1`,[id])).rows[0]) throw new ErreurHttp(409,'structure_etage_utilise');
    const r=(await pool.query(`UPDATE etages SET nom=$2,aile=$3,actif=$4,attributs=$5::jsonb,modifie_le=now() WHERE id=$1 RETURNING *`,
      [id,nom,req.body.aile===undefined?old.aile:(String(req.body.aile||'').trim()||null),actif,attributsStructure(req.body.attributs??old.attributs)])).rows[0];
    await journalAdmin(pool,req.utilisateur,'Étage modifié',old.code,`actif=${actif}`,old.etablissement_id); return r;
  }));

  api.put('/admin/unites/:id', route(async (req) => {
    exigerAdmin(req); const id=entier(req.params.id,'id');
    const old=(await pool.query('SELECT * FROM unites WHERE id=$1',[id])).rows[0];
    if(!old) throw new ErreurHttp(404,'unite_introuvable'); await exigerEtabGerable(req.utilisateur,old.etablissement_id);
    const nom=String(req.body.nom??old.nom).trim(); if(!nom) throw new ErreurHttp(400,'nom_unite_requis');
    const serviceId=req.body.service_id===undefined?old.service_id:(req.body.service_id==null?null:entier(req.body.service_id,'service_id'));
    const service=serviceId?(await pool.query('SELECT id,departement_id FROM services WHERE id=$1 AND etablissement_id=$2',[serviceId,old.etablissement_id])).rows[0]:null;
    if(serviceId&&!service) throw new ErreurHttp(400,'structure_rattachement_invalide');
    const deptExplicit=req.body.departement_id===undefined?old.departement_id:(req.body.departement_id==null?null:entier(req.body.departement_id,'departement_id'));
    const deptId=deptExplicit||service?.departement_id||null;
    if(deptId&&!(await pool.query('SELECT 1 FROM departements WHERE id=$1 AND etablissement_id=$2',[deptId,old.etablissement_id])).rows[0]) throw new ErreurHttp(400,'structure_rattachement_invalide');
    if(service&&deptId&&service.departement_id!==deptId) throw new ErreurHttp(400,'service_autre_departement');
    const actif=req.body.actif===undefined?old.actif:!!req.body.actif;
    if(!actif&&(await pool.query(`SELECT 1 FROM lits WHERE unite_id=$1 AND etat<>'indispo' UNION ALL SELECT 1 FROM civieres WHERE unite_id=$1 AND etat<>'indispo' LIMIT 1`,[id])).rows[0]) throw new ErreurHttp(409,'structure_unite_utilisee');
    const r=(await pool.query(`UPDATE unites SET nom=$2,service_id=$3,departement_id=$4,actif=$5,attributs=$6::jsonb WHERE id=$1 RETURNING *`,
      [id,nom,serviceId,deptId,actif,attributsStructure(req.body.attributs??old.attributs)])).rows[0];
    await journalAdmin(pool,req.utilisateur,'Unité modifiée',old.nom,`actif=${actif}`,old.etablissement_id); return r;
  }));

  /* ---------------------------------------------------------------- utilisateurs */
  api.get('/admin/utilisateurs', route(async (req) => {
    exigerAdmin(req);
    const gerables = await etabsGerables(req.utilisateur);
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.nom, u.role, u.actif, u.totp_actif, u.mdp_temporaire, u.derniere_connexion, u.cree_le,
              COALESCE(array_agg(ue.etablissement_id) FILTER (WHERE ue.etablissement_id IS NOT NULL), '{}') AS etablissements
         FROM utilisateurs u LEFT JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id
        GROUP BY u.id ORDER BY u.nom`);
    // Un administrateur d'établissement ne voit que les comptes rattachés exclusivement à ses établissements
    return req.utilisateur.gestionnaire ? rows
      : rows.filter((r) => r.role !== 'gestionnaire' && r.etablissements.length && r.etablissements.every((e) => gerables.includes(e)));
  }));

  async function verifierCompte(req, b, existant = null) {
    const u = req.utilisateur;
    const role = b.role ?? existant?.role;
    if (!ROLES.includes(role)) throw new ErreurHttp(400, 'role_inconnu');
    if (role === 'gestionnaire' && !u.gestionnaire) throw new ErreurHttp(403, 'role_gestionnaire_interdit');
    const etabs = (b.etablissements ?? existant?.etablissements ?? []).map(Number);
    if (role !== 'gestionnaire' && !etabs.length) throw new ErreurHttp(400, 'compte_sans_etab');
    const gerables = await etabsGerables(u);
    if (etabs.some((e) => !gerables.includes(e))) throw new ErreurHttp(403, 'etabs_non_administres');
    if (existant && !u.gestionnaire && (existant.role === 'gestionnaire' || existant.etablissements.some((e) => !gerables.includes(e)))) {
      throw new ErreurHttp(403, 'compte_autre_admin');
    }
    return { role, etabs };
  }
  async function lireCompte(id) {
    const r = await pool.query(
      `SELECT u.*, COALESCE(array_agg(ue.etablissement_id) FILTER (WHERE ue.etablissement_id IS NOT NULL), '{}') AS etablissements
         FROM utilisateurs u LEFT JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id WHERE u.id = $1 GROUP BY u.id`, [id]);
    if (!r.rows[0]) throw new ErreurHttp(404, 'compte_introuvable');
    return r.rows[0];
  }

  api.post('/admin/utilisateurs', route(async (req) => {
    exigerAdmin(req);
    const email = String(req.body.email || '').trim().toLowerCase();
    const nom = String(req.body.nom || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErreurHttp(400, 'courriel_invalide');
    if (!nom) throw new ErreurHttp(400, 'nom_requis');
    const { role, etabs } = await verifierCompte(req, req.body);
    const temporaire = motDePasseTemporaire();
    return transaction(pool, async (c) => {
      const deja = await c.query('SELECT 1 FROM utilisateurs WHERE email = $1', [email]);
      if (deja.rows[0]) throw new ErreurHttp(409, 'compte_existe');
      const u = (await c.query(
        `INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role, mdp_temporaire) VALUES ($1, $2, $3, $4, true) RETURNING id, email, nom, role`,
        [email, nom, await hacherAsync(temporaire), role])).rows[0];
      for (const e of etabs) await c.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u.id, e]);
      await journalAdmin(c, req.utilisateur, 'Compte créé', email, `Rôle ${role}`, etabs[0] || null);
      return { ...u, etablissements: etabs, mot_de_passe_temporaire: temporaire };
    });
  }));

  api.put('/admin/utilisateurs/:id', route(async (req) => {
    exigerAdmin(req);
    const id = entier(req.params.id, 'id');
    const existant = await lireCompte(id);
    if (id === req.utilisateur.id && req.body.actif === false) throw new ErreurHttp(400, 'desactiver_soi');
    const { role, etabs } = await verifierCompte(req, req.body, existant);
    return transaction(pool, async (c) => {
      const nom = req.body.nom !== undefined ? String(req.body.nom).trim() : existant.nom;
      const actif = req.body.actif !== undefined ? !!req.body.actif : existant.actif;
      await c.query('UPDATE utilisateurs SET nom = $2, role = $3, actif = $4 WHERE id = $1', [id, nom, role, actif]);
      await c.query('DELETE FROM utilisateur_etablissements WHERE utilisateur_id = $1', [id]);
      for (const e of etabs) await c.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [id, e]);
      if (!actif) await c.query('DELETE FROM sessions WHERE utilisateur_id = $1', [id]);
      await journalAdmin(c, req.utilisateur, actif ? 'Compte modifié' : 'Compte désactivé', existant.email,
        `Rôle ${role} · établissements ${etabs.join(', ')}`, etabs[0] || null);
      return { id, nom, role, actif, etablissements: etabs };
    });
  }));

  api.post('/admin/utilisateurs/:id/reinitialiser', route(async (req) => {
    exigerAdmin(req);
    const id = entier(req.params.id, 'id');
    const existant = await lireCompte(id);
    await verifierCompte(req, {}, existant);
    const temporaire = motDePasseTemporaire();
    await pool.query(
      `UPDATE utilisateurs SET mot_de_passe_hash = $2, mdp_temporaire = true, totp_actif = CASE WHEN $3 THEN false ELSE totp_actif END,
              totp_secret = CASE WHEN $3 THEN NULL ELSE totp_secret END WHERE id = $1`, [id, await hacherAsync(temporaire), !!req.body.reinitialiser_2fa]);
    await pool.query('DELETE FROM sessions WHERE utilisateur_id = $1', [id]);
    await journalAdmin(pool, req.utilisateur, 'Mot de passe réinitialisé', existant.email, req.body.reinitialiser_2fa ? 'avec double authentification' : null,
      existant.etablissements[0] || null);
    return { mot_de_passe_temporaire: temporaire };
  }));

  /* ---------------------------------------------------------------- structure */
  api.get('/admin/structure', route(async (req) => {
    exigerAdmin(req);
    const etab = entier(req.query.etablissement_id, 'etablissement_id');
    await exigerEtabGerable(req.utilisateur, etab);
    const unites = (await pool.query(
      `SELECT u.id, u.nom, t.nom AS type_nom, t.code AS type_code, t.id AS type_id FROM unites u JOIN types_unite t ON t.id = u.type_id
        WHERE u.etablissement_id = $1 ORDER BY t.ordre, u.nom`, [etab])).rows;
    const chambres = (await pool.query(
      `SELECT ch.id, ch.unite_id, ch.numero FROM chambres ch JOIN unites u ON u.id = ch.unite_id WHERE u.etablissement_id = $1 ORDER BY ch.numero`, [etab])).rows;
    const lits = (await pool.query(
      `SELECT id, chambre_id, code, etat, isolement, pression_negative, ventilation, telemetrie FROM lits WHERE etablissement_id = $1 ORDER BY code`, [etab])).rows;
    return unites.map((u) => ({ ...u, chambres: chambres.filter((c) => c.unite_id === u.id).map((c) => ({ ...c, lits: lits.filter((l) => l.chambre_id === c.id) })) }));
  }));

  api.post('/admin/unites', route(async (req) => {
    exigerAdmin(req);
    const etab = entier(req.body.etablissement_id, 'etablissement_id');
    await exigerEtabGerable(req.utilisateur, etab);
    const nom = String(req.body.nom || '').trim();
    if (!nom) throw new ErreurHttp(400, 'nom_unite_requis');
    const ok = await pool.query(`SELECT 1 FROM types_unite t JOIN etablissements e ON e.config_id = t.config_id WHERE t.id = $1 AND e.id = $2`,
      [req.body.type_id, etab]);
    if (!ok.rows[0]) throw new ErreurHttp(400, 'type_unite_pays');
    const serviceId = req.body.service_id == null ? null : entier(req.body.service_id, 'service_id');
    const service = serviceId ? (await pool.query('SELECT id,departement_id FROM services WHERE id=$1 AND etablissement_id=$2 AND actif', [serviceId, etab])).rows[0] : null;
    if (serviceId && !service) throw new ErreurHttp(400, 'structure_rattachement_invalide');
    const departementExplicite = req.body.departement_id == null ? null : entier(req.body.departement_id, 'departement_id');
    const departementId = departementExplicite || service?.departement_id || null;
    if (departementId && !(await pool.query('SELECT 1 FROM departements WHERE id=$1 AND etablissement_id=$2', [departementId, etab])).rows[0]) throw new ErreurHttp(400, 'structure_rattachement_invalide');
    if (service && departementId && service.departement_id !== departementId) throw new ErreurHttp(400, 'service_autre_departement');
    const u = (await pool.query(`INSERT INTO unites (etablissement_id,type_id,nom,departement_id,service_id,attributs)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`, [etab, req.body.type_id, nom, departementId, serviceId, attributsStructure(req.body.attributs)])).rows[0];
    await journalAdmin(pool, req.utilisateur, 'Unité créée', nom, null, etab);
    return u;
  }));

  api.post('/admin/chambres', route(async (req) => {
    exigerAdmin(req);
    const unite = (await pool.query('SELECT * FROM unites WHERE id = $1', [entier(req.body.unite_id, 'unite_id')])).rows[0];
    if (!unite) throw new ErreurHttp(404, 'unite_introuvable');
    await exigerEtabGerable(req.utilisateur, unite.etablissement_id);
    const numero = String(req.body.numero || '').trim();
    if (!numero) throw new ErreurHttp(400, 'numero_chambre_requis');
    const etageId = req.body.etage_id == null ? null : entier(req.body.etage_id, 'etage_id');
    if (etageId && !(await pool.query('SELECT 1 FROM etages WHERE id=$1 AND unite_id=$2 AND actif', [etageId, unite.id])).rows[0]) throw new ErreurHttp(400, 'structure_rattachement_invalide');
    const capacity = req.body.capacite_declaree == null || req.body.capacite_declaree === '' ? null : Number(req.body.capacite_declaree);
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 100)) throw new ErreurHttp(400, 'structure_capacite_invalide');
    try {
      const ch = (await pool.query(`INSERT INTO chambres (unite_id,numero,etage_id,type_chambre,capacite_declaree,accessible,attributs,restrictions)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) RETURNING *`, [unite.id, numero, etageId,
        String(req.body.type_chambre || '').trim() || null, capacity, !!req.body.accessible,
        attributsStructure(req.body.attributs), attributsStructure(req.body.restrictions)])).rows[0];
      await journalAdmin(pool, req.utilisateur, 'Chambre créée', `${unite.nom} ${numero}`, null, unite.etablissement_id);
      return ch;
    } catch (e) {
      if (e.code === '23505') throw new ErreurHttp(409, 'chambre_existe');
      throw e;
    }
  }));

  api.put('/admin/chambres/:id', route(async (req) => {
    exigerAdmin(req); const id = entier(req.params.id, 'id');
    const ch = (await pool.query(`SELECT ch.*,u.etablissement_id FROM chambres ch JOIN unites u ON u.id=ch.unite_id WHERE ch.id=$1`, [id])).rows[0];
    if (!ch) throw new ErreurHttp(404, 'chambre_introuvable'); await exigerEtabGerable(req.utilisateur, ch.etablissement_id);
    const etageId = req.body.etage_id === undefined ? ch.etage_id : (req.body.etage_id == null ? null : entier(req.body.etage_id, 'etage_id'));
    if (etageId && !(await pool.query('SELECT 1 FROM etages WHERE id=$1 AND unite_id=$2', [etageId, ch.unite_id])).rows[0]) throw new ErreurHttp(400, 'structure_rattachement_invalide');
    const actifsOccupes = (await pool.query(`SELECT 1 FROM lits WHERE chambre_id=$1 AND etat IN ('reserve','occupe') LIMIT 1`, [id])).rows[0];
    const statut = req.body.statut_operationnel ?? ch.statut_operationnel;
    if (!['actif','maintenance','ferme'].includes(statut) || (statut !== 'actif' && (actifsOccupes
      || (await pool.query(`SELECT 1 FROM lits WHERE chambre_id=$1 AND etat<>'indispo' LIMIT 1`,[id])).rows[0]))) throw new ErreurHttp(409, 'structure_chambre_occupee');
    const active=req.body.actif===undefined?ch.actif:!!req.body.actif;
    if(!active&&(statut==='actif'||(await pool.query(`SELECT 1 FROM lits WHERE chambre_id=$1 AND etat<>'indispo' LIMIT 1`,[id])).rows[0])) throw new ErreurHttp(409,'structure_chambre_occupee');
    const capacity = req.body.capacite_declaree === undefined ? ch.capacite_declaree : (req.body.capacite_declaree === '' || req.body.capacite_declaree == null ? null : Number(req.body.capacite_declaree));
    if(capacity!==null&&(!Number.isInteger(capacity)||capacity<1||capacity>100)) throw new ErreurHttp(400,'structure_capacite_invalide');
    if(capacity!==null&&Number((await pool.query('SELECT count(*)::int n FROM lits WHERE chambre_id=$1 AND actif',[id])).rows[0].n)>capacity) throw new ErreurHttp(409,'structure_capacite_depassee');
    const r = (await pool.query(`UPDATE chambres SET etage_id=$2,type_chambre=$3,capacite_declaree=$4,accessible=$5,
      attributs=$6::jsonb,restrictions=$7::jsonb,statut_operationnel=$8,actif=$9 WHERE id=$1 RETURNING *`, [id, etageId,
      req.body.type_chambre === undefined ? ch.type_chambre : String(req.body.type_chambre || '').trim() || null,
      capacity,
      req.body.accessible === undefined ? ch.accessible : !!req.body.accessible,
      attributsStructure(req.body.attributs ?? ch.attributs), attributsStructure(req.body.restrictions ?? ch.restrictions), statut,active])).rows[0];
    await journalAdmin(pool, req.utilisateur, 'Chambre modifiée', ch.numero, `étage=${etageId || 'non précisé'} · état=${statut}`, ch.etablissement_id); return r;
  }));

  const EQUIPEMENTS = ['isolement', 'pression_negative', 'ventilation', 'telemetrie'];
  api.post('/admin/lits', route(async (req) => {
    exigerAdmin(req);
    const ch = (await pool.query('SELECT ch.id, u.etablissement_id FROM chambres ch JOIN unites u ON u.id = ch.unite_id WHERE ch.id = $1',
      [entier(req.body.chambre_id, 'chambre_id')])).rows[0];
    if (!ch) throw new ErreurHttp(404, 'chambre_introuvable');
    await exigerEtabGerable(req.utilisateur, ch.etablissement_id);
    const code = String(req.body.code || '').trim();
    if (!/^[\w.-]{1,30}$/.test(code)) throw new ErreurHttp(400, 'code_lit_invalide');
    return transaction(pool, async (c) => {
      const chambre = (await c.query('SELECT capacite_declaree,actif,statut_operationnel FROM chambres WHERE id=$1 FOR UPDATE',[ch.id])).rows[0];
      if (!chambre || !chambre.actif || chambre.statut_operationnel !== 'actif') throw new ErreurHttp(409,'structure_chambre_occupee');
      const litsActifs=Number((await c.query('SELECT count(*)::int n FROM lits WHERE chambre_id=$1 AND actif',[ch.id])).rows[0].n);
      if(chambre.capacite_declaree!==null&&litsActifs>=chambre.capacite_declaree) throw new ErreurHttp(409,'structure_capacite_depassee');
      const deja = await c.query('SELECT 1 FROM lits WHERE etablissement_id = $1 AND code = $2', [ch.etablissement_id, code]);
      if (deja.rows[0]) throw new ErreurHttp(409, 'code_lit_existe');
      const eq = EQUIPEMENTS.map((k) => !!req.body[k]);
      const l = (await c.query(
        `INSERT INTO lits (chambre_id, unite_id, type_id, etablissement_id, code, isolement, pression_negative, ventilation, telemetrie,categorie,attributs)
         SELECT ch.id, u.id, u.type_id, u.etablissement_id, $2, $3, $4, $5, $6,$7,$8::jsonb FROM chambres ch JOIN unites u ON u.id = ch.unite_id
          WHERE ch.id = $1 RETURNING *`, [ch.id, code, ...eq, String(req.body.categorie || '').trim() || null, attributsStructure(req.body.attributs)])).rows[0];
      await journaliser(c, { litId: l.id, utilisateurId: req.utilisateur.id, action: 'Création', nouveau: 'libre' });
      await journalAdmin(c, req.utilisateur, 'Lit créé', code, null, ch.etablissement_id);
      return l;
    });
  }));

  api.put('/admin/lits/:id/details', route(async (req) => {
    exigerAdmin(req); const id=entier(req.params.id,'id');
    const l=(await pool.query('SELECT * FROM lits WHERE id=$1',[id])).rows[0];
    if(!l) throw new ErreurHttp(404,'lit_introuvable'); await exigerEtabGerable(req.utilisateur,l.etablissement_id);
    const actif=req.body.actif===undefined?l.actif:!!req.body.actif;
    if(!actif && l.etat!=='indispo') throw new ErreurHttp(409,'structure_lit_occupe');
    const r=(await pool.query(`UPDATE lits SET categorie=$2,attributs=$3::jsonb,actif=$4 WHERE id=$1 RETURNING id,code,chambre_id,unite_id,etat,categorie,attributs,actif`,
      [id,req.body.categorie===undefined?l.categorie:(String(req.body.categorie||'').trim()||null),attributsStructure(req.body.attributs??l.attributs),actif])).rows[0];
    await journalAdmin(pool,req.utilisateur,'Lit modifié',l.code,`actif=${actif}`,l.etablissement_id); return r;
  }));

  api.put('/admin/lits/:id/equipement', route(async (req) => {
    exigerAdmin(req);
    const id = entier(req.params.id, 'id');
    const l = (await pool.query('SELECT * FROM lits WHERE id = $1', [id])).rows[0];
    if (!l) throw new ErreurHttp(404, 'lit_introuvable');
    await exigerEtabGerable(req.utilisateur, l.etablissement_id);
    const eq = EQUIPEMENTS.map((k) => (req.body[k] !== undefined ? !!req.body[k] : l[k]));
    return transaction(pool, async (c) => {
      const r = (await c.query(`UPDATE lits SET isolement = $2, pression_negative = $3, ventilation = $4, telemetrie = $5 WHERE id = $1 RETURNING *`,
        [id, ...eq])).rows[0];
      const detail = EQUIPEMENTS.filter((k, i) => eq[i]).join(', ') || 'aucun';
      await journaliser(c, { litId: id, utilisateurId: req.utilisateur.id, action: 'Équipement modifié', detail });
      await journalAdmin(c, req.utilisateur, 'Équipement du lit modifié', l.code, detail, l.etablissement_id);
      return r;
    });
  }));

  /* ---------------------------------------------------------------- nouvel établissement (gestionnaire) */
  api.post('/admin/etablissements', route(async (req) => {
    exigerGestionnaire(req);
    return creerEtablissement(pool, req.body, (c, e) => journalAdmin(c, req.utilisateur, 'Établissement créé', `${e.code} · ${e.nom}`, null, e.id));
  }));

  /* ---------------------------------------------------------------- import CSV (structure et comptes) */
  const imp = require('./import');
  api.get('/admin/import/modeles/:type', async (req, res, next) => {
    try {
      exigerAdmin(req);
      const texte = imp.modele(req.params.type);
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="arrimo-${req.params.type}.csv"` }).send(texte);
    } catch (e) { next(e); }
  });
  api.post('/admin/import/verifier', route(async (req) => {
    exigerAdmin(req);
    const etab = entier(req.body.etablissement_id, 'etablissement_id');
    await exigerEtabGerable(req.utilisateur, etab);
    const v = await imp.verifier(pool, etab, String(req.body.type || ''), String(req.body.contenu || ''));
    return { lignes: v.lignes, erreurs: v.erreurs.slice(0, 500), nb_erreurs: v.erreurs.length, actions: v.actions.slice(0, 500), resume: v.resume, empreinte: v.empreinte };
  }));
  api.post('/admin/import/importer', route(async (req) => {
    exigerAdmin(req);
    const etab = entier(req.body.etablissement_id, 'etablissement_id');
    await exigerEtabGerable(req.utilisateur, etab);
    return imp.importer(pool, req.utilisateur, etab, String(req.body.type || ''), String(req.body.contenu || ''), String(req.body.empreinte || ''), journalAdmin);
  }));

  /* ---------------------------------------------------------------- rayon des alertes « disponibilité à côté » */
  api.put('/admin/etablissements/:id/rayon-alerte', route(async (req) => {
    exigerAdmin(req);
    const etab = entier(req.params.id, 'id');
    await exigerEtabGerable(req.utilisateur, etab);
    const km = Number(req.body.rayon_alerte_km);
    if (!Number.isInteger(km) || km < 1 || km > 200) throw new ErreurHttp(400, 'valeur_invalide', { champ: 'rayon_alerte_km' });
    return transaction(pool, async (c) => {
      const r = (await c.query('UPDATE etablissements SET rayon_alerte_km = $2 WHERE id = $1 RETURNING id, nom, rayon_alerte_km', [etab, km])).rows[0];
      await journalAdmin(c, req.utilisateur, 'Établissement modifié', r.nom, `rayon des alertes ${km} km`, etab);
      return r;
    });
  }));

  /* ---------------------------------------------------------------- civières de l'urgence */
  api.get('/admin/civieres', route(async (req) => {
    exigerAdmin(req);
    const etab = entier(req.query.etablissement_id, 'etablissement_id');
    await exigerEtabGerable(req.utilisateur, etab);
    return (await pool.query('SELECT id, code, categorie, etat, unite_id, attributs, actif FROM civieres WHERE etablissement_id = $1 ORDER BY categorie DESC, code', [etab])).rows;
  }));
  api.post('/admin/civieres', route(async (req) => {
    exigerAdmin(req);
    const etab = entier(req.body.etablissement_id, 'etablissement_id');
    await exigerEtabGerable(req.utilisateur, etab);
    const code = String(req.body.code || '').trim();
    if (!/^[\w.-]{1,30}$/.test(code)) throw new ErreurHttp(400, 'code_civiere_invalide');
    const categorie = req.body.categorie || 'reguliere';
    if (!['reguliere', 'debordement'].includes(categorie)) throw new ErreurHttp(400, 'categorie_invalide');
    const uniteId = req.body.unite_id == null ? null : entier(req.body.unite_id, 'unite_id');
    if (uniteId && !(await pool.query('SELECT 1 FROM unites WHERE id=$1 AND etablissement_id=$2 AND actif', [uniteId, etab])).rows[0]) throw new ErreurHttp(400, 'structure_rattachement_invalide');
    return transaction(pool, async (c) => {
      const deja = await c.query('SELECT 1 FROM civieres WHERE etablissement_id = $1 AND code = $2', [etab, code]);
      if (deja.rows[0]) throw new ErreurHttp(409, 'code_civiere_existe');
      const cv = (await c.query(`INSERT INTO civieres (etablissement_id, code, categorie, unite_id, attributs)
        VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`, [etab, code, categorie, uniteId, attributsStructure(req.body.attributs)])).rows[0];
      await journaliser(c, { civiereId: cv.id, etablissementId: etab, utilisateurId: req.utilisateur.id, action: 'Création', nouveau: 'libre', detail: categorie });
      await journalAdmin(c, req.utilisateur, 'Civière créée', code, categorie, etab);
      return cv;
    });
  }));
  api.put('/admin/civieres/:id/details', route(async (req) => {
    exigerAdmin(req); const id=entier(req.params.id,'id');
    const old=(await pool.query('SELECT * FROM civieres WHERE id=$1',[id])).rows[0];
    if(!old) throw new ErreurHttp(404,'civiere_introuvable'); await exigerEtabGerable(req.utilisateur,old.etablissement_id);
    const uniteId=req.body.unite_id===undefined?old.unite_id:(req.body.unite_id==null?null:entier(req.body.unite_id,'unite_id'));
    if(uniteId&&!(await pool.query('SELECT 1 FROM unites WHERE id=$1 AND etablissement_id=$2',[uniteId,old.etablissement_id])).rows[0]) throw new ErreurHttp(400,'structure_rattachement_invalide');
    const actif=req.body.actif===undefined?old.actif:!!req.body.actif;
    if(!actif&&old.etat!=='indispo') throw new ErreurHttp(409,'structure_civiere_utilisee');
    const r=(await pool.query(`UPDATE civieres SET unite_id=$2,attributs=$3::jsonb,actif=$4 WHERE id=$1 RETURNING id,code,categorie,etat,unite_id,attributs,actif`,
      [id,uniteId,attributsStructure(req.body.attributs??old.attributs),actif])).rows[0];
    await journalAdmin(pool,req.utilisateur,'Civière modifiée',old.code,`actif=${actif}`,old.etablissement_id); return r;
  }));

  /* ---------------------------------------------------------------- configuration pays (gestionnaire) */
  const CHAMPS_CONFIG = ['rayon_km', 'horizon_h', 'nettoyage_cible_min', 'reservation_max_min', 'marge_conge_min', 'hors_service_max_h',
    'confirmation_lit_validite_min',
    'seuil_jaune', 'seuil_orange', 'seuil_rouge', 'attente_admission_max_min', 'cible_nsa_pct', 'vitesse_kmh', 'penalite_orange_km', 'penalite_rouge_km',
    'seuil_civieres_jaune', 'seuil_civieres_orange', 'seuil_civieres_rouge', 'nettoyage_civiere_cible_min'];
  api.get('/admin/config', route(async (req) => {
    exigerAdmin(req);
    return (await pool.query('SELECT * FROM config_pays ORDER BY nom')).rows;
  }));
  api.put('/admin/config/:id', route(async (req) => {
    exigerGestionnaire(req);
    const id = entier(req.params.id, 'id');
    const sets = []; const vals = [id];
    for (const k of CHAMPS_CONFIG) {
      if (req.body[k] === undefined) continue;
      const n = Number(req.body[k]);
      if (!Number.isInteger(n) || n <= 0 || n > 100000) throw new ErreurHttp(400, 'valeur_invalide', { champ: k });
      if (k === 'confirmation_lit_validite_min' && (n < 5 || n > 1440)) throw new ErreurHttp(400, 'valeur_invalide', { champ: k });
      vals.push(n); sets.push(`${k} = $${vals.length}`);
    }
    if (req.body.facteur_route !== undefined) {
      const f = Number(req.body.facteur_route);
      if (!(f >= 1 && f <= 3)) throw new ErreurHttp(400, 'facteur_route');
      vals.push(f); sets.push(`facteur_route = $${vals.length}`);
    }
    for (const champ of ['protocoles', 'protocoles_en']) {
      if (req.body[champ] === undefined) continue;
      const p = req.body[champ];
      if (!p || ['vert', 'jaune', 'orange', 'rouge'].some((k) => typeof p[k] !== 'string')) throw new ErreurHttp(400, 'protocoles_incomplets');
      vals.push(JSON.stringify(p)); sets.push(`${champ} = $${vals.length}::jsonb`);
    }
    if (!sets.length) throw new ErreurHttp(400, 'rien_a_modifier');
    // Tout ou rien : si la vérification échoue, rien n'est enregistré
    return transaction(pool, async (c) => {
      const r = (await c.query(`UPDATE config_pays SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals)).rows[0];
      if (!r) throw new ErreurHttp(404, 'config_introuvable');
      if (!(r.seuil_jaune < r.seuil_orange && r.seuil_orange <= r.seuil_rouge)
        || !(r.seuil_civieres_jaune < r.seuil_civieres_orange && r.seuil_civieres_orange <= r.seuil_civieres_rouge)) {
        throw new ErreurHttp(400, 'seuils_croissants');
      }
      await journalAdmin(c, req.utilisateur, 'Configuration modifiée', r.nom, sets.map((x) => x.split(' =')[0]).join(', '));
      return r;
    });
  }));

  /* ---------------------------------------------------------------- connecteurs */
  api.get('/admin/connecteurs', route(async (req) => {
    exigerAdmin(req);
    const gerables = await etabsGerables(req.utilisateur);
    const { rows } = await pool.query(
      `SELECT c.id, c.nom, c.etablissement_id, e.nom AS etablissement, c.actif, c.cree_le,
              (SELECT max(recu_le) FROM messages_connecteur m WHERE m.connecteur_id = c.id) AS dernier_message,
              (SELECT count(*)::int FROM messages_connecteur m WHERE m.connecteur_id = c.id AND m.statut = 'rejete' AND m.recu_le > now() - interval '1 day') AS rejets_24h
         FROM connecteurs c LEFT JOIN etablissements e ON e.id = c.etablissement_id ORDER BY c.cree_le DESC`);
    return rows.filter((r) => req.utilisateur.gestionnaire || (r.etablissement_id && gerables.includes(r.etablissement_id)));
  }));
  api.post('/admin/connecteurs', route(async (req) => {
    exigerAdmin(req);
    const etab = req.body.etablissement_id ? entier(req.body.etablissement_id, 'etablissement_id') : null;
    if (etab) await exigerEtabGerable(req.utilisateur, etab);
    else if (!req.utilisateur.gestionnaire) throw new ErreurHttp(403, 'connecteur_reseau_gestionnaire');
    const con = await cx.creerConnecteur(pool, req.body.nom, etab);
    await journalAdmin(pool, req.utilisateur, 'Connecteur créé', con.nom, null, etab);
    return con;
  }));
  api.post('/admin/connecteurs/:id/revoquer', route(async (req) => {
    exigerAdmin(req);
    const c = (await pool.query('SELECT * FROM connecteurs WHERE id = $1', [entier(req.params.id, 'id')])).rows[0];
    if (!c) throw new ErreurHttp(404, 'connecteur_introuvable');
    if (c.etablissement_id) await exigerEtabGerable(req.utilisateur, c.etablissement_id);
    else if (!req.utilisateur.gestionnaire) throw new ErreurHttp(403, 'reserve_gestionnaire');
    await pool.query('UPDATE connecteurs SET actif = false WHERE id = $1', [c.id]);
    await journalAdmin(pool, req.utilisateur, 'Connecteur révoqué', c.nom, null, c.etablissement_id);
  }));

  /* ---------------------------------------------------------------- démonstration */
  // Remise à zéro : gestionnaire réseau avec double authentification, serveur de démonstration seulement
  api.post('/admin/demo/reinitialiser', route(async (req) => {
    exigerGestionnaire(req);
    if (!demo.estDemo()) throw new ErreurHttp(403, 'demo_desactivee');
    const par = req.utilisateur.email;
    const operation = async () => {
      await demo.reinitialiser(pool);
      await pool.query(`INSERT INTO journal_admin (action, cible, detail) VALUES ('Démo remise à zéro', 'démonstration', $1)`, [`par ${par}`]);
    };
    if (options.maintenanceDemo) await options.maintenanceDemo(req, operation);
    else await operation();
    console.log(`Démo remise à zéro par ${par}.`);
    return { ok: true };
  }));

  /* ---------------------------------------------------------------- journal d'administration */
  api.get('/admin/journal', route(async (req) => {
    exigerAdmin(req);
    const gerables = await etabsGerables(req.utilisateur);
    const [d, i] = s.curseur(req.query.avant);
    const { rows } = await pool.query(
      `SELECT j.*, ${s.sqlCurseur('j.date', 'j.id')}, u.nom AS utilisateur, e.nom AS etablissement FROM journal_admin j
         LEFT JOIN utilisateurs u ON u.id = j.utilisateur_id LEFT JOIN etablissements e ON e.id = j.etablissement_id
        WHERE ($1 OR j.etablissement_id = ANY($2::int[]) OR j.utilisateur_id = $3) AND ${s.sqlAvant('j.date', 'j.id', '$4', '$5')}
        ORDER BY j.date DESC, j.id DESC LIMIT $6`, [req.utilisateur.gestionnaire, gerables, req.utilisateur.id, d, i, s.taillePage(req.query.limite)]);
    return rows;
  }));

  // Activation et partage : gestionnaire seulement (en production, piloté par SH)
  return { exigerGestionnaire, journalAdmin };
}

module.exports = { brancher, ROLES, verifierRobustesse, journalAdmin, creerEtablissement };
