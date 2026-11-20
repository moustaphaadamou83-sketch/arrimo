'use strict';
/**
 * Module 🎓 Formation — service (22 nov. 2026, lot 1).
 * - Parcours attribués automatiquement selon le rôle, le type d'établissement et les modules activés ; la personne peut en ajouter
 *   parmi ceux de son rôle. Elle ne voit que les capsules de ses parcours et des modules actifs de son établissement.
 * - Progression : vu, pratiqué (exercice, lot 2), réussi ; mini-test noté et chronométré CÔTÉ SERVEUR (heure de début enregistrée).
 * - Aucune donnée de patient : seulement des codes de capsule et des scores.
 */
const fs = require('fs');
const path = require('path');
const { ErreurHttp } = require('./db');
const TE = require('./types-etablissement');
const CAT = require('./formation-catalogue');

const SEUIL = 67;                 // 2 bonnes réponses sur 3
const GRACE_MS = 3000;            // marge réseau pour un test chronométré
const MODULES_SECOURS = ['liaison_secours', 'chrono', 'urgences_direct', 'transport_planifie', 'transferts_suivi'];
const PUBLIC = path.join(__dirname, '..', 'public', 'formation');
let manifeste = null;
const lireManifeste = () => {
  if (manifeste) return manifeste;
  try { manifeste = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'captures', 'manifeste.json'), 'utf8')); } catch { manifeste = {}; }
  return manifeste;
};
const L = (langue) => (langue === 'en' ? 'en' : 'fr');

async function contexte(db, u) {
  const etabs = (u.etabs || []).length ? (await db.query('SELECT id, type_etablissement, type_local_code, modules FROM etablissements WHERE id = ANY($1) AND actif', [u.etabs.map(Number)])).rows : [];
  const orgs = (await db.query(`SELECT o.id, o.type, o.formation FROM utilisateur_organisations uo JOIN organisations_secours o ON o.id = uo.organisation_id
    WHERE uo.utilisateur_id = $1 AND o.actif`, [u.id])).rows;
  return { u, etabs, orgs };
}
const actif = (x) => !!x.u.gestionnaire || x.etabs.some((e) => TE.moduleActif(e, 'formation')) || x.orgs.some((o) => o.formation);
function moduleVisible(x, module) {
  if (!module || x.u.gestionnaire) return true;
  if (x.etabs.some((e) => TE.moduleActif(e, module))) return true;
  return x.orgs.length > 0 && MODULES_SECOURS.includes(module);
}
function eligible(x, p) {
  if (!p.roles.includes(x.u.role) && !(x.u.gestionnaire && p.roles.includes('gestionnaire'))) return false;
  if (!p.types) return true;
  if (x.u.gestionnaire) return true;
  return x.etabs.some((e) => p.types.includes(e.type_etablissement || 'hopital') && (!p.locaux || p.locaux.includes(e.type_local_code || null)));
}
async function parcoursDe(db, x) {
  const elig = CAT.PARCOURS.filter((p) => eligible(x, p));
  const choix = (await db.query('SELECT parcours FROM formation_choix WHERE utilisateur_id = $1 ORDER BY choisi_le', [x.u.id])).rows.map((r) => r.parcours);
  let codes = choix.filter((c) => elig.some((p) => p.code === c));
  if (!codes.length) codes = elig.filter((p) => (p.defaut || []).includes(x.u.role)).map((p) => p.code);
  if (!codes.length && elig.length) codes = [elig[0].code];
  return { elig, codes };
}
function etatDe(pr) {
  if (!pr) return 'a_faire';
  if (pr.reussi_le) return 'reussi';
  return pr.vu_le || pr.essais > 0 || pr.pratique_le ? 'en_cours' : 'a_faire';
}

/** « Ma formation » : parcours, capsules visibles avec leur état, progression, prochaine capsule. */
async function moi(pool, u, langue) {
  const l = L(langue); const x = await contexte(pool, u);
  if (!actif(x)) return { actif: false };
  const { elig, codes } = await parcoursDe(pool, x);
  const prog = new Map((await pool.query('SELECT * FROM formation_progression WHERE utilisateur_id = $1', [u.id])).rows.map((r) => [r.capsule, r]));
  const vus = new Set(); let total = 0; let reussies = 0; let prochaine = null;
  const parcours = codes.map((code) => {
    const p = CAT.parcours(code);
    const caps = p.capsules.map(CAT.capsule).filter((c) => moduleVisible(x, c.module)).map((c) => {
      const pr = prog.get(c.code); const etat = c.pret ? etatDe(pr) : 'preparation';
      if (c.pret && !vus.has(c.code)) { vus.add(c.code); total += 1; if (etat === 'reussi') reussies += 1; else if (!prochaine) prochaine = { code: c.code, titre: c.titre[l], emoji: c.emoji, duree: c.duree }; }
      return { code: c.code, emoji: c.emoji, titre: c.titre[l], duree: c.duree, etat, score: pr?.meilleur_score ?? null, chrono: c.chrono_test_s || null };
    });
    const prets = caps.filter((c) => c.etat !== 'preparation');
    return { code, emoji: p.emoji, nom: p.nom[l], capsules: caps, total: prets.length, reussies: prets.filter((c) => c.etat === 'reussi').length };
  });
  return { actif: true, langue: l, role: u.role, progression: total ? Math.round((100 * reussies) / total) : 0, total, reussies, prochaine, parcours,
    eligibles: elig.map((p) => ({ code: p.code, emoji: p.emoji, nom: p.nom[l], choisi: codes.includes(p.code) })) };
}

async function choisir(pool, u, b = {}) {
  const x = await contexte(pool, u); if (!actif(x)) throw new ErreurHttp(403, 'module_desactive', { module: 'formation' });
  const codes = Array.isArray(b.parcours) ? [...new Set(b.parcours.map(String))] : [];
  const { elig } = await parcoursDe(pool, x);
  if (!codes.length || codes.length > 6 || codes.some((c) => !elig.some((p) => p.code === c))) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'parcours' });
  await pool.query('DELETE FROM formation_choix WHERE utilisateur_id = $1', [u.id]);
  for (const c of codes) await pool.query('INSERT INTO formation_choix (utilisateur_id, parcours) VALUES ($1, $2)', [u.id, c]);
  return { parcours: codes };
}

/** Capsule accessible : prête, dans un parcours éligible de la personne, module actif. */
async function capsuleAccessible(pool, u, code) {
  const x = await contexte(pool, u); if (!actif(x)) throw new ErreurHttp(403, 'module_desactive', { module: 'formation' });
  const c = CAT.capsule(String(code || '').toUpperCase());
  const { elig } = await parcoursDe(pool, x);
  if (!c || !c.pret || !moduleVisible(x, c.module) || !elig.some((p) => p.capsules.includes(c.code))) throw new ErreurHttp(404, 'objet_introuvable');
  return c;
}
const existe = (rel) => { try { return fs.statSync(path.join(PUBLIC, rel)).isFile(); } catch { return false; } };

/** Contenu d'une capsule dans la langue demandée : scènes (capture, zone mise en évidence, sous-titre, voix si fournie), test sans les réponses. */
async function contenu(pool, u, code, langue) {
  const l = L(langue); const c = await capsuleAccessible(pool, u, code);
  const m = lireManifeste()[c.code] || {};
  const pr = (await pool.query('SELECT * FROM formation_progression WHERE utilisateur_id = $1 AND capsule = $2', [u.id, c.code])).rows[0];
  return { code: c.code, emoji: c.emoji, titre: c.titre[l], objectif: c.objectif[l], duree: c.duree, etat: etatDe(pr), score: pr?.meilleur_score ?? null, chrono_test_s: c.chrono_test_s || null,
    scenes: c.scenes.map((s, i) => {
      const img = `captures/${c.code}/${i + 1}-${l}.jpg`; const voix = `voix/${c.code}/${i + 1}-${l}.mp3`;
      return { sous_titre: s.st[l], image: existe(img) ? `/formation/${img}` : null, zone: m[i + 1]?.[l] || m[i + 1]?.fr || null, voix: existe(voix) ? `/formation/${voix}` : null };
    }),
    quiz: c.quiz.map((q) => ({ question: q.q[l], choix: q.choix[l] })),
    exercice: (c.exercice || []).map((x) => { const img = `captures/${c.code}/${x.scene}-${l}.jpg`; return { consigne: x.consigne[l], image: existe(img) ? `/formation/${img}` : null }; }),
    pratique: !!pr?.pratique_le, quiz_reussi: !!pr?.quiz_reussi_le };
}

async function marquerVue(pool, u, code) {
  const c = await capsuleAccessible(pool, u, code);
  await pool.query(`INSERT INTO formation_progression (utilisateur_id, capsule, vu_le) VALUES ($1, $2, now())
    ON CONFLICT (utilisateur_id, capsule) DO UPDATE SET vu_le = COALESCE(formation_progression.vu_le, now()), maj_le = now()`, [u.id, c.code]);
  return { ok: true };
}
/** Début du test : l'heure est prise par le serveur (un test chronométré ne dépend pas de l'horloge du navigateur). */
async function debutQuiz(pool, u, code) {
  const c = await capsuleAccessible(pool, u, code);
  await pool.query(`INSERT INTO formation_progression (utilisateur_id, capsule, quiz_debut_le) VALUES ($1, $2, now())
    ON CONFLICT (utilisateur_id, capsule) DO UPDATE SET quiz_debut_le = now(), maj_le = now()`, [u.id, c.code]);
  return { chrono_test_s: c.chrono_test_s || null };
}
async function repondre(pool, u, code, b = {}) {
  const c = await capsuleAccessible(pool, u, code);
  const rep = Array.isArray(b.reponses) ? b.reponses.map(Number) : [];
  if (rep.length !== c.quiz.length || rep.some((r, i) => !Number.isInteger(r) || r < 0 || r >= c.quiz[i].choix.fr.length)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'reponses' });
  const pr = (await pool.query('SELECT quiz_debut_le FROM formation_progression WHERE utilisateur_id = $1 AND capsule = $2', [u.id, c.code])).rows[0];
  if (!pr?.quiz_debut_le) throw new ErreurHttp(409, 'parametre_invalide', { nom: 'debut' });
  const duree = Date.now() - new Date(pr.quiz_debut_le).getTime();
  const justes = rep.map((r, i) => r === c.quiz[i].bonne);
  const score = Math.round((100 * justes.filter(Boolean).length) / c.quiz.length);
  const horsTemps = !!c.chrono_test_s && duree > c.chrono_test_s * 1000 + GRACE_MS;
  const reussi = score >= SEUIL && !horsTemps;
  await pool.query('INSERT INTO formation_essais (utilisateur_id, capsule, genre, score, reussi, duree_ms, details) VALUES ($1, $2, \'quiz\', $3, $4, $5, $6)',
    [u.id, c.code, score, reussi, duree, JSON.stringify({ justes, hors_temps: horsTemps })]);
  const sansExercice = !(c.exercice || []).length;
  const maj = (await pool.query(`UPDATE formation_progression SET essais = essais + 1, quiz_debut_le = NULL, meilleur_score = GREATEST(COALESCE(meilleur_score, 0), $3),
      quiz_reussi_le = CASE WHEN $4 THEN COALESCE(quiz_reussi_le, now()) ELSE quiz_reussi_le END,
      reussi_le = CASE WHEN $4 AND ($5 OR pratique_le IS NOT NULL) THEN COALESCE(reussi_le, now()) ELSE reussi_le END, maj_le = now()
    WHERE utilisateur_id = $1 AND capsule = $2 RETURNING reussi_le, pratique_le`, [u.id, c.code, score, reussi, sansExercice])).rows[0];
  return { capsule_reussie: !!maj.reussi_le, exercice_a_faire: reussi && !sansExercice && !maj.pratique_le, score, reussi, hors_temps: horsTemps, duree_ms: duree, seuil: SEUIL, corrections: justes.map((j, i) => ({ juste: j, bonne: c.quiz[i].bonne })) };
}

/** Exercice guidé (« À vous de jouer ») : l'état (étape, erreurs) est tenu par le serveur ; chaque clic est vérifié contre la zone
    attendue de la capture ; après une erreur, la zone est montrée (« cliquez ici »). Note : 100 − 25 par erreur, réussi à 50. */
const MARGE = 2;
async function debutExercice(pool, u, code, b = {}) {
  const c = await capsuleAccessible(pool, u, code);
  if (!(c.exercice || []).length) throw new ErreurHttp(404, 'objet_introuvable');
  const etat = { etape: 0, erreurs: 0, langue: L(b.langue), debut: Date.now() };
  await pool.query(`INSERT INTO formation_progression (utilisateur_id, capsule, exercice_etat) VALUES ($1, $2, $3)
    ON CONFLICT (utilisateur_id, capsule) DO UPDATE SET exercice_etat = $3, maj_le = now()`, [u.id, c.code, JSON.stringify(etat)]);
  return { etapes: c.exercice.length, etape: 0 };
}
async function clicExercice(pool, u, code, b = {}) {
  const c = await capsuleAccessible(pool, u, code);
  const pr = (await pool.query('SELECT exercice_etat, quiz_reussi_le FROM formation_progression WHERE utilisateur_id = $1 AND capsule = $2', [u.id, c.code])).rows[0];
  const etat = pr?.exercice_etat; if (!etat || etat.etape >= (c.exercice || []).length) throw new ErreurHttp(409, 'parametre_invalide', { nom: 'debut' });
  const x = Number(b.x); const y = Number(b.y);
  if (!(x >= 0 && x <= 100 && y >= 0 && y <= 100)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'clic' });
  const etapeDef = c.exercice[etat.etape];
  const zones = lireManifeste()[c.code]?.[etapeDef.scene] || {};
  const z = zones[etat.langue] || zones.fr || null;
  const juste = !z || (x >= z.x - MARGE && x <= z.x + z.w + MARGE && y >= z.y - MARGE && y <= z.y + z.h + MARGE);
  if (!juste) {
    etat.erreurs += 1;
    await pool.query('UPDATE formation_progression SET exercice_etat = $3, maj_le = now() WHERE utilisateur_id = $1 AND capsule = $2', [u.id, c.code, JSON.stringify(etat)]);
    return { juste: false, indice: z, etape: etat.etape };
  }
  etat.etape += 1;
  if (etat.etape < c.exercice.length) {
    await pool.query('UPDATE formation_progression SET exercice_etat = $3, maj_le = now() WHERE utilisateur_id = $1 AND capsule = $2', [u.id, c.code, JSON.stringify(etat)]);
    return { juste: true, termine: false, etape: etat.etape };
  }
  const score = Math.max(0, 100 - 25 * etat.erreurs); const reussi = score >= 50;
  await pool.query('INSERT INTO formation_essais (utilisateur_id, capsule, genre, score, reussi, duree_ms, details) VALUES ($1, $2, \'exercice\', $3, $4, $5, $6)',
    [u.id, c.code, score, reussi, Date.now() - (etat.debut || Date.now()), JSON.stringify({ erreurs: etat.erreurs })]);
  const maj = (await pool.query(`UPDATE formation_progression SET exercice_etat = NULL, pratique_le = CASE WHEN $3 THEN COALESCE(pratique_le, now()) ELSE pratique_le END,
      reussi_le = CASE WHEN $3 AND quiz_reussi_le IS NOT NULL THEN COALESCE(reussi_le, now()) ELSE reussi_le END, maj_le = now()
    WHERE utilisateur_id = $1 AND capsule = $2 RETURNING reussi_le`, [u.id, c.code, reussi])).rows[0];
  return { juste: true, termine: true, score, reussi, erreurs: etat.erreurs, capsule_reussie: !!maj.reussi_le };
}

/** Capsules accessibles (parcours choisis d'abord) : pour le bouton « ? » de chaque écran et pour OG « comment faire… ». */
async function accessibles(pool, u, langue) {
  const l = L(langue); const x = await contexte(pool, u); if (!actif(x)) return [];
  const { elig, codes } = await parcoursDe(pool, x);
  const ordre = [...elig.filter((p) => codes.includes(p.code)), ...elig.filter((p) => !codes.includes(p.code))];
  const vus = new Set(); const out = [];
  for (const p of ordre) for (const k of p.capsules) {
    const c = CAT.capsule(k); if (!c.pret || vus.has(k) || !moduleVisible(x, c.module)) continue; vus.add(k);
    out.push({ code: c.code, titre: c.titre[l], duree: c.duree, emoji: c.emoji, ecran: c.scenes[0].ecran || null, onglet: c.scenes[0].onglet || null });
  }
  return out;
}
async function aideEcrans(pool, u, langue) {
  const m = {};
  for (const c of await accessibles(pool, u, langue)) { const k = c.ecran || (c.onglet && `secours:${c.onglet}`); if (k && !m[k]) m[k] = { code: c.code, titre: c.titre, duree: c.duree }; }
  return m;
}

module.exports = { accessibles, aideEcrans, moi, choisir, contenu, marquerVue, debutQuiz, repondre, debutExercice, clicExercice, SEUIL, _contexte: contexte, _actif: actif };
