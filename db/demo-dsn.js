'use strict';
/**
 * Démo seulement (décision de Moustafa, 22 nov. 2026) : DSN clinique à l'Hôpital B — Mont-Clair, patients ENTIÈREMENT SYNTHÉTIQUES.
 * - Module « dsn » activé pour l'Hôpital B et le CHSLD des Érables (qui reçoit les paquets de transition).
 * - Comptes par fonction à l'Hôpital B (même mot de passe que les autres comptes de démo, copie du hachage de hopital.b) :
 *   dsn.admission / dsn.infirmier / dsn.medecin / dsn.sortie / dsn.auditeur @demo.arrimo, habilités pour leur seule fonction.
 * - 10 patients « DEMO » avec allergies, antécédents, séjour, observations, note signée, prescription SIMULÉE validée ;
 *   une transition validée et envoyée vers le CHSLD des Érables. Rien n'est réel ; rien n'est envoyé à l'extérieur.
 * Rejouable : ne refait rien si les comptes existent. Refusé hors démo.
 */
const { creerPool } = require('../src/db');
if (process.env.ARRIMO_ENV !== 'demo') { console.error('Refusé : démonstration seulement.'); process.exit(1); }
const FONCTIONS = [['admission', 'coordonnateur'], ['infirmier', 'equipe_soins'], ['medecin', 'equipe_soins'], ['sortie', 'coordonnateur'], ['auditeur', 'coordonnateur']];
const PATIENTS = [['Alice', 'Démo-Arsenault', '1941-02-11'], ['Bernard', 'Démo-Bélanger', '1938-07-30'], ['Chantal', 'Démo-Côté', '1950-11-04'], ['Daniel', 'Démo-Dion', '1946-05-19'],
  ['Élise', 'Démo-Émond', '1943-09-23'], ['François', 'Démo-Fortin', '1952-01-08'], ['Gisèle', 'Démo-Gagnon', '1939-12-15'], ['Henri', 'Démo-Hébert', '1948-03-27'],
  ['Irène', 'Démo-Isabelle', '1955-06-02'], ['Jacques', 'Démo-Jolicoeur', '1944-10-10']];
const ALLERGIES = ['Pénicilline (fictif)', 'Arachides (fictif)', 'Latex (fictif)', 'Sulfamides (fictif)', 'Iode (fictif)'];
const ANTECEDENTS = ['Hypertension (fictif)', 'Diabète de type 2 (fictif)', 'Fracture de la hanche (fictif)', 'Insuffisance cardiaque (fictif)', 'MPOC (fictif)'];
(async () => {
  const pool = creerPool(process.env.DATABASE_URL); const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if ((await c.query("SELECT 1 FROM utilisateurs WHERE email = 'dsn.medecin@demo.arrimo'")).rowCount) { console.log('Déjà en place'); await c.query('ROLLBACK'); return; }
    const hb = (await c.query("SELECT id FROM etablissements WHERE code = 'HY'")).rows[0].id;
    const era = (await c.query("SELECT id FROM etablissements WHERE code = 'CHSLD-ERA'")).rows[0].id;
    await c.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"dsn": true}' WHERE id = ANY($1)`, [[hb, era]]);
    const hash = (await c.query("SELECT mot_de_passe_hash FROM utilisateurs WHERE email = 'hopital.b@demo.arrimo'")).rows[0].mot_de_passe_hash;
    const u = {};
    for (const [f, role] of FONCTIONS) {
      u[f] = (await c.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [`dsn.${f}@demo.arrimo`, `DSN ${f} (démo)`, hash, role])).rows[0].id;
      await c.query('INSERT INTO utilisateur_etablissements (utilisateur_id, etablissement_id) VALUES ($1, $2)', [u[f], hb]);
      await c.query('INSERT INTO dsn_habilitations (etablissement_id, utilisateur_id, fonction) VALUES ($1, $2, $3)', [hb, u[f], f]);
    }
    const num = async (p) => `${p}-${String((await c.query("SELECT nextval('dsn_numero_seq') AS n")).rows[0].n).padStart(6, '0')}`;
    const el = async (pid, genre, donnees, statut, auteur, extra = {}) => (await c.query(`INSERT INTO dsn_elements (numero, patient_id, etablissement_id, genre, rencontre_id, donnees, statut, auteur_id, signe_par, signe_le)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`, [await num('DSN'), pid, hb, genre, extra.rencontre || null, JSON.stringify(donnees), statut, auteur, extra.signe ? auteur : null, extra.signe ? new Date() : null])).rows[0].id;
    let premier = null;
    for (const [i, [prenom, nom, dn]] of PATIENTS.entries()) {
      const p = (await c.query(`INSERT INTO patients (etablissement_id, reference, prenom, nom, date_naissance, parcours, cree_par, arrivee_le)
        VALUES ($1, 'P-' || lpad(nextval('patient_seq')::text, 5, '0'), $2, $3, $4, 'hospitalise', $5, now() - ($6 || ' days')::interval) RETURNING id, reference`, [hb, prenom, nom, dn, u.admission, String(2 + i)])).rows[0];
      const al = await el(p.id, 'allergie', { substance: ALLERGIES[i % 5], gravite: i % 3 === 0 ? 'severe' : 'moderee', verification: 'confirmee' }, 'actif', u.infirmier);
      await el(p.id, 'antecedent', { libelle: ANTECEDENTS[i % 5], type: 'medical' }, 'actif', u.medecin);
      const ren = await el(p.id, 'rencontre', { type: 'hospitalisation', motif: 'Séjour de démonstration (fictif)', equipe: 'Médecine' }, 'ouverte', u.admission);
      const sej = await el(p.id, 'sejour', { service: 'Médecine', lit: `MED-2${String(10 + i)}` }, 'en_cours', u.admission);
      await el(p.id, 'observation', { type: 'ta', valeur: `${120 + i}/${75 + (i % 4)}`, unite: 'mmHg' }, 'finale', u.infirmier);
      await el(p.id, 'observation', { type: 'temperature', valeur: (36.6 + (i % 4) / 10).toFixed(1), unite: '°C' }, 'finale', u.infirmier);
      await el(p.id, 'note', { titre: 'Note d’évolution (fictive)', texte: 'Patient synthétique de démonstration. Aucune donnée réelle.' }, 'signee', u.infirmier, { rencontre: ren, signe: true });
      const rx = await el(p.id, 'prescription', { substance: 'Produit fictif A', dose: '1 comprimé', voie: 'orale', frequence: 'matin et soir', duree: '7 jours', indication: 'Démonstration' }, 'validee', u.medecin, { signe: true });
      await el(p.id, 'diagnostic', { libelle: 'Diagnostic fictif de démonstration', certitude: 'provisoire' }, 'actif', u.medecin);
      if (i === 0) premier = { p, al, rx, sej };
    }
    // Une transition validée et envoyée : Hôpital B → CHSLD des Érables (paquet figé : identité + allergie + prescription simulée)
    const pr = (await c.query('SELECT reference, prenom, nom, date_naissance::text AS date_naissance FROM patients WHERE id = $1', [premier.p.id])).rows[0];
    const contenus = (await c.query('SELECT genre, numero, donnees, statut, cree_le FROM dsn_elements WHERE id = ANY($1)', [[premier.al, premier.rx]])).rows;
    const t = (await c.query(`INSERT INTO dsn_transitions (numero, patient_id, etablissement_id, destination_id, sejour_id, elements, contenu, statut, cree_par, valide_par, valide_le, envoye_le)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'envoye', $8, $8, now() - interval '2 hours', now() - interval '90 minutes') RETURNING id, numero`,
    [await num('TRX'), premier.p.id, hb, era, premier.sej, [premier.al, premier.rx], JSON.stringify({ note_transition: 'Consignes de transition fictives.', patient: pr, elements: contenus, fige_le: new Date().toISOString() }), u.medecin])).rows[0];
    await c.query("INSERT INTO horodatages (objet, objet_id, etape, heure, source, auteur_id) VALUES ('dsn_transition', $1, 'demande', now() - interval '90 minutes', 'clic', $2)", [t.id, u.medecin]);
    await c.query("INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, NULL, 'Démo : DSN préparé', '10 patients synthétiques, 5 comptes, 1 transition')", [hb]);
    await c.query('COMMIT'); console.log('DSN démo prêt : 10 patients synthétiques, 5 comptes par fonction, transition', t.numero, 'vers le CHSLD des Érables');
  } catch (err) { await c.query('ROLLBACK'); throw err; } finally { c.release(); await pool.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
