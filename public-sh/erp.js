/* Console SH : écrans ERP (CRM, devis et contrats, facturation, projets, tâches, calendrier, support, documents,
 * hébergement, rapports, équipes, notifications). Chargé après sh.js, dont il réutilise les outils (api, modale, agir…).
 * Chaque action vise un identifiant (data-id), jamais une position dans une liste filtrée. Aucun script en ligne. */

/* ---------------- outils communs ---------------- */
const bouton = (libelle, action, classe = 'btn', id = '') => `<button class="${classe}" type="button" data-action="${action}"${id !== '' ? ` data-id="${esc(id)}"` : ''}>${esc(libelle)}</button>`;
function tableSH(headers, rows, vide = 'Aucune donnée enregistrée.') {
  return `<div class="tableau"><table><thead><tr>${headers.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="note">${esc(vide)}</td></tr>`}</tbody></table></div>`;
}
const argent = (n, devise = 'CAD') => (n == null || n === '' ? '—' : new Intl.NumberFormat(L, { style: 'currency', currency: devise || 'CAD' }).format(Number(n)));
const jourIso = (d) => (d ? String(d).slice(0, 10) : '');
const aujourdhuiIso = () => new Date().toLocaleDateString('en-CA');
const roleMoi = () => etat.moi.utilisateur.role;
const peut = (...roles) => roleMoi() === 'administration' || roles.includes(roleMoi());
const surAction = (racine, action, fn) => racine.querySelectorAll(`[data-action="${action}"]`).forEach((b) => { b.onclick = () => fn(b.dataset.id, b); });
const valeur = (sel) => { const el = document.querySelector(sel); return el ? el.value : ''; };
const LIB = {
  opp: { qualification: 'Qualification', analyse: 'Analyse', proposition: 'Proposition', negociation: 'Négociation', gagnee: 'Gagnée', perdue: 'Perdue' },
  devis: { brouillon: 'Brouillon', a_valider: 'À approuver', approuve: 'Approuvé', envoye: 'Envoyé', accepte: 'Accepté', refuse: 'Refusé', expire: 'Expiré' },
  contrat: { negociation: 'En négociation', pret_a_signer: 'Prêt à signer', signe: 'Signé', resilie: 'Résilié', expire: 'Expiré' },
  facture: { brouillon: 'Brouillon', emise: 'Émise', partiellement_payee: 'Payée en partie', payee: 'Payée', en_retard: 'En retard', annulee: 'Annulée' },
  tache: { a_faire: 'À faire', en_cours: 'En cours', bloquee: 'Bloquée', terminee: 'Terminée' },
  projet: { planification: 'Planification', en_cours: 'En cours', bloque: 'Bloqué', termine: 'Terminé', annule: 'Annulé' },
  ticket: { ouvert: 'Ouvert', en_cours: 'En cours', en_attente: 'En attente', resolu: 'Résolu', ferme: 'Fermé' },
  priorite: { basse: 'Basse', normale: 'Normale', haute: 'Haute', urgente: 'Urgente' },
  type_ticket: { demande: 'Demande', incident: 'Incident', question: 'Question' },
  periodicite: { unique: 'Unique', mensuel: 'Mensuel', annuel: 'Annuel' },
  role: { administration: 'Administration', commercial: 'Commercial', implantation: 'Implantation', formation: 'Formation', support: 'Support', finance: 'Finance' },
  categorie: { contrat: 'Contrat', devis: 'Devis', facture: 'Facture', technique: 'Technique', formation: 'Formation', support: 'Support', general: 'Général' },
};
// Statut visuel : couleurs de statut seulement (succès, info, attention, critique, inactif).
const NIVEAUX = { gagnee: 'n-vert', signe: 'n-vert', payee: 'n-vert', terminee: 'n-vert', termine: 'n-vert', resolu: 'n-vert', ferme: 'n-vert', accepte: 'n-vert', approuve: 'n-vert',
  en_retard: 'n-rouge', perdue: 'n-rouge', refuse: 'n-rouge', bloquee: 'n-rouge', bloque: 'n-rouge', urgente: 'n-rouge', resilie: 'n-rouge',
  a_valider: 'n-orange', pret_a_signer: 'n-orange', partiellement_payee: 'n-orange', en_attente: 'n-orange', haute: 'n-orange' };
const etiquette = (famille, code) => `<span class="etat-niveau ${NIVEAUX[code] || ''}">${esc(LIB[famille]?.[code] || code || '—')}</span>`;
const options = (famille, choisi) => Object.entries(LIB[famille]).map(([k, n]) => `<option value="${k}"${k === choisi ? ' selected' : ''}>${esc(n)}</option>`).join('');
async function telechargerApi(chemin, nom) {
  const r = await fetch(`/api${chemin}`, { headers: { Authorization: `Bearer ${etat.token}` } });
  if (!r.ok) { let m = `Erreur ${r.status}.`; try { m = (await r.json()).erreur || m; } catch { /* binaire */ } throw new Error(m); }
  telecharger(await r.blob(), nom);
}
const lireFichier = (input) => new Promise((ok, ko) => {
  const f = input.files && input.files[0];
  if (!f) { ko(new Error('Choisissez un fichier.')); return; }
  if (f.size > 10 * 1024 * 1024) { ko(new Error('Fichier trop gros : 10 Mo au plus.')); return; }
  const lecteur = new FileReader();
  lecteur.onload = () => ok({ nom: f.name, contenu_base64: String(lecteur.result).split(',')[1] || '' });
  lecteur.onerror = () => ko(new Error('Lecture du fichier impossible.'));
  lecteur.readAsDataURL(f);
});
/** Fenêtre de saisie : renvoie false pour la garder ouverte quand l'enregistrement échoue. */
const enregistrer = (fn, succes) => async () => {
  try { await fn(); if (succes) toast(succes); await afficher(); return true; } catch (e) { toast(e.message, true); return false; }
};
let personnelCache = null;
async function personnel() { if (!personnelCache) personnelCache = await api('GET', '/personnel').catch(() => []); return personnelCache; }
const choixPersonne = (id, choisi, libelle = 'Responsable') => personnel().then((ps) => `<div class="champ"><label class="lbl" for="${id}">${esc(libelle)}</label><select id="${id}"><option value="">Non attribué</option>${ps.map((p) => `<option value="${p.id}"${Number(choisi) === p.id ? ' selected' : ''}>${esc(p.nom)} · ${esc(LIB.role[p.role] || p.role)}</option>`).join('')}</select></div>`);

/* ---------------- onglets et notifications ---------------- */
const ONGLETS_ROLES = {
  accueil: null, hopitaux: null, taches: null, calendrier: null, documents: null, rapports: null, compte: null,
  crm: ['commercial', 'finance'], contrats: ['commercial', 'implantation', 'support', 'finance'], facturation: ['finance'],
  projets: ['implantation', 'support', 'formation'], support: ['support', 'implantation'], hebergement: ['implantation', 'support'],
  journal: ['implantation', 'support'], equipe: [],
};
function reglerOnglets() {
  for (const [vue, roles] of Object.entries(ONGLETS_ROLES)) {
    const b = $(`#onglets [data-v="${vue}"]`);
    if (b) b.hidden = roles !== null && !peut(...roles);
  }
  if ($(`#onglets [data-v="${etat.vue}"]`)?.hidden) etat.vue = 'hopitaux';
  rafraichirCloche();
}
async function rafraichirCloche() {
  const b = $('#b-notifications'); if (!b || !etat.token) return;
  try {
    const n = await api('GET', '/notifications');
    etat.notifications = n;
    const p = $('#pastille-notifications'); p.textContent = n.non_lues > 99 ? '99+' : String(n.non_lues); p.hidden = !n.non_lues;
  } catch { /* la cloche est facultative */ }
}
$('#b-notifications').onclick = async () => {
  await rafraichirCloche();
  const n = etat.notifications || { notifications: [] };
  modale('Notifications', n.notifications.length ? `<ul class="liste-notifs">${n.notifications.map((x) => `<li class="${x.lu_le ? '' : 'non-lue'}"><button class="lien-ligne" type="button" data-vue="${esc(x.lien || '')}">${esc(x.titre)}</button><span class="note">${esc(quand(x.cree_le))}</span></li>`).join('')}</ul>` : '<p class="note">Aucune notification.</p>',
    [{ label: 'Tout marquer comme lu', run: async () => { await api('POST', '/notifications/lues', {}); await rafraichirCloche(); return true; } }, { label: 'Fermer', pri: true }]);
  $('#modale').querySelectorAll('[data-vue]').forEach((b) => { b.onclick = () => { if (b.dataset.vue && !$(`#onglets [data-v="${b.dataset.vue}"]`)?.hidden) { etat.vue = b.dataset.vue; etat.hopital = null; } $('#modale').hidden = true; afficher(); }; });
};
setInterval(() => { if (etat.moi && !document.hidden) rafraichirCloche(); }, 60000);

/* ---------------- accueil ---------------- */
async function vueAccueil(v) {
  const [ind, mes] = await Promise.all([api('GET', '/rapports/indicateurs'), api('GET', '/taches?moi=1').catch(() => [])]);
  const ouvertes = mes.filter((t) => t.statut !== 'terminee');
  const cartes = [['Mes tâches ouvertes', ouvertes.length], ['Mes tâches en retard', ouvertes.filter((t) => t.en_retard).length]];
  if (ind.pipeline) cartes.push(['Opportunités ouvertes', ind.pipeline.filter((p) => !['gagnee', 'perdue'].includes(p.statut)).reduce((n, p) => n + p.n, 0)], ['Contrats actifs', ind.contrats.actifs]);
  if (ind.mrr) cartes.push(['Revenu mensuel récurrent', ind.mrr.map((m) => argent(m.mrr, m.devise)).join(' · ') || argent(0)]);
  if (ind.factures) cartes.push(['Factures en retard', ind.factures.filter((f) => f.etat === 'en_retard').reduce((n, f) => n + f.n, 0)]);
  if (ind.support) cartes.push(['Tickets ouverts', ind.support.ouverts], ['Hors délai', ind.support.hors_delai]);
  if (ind.projets) cartes.push(['Projets en cours', ind.projets.filter((p) => ['planification', 'en_cours'].includes(p.statut)).reduce((n, p) => n + p.n, 0)]);
  v.innerHTML = `<div class="entete"><div><h2>Accueil</h2><p>Indicateurs calculés depuis les données SH accessibles à votre rôle.</p></div></div>
    <div class="cartes-kpi">${cartes.map(([n, x]) => `<article class="carte"><span class="note">${esc(n)}</span><strong>${esc(x)}</strong></article>`).join('')}</div>
    <div class="carte"><h3>Mes prochaines tâches</h3>${ouvertes.length ? `<ul class="liste-simple">${ouvertes.slice(0, 8).map((t) => `<li>${t.en_retard ? etiquette('facture', 'en_retard') : ''} <b>${esc(t.titre)}</b> <span class="note">${esc(t.hopital || '')}${t.echeance ? ` · ${esc(jour(t.echeance))}` : ''}</span></li>`).join('')}</ul>` : '<p class="note">Aucune tâche ouverte attribuée.</p>'}</div>`;
}

/* ---------------- CRM ---------------- */
async function vueCRM(v) {
  const [orgs, opps, relances] = await Promise.all([api('GET', '/crm/organisations'), api('GET', '/crm/opportunites'), peut('commercial') ? api('GET', '/crm/activites?a_faire=1') : []]);
  const previsions = {};
  for (const o of opps.filter((x) => !['gagnee', 'perdue'].includes(x.statut) && x.montant != null)) previsions[o.devise] = (previsions[o.devise] || 0) + Number(o.montant) * Number(o.probabilite) / 100;
  const prevision = Object.keys(previsions).length ? `Prévision pondérée : ${Object.entries(previsions).map(([d, t]) => argent(t, d)).join(' · ')} (valeur × probabilité).` : 'Aucune opportunité ouverte avec une valeur enregistrée.';
  const suivant = { qualification: 'analyse', analyse: 'proposition', proposition: 'negociation', negociation: 'gagnee' };
  const commercial = peut('commercial');
  const board = Object.entries(LIB.opp).map(([code, label]) => {
    const liste = opps.filter((o) => o.statut === code);
    return `<section class="sh-kanban-col" data-colonne="${code}"><h3>${esc(label)} <span>${liste.length}</span></h3>${liste.map((o) => `<article class="sh-kanban-card" data-opp="${o.id}">
      <strong>${esc(o.titre)}</strong><p>${esc(o.organisation)}</p><p>${o.montant == null ? 'Valeur à confirmer' : esc(argent(o.montant, o.devise))} · ${esc(o.probabilite)} %</p>
      ${o.responsable ? `<p class="note">${esc(o.responsable)}</p>` : ''}${o.prochaine_action ? `<p class="note">${esc(o.prochaine_action)}</p>` : ''}
      ${commercial ? `<div class="ligne serre">${suivant[code] ? bouton('Avancer', 'opp-avancer', 'btn', o.id) : ''}${!['gagnee', 'perdue'].includes(code) ? bouton('Devis', 'opp-devis', 'btn', o.id) + bouton('Relance', 'opp-relance', 'btn', o.id) + bouton('Perdue', 'opp-perdue', 'btn discret', o.id) : ''}</div>` : ''}</article>`).join('') || '<p class="note">Aucune opportunité.</p>'}</section>`;
  }).join('');
  const lignesOrg = orgs.map((o) => `<tr><td><button class="lien-ligne" type="button" data-action="org-ouvrir" data-id="${o.id}">${esc(o.nom)}</button></td><td>${esc(o.type)}</td><td>${esc(o.region || '—')}</td><td>${o.contacts}</td><td>${o.opportunites}</td><td>${o.hopital_id ? 'Fiche liée' : commercial ? bouton('Créer la fiche établissement', 'org-hopital', 'btn', o.id) : '—'}</td></tr>`).join('');
  const lignesRel = relances.map((a) => `<tr><td>${a.en_retard ? etiquette('facture', 'en_retard') : ''} ${esc(a.titre)}</td><td>${esc(a.type)}</td><td>${esc(a.organisation || '—')}</td><td>${esc(a.responsable || '—')}</td><td>${esc(a.echeance ? quand(a.echeance) : '—')}</td><td>${bouton('Fait', 'rel-fait', 'btn', a.id)}</td></tr>`).join('');
  v.innerHTML = `<div class="entete"><div><h2>CRM</h2><p>${esc(pl('{n|# organisation|# organisations}', { n: orgs.length }))} · ${esc(pl('{n|# opportunité enregistrée|# opportunités enregistrées}', { n: opps.length }))}. ${esc(prevision)}</p></div>
    ${commercial ? `<div class="ligne serre">${bouton('Nouvelle organisation', 'org-nouvelle', 'btn pri')}${bouton('Nouvelle opportunité', 'opp-nouvelle')}</div>` : ''}</div>
    <h3>Pipeline commercial</h3><div class="sh-kanban">${board}</div>
    ${commercial ? `<h3>Relances à faire</h3>${tableSH(['Relance', 'Type', 'Organisation', 'Responsable', 'Échéance', ''], lignesRel, 'Aucune relance en attente.')}` : ''}
    <h3>Organisations</h3>${tableSH(['Organisation', 'Type', 'Province', 'Contacts', 'Opportunités', 'Établissement'], lignesOrg)}`;
  const opp = (id) => opps.find((o) => String(o.id) === String(id));
  surAction(v, 'org-nouvelle', () => modale('Nouvelle organisation', `<div class="form-modale">${champ('o-nom', 'Nom', '')}${champ('o-site', 'Site Web', '', 'type="url"')}
    <div class="ligne">${champ('o-ville', 'Ville', '')}${champ('o-region', 'Province / région', 'Québec')}${champ('o-pays', 'Pays (ISO)', 'CA', 'maxlength="2"')}</div>${champ('o-adresse', 'Adresse', '')}${champ('o-fact', 'Courriel de facturation', '', 'type="email"')}</div>`,
  [{ label: 'Annuler' }, { label: 'Créer', pri: true, run: enregistrer(() => api('POST', '/crm/organisations', { nom: valeur('#o-nom'), site_web: valeur('#o-site'), ville: valeur('#o-ville'), region: valeur('#o-region'), pays_code: valeur('#o-pays'), adresse: valeur('#o-adresse'), courriel_facturation: valeur('#o-fact') }), 'Organisation créée.') }]));
  surAction(v, 'opp-nouvelle', async () => {
    if (!orgs.length) { toast('Créez d’abord une organisation.', true); return; }
    modale('Nouvelle opportunité', `<div class="form-modale"><div class="champ"><label class="lbl" for="p-org">Organisation</label><select id="p-org">${orgs.map((o) => `<option value="${o.id}">${esc(o.nom)}</option>`).join('')}</select></div>
      ${champ('p-titre', 'Titre', '')}<div class="ligne">${champ('p-montant', 'Valeur estimée', '', 'type="number" min="0" step="0.01"')}${champ('p-proba', 'Probabilité (%)', '20', 'type="number" min="0" max="100"')}${champ('p-echeance', 'Décision attendue', '', 'type="date"')}</div>
      ${await choixPersonne('p-resp', etat.moi.utilisateur.id)}${champ('p-action', 'Prochaine action', '')}</div>`,
    [{ label: 'Annuler' }, { label: 'Créer', pri: true, run: enregistrer(() => api('POST', '/crm/opportunites', { organisation_id: Number(valeur('#p-org')), titre: valeur('#p-titre'), montant: valeur('#p-montant') || null, probabilite: Number(valeur('#p-proba') || 0), echeance: valeur('#p-echeance') || null, responsable_id: valeur('#p-resp') || null, prochaine_action: valeur('#p-action') }), 'Opportunité créée.') }]);
  });
  surAction(v, 'opp-avancer', (id, b) => { const o = opp(id); agir(b, () => api('PUT', `/crm/opportunites/${o.id}`, { statut: suivant[o.statut], probabilite: suivant[o.statut] === 'gagnee' ? 100 : Math.max(o.probabilite, { analyse: 30, proposition: 50, negociation: 75 }[suivant[o.statut]] || 0) }), `Étape suivante : ${LIB.opp[suivant[o.statut]]}.`); });
  surAction(v, 'opp-perdue', (id) => modale('Opportunité perdue', champ('p-motif', 'Motif', ''), [{ label: 'Annuler' }, { label: 'Enregistrer', dan: true, run: enregistrer(() => api('PUT', `/crm/opportunites/${id}`, { statut: 'perdue', perdue_motif: valeur('#p-motif') }), 'Opportunité classée perdue.') }]));
  surAction(v, 'opp-relance', async (id) => modale('Planifier une relance', `<div class="form-modale"><div class="champ"><label class="lbl" for="r-type">Type</label><select id="r-type"><option value="relance">Relance</option><option value="appel">Appel</option><option value="reunion">Réunion</option><option value="courriel">Courriel</option><option value="note">Note</option></select></div>
    ${champ('r-titre', 'Objet', '')}${champ('r-echeance', 'Échéance', '', 'type="datetime-local"')}${await choixPersonne('r-resp', etat.moi.utilisateur.id)}<div class="champ"><label class="lbl" for="r-contenu">Notes</label><textarea id="r-contenu"></textarea></div></div>`,
  [{ label: 'Annuler' }, { label: 'Planifier', pri: true, run: enregistrer(() => api('POST', `/crm/opportunites/${id}/activites`, { type: valeur('#r-type'), titre: valeur('#r-titre'), echeance: valeur('#r-echeance') ? new Date(valeur('#r-echeance')).toISOString() : null, responsable_id: valeur('#r-resp') || null, contenu: valeur('#r-contenu') }), 'Activité enregistrée.') }]));
  surAction(v, 'rel-fait', (id, b) => agir(b, () => api('PUT', `/crm/activites/${id}`, { terminee: true }), 'Relance terminée.'));
  surAction(v, 'opp-devis', (id) => formulaireDevis(opp(id)));
  surAction(v, 'org-hopital', (id) => {
    const o = orgs.find((x) => String(x.id) === String(id));
    modale('Créer la fiche établissement', `<p class="note">La fiche reprend le nom, l’adresse et le décideur de l’organisation. Les projets déjà créés à la signature y sont rattachés.</p><div class="form-modale">
      <div class="ligne">${champ('fh-code', 'Code d’établissement', '', 'placeholder="HOP-A"')}${choixEnv('fh-env', 'recette')}${champ('fh-sd', 'Lien propre (sous-domaine)', '', 'placeholder="hopital-x"')}</div>
      <div class="ligne">${champ('fh-raison', 'Raison sociale', o.nom)}${champ('fh-legal', 'Identifiant légal', '')}</div>
      <div class="ligne">${champ('fh-lat', 'Latitude', '', 'inputmode="decimal"')}${champ('fh-lon', 'Longitude', '', 'inputmode="decimal"')}${champ('fh-prevus', 'Utilisateurs prévus', 0, 'type="number" min="0"')}${champ('fh-autorises', 'Utilisateurs autorisés', 0, 'type="number" min="0"')}</div></div>`,
    [{ label: 'Annuler' }, { label: 'Créer la fiche', pri: true, run: async () => {
      try {
        const h = await api('POST', `/crm/organisations/${o.id}/hopital`, { code_etab: valeur('#fh-code'), environnement: valeur('#fh-env'), sous_domaine: valeur('#fh-sd'), raison_sociale: valeur('#fh-raison'), identifiant_legal: valeur('#fh-legal'),
          latitude: valeur('#fh-lat'), longitude: valeur('#fh-lon'), utilisateurs_prevus: Number(valeur('#fh-prevus') || 0), utilisateurs_autorises: Number(valeur('#fh-autorises') || 0) });
        toast(`${h.nom} : fiche créée.`); etat.vue = 'hopitaux'; etat.hopital = h.id; etat.imports = {}; await afficher(); return true;
      } catch (e) { toast(e.message, true); return false; }
    } }]);
    $('#modale .boite').classList.add('large');
  });
  surAction(v, 'org-ouvrir', async (id) => {
    const o = await api('GET', `/crm/organisations/${id}`);
    modale(o.nom, `<p class="note">${esc([o.adresse, o.ville, o.region, o.pays_code].filter(Boolean).join(', ') || 'Adresse à compléter')}${o.courriel_facturation ? ` · facturation : ${esc(o.courriel_facturation)}` : ''}</p>
      <h4>Contacts</h4>${o.contacts.length ? `<ul class="liste-simple">${o.contacts.map((c) => `<li><b>${esc(c.nom)}</b>${c.decideur ? ' <span class="badge">décideur</span>' : ''} <span class="note">${esc([c.fonction, c.courriel, c.telephone].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul>` : '<p class="note">Aucun contact.</p>'}
      ${commercial ? `<div class="ligne">${champ('c-nom', 'Nom', '')}${champ('c-fonction', 'Fonction', '')}${champ('c-courriel', 'Courriel', '', 'type="email"')}${champ('c-tel', 'Téléphone', '', 'type="tel"')}</div><label class="case"><input type="checkbox" id="c-decideur"> Décideur</label>` : ''}
      <h4>Historique</h4>${o.activites.length ? `<ul class="liste-simple">${o.activites.map((a) => `<li>${esc(a.type)} · <b>${esc(a.titre)}</b> <span class="note">${esc(quand(a.echeance || a.cree_le))}${a.terminee_le ? ' · fait' : ''}</span></li>`).join('')}</ul>` : '<p class="note">Aucune activité.</p>'}
      <h4>Contrats</h4><p class="note">${o.contrats.map((c) => `${esc(c.reference)} (${esc(LIB.contrat[c.statut])})`).join(' · ') || 'Aucun.'}</p>`,
    [{ label: 'Fermer' }, ...(commercial ? [{ label: 'Ajouter le contact', pri: true, run: enregistrer(() => api('POST', `/crm/organisations/${id}/contacts`, { nom: valeur('#c-nom'), fonction: valeur('#c-fonction'), courriel: valeur('#c-courriel'), telephone: valeur('#c-tel'), decideur: $('#c-decideur').checked }), 'Contact ajouté.') }] : [])]);
    $('#modale .boite').classList.add('large');
  });
}
async function formulaireDevis(o) {
  const tarifs = await api('GET', '/tarifs');
  const actifs = tarifs.filter((t) => t.actif);
  const ligne = (i) => `<div class="ligne ligne-devis" data-ligne="${i}"><div class="champ"><label class="lbl" for="q-code-${i}">Tarif</label><select id="q-code-${i}"><option value="">Saisie libre</option>${actifs.map((t) => `<option value="${esc(t.code)}">${esc(t.libelle)} · ${esc(argent(t.prix_unitaire))} ${esc(LIB.periodicite[t.periodicite].toLowerCase())}</option>`).join('')}</select></div>
    ${champ(`q-desc-${i}`, 'Description (saisie libre)', '')}${champ(`q-qte-${i}`, 'Quantité', 1, 'type="number" min="0.01" step="0.01"')}${champ(`q-prix-${i}`, 'Prix (saisie libre)', '', 'type="number" min="0" step="0.01"')}
    <div class="champ"><label class="lbl" for="q-per-${i}">Périodicité</label><select id="q-per-${i}">${options('periodicite', 'unique')}</select></div>${champ(`q-remise-${i}`, 'Remise (%)', 0, 'type="number" min="0" max="100"')}</div>`;
  modale(`Devis · ${o.titre}`, `<p class="note">Les prix des tarifs, les taxes de la province du client et les totaux sont calculés par le serveur. Le devis est créé en brouillon.</p>
    <div id="lignes-devis">${[0, 1, 2].map(ligne).join('')}</div>${champ('q-validite', 'Valide jusqu’au', '', 'type="date"')}<div class="champ"><label class="lbl" for="q-cond">Conditions</label><textarea id="q-cond"></textarea></div>`,
  [{ label: 'Annuler' }, { label: 'Créer le brouillon', pri: true, run: enregistrer(() => {
    const lignes = [0, 1, 2].map((i) => {
      const code = valeur(`#q-code-${i}`); const desc = valeur(`#q-desc-${i}`);
      if (!code && !desc) return null;
      const l = { quantite: Number(valeur(`#q-qte-${i}`) || 1), remise_pct: Number(valeur(`#q-remise-${i}`) || 0) };
      if (code) l.code = code; else Object.assign(l, { description: desc, prix_unitaire: Number(valeur(`#q-prix-${i}`)), periodicite: valeur(`#q-per-${i}`) });
      return l;
    }).filter(Boolean);
    return api('POST', `/crm/opportunites/${o.id}/devis`, { lignes, valide_jusqu: valeur('#q-validite') || null, conditions: valeur('#q-cond') });
  }, 'Devis créé en brouillon.') }]);
  $('#modale .boite').classList.add('large');
}

/* ---------------- devis et contrats ---------------- */
async function vueContrats(v) {
  const commercial = peut('commercial');
  const [cs, opps] = await Promise.all([api('GET', '/crm/contrats'), commercial || peut('finance') ? api('GET', '/crm/opportunites') : []]);
  const devis = (await Promise.all(opps.filter((o) => o.statut !== 'perdue').map(async (o) => (await api('GET', `/crm/opportunites/${o.id}/devis`)).map((d) => ({ ...d, opp: o }))))).flat();
  const admin = roleMoi() === 'administration';
  const actionsDevis = (d) => {
    const b = [bouton('PDF', 'devis-pdf', 'btn', d.id)];
    if (commercial && d.statut === 'brouillon') b.push(bouton('Soumettre', 'devis-soumettre', 'btn', d.id));
    if (admin && ['brouillon', 'a_valider'].includes(d.statut)) b.push(bouton('Approuver', 'devis-approuver', 'btn pri', d.id));
    if (commercial && d.statut === 'approuve') b.push(bouton('Marquer envoyé', 'devis-envoye', 'btn', d.id));
    if (commercial && ['approuve', 'envoye'].includes(d.statut)) b.push(bouton('Accepté', 'devis-accepte', 'btn', d.id), bouton('Refusé', 'devis-refuse', 'btn discret', d.id));
    if (commercial && ['approuve', 'envoye', 'accepte'].includes(d.statut) && !cs.some((c) => String(c.devis_id) === String(d.id))) b.push(bouton('Préparer le contrat', 'devis-contrat', 'btn pri', d.id));
    return `<div class="ligne serre">${b.join('')}</div>`;
  };
  const lignesDevis = devis.map((d) => `<tr><td>${esc(d.opp.organisation)}<div class="note">${esc(d.opp.titre)}</div></td><td>v${d.version}</td><td>${etiquette('devis', d.statut)}</td><td class="num">${esc(argent(d.total ?? d.sous_total, d.devise))}</td><td>${esc(d.valide_jusqu ? jour(d.valide_jusqu) : '—')}</td><td>${actionsDevis(d)}</td></tr>`).join('');
  const actionsContrat = (c) => {
    const b = [bouton('PDF', 'contrat-pdf', 'btn', c.id), bouton('Détail', 'contrat-detail', 'btn', c.id)];
    if (commercial && c.statut === 'negociation') b.push(bouton('Prêt à signer', 'contrat-pret', 'btn', c.id));
    if (admin && ['negociation', 'pret_a_signer'].includes(c.statut)) b.push(bouton('Enregistrer la signature', 'contrat-signer', 'btn pri', c.id));
    if (admin && c.statut === 'signe') b.push(bouton('Renouveler', 'contrat-renouveler', 'btn', c.id), bouton('Résilier', 'contrat-resilier', 'btn discret', c.id));
    return `<div class="ligne serre">${b.join('')}</div>`;
  };
  const lignesContrats = cs.map((c) => `<tr><td>${esc(c.reference)}</td><td>${esc(c.client)}</td><td>${etiquette('contrat', c.statut)}${c.a_renouveler ? ' <span class="badge">préavis proche</span>' : ''}</td><td>${esc(c.date_debut ? jour(c.date_debut) : '—')} → ${esc(c.date_fin ? jour(c.date_fin) : '—')}</td><td>${esc(c.renouvellement_le ? jour(c.renouvellement_le) : '—')}</td><td>${actionsContrat(c)}</td></tr>`).join('');
  v.innerHTML = `<div class="entete"><div><h2>Devis et contrats</h2><p>Devis versionnés et chiffrés par le serveur, approbation par l’administration, contrats avec période, préavis et renouvellement. La signature est obtenue hors plateforme puis consignée avec la pièce signée.</p></div></div>
    ${devis.length || commercial ? `<h3>Devis</h3>${tableSH(['Client', 'Version', 'Statut', 'Total TTC', 'Validité', 'Actions'], lignesDevis, 'Aucun devis : créez-le depuis une opportunité du CRM.')}` : ''}
    <h3>Contrats</h3>${tableSH(['Référence', 'Client', 'Statut', 'Période', 'Préavis', 'Actions'], lignesContrats)}`;
  const d = (id) => devis.find((x) => String(x.id) === String(id));
  surAction(v, 'devis-pdf', (id, b) => agir(b, () => telechargerApi(`/crm/devis/${id}/pdf`, `devis-${d(id).opp_id || d(id).opportunite_id}-v${d(id).version}.pdf`)));
  surAction(v, 'devis-soumettre', (id, b) => agir(b, () => api('PUT', `/crm/devis/${id}/statut`, { statut: 'a_valider' }), 'Devis soumis à l’approbation.'));
  surAction(v, 'devis-approuver', (id, b) => agir(b, () => api('POST', `/crm/devis/${id}/valider`), 'Devis approuvé.'));
  surAction(v, 'devis-envoye', (id, b) => agir(b, () => api('PUT', `/crm/devis/${id}/statut`, { statut: 'envoye' }), 'Devis marqué envoyé.'));
  surAction(v, 'devis-accepte', (id, b) => agir(b, () => api('PUT', `/crm/devis/${id}/statut`, { statut: 'accepte' }), 'Acceptation du client enregistrée.'));
  surAction(v, 'devis-refuse', (id) => modale('Devis refusé', champ('dr-motif', 'Motif du refus', ''), [{ label: 'Annuler' }, { label: 'Enregistrer', dan: true, run: enregistrer(() => api('PUT', `/crm/devis/${id}/statut`, { statut: 'refuse', motif: valeur('#dr-motif') }), 'Refus enregistré.') }]));
  surAction(v, 'devis-contrat', (id) => modale('Préparer le contrat', `<div class="ligne">${champ('ct-debut', 'Début', aujourdhuiIso(), 'type="date"')}${champ('ct-duree', 'Durée (mois)', 12, 'type="number" min="1" max="120"')}${champ('ct-preavis', 'Préavis (jours)', 60, 'type="number" min="0" max="365"')}</div><label class="case"><input type="checkbox" id="ct-auto" checked> Renouvellement automatique</label>`,
    [{ label: 'Annuler' }, { label: 'Préparer', pri: true, run: enregistrer(() => api('POST', `/crm/opportunites/${d(id).opportunite_id}/contrats`, { devis_id: Number(id), date_debut: valeur('#ct-debut'), duree_mois: Number(valeur('#ct-duree')), preavis_jours: Number(valeur('#ct-preavis')), renouvellement_auto: $('#ct-auto').checked }), 'Contrat préparé.') }]));
  surAction(v, 'contrat-pdf', (id, b) => agir(b, () => telechargerApi(`/crm/contrats/${id}/pdf`, `contrat-${cs.find((c) => String(c.id) === String(id)).reference}.pdf`)));
  surAction(v, 'contrat-pret', (id, b) => agir(b, () => api('PUT', `/crm/contrats/${id}`, { statut: 'pret_a_signer' }), 'Contrat prêt à signer.'));
  surAction(v, 'contrat-renouveler', (id) => modale('Renouveler le contrat', '<p>La fin du contrat est prolongée d’une durée identique ; les abonnements suivent.</p>', [{ label: 'Annuler' }, { label: 'Renouveler', pri: true, run: enregistrer(() => api('POST', `/crm/contrats/${id}/renouveler`), 'Contrat renouvelé.') }]));
  surAction(v, 'contrat-resilier', (id) => modale('Résilier le contrat', champ('rs-motif', 'Motif', ''), [{ label: 'Annuler' }, { label: 'Résilier', dan: true, run: enregistrer(() => api('POST', `/crm/contrats/${id}/resilier`, { motif: valeur('#rs-motif') }), 'Contrat résilié ; abonnements terminés.') }]));
  surAction(v, 'contrat-signer', (id) => {
    const c = cs.find((x) => String(x.id) === String(id));
    modale('Enregistrer la signature', `<p class="note">Déposez la pièce signée : elle est chiffrée, versionnée et rattachée au contrat. La signature crée le projet d’implantation, ses tâches, les abonnements et la facture de frais uniques.</p>
      ${champ('sg-par', 'Signataire autorisé du client', '')}<div class="champ"><label class="lbl" for="sg-fichier">Contrat signé (PDF)</label><input id="sg-fichier" type="file" accept="application/pdf"></div>`,
    [{ label: 'Annuler' }, { label: 'Enregistrer', pri: true, run: enregistrer(async () => {
      const f = await lireFichier($('#sg-fichier'));
      const doc = await api('POST', '/documents', { ...f, categorie: 'contrat', contrat_id: c.id, organisation_id: c.organisation_id });
      const r = await api('POST', `/crm/contrats/${c.id}/signe`, { signataire: valeur('#sg-par'), document_id: doc.id });
      toast(`Projet créé avec ${r.taches_creees} tâches${r.abonnements_crees ? ` · ${pl('{n|# abonnement|# abonnements}', { n: r.abonnements_crees })}` : ''}${r.facture_initiale ? ' · facture de frais uniques en brouillon' : ''}.`);
    }) }]);
  });
  surAction(v, 'contrat-detail', async (id) => {
    const c = await api('GET', `/crm/contrats/${id}`);
    modale(`Contrat ${c.reference}`, `<p>${etiquette('contrat', c.statut)} · ${esc(c.client)}</p><p class="note">Période : ${esc(c.date_debut ? jour(c.date_debut) : '—')} → ${esc(c.date_fin ? jour(c.date_fin) : '—')} · ${esc(c.duree_mois)} mois · préavis ${esc(c.preavis_jours)} jours · ${c.renouvellement_auto ? 'renouvellement automatique' : 'renouvellement sur décision'}</p>
      ${c.signe_par ? `<p class="note">Signé par ${esc(c.signe_par)} le ${esc(quand(c.signe_le))} · ${esc(c.document_ref)}</p>` : ''}
      <h4>Abonnements</h4><p class="note">${c.abonnements.map((a) => `${esc(a.libelle)} · ${esc(LIB.periodicite[a.periodicite])} · prochaine facture ${esc(jour(a.prochaine_facture_le))}`).join('<br>') || 'Aucun.'}</p>
      ${c.factures.length ? `<h4>Factures</h4><p class="note">${c.factures.map((f) => `${esc(f.numero || 'brouillon')} · ${esc(argent(f.total))}`).join('<br>')}</p>` : ''}
      <h4>Renouvellements</h4><p class="note">${c.renouvellements.map((r) => `${esc(jour(r.ancienne_fin))} → ${esc(jour(r.nouvelle_fin))} · ${esc(r.par)}`).join('<br>') || 'Aucun.'}</p>`, [{ label: 'Fermer', pri: true }]);
  });
}

/* ---------------- facturation ---------------- */
async function vueFacturation(v) {
  const [resume, abonnements, factures, tarifs, orgs] = await Promise.all([api('GET', '/facturation/resume'), api('GET', '/facturation/abonnements'), api('GET', `/facturation/factures${etat.filtreFacture ? `?etat=${etat.filtreFacture}` : ''}`), api('GET', '/tarifs'), api('GET', '/crm/organisations')]);
  const tot = (etatF) => resume.etats.filter((e) => e.etat === etatF);
  const cartes = [['Revenu mensuel récurrent', resume.mrr.map((m) => argent(m.mrr, m.devise)).join(' · ') || argent(0)], ['Encaissé ce mois', resume.encaisse_mois.map((m) => argent(m.total, m.devise)).join(' · ') || argent(0)],
    ['Solde à recevoir', [...tot('emise'), ...tot('partiellement_payee'), ...tot('en_retard')].reduce((n, e) => n + Number(e.solde), 0)], ['En retard', tot('en_retard').reduce((n, e) => n + e.n, 0)], ['Abonnements à facturer', resume.abonnements_a_facturer]];
  const lignesF = factures.map((f) => `<tr><td>${esc(f.numero || `Brouillon ${f.id}`)}</td><td>${esc(f.client)}</td><td>${etiquette('facture', f.etat)}</td><td class="num">${esc(argent(f.total, f.devise))}</td><td class="num">${esc(argent(f.solde, f.devise))}</td><td>${esc(f.echeance_le ? jour(f.echeance_le) : '—')}</td>
    <td><div class="ligne serre">${f.statut === 'brouillon' ? bouton('Émettre', 'f-emettre', 'btn pri', f.id) : ''}${f.statut === 'emise' && Number(f.solde) > 0 ? bouton('Paiement', 'f-payer', 'btn', f.id) : ''}${f.statut !== 'brouillon' ? bouton('PDF', 'f-pdf', 'btn', f.id) : ''}${f.statut !== 'annulee' && Number(f.paye) === 0 ? bouton('Annuler', 'f-annuler', 'btn discret', f.id) : ''}${bouton('Détail', 'f-detail', 'btn discret', f.id)}</div></td></tr>`).join('');
  const lignesA = abonnements.map((a) => `<tr><td>${esc(a.libelle)}</td><td>${esc(a.contrat)}</td><td>${esc(LIB.periodicite[a.periodicite])}</td><td class="num">${esc(argent(a.montant_periode, a.devise))} HT</td><td>${esc(jour(a.prochaine_facture_le))}</td><td>${esc(a.statut)}</td>
    <td><div class="ligne serre">${a.statut === 'actif' ? bouton('Facturer la période', 'a-facturer', 'btn', a.id) + bouton('Suspendre', 'a-suspendre', 'btn discret', a.id) : a.statut === 'suspendu' ? bouton('Réactiver', 'a-reactiver', 'btn', a.id) : ''}</div></td></tr>`).join('');
  const lignesT = tarifs.map((t) => `<tr><td>${esc(t.code)}</td><td>${esc(t.libelle)}</td><td class="num">${esc(argent(t.prix_unitaire))}</td><td>${esc(LIB.periodicite[t.periodicite])}</td><td>${t.taxable ? 'oui' : 'non'}</td><td>${t.actif ? 'actif' : 'inactif'}</td></tr>`).join('');
  v.innerHTML = `<div class="entete"><div><h2>Facturation</h2><p>Factures numérotées sans trou à l’émission, taxes selon la province du client, paiements partiels et relances par échéance.</p></div>
    <div class="ligne serre">${bouton('Générer les factures dues', 'f-generer', 'btn pri')}${bouton('Nouvelle facture', 'f-nouvelle')}${bouton('Export CSV', 'f-export')}</div></div>
    <div class="cartes-kpi">${cartes.map(([n, x]) => `<article class="carte"><span class="note">${esc(n)}</span><strong>${esc(typeof x === 'number' && n === 'Solde à recevoir' ? argent(x) : x)}</strong></article>`).join('')}</div>
    <div class="ligne filtres"><div class="champ"><label class="lbl" for="ff-etat">État</label><select id="ff-etat"><option value="">Toutes</option>${options('facture', etat.filtreFacture)}</select></div></div>
    <h3>Factures</h3>${tableSH(['Numéro', 'Client', 'État', 'Total', 'Solde', 'Échéance', 'Actions'], lignesF)}
    <h3>Abonnements</h3>${tableSH(['Abonnement', 'Contrat', 'Périodicité', 'Montant', 'Prochaine facture', 'Statut', ''], lignesA, 'Les abonnements sont créés à la signature d’un contrat.')}
    <h3>Grille tarifaire</h3>${tableSH(['Code', 'Libellé', 'Prix', 'Périodicité', 'Taxable', 'État'], lignesT)}<div class="ligne">${bouton('Ajouter ou modifier un tarif', 't-edit')}</div>`;
  $('#ff-etat').onchange = (e) => { etat.filtreFacture = e.target.value; afficher(); };
  surAction(v, 'f-generer', (id, b) => agir(b, () => api('POST', '/facturation/generer'), (r) => pl('{n|aucune facture due|# facture préparée en brouillon|# factures préparées en brouillon}', { n: r.factures_creees })));
  surAction(v, 'f-export', (id, b) => agir(b, () => telechargerApi('/rapports/export?section=factures', 'arrimo-sh-factures.csv')));
  surAction(v, 'f-emettre', (id) => modale('Émettre la facture', `<p>Le numéro définitif est attribué et les taxes sont recalculées à l’émission.</p>${champ('fe-ech', 'Échéance (facultatif)', '', 'type="date"')}`, [{ label: 'Annuler' }, { label: 'Émettre', pri: true, run: enregistrer(() => api('POST', `/facturation/factures/${id}/emettre`, { echeance_le: valeur('#fe-ech') || null }), 'Facture émise.') }]));
  surAction(v, 'f-payer', (id) => { const f = factures.find((x) => String(x.id) === String(id)); modale(`Paiement · ${f.numero}`, `<p class="note">Solde dû : ${esc(argent(f.solde, f.devise))}</p><div class="ligne">${champ('fp-montant', 'Montant', f.solde, 'type="number" min="0.01" step="0.01"')}${champ('fp-date', 'Reçu le', aujourdhuiIso(), 'type="date"')}</div>
    <div class="ligne"><div class="champ"><label class="lbl" for="fp-mode">Mode</label><select id="fp-mode"><option value="virement">Virement</option><option value="cheque">Chèque</option><option value="carte">Carte</option><option value="prelevement">Prélèvement</option><option value="autre">Autre</option></select></div>${champ('fp-ref', 'Référence', '')}</div>`,
  [{ label: 'Annuler' }, { label: 'Enregistrer', pri: true, run: enregistrer(() => api('POST', `/facturation/factures/${id}/paiements`, { montant: Number(valeur('#fp-montant')), recu_le: valeur('#fp-date'), mode: valeur('#fp-mode'), reference: valeur('#fp-ref') }), 'Paiement enregistré.') }]); });
  surAction(v, 'f-pdf', (id, b) => agir(b, () => telechargerApi(`/facturation/factures/${id}/pdf`, `facture-${factures.find((x) => String(x.id) === String(id)).numero}.pdf`)));
  surAction(v, 'f-annuler', (id) => modale('Annuler la facture', champ('fa-motif', 'Motif', ''), [{ label: 'Retour' }, { label: 'Annuler la facture', dan: true, run: enregistrer(() => api('POST', `/facturation/factures/${id}/annuler`, { motif: valeur('#fa-motif') }), 'Facture annulée.') }]));
  surAction(v, 'f-detail', async (id) => {
    const f = await api('GET', `/facturation/factures/${id}`);
    modale(f.numero || `Brouillon ${f.id}`, `<p>${etiquette('facture', f.etat)} · ${esc(f.client)}</p>${tableSH(['Description', 'Qté', 'Montant'], f.lignes.map((l) => `<tr><td>${esc(l.description)}</td><td>${esc(l.quantite)}</td><td class="num">${esc(argent(l.montant, f.devise))}</td></tr>`).join(''))}
      <p class="note">Sous-total ${esc(argent(f.sous_total, f.devise))} · ${f.taxes.map((t) => `${esc(t.nom)} ${esc(argent(t.montant, f.devise))}`).join(' · ') || 'aucune taxe'} · total ${esc(argent(f.total, f.devise))}</p>
      <h4>Paiements</h4><p class="note">${f.paiements.map((p) => `${esc(jour(p.recu_le))} · ${esc(argent(p.montant, f.devise))} · ${esc(p.mode)}${p.reference ? ` · ${esc(p.reference)}` : ''}`).join('<br>') || 'Aucun.'}</p>`, [{ label: 'Fermer', pri: true }]);
    $('#modale .boite').classList.add('large');
  });
  surAction(v, 'f-nouvelle', () => modale('Nouvelle facture ponctuelle', `<div class="form-modale"><div class="champ"><label class="lbl" for="fn-org">Client</label><select id="fn-org">${orgs.map((o) => `<option value="${o.id}">${esc(o.nom)}</option>`).join('')}</select></div>
    ${champ('fn-desc', 'Description', '')}<div class="ligne">${champ('fn-qte', 'Quantité', 1, 'type="number" min="0.01" step="0.01"')}${champ('fn-prix', 'Prix unitaire', '', 'type="number" min="0" step="0.01"')}</div>${champ('fn-note', 'Note', '')}</div>`,
  [{ label: 'Annuler' }, { label: 'Créer le brouillon', pri: true, run: enregistrer(() => api('POST', '/facturation/factures', { organisation_id: Number(valeur('#fn-org')), lignes: [{ description: valeur('#fn-desc'), quantite: Number(valeur('#fn-qte')), prix_unitaire: Number(valeur('#fn-prix')) }], note: valeur('#fn-note') }), 'Facture créée en brouillon.') }]));
  surAction(v, 'a-facturer', (id, b) => agir(b, () => api('POST', `/facturation/abonnements/${id}/facturer`), (r) => (r.deja_facturee ? 'Cette période est déjà facturée.' : 'Facture de la période préparée en brouillon.')));
  surAction(v, 'a-suspendre', (id, b) => agir(b, () => api('PUT', `/facturation/abonnements/${id}`, { statut: 'suspendu' }), 'Abonnement suspendu.'));
  surAction(v, 'a-reactiver', (id, b) => agir(b, () => api('PUT', `/facturation/abonnements/${id}`, { statut: 'actif' }), 'Abonnement réactivé.'));
  surAction(v, 't-edit', () => modale('Tarif', `<div class="form-modale"><div class="ligne">${champ('tf-code', 'Code', '', 'placeholder="licence-lits"')}${champ('tf-lib', 'Libellé', '')}</div><div class="ligne">${champ('tf-prix', 'Prix unitaire', '', 'type="number" min="0" step="0.01"')}${champ('tf-unite', 'Unité', 'forfait')}
    <div class="champ"><label class="lbl" for="tf-per">Périodicité</label><select id="tf-per">${options('periodicite', 'unique')}</select></div></div><label class="case"><input type="checkbox" id="tf-tax" checked> Taxable</label> <label class="case"><input type="checkbox" id="tf-actif" checked> Actif</label></div>`,
  [{ label: 'Annuler' }, { label: 'Enregistrer', pri: true, run: enregistrer(() => api('POST', '/tarifs', { code: valeur('#tf-code'), libelle: valeur('#tf-lib'), prix_unitaire: Number(valeur('#tf-prix')), unite: valeur('#tf-unite'), periodicite: valeur('#tf-per'), taxable: $('#tf-tax').checked, actif: $('#tf-actif').checked }), 'Tarif enregistré.') }]));
}

/* ---------------- projets ---------------- */
async function vueProjets(v) {
  if (etat.projet) return vueProjet(v);
  const [ps, hs] = await Promise.all([api('GET', '/projets'), api('GET', '/hopitaux')]);
  const lignes = ps.map((p) => `<tr><td><button class="lien-ligne" type="button" data-action="p-ouvrir" data-id="${p.id}">${esc(p.nom)}</button></td><td>${esc(p.hopital || p.organisation || '—')}</td><td>${etiquette('projet', p.statut)}</td><td>${esc(p.responsable || '—')}</td>
    <td><div class="progres"><i style="width:${p.avancement}%"></i></div><span class="note">${p.avancement} % · ${esc(pl('{n|# tâche|# tâches}', { n: p.taches }))}${p.taches_en_retard ? ` · ${p.taches_en_retard} en retard` : ''}</span></td><td>${esc(p.echeance ? jour(p.echeance) : '—')}</td></tr>`).join('');
  v.innerHTML = `<div class="entete"><div><h2>Projets</h2><p>Projets d’implantation : créés à la signature d’un contrat, rattachés à l’établissement dès sa fiche créée. L’avancement suit les tâches, dont celles qui se terminent avec les étapes réelles.</p></div>${peut('implantation') ? bouton('Nouveau projet', 'p-nouveau', 'btn pri') : ''}</div>
    ${tableSH(['Projet', 'Établissement', 'Statut', 'Responsable', 'Avancement', 'Échéance'], lignes)}`;
  surAction(v, 'p-ouvrir', (id) => { etat.projet = Number(id); afficher(); });
  surAction(v, 'p-nouveau', async () => {
    if (!hs.length) { toast('Créez d’abord la fiche de l’établissement.', true); return; }
    modale('Nouveau projet', `<div class="form-modale"><div class="champ"><label class="lbl" for="pr-hop">Établissement</label><select id="pr-hop">${hs.map((h) => `<option value="${h.id}">${esc(h.nom)}</option>`).join('')}</select></div>${champ('pr-nom', 'Nom du projet', '')}
      <div class="ligne">${champ('pr-debut', 'Début', '', 'type="date"')}${champ('pr-date', 'Échéance', '', 'type="date"')}</div>${await choixPersonne('pr-resp', null)}</div>`,
    [{ label: 'Annuler' }, { label: 'Créer', pri: true, run: enregistrer(() => api('POST', '/projets', { hopital_id: Number(valeur('#pr-hop')), nom: valeur('#pr-nom'), debut: valeur('#pr-debut') || null, echeance: valeur('#pr-date') || null, responsable_id: valeur('#pr-resp') || null }), 'Projet créé.') }]);
  });
}
async function vueProjet(v) {
  const p = await api('GET', `/projets/${etat.projet}`);
  const gerer = peut('implantation');
  v.innerHTML = `<div class="entete"><div><button class="btn discret retour" type="button" id="b-retour-projets">← Tous les projets</button><h2>${esc(p.nom)}</h2>
      <p>${etiquette('projet', p.statut)} · ${esc(p.hopital || p.organisation || '')}${p.contrat ? ` · contrat ${esc(p.contrat)}` : ''} · ${p.avancement} %</p></div>
      ${gerer ? `<div class="ligne serre">${bouton('Modifier', 'pj-modifier')}${bouton('Nouvelle tâche', 'pj-tache', 'btn pri')}${bouton('Nouveau jalon', 'pj-jalon')}</div>` : ''}</div>
    <div class="progres large"><i style="width:${p.avancement}%"></i></div>
    <h3>Jalons</h3>${tableSH(['Jalon', 'Échéance', 'Responsable', 'État'], p.jalons.map((j) => `<tr><td>${esc(j.nom)}</td><td>${esc(j.echeance ? jour(j.echeance) : '—')}</td><td>${esc(j.responsable || '—')}</td><td>${j.termine_le ? `atteint le ${esc(jour(j.termine_le))}` : gerer ? bouton('Marquer atteint', 'pj-jalon-fait', 'btn', j.id) : 'à venir'}</td></tr>`).join(''), 'Aucun jalon.')}
    <h3>Tâches</h3>${tableauTaches(p.taches, { projet: false })}`;
  $('#b-retour-projets').onclick = () => { etat.projet = null; afficher(); };
  brancherTaches(v, p.taches);
  surAction(v, 'pj-jalon-fait', (id, b) => agir(b, () => api('PUT', `/jalons/${id}`, { termine: true }), 'Jalon atteint.'));
  surAction(v, 'pj-jalon', async () => modale('Nouveau jalon', `<div class="form-modale">${champ('jl-nom', 'Nom', '')}${champ('jl-date', 'Échéance', '', 'type="date"')}${await choixPersonne('jl-resp', null)}</div>`,
    [{ label: 'Annuler' }, { label: 'Ajouter', pri: true, run: enregistrer(() => api('POST', `/projets/${p.id}/jalons`, { nom: valeur('#jl-nom'), echeance: valeur('#jl-date') || null, responsable_id: valeur('#jl-resp') || null }), 'Jalon ajouté.') }]));
  surAction(v, 'pj-tache', async () => modale('Nouvelle tâche', `<div class="form-modale">${champ('nt-titre', 'Titre', '')}<div class="ligne"><div class="champ"><label class="lbl" for="nt-prio">Priorité</label><select id="nt-prio">${options('priorite', 'normale')}</select></div>${champ('nt-date', 'Échéance', '', 'type="date"')}</div>
    ${await choixPersonne('nt-resp', null)}<div class="champ"><label class="lbl" for="nt-desc">Description</label><textarea id="nt-desc"></textarea></div></div>`,
  [{ label: 'Annuler' }, { label: 'Créer', pri: true, run: enregistrer(() => api('POST', `/projets/${p.id}/taches`, { titre: valeur('#nt-titre'), priorite: valeur('#nt-prio'), echeance: valeur('#nt-date') || null, responsable_id: valeur('#nt-resp') || null, description: valeur('#nt-desc') }), 'Tâche créée.') }]));
  surAction(v, 'pj-modifier', async () => modale('Modifier le projet', `<div class="form-modale">${champ('mp-nom', 'Nom', p.nom)}<div class="ligne"><div class="champ"><label class="lbl" for="mp-statut">Statut</label><select id="mp-statut">${options('projet', p.statut)}</select></div>${champ('mp-debut', 'Début', jourIso(p.debut), 'type="date"')}${champ('mp-fin', 'Échéance', jourIso(p.echeance), 'type="date"')}</div>${await choixPersonne('mp-resp', p.responsable_id)}</div>`,
    [{ label: 'Annuler' }, { label: 'Enregistrer', pri: true, run: enregistrer(() => api('PUT', `/projets/${p.id}`, { nom: valeur('#mp-nom'), statut: valeur('#mp-statut'), debut: valeur('#mp-debut') || null, echeance: valeur('#mp-fin') || null, responsable_id: valeur('#mp-resp') || null }), 'Projet enregistré.') }]));
}

/* ---------------- tâches ---------------- */
function tableauTaches(ts, { projet = true } = {}) {
  const moi = etat.moi.utilisateur.id; const gestion = peut('implantation');
  return tableSH(['Tâche', ...(projet ? ['Projet'] : []), 'Statut', 'Priorité', 'Responsable', 'Échéance', ''], ts.map((t) => {
    const modifiable = gestion || t.responsable_id === moi;
    return `<tr><td><b>${esc(t.titre)}</b>${t.code_auto ? ' <span class="badge">suit la console</span>' : ''}${t.en_retard ? ` ${etiquette('facture', 'en_retard')}` : ''}</td>${projet ? `<td>${esc(t.projet)}<div class="note">${esc(t.hopital || '')}</div></td>` : ''}
      <td>${modifiable ? `<select data-tache-statut="${t.id}" aria-label="Statut de ${esc(t.titre)}">${options('tache', t.statut)}</select>` : etiquette('tache', t.statut)}</td><td>${etiquette('priorite', t.priorite)}</td><td>${esc(t.responsable || '—')}</td><td>${esc(t.echeance ? jour(t.echeance) : '—')}</td>
      <td><div class="ligne serre">${modifiable ? bouton('Modifier', 't-modifier', 'btn', t.id) : ''}${bouton(`Commentaires${t.commentaires ? ` (${t.commentaires})` : ''}`, 't-commentaires', 'btn discret', t.id)}</div></td></tr>`;
  }).join(''), 'Aucune tâche.');
}
function brancherTaches(v, ts) {
  v.querySelectorAll('[data-tache-statut]').forEach((s) => { s.onchange = () => agir(s, () => api('PUT', `/taches/${s.dataset.tacheStatut}`, { statut: s.value }), 'Tâche mise à jour.'); });
  surAction(v, 't-modifier', async (id) => {
    const t = ts.find((x) => String(x.id) === String(id));
    modale('Modifier la tâche', `<div class="form-modale"><div class="ligne"><div class="champ"><label class="lbl" for="mt-prio">Priorité</label><select id="mt-prio">${options('priorite', t.priorite)}</select></div>${champ('mt-date', 'Échéance', jourIso(t.echeance), 'type="date"')}</div>
      ${peut('implantation') ? await choixPersonne('mt-resp', t.responsable_id, 'Attribuer à') : ''}<div class="champ"><label class="lbl" for="mt-desc">Description</label><textarea id="mt-desc">${esc(t.description || '')}</textarea></div></div>`,
    [{ label: 'Annuler' }, { label: 'Enregistrer', pri: true, run: enregistrer(() => api('PUT', `/taches/${id}`, { priorite: valeur('#mt-prio'), echeance: valeur('#mt-date') || null, description: valeur('#mt-desc'), ...($('#mt-resp') ? { responsable_id: valeur('#mt-resp') || null } : {}) }), 'Tâche enregistrée.') }]);
  });
  surAction(v, 't-commentaires', async (id) => {
    const cs = await api('GET', `/taches/${id}/commentaires`);
    modale('Commentaires', `${cs.length ? `<ul class="liste-simple">${cs.map((c) => `<li><b>${esc(c.auteur || 'Console')}</b> <span class="note">${esc(quand(c.cree_le))}</span><br>${esc(c.commentaire)}</li>`).join('')}</ul>` : '<p class="note">Aucun commentaire.</p>'}
      <div class="champ"><label class="lbl" for="tc-texte">Nouveau commentaire</label><textarea id="tc-texte"></textarea></div>`,
    [{ label: 'Fermer' }, { label: 'Publier', pri: true, run: enregistrer(() => api('POST', `/taches/${id}/commentaires`, { commentaire: valeur('#tc-texte') }), 'Commentaire publié.') }]);
  });
}
async function vueTaches(v) {
  const f = etat.filtresTaches || (etat.filtresTaches = { moi: roleMoi() !== 'administration', statut: '' });
  const ts = await api('GET', `/taches?${new URLSearchParams({ ...(f.moi ? { moi: '1' } : {}), ...(f.statut ? { statut: f.statut } : {}) })}`);
  v.innerHTML = `<div class="entete"><div><h2>Tâches</h2><p>${esc(pl('{n|# tâche|# tâches}', { n: ts.length }))} · ${ts.filter((t) => t.en_retard).length} en retard. Vous modifiez les tâches qui vous sont attribuées ; l’implantation attribue et réattribue.</p></div></div>
    <div class="ligne filtres"><label class="case"><input type="checkbox" id="ft-moi"${f.moi ? ' checked' : ''}> Mes tâches seulement</label><div class="champ"><label class="lbl" for="ft-statut">Statut</label><select id="ft-statut"><option value="">Tous</option>${options('tache', f.statut)}</select></div></div>
    ${tableauTaches(ts)}`;
  $('#ft-moi').onchange = (e) => { f.moi = e.target.checked; afficher(); };
  $('#ft-statut').onchange = (e) => { f.statut = e.target.value; afficher(); };
  brancherTaches(v, ts);
}

/* ---------------- calendrier ---------------- */
async function vueCalendrier(v) {
  const mois = etat.moisCalendrier || (etat.moisCalendrier = aujourdhuiIso().slice(0, 7));
  const [a, m] = mois.split('-').map(Number);
  const debut = `${mois}-01`; const fin = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  const { evenements } = await api('GET', `/calendrier?debut=${debut}&fin=${fin}`);
  const parJour = {}; for (const e of evenements) (parJour[e.date] = parJour[e.date] || []).push(e);
  const TYPES = { tache: 'Tâche', jalon: 'Jalon', formation: 'Formation', relance: 'Relance', contrat: 'Contrat', facture: 'Facture', ticket: 'Ticket' };
  const titreMois = new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString(L, { month: 'long', year: 'numeric' });
  const decaler = (n) => { const d = new Date(Date.UTC(a, m - 1 + n, 1)); etat.moisCalendrier = d.toISOString().slice(0, 7); afficher(); };
  v.innerHTML = `<div class="entete"><div><h2>Calendrier</h2><p>Échéances de tâches et jalons, séances de formation, relances, préavis de contrat, échéances de factures et de tickets, selon votre rôle.</p></div>
    <div class="ligne serre"><button class="btn" type="button" id="cal-prec">← Mois précédent</button><strong class="mois-cal">${esc(titreMois)}</strong><button class="btn" type="button" id="cal-suiv">Mois suivant →</button></div></div>
    ${Object.keys(parJour).length ? `<ol class="agenda">${Object.keys(parJour).sort().map((d) => `<li class="${d === aujourdhuiIso() ? 'aujourdhui' : ''}"><h3>${esc(jour(d))}</h3><ul>${parJour[d].map((e) => `<li><span class="badge">${esc(TYPES[e.type] || e.type)}</span> <button class="lien-ligne" type="button" data-cal-vue="${esc(e.vue)}">${esc(e.titre)}</button>${e.detail ? ` <span class="note">${esc(e.detail)}</span>` : ''}${e.a_moi ? ' <span class="badge fort">moi</span>' : ''}</li>`).join('')}</ul></li>`).join('')}</ol>`
    : '<div class="panneau-c"><p>Aucune échéance ce mois-ci.</p></div>'}`;
  $('#cal-prec').onclick = () => decaler(-1); $('#cal-suiv').onclick = () => decaler(1);
  v.querySelectorAll('[data-cal-vue]').forEach((b) => { b.onclick = () => { if (!$(`#onglets [data-v="${b.dataset.calVue}"]`)?.hidden) { etat.vue = b.dataset.calVue; etat.hopital = null; etat.projet = null; afficher(); } }; });
}

/* ---------------- support ---------------- */
async function vueSupport(v) {
  const f = etat.filtresSupport || (etat.filtresSupport = { statut: '', type: '', moi: false });
  const [items, hs] = await Promise.all([api('GET', `/support/tickets?${new URLSearchParams({ ...(f.statut ? { statut: f.statut } : {}), ...(f.type ? { type: f.type } : {}), ...(f.moi ? { moi: '1' } : {}) })}`), api('GET', '/hopitaux')]);
  const lignes = items.map((t) => `<tr><td><button class="lien-ligne" type="button" data-action="tk-ouvrir" data-id="${t.id}">${esc(t.titre)}</button>${t.hors_delai ? ` ${etiquette('facture', 'en_retard')}` : ''}</td><td>${esc(t.hopital)}</td><td>${esc(LIB.type_ticket[t.type])}${t.gravite ? ` · ${esc(t.gravite)}` : ''}</td>
    <td>${etiquette('ticket', t.statut)}</td><td>${etiquette('priorite', t.priorite)}</td><td>${esc(t.responsable || '—')}</td><td>${esc(t.echeance ? quand(t.echeance) : '—')}</td></tr>`).join('');
  v.innerHTML = `<div class="entete"><div><h2>Support</h2><p>${esc(pl('{n|# ticket|# tickets}', { n: items.length }))} · ${items.filter((t) => t.hors_delai).length} hors délai. Délai de prise en charge : 4 h (urgente), 24 h (haute), 72 h (normale), 7 jours (basse).</p></div>${bouton('Nouveau ticket', 'tk-nouveau', 'btn pri')}</div>
    <div class="ligne filtres"><div class="champ"><label class="lbl" for="fs-statut">Statut</label><select id="fs-statut"><option value="">Tous</option>${options('ticket', f.statut)}</select></div>
      <div class="champ"><label class="lbl" for="fs-type">Type</label><select id="fs-type"><option value="">Tous</option>${options('type_ticket', f.type)}</select></div><label class="case"><input type="checkbox" id="fs-moi"${f.moi ? ' checked' : ''}> Attribués à moi</label></div>
    ${tableSH(['Sujet', 'Établissement', 'Type', 'Statut', 'Priorité', 'Responsable', 'Échéance'], lignes)}`;
  $('#fs-statut').onchange = (e) => { f.statut = e.target.value; afficher(); };
  $('#fs-type').onchange = (e) => { f.type = e.target.value; afficher(); };
  $('#fs-moi').onchange = (e) => { f.moi = e.target.checked; afficher(); };
  surAction(v, 'tk-nouveau', () => {
    if (!hs.length) { toast('Aucun établissement enregistré.', true); return; }
    modale('Nouveau ticket', `<div class="form-modale"><div class="champ"><label class="lbl" for="tk-hop">Établissement</label><select id="tk-hop">${hs.map((h) => `<option value="${h.id}">${esc(h.nom)}</option>`).join('')}</select></div>
      <div class="ligne"><div class="champ"><label class="lbl" for="tk-type">Type</label><select id="tk-type">${options('type_ticket', 'demande')}</select></div><div class="champ"><label class="lbl" for="tk-grav">Gravité (incident)</label><select id="tk-grav"><option value="mineure">Mineure</option><option value="majeure">Majeure</option><option value="critique">Critique</option></select></div></div>
      ${champ('tk-titre', 'Sujet', '')}${champ('tk-contact', 'Contact à l’établissement', '')}<div class="champ"><label class="lbl" for="tk-desc">Description</label><textarea id="tk-desc"></textarea></div></div>`,
    [{ label: 'Annuler' }, { label: 'Créer', pri: true, run: enregistrer(() => api('POST', '/support/tickets', { hopital_id: Number(valeur('#tk-hop')), type: valeur('#tk-type'), gravite: valeur('#tk-grav'), titre: valeur('#tk-titre'), contact: valeur('#tk-contact'), description: valeur('#tk-desc') }), 'Ticket créé.') }]);
  });
  surAction(v, 'tk-ouvrir', async (id) => {
    const t = await api('GET', `/support/tickets/${id}`);
    const gerer = peut('support');
    modale(t.titre, `<p>${etiquette('ticket', t.statut)} ${etiquette('priorite', t.priorite)} · ${esc(t.hopital)} · ${esc(LIB.type_ticket[t.type])}${t.gravite ? ` ${esc(t.gravite)}` : ''}</p>
      <p class="note">Créé ${esc(quand(t.cree_le))} par ${esc(t.createur || '—')} · échéance ${esc(quand(t.echeance))}${t.contact ? ` · contact ${esc(t.contact)}` : ''}</p>${t.description ? `<p>${esc(t.description)}</p>` : ''}
      ${gerer ? `<div class="ligne"><div class="champ"><label class="lbl" for="tm-statut">Statut</label><select id="tm-statut">${options('ticket', t.statut)}</select></div><div class="champ"><label class="lbl" for="tm-prio">Priorité</label><select id="tm-prio">${options('priorite', t.priorite)}</select></div>${await choixPersonne('tm-resp', t.responsable_id)}</div>
        <div class="champ"><label class="lbl" for="tm-resol">Résolution</label><textarea id="tm-resol">${esc(t.resolution || '')}</textarea></div>` : ''}
      <h4>Échanges</h4>${t.messages.length ? `<ul class="liste-simple">${t.messages.map((m) => `<li><b>${esc(m.auteur || '—')}</b> <span class="note">${esc(quand(m.cree_le))}</span><br>${esc(m.message)}</li>`).join('')}</ul>` : '<p class="note">Aucun échange.</p>'}
      <div class="champ"><label class="lbl" for="tm-msg">Nouveau message (interne)</label><textarea id="tm-msg"></textarea></div>
      <h4>Historique</h4><p class="note">${t.evenements.map((e) => `${esc(quand(e.quand))} · ${esc(e.champ)} : ${esc(e.avant ?? '—')} → ${esc(e.apres ?? '—')} · ${esc(e.par)}`).join('<br>') || 'Aucun changement.'}</p>`,
    [{ label: 'Fermer' }, { label: 'Envoyer le message', run: enregistrer(() => api('POST', `/support/tickets/${id}/messages`, { message: valeur('#tm-msg') }), 'Message ajouté.') },
      ...(gerer ? [{ label: 'Enregistrer', pri: true, run: enregistrer(() => api('PUT', `/support/tickets/${id}`, { statut: valeur('#tm-statut'), priorite: valeur('#tm-prio'), responsable_id: valeur('#tm-resp') || null, resolution: valeur('#tm-resol') }), 'Ticket enregistré.') }] : [])]);
    $('#modale .boite').classList.add('large');
  });
}

/* ---------------- documents ---------------- */
const CATEGORIES_DEPOT = { contrat: ['commercial', 'finance'], devis: ['commercial', 'finance'], facture: ['finance'], technique: ['implantation', 'support'], formation: ['formation', 'implantation'], support: ['support', 'implantation'], general: ['commercial', 'implantation', 'formation', 'support', 'finance'] };
async function vueDocuments(v) {
  const f = etat.filtresDocs || (etat.filtresDocs = { categorie: '' });
  const [docs, hs] = await Promise.all([api('GET', `/documents${f.categorie ? `?categorie=${f.categorie}` : ''}`), api('GET', '/hopitaux')]);
  const deposables = Object.keys(CATEGORIES_DEPOT).filter((c) => peut(...CATEGORIES_DEPOT[c]));
  const taille = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
  const lignes = docs.map((d) => `<tr><td>${esc(d.nom)}${d.confidentiel ? ' <span class="badge fort">confidentiel</span>' : ''}</td><td>${esc(LIB.categorie[d.categorie] || d.categorie)}</td><td>${esc(d.hopital || d.organisation || '—')}</td><td>v${d.version}${d.versions > 1 ? ` <span class="note">(${d.versions})</span>` : ''}</td><td>${esc(taille(d.taille || 0))}</td><td>${esc(d.depose_par_nom || '—')}<div class="note">${esc(quand(d.cree_le))}</div></td>
    <td><div class="ligne serre">${bouton('Télécharger', 'doc-dl', 'btn', d.id)}${deposables.includes(d.categorie) ? bouton('Nouvelle version', 'doc-version', 'btn', d.id) : ''}${bouton('Versions', 'doc-versions', 'btn discret', d.id)}${roleMoi() === 'administration' ? bouton('Archiver', 'doc-archiver', 'btn discret', d.id) : ''}</div></td></tr>`).join('');
  v.innerHTML = `<div class="entete"><div><h2>Documents</h2><p>Fichiers chiffrés au repos, empreinte vérifiée à chaque téléchargement, versions conservées. L’accès dépend de la catégorie et de votre rôle ; chaque dépôt et téléchargement est journalisé.</p></div>${deposables.length ? bouton('Déposer un document', 'doc-depot', 'btn pri') : ''}</div>
    <div class="ligne filtres"><div class="champ"><label class="lbl" for="fd-cat">Catégorie</label><select id="fd-cat"><option value="">Toutes</option>${options('categorie', f.categorie)}</select></div></div>
    ${tableSH(['Document', 'Catégorie', 'Rattaché à', 'Version', 'Taille', 'Déposé par', ''], lignes, 'Aucun document accessible.')}`;
  $('#fd-cat').onchange = (e) => { f.categorie = e.target.value; afficher(); };
  const formulaire = (remplace) => modale(remplace ? `Nouvelle version · ${remplace.nom}` : 'Déposer un document', `<div class="form-modale"><div class="champ"><label class="lbl" for="dd-fichier">Fichier (PDF, PNG, JPEG, DOCX, XLSX, CSV, TXT · 10 Mo au plus)</label><input id="dd-fichier" type="file"></div>
    ${remplace ? '' : `<div class="ligne"><div class="champ"><label class="lbl" for="dd-cat">Catégorie</label><select id="dd-cat">${deposables.map((c) => `<option value="${c}">${esc(LIB.categorie[c])}</option>`).join('')}</select></div>
      <div class="champ"><label class="lbl" for="dd-hop">Établissement</label><select id="dd-hop"><option value="">Aucun</option>${hs.map((h) => `<option value="${h.id}">${esc(h.nom)}</option>`).join('')}</select></div></div>
      ${roleMoi() === 'administration' ? '<label class="case"><input type="checkbox" id="dd-conf"> Confidentiel (administration seulement)</label>' : ''}`}</div>`,
  [{ label: 'Annuler' }, { label: 'Déposer', pri: true, run: enregistrer(async () => {
    const fichier = await lireFichier($('#dd-fichier'));
    await api('POST', '/documents', remplace ? { ...fichier, categorie: remplace.categorie, remplace_id: remplace.id } : { ...fichier, categorie: valeur('#dd-cat'), hopital_id: valeur('#dd-hop') || null, confidentiel: !!$('#dd-conf')?.checked });
  }, 'Document déposé et chiffré.') }]);
  surAction(v, 'doc-depot', () => formulaire(null));
  surAction(v, 'doc-version', (id) => formulaire(docs.find((d) => String(d.id) === String(id))));
  surAction(v, 'doc-dl', (id, b) => agir(b, () => telechargerApi(`/documents/${id}/fichier`, docs.find((d) => String(d.id) === String(id)).nom)));
  surAction(v, 'doc-archiver', (id) => modale('Archiver le document', '<p>Le document sort des listes ; le fichier chiffré et son historique sont conservés.</p>', [{ label: 'Annuler' }, { label: 'Archiver', dan: true, run: enregistrer(() => api('POST', `/documents/${id}/archiver`), 'Document archivé.') }]));
  surAction(v, 'doc-versions', async (id) => {
    const vs = await api('GET', `/documents/${id}/versions`);
    modale('Versions', tableSH(['Version', 'Déposée', 'Par', 'Empreinte SHA-256', ''], vs.map((x) => `<tr><td>v${x.version}${x.archive_le ? ' (archivée)' : ''}</td><td>${esc(quand(x.cree_le))}</td><td>${esc(x.depose_par_nom || '—')}</td><td class="num secret">${esc(String(x.empreinte || '').slice(0, 16))}…</td><td>${bouton('Télécharger', 'ver-dl', 'btn', x.id)}</td></tr>`).join('')), [{ label: 'Fermer', pri: true }]);
    surAction($('#modale'), 'ver-dl', (vid, b) => agir(b, () => telechargerApi(`/documents/${vid}/fichier`, vs.find((x) => String(x.id) === String(vid)).nom)));
  });
}

/* ---------------- hébergement ---------------- */
async function vueHebergement(v) {
  const h = await api('GET', '/hebergement');
  const lignes = h.environnements.map((e) => {
    const r = e.dernier_releve;
    return `<tr><td><b>${esc(e.nom)}</b><div class="note">${esc(e.public || '')}</div></td><td>${r ? `<span class="etat-niveau ${r.ok ? 'n-vert' : 'n-rouge'}">${r.ok ? 'répond' : esc(r.detail || 'en panne')}</span><div class="note">${esc(quand(r.quand))}</div>` : '<span class="note">aucun relevé</span>'}</td>
      <td>${esc(r?.version || '—')}</td><td class="num">${e.disponibilite_24h == null ? '—' : `${esc(e.disponibilite_24h)} %`}<div class="note">${esc(pl('{n|# relevé|# relevés}', { n: e.releves_24h }))}</div></td><td class="num">${e.latence_moyenne_ms == null ? '—' : `${esc(e.latence_moyenne_ms)} ms`}</td>
      <td>${esc(e.hopitaux_actifs)} / ${esc(e.hopitaux)}</td><td>${e.sauvegarde ? `${esc(quand(e.sauvegarde.derniere))}<div class="note">${esc(e.sauvegarde.taille_lisible || '')}${e.sauvegarde.empreinte_ok === false ? ' · empreinte invalide' : ''}</div>` : '<span class="note">non suivi</span>'}</td></tr>`;
  }).join('');
  v.innerHTML = `<div class="entete"><div><h2>Hébergement</h2><p>Environnements reliés à la console : santé relevée toutes les 5 minutes (base et service), disponibilité sur 24 heures, version déployée, établissements actifs et dernière sauvegarde.</p></div>${bouton('Vérifier maintenant', 'heb-verifier', 'btn pri')}</div>
    ${tableSH(['Environnement', 'État', 'Version', 'Disponibilité 24 h', 'Latence', 'Établissements actifs', 'Dernière sauvegarde'], lignes, 'Aucun environnement relié.')}
    <p class="note">${h.sauvegardes.configure ? (h.sauvegardes.illisible ? 'Le fichier d’état des sauvegardes est illisible.' : `État des sauvegardes généré ${esc(quand(h.sauvegardes.genere_le))}.`) : 'Le suivi des sauvegardes n’est pas configuré (SH_SAUVEGARDES_ETAT) : aucune valeur n’est affichée par défaut.'} Console SH ${esc(h.console.version)} · Node ${esc(h.console.node)}.</p>`;
  surAction(v, 'heb-verifier', (id, b) => agir(b, () => api('POST', '/hebergement/verifier'), (r) => r.map((x) => `${x.code} : ${x.ok ? 'répond' : x.detail}`).join(' · ')));
}

/* ---------------- rapports ---------------- */
async function vueRapports(v) {
  const r = await api('GET', '/rapports/indicateurs');
  const barres = (lignes, cle, libelle, valeurTexte = (x) => x[cle]) => {
    const max = Math.max(1, ...lignes.map((x) => Number(x[cle]) || 0));
    return `<ul class="barres">${lignes.map((x) => `<li><span>${esc(libelle(x))}</span><span class="barre-fond"><i style="width:${Math.round((100 * (Number(x[cle]) || 0)) / max)}%"></i></span><span class="num">${esc(valeurTexte(x))}</span></li>`).join('')}</ul>`;
  };
  const blocs = [];
  if (r.pipeline) {
    const ordre = Object.keys(LIB.opp); const pipeline = ordre.map((s) => r.pipeline.find((p) => p.statut === s) || { statut: s, n: 0, valeur: 0, ponderee: 0 });
    blocs.push(`<article class="carte"><h3>Pipeline commercial</h3>${barres(pipeline, 'valeur', (x) => `${LIB.opp[x.statut]} (${x.n})`, (x) => argent(x.valeur))}<p class="note">Taux de conversion : ${r.taux_conversion == null ? '—' : `${esc(r.taux_conversion)} %`} · relances en retard : ${esc(r.relances_en_retard)}</p>
      <p class="note">Contrats actifs ${esc(r.contrats.actifs)} · en cours ${esc(r.contrats.en_cours)} · préavis sous 90 jours ${esc(r.contrats.a_renouveler)}</p>${peut('commercial', 'finance') ? bouton('Exporter le pipeline (CSV)', 'exp-pipeline') : ''}</article>`);
  }
  if (r.factures) {
    blocs.push(`<article class="carte"><h3>Facturation</h3>${barres(r.factures.filter((f) => f.etat !== 'brouillon'), 'total', (x) => `${LIB.facture[x.etat]} (${x.n})`, (x) => argent(x.total, x.devise))}<p class="note">Revenu mensuel récurrent : ${r.mrr.map((m) => esc(argent(m.mrr, m.devise))).join(' · ') || '—'} · délai moyen de paiement : ${r.delai_moyen_paiement_jours == null ? '—' : `${esc(r.delai_moyen_paiement_jours)} jours`}</p>${bouton('Exporter les factures (CSV)', 'exp-factures')}</article>`);
  }
  if (r.projets) {
    blocs.push(`<article class="carte"><h3>Implantation</h3>${barres(r.projets, 'n', (x) => LIB.projet[x.statut] || x.statut)}<p class="note">Tâches ouvertes ${esc(r.taches.ouvertes)} · en retard ${esc(r.taches.en_retard)} · terminées ${esc(r.taches.terminees)}</p>
      <h4>Formation par établissement</h4>${barres(r.formation, 'faits', (x) => x.nom, (x) => `${x.faits}/${x.elements} · ${pl('{n|aucun participant validé|# participant validé|# participants validés}', { n: x.participants_valides })}`)}</article>`);
  }
  if (r.support) blocs.push(`<article class="carte"><h3>Support</h3><p>Ouverts ${esc(r.support.ouverts)} · hors délai ${esc(r.support.hors_delai)} · incidents ouverts ${esc(r.support.incidents_ouverts)}</p><p class="note">Résolution moyenne : ${r.support.resolution_moyenne_heures == null ? '—' : `${esc(r.support.resolution_moyenne_heures)} h`}</p>${bouton('Exporter les tickets (CSV)', 'exp-support')}</article>`);
  v.innerHTML = `<div class="entete"><div><h2>Rapports</h2><p>Indicateurs calculés à la demande depuis la base SH (${esc(quand(r.genere_le))}) ; aucune valeur de démonstration. Les sections dépendent de votre rôle.</p></div></div><div class="grille-rapports">${blocs.join('') || '<p class="note">Aucun indicateur pour votre rôle.</p>'}</div>`;
  for (const s of ['pipeline', 'factures', 'support']) surAction(v, `exp-${s}`, (id, b) => agir(b, () => telechargerApi(`/rapports/export?section=${s}`, `arrimo-sh-${s}.csv`)));
}

/* ---------------- équipe : équipes et permissions (complète l'écran Équipe SH de sh.js) ---------------- */
async function completerEquipe(v) {
  const [equipes, perso, matrice] = await Promise.all([api('GET', '/equipes'), personnel(), api('GET', '/permissions')]);
  const zone = document.createElement('div');
  zone.innerHTML = `<h3>Équipes</h3>${tableSH(['Équipe', 'Membres', ''], equipes.map((e) => `<tr><td><b>${esc(e.nom)}</b><div class="note">${esc(e.description || '')}</div></td><td>${e.membres.map((m) => `${esc(m.nom)}${m.chef ? ' <span class="badge">chef</span>' : ''}`).join(', ') || '—'}</td><td>${bouton('Modifier', 'eq-modifier', 'btn', e.id)}</td></tr>`).join(''), 'Aucune équipe.')}
    <div class="ligne">${bouton('Nouvelle équipe', 'eq-nouvelle')}</div>
    <details class="matrice"><summary>Matrice des permissions par rôle (${matrice.routes.length} actions)</summary>${tableSH(['Action', ...matrice.roles.map((r) => LIB.role[r] || r)], matrice.routes.map((x) => `<tr><td class="num">${esc(x.route)}</td>${matrice.roles.map((r) => `<td>${x.roles.includes(r) ? '✓' : ''}</td>`).join('')}</tr>`).join(''))}</details>`;
  v.appendChild(zone);
  const formulaire = (e) => modale(e ? `Équipe · ${e.nom}` : 'Nouvelle équipe', `<div class="form-modale">${champ('eq-nom', 'Nom', e?.nom || '')}${champ('eq-desc', 'Description', e?.description || '')}
    <fieldset class="membres"><legend>Membres</legend>${perso.map((p) => { const m = e?.membres.find((x) => x.utilisateur_id === p.id); return `<div class="ligne serre"><label class="case"><input type="checkbox" data-membre="${p.id}"${m ? ' checked' : ''}> ${esc(p.nom)} · ${esc(LIB.role[p.role] || p.role)}</label><label class="case"><input type="checkbox" data-chef="${p.id}"${m?.chef ? ' checked' : ''}> chef</label></div>`; }).join('')}</fieldset></div>`,
  [{ label: 'Annuler' }, { label: 'Enregistrer', pri: true, run: enregistrer(() => {
    const membres = [...document.querySelectorAll('#modale [data-membre]')].filter((x) => x.checked).map((x) => ({ utilisateur_id: Number(x.dataset.membre), chef: document.querySelector(`#modale [data-chef="${x.dataset.membre}"]`).checked }));
    return api(e ? 'PUT' : 'POST', e ? `/equipes/${e.id}` : '/equipes', { nom: valeur('#eq-nom'), description: valeur('#eq-desc'), membres });
  }, 'Équipe enregistrée.') }]);
  surAction(zone, 'eq-nouvelle', () => formulaire(null));
  surAction(zone, 'eq-modifier', (id) => formulaire(equipes.find((e) => String(e.id) === String(id))));
  traduireNoeuds(zone);
}

/* ---------------- fiche hôpital : séances de formation et suivi 360 (complète vueHopital de sh.js) ---------------- */
async function completerHopital(v, h) {
  const zone = document.createElement('div');
  zone.className = 'pile complement-hopital';
  const [suivi, sessions] = await Promise.all([api('GET', `/hopitaux/${h.id}/suivi`), peut('implantation', 'formation') ? api('GET', `/hopitaux/${h.id}/formation/sessions`) : null]);
  const blocs = [];
  if (sessions) {
    blocs.push(`<div class="panneau-c" id="seances"><h3>Séances de formation</h3>${sessions.length ? sessions.map((s) => `<details class="seance"><summary><b>${esc(s.titre)}</b> · ${esc(quand(s.debut))} · ${esc(s.statut)} · ${s.participants.filter((p) => p.valide).length}/${s.participants.length} ${s.participants.filter((p) => p.valide).length > 1 ? 'validés' : 'validé'}</summary>
      <p class="note">${esc(s.lieu || '')}${s.formateur ? ` · ${esc(s.formateur)}` : ''} · ${esc(s.duree_minutes)} min</p>
      ${tableSH(['Participant', 'Présent', 'Validé'], s.participants.map((p) => `<tr><td>${esc(p.nom)}<div class="note">${esc(p.courriel || '')}</div></td><td><input type="checkbox" data-present="${p.id}"${p.present ? ' checked' : ''} aria-label="Présence de ${esc(p.nom)}"></td><td><input type="checkbox" data-valide="${p.id}"${p.valide ? ' checked' : ''} aria-label="Validation de ${esc(p.nom)}"></td></tr>`).join(''), 'Aucun participant.')}
      <div class="ligne serre">${bouton('Inscrire les comptes Arrimo du rôle', 'ss-comptes', 'btn', s.id)}${bouton('Ajouter un participant', 'ss-ajout', 'btn', s.id)}${s.statut === 'planifiee' ? bouton('Marquer réalisée', 'ss-realisee', 'btn', s.id) : ''}</div></details>`).join('') : '<p class="note">Aucune séance planifiée.</p>'}
      ${bouton('Planifier une séance', 'ss-nouvelle', 'btn pri')}</div>`);
  }
  blocs.push(`<div class="panneau-c"><h3>Suivi de l’établissement</h3><p class="note">${suivi.organisation ? `Organisation CRM : ${esc(suivi.organisation.nom)} (${esc(suivi.organisation.type)})` : 'Aucune organisation CRM liée.'}</p>
    <p>${suivi.projets.map((p) => `Projet ${esc(p.nom)} · ${etiquette('projet', p.statut)} · ${p.avancement} %`).join('<br>') || '<span class="note">Aucun projet.</span>'}</p>
    ${suivi.contrats ? `<p class="note">Contrats : ${suivi.contrats.map((c) => `${esc(c.reference)} (${esc(LIB.contrat[c.statut])})`).join(' · ') || 'aucun'}</p>` : ''}
    ${suivi.tickets ? `<p class="note">Tickets ouverts : ${suivi.tickets.filter((t) => !['resolu', 'ferme'].includes(t.statut)).length} sur ${suivi.tickets.length}</p>` : ''}
    ${suivi.factures ? `<p class="note">Factures : ${suivi.factures.map((f) => `${esc(f.numero || 'brouillon')} ${esc(LIB.facture[f.etat])}`).join(' · ') || 'aucune'}</p>` : ''}
    <p class="note">Documents : ${suivi.documents.map((d) => esc(d.nom)).join(' · ') || 'aucun'}</p></div>`);
  zone.innerHTML = blocs.join('');
  v.appendChild(zone);
  zone.querySelectorAll('[data-present]').forEach((c) => { c.onchange = () => agir(null, () => api('PUT', `/formation/participants/${c.dataset.present}`, { present: c.checked, ...(c.checked ? {} : { valide: false }) })); });
  zone.querySelectorAll('[data-valide]').forEach((c) => { c.onchange = () => agir(null, () => api('PUT', `/formation/participants/${c.dataset.valide}`, { valide: c.checked, ...(c.checked ? { present: true } : {}) }), c.checked ? 'Participant validé.' : null); });
  surAction(zone, 'ss-comptes', (id, b) => agir(b, () => api('POST', `/formation/sessions/${id}/participants`, { depuis_comptes: true }), (r) => pl('{n|aucun nouveau participant|# participant inscrit|# participants inscrits}', { n: r.ajoutes })));
  surAction(zone, 'ss-realisee', (id, b) => agir(b, () => api('PUT', `/formation/sessions/${id}`, { statut: 'realisee' }), 'Séance réalisée.'));
  surAction(zone, 'ss-ajout', (id) => modale('Ajouter un participant', `${champ('sp-nom', 'Nom', '')}${champ('sp-courriel', 'Courriel', '', 'type="email"')}`, [{ label: 'Annuler' }, { label: 'Ajouter', pri: true, run: enregistrer(() => api('POST', `/formation/sessions/${id}/participants`, { participants: [{ nom: valeur('#sp-nom'), courriel: valeur('#sp-courriel') }] }), 'Participant ajouté.') }]));
  surAction(zone, 'ss-nouvelle', async () => modale('Planifier une séance', `<div class="form-modale"><div class="ligne"><div class="champ"><label class="lbl" for="sn-role">Rôle formé</label><select id="sn-role"><option value="coordination">Coordination des lits</option><option value="urgence">Urgence</option><option value="entretien">Entretien</option><option value="administration">Administration</option></select></div>
    ${champ('sn-debut', 'Début', '', 'type="datetime-local"')}${champ('sn-duree', 'Durée (min)', 90, 'type="number" min="15" max="600"')}</div>${champ('sn-titre', 'Titre', '')}${champ('sn-lieu', 'Lieu', '')}${await choixPersonne('sn-form', etat.moi.utilisateur.id, 'Formateur')}</div>`,
  [{ label: 'Annuler' }, { label: 'Planifier', pri: true, run: enregistrer(() => api('POST', `/hopitaux/${h.id}/formation/sessions`, { role: valeur('#sn-role'), debut: valeur('#sn-debut') ? new Date(valeur('#sn-debut')).toISOString() : '', duree_minutes: Number(valeur('#sn-duree')), titre: valeur('#sn-titre'), lieu: valeur('#sn-lieu'), formateur_id: valeur('#sn-form') || null }), 'Séance planifiée.') }]));
  traduireNoeuds(zone);
}
