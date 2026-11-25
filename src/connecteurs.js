/**
 * Connexion aux systèmes de l'établissement et du réseau.
 *
 * Entrée (par établissement) : le moteur d'interface de l'hôpital (ex. Enovacom, Rhapsody, Mirth) traduit les messages
 * HL7 ADT (A01 admission, A02 transfert interne, A03 congé, A16 congé prévu) en JSON et les envoie ici.
 * La référence patient doit déjà être pseudonymisée : Arrimo ne reçoit jamais l'identité du patient.
 *
 * Sortie (réseau) : un connecteur sans établissement lit la capacité agrégée des établissements qui partagent,
 * par exemple pour une coordination régionale ou nationale.
 */
const crypto = require('crypto');
const { transaction, ErreurHttp } = require('./db');
const { changerEtat } = require('./regles');
const s = require('./services');

const hacherCle = (cle) => crypto.createHash('sha256').update(String(cle)).digest('hex');

async function creerConnecteur(pool, nom, etablissementId) {
  const cle = `arr_${crypto.randomBytes(24).toString('hex')}`;
  const { rows } = await pool.query(
    `INSERT INTO connecteurs (nom, cle_hash, etablissement_id) VALUES ($1, $2, $3) RETURNING id, nom, etablissement_id`,
    [String(nom || 'Connecteur').slice(0, 100), hacherCle(cle), etablissementId || null]);
  return { ...rows[0], cle };   // la clé n'est montrée qu'une seule fois
}

async function identifier(pool, cle) {
  if (!cle) throw new ErreurHttp(401, 'connecteur_cle_manquante');
  const { rows } = await pool.query('SELECT * FROM connecteurs WHERE cle_hash = $1 AND actif', [hacherCle(cle)]);
  if (!rows[0]) throw new ErreurHttp(401, 'connecteur_cle_invalide');
  // Suspension réversible (complémentaire nº 3, §12) : 503 pour que le partenaire garde ses messages et réessaie à la reprise
  if (rows[0].suspendu_le) throw new ErreurHttp(503, 'connecteur_suspendu');
  return rows[0];
}

const EVENEMENTS = ['admission', 'transfert_interne', 'conge', 'conge_prevu', 'arrivee_urgence',
  // Connecteur DSN (22 nov. 2026)
  'annulation_admission', 'annulation_transfert', 'annulation_conge', 'statut_lit', 'echange_lits', 'mise_a_jour', 'changement_classe', 'absence_temporaire', 'retour_absence_temporaire'];
// Statut de lit HL7 (NPU-2) : U inoccupé, C fermé, H entretien, K contaminé, I isolé, O occupé
const STATUTS_LIT = ['U', 'C', 'H', 'K', 'I', 'O'];

/** Applique un événement. Idempotent : le même identifiant n'est appliqué qu'une fois. */
async function recevoirEvenement(pool, connecteur, ev) {
  if (!connecteur.etablissement_id) throw new ErreurHttp(403, 'connecteur_lecture');
  const identifiant = String(ev.identifiant || '').slice(0, 120);
  if (!identifiant) throw new ErreurHttp(400, 'identifiant_requis');
  if (!EVENEMENTS.includes(ev.evenement)) throw new ErreurHttp(400, 'evenement_invalide', { liste: EVENEMENTS.join(', ') });

  const trouverLit = async (c, code) => {
    // Table de correspondance du connecteur (code du lit dans Epic → code Arrimo), sinon le code tel quel
    const map = (await c.query("SELECT code_arrimo FROM connecteur_correspondances WHERE connecteur_id = $1 AND genre = 'lit' AND code_externe = $2", [connecteur.id, String(code || '')])).rows[0];
    const r = await c.query('SELECT id, code, etat, patient_ref, version FROM lits WHERE etablissement_id = $1 AND code = $2',
      [connecteur.etablissement_id, map ? map.code_arrimo : String(code || '')]);
    if (!r.rows[0]) throw new ErreurHttp(404, 'lit_inconnu', { code });
    return r.rows[0];
  };
  const occuper = async (c, lit, ref, detail) => {
    if (lit.etat === 'occupe' && lit.patient_ref === ref) return;
    if (lit.etat === 'libre') await changerEtat(c, pool, null, lit.id, 'reserve', { patientRef: ref, detail });
    else if (!(lit.etat === 'reserve' && lit.patient_ref === ref)) {
      throw new ErreurHttp(409, 'admission_impossible', { code: lit.code, lit_etat: lit.etat, ref });
    }
    await changerEtat(c, pool, null, lit.id, 'occupe', { detail });
    await require('./terrain').synchroniserDemandeAdmise(c, pool, lit.id, ref, detail);
  };

  let statut = 'applique'; let detail = '';
  try {
    return await transaction(pool, async (c) => {
      // Sérialiser les livraisons concurrentes, même quand aucune ligne de journal
      // n'existe encore. Le verrou est libéré au COMMIT ou au ROLLBACK.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`arrimo-connecteur:${connecteur.id}`]);
      const simulation = await c.query('SELECT connecteur_id FROM connecteurs_simulation_config WHERE connecteur_id=$1', [connecteur.id]);
      if (simulation.rows[0]) throw new ErreurHttp(403, 'simulation_session_requise');
      const deja = await c.query('SELECT statut, detail FROM messages_connecteur WHERE connecteur_id = $1 AND identifiant = $2',
        [connecteur.id, identifiant]);
      if (deja.rows[0] && deja.rows[0].statut !== 'rejete') return { statut: 'deja_recu', detail: deja.rows[0].detail };

      // Les retours anticipés des événements ignorés doivent aussi être journalisés.
      await (async () => {
        const ref = String(ev.patient_ref || '').trim();
        if (ev.evenement === 'admission') {
          await occuper(c, await trouverLit(c, ev.lit), ref, `${connecteur.nom} : admission`);
          detail = `Admission ${ref} au lit ${ev.lit}`;
        } else if (ev.evenement === 'transfert_interne') {
          const avant = await trouverLit(c, ev.lit_precedent);
          if (avant.etat === 'occupe') await changerEtat(c, pool, null, avant.id, 'nettoyage', { detail: `${connecteur.nom} : transfert interne` });
          await occuper(c, await trouverLit(c, ev.lit), ref, `${connecteur.nom} : transfert interne`);
          detail = `Transfert interne ${ev.lit_precedent} → ${ev.lit}`;
        } else if (ev.evenement === 'conge') {
          const lit = await trouverLit(c, ev.lit);
          if (lit.etat !== 'occupe') { statut = 'ignore'; detail = `Lit ${ev.lit} déjà libéré`; return; }
          await changerEtat(c, pool, null, lit.id, 'nettoyage', { detail: `${connecteur.nom} : congé` });
          detail = `Congé du lit ${ev.lit}`;
        } else if (ev.evenement === 'arrivee_urgence') {
          // Arrivée à l'urgence transmise par le système de l'hôpital : référence seulement, civière désignée par son code
          const deja = (await c.query(`SELECT code FROM civieres WHERE etablissement_id = $1 AND patient_ref = $2 AND etat = 'occupee'`, [connecteur.etablissement_id, ref])).rows[0];
          if (deja) { statut = 'ignore'; detail = `${ref} déjà sur la civière ${deja.code}`; return; }
          const mapC = (await c.query("SELECT code_arrimo FROM connecteur_correspondances WHERE connecteur_id = $1 AND genre = 'civiere' AND code_externe = $2", [connecteur.id, String(ev.civiere || '')])).rows[0];
          const cv = (await c.query('SELECT id, code FROM civieres WHERE etablissement_id = $1 AND code = $2', [connecteur.etablissement_id, mapC ? mapC.code_arrimo : String(ev.civiere || '')])).rows[0];
          if (!cv) throw new ErreurHttp(404, 'civiere_introuvable');
          await require('./regles').changerEtatCiviere(c, pool, null, cv.id, 'occupee', { patientRef: ref, arrivee: ev.date || null, detail: `${connecteur.nom} : arrivée à l’urgence` });
          detail = `Arrivée ${ref} sur la civière ${cv.code} (source : ${connecteur.nom})`;
        } else if (ev.evenement === 'annulation_admission') {
          // A11 : l'admission n'a pas eu lieu ; le lit passe au nettoyage (seule sortie permise d'un lit occupé), l'entretien confirme
          const lit = await trouverLit(c, ev.lit);
          if (!(lit.etat === 'occupe' && lit.patient_ref === ref)) { statut = 'ignore'; detail = `Annulation d’admission : lit ${ev.lit} non occupé par ${ref}`; return; }
          await changerEtat(c, pool, null, lit.id, 'nettoyage', { detail: `${connecteur.nom} : annulation d’admission` });
          detail = `Annulation de l’admission ${ref} au lit ${ev.lit}`;
        } else if (ev.evenement === 'annulation_transfert') {
          // A12 : retour au lit d'origine (PV1-3) ; le lit du transfert annulé (PV1-6) passe au nettoyage
          const annule = await trouverLit(c, ev.lit_annule);
          if (annule.etat === 'occupe' && annule.patient_ref === ref) await changerEtat(c, pool, null, annule.id, 'nettoyage', { detail: `${connecteur.nom} : annulation de transfert` });
          const retour = await trouverLit(c, ev.lit);
          if (retour.etat === 'nettoyage') await changerEtat(c, pool, null, retour.id, 'libre', { detail: `${connecteur.nom} : annulation de transfert, retour au lit` });
          await occuper(c, await trouverLit(c, ev.lit), ref, `${connecteur.nom} : annulation de transfert`);
          detail = `Annulation du transfert ${ev.lit_annule} → ${ev.lit}`;
        } else if (ev.evenement === 'annulation_conge') {
          // A13 : le patient n'est pas parti ; son lit redevient occupé s'il n'a pas été donné à quelqu'un d'autre
          const lit = await trouverLit(c, ev.lit);
          if (lit.etat === 'occupe' && lit.patient_ref === ref) { statut = 'ignore'; detail = `${ref} déjà au lit ${ev.lit}`; return; }
          if (lit.etat === 'nettoyage') await changerEtat(c, pool, null, lit.id, 'libre', { detail: `${connecteur.nom} : annulation de congé` });
          else if (lit.etat !== 'libre') throw new ErreurHttp(409, 'admission_impossible', { code: lit.code, lit_etat: lit.etat, ref });
          await occuper(c, await trouverLit(c, ev.lit), ref, `${connecteur.nom} : annulation de congé`);
          detail = `Annulation du congé de ${ref} au lit ${ev.lit}`;
        } else if (ev.evenement === 'statut_lit') {
          // A20 : statut d'un lit dans le DSN ; appliqué seulement par une transition permise, sinon journalisé comme écart
          if (!STATUTS_LIT.includes(ev.statut_lit)) throw new ErreurHttp(400, 'evenement_invalide', { liste: STATUTS_LIT.join(', ') });
          const lit = await trouverLit(c, ev.lit);
          const vise = { U: 'libre', C: 'indispo', K: 'indispo', I: 'indispo', H: 'nettoyage', O: 'occupe' }[ev.statut_lit];
          if (lit.etat === vise) { statut = 'ignore'; detail = `Lit ${ev.lit} déjà ${vise}`; return; }
          const permis = (lit.etat === 'nettoyage' && vise === 'libre') || (lit.etat === 'indispo' && vise === 'libre') || (lit.etat === 'libre' && vise === 'indispo');
          if (!permis) { statut = 'ignore'; detail = `Écart : lit ${ev.lit} « ${lit.etat} » dans Arrimo, « ${vise} » dans le DSN ; à vérifier`; return; }
          await changerEtat(c, pool, null, lit.id, vise, { detail: `${connecteur.nom} : statut du lit (${ev.statut_lit})`, ...(vise === 'indispo' ? { motif: ['K', 'I'].includes(ev.statut_lit) ? 'infection' : 'autre' } : {}) });
          detail = `Statut du lit ${ev.lit} : ${vise}`;
        } else if (ev.evenement === 'echange_lits') {
          // A17 : échange de lits entre deux patients ; jamais deviné : journalisé pour confirmation par la coordination
          statut = 'ignore'; detail = `Échange de lits ${ev.lit} ↔ ${ev.lit2} reçu : à confirmer dans Arrimo`; return;
        } else if (['mise_a_jour', 'changement_classe', 'absence_temporaire', 'retour_absence_temporaire'].includes(ev.evenement)) {
          // A08, A06, A07, A21, A22 : aucune donnée d'identité conservée, aucun changement d'état ; reçus et journalisés
          statut = 'ignore'; detail = `${ev.evenement.replaceAll('_', ' ')} reçu (aucun changement d’état)`; return;
        } else if (ev.evenement === 'conge_prevu') {
          const lit = await trouverLit(c, ev.lit);
          const d = new Date(ev.date);
          if (Number.isNaN(d.getTime())) throw new ErreurHttp(400, 'date_invalide');
          const u = await c.query(`UPDATE lits SET sortie_prevue = $2, conge_statut = 'prevu' WHERE id = $1 AND etat = 'occupe' RETURNING id`, [lit.id, d]);
          if (!u.rows[0]) { statut = 'ignore'; detail = `Lit ${ev.lit} non occupé`; return; }
          await require('./terrain').synchroniserConge(c, lit.id, null, 'integration');
          detail = `Congé prévu ${d.toISOString()} au lit ${ev.lit}`;
        }
      })();
      // L'effet métier et son accusé de réception sont atomiques. Un rejet peut
      // être rejoué après correction, sans bloquer définitivement l'identifiant.
      await c.query(`INSERT INTO messages_connecteur (connecteur_id, identifiant, evenement, statut, detail) VALUES ($1,$2,$3,$4,$5)
                    ON CONFLICT (connecteur_id, identifiant) DO UPDATE
                    SET evenement = EXCLUDED.evenement, statut = EXCLUDED.statut, detail = EXCLUDED.detail
                    WHERE messages_connecteur.statut = 'rejete'`, [connecteur.id, identifiant, ev.evenement, statut, detail]);
      return { statut, detail };
    });
  } catch (err) {
    statut = 'rejete';
    detail = err.message;
    await pool.query(`INSERT INTO messages_connecteur (connecteur_id, identifiant, evenement, statut, detail) VALUES ($1,$2,$3,$4,$5)
                      ON CONFLICT DO NOTHING`, [connecteur.id, identifiant, ev.evenement, statut, detail]);
    throw err;
  }
}

/** Capacité agrégée de tous les établissements qui partagent (connecteur réseau). Aucun lit, aucun patient. */
async function capaciteNationale(pool) {
  const { rows } = await pool.query(
    `SELECT e.code, e.nom, e.ville, e.latitude, e.longitude, t.code AS type_code, t.nom AS type_nom,
            count(*) FILTER (WHERE l.etat <> 'indispo')::int AS dotes,
            count(*) FILTER (WHERE l.etat = 'libre')::int AS libres,
            count(*) FILTER (WHERE l.etat = 'indispo' AND l.motif_indispo = 'personnel')::int AS fermes_personnel,
            count(*) FILTER (WHERE l.nsa_depuis IS NOT NULL)::int AS nsa
       FROM lits l JOIN etablissements e ON e.id = l.etablissement_id JOIN types_unite t ON t.id = l.type_id
      WHERE e.module_actif AND e.actif AND e.partage <> 'aucun'
      GROUP BY e.id, t.id ORDER BY e.nom, t.ordre`);
  return { genere_le: new Date().toISOString(), lignes: rows };
}

module.exports = { creerConnecteur, identifier, recevoirEvenement, capaciteNationale, hacherCle };
