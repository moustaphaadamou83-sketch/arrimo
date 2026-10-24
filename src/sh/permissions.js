'use strict';

const ROLES_SH = ['administration', 'commercial', 'implantation', 'formation', 'support', 'finance'];
const A = 'administration';
const PERMISSIONS = {
  'GET /moi': ROLES_SH,
  'PUT /moi/langue': ROLES_SH,
  'PUT /moi/mot-de-passe': ROLES_SH,
  'POST /moi/2fa/preparer': ROLES_SH,
  'POST /moi/2fa/activer': ROLES_SH,
  'POST /deconnexion': ROLES_SH,
  'POST /moi/sessions/fermer': ROLES_SH,
  'GET /environnements': ['administration', 'implantation', 'support'],
  'GET /hopitaux': ROLES_SH,
  'GET /hopitaux/:id': ROLES_SH,
  'GET /hopitaux/:id/structure': ['administration', 'implantation'],
  'GET /hopitaux/:id/suivi': ROLES_SH,
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
  'GET /crm/organisations': ['administration', 'commercial', 'finance'],
  'GET /crm/organisations/:id': ['administration', 'commercial', 'finance'],
  'PUT /crm/organisations/:id': ['administration', 'commercial', 'finance'],
  'POST /crm/organisations/:id/hopital': ['administration', 'commercial'],
  'POST /crm/organisations/:id/activites': ['administration', 'commercial'],
  'GET /crm/activites': ['administration', 'commercial'],
  'PUT /crm/activites/:id': ['administration', 'commercial'],
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
  'PUT /crm/devis/:id/statut': ['administration', 'commercial'],
  'GET /crm/devis/:id/pdf': ['administration', 'commercial', 'finance'],
  'GET /crm/contrats/:id': ['administration', 'commercial', 'implantation', 'support', 'finance'],
  'PUT /crm/contrats/:id': ['administration', 'commercial'],
  'POST /crm/contrats/:id/renouveler': [A],
  'POST /crm/contrats/:id/resilier': [A],
  'GET /crm/contrats/:id/pdf': ['administration', 'commercial', 'finance'],
  'GET /crm/contrats': ['administration', 'commercial', 'implantation', 'support', 'finance'],
  'POST /crm/opportunites/:id/contrats': ['administration', 'commercial'],
  'POST /crm/contrats/:id/signe': ['administration'],
  'GET /projets': ['administration', 'implantation', 'support', 'formation'],
  'POST /projets': ['administration', 'implantation'],
  'GET /projets/:id': ['administration', 'implantation', 'support', 'formation'],
  'PUT /projets/:id': ['administration', 'implantation'],
  'POST /projets/:id/jalons': ['administration', 'implantation'],
  'PUT /jalons/:id': ['administration', 'implantation'],
  'GET /taches': ROLES_SH,
  'POST /projets/:id/taches': ['administration', 'implantation'],
  'PUT /taches/:id': ROLES_SH,
  'GET /taches/:id/commentaires': ROLES_SH,
  'POST /taches/:id/commentaires': ROLES_SH,
  'GET /support/tickets': ['administration', 'support', 'implantation'],
  'POST /support/tickets': ['administration', 'support', 'implantation'],
  'GET /support/tickets/:id': ['administration', 'support', 'implantation'],
  'PUT /support/tickets/:id': ['administration', 'support'],
  'POST /support/tickets/:id/messages': ['administration', 'support', 'implantation'],
  // Tarification et facturation
  'GET /tarifs': ['administration', 'commercial', 'finance'],
  'POST /tarifs': ['administration', 'finance'],
  'GET /facturation/taxes': ['administration', 'commercial', 'finance'],
  'PUT /facturation/taxes/:id': [A],
  'GET /facturation/abonnements': ['administration', 'finance'],
  'PUT /facturation/abonnements/:id': ['administration', 'finance'],
  'POST /facturation/abonnements/:id/facturer': ['administration', 'finance'],
  'POST /facturation/generer': ['administration', 'finance'],
  'GET /facturation/factures': ['administration', 'finance'],
  'POST /facturation/factures': ['administration', 'finance'],
  'GET /facturation/factures/:id': ['administration', 'finance'],
  'POST /facturation/factures/:id/emettre': ['administration', 'finance'],
  'POST /facturation/factures/:id/annuler': ['administration', 'finance'],
  'POST /facturation/factures/:id/paiements': ['administration', 'finance'],
  'GET /facturation/factures/:id/pdf': ['administration', 'finance'],
  'GET /facturation/resume': ['administration', 'finance'],
  // Personnel
  'GET /personnel': ROLES_SH,
  'GET /permissions': [A],
  'GET /equipes': ROLES_SH,
  'POST /equipes': [A],
  'PUT /equipes/:id': [A],
  // Documents (contrôle fin par catégorie dans la route)
  'GET /documents': ROLES_SH,
  'POST /documents': ROLES_SH,
  'GET /documents/:id/versions': ROLES_SH,
  'GET /documents/:id/fichier': ROLES_SH,
  'POST /documents/:id/archiver': [A],
  // Hébergement, rapports
  'GET /hebergement': ['administration', 'implantation', 'support'],
  'POST /hebergement/verifier': ['administration', 'implantation', 'support'],
  'GET /rapports/indicateurs': ROLES_SH,
  'GET /rapports/export': ['administration', 'commercial', 'finance', 'support', 'implantation'],
  // Formation par séances
  'GET /hopitaux/:id/formation/sessions': ['administration', 'implantation', 'formation'],
  'POST /hopitaux/:id/formation/sessions': ['administration', 'implantation', 'formation'],
  'PUT /formation/sessions/:id': ['administration', 'implantation', 'formation'],
  'POST /formation/sessions/:id/participants': ['administration', 'implantation', 'formation'],
  'PUT /formation/participants/:id': ['administration', 'implantation', 'formation'],
  // Notifications et calendrier
  'GET /notifications': ROLES_SH,
  'POST /notifications/lues': ROLES_SH,
  'GET /calendrier': ROLES_SH,
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
