'use strict';
/**
 * Garantie de continuité (cahier v2, C.11 ; 20 nov. 2026) : export COMPLET des données d'un établissement client, pour la portabilité
 * (Loi 25) et en cas d'arrêt du service. Archive ZIP : un CSV par table, un JSON complet, un LISEZMOI qui décrit chaque colonne
 * (dictionnaire tiré de la base et des commentaires de db/schema.sql).
 * Contenu : tout ce qui appartient à l'établissement, trouvé en suivant les clés étrangères depuis « etablissements » ;
 * JAMAIS les empreintes de mot de passe, clés, jetons ni secrets (colonnes et tables exclues, contrôlé par les tests).
 */
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const { zip } = require('./zip');

// Tables de sessions et de secrets : jamais exportées
const TABLES_EXCLUES = new Set(['sessions', 'connexions_2fa', 'jetons_mdp', 'remises_secrets', 'proches_sessions', 'proches_comptes_sessions', 'proches_codes_rattachement', 'webhook_livraisons']);
// Colonnes secrètes : retirées partout
const COLONNE_SECRETE = /(mot_de_passe|hash|secret|jeton|token|totp|cle_|_cle$|^cle$|empreinte|signature|mfa|code_rattachement|api_key)/i;
// Colonnes qui rattachent une ligne à un établissement (filtre direct)
const LIENS_DIRECTS = ['etablissement_id', 'origine_id', 'destination_id', 'hopital_id'];

/** Commentaire (ligne « -- … » juste avant le CREATE TABLE) de chaque table, depuis db/schema.sql. */
function commentaires() {
  const lignes = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8').split('\n'); const c = {};
  lignes.forEach((l, i) => { const m = l.match(/^CREATE TABLE IF NOT EXISTS ([a-z_0-9]+)/); if (m && /^--/.test(lignes[i - 1] || '')) c[m[1]] = lignes[i - 1].replace(/^--\s*/, ''); });
  return c;
}
async function catalogue(db) {
  const cols = (await db.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema()
    AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) ORDER BY table_name, ordinal_position`)).rows;
  const fks = (await db.query(`SELECT tc.table_name, kcu.column_name, ccu.table_name AS cible FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema()`)).rows;
  const tables = {};
  for (const c of cols) (tables[c.table_name] || (tables[c.table_name] = [])).push({ nom: c.column_name, type: c.data_type });
  return { tables, fks };
}
const ident = (x) => `"${String(x).replace(/"/g, '""')}"`;

/**
 * Lignes de l'établissement, table par table : lien direct (colonne d'établissement), puis tables filles par clé étrangère
 * (profondeur 3). Une ligne partagée (transfert entre deux établissements) appartient aux deux.
 */
async function exporter(db, etabId) {
  const { tables, fks } = await catalogue(db);
  const filtres = { etablissements: `id = ${Number(etabId)}` };
  for (const [t, cs] of Object.entries(tables)) {
    if (TABLES_EXCLUES.has(t) || t === 'etablissements') continue;
    const liens = cs.map((c) => c.nom).filter((n) => LIENS_DIRECTS.includes(n) && fks.some((f) => f.table_name === t && f.column_name === n && f.cible === 'etablissements'));
    if (liens.length) filtres[t] = liens.map((n) => `${ident(n)} = ${Number(etabId)}`).join(' OR ');
  }
  // Tables filles : une ligne appartient à l'établissement si l'UNE de ses clés étrangères vise une ligne qui lui appartient (OU)
  const directs = new Set(Object.keys(filtres));
  for (let profondeur = 0; profondeur < 3; profondeur += 1) {
    const ajouts = {};
    for (const f of fks) {
      if (directs.has(f.table_name) || TABLES_EXCLUES.has(f.table_name) || !filtres[f.cible] || f.cible === 'etablissements' || f.cible === 'utilisateurs' || f.cible === f.table_name) continue;
      (ajouts[f.table_name] || (ajouts[f.table_name] = new Set())).add(`${ident(f.column_name)} IN (SELECT id FROM ${ident(f.cible)} WHERE ${filtres[f.cible]})`);
    }
    for (const [t, conds] of Object.entries(ajouts)) filtres[t] = [...conds].map((x) => `(${x})`).join(' OR ');
  }
  // Comptes de l'établissement (sans aucun secret)
  filtres.utilisateurs = `id IN (SELECT utilisateur_id FROM utilisateur_etablissements WHERE etablissement_id = ${Number(etabId)})`;
  const donnees = {}; const dictionnaire = {};
  for (const [t, where] of Object.entries(filtres)) {
    const visibles = (tables[t] || []).filter((c) => !COLONNE_SECRETE.test(c.nom));
    if (!visibles.length) continue;
    donnees[t] = (await db.query(`SELECT ${visibles.map((c) => ident(c.nom)).join(', ')} FROM ${ident(t)} WHERE ${where}`)).rows;
    dictionnaire[t] = visibles;
  }
  return { donnees, dictionnaire };
}
const csvChamp = (v) => { const s = v == null ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Archive ZIP complète de l'établissement : { nom, octets, taille, sha256, tables, lignes }. */
async function archive(db, etabId) {
  const e = (await db.query('SELECT id, code, nom FROM etablissements WHERE id = $1', [etabId])).rows[0];
  const { donnees, dictionnaire } = await exporter(db, etabId);
  const com = commentaires(); const fichiers = {};
  for (const [t, rows] of Object.entries(donnees)) {
    const cols = dictionnaire[t].map((c) => c.nom);
    fichiers[`csv/${t}.csv`] = `﻿${[cols.join(';'), ...rows.map((r) => cols.map((c) => csvChamp(r[c])).join(';'))].join('\r\n')}\r\n`;
  }
  fichiers['donnees.json'] = JSON.stringify({ etablissement: e, genere_le: new Date().toISOString(), tables: donnees }, null, 1);
  fichiers.LISEZMOI = [`Export complet des données de ${e.nom} (${e.code}), généré le ${new Date().toISOString()}.`,
    'Un fichier CSV par table (séparateur « ; », UTF-8) et le même contenu en JSON (donnees.json).',
    'Exclus : empreintes de mot de passe, clés, jetons, secrets de connexion, sessions.', '',
    'DICTIONNAIRE DES DONNÉES', ...Object.entries(dictionnaire).map(([t, cs]) => `\n${t}${com[t] ? ` — ${com[t]}` : ''} (${donnees[t].length} lignes)\n${cs.map((c) => `  ${c.nom} : ${c.type}`).join('\n')}`)].join('\n');
  const octets = zip(fichiers);
  return { nom: `arrimo-export-${e.code}-${new Date().toISOString().slice(0, 10)}.zip`, octets, taille: octets.length, sha256: crypto.createHash('sha256').update(octets).digest('hex'),
    tables: Object.keys(donnees).length, lignes: Object.values(donnees).reduce((s, r) => s + r.length, 0) };
}
module.exports = { exporter, archive, TABLES_EXCLUES, COLONNE_SECRETE };
