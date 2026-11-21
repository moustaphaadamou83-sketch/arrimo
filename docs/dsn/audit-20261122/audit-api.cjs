'use strict';
/* Audit DSN — phase 1 (constat, aucune correction). Serveur isolé 3099 (démo) et 3098 (validation), base audit_dsn (copie).
   Chaque cas : id, module, étapes, attendu, obtenu, statut (RÉUSSI / ÉCHEC / BLOQUÉ / NON TESTÉ), preuve (échanges API + état de la base). */
const fs = require('fs'); const path = require('path');
const { Pool } = require('/root/arrimo-sh-erp/node_modules/pg');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const MDP = fs.readFileSync('/root/arrimo-sh-erp/.local/acces-demo-trio.txt', 'utf8').match(/Mot de passe[^:]*:\s*(\S+)/)[1];
const B = 'http://127.0.0.1:3099/api'; const BV = 'http://127.0.0.1:3098/api';
const db = new Pool({ connectionString: 'postgresql://root@localhost/audit_dsn?host=/var/run/postgresql' });
const q = async (sql, v = []) => (await db.query(sql, v)).rows;
const tok = {}; const res = []; let journal = [];
async function connecter(cle, email, base = B) { const r = await fetch(`${base}/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, mot_de_passe: MDP }) }); const d = await r.json(); tok[cle] = d.token; return r.status; }
async function api(cle, m, c, b, { base = B, langue = 'fr', brut = false } = {}) {
  const r = await fetch(`${base}${c}`, { method: m, headers: { 'Content-Type': 'application/json', 'X-Langue': langue, ...(tok[cle] ? { Authorization: `Bearer ${tok[cle]}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = brut ? t : t.slice(0, 300); }
  journal.push({ qui: cle, requete: `${m} ${c}`, corps: b && JSON.stringify(b).length < 600 ? b : (b ? '(volumineux)' : undefined), statut: r.status, reponse: typeof d === 'string' ? d.slice(0, 300) : JSON.stringify(d).slice(0, 600) });
  return { s: r.status, d, h: r.headers };
}
async function cas(id, module, titre, etapes, attendu, fn) {
  journal = []; let statut; let obtenu; let anomalie = null; let gravite = null; let base = null;
  try { const r = await fn(); ({ statut, obtenu } = r); anomalie = r.anomalie || null; gravite = r.gravite || null; base = r.base || null; }
  catch (e) { statut = 'BLOQUÉ'; obtenu = `Erreur pendant le test : ${e.message.split('\n')[0]}`; }
  const preuve = `${id}.json`; fs.writeFileSync(path.join(OUT, preuve), JSON.stringify({ id, module, titre, etapes, attendu, obtenu, statut, anomalie, gravite, echanges: journal, base }, null, 1));
  res.push({ id, module, titre, etapes, attendu, obtenu, statut, anomalie, gravite, preuve });
  console.log(`${statut.padEnd(9)} ${id} ${titre}${anomalie ? ` — ANOMALIE (${gravite}) : ${anomalie}` : ''}`);
}
const ok = (cond, obtenu, anomalie, gravite = 'moyenne', base) => (cond ? { statut: 'RÉUSSI', obtenu, base } : { statut: 'ÉCHEC', obtenu, anomalie, gravite, base });

(async () => {
  const E = Object.fromEntries((await q("SELECT code, id FROM etablissements WHERE code IN ('HY','HX','CHSLD-ERA','CHSLD-STL')")).map((r) => [r.code, r.id]));
  const comptes = { adm: 'dsn.admission@demo.arrimo', inf: 'dsn.infirmier@demo.arrimo', med: 'dsn.medecin@demo.arrimo', sor: 'dsn.sortie@demo.arrimo', aud: 'dsn.auditeur@demo.arrimo',
    hb: 'hopital.b@demo.arrimo', ha: 'hopital.a@demo.arrimo', era: 'coordination.erables@chsld.example.invalid', stl: 'coordination.saint-laurent@chsld.example.invalid',
    ent: 'entretien.erables@chsld.example.invalid', amb: 'ambulance.demo@demo.arrimo', ccs: 'ccs.demo@demo.arrimo', sup: 'superviseur.demo@demo.arrimo', res: 'reseau@demo.arrimo' };
  for (const [k, e] of Object.entries(comptes)) await connecter(k, e);
  const X = {};   // identifiants produits par les cas

  // ===================== 1. DOSSIER PATIENT
  await cas('DP-01', 'Dossier patient', 'Création d’un patient fictif (fonction admission)', ['POST /dsn/patients (admission)'], '200 ; référence unique P-xxxxx ; date de naissance exacte', async () => {
    const r = await api('adm', 'POST', '/dsn/patients', { etablissement_id: E.HY, prenom: 'Audit', nom: 'Démo-Test', date_naissance: '1950-06-15' }); X.p = r.d.id;
    const b = await q('SELECT reference, date_naissance::text dn, parcours FROM patients WHERE id = $1', [X.p]);
    return ok(r.s === 200 && /^P-\d{5}$/.test(r.d.reference) && b[0]?.dn === '1950-06-15', `statut ${r.s}, référence ${r.d.reference}, naissance en base ${b[0]?.dn}`, 'Création ou date incorrecte', 'haute', b);
  });
  await cas('DP-02', 'Dossier patient', 'Doublon d’identité refusé sans confirmation', ['POST /dsn/patients même identité'], '409 patient_doublon_possible', async () => {
    const r = await api('adm', 'POST', '/dsn/patients', { etablissement_id: E.HY, prenom: 'Audit', nom: 'Démo-Test', date_naissance: '1950-06-15' });
    return ok(r.s === 409, `statut ${r.s} ${r.d.code || ''}`, 'Doublon créé', 'haute');
  });
  await cas('DP-03', 'Dossier patient', 'Recherche par nom, référence et date de naissance', ['GET /dsn/patients?q=…'], 'Le patient est trouvé par chacun des trois critères ; date affichée = 1950-06-15', async () => {
    const ref = (await q('SELECT reference FROM patients WHERE id = $1', [X.p]))[0].reference; const o = [];
    for (const t of ['démo-test', ref.toLowerCase(), '1950-06-15']) { const r = await api('med', 'GET', `/dsn/patients?etablissement_id=${E.HY}&q=${encodeURIComponent(t)}`); const p = r.d.patients?.find((x) => x.id === X.p); o.push(`${t} → ${p ? `trouvé (${p.date_naissance})` : 'absent'}`); }
    return ok(o.every((x) => x.includes('trouvé (1950-06-15)')), o.join(' ; '), 'Recherche incomplète ou date décalée', 'moyenne');
  });
  await cas('DP-04', 'Dossier patient', 'Modification de l’identité : motif exigé, réservée à l’admission', ['PUT identite sans motif (admission)', 'PUT avec motif (admission)', 'PUT avec motif (médecin)'], '400 ; 200 ; 403', async () => {
    const a = await api('adm', 'PUT', `/dsn/patients/${X.p}/identite`, { prenom: 'Audit', nom: 'Démo-Test', date_naissance: '1950-06-15', telephone: '' });
    const b = await api('adm', 'PUT', `/dsn/patients/${X.p}/identite`, { prenom: 'Audit', nom: 'Démo-Test', date_naissance: '1950-06-16', motif: 'Correction de la date (fictif)' });
    const c = await api('med', 'PUT', `/dsn/patients/${X.p}/identite`, { prenom: 'Audit', nom: 'Démo-Test', date_naissance: '1950-06-15', motif: 'Essai médecin' });
    const dn = (await q('SELECT date_naissance::text dn FROM patients WHERE id = $1', [X.p]))[0].dn;
    await api('adm', 'PUT', `/dsn/patients/${X.p}/identite`, { prenom: 'Audit', nom: 'Démo-Test', date_naissance: '1950-06-15', motif: 'Retour à la date initiale' });
    return ok(a.s === 400 && b.s === 200 && c.s === 403 && dn === '1950-06-16', `sans motif ${a.s} ; avec motif ${b.s} (naissance ${dn}) ; médecin ${c.s}`, 'Contrôle de la modification d’identité insuffisant', 'moyenne');
  });
  await cas('DP-05', 'Dossier patient', 'Allergie (infirmier) : enregistrée, alerte dans la liste et l’en-tête', ['POST élément allergie', 'GET liste patients', 'GET dossier'], 'Allergie active ; compteur d’allergies = 1', async () => {
    const r = await api('inf', 'POST', `/dsn/patients/${X.p}/elements`, { genre: 'allergie', donnees: { substance: 'Arachides (fictif)', gravite: 'severe', verification: 'confirmee' } }); X.al = r.d.id;
    const l = await api('med', 'GET', `/dsn/patients?etablissement_id=${E.HY}&q=démo-test`); const d = await api('med', 'GET', `/dsn/patients/${X.p}`);
    return ok(r.s === 200 && l.d.patients[0]?.allergies === 1 && d.d.allergies?.length === 1, `création ${r.s} ; compteur ${l.d.patients[0]?.allergies} ; allergies du dossier ${d.d.allergies?.length}`, 'Allergie non reflétée', 'haute');
  });
  await cas('DP-06', 'Dossier patient', 'Antécédent, diagnostic (médecin seulement), observation', ['antécédent (médecin)', 'diagnostic (infirmier) refusé', 'diagnostic (médecin)', 'observation (infirmier)', 'diagnostic (admission) refusé'], '200 ; 403 ; 200 ; 200 ; 403', async () => {
    const s = [];
    s.push((await api('med', 'POST', `/dsn/patients/${X.p}/elements`, { genre: 'antecedent', donnees: { libelle: 'HTA (fictif)', type: 'medical' } })).s);
    s.push((await api('inf', 'POST', `/dsn/patients/${X.p}/elements`, { genre: 'diagnostic', donnees: { libelle: 'Essai (fictif)' } })).s);
    s.push((await api('med', 'POST', `/dsn/patients/${X.p}/elements`, { genre: 'diagnostic', donnees: { libelle: 'Pneumonie (fictif)', certitude: 'provisoire' } })).s);
    s.push((await api('inf', 'POST', `/dsn/patients/${X.p}/elements`, { genre: 'observation', donnees: { type: 'spo2', valeur: '95', unite: '%' } })).s);
    s.push((await api('adm', 'POST', `/dsn/patients/${X.p}/elements`, { genre: 'diagnostic', donnees: { libelle: 'Essai (fictif)' } })).s);
    return ok(s.join() === '200,403,200,200,403', s.join(' ; '), 'Droits par fonction non respectés', 'haute');
  });
  await cas('DP-07', 'Dossier patient', 'Consultation (rencontre), note liée et signée', ['rencontre ambulatoire', 'note sans rencontre refusée', 'note liée', 'signer'], '200 ; 400 ; 200 ; statut signee', async () => {
    const r = await api('med', 'POST', `/dsn/patients/${X.p}/elements`, { genre: 'rencontre', donnees: { type: 'ambulatoire', motif: 'Consultation (fictif)' } }); X.ren = r.d.id;
    const n0 = await api('med', 'POST', `/dsn/patients/${X.p}/elements`, { genre: 'note', donnees: { texte: 'Sans rencontre' } });
    const n = await api('med', 'POST', `/dsn/patients/${X.p}/elements`, { genre: 'note', rencontre_id: X.ren, donnees: { titre: 'Évolution', texte: 'Note fictive' } });
    const s = await api('med', 'POST', `/dsn/elements/${n.d.id}/action`, { action: 'signer' });
    return ok(r.s === 200 && n0.s === 400 && n.s === 200 && s.d.statut === 'signee', `rencontre ${r.s} ; note sans rencontre ${n0.s} ; note ${n.s} ; signature ${s.d.statut}`, 'Chaîne consultation/note défaillante', 'moyenne');
  });
  await cas('DP-08', 'Dossier patient', 'Prescription simulée : brouillon, validation par le médecin seulement, jamais envoyée', ['prescription (infirmier)', 'valider (infirmier) refusé', 'valider (médecin)'], 'brouillon ; 403 ; validee + simulee=true + envoyee=false', async () => {
    const p = await api('inf', 'POST', `/dsn/patients/${X.p}/elements`, { genre: 'prescription', donnees: { substance: 'Produit fictif', dose: '1', voie: 'orale', frequence: 'matin' } }); X.rx = p.d.id;
    const a = await api('inf', 'POST', `/dsn/elements/${X.rx}/action`, { action: 'valider' }); const b = await api('med', 'POST', `/dsn/elements/${X.rx}/action`, { action: 'valider' });
    return ok(p.d.statut === 'brouillon' && a.s === 403 && b.d.statut === 'validee' && b.d.simulee === true && b.d.envoyee === false, `${p.d.statut} ; ${a.s} ; ${b.d.statut} simulee=${b.d.simulee} envoyee=${b.d.envoyee}`, 'Validation de prescription non conforme', 'critique');
  });
  await cas('DP-09', 'Dossier patient', 'Examen : demande (médecin) puis résultat', ['examen (médecin)', 'resultat (infirmier)'], 'demande puis resultat', async () => {
    const e = await api('med', 'POST', `/dsn/patients/${X.p}/elements`, { genre: 'examen', donnees: { type_examen: 'Radiographie (fictif)', priorite: 'routine' } });
    const r = await api('inf', 'POST', `/dsn/elements/${e.d.id}/action`, { action: 'resultat', resultat: 'Résultat fictif normal' });
    return ok(e.d.statut === 'demande' && r.d.statut === 'resultat', `${e.d.statut} → ${r.d.statut}`, 'Cycle d’examen défaillant', 'moyenne');
  });
  await cas('DP-10', 'Dossier patient', 'Hospitalisation (séjour) : parcours « hospitalisé »', ['séjour (admission)'], '200 ; patient hospitalise', async () => {
    const s = await api('adm', 'POST', `/dsn/patients/${X.p}/elements`, { genre: 'sejour', donnees: { service: 'Médecine', lit: 'MED-299' } }); X.sej = s.d.id;
    const p = await q('SELECT parcours FROM patients WHERE id = $1', [X.p]);
    return ok(s.s === 200 && p[0].parcours === 'hospitalise', `séjour ${s.s} ; parcours ${p[0].parcours}`, 'Séjour non reflété', 'moyenne');
  });
  await cas('DP-11', 'Dossier patient', 'Documents : PDF valide accepté ; faux PDF et > 5 Mo refusés ; téléchargement journalisé', ['PDF valide', 'texte déclaré PDF', '6 Mo', 'GET document'], '200 ; 400 ; 400 ; 200 + empreinte identique + accès « export »', async () => {
    const pdf = Buffer.from('%PDF-1.4\n% document fictif\n%%EOF'); const faux = Buffer.from('ceci n’est pas un PDF'); const gros = Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(6 * 1024 * 1024)]);
    const a = await api('med', 'POST', `/dsn/patients/${X.p}/documents`, { type_doc: 'rapport', titre: 'CR fictif', mime: 'application/pdf', contenu_base64: pdf.toString('base64') });
    const b = await api('med', 'POST', `/dsn/patients/${X.p}/documents`, { type_doc: 'rapport', titre: 'Faux', mime: 'application/pdf', contenu_base64: faux.toString('base64') });
    const c = await api('med', 'POST', `/dsn/patients/${X.p}/documents`, { type_doc: 'rapport', titre: 'Gros', mime: 'application/pdf', contenu_base64: gros.toString('base64') });
    const t = await fetch(`${B}/dsn/documents/${a.d.id}`, { headers: { Authorization: `Bearer ${tok.med}` } }); const corps = Buffer.from(await t.arrayBuffer());
    const acc = await q("SELECT action FROM dsn_acces WHERE objet = $1", [a.d.numero]);
    return ok(a.s === 200 && b.s === 400 && [400, 413].includes(c.s) && t.status === 200 && corps.equals(pdf) && acc.some((x) => x.action === 'export'), `valide ${a.s} (${a.d.type_doc ?? a.d.code}) ; faux ${b.s} ; 6 Mo ${c.s} ; téléchargement ${t.status} identique=${corps.equals(pdf)} ; accès ${acc.map((x) => x.action).join(',')}`, 'Contrôle des documents défaillant', 'haute');
  });
  await cas('DP-11b', 'Dossier patient', 'Type de document hors liste : refus propre', ['POST document type_doc inconnu'], '400 parametre_invalide (pas d’erreur serveur)', async () => {
    const r = await api('med', 'POST', `/dsn/patients/${X.p}/documents`, { type_doc: 'compte_rendu', titre: 'X', mime: 'application/pdf', contenu_base64: Buffer.from('%PDF-1.4').toString('base64') });
    return ok(r.s === 400, `statut ${r.s} ${r.d.code || ''}`, 'Un type de document inconnu provoque une erreur serveur 500 (contrôle d’entrée manquant)', 'faible');
  });
  await cas('DP-12', 'Dossier patient', 'Amendement (nouvelle version) et annulation tracée ; aucune suppression', ['amender allergie', 'annuler version remplacée', 'annuler version courante sans motif', 'annuler avec motif', 'DELETE élément'], 'v2 ; 409 ; 400 ; annule ; 404/405 (aucune route)', async () => {
    const a = await api('inf', 'POST', `/dsn/elements/${X.al}/action`, { action: 'amender', motif: 'Précision réaction', donnees: { reaction: 'Œdème (fictif)' } });
    const b = await api('inf', 'POST', `/dsn/elements/${X.al}/action`, { action: 'annuler', motif: 'essai' });
    const c = await api('inf', 'POST', `/dsn/elements/${a.d.id}/action`, { action: 'annuler' });
    const d = await api('inf', 'POST', `/dsn/elements/${a.d.id}/action`, { action: 'annuler', motif: 'Saisie en double (fictif)' });
    const e = await api('inf', 'DELETE', `/dsn/elements/${a.d.id}`);
    const n = await q('SELECT count(*)::int n FROM dsn_elements WHERE id IN ($1, $2)', [X.al, a.d.id]);
    return ok(a.d.version === 2 && b.s === 409 && c.s === 400 && d.d.statut === 'annule' && [404, 405].includes(e.s) && n[0].n === 2, `v${a.d.version} ; ${b.s} ; ${c.s} ; ${d.d.statut} ; DELETE ${e.s} ; lignes conservées ${n[0].n}/2`, 'Traçabilité des modifications insuffisante', 'haute');
  });
  await cas('DP-13', 'Dossier patient', 'Historique chronologique du dossier', ['GET dossier'], 'Chronologie triée du plus récent au plus ancien, avec éléments, documents', async () => {
    const d = (await api('med', 'GET', `/dsn/patients/${X.p}`)).d; const ch = d.chronologie || []; const trie = ch.every((x, i) => !i || new Date(ch[i - 1].quand) >= new Date(x.quand));
    return ok(ch.length >= 10 && trie && ch.some((x) => x.genre === 'document'), `${ch.length} entrées, triées=${trie}, genres : ${[...new Set(ch.map((x) => x.genre))].join(', ')}`, 'Historique incomplet', 'moyenne');
  });
  await cas('DP-14', 'Dossier patient', 'Journal d’accès : auditeur seulement, complet, sans contenu clinique, immuable', ['GET /dsn/acces (médecin)', 'GET /dsn/acces (auditeur)', 'UPDATE et DELETE en base'], '403 ; lecture/écriture/signature/export présents, aucun libellé clinique ; refus de modification', async () => {
    const a = await api('med', 'GET', `/dsn/acces?etablissement_id=${E.HY}&patient_id=${X.p}`); const b = await api('aud', 'GET', `/dsn/acces?etablissement_id=${E.HY}&patient_id=${X.p}`);
    const actions = [...new Set((b.d || []).map((x) => x.action))]; const clinique = JSON.stringify(b.d).match(/Arachides|Pneumonie|Produit fictif/);
    let upd = 'accepté'; try { await db.query("UPDATE dsn_acces SET action = 'x' WHERE id = (SELECT max(id) FROM dsn_acces)"); } catch { upd = 'refusé'; }
    let del = 'accepté'; try { await db.query('DELETE FROM dsn_acces WHERE id = (SELECT max(id) FROM dsn_acces)'); } catch { del = 'refusé'; }
    return ok(a.s === 403 && ['lecture', 'ecriture', 'signature', 'export'].every((x) => actions.includes(x)) && !clinique && upd === 'refusé' && del === 'refusé',
      `médecin ${a.s} ; auditeur ${b.s}, actions : ${actions.join(',')} ; contenu clinique : ${clinique ? clinique[0] : 'aucun'} ; UPDATE ${upd} ; DELETE ${del} (même par un superutilisateur)`, 'Journal d’accès non conforme', 'critique');
  });
  await cas('DP-15', 'Dossier patient', 'Accès non autorisés : sans fonction, autre établissement, autre organisation, sans session', ['réseau (gestionnaire)', 'hopital.a', 'ambulance', 'CCS', 'entretien', 'sans jeton'], 'Aucun ne lit le dossier (403/404/401)', async () => {
    const o = {}; for (const k of ['res', 'ha', 'amb', 'ccs', 'ent', 'stl']) o[k] = (await api(k, 'GET', `/dsn/patients/${X.p}`)).s;
    o.sans = (await fetch(`${B}/dsn/patients/${X.p}`)).status;
    return ok(Object.values(o).every((s) => [401, 403, 404].includes(s)), JSON.stringify(o), 'Fuite d’accès au dossier', 'critique');
  });
  await cas('DP-16', 'Dossier patient', 'Habilitations : l’administrateur ne s’ouvre pas les dossiers ; accès d’urgence justifié', ['admin_etab s’habilite', 'urgence sans justification', 'urgence justifiée par un compte sans fonction puis lecture'], '403 ; 400 ; 200 + lecture permise + journal « urgence »', async () => {
    await db.query("INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) SELECT 'audit.admin@demo.arrimo', 'Audit admin local', mot_de_passe_hash, 'admin_etab' FROM utilisateurs WHERE email = 'hopital.b@demo.arrimo' ON CONFLICT DO NOTHING");
    await db.query("INSERT INTO utilisateur_etablissements SELECT id, $1 FROM utilisateurs WHERE email = 'audit.admin@demo.arrimo' ON CONFLICT DO NOTHING", [E.HY]);
    const adm = { email: 'audit.admin@demo.arrimo' };
    let a = 'BLOQUÉ (aucun admin_etab à l’Hôpital B)'; if (adm) { await connecter('admhb', adm.email); const me = (await q('SELECT id FROM utilisateurs WHERE email = $1', [adm.email]))[0].id; a = (await api('admhb', 'PUT', '/dsn/habilitations', { etablissement_id: E.HY, utilisateur_id: me, fonction: 'medecin', actif: true })).d.code || 'accepté'; }
    // compte sans fonction à l'Hôpital B : on en crée un, fictif, dans la copie isolée
    await db.query("INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) SELECT 'audit.sansfonction@demo.arrimo', 'Audit sans fonction', mot_de_passe_hash, 'coordonnateur' FROM utilisateurs WHERE email = 'hopital.b@demo.arrimo' ON CONFLICT DO NOTHING");
    await db.query("INSERT INTO utilisateur_etablissements SELECT id, $1 FROM utilisateurs WHERE email = 'audit.sansfonction@demo.arrimo' ON CONFLICT DO NOTHING", [E.HY]); await connecter('sf', 'audit.sansfonction@demo.arrimo');
    const l0 = (await api('sf', 'GET', `/dsn/patients/${X.p}`)).s; const b = await api('sf', 'POST', `/dsn/patients/${X.p}/urgence`, {});
    const c = await api('sf', 'POST', `/dsn/patients/${X.p}/urgence`, { justification: 'Patient inconscient aux urgences (fictif)' }); const l1 = (await api('sf', 'GET', `/dsn/patients/${X.p}`)).s;
    const j = await q("SELECT count(*)::int n FROM dsn_acces a JOIN utilisateurs u ON u.id = a.utilisateur_id WHERE u.email = 'audit.sansfonction@demo.arrimo' AND a.action = 'urgence'");
    return ok(a === 'dsn_auto_habilitation' && l0 === 403 && b.s === 400 && c.s === 200 && l1 === 200 && j[0].n === 1, `auto-habilitation : ${a} ; avant urgence ${l0} ; sans justification ${b.s} ; justifiée ${c.s} ; lecture ensuite ${l1} ; journal urgence ${j[0].n}`, 'Contrôle des habilitations ou de l’urgence défaillant', 'haute');
  });

  // ===================== 2. ADMISSIONS
  await cas('AD-01', 'Admissions', 'Admission DSN avec unité et lit : le lit d’Arrimo est-il réservé/occupé ?', ['choisir un lit libre de l’Hôpital B', 'séjour DSN sur ce lit', 'lire l’état du lit'], 'Le lit passe à « occupé » (ou réservé) par les règles des lits ; capacités mises à jour', async () => {
    const lit = (await q("SELECT id, code, etat FROM lits WHERE etablissement_id = $1 AND etat = 'libre' AND actif ORDER BY code LIMIT 1", [E.HY]))[0];
    const p = await api('adm', 'POST', '/dsn/patients', { etablissement_id: E.HY, prenom: 'Admission', nom: 'Démo-Lit', date_naissance: '1947-02-02' }); X.p2 = p.d.id;
    const s = await api('adm', 'POST', `/dsn/patients/${X.p2}/elements`, { genre: 'sejour', donnees: { service: 'Médecine', lit: lit.code } }); X.sej2 = s.d.id;
    const apres = (await q('SELECT etat, patient_ref FROM lits WHERE id = $1', [lit.id]))[0];
    return ok(apres.etat !== 'libre', `séjour ${s.s} sur ${lit.code} ; état du lit avant « ${lit.etat} », après « ${apres.etat} » (patient_ref ${apres.patient_ref || '—'})`,
      'Le séjour DSN n’est pas relié au lit : le champ « lit » est un texte libre ; aucune réservation, aucune mise à jour des capacités (risque de double affectation)', 'haute', { lit: lit.code, avant: lit.etat, apres });
  });
  await cas('AD-02', 'Admissions', 'Affectation d’un lit déjà occupé refusée', ['lit occupé de l’Hôpital B', 'séjour DSN sur ce lit'], '409 (lit occupé)', async () => {
    const lit = (await q("SELECT code FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' ORDER BY code LIMIT 1", [E.HY]))[0];
    const s = await api('adm', 'POST', `/dsn/patients/${X.p2}/elements`, { genre: 'sejour', donnees: { service: 'Médecine', lit: lit.code } });
    return ok(s.s === 409, `lit ${lit.code} (occupé) : statut ${s.s}`, 'Un séjour DSN peut être placé sur un lit occupé : double affectation possible', 'haute');
  });
  await cas('AD-03', 'Admissions', 'Admission visible dans les modules autorisés (Patients, Lits)', ['GET /patients (hopital.b)', 'GET lits'], 'Le patient DSN apparaît dans Patients ; son lit dans Lits', async () => {
    const l = await api('hb', 'GET', `/patients?etablissement_id=${E.HY}&q=Démo-Lit`); const trouve = JSON.stringify(l.d).includes('Démo-Lit');
    const lit = (await q("SELECT count(*)::int n FROM lits l JOIN patients p ON p.reference = l.patient_ref WHERE p.id = $1", [X.p2]))[0].n;
    return { statut: trouve && lit ? 'RÉUSSI' : 'ÉCHEC', obtenu: `module Patients : ${trouve ? 'visible' : 'absent'} ; lit relié dans Lits : ${lit ? 'oui' : 'non'}`, anomalie: trouve && lit ? null : 'Admission DSN visible dans Patients mais aucun lit relié dans Lits', gravite: 'haute' };
  });
  await cas('AD-04', 'Admissions', 'Modification et annulation d’un séjour', ['amender le séjour (service)', 'annuler avec motif'], 'v2 ; annule ; parcours patient cohérent', async () => {
    const a = await api('adm', 'POST', `/dsn/elements/${X.sej2}/action`, { action: 'amender', motif: 'Changement de service', donnees: { service: 'Chirurgie' } });
    const b = await api('adm', 'POST', `/dsn/elements/${a.d.id}/action`, { action: 'annuler', motif: 'Admission annulée (fictif)' });
    const p = (await q('SELECT parcours FROM patients WHERE id = $1', [X.p2]))[0].parcours;
    return ok(a.d.version === 2 && b.d.statut === 'annule' && p !== 'hospitalise', `amendement v${a.d.version} ; annulation ${b.d.statut} ; parcours du patient après annulation : ${p}`, 'Après annulation du séjour, le patient reste « hospitalisé » (parcours non recalculé)', 'moyenne');
  });

  // ===================== 3. SORTIES ET TRANSFERTS
  await cas('ST-01', 'Sorties et transferts', 'Préparer la sortie (fonction sortie) avec destination et synthèse', ['action sortie sur le séjour'], 'sortie_preparee', async () => {
    const r = await api('sor', 'POST', `/dsn/elements/${X.sej}/action`, { action: 'sortie', donnees: { destination: 'CHSLD des Érables', synthese: 'Synthèse fictive', consignes: 'Consignes fictives' } });
    return ok(r.d.statut === 'sortie_preparee', `statut ${r.s} ${r.d.statut || r.d.code}`, 'Sortie non préparée', 'moyenne');
  });
  await cas('ST-02', 'Sorties et transferts', 'Transition vers un partenaire : création, validation (figée), envoi', ['créer (médecin) avec allergie + prescription', 'envoyer avant validation', 'valider', 'envoyer'], '200 ; 409 ; valide ; envoye', async () => {
    const el = (await q("SELECT id FROM dsn_elements WHERE patient_id = $1 AND remplace_par IS NULL AND genre IN ('prescription', 'diagnostic') AND statut <> 'annule'", [X.p])).map((r) => r.id);
    const t = await api('med', 'POST', `/dsn/patients/${X.p}/transitions`, { destination_id: E['CHSLD-ERA'], elements: el, sejour_id: X.sej, note_transition: 'Note fictive' }); X.t = t.d.id;
    const e0 = await api('med', 'POST', `/dsn/transitions/${X.t}/envoyer`, {}); const v = await api('med', 'POST', `/dsn/transitions/${X.t}/valider`); const e = await api('med', 'POST', `/dsn/transitions/${X.t}/envoyer`, {});
    return ok(t.s === 200 && e0.s === 409 && v.d.statut === 'valide' && e.d.statut === 'envoye', `${t.s} ; ${e0.s} ; ${v.d.statut} ; ${e.d.statut}`, 'Cycle de transition défaillant', 'haute');
  });
  await cas('ST-03', 'Sorties et transferts', 'Une demande de transfert (ou d’hébergement) Arrimo est générée par la transition', ['lire transferts et demandes_hebergement liés'], 'Une demande dans le module Transferts ou Demandes d’hébergement, sans ressaisie', async () => {
    const ref = (await q('SELECT reference FROM patients WHERE id = $1', [X.p]))[0].reference;
    const tr = await q('SELECT count(*)::int n FROM transferts WHERE patient_ref = $1', [ref]).catch(() => [{ n: 'table ?' }]); const dh = await q('SELECT count(*)::int n FROM demandes_hebergement WHERE reference_externe = $1', [ref]).catch(() => [{ n: 'table ?' }]);
    return ok(tr[0].n > 0 || dh[0].n > 0, `transferts : ${tr[0].n} ; demandes d’hébergement : ${dh[0].n}`, 'La transition DSN ne crée ni transfert ni demande d’hébergement : la destination doit ressaisir dans les modules opérationnels (parcours en double)', 'haute');
  });
  await cas('ST-04', 'Sorties et transferts', 'Réception par le destinataire : avis sans contenu clinique, paquet seul visible', ['notifications du CHSLD', 'GET transitions reçues (Érables)', 'GET dossier source (Érables)'], 'Avis présent sans clinique ; paquet = éléments choisis ; dossier source 404', async () => {
    const n = await q("SELECT message FROM notifications WHERE etablissement_id = $1 AND code = 'dsn_transition' ORDER BY id DESC LIMIT 1", [E['CHSLD-ERA']]);
    const r = await api('era', 'GET', `/dsn/transitions/recues?etablissement_id=${E['CHSLD-ERA']}`); const t = (r.d || []).find((x) => x.id === X.t); const s = await api('era', 'GET', `/dsn/patients/${X.p}`);
    const clin = /Pneumonie|Produit fictif|Arachides/.test(n[0]?.message || '');
    return ok(n.length && !clin && t && t.contenu.elements.length >= 1 && !JSON.stringify(t.contenu).includes('Arachides') && s.s === 404, `avis : « ${n[0]?.message} » ; paquet : ${t?.contenu.elements.map((x) => x.genre).join(', ')} ; dossier source ${s.s}`, 'Réception non conforme', 'critique');
  });
  await cas('ST-05', 'Sorties et transferts', 'Refus motivé, puis nouvelle transition acceptée et reçue ; ordre imposé', ['réception avant acceptation', 'refus sans motif', 'refus motivé', 'nouvelle transition', 'accepter', 'accepter deux fois', 'réception'], '409 ; 400 ; refuse ; accepte ; 409 ; recu', async () => {
    const a = await api('era', 'POST', `/dsn/transitions/${X.t}/decision`, { decision: 'reception' }); const b = await api('era', 'POST', `/dsn/transitions/${X.t}/decision`, { decision: 'refuser' });
    const c = await api('era', 'POST', `/dsn/transitions/${X.t}/decision`, { decision: 'refuser', motif: 'Pas de place adaptée (fictif)' });
    const el = (await q("SELECT id FROM dsn_elements WHERE patient_id = $1 AND remplace_par IS NULL AND genre = 'prescription'", [X.p])).map((r) => r.id);
    const t2 = await api('med', 'POST', `/dsn/patients/${X.p}/transitions`, { destination_id: E['CHSLD-ERA'], elements: el, sejour_id: X.sej }); X.t2 = t2.d.id;
    await api('med', 'POST', `/dsn/transitions/${X.t2}/valider`); await api('med', 'POST', `/dsn/transitions/${X.t2}/envoyer`, {});
    const d = await api('era', 'POST', `/dsn/transitions/${X.t2}/decision`, { decision: 'accepter', arrivee_prevue_le: new Date(Date.now() + 86400000).toISOString() }); const d2 = await api('era', 'POST', `/dsn/transitions/${X.t2}/decision`, { decision: 'accepter' });
    const e = await api('era', 'POST', `/dsn/transitions/${X.t2}/decision`, { decision: 'reception' });
    return ok(a.s === 409 && b.s === 400 && c.d.statut === 'refuse' && d.d.statut === 'accepte' && d2.s === 409 && e.d.statut === 'recu', `${a.s} ; ${b.s} ; ${c.d.statut} ; ${d.d.statut} ; ${d2.s} ; ${e.d.statut}`, 'Décisions de transition non conformes', 'haute');
  });
  await cas('ST-06', 'Sorties et transferts', 'Avis à l’origine après refus / acceptation', ['notifications de l’Hôpital B'], 'L’Hôpital B est avisé du refus et de l’acceptation', async () => {
    const n = await q("SELECT code, message FROM notifications WHERE etablissement_id = $1 AND (message ILIKE '%TRX-%' OR code ILIKE 'dsn%') ORDER BY id DESC LIMIT 5", [E.HY]);
    return ok(n.length >= 2, `${n.length} avis : ${n.map((x) => x.code).join(', ') || 'aucun'}`, 'L’établissement d’origine n’est pas avisé de la décision (refus ou acceptation) du destinataire ; il doit surveiller l’écran', 'moyenne');
  });
  await cas('ST-07', 'Sorties et transferts', 'Départ, arrivée, clôture : Horloge et Sillage', ['horodatages de la transition', 'GET /sillage?objet=dsn_transition', 'chronologie du dossier'], 'demande, décision, départ, arrivée ; Sillage lisible par l’origine et la destination', async () => {
    const h = (await q("SELECT etape FROM horodatages WHERE objet = 'dsn_transition' AND objet_id = $1 ORDER BY heure", [X.t2])).map((x) => x.etape);
    const s1 = await api('med', 'GET', `/sillage?objet=dsn_transition&id=${X.t2}`); const s2 = await api('era', 'GET', `/sillage?objet=dsn_transition&id=${X.t2}`);
    const ch = (await api('med', 'GET', `/dsn/patients/${X.p}`)).d.chronologie.filter((x) => x.genre === 'transition').map((x) => x.statut);
    return ok(h.includes('demande') && h.includes('decision') && h.includes('arrivee') && h.includes('depart') && s1.s === 200 && s2.s === 200, `Horloge : ${h.join(' → ')} ; Sillage origine ${s1.s}, destination ${s2.s} ; chronologie DSN : ${ch.join(', ')}`, h.includes('depart') ? 'Sillage non lisible' : 'Aucune étape « départ » : le départ réel du patient n’est jamais enregistré pour une transition DSN', 'moyenne');
  });
  await cas('ST-08', 'Sorties et transferts', 'Le destinataire ouvre son propre dossier depuis le paquet ; pas de doublon si on recommence', ['ouvrir le dossier (Érables) deux fois'], '1er : patient créé ; 2e : refus ou même patient', async () => {
    const a = await api('era', 'POST', `/dsn/transitions/${X.t2}/dossier`); const b = await api('era', 'POST', `/dsn/transitions/${X.t2}/dossier`);
    const n = await q("SELECT count(*)::int n FROM patients WHERE etablissement_id = $1 AND nom = 'Démo-Test'", [E['CHSLD-ERA']]);
    return ok(a.s === 200 && n[0].n === 1, `1er ${a.s} ; 2e ${b.s} ; dossiers créés aux Érables : ${n[0].n}`, 'Ouvrir deux fois le dossier depuis le même paquet crée deux patients (doublon)', 'haute');
  });

  // ===================== 4. PARTENAIRES ET 5. TRANSPORT
  await cas('PA-01', 'Partenaires', 'Hôpital A (sans DSN) destinataire : reçoit seulement le paquet', ['transition vers Hôpital A', 'GET transitions reçues (hopital.a)', 'GET dossier source (hopital.a)'], 'Paquet visible ; dossier 404', async () => {
    const el = (await q("SELECT id FROM dsn_elements WHERE patient_id = $1 AND remplace_par IS NULL AND genre = 'prescription'", [X.p])).map((r) => r.id);
    const t = await api('med', 'POST', `/dsn/patients/${X.p}/transitions`, { destination_id: E.HX, elements: el }); X.t3 = t.d.id; await api('med', 'POST', `/dsn/transitions/${X.t3}/valider`); await api('med', 'POST', `/dsn/transitions/${X.t3}/envoyer`, {});
    const r = await api('ha', 'GET', `/dsn/transitions/recues?etablissement_id=${E.HX}`); const s = await api('ha', 'GET', `/dsn/patients/${X.p}`);
    return ok(r.s === 200 && (r.d || []).some((x) => x.id === X.t3) && s.s === 404, `transitions reçues ${r.s} (${(r.d || []).length}) ; dossier source ${s.s}`, 'Partenaire sans DSN mal servi', 'moyenne');
  });
  await cas('PA-02', 'Partenaires', 'CCS et ambulance : aucun accès DSN', ['GET /dsn/* avec jetons ambulance et CCS'], '401/403 partout', async () => {
    const o = []; for (const k of ['amb', 'ccs', 'sup']) for (const c of [`/dsn/patients?etablissement_id=${E.HY}`, `/dsn/transitions/recues?etablissement_id=${E.HY}`, `/dsn/acces?etablissement_id=${E.HY}`]) o.push((await api(k, 'GET', c)).s);
    return ok(o.every((s) => [401, 403, 404].includes(s)), o.join(','), 'Accès DSN depuis les secours', 'critique');
  });
  await cas('TR-01', 'Transport', 'Envoi de transition avec transport : demande créée et préremplie (origine, destination, horaire, référence)', ['nouvelle transition validée', 'envoyer avec transport'], 'Une demande_transport liée, origine/destination/plage/référence corrects, statut « demandée » (pas d’unité affectée)', async () => {
    const el = (await q("SELECT id FROM dsn_elements WHERE patient_id = $1 AND remplace_par IS NULL AND genre = 'prescription'", [X.p])).map((r) => r.id);
    const t = await api('med', 'POST', `/dsn/patients/${X.p}/transitions`, { destination_id: E['CHSLD-ERA'], elements: el }); X.t4 = t.d.id; await api('med', 'POST', `/dsn/transitions/${X.t4}/valider`);
    const org = (await api('hb', 'GET', `/transports/organisations?etablissement_id=${E.HY}`)).d; X.org = Array.isArray(org) ? org[0]?.id : org?.organisations?.[0]?.id;
    const debut = new Date(Date.now() + 3 * 3600000); const fin = new Date(debut.getTime() + 3600000);
    const e = await api('med', 'POST', `/dsn/transitions/${X.t4}/envoyer`, { transport: { organisation_id: X.org, type_vehicule: 'ambulance', plage_debut: debut.toISOString(), plage_fin: fin.toISOString() } });
    X.dt = e.d.demande_transport_id; const d = X.dt ? (await q('SELECT numero, origine_id, destination_id, resident_ref, statut, unite_id, plage_debut FROM demandes_transport WHERE id = $1', [X.dt]))[0] : null;
    const ref = (await q('SELECT reference FROM patients WHERE id = $1', [X.p]))[0].reference;
    return ok(e.s === 200 && d && d.origine_id === E.HY && d.destination_id === E['CHSLD-ERA'] && d.resident_ref === ref && !d.unite_id && d.statut === 'demandee',
      `envoi ${e.s} ${e.d.code || ''} ; demande ${d ? `${d.numero} ${d.statut}, origine ${d.origine_id}, destination ${d.destination_id}, réf ${d.resident_ref}, unité ${d.unite_id || 'aucune'}` : 'aucune'}`,
      e.s !== 200 ? `L’envoi avec transport échoue (${e.d.code || e.s}) : la transition reste-t-elle « valide » ?` : 'Demande de transport absente ou mal préremplie', 'haute', d);
  });
  await cas('TR-02', 'Transport', 'Échec de la demande de transport : pas de transport orphelin, transition inchangée', ['envoyer avec une organisation invalide'], 'Refus ; transition toujours « valide » ; aucune demande créée', async () => {
    const el = (await q("SELECT id FROM dsn_elements WHERE patient_id = $1 AND remplace_par IS NULL AND genre = 'prescription'", [X.p])).map((r) => r.id);
    const t = await api('med', 'POST', `/dsn/patients/${X.p}/transitions`, { destination_id: E['CHSLD-STL'], elements: el }); X.t5 = t.d.id; await api('med', 'POST', `/dsn/transitions/${X.t5}/valider`);
    const avant = (await q('SELECT count(*)::int n FROM demandes_transport'))[0].n; const debut = new Date(Date.now() + 3 * 3600000);
    const e = await api('med', 'POST', `/dsn/transitions/${X.t5}/envoyer`, { transport: { organisation_id: 999999, type_vehicule: 'ambulance', plage_debut: debut.toISOString(), plage_fin: new Date(debut.getTime() + 3600000).toISOString() } });
    const apres = (await q('SELECT count(*)::int n FROM demandes_transport'))[0].n; const st = (await q('SELECT statut FROM dsn_transitions WHERE id = $1', [X.t5]))[0].statut;
    return ok(e.s >= 400 && apres === avant && st === 'valide', `envoi ${e.s} ${e.d.code || ''} ; demandes avant ${avant}, après ${apres} ; transition ${st}`, 'Incohérence après échec de la demande de transport', 'haute');
  });
  await cas('TR-03', 'Transport', 'Le répartiteur compétent reçoit la demande ; acceptation, affectation, suivi ; aucun doublon', ['liste ambulance', 'accepter avec unité', 'en route', 'pris en charge', 'arrivée'], 'Visible côté ambulance sans données cliniques ; statuts successifs ; une seule demande', async () => {
    if (!X.dt) return { statut: 'BLOQUÉ', obtenu: 'Pas de demande de transport (TR-01)' };
    const l = await api('amb', 'GET', '/secours/transports'); const vue = (l.d || []).find((x) => x.id === X.dt); const clin = /Pneumonie|Produit fictif|Arachides|prescription/i.test(JSON.stringify(vue || {}));
    const un = (await api('amb', 'GET', '/secours/unites')).d?.[0]?.id; const st = [];
    for (const a of ['accepter', 'en_route', 'pris_en_charge', 'arrivee']) { const v = (await q('SELECT version FROM demandes_transport WHERE id = $1', [X.dt]))[0].version; const r = await api('amb', 'POST', `/secours/transports/${X.dt}/action`, { action: a, version: v, unite_id: un }); st.push(`${a}:${r.s}`); }
    const n = (await q("SELECT count(*)::int n FROM demandes_transport WHERE resident_ref = (SELECT reference FROM patients WHERE id = $1) AND statut <> 'annulee'", [X.p]))[0].n;
    return ok(vue && !clin && st.every((x) => x.endsWith(':200')) && n === 1, `vue ambulance : ${vue ? 'oui' : 'non'}, données cliniques : ${clin ? 'OUI' : 'aucune'} ; ${st.join(' ')} ; demandes actives pour ce patient : ${n}`, 'Cycle transport défaillant', 'haute');
  });
  await cas('TR-04', 'Transport', 'Synchronisation des statuts transport ↔ DSN ↔ Sillage', ['dossier DSN (transitions)', 'Sillage de la transition'], 'Le DSN montre l’état du transport (accepté, en route, arrivé) ; Sillage relie transition et transport', async () => {
    const d = (await api('med', 'GET', `/dsn/patients/${X.p}`)).d; const t = d.transitions.find((x) => x.id === X.t4);
    const s = await api('med', 'GET', `/sillage?objet=dsn_transition&id=${X.t4}`); const lie = JSON.stringify(s.d).includes('demande_transport') || JSON.stringify(s.d).includes('DT-');
    const st = (await q('SELECT statut FROM dsn_transitions WHERE id = $1', [X.t4]))[0].statut;
    return ok(t && ('transport' in t || 'transport_statut' in t) && lie, `transition dans le DSN : ${JSON.stringify(t).slice(0, 160)} ; Sillage relie le transport : ${lie} ; statut transition après arrivée du transport : ${st}`,
      'Le DSN n’affiche pas le statut du transport lié et la transition reste « envoyée » après l’arrivée réelle ; Sillage ne relie pas la transition à son transport', 'haute');
  });
  await cas('TR-05', 'Transport', 'Double envoi (clic répété / reprise réseau) : une seule demande de transport', ['renvoyer la même transition avec transport'], '409 ; pas de seconde demande', async () => {
    const avant = (await q('SELECT count(*)::int n FROM demandes_transport'))[0].n; const debut = new Date(Date.now() + 3 * 3600000);
    const e = await api('med', 'POST', `/dsn/transitions/${X.t4}/envoyer`, { transport: { organisation_id: X.org, type_vehicule: 'ambulance', plage_debut: debut.toISOString(), plage_fin: new Date(debut.getTime() + 3600000).toISOString() } });
    const apres = (await q('SELECT count(*)::int n FROM demandes_transport'))[0].n;
    return ok(e.s === 409 && apres === avant, `renvoi ${e.s} ; demandes avant ${avant}, après ${apres}`, 'Double envoi crée une seconde demande de transport', 'critique');
  });
  await cas('TR-06', 'Transport', 'Envois simultanés de la même transition (course)', ['2 envois en parallèle avec transport'], 'Une seule demande créée', async () => {
    const el = (await q("SELECT id FROM dsn_elements WHERE patient_id = $1 AND remplace_par IS NULL AND genre = 'prescription'", [X.p])).map((r) => r.id);
    const t = await api('med', 'POST', `/dsn/patients/${X.p}/transitions`, { destination_id: E['CHSLD-ERA'], elements: el }); await api('med', 'POST', `/dsn/transitions/${t.d.id}/valider`);
    const avant = (await q('SELECT count(*)::int n FROM demandes_transport'))[0].n; const debut = new Date(Date.now() + 4 * 3600000);
    const corps = { transport: { organisation_id: X.org, type_vehicule: 'ambulance', plage_debut: debut.toISOString(), plage_fin: new Date(debut.getTime() + 3600000).toISOString() } };
    const r = await Promise.all([api('med', 'POST', `/dsn/transitions/${t.d.id}/envoyer`, corps), api('med', 'POST', `/dsn/transitions/${t.d.id}/envoyer`, corps)]);
    const apres = (await q('SELECT count(*)::int n FROM demandes_transport'))[0].n;
    return ok(apres - avant === 1, `réponses ${r.map((x) => x.s).join(' / ')} ; demandes créées : ${apres - avant}`, 'Deux envois simultanés créent deux demandes de transport (la demande est créée hors transaction, avant le contrôle du statut)', 'haute');
  });

  // ===================== 6. TRANSITIONS REÇUES
  await cas('TRR-01', 'Transitions reçues', 'Seul le destinataire voit le paquet ; rôle entretien refusé ; autre établissement refusé', ['Saint-Laurent lit les reçues des Érables', 'entretien des Érables', 'Saint-Laurent décide sur une transition des Érables'], '403 ; 403 ; 404', async () => {
    const a = await api('stl', 'GET', `/dsn/transitions/recues?etablissement_id=${E['CHSLD-ERA']}`); const b = await api('ent', 'GET', `/dsn/transitions/recues?etablissement_id=${E['CHSLD-ERA']}`);
    const c = await api('stl', 'POST', `/dsn/transitions/${X.t4}/decision`, { decision: 'accepter' });
    return ok(a.s === 403 && b.s === 403 && c.s === 404, `${a.s} ; ${b.s} ; ${c.s}`, 'Paquet visible par un acteur non autorisé', 'critique');
  });
  await cas('TRR-02', 'Transitions reçues', 'Admission/sortie/transfert émis par un module opérationnel (Transferts, NSA, Liaison CHSLD) reçu dans le DSN', ['transfert inter-hôpitaux existant', 'dossier DSN correspondant'], 'Le DSN reçoit l’événement (séjour/sortie) du module émetteur', async () => {
    const n = (await q("SELECT count(*)::int n FROM dsn_elements WHERE source IS NOT NULL AND source <> 'transition'"))[0].n;
    return { statut: 'ÉCHEC', obtenu: `aucun lien : les admissions, sorties et transferts des modules Lits/Transferts/NSA/Liaison ne créent aucun élément DSN (éléments d’autre source : ${n})`, anomalie: 'Pas de réception dans le DSN des événements des autres modules (seuls les paquets DSN→DSN existent)', gravite: 'haute' };
  });
  await cas('TRR-03', 'Transitions reçues', 'Messages ADT dans le désordre / en double (connecteur)', ['lecture des tests connecteur existants'], 'Idempotence et ordre gérés', async () => ({ statut: 'NON TESTÉ', obtenu: 'Le connecteur HL7 (A01…A22) alimente Lits et Civières, pas le DSN clinique ; aucun flux entrant vers le DSN à tester. Idempotence du connecteur déjà couverte par tests/dsn.test.cjs (hors périmètre DSN clinique).' }));

  // ===================== 7. SÉCURITÉ
  await cas('SEC-01', 'Sécurité', 'DSN refusé hors démo/recette (serveur en mode « pilote » sur la même copie)', ['connexion hopital.b sur 3098', 'GET /dsn/patients', 'GET /dsn/transitions/recues'], '403 dsn_reserve_demo partout', async () => {
    const c = await connecter('v', 'hopital.b@demo.arrimo', BV); if (!tok.v) return { statut: 'BLOQUÉ', obtenu: `connexion en mode pilote : ${c} (double authentification exigée ?)` };
    const a = await api('v', 'GET', `/dsn/patients?etablissement_id=${E.HY}`, null, { base: BV }); const b = await api('v', 'GET', `/dsn/transitions/recues?etablissement_id=${E['CHSLD-ERA']}`, null, { base: BV }); const p = await fetch(`${BV.replace('/api', '')}/dsn/`).then((r) => r.status);
    return ok(a.d.code === 'dsn_reserve_demo' && [403].includes(b.s), `patients ${a.s} ${a.d.code} ; reçues ${b.s} ${b.d.code} ; page /dsn ${p}`, 'DSN accessible hors démo', 'critique');
  });
  await cas('SEC-02', 'Sécurité', 'Appels directs sans jeton, jeton falsifié, identifiants devinés', ['sans jeton', 'jeton falsifié', 'élément d’un autre patient via action'], '401 ; 401 ; 403/404', async () => {
    const a = (await fetch(`${B}/dsn/patients?etablissement_id=${E.HY}`)).status; const b = (await fetch(`${B}/dsn/patients?etablissement_id=${E.HY}`, { headers: { Authorization: 'Bearer faux.jeton.x' } })).status;
    const el = (await q("SELECT id FROM dsn_elements WHERE patient_id <> $1 AND etablissement_id = $2 LIMIT 1", [X.p, E.HY]))[0].id; const c = await api('ha', 'POST', `/dsn/elements/${el}/action`, { action: 'annuler', motif: 'Tentative non autorisée' });
    return ok(a === 401 && b === 401 && [403, 404].includes(c.s), `${a} ; ${b} ; ${c.s}`, 'API DSN exposée', 'critique');
  });
  await cas('SEC-03', 'Sécurité', 'Messages d’erreur en anglais (X-Langue: en)', ['GET dossier interdit en EN'], 'Message anglais', async () => {
    const r = await api('ha', 'GET', `/dsn/patients?etablissement_id=${E.HY}`, null, { langue: 'en' });
    return ok(/[a-z]/.test(r.d.erreur || '') && !/établissement|Vous/.test(r.d.erreur || ''), `${r.s} « ${r.d.erreur} » (code ${r.d.code})`, 'Constat général (pas propre au DSN) : les messages d’erreur du serveur restent en français ; l’interface DSN traduit les refus principaux par leur code', 'faible');
  });
  await cas('SEC-04', 'Sécurité', 'Notifications et journal général sans donnée clinique', ['recherche de termes cliniques dans notifications et journal'], 'Aucun terme clinique', async () => {
    const n = await q("SELECT count(*)::int n FROM notifications WHERE message ~* '(Arachides|Pneumonie|Produit fictif|Radiographie)'"); const j = await q("SELECT count(*)::int n FROM journal WHERE detail ~* '(Arachides|Pneumonie|Produit fictif|Radiographie)'");
    return ok(n[0].n === 0 && j[0].n === 0, `notifications : ${n[0].n} ; journal : ${j[0].n}`, 'Donnée clinique dans un canal non clinique', 'critique');
  });

  fs.writeFileSync(path.join(OUT, 'resultats.json'), JSON.stringify(res, null, 1));
  const c = res.reduce((a, r) => ({ ...a, [r.statut]: (a[r.statut] || 0) + 1 }), {}); console.log('\nBILAN', JSON.stringify(c));
  await db.end();
})().catch((e) => { console.error('ARRÊT', e); process.exit(1); });
