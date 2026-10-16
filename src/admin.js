/**
 * Mon compte (mot de passe, double authentification) et administration :
 * utilisateurs, structure (unités, chambres, lits), configuration pays, connecteurs, journal d'administration.
 *
 * Rôles : gestionnaire (tout le réseau) et admin_etab (ses établissements seulement).
 * Toute action d'administration exige la double authentification activée (ARRIMO_2FA_ADMIN=0 pour désactiver en test).
 */
const QRCode = require('qrcode');
const { transaction, ErreurHttp } = require('./db');
const { hacher, changerMotDePasse, verifierRobustesse, motDePasseTemporaire } = require('./auth');
const totp = require('./totp');
const { journaliser } = require('./regles');
const cx = require('./connecteurs');

const ROLES = ['coordonnateur', 'entretien', 'admin_etab', 'gestionnaire'];

async function journalAdmin(db, u, action, cible, detail, etablissementId = null) {
  await db.query(`INSERT INTO journal_admin (utilisateur_id, etablissement_id, action, cible, detail) VALUES ($1, $2, $3, $4, $5)`,
    [u.id, etablissementId, action, cible, detail]);
}

function brancher(api, pool, route, entier) {
  /* ---------------------------------------------------------------- mon compte */
  api.put('/moi/mot-de-passe', route(async (req) => {
    await changerMotDePasse(pool, req.utilisateur, req.body.actuel, req.body.nouveau);
    await journalAdmin(pool, req.utilisateur, 'Mot de passe changé', req.utilisateur.email, null);
  }));

  api.post('/moi/2fa/preparer', route(async (req) => {
    if (req.utilisateur.totp_actif) throw new ErreurHttp(409, 'La double authentification est déjà active.');
    const secret = totp.nouveauSecret();
    await pool.query('UPDATE utilisateurs SET totp_secret = $2, totp_dernier_pas = 0 WHERE id = $1', [req.utilisateur.id, secret]);
    const lien = totp.uri(secret, req.utilisateur.email);
    return { secret, uri: lien, qr_svg: await QRCode.toString(lien, { type: 'svg', margin: 1, width: 200 }) };
  }));

  api.post('/moi/2fa/activer', route(async (req) => {
    const u = (await pool.query('SELECT totp_secret, totp_actif FROM utilisateurs WHERE id = $1', [req.utilisateur.id])).rows[0];
    if (u.totp_actif) throw new ErreurHttp(409, 'La double authentification est déjà active.');
    if (!u.totp_secret) throw new ErreurHttp(400, 'Commencez par afficher le code QR.');
    const pas = totp.verifierCode(u.totp_secret, req.body.code, 0);
    if (!pas) throw new ErreurHttp(400, 'Code incorrect. Vérifiez l’heure de votre téléphone et réessayez.');
    await pool.query('UPDATE utilisateurs SET totp_actif = true, totp_dernier_pas = $2 WHERE id = $1', [req.utilisateur.id, pas]);
    await journalAdmin(pool, req.utilisateur, 'Double authentification activée', req.utilisateur.email, null);
  }));

  api.post('/moi/2fa/desactiver', route(async (req) => {
    const u = (await pool.query('SELECT totp_secret, totp_actif, totp_dernier_pas FROM utilisateurs WHERE id = $1', [req.utilisateur.id])).rows[0];
    if (!u.totp_actif) throw new ErreurHttp(409, 'La double authentification n’est pas active.');
    if (!totp.verifierCode(u.totp_secret, req.body.code, u.totp_dernier_pas)) throw new ErreurHttp(400, 'Code incorrect.');
    await pool.query('UPDATE utilisateurs SET totp_actif = false, totp_secret = NULL WHERE id = $1', [req.utilisateur.id]);
    await journalAdmin(pool, req.utilisateur, 'Double authentification désactivée', req.utilisateur.email, null);
  }));

  /* ---------------------------------------------------------------- garde d'administration */
  const exigerAdmin = (req) => {
    const u = req.utilisateur;
    if (!u.admin) throw new ErreurHttp(403, 'Réservé aux administrateurs.');
    if (process.env.ARRIMO_2FA_ADMIN !== '0' && !u.totp_actif) {
      throw new ErreurHttp(403, 'Activez la double authentification (Mon compte) pour accéder à l’administration.');
    }
  };
  const exigerGestionnaire = (req) => {
    exigerAdmin(req);
    if (!req.utilisateur.gestionnaire) throw new ErreurHttp(403, 'Réservé au gestionnaire réseau.');
  };
  const etabsGerables = async (u) => (u.gestionnaire
    ? (await pool.query('SELECT id FROM etablissements')).rows.map((r) => r.id)
    : u.etabs);
  const exigerEtabGerable = async (u, etabId) => {
    if (!(await etabsGerables(u)).includes(Number(etabId))) throw new ErreurHttp(403, "Vous n'administrez pas cet établissement.");
  };

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
    if (!ROLES.includes(role)) throw new ErreurHttp(400, 'Rôle inconnu.');
    if (role === 'gestionnaire' && !u.gestionnaire) throw new ErreurHttp(403, 'Seul le gestionnaire réseau peut créer ce rôle.');
    const etabs = (b.etablissements ?? existant?.etablissements ?? []).map(Number);
    if (role !== 'gestionnaire' && !etabs.length) throw new ErreurHttp(400, 'Rattachez le compte à au moins un établissement.');
    const gerables = await etabsGerables(u);
    if (etabs.some((e) => !gerables.includes(e))) throw new ErreurHttp(403, "Vous n'administrez pas tous ces établissements.");
    if (existant && !u.gestionnaire && (existant.role === 'gestionnaire' || existant.etablissements.some((e) => !gerables.includes(e)))) {
      throw new ErreurHttp(403, "Ce compte dépend d'un autre administrateur.");
    }
    return { role, etabs };
  }
  async function lireCompte(id) {
    const r = await pool.query(
      `SELECT u.*, COALESCE(array_agg(ue.etablissement_id) FILTER (WHERE ue.etablissement_id IS NOT NULL), '{}') AS etablissements
         FROM utilisateurs u LEFT JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id WHERE u.id = $1 GROUP BY u.id`, [id]);
    if (!r.rows[0]) throw new ErreurHttp(404, 'Compte introuvable.');
    return r.rows[0];
  }

  api.post('/admin/utilisateurs', route(async (req) => {
    exigerAdmin(req);
    const email = String(req.body.email || '').trim().toLowerCase();
    const nom = String(req.body.nom || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErreurHttp(400, 'Adresse courriel invalide.');
    if (!nom) throw new ErreurHttp(400, 'Nom requis.');
    const { role, etabs } = await verifierCompte(req, req.body);
    const temporaire = motDePasseTemporaire();
    return transaction(pool, async (c) => {
      const deja = await c.query('SELECT 1 FROM utilisateurs WHERE email = $1', [email]);
      if (deja.rows[0]) throw new ErreurHttp(409, 'Un compte existe déjà avec cette adresse.');
      const u = (await c.query(
        `INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role, mdp_temporaire) VALUES ($1, $2, $3, $4, true) RETURNING id, email, nom, role`,
        [email, nom, hacher(temporaire), role])).rows[0];
      for (const e of etabs) await c.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u.id, e]);
      await journalAdmin(c, req.utilisateur, 'Compte créé', email, `Rôle ${role}`, etabs[0] || null);
      return { ...u, etablissements: etabs, mot_de_passe_temporaire: temporaire };
    });
  }));

  api.put('/admin/utilisateurs/:id', route(async (req) => {
    exigerAdmin(req);
    const id = entier(req.params.id, 'id');
    const existant = await lireCompte(id);
    if (id === req.utilisateur.id && req.body.actif === false) throw new ErreurHttp(400, 'Vous ne pouvez pas désactiver votre propre compte.');
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
              totp_secret = CASE WHEN $3 THEN NULL ELSE totp_secret END WHERE id = $1`, [id, hacher(temporaire), !!req.body.reinitialiser_2fa]);
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
      `SELECT u.id, u.nom, t.nom AS type_nom, t.id AS type_id FROM unites u JOIN types_unite t ON t.id = u.type_id
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
    if (!nom) throw new ErreurHttp(400, 'Nom de l’unité requis.');
    const ok = await pool.query(`SELECT 1 FROM types_unite t JOIN etablissements e ON e.config_id = t.config_id WHERE t.id = $1 AND e.id = $2`,
      [req.body.type_id, etab]);
    if (!ok.rows[0]) throw new ErreurHttp(400, "Type d'unité inconnu pour ce pays.");
    const u = (await pool.query('INSERT INTO unites (etablissement_id, type_id, nom) VALUES ($1, $2, $3) RETURNING *', [etab, req.body.type_id, nom])).rows[0];
    await journalAdmin(pool, req.utilisateur, 'Unité créée', nom, null, etab);
    return u;
  }));

  api.post('/admin/chambres', route(async (req) => {
    exigerAdmin(req);
    const unite = (await pool.query('SELECT * FROM unites WHERE id = $1', [entier(req.body.unite_id, 'unite_id')])).rows[0];
    if (!unite) throw new ErreurHttp(404, 'Unité introuvable.');
    await exigerEtabGerable(req.utilisateur, unite.etablissement_id);
    const numero = String(req.body.numero || '').trim();
    if (!numero) throw new ErreurHttp(400, 'Numéro de chambre requis.');
    try {
      const ch = (await pool.query('INSERT INTO chambres (unite_id, numero) VALUES ($1, $2) RETURNING *', [unite.id, numero])).rows[0];
      await journalAdmin(pool, req.utilisateur, 'Chambre créée', `${unite.nom} ${numero}`, null, unite.etablissement_id);
      return ch;
    } catch (e) {
      if (e.code === '23505') throw new ErreurHttp(409, 'Cette chambre existe déjà dans l’unité.');
      throw e;
    }
  }));

  const EQUIPEMENTS = ['isolement', 'pression_negative', 'ventilation', 'telemetrie'];
  api.post('/admin/lits', route(async (req) => {
    exigerAdmin(req);
    const ch = (await pool.query('SELECT ch.id, u.etablissement_id FROM chambres ch JOIN unites u ON u.id = ch.unite_id WHERE ch.id = $1',
      [entier(req.body.chambre_id, 'chambre_id')])).rows[0];
    if (!ch) throw new ErreurHttp(404, 'Chambre introuvable.');
    await exigerEtabGerable(req.utilisateur, ch.etablissement_id);
    const code = String(req.body.code || '').trim();
    if (!/^[\w.-]{1,30}$/.test(code)) throw new ErreurHttp(400, 'Code de lit invalide (lettres, chiffres, tirets).');
    return transaction(pool, async (c) => {
      const deja = await c.query('SELECT 1 FROM lits WHERE etablissement_id = $1 AND code = $2', [ch.etablissement_id, code]);
      if (deja.rows[0]) throw new ErreurHttp(409, 'Ce code de lit existe déjà dans l’établissement.');
      const eq = EQUIPEMENTS.map((k) => !!req.body[k]);
      const l = (await c.query(
        `INSERT INTO lits (chambre_id, unite_id, type_id, etablissement_id, code, isolement, pression_negative, ventilation, telemetrie)
         SELECT ch.id, u.id, u.type_id, u.etablissement_id, $2, $3, $4, $5, $6 FROM chambres ch JOIN unites u ON u.id = ch.unite_id
          WHERE ch.id = $1 RETURNING *`, [ch.id, code, ...eq])).rows[0];
      await journaliser(c, { litId: l.id, utilisateurId: req.utilisateur.id, action: 'Création', nouveau: 'libre' });
      await journalAdmin(c, req.utilisateur, 'Lit créé', code, null, ch.etablissement_id);
      return l;
    });
  }));

  api.put('/admin/lits/:id/equipement', route(async (req) => {
    exigerAdmin(req);
    const id = entier(req.params.id, 'id');
    const l = (await pool.query('SELECT * FROM lits WHERE id = $1', [id])).rows[0];
    if (!l) throw new ErreurHttp(404, 'Lit introuvable.');
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

  /* ---------------------------------------------------------------- configuration pays (gestionnaire) */
  const CHAMPS_CONFIG = ['rayon_km', 'horizon_h', 'nettoyage_cible_min', 'reservation_max_min', 'marge_conge_min', 'hors_service_max_h',
    'seuil_jaune', 'seuil_orange', 'seuil_rouge', 'attente_admission_max_min', 'cible_nsa_pct', 'vitesse_kmh', 'penalite_orange_km', 'penalite_rouge_km'];
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
      if (!Number.isInteger(n) || n <= 0 || n > 100000) throw new ErreurHttp(400, `Valeur invalide pour ${k}.`);
      vals.push(n); sets.push(`${k} = $${vals.length}`);
    }
    if (req.body.facteur_route !== undefined) {
      const f = Number(req.body.facteur_route);
      if (!(f >= 1 && f <= 3)) throw new ErreurHttp(400, 'Le facteur de route doit être entre 1 et 3.');
      vals.push(f); sets.push(`facteur_route = $${vals.length}`);
    }
    if (req.body.protocoles !== undefined) {
      const p = req.body.protocoles;
      if (!p || ['vert', 'jaune', 'orange', 'rouge'].some((k) => typeof p[k] !== 'string')) throw new ErreurHttp(400, 'Protocoles incomplets.');
      vals.push(JSON.stringify(p)); sets.push(`protocoles = $${vals.length}::jsonb`);
    }
    if (!sets.length) throw new ErreurHttp(400, 'Rien à modifier.');
    // Tout ou rien : si la vérification échoue, rien n'est enregistré
    return transaction(pool, async (c) => {
      const r = (await c.query(`UPDATE config_pays SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals)).rows[0];
      if (!r) throw new ErreurHttp(404, 'Configuration introuvable.');
      if (!(r.seuil_jaune < r.seuil_orange && r.seuil_orange <= r.seuil_rouge)) {
        throw new ErreurHttp(400, 'Les seuils doivent être croissants : jaune < orange ≤ rouge.');
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
    else if (!req.utilisateur.gestionnaire) throw new ErreurHttp(403, 'Seul le gestionnaire réseau crée un connecteur réseau.');
    const con = await cx.creerConnecteur(pool, req.body.nom, etab);
    await journalAdmin(pool, req.utilisateur, 'Connecteur créé', con.nom, null, etab);
    return con;
  }));
  api.post('/admin/connecteurs/:id/revoquer', route(async (req) => {
    exigerAdmin(req);
    const c = (await pool.query('SELECT * FROM connecteurs WHERE id = $1', [entier(req.params.id, 'id')])).rows[0];
    if (!c) throw new ErreurHttp(404, 'Connecteur introuvable.');
    if (c.etablissement_id) await exigerEtabGerable(req.utilisateur, c.etablissement_id);
    else if (!req.utilisateur.gestionnaire) throw new ErreurHttp(403, 'Réservé au gestionnaire réseau.');
    await pool.query('UPDATE connecteurs SET actif = false WHERE id = $1', [c.id]);
    await journalAdmin(pool, req.utilisateur, 'Connecteur révoqué', c.nom, null, c.etablissement_id);
  }));

  /* ---------------------------------------------------------------- journal d'administration */
  api.get('/admin/journal', route(async (req) => {
    exigerAdmin(req);
    const gerables = await etabsGerables(req.utilisateur);
    const { rows } = await pool.query(
      `SELECT j.*, u.nom AS utilisateur, e.nom AS etablissement FROM journal_admin j
         LEFT JOIN utilisateurs u ON u.id = j.utilisateur_id LEFT JOIN etablissements e ON e.id = j.etablissement_id
        WHERE $1 OR j.etablissement_id = ANY($2::int[]) OR j.utilisateur_id = $3
        ORDER BY j.date DESC LIMIT 300`, [req.utilisateur.gestionnaire, gerables, req.utilisateur.id]);
    return rows;
  }));

  // Activation et partage : gestionnaire seulement (en production, piloté par SH)
  return { exigerGestionnaire, journalAdmin };
}

module.exports = { brancher, ROLES, verifierRobustesse };
