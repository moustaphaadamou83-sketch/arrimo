'use strict';
/**
 * Administration du préhospitalier (cahier 2, section 12.2) : organisations de secours (entreprises ambulancières, CCS),
 * unités, comptes (paramédic, superviseur, répartiteur) et systèmes reliés par Arrimo Connect.
 * Réservée au gestionnaire réseau, avec double authentification hors démo (même garde que l'administration),
 * journalisée dans le journal d'administration immuable. Mot de passe temporaire à changer à la première connexion ;
 * clé et secret Connect montrés une seule fois.
 */
const { transaction, ErreurHttp } = require('./db');
const { hacherAsync, motDePasseTemporaire } = require('./auth');
const env = require('./environnement');
const { journalAdmin } = require('./admin');

// Un seul modèle d'organisation : le type dit ce qu'elle est, les profils activés ce qu'elle fait ; les rôles suivent les profils
const TYPES = ['ccs', 'ambulancier', 'urgences_sante', 'premiers_repondants'];
const PROFILS_PAR_DEFAUT = { ccs: ['ccs'], ambulancier: ['ambulance'], urgences_sante: ['ccs', 'ambulance'], premiers_repondants: [] };
const ROLES_PROFIL = { ambulance: ['paramedic', 'superviseur_secours'], ccs: ['repartiteur'] };
const rolesDe = (profils) => profils.flatMap((p) => ROLES_PROFIL[p] || []);
const lireProfils = (v, type) => {
  if (v == null) return PROFILS_PAR_DEFAUT[type];
  if (!Array.isArray(v) || v.some((x) => !ROLES_PROFIL[x])) throw new ErreurHttp(400, 'organisation_invalide');
  return [...new Set(v)];
};
function exiger(req) {
  const u = req.utilisateur;
  if (!u.gestionnaire) throw new ErreurHttp(403, 'reserve_admin');
  if (env.exige2faAdmin() && !u.totp_actif) throw new ErreurHttp(403, 'admin_exige_2fa');
}
const texte = (v, max) => String(v ?? '').trim().slice(0, max);

function brancher(api, pool, route, entier) {
  api.get('/admin/secours', route(async (req) => {
    exiger(req);
    const [orgs, unites, comptes, systemes, configs] = await Promise.all([
      pool.query('SELECT o.id, o.code, o.nom, o.type, o.profils, o.config_id, o.actif, c.nom AS profil FROM organisations_secours o JOIN config_pays c ON c.id = o.config_id ORDER BY o.type, o.nom'),
      pool.query('SELECT id, organisation_id, numero, plaque, actif FROM unites_secours ORDER BY numero'),
      pool.query(`SELECT u.id, u.nom, u.email, u.role, u.actif, uo.organisation_id FROM utilisateurs u JOIN utilisateur_organisations uo ON uo.utilisateur_id = u.id ORDER BY u.nom`),
      pool.query('SELECT id, organisation_id, nom, actif, cree_le, derniere_utilisation FROM connecteurs_secours ORDER BY cree_le'),
      pool.query("SELECT id, code, nom FROM config_pays WHERE code NOT LIKE '%-CHSLD' ORDER BY id"),
    ]);
    return { organisations: orgs.rows.map((o) => ({ ...o, unites: unites.rows.filter((x) => x.organisation_id === o.id), comptes: comptes.rows.filter((x) => x.organisation_id === o.id),
      systemes: systemes.rows.filter((x) => x.organisation_id === o.id), roles: rolesDe(o.profils) })), profils: configs.rows, types: TYPES, profils_par_defaut: PROFILS_PAR_DEFAUT };
  }));
  // Supervision (cahier 2, section 12.3) : ce qui attend une réception ou une réponse ; numéros et délais seulement, aucune donnée médicale
  api.get('/admin/secours/supervision', route(async (req) => {
    exiger(req);
    const q = async (sql) => (await pool.query(sql)).rows;
    const [nonRecues, nonPrises, transports, systemes, positions] = await Promise.all([
      q(`SELECT p.numero, e.nom AS destination, round(EXTRACT(EPOCH FROM now() - p.cree_le) / 60)::int AS minutes FROM prealertes p JOIN etablissements e ON e.id = p.destination_id
         WHERE p.statut = 'envoyee' AND p.recue_le IS NULL AND p.cree_le < now() - interval '2 minutes' ORDER BY p.cree_le`),
      q(`SELECT p.numero, p.priorite, e.nom AS destination, round(EXTRACT(EPOCH FROM now() - p.cree_le) / 60)::int AS minutes FROM prealertes p JOIN etablissements e ON e.id = p.destination_id
         WHERE p.statut IN ('recue', 'consultee') AND p.prise_en_compte_le IS NULL AND p.cree_le < now() - interval '5 minutes' ORDER BY p.cree_le`),
      q(`SELECT d.numero, o.nom AS organisation, round(EXTRACT(EPOCH FROM now() - d.cree_le) / 60)::int AS minutes FROM demandes_transport d JOIN organisations_secours o ON o.id = d.organisation_id
         WHERE d.statut = 'demandee' AND d.cree_le < now() - interval '15 minutes' ORDER BY d.cree_le`),
      q(`SELECT cs.nom, o.nom AS organisation, cs.derniere_utilisation FROM connecteurs_secours cs JOIN organisations_secours o ON o.id = cs.organisation_id
         WHERE cs.actif AND (cs.derniere_utilisation IS NULL OR cs.derniere_utilisation < now() - interval '24 hours') ORDER BY cs.nom`),
      q(`SELECT p.numero, un.numero AS unite, round(EXTRACT(EPOCH FROM now() - max(pu.enregistree_le)) / 60)::int AS minutes FROM prealertes p JOIN unites_secours un ON un.id = p.unite_id
         JOIN positions_unites pu ON pu.unite_id = p.unite_id WHERE p.statut IN ('envoyee', 'recue', 'consultee', 'prise_en_compte', 'preparation', 'preparation_terminee')
         GROUP BY p.numero, un.numero HAVING max(pu.enregistree_le) < now() - interval '10 minutes'`),
    ]);
    return { non_recues: nonRecues, non_prises_en_compte: nonPrises, transports_sans_reponse: transports, systemes_silencieux: systemes, positions_anciennes: positions, heure: new Date().toISOString() };
  }));
  api.post('/admin/secours/organisations', route(async (req) => {
    exiger(req);
    const code = texte(req.body.code, 20).toUpperCase(); const nom = texte(req.body.nom, 120); const type = String(req.body.type || '');
    if (!/^[A-Z0-9-]{2,20}$/.test(code) || !nom || !TYPES.includes(type)) throw new ErreurHttp(400, 'organisation_invalide');
    const profils = lireProfils(req.body.profils, type);
    const cfg = (await pool.query("SELECT id FROM config_pays WHERE id = $1 AND code NOT LIKE '%-CHSLD'", [entier(req.body.config_id, 'config_id')])).rows[0];
    if (!cfg) throw new ErreurHttp(404, 'config_introuvable');
    return transaction(pool, async (c) => {
      if ((await c.query('SELECT 1 FROM organisations_secours WHERE code = $1', [code])).rowCount) throw new ErreurHttp(409, 'organisation_existe');
      const o = (await c.query('INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ($1, $2, $3, $4, $5) RETURNING *', [code, nom, type, profils, cfg.id])).rows[0];
      await journalAdmin(c, req.utilisateur, 'Organisation de secours créée', code, `${type} · ${profils.join('+') || 'aucun profil'} · ${nom}`);
      return o;
    });
  }));
  api.put('/admin/secours/organisations/:id', route(async (req) => {
    exiger(req); const id = entier(req.params.id, 'id');
    const avant = (await pool.query('SELECT * FROM organisations_secours WHERE id = $1', [id])).rows[0];
    if (!avant) throw new ErreurHttp(404, 'organisation_introuvable');
    if (req.body.profils !== undefined) {
      // Profils activés un par un ; un profil retiré coupe aussitôt les droits correspondants (écran et API)
      const profils = lireProfils(req.body.profils, avant.type);
      const o = (await pool.query('UPDATE organisations_secours SET profils = $2 WHERE id = $1 RETURNING *', [id, profils])).rows[0];
      await journalAdmin(pool, req.utilisateur, 'Profils de l’organisation modifiés', o.code, profils.join('+') || 'aucun');
      return o;
    }
    const actif = req.body.actif === true;
    const o = (await pool.query('UPDATE organisations_secours SET actif = $2 WHERE id = $1 RETURNING *', [id, actif])).rows[0];
    await journalAdmin(pool, req.utilisateur, actif ? 'Organisation de secours activée' : 'Organisation de secours désactivée', o.code, null);
    return o;
  }));
  api.post('/admin/secours/organisations/:id/unites', route(async (req) => {
    exiger(req); const id = entier(req.params.id, 'id');
    const o = (await pool.query("SELECT * FROM organisations_secours WHERE id = $1 AND 'ambulance' = ANY(profils)", [id])).rows[0];
    if (!o) throw new ErreurHttp(404, 'organisation_introuvable');
    const numero = texte(req.body.numero, 20); const plaque = texte(req.body.plaque, 20) || null;
    if (!/^[A-Za-z0-9 -]{1,20}$/.test(numero)) throw new ErreurHttp(400, 'unite_invalide');
    try {
      const un = (await pool.query('INSERT INTO unites_secours (organisation_id, numero, plaque) VALUES ($1, $2, $3) RETURNING *', [o.id, numero, plaque])).rows[0];
      await journalAdmin(pool, req.utilisateur, 'Unité de secours créée', `${o.code} · ${numero}`, plaque);
      return un;
    } catch (e) { if (e.code === '23505') throw new ErreurHttp(409, 'unite_existe'); throw e; }
  }));
  api.put('/admin/secours/unites/:id', route(async (req) => {
    exiger(req); const id = entier(req.params.id, 'id');
    const un = (await pool.query('UPDATE unites_secours SET actif = $2, plaque = COALESCE($3, plaque) WHERE id = $1 RETURNING *', [id, req.body.actif !== false, req.body.plaque == null ? null : texte(req.body.plaque, 20)])).rows[0];
    if (!un) throw new ErreurHttp(404, 'unite_introuvable');
    await journalAdmin(pool, req.utilisateur, un.actif ? 'Unité de secours modifiée' : 'Unité de secours désactivée', un.numero, null);
    return un;
  }));
  api.post('/admin/secours/organisations/:id/comptes', route(async (req) => {
    exiger(req); const id = entier(req.params.id, 'id');
    const o = (await pool.query('SELECT * FROM organisations_secours WHERE id = $1', [id])).rows[0];
    if (!o) throw new ErreurHttp(404, 'organisation_introuvable');
    const email = texte(req.body.email, 200).toLowerCase(); const nom = texte(req.body.nom, 120); const role = String(req.body.role || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErreurHttp(400, 'courriel_invalide');
    if (!nom) throw new ErreurHttp(400, 'nom_requis');
    if (!rolesDe(o.profils).includes(role)) throw new ErreurHttp(400, 'role_inconnu');
    const temporaire = motDePasseTemporaire();
    return transaction(pool, async (c) => {
      if ((await c.query('SELECT 1 FROM utilisateurs WHERE email = $1', [email])).rowCount) throw new ErreurHttp(409, 'compte_existe');
      const u = (await c.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role, mdp_temporaire) VALUES ($1, $2, $3, $4, true) RETURNING id, email, nom, role',
        [email, nom, await hacherAsync(temporaire), role])).rows[0];
      await c.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u.id, o.id]);
      await journalAdmin(c, req.utilisateur, 'Compte de secours créé', email, `${role} · ${o.code}`);
      return { ...u, organisation_id: o.id, mot_de_passe_temporaire: temporaire };
    });
  }));
  api.post('/admin/secours/organisations/:id/systemes', route(async (req) => {
    exiger(req); const id = entier(req.params.id, 'id');
    const o = (await pool.query('SELECT * FROM organisations_secours WHERE id = $1 AND actif', [id])).rows[0];
    if (!o) throw new ErreurHttp(404, 'organisation_introuvable');
    // Clé et secret générés sur le serveur, jamais affichés : remise unique au contact technique (lien de 24 h)
    const destinataire = require('./remises').exigerCourriel(req.body.courriel_technique);
    const s = await require('./connect').creerConnecteurSecours(pool, o.id, texte(req.body.nom, 100) || 'Système partenaire');
    const remise = await require('./remises').creer(pool, { genre: 'connect', refId: s.id, contenu: { cle: s.cle, secret: s.secret }, destinataire, utilisateurId: req.utilisateur.id, nom: s.nom });
    await journalAdmin(pool, req.utilisateur, 'Système relié (Arrimo Connect)', o.code, `${s.nom} · remise à ${remise.destinataire}`);
    return { id: s.id, nom: s.nom, organisation_id: s.organisation_id, remise };
  }));
  api.put('/admin/secours/systemes/:id', route(async (req) => {
    exiger(req); const id = entier(req.params.id, 'id');
    const s = (await pool.query('UPDATE connecteurs_secours SET actif = false WHERE id = $1 RETURNING id, nom, organisation_id', [id])).rows[0];
    if (!s) throw new ErreurHttp(404, 'connecteur_introuvable');
    await journalAdmin(pool, req.utilisateur, 'Système révoqué (Arrimo Connect)', s.nom, null);
    return { ...s, actif: false };
  }));
}
module.exports = { brancher };
