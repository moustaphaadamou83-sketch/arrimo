'use strict';
/**
 * Rapports (27 nov. 2026) : export Excel des tableaux AFFICHÉS dans Performance (mêmes chiffres qu'à l'écran), avec en-tête
 * (organisation, titre, date de génération, mention de confidentialité). Réutilise le générateur XLSX existant (src/sh/xlsx.js) :
 * aucun moteur analytique parallèle, aucun calcul. Chaque export est journalisé (sans son contenu). Entretien exclu.
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const { journaliser } = require('./regles');
const { xlsxDepuisLignes } = require('./sh/xlsx');

const MAX_LIGNES = 5000; const MAX_COLONNES = 100; const MAX_CELLULE = 2000;

async function excel(pool, u, b) {
  const etabId = Number(b?.etablissement_id); if (!Number.isInteger(etabId)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, etabId);
  if (u.role === 'entretien') throw new ErreurHttp(403, 'role_insuffisant');
  const titre = String(b.titre || 'Rapport').slice(0, 120);
  const lignes = Array.isArray(b.lignes) ? b.lignes : null;
  if (!lignes || lignes.length > MAX_LIGNES || lignes.some((l) => !Array.isArray(l) || l.length > MAX_COLONNES)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'lignes' });
  const e = (await pool.query('SELECT nom FROM etablissements WHERE id = $1', [etabId])).rows[0];
  const en = b.langue === 'en';
  // Une cellule commençant par = + - @ est préfixée : jamais interprétée comme une formule par le tableur
  const sur = (v) => { const s = String(v ?? '').slice(0, MAX_CELLULE); return /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s; };
  const entete = [[`Arrimo — ${titre}`], [en ? 'Organisation' : 'Organisation', e?.nom || ''], [en ? 'Generated' : 'Généré le', new Date().toISOString()],
    [en ? 'Confidential: internal use, authorised recipients only.' : 'Confidentiel : usage interne, destinataires autorisés seulement.'], []];
  const fichier = xlsxDepuisLignes([...entete, ...lignes.map((l) => l.map(sur))]);
  await journaliser(pool, { etablissementId: etabId, utilisateurId: u.id, action: 'Export Excel', detail: `${titre} · ${lignes.length} ligne(s)` });
  return { fichier, nom: `arrimo-${titre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'rapport'}.xlsx` };
}
module.exports = { excel, MAX_LIGNES };
