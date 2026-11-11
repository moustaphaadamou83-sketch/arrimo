'use strict';
/**
 * Profils de pays créés depuis SH (écran « Pays ») : format de référence imposé (préfixe et chiffres, jamais une
 * expression libre), fuseau horaire, langues, réglages opérationnels. Diffusés au serveur choisi par la liaison
 * sécurisée ; un profil ne va que vers un serveur du même pays. Écritures : administration et double authentification.
 * Les types d'établissements du pays se gèrent dans « Types locaux » (sur les modèles hôpital et CHSLD).
 */
const totp = require('../totp');
const { dechiffrerSecret } = require('./security');
const PAYS = require('./donnees-internationales.json').pays;
const LANGUES = ['fr', 'en'];   // langues de l'interface disponibles aujourd'hui

function valider(b, ErreurSh, avant = null) {
  const v = {};
  v.code = String(b.code ?? avant?.code ?? '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9-]{1,11}$/.test(v.code) || /-CHSLD$/.test(v.code) || v.code === 'QC' && !avant) throw new ErreurSh(400, 'Code du profil : 2 à 12 lettres majuscules, chiffres ou tirets (ex. TG).');
  v.pays_code = String(b.pays_code ?? avant?.pays_code ?? '').trim().toUpperCase();
  if (!Object.hasOwn(PAYS, v.pays_code)) throw new ErreurSh(400, 'Pays invalide.');
  v.nom = String(b.nom ?? avant?.nom ?? '').trim(); if (v.nom.length < 2 || v.nom.length > 80) throw new ErreurSh(400, 'Nom du profil : 2 à 80 caractères.');
  v.fuseau = String(b.fuseau ?? avant?.fuseau ?? '').trim();
  try { new Intl.DateTimeFormat('fr', { timeZone: v.fuseau }); } catch { throw new ErreurSh(400, 'Fuseau horaire invalide (ex. Africa/Lome, America/Toronto).'); }
  v.langues = [...new Set(Array.isArray(b.langues) ? b.langues : avant?.langues || [])];
  if (!v.langues.length || v.langues.some((l) => !LANGUES.includes(l))) throw new ErreurSh(400, 'Langues : français et/ou anglais (les autres langues demandent une traduction de l’interface).');
  v.reference_prefixe = String(b.reference_prefixe ?? avant?.reference_prefixe ?? '').trim().toUpperCase();
  if (!/^[A-Z]{1,4}$/.test(v.reference_prefixe)) throw new ErreurSh(400, 'Préfixe de référence : 1 à 4 lettres (ex. P, TG).');
  v.reference_chiffres = Number(b.reference_chiffres ?? avant?.reference_chiffres);
  if (!Number.isInteger(v.reference_chiffres) || v.reference_chiffres < 5 || v.reference_chiffres > 8) throw new ErreurSh(400, 'Référence : 5 à 8 chiffres.');
  const entier = (k, min, max, def) => { const n = Number(b[k] ?? avant?.[k] ?? def); if (!Number.isInteger(n) || n < min || n > max) throw new ErreurSh(400, `${k} : entre ${min} et ${max}.`); return n; };
  v.rayon_km = entier('rayon_km', 5, 2000, 150); v.nettoyage_cible_min = entier('nettoyage_cible_min', 10, 240, 45);
  v.transport_libelle = String(b.transport_libelle ?? avant?.transport_libelle ?? 'Ambulance').trim().slice(0, 60) || 'Ambulance';
  return v;
}

function brancher(api, pool, route, journal, { env = process.env, ErreurSh, appeler, cibles, entier }) {
  async function exiger2fa(req) {
    const u = (await pool.query('SELECT id, totp_secret, totp_actif, totp_dernier_pas FROM sh_utilisateurs WHERE id = $1', [req.u.id])).rows[0];
    if (!u || !u.totp_actif || !u.totp_secret) throw new ErreurSh(403, 'Activez d’abord la double authentification.');
    const pas = totp.verifierCode(dechiffrerSecret(u.totp_secret, env), String(req.body.code_2fa || ''), u.totp_dernier_pas);
    if (!pas) throw new ErreurSh(403, 'Code de double authentification incorrect.');
    await pool.query('UPDATE sh_utilisateurs SET totp_dernier_pas = $2 WHERE id = $1', [u.id, pas]);
  }
  const exemple = (p) => `${p.reference_prefixe}-${'0'.repeat(p.reference_chiffres)}`;
  const presenter = (p, diff = []) => ({ ...p, reference_exemple: exemple(p), diffusions: diff.filter((d) => d.profil_id === p.id) });

  api.get('/profils-pays', route(async () => {
    const diff = (await pool.query('SELECT * FROM sh_profils_pays_diffusions ORDER BY diffuse_le DESC')).rows;
    return (await pool.query('SELECT * FROM sh_profils_pays ORDER BY pays_code, code')).rows.map((p) => presenter(p, diff));
  }));
  api.post('/profils-pays', route(async (req) => {
    await exiger2fa(req);
    const v = valider(req.body || {}, ErreurSh);
    const p = (await pool.query(`INSERT INTO sh_profils_pays (code, pays_code, nom, fuseau, langues, reference_prefixe, reference_chiffres, rayon_km, nettoyage_cible_min, transport_libelle, cree_par)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [v.code, v.pays_code, v.nom, v.fuseau, v.langues, v.reference_prefixe, v.reference_chiffres, v.rayon_km, v.nettoyage_cible_min, v.transport_libelle, req.u.id])
      .catch((e) => { if (e.code === '23505') throw new ErreurSh(409, 'Un profil porte déjà ce code.'); throw e; })).rows[0];
    await journal(pool, req.u, 'Profil de pays créé', v.code, `${v.nom} · ${v.pays_code} · référence ${exemple(v)} · ${v.fuseau}`);
    return presenter(p);
  }));
  api.put('/profils-pays/:id', route(async (req) => {
    await exiger2fa(req);
    const avant = (await pool.query('SELECT * FROM sh_profils_pays WHERE id = $1', [entier(req.params.id, 'id')])).rows[0];
    if (!avant) throw new ErreurSh(404, 'Profil introuvable.');
    const v = valider({ ...req.body, code: avant.code }, ErreurSh, avant);
    if (v.pays_code !== avant.pays_code) throw new ErreurSh(409, 'Le pays d’un profil ne change pas : créez un autre profil.');
    const diffuse = (await pool.query('SELECT 1 FROM sh_profils_pays_diffusions WHERE profil_id = $1 LIMIT 1', [avant.id])).rowCount;
    if (diffuse && (v.reference_prefixe !== avant.reference_prefixe || v.reference_chiffres !== avant.reference_chiffres)) throw new ErreurSh(409, 'Le format de référence est déjà diffusé : il ne peut plus changer.');
    const p = (await pool.query(`UPDATE sh_profils_pays SET nom=$2, fuseau=$3, langues=$4, reference_prefixe=$5, reference_chiffres=$6, rayon_km=$7, nettoyage_cible_min=$8, transport_libelle=$9,
      version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`, [avant.id, v.nom, v.fuseau, v.langues, v.reference_prefixe, v.reference_chiffres, v.rayon_km, v.nettoyage_cible_min, v.transport_libelle])).rows[0];
    await journal(pool, req.u, 'Profil de pays modifié', p.code, `version ${p.version}`);
    return presenter(p);
  }));
  api.post('/profils-pays/:id/diffuser', route(async (req) => {
    await exiger2fa(req);
    const p = (await pool.query('SELECT * FROM sh_profils_pays WHERE id = $1', [entier(req.params.id, 'id')])).rows[0];
    if (!p) throw new ErreurSh(404, 'Profil introuvable.');
    const code = String(req.body.environnement || '');
    const c = cibles().find((x) => x.code === code);
    if (!c) throw new ErreurSh(400, 'Serveur inconnu ou non relié.');
    // Un profil ne va que vers un serveur du même pays (registre) ; les serveurs de la configuration de base sont canadiens
    const paysServeur = c.pays_code || (/^production_([a-z]{2})/.exec(code)?.[1] || 'ca').toUpperCase();
    if (paysServeur !== p.pays_code) throw new ErreurSh(409, `Ce serveur est rattaché à un autre pays (${paysServeur}).`);
    const r = await appeler(c, 'PUT', '/sh/profils-pays', { code: p.code, nom: p.nom, pays_code: p.pays_code, fuseau: p.fuseau, langues: p.langues, reference_prefixe: p.reference_prefixe,
      reference_chiffres: p.reference_chiffres, rayon_km: p.rayon_km, nettoyage_cible_min: p.nettoyage_cible_min, transport_libelle: p.transport_libelle, version: p.version, par: req.u.email });
    await pool.query(`INSERT INTO sh_profils_pays_diffusions (profil_id, environnement, version, par) VALUES ($1,$2,$3,$4)
      ON CONFLICT (profil_id, environnement) DO UPDATE SET version = EXCLUDED.version, diffuse_le = now(), par = EXCLUDED.par`, [p.id, code, p.version, req.u.id]);
    await journal(pool, req.u, r.cree ? 'Profil de pays diffusé (créé)' : 'Profil de pays diffusé (mis à jour)', p.code, `serveur ${code} · version ${p.version}`);
    return { ...r, environnement: code };
  }));
}
module.exports = { brancher, valider, LANGUES };
