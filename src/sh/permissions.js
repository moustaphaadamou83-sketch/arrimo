'use strict';

const ROLES_SH = ['administration', 'commercial', 'implantation', 'formation', 'support'];
const PERMISSIONS = {
  'GET /moi': ROLES_SH,
  'PUT /moi/langue': ROLES_SH,
  'PUT /moi/mot-de-passe': ROLES_SH,
  'POST /moi/2fa/preparer': ROLES_SH,
  'POST /moi/2fa/activer': ROLES_SH,
  'POST /deconnexion': ROLES_SH,
  'GET /environnements': ['administration', 'implantation', 'support'],
  'GET /hopitaux': ROLES_SH,
  'GET /hopitaux/:id': ROLES_SH,
  'GET /hopitaux/:id/structure': ['administration', 'implantation'],
  'POST /hopitaux': ['administration', 'commercial'],
  'PUT /hopitaux/:id': ['administration', 'commercial', 'implantation'],
  'PUT /hopitaux/:id/dossier': ['administration', 'implantation'],
  'PUT /hopitaux/:id/modules': ['administration', 'commercial'],
  'POST /hopitaux/:id/relier': ['administration', 'implantation'],
  'PUT /etapes/:id': ['administration', 'implantation'],
  'PUT /verifications/:id': ['administration', 'implantation'],
  'GET /hopitaux/:id/import/modeles/:type': ['administration', 'implantation'],
  'POST /hopitaux/:id/import/verifier': ['administration', 'implantation'],
  'POST /hopitaux/:id/import/analyser': ['administration', 'implantation'],
  'POST /hopitaux/:id/import/importer': ['administration', 'implantation'],
  'PUT /formation/:id': ['administration', 'implantation', 'formation'],
  'PUT /hopitaux/:id/formation/:role': ['administration', 'implantation', 'formation'],
  'POST /hopitaux/:id/formation/generer': ['administration', 'implantation', 'formation'],
  'POST /hopitaux/:id/golive/preflight': ['administration', 'implantation'],
  'POST /hopitaux/:id/golive': ['administration'],
  'POST /hopitaux/:id/activation': ['administration'],
  'POST /hopitaux/:id/desactivation': ['administration'],
  'GET /hopitaux/:id/rapport.pdf': ['administration', 'implantation', 'support'],
  'GET /journal': ['administration', 'implantation', 'support'],
  'GET /equipe': ['administration'],
  'GET /invitations': ['administration'],
  'POST /equipe': ['administration'],
  'PUT /equipe/:id': ['administration'],
  'PUT /equipe/:id/role': ['administration'],
  'POST /equipe/:id/inviter': ['administration'],
  'GET /crm/organisations': ['administration', 'commercial'],
  'POST /crm/organisations': ['administration', 'commercial'],
  'POST /crm/organisations/:id/contacts': ['administration', 'commercial'],
  'PUT /crm/organisations/:id/etablissement': ['administration', 'commercial', 'implantation'],
  'GET /crm/opportunites': ['administration', 'commercial'],
  'POST /crm/opportunites': ['administration', 'commercial'],
  'PUT /crm/opportunites/:id': ['administration', 'commercial'],
  'POST /crm/opportunites/:id/activites': ['administration', 'commercial'],
  'POST /crm/opportunites/:id/devis': ['administration', 'commercial'],
  'GET /crm/opportunites/:id/devis': ['administration', 'commercial'],
  'POST /crm/devis/:id/valider': ['administration'],
  'GET /crm/contrats': ['administration', 'commercial', 'implantation', 'support'],
  'POST /crm/opportunites/:id/contrats': ['administration', 'commercial'],
  'POST /crm/contrats/:id/signe': ['administration'],
  'GET /projets': ['administration', 'implantation', 'support'],
  'POST /projets': ['administration', 'implantation'],
  'GET /taches': ROLES_SH,
  'POST /projets/:id/taches': ['administration', 'implantation'],
  'PUT /taches/:id': ['administration', 'implantation', 'support'],
  'POST /taches/:id/commentaires': ['administration', 'implantation', 'formation', 'support'],
  'GET /support/tickets': ['administration', 'support'],
  'POST /support/tickets': ['administration', 'support', 'implantation'],
};

function cleRoute(method, path) {
  return `${method.toUpperCase()} ${String(path).replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/hopitaux\/:id\/import\/modeles\/[^/]+$/, '/hopitaux/:id/import/modeles/:type')
    .replace(/\/hopitaux\/:id\/formation\/(coordination|urgence|entretien|administration)$/, '/hopitaux/:id/formation/:role')}`;
}

function autoriser(u, req) {
  const cle = cleRoute(req.method, req.path);
  const roles = PERMISSIONS[cle];
  if (!roles || !roles.includes(u.role)) return false;
  if (u.role === 'commercial' && req.method === 'PUT' && /^\/hopitaux\/\d+$/.test(req.path)) {
    const autorises = new Set(['nom', 'adresse', 'ville', 'contact_nom', 'contact_courriel', 'contact_telephone', 'raison_sociale', 'identifiant_legal', 'pays_code', 'region', 'fuseau_horaire']);
    if (Object.keys(req.body || {}).some((k) => !autorises.has(k))) return false;
  }
  return true;
}

module.exports = { ROLES_SH, PERMISSIONS, autoriser, cleRoute };
