'use strict';
/**
 * Chrono (19 nov. 2026) : entrée et sortie de zone (bruit GPS, position isolée), ordre des étapes, correction immuable, écarts,
 * rapport avec étapes manquantes, CSV, cloisonnement entreprise / hôpital, module non activé refusé, démarquage
 * (même heure côté urgence, ambulance et CCS), ambulance sans préalerte. Données fictives seulement.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');

let pool; let serveur; let base; const tokens = {}; const ids = {};
async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${tokens[qui]}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined });
  const texte = await r.text(); let corpsJ = null; try { corpsJ = JSON.parse(texte); } catch { corpsJ = texte; }
  return { statut: r.status, corps: corpsJ, type: r.headers.get('content-type') };
}
async function compte(email, role, orgId) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [email, email, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (orgId) await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, orgId]);
}
async function connecter(q, email) {
  const r = await appel(null, 'POST', '/connexion', { email, mot_de_passe: MOT_DE_PASSE_DEMO });
  assert.strictEqual(r.statut, 200, `connexion ${q}`); tokens[q] = r.corps.token;
}
const il_y_a = (min) => new Date(Date.now() - min * 60000).toISOString();
const position = (qui, unite, pos, min, extra = {}) => appel(qui, 'POST', `/secours/unites/${unite}/position`, { latitude: pos.latitude, longitude: pos.longitude, precision_m: 10, horodatage: il_y_a(min), ...extra });
const passageDe = async (unite) => (await pool.query('SELECT * FROM passages_chrono WHERE unite_id = $1 ORDER BY id DESC LIMIT 1', [unite])).rows[0];

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL);
  await viderBase(pool);
  await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool));
  base = `http://127.0.0.1:${serveur.address().port}`;
  const e = (await pool.query("SELECT id, latitude, longitude, config_id FROM etablissements WHERE code IN ('MB', 'SL') ORDER BY code")).rows;
  [ids.mb, ids.sl] = e.map((x) => x.id); ids.posMb = { latitude: e[0].latitude, longitude: e[0].longitude };
  ids.dehors = { latitude: e[0].latitude + 0.02, longitude: e[0].longitude };
  // Chrono actif à Mont-Bellevue seulement ; Liaison Secours aux deux
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"liaison_secours": true}' WHERE id IN ($1, $2)`, [ids.mb, ids.sl]);
  await pool.query(`UPDATE etablissements SET modules = modules || '{"chrono": true}' WHERE id = $1`, [ids.mb]);
  const org = async (code, type, profils) => (await pool.query('INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ($1, $1, $2, $3, $4) RETURNING id', [code, type, profils, e[0].config_id])).rows[0].id;
  ids.ambA = await org('AMB-CA', 'ambulancier', ['ambulance']); ids.ambB = await org('AMB-CB', 'ambulancier', ['ambulance']); ids.ccs = await org('CCS-C', 'ccs', ['ccs']);
  const unite = async (o, n) => (await pool.query('INSERT INTO unites_secours (organisation_id, numero) VALUES ($1, $2) RETURNING id', [o, n])).rows[0].id;
  ids.u1 = await unite(ids.ambA, '30-01'); ids.u2 = await unite(ids.ambA, '30-02'); ids.u3 = await unite(ids.ambB, '40-01');
  await compte('para.chrono@demo.arrimo', 'paramedic', ids.ambA); await compte('parab.chrono@demo.arrimo', 'paramedic', ids.ambB); await compte('ccs.chrono@demo.arrimo', 'repartiteur', ids.ccs);
  await connecter('para', 'para.chrono@demo.arrimo'); await connecter('paraB', 'parab.chrono@demo.arrimo'); await connecter('ccs', 'ccs.chrono@demo.arrimo');
  await connecter('tremblay', 'tremblay@demo.arrimo'); await connecter('bouchard', 'bouchard@demo.arrimo');
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('zone : une position isolée n’ouvre rien (bruit GPS) ; deux positions de suite → H11 à l’heure de la première', async () => {
  assert.strictEqual((await position('para', ids.u2, ids.posMb, 12)).statut, 200);
  assert.strictEqual((await passageDe(ids.u2)).statut, 'detecte');
  await position('para', ids.u2, ids.dehors, 11);
  assert.strictEqual((await passageDe(ids.u2)).statut, 'abandonne', 'position isolée : abandonnée');
  // Position trop imprécise : ignorée
  await position('para', ids.u2, ids.posMb, 10, { precision_m: 400 });
  assert.strictEqual((await passageDe(ids.u2)).statut, 'abandonne');
  // Entrée réelle : deux positions dans la zone
  await position('para', ids.u2, ids.posMb, 9); await position('para', ids.u2, ids.posMb, 8);
  const p = await passageDe(ids.u2);
  assert.strictEqual(p.statut, 'a_la_porte'); assert.strictEqual(p.prealerte_id, null, 'ambulance sans préalerte : numéro d’unité seulement');
  const h11 = (await pool.query("SELECT heure, source FROM v_horodatages_courants WHERE objet = 'passage_chrono' AND objet_id = $1 AND etape = 'H11'", [p.id])).rows[0];
  assert.strictEqual(h11.source, 'position');
  assert.ok(Math.abs(new Date(h11.heure) - new Date(il_y_a(9))) < 5000, 'H11 = heure de la première position, pas de la réception');
  ids.p2 = p.id;
});

test('alerte Chrono persistante : un seul envoi lors de deux balayages concurrents', async () => {
  const c = (await pool.query(`SELECT cfg.id, cfg.chrono_cible_porte_min, cfg.chrono_orange_min FROM etablissements e
    JOIN config_pays cfg ON cfg.id = e.config_id WHERE e.id = $1`, [ids.mb])).rows[0];
  await pool.query('UPDATE config_pays SET chrono_cible_porte_min = 6, chrono_orange_min = 5 WHERE id = $1', [c.id]);
  try {
    const chrono = require('../src/chrono');
    await Promise.all([chrono.notifierAttentes(pool), chrono.notifierAttentes(pool)]);
    const p = (await passageDe(ids.u2)).numero;
    const n = await pool.query("SELECT id FROM notifications WHERE code = 'chrono_seuil_atteint' AND vars->>'passage' = $1", [p]);
    assert.strictEqual(n.rowCount, 1);
    const notifs = await appel('tremblay', 'GET', `/notifications?etablissement_id=${ids.mb}`);
    assert.ok(notifs.corps.some((x) => x.code === 'chrono_seuil_atteint' && x.vars.passage === p));
  } finally {
    await pool.query('UPDATE config_pays SET chrono_cible_porte_min = $2, chrono_orange_min = $3 WHERE id = $1', [c.id, c.chrono_cible_porte_min, c.chrono_orange_min]);
  }
});

test('ordre des étapes : H12 < H13 < H14 imposé ; rien n’est inventé', async () => {
  const etape = (e) => appel('tremblay', 'POST', `/chrono/passages/${ids.p2}/etape`, { etablissement_id: ids.mb, etape: e });
  assert.strictEqual((await etape('H13')).corps.code, 'etape_precedente_manquante');
  assert.strictEqual((await etape('H11')).statut, 400, 'H11 jamais au clic de l’urgence');
  assert.strictEqual((await etape('H12')).statut, 200); assert.strictEqual((await etape('H12')).corps.code, 'etape_deja_marquee');
  assert.strictEqual((await etape('H13')).statut, 200); assert.strictEqual((await etape('H14')).statut, 200);
  // L'ambulance et le CCS ne cliquent pas les étapes de l'urgence
  assert.strictEqual((await appel('para', 'POST', `/secours/chrono/passages/${ids.p2}/etape`, { etape: 'H12' })).statut, 403);
});

test('démarquage : la même fiche, les mêmes heures pour l’urgence, l’ambulance et le CCS ; cloisonnement', async () => {
  const hop = (await appel('tremblay', 'GET', `/chrono?etablissement_id=${ids.mb}`)).corps;
  const amb = (await appel('para', 'GET', '/secours/chrono')).corps;
  const ccs = (await appel('ccs', 'GET', '/secours/chrono')).corps;
  const fiche = (d) => d.a_la_porte.find((x) => x.id === ids.p2);
  for (const [nom, d] of [['ambulance', amb], ['ccs', ccs]]) {
    assert.deepStrictEqual(fiche(d).heures, fiche(hop).heures, nom);
    assert.deepStrictEqual(fiche(d).cibles, fiche(hop).cibles, nom);
    assert.strictEqual(fiche(d).niveau, fiche(hop).niveau, nom);
  }
  assert.strictEqual(hop.cibles.porte, 20); assert.strictEqual(hop.indicatif, true);
  const choisi = await appel('ccs', 'GET', `/secours/chrono?vehicule=${encodeURIComponent(fiche(hop).unite)}&heures_historique=48`);
  assert.strictEqual(choisi.statut, 200);
  assert.strictEqual(choisi.corps.heures_historique, 48);
  assert.ok(choisi.corps.a_la_porte.some((p) => p.id === ids.p2));
  const inconnu = await appel('ccs', 'GET', '/secours/chrono?vehicule=%25');
  assert.strictEqual(inconnu.corps.a_la_porte.length, 0, 'les caractères de recherche sont littéraux');
  assert.strictEqual((await appel('ccs', 'GET', '/secours/chrono?heures_historique=3000')).statut, 400);
  assert.ok(Number.isFinite(Date.parse(hop.actualise_le)));
  const attentes = hop.a_la_porte.map((p) => p.a_la_porte_min).filter((min) => min != null && min >= 0);
  assert.strictEqual(hop.attente.en_cours, attentes.length);
  assert.strictEqual(hop.attente.seuil_atteint, attentes.filter((min) => min >= hop.cibles.porte).length);
  assert.strictEqual(hop.attente.minutes_cumulees, attentes.reduce((total, min) => total + min, 0));
  // Autre entreprise, autre hôpital, hôpital sans le module : rien
  assert.ok(!(await appel('paraB', 'GET', '/secours/chrono')).corps.a_la_porte.some((x) => x.id === ids.p2));
  assert.strictEqual((await appel('paraB', 'GET', `/secours/chrono/passages/${ids.p2}`)).statut, 404);
  const sl = await appel('bouchard', 'GET', `/chrono?etablissement_id=${ids.sl}`);
  assert.strictEqual(sl.statut, 403); assert.strictEqual(sl.corps.code, 'module_desactive');
  assert.strictEqual((await appel('bouchard', 'GET', `/chrono?etablissement_id=${ids.mb}`)).statut, 403);
});

test('Chrono : les motifs observés sont historisés et le CCS reste en lecture', async () => {
  const url = `/secours/chrono/passages/${ids.p2}/retard`;
  assert.strictEqual((await appel('ccs', 'POST', url, { motif: 'civiere' })).statut, 403);
  assert.strictEqual((await appel('paraB', 'POST', url, { motif: 'civiere' })).statut, 404);
  assert.strictEqual((await appel('para', 'POST', url, { motif: 'invalide' })).statut, 400);
  const premier = await appel('para', 'POST', url, { motif: 'civiere' });
  assert.strictEqual(premier.statut, 200);
  assert.strictEqual((await appel('para', 'POST', url, { motif: 'civiere' })).corps.deja, true);
  const second = await appel('tremblay', 'POST', `/chrono/passages/${ids.p2}/retard`,
    { etablissement_id: ids.mb, motif: 'nettoyage', version: premier.corps.version });
  assert.strictEqual(second.statut, 200);
  const fiche = await appel('ccs', 'GET', `/secours/chrono/passages/${ids.p2}`);
  assert.strictEqual(fiche.corps.motif_retard, 'nettoyage');
  assert.deepStrictEqual(fiche.corps.historique_retards.map((r) => r.motif), ['civiere', 'nettoyage']);
});

test('sortie : première position hors zone après H14 → H15 et passage terminé', async () => {
  // Position hors zone plus ancienne que H14 : ce n'est pas le départ
  await position('para', ids.u2, ids.dehors, 1);
  assert.strictEqual((await passageDe(ids.u2)).statut, 'a_la_porte');
  await position('para', ids.u2, ids.dehors, 0);
  const p = await passageDe(ids.u2); assert.strictEqual(p.statut, 'termine');
  const f = (await appel('tremblay', 'GET', `/chrono/passages/${ids.p2}?etablissement_id=${ids.mb}`)).corps;
  assert.ok(f.heures.H15); assert.ok(f.durees.porte >= 0 && f.durees.total > 0);
});

test('correction : nouvelle ligne avec auteur et motif fermé, ordre conservé, l’ancienne reste lisible ; écarts', async () => {
  const corr = (b, qui = 'tremblay', pre = '/chrono') => appel(qui, 'POST', `${pre}/passages/${ids.p2}/corriger`, { etablissement_id: ids.mb, ...b });
  assert.strictEqual((await corr({ etape: 'H12', heure: il_y_a(8.5), motif: 'pas une raison' })).corps.code, 'motif_correction_invalide');
  assert.strictEqual((await corr({ etape: 'H12', heure: il_y_a(30), motif: 'oubli' })).corps.code, 'ordre_etapes', 'H12 avant H11 refusée');
  assert.strictEqual((await corr({ etape: 'H12', heure: il_y_a(1), motif: 'erreur_saisie' }, 'ccs', '/secours/chrono')).statut, 403);
  const r = await corr({ etape: 'H11', heure: il_y_a(15), motif: 'position_imprecise' });
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps)); assert.ok(r.corps.remplace_id);
  const f = (await appel('para', 'GET', `/secours/chrono/passages/${ids.p2}`)).corps;
  assert.strictEqual(f.heures.H11.corrigee, true); assert.strictEqual(f.historique.filter((h) => h.etape === 'H11').length, 2, 'rien n’est effacé');
  await assert.rejects(pool.query("UPDATE horodatages SET heure = now() WHERE objet = 'passage_chrono'"));
  // Écart de 5 min ou plus entre l'heure corrigée et l'heure détectée
  assert.strictEqual((await corr({ etape: 'H15', heure: new Date().toISOString(), motif: 'autre' })).statut, 200);
  const ecarts = (await appel('tremblay', 'GET', `/chrono/ecarts?etablissement_id=${ids.mb}`)).corps;
  assert.ok(ecarts.some((e) => e.etape === 'H11'), JSON.stringify(ecarts));
});

test('préalerte : « Arrivée » de l’équipage → H11 au clic ; remise → H14 ; départ au clic → H15', async () => {
  const pa = (await appel('para', 'POST', '/secours/prealertes', { unite_id: ids.u1, destination_id: ids.mb, priorite: 'urgente', categorie: 'medicale', delai_min: 5 })).corps;
  assert.ok(pa.id, JSON.stringify(pa));
  const enRoute = (await appel('tremblay', 'GET', `/chrono?etablissement_id=${ids.mb}`)).corps.en_route;
  assert.ok(enRoute.some((x) => x.id === pa.id), 'en route avant l’arrivée');
  assert.strictEqual((await appel('para', 'POST', `/secours/prealertes/${pa.id}/action`, { action: 'signaler_arrivee' })).statut, 200);
  const p = await passageDe(ids.u1); assert.strictEqual(p.prealerte_id, pa.id); assert.strictEqual(p.statut, 'a_la_porte');
  // Départ avant la civière libérée : refusé
  assert.strictEqual((await appel('para', 'POST', `/secours/chrono/passages/${p.id}/depart`, {})).corps.code, 'etape_precedente_manquante');
  await appel('tremblay', 'POST', `/secours/prealertes/${pa.id}/action`, { etablissement_id: ids.mb, action: 'confirmer_vehicule', unite_numero: '30-01' });
  assert.strictEqual((await appel('tremblay', 'POST', `/secours/prealertes/${pa.id}/action`, { etablissement_id: ids.mb, action: 'confirmer_remise' })).statut, 200);
  let f = (await appel('para', 'GET', `/secours/chrono/passages/${p.id}`)).corps;
  assert.ok(f.heures.H11 && f.heures.H14 && !f.heures.H12, 'H12 et H13 manquantes : jamais inventées');
  assert.strictEqual((await appel('para', 'POST', `/secours/chrono/passages/${p.id}/depart`, {})).statut, 200);
  f = (await appel('para', 'GET', `/secours/chrono/passages/${p.id}`)).corps;
  assert.strictEqual(f.statut, 'termine'); assert.strictEqual(f.heures.H15.source, 'clic');
});

test('rapport mensuel : moyennes, médianes, hors cible, complétude, étapes manquantes ; CSV ; FR/EN', async () => {
  const r = (await appel('tremblay', 'GET', `/chrono/rapport?etablissement_id=${ids.mb}`)).corps;
  assert.strictEqual(r.passages, 2); assert.strictEqual(r.etapes_manquantes.H12, 1); assert.strictEqual(r.completude_pct, 50);
  assert.strictEqual(r.porte.n, 2); assert.ok(r.porte.mediane_min != null); assert.strictEqual(r.porte.cible_min, 20);
  assert.ok(r.corrections >= 2);
  const amb = (await appel('para', 'GET', '/secours/chrono/rapport')).corps; assert.strictEqual(amb.passages, 2, 'l’entreprise : ses unités');
  assert.strictEqual((await appel('paraB', 'GET', '/secours/chrono/rapport')).corps.passages, 0);
  const csv = await appel('tremblay', 'GET', `/chrono/rapport.csv?etablissement_id=${ids.mb}`);
  assert.match(csv.type, /text\/csv/); assert.match(csv.corps, /Numéro;Hôpital;Entreprise;Unité;H11/); assert.ok(!/P-\d{5}/.test(csv.corps), 'aucune référence patient');
  const en = await fetch(`${base}/api/chrono/rapport.csv?etablissement_id=${ids.mb}`, { headers: { Authorization: `Bearer ${tokens.tremblay}`, 'X-Langue': 'en' } });
  assert.match(await en.text(), /Number;Hospital;Company;Unit;H11/);
  assert.strictEqual((await appel('tremblay', 'GET', `/chrono/rapport?etablissement_id=${ids.mb}&mois=2026-13`)).statut, 400);
});

test('anglais : chaque texte de l’écran Chrono existe en FR et en EN (échoue s’il en manque un)', () => {
  const vm = require('node:vm'); const fs = require('node:fs');
  const c = { window: {} }; vm.createContext(c);
  for (const f of ['fr', 'en', 'aide.fr', 'aide.en']) vm.runInContext(fs.readFileSync(require.resolve(`../public/i18n/${f}.js`), 'utf8'), c);
  const { fr, en } = c.window.ARRIMO_I18N;
  const cles = [...new Set([...fs.readFileSync(require.resolve('../public/chrono.js'), 'utf8').matchAll(/K\('([a-z_]+)'/g)].map((m) => m[1]))];
  for (const k of cles) { assert.ok(fr.chrono[k], `fr chrono.${k}`); assert.ok(en.chrono[k], `en chrono.${k}`); }
  for (const e of ['H11', 'H12', 'H13', 'H14', 'H15']) assert.ok(fr.chrono[`etape_${e}`] && en.chrono[`etape_${e}`]);
  for (const m of ['oubli', 'erreur_saisie', 'position_imprecise', 'panne_reseau', 'autre']) assert.ok(en.chrono[`motif_${m}`]);
  assert.ok(fr.aide.ecrans.chrono && en.aide.ecrans.chrono, 'aide de l’écran');
});

test('OG : « combien d’ambulances à la porte ? » côté urgence et côté ambulance, FR/EN, depuis les mêmes heures', async () => {
  // Une ambulance à la porte : 30-02 revient à Mont-Bellevue
  await position('para', ids.u2, ids.posMb, 3); await position('para', ids.u2, ids.posMb, 2);
  const hop = await appel('tremblay', 'POST', '/copilote/question', { etablissement_id: ids.mb, question: 'Combien d’ambulances à la porte ?' });
  assert.strictEqual(hop.statut, 200, JSON.stringify(hop.corps)); assert.match(hop.corps.reponse, /1 ambulance à la porte/); assert.match(hop.corps.reponse, /30-02/);
  const en = await appel('para', 'POST', '/secours/og', { question: 'How many ambulances at the door?' });
  assert.match(en.corps.reponse, /1 ambulance at the door/);
  assert.match((await appel('bouchard', 'POST', '/copilote/question', { etablissement_id: ids.sl, question: 'Chrono à la porte ?' })).corps.reponse, /pas activé/);
});
