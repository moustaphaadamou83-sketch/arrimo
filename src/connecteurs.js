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
  return rows[0];
}

const EVENEMENTS = ['admission', 'transfert_interne', 'conge', 'conge_prevu'];

/** Applique un événement. Idempotent : le même identifiant n'est appliqué qu'une fois. */
async function recevoirEvenement(pool, connecteur, ev) {
  if (!connecteur.etablissement_id) throw new ErreurHttp(403, 'connecteur_lecture');
  const identifiant = String(ev.identifiant || '').slice(0, 120);
  if (!identifiant) throw new ErreurHttp(400, 'identifiant_requis');
  if (!EVENEMENTS.includes(ev.evenement)) throw new ErreurHttp(400, 'evenement_invalide', { liste: EVENEMENTS.join(', ') });

  const deja = await pool.query('SELECT statut, detail FROM messages_connecteur WHERE connecteur_id = $1 AND identifiant = $2',
    [connecteur.id, identifiant]);
  if (deja.rows[0]) return { statut: 'deja_recu', detail: deja.rows[0].detail };

  const trouverLit = async (c, code) => {
    const r = await c.query('SELECT id, code, etat, patient_ref, version FROM lits WHERE etablissement_id = $1 AND code = $2',
      [connecteur.etablissement_id, String(code || '')]);
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
  };

  let statut = 'applique'; let detail = '';
  try {
    await transaction(pool, async (c) => {
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
      } else if (ev.evenement === 'conge_prevu') {
        const lit = await trouverLit(c, ev.lit);
        const d = new Date(ev.date);
        if (Number.isNaN(d.getTime())) throw new ErreurHttp(400, 'date_invalide');
        const u = await c.query(`UPDATE lits SET sortie_prevue = $2, conge_statut = 'prevu' WHERE id = $1 AND etat = 'occupe' RETURNING id`, [lit.id, d]);
        if (!u.rows[0]) { statut = 'ignore'; detail = `Lit ${ev.lit} non occupé`; return; }
        detail = `Congé prévu ${d.toISOString()} au lit ${ev.lit}`;
      }
    });
  } catch (err) {
    statut = 'rejete';
    detail = err.message;
    await pool.query(`INSERT INTO messages_connecteur (connecteur_id, identifiant, evenement, statut, detail) VALUES ($1,$2,$3,$4,$5)
                      ON CONFLICT DO NOTHING`, [connecteur.id, identifiant, ev.evenement, statut, detail]);
    throw err;
  }
  await pool.query(`INSERT INTO messages_connecteur (connecteur_id, identifiant, evenement, statut, detail) VALUES ($1,$2,$3,$4,$5)
                    ON CONFLICT DO NOTHING`, [connecteur.id, identifiant, ev.evenement, statut, detail]);
  return { statut, detail };
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
