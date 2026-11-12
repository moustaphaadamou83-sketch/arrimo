'use strict';
/**
 * FHIR R4 en lecture (cahier 2, section 11.2) pour le système d'un hôpital relié : clé de connecteur à portée « fhir »
 * (activée depuis SH), données de SON établissement seulement. Aucune ressource Patient : Arrimo ne détient pas d'identité ;
 * les ambulances annoncées sont des Encounter planifiés sans « subject ».
 *   GET /api/fhir/r4/metadata                CapabilityStatement (public)
 *   GET /api/fhir/r4/Organization/{code}     l'établissement
 *   GET /api/fhir/r4/Location                lits (operationalStatus : O occupé, U libre, H nettoyage, C fermé, K réservé)
 *   GET /api/fhir/r4/HealthcareService       services actifs
 *   GET /api/fhir/r4/Encounter               préalertes ouvertes vers l'établissement (classe EMER)
 */
const { ErreurHttp } = require('./db');

const TYPE = 'application/fhir+json; charset=utf-8';
const resultat = (res, corps, statut = 200) => res.status(statut).type(TYPE).send(JSON.stringify(corps));
const issue = (code, texte) => ({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code, diagnostics: texte }] });
const bundle = (entrees, base, type) => ({ resourceType: 'Bundle', type: 'searchset', total: entrees.length, entry: entrees.map((r) => ({ fullUrl: `${base}/${type}/${r.id}`, resource: r })) });
const OPS = { occupe: 'O', libre: 'U', nettoyage: 'H', indispo: 'C', reserve: 'K' };
const STATUT = { envoyee: 'planned', recue: 'planned', consultee: 'planned', prise_en_compte: 'planned', preparation: 'planned', preparation_terminee: 'planned', arrivee: 'arrived', cloturee: 'finished', annulee: 'cancelled', remplacee: 'cancelled' };
const PRIO = { immediate: 'EM', urgente: 'UR', non_urgente: 'R' };

async function authentifier(pool, req) {
  const cle = String(req.get('x-connecteur-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || '');
  const con = await require('./connecteurs').identifier(pool, cle);
  if (!con.etablissement_id || !(con.portees || []).includes('fhir')) throw new ErreurHttp(403, 'connecteur_portee_refusee');
  return con;
}
function brancher(app, pool) {
  const base = (req) => `${req.protocol}://${req.get('host')}/api/fhir/r4`;
  const avec = (fn) => async (req, res) => {
    try { const con = await authentifier(pool, req); await fn(req, res, con); }
    catch (e) { resultat(res, issue(e.statut === 403 ? 'forbidden' : e.statut === 401 ? 'security' : e.statut === 404 ? 'not-found' : 'exception', e.statut ? e.message : 'Erreur interne'), e.statut || 500); }
  };
  app.get('/api/fhir/r4/metadata', (req, res) => resultat(res, { resourceType: 'CapabilityStatement', status: 'active', date: '2026-11-12', kind: 'instance', fhirVersion: '4.0.1',
    format: ['json'], software: { name: 'Arrimo' }, rest: [{ mode: 'server', security: { description: 'Clé de connecteur à portée « fhir » (X-Connecteur-Key ou Bearer), données de l’établissement seulement.' },
      resource: ['Organization', 'Location', 'HealthcareService', 'Encounter'].map((type) => ({ type, interaction: [{ code: 'read' }, { code: 'search-type' }] })) }] }));
  app.get('/api/fhir/r4/Organization/:code', avec(async (req, res, con) => {
    const e = (await pool.query('SELECT id, code, nom, ville, adresse FROM etablissements WHERE id = $1', [con.etablissement_id])).rows[0];
    if (String(req.params.code).toUpperCase() !== e.code) throw new ErreurHttp(404, 'client_introuvable');
    resultat(res, { resourceType: 'Organization', id: e.code, active: true, name: e.nom, address: [{ line: [e.adresse].filter(Boolean), city: e.ville }] });
  }));
  app.get('/api/fhir/r4/Location', avec(async (req, res, con) => {
    const e = (await pool.query('SELECT code FROM etablissements WHERE id = $1', [con.etablissement_id])).rows[0];
    const lits = (await pool.query(`SELECT l.code, l.etat, ch.numero AS chambre, un.nom AS unite FROM lits l JOIN chambres ch ON ch.id = l.chambre_id JOIN unites un ON un.id = l.unite_id
      WHERE l.etablissement_id = $1 AND l.actif ORDER BY l.code`, [con.etablissement_id])).rows;
    resultat(res, bundle(lits.map((l) => ({ resourceType: 'Location', id: `${e.code}-${l.code}`, identifier: [{ value: l.code }], status: 'active', name: `${l.unite} · ${l.chambre} · ${l.code}`,
      operationalStatus: { system: 'http://terminology.hl7.org/CodeSystem/v2-0116', code: OPS[l.etat] || 'U' },
      physicalType: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/location-physical-type', code: 'bd' }] }, managingOrganization: { reference: `Organization/${e.code}` } })), base(req), 'Location'));
  }));
  app.get('/api/fhir/r4/HealthcareService', avec(async (req, res, con) => {
    const e = (await pool.query('SELECT code FROM etablissements WHERE id = $1', [con.etablissement_id])).rows[0];
    const s = (await pool.query('SELECT id, code, nom FROM services WHERE etablissement_id = $1 AND actif ORDER BY nom', [con.etablissement_id])).rows;
    resultat(res, bundle(s.map((x) => ({ resourceType: 'HealthcareService', id: `${e.code}-${x.code}`, active: true, name: x.nom, providedBy: { reference: `Organization/${e.code}` } })), base(req), 'HealthcareService'));
  }));
  app.get('/api/fhir/r4/Encounter', avec(async (req, res, con) => {
    const e = (await pool.query('SELECT code FROM etablissements WHERE id = $1', [con.etablissement_id])).rows[0];
    const p = (await pool.query(`SELECT p.numero, p.statut, p.priorite, p.heure_prevue, p.cree_le, un.numero AS unite, o.nom AS organisation,
        (SELECT code FROM services WHERE id = COALESCE(p.service_confirme_id, p.service_propose_id)) AS service
      FROM prealertes p JOIN unites_secours un ON un.id = p.unite_id JOIN organisations_secours o ON o.id = p.organisation_id
      WHERE p.destination_id = $1 AND (p.statut IN ('envoyee','recue','consultee','prise_en_compte','preparation','preparation_terminee','arrivee') OR p.modifie_le > now() - interval '24 hours')
      ORDER BY p.id`, [con.etablissement_id])).rows;
    resultat(res, bundle(p.map((x) => ({ resourceType: 'Encounter', id: x.numero, identifier: [{ system: 'urn:arrimo:prealerte', value: x.numero }], status: STATUT[x.statut],
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'EMER' },
      priority: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActPriority', code: PRIO[x.priorite] }] },
      ...(x.service ? { serviceType: { coding: [{ system: 'urn:arrimo:service', code: x.service }] } } : {}),
      period: { start: (x.heure_prevue || x.cree_le).toISOString() }, serviceProvider: { reference: `Organization/${e.code}` },
      extension: [{ url: 'urn:arrimo:unite', valueString: `${x.organisation} · ${x.unite}` }] })), base(req), 'Encounter'));
  }));
}
module.exports = { brancher };
