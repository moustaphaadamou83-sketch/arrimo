/* Console SH : écrans ERP (CRM, devis et contrats, facturation, projets, tâches, calendrier, support, documents,
 * hébergement, rapports, équipes, notifications). Chargé après sh.js, dont il réutilise les outils (api, modale, agir…).
 * Chaque action vise un identifiant (data-id), jamais une position dans une liste filtrée. Aucun script en ligne. */

/* ---------------- outils communs ---------------- */
const bouton = (libelle, action, classe = 'btn', id = '') => `<button class="${classe}" type="button" data-action="${action}"${id !== '' ? ` data-id="${esc(id)}"` : ''}>${esc(libelle)}</button>`;
function tableSH(headers, rows, vide = 'Aucune donnée enregistrée.') {
  return `<div class="tableau"><table><thead><tr>${headers.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="note">${esc(vide)}</td></tr>`}</tbody></table></div>`;
}
const argent = (n, devise = 'CAD') => {
  if(n==null||n==='')return '—';
  return window.ArrimoShFinances.formatterMontant(n,devise,L);
};
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
  tache: { a_faire: 'À faire', en_cours: 'En cours', bloquee: 'Bloquée', en_validation: 'En validation', terminee: 'Terminée', annulee: 'Annulée' },
  projet: { planification: 'Planification', en_cours: 'En cours', en_attente: 'En attente', suspendu: 'Suspendu', bloque: 'Bloqué', termine: 'Terminé', annule: 'Annulé' },
  ticket: { ouvert: 'Ouvert', assigne: 'Assigné', en_cours: 'En cours', en_attente: 'En attente', resolu: 'Résolu', ferme: 'Fermé' },
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
  const r = await fetch(`${BASE_SH}/api${chemin}`, { headers: { Authorization: `Bearer ${etat.token}` } });
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
const referencesInternationalesCache=new Map();
async function referencesInternationales(){
  const langue=document.documentElement.lang.startsWith('en')?'en':'fr';
  if(!referencesInternationalesCache.has(langue))referencesInternationalesCache.set(langue,await api('GET','/references/internationales'));
  return referencesInternationalesCache.get(langue);
}
async function personnel() { if (!personnelCache) personnelCache = await api('GET', '/personnel').catch(() => []); return personnelCache; }
const choixPersonne = (id, choisi, libelle = 'Responsable') => personnel().then((ps) => `<div class="champ"><label class="lbl" for="${id}">${esc(libelle)}</label><select id="${id}"><option value="">Non attribué</option>${ps.map((p) => `<option value="${p.id}" data-presence-option="${p.id}" data-nom="${esc(p.nom)}" data-role="${esc(LIB.role[p.role]||p.role)}"${Number(choisi) === p.id ? ' selected' : ''}>${esc(p.nom)} · ${esc(LIB.role[p.role] || p.role)} · ${esc(libellePresence(p.presence))}</option>`).join('')}</select><label class="case"><input type="checkbox" data-disponibles-pour="${id}">Employés disponibles seulement</label></div>`);
const choixMembresProjet=(id,membres)=>personnel().then(ps=>`<fieldset id="${id}"><legend>Équipe du projet</legend>${ps.map(p=>`<label class="case"><input type="checkbox" value="${p.id}"${membres.map(Number).includes(p.id)?' checked':''}>${esc(p.nom)}</label>`).join('')}</fieldset>`);
const membresProjetSelectionnes=selecteur=>[...$(selecteur).querySelectorAll('input:checked')].map(x=>Number(x.value));

/* ---------------- onglets et notifications ---------------- */
const ONGLETS_ROLES = {
  accueil: null, hopitaux: null, taches: null, calendrier: null, documents: null, rapports: null, compte: null,
  crm: ['commercial', 'finance'], demandes: ['commercial'], contrats: ['commercial', 'finance'], facturation: ['finance'],
  projets: ['implantation', 'support', 'formation'], support: ['support', 'implantation'], hebergement: ['implantation', 'support'],
  journal: ['implantation', 'support'], equipe: [], parametres: [],
};
function reglerOnglets() {
  const routes={accueil:'GET /rapports/indicateurs',hopitaux:'GET /hopitaux',taches:'GET /taches',calendrier:'GET /calendrier',documents:'GET /documents',rapports:'GET /rapports/indicateurs',crm:'GET /crm/organisations',demandes:'GET /demandes-site',contrats:'GET /crm/contrats',facturation:'GET /facturation/factures',projets:'GET /projets',support:'GET /support/tickets',hebergement:'GET /hebergement',journal:'GET /journal',equipe:'GET /equipe',parametres:'GET /parametres'};
  const u=etat.moi.utilisateur;
  for (const [vue, roles] of Object.entries(ONGLETS_ROLES)) {
    const b = $(`#onglets [data-v="${vue}"]`);
    if (b) b.hidden = (roles !== null && !peut(...roles)) || (u.role_personnalise_id&&vue!=='compte'&&!u.droits_personnalises?.includes(routes[vue]));
  }
  if ($(`#onglets [data-v="${etat.vue}"]`)?.hidden) etat.vue = $('#onglets button:not([hidden])')?.dataset.v||'compte';
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
  surAction(v, 'org-nouvelle', async () => {try{
    const refs=await referencesInternationales();
    modale('Nouvelle organisation', `<div class="form-modale">${champ('o-nom', 'Nom', '')}${champ('o-site', 'Site Web', '', 'type="url"')}
    <div class="ligne">${champ('o-ville', 'Ville', '')}${champ('o-region', 'Province / région fiscale', '')}<div class="champ"><label class="lbl" for="o-pays">Pays (ISO)</label><select id="o-pays">${refs.pays.map(p=>`<option value="${esc(p.code)}"${p.code==='CA'?' selected':''}>${esc(p.nom)} (${esc(p.code)})</option>`).join('')}</select></div></div><p class="note">La région sert à sélectionner le lieu de fourniture fiscal; une facture peut être bloquée si elle manque.</p>${champ('o-adresse', 'Adresse', '')}${champ('o-fact', 'Courriel de facturation', '', 'type="email"')}</div>`,
  [{ label: 'Annuler' }, { label: 'Créer', pri: true, run: enregistrer(() => {if(valeur('#o-pays')==='CA'&&!valeur('#o-region').trim())throw new Error('Indiquez la province ou région fiscale avant de créer le client.');return api('POST', '/crm/organisations', { nom: valeur('#o-nom'), site_web: valeur('#o-site'), ville: valeur('#o-ville'), region: valeur('#o-region'), pays_code: valeur('#o-pays'), adresse: valeur('#o-adresse'), courriel_facturation: valeur('#o-fact')});}, 'Organisation créée.') }]);
  }catch(e){toast(e.message,true);}});
  surAction(v, 'opp-nouvelle', async () => {
    if (!orgs.length) { toast('Créez d’abord une organisation.', true); return; }
    try{
    const refs=await referencesInternationales();
    modale('Nouvelle opportunité', `<div class="form-modale"><div class="champ"><label class="lbl" for="p-org">Organisation</label><select id="p-org">${orgs.map((o) => `<option value="${o.id}">${esc(o.nom)}</option>`).join('')}</select></div>
      ${champ('p-titre', 'Titre', '')}<div class="champ"><label class="lbl" for="p-devise">Devise</label><select id="p-devise"><option value="">Choisir une devise</option>${refs.devises.map(d=>`<option value="${esc(d.code)}">${esc(d.code)} · ${esc(d.nom)} · ${esc(d.symbole)}${d.base!==10||d.decimales>2?' · '+esc(traduireTexte('Facturation indisponible')):''}</option>`).join('')}</select><p class="note">Aucune conversion automatique de devises.</p></div><div class="ligne">${champ('p-montant', 'Valeur estimée', '', 'type="number" min="0" step="0.01"')}${champ('p-proba', 'Probabilité (%)', '20', 'type="number" min="0" max="100"')}${champ('p-echeance', 'Décision attendue', '', 'type="date"')}</div>
      ${await choixPersonne('p-resp', etat.moi.utilisateur.id)}${champ('p-action', 'Prochaine action', '')}</div>`,
    [{ label: 'Annuler' }, { label: 'Créer', pri: true, run: enregistrer(() => api('POST', '/crm/opportunites', { organisation_id: Number(valeur('#p-org')), titre: valeur('#p-titre'), montant: valeur('#p-montant') || null,devise:valeur('#p-devise'), probabilite: Number(valeur('#p-proba') || 0), echeance: valeur('#p-echeance') || null, responsable_id: valeur('#p-resp') || null, prochaine_action: valeur('#p-action') }), 'Opportunité créée.') }]);
    const actualiserDevise=()=>{const org=orgs.find(o=>String(o.id)===valeur('#p-org'));$('#p-devise').value=refs.pays.find(p=>p.code===org?.pays_code)?.devise_defaut||'';};
    $('#p-org').onchange=actualiserDevise;actualiserDevise();
    }catch(e){toast(e.message,true);}
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
  const [resume, abonnements, factures, tarifs, orgs, taxes, profilsTaxes, tauxChange, margesProjets] = await Promise.all([api('GET', '/facturation/resume'), api('GET', '/facturation/abonnements'), api('GET', `/facturation/factures${etat.filtreFacture ? `?etat=${etat.filtreFacture}` : ''}`), api('GET', '/tarifs'), api('GET', '/crm/organisations'), api('GET','/facturation/taxes'),api('GET','/facturation/profils-fiscaux'),api('GET','/facturation/change'),api('GET','/finances/projets')]);
  const tot = (etatF) => resume.etats.filter((e) => e.etat === etatF);
  const cartes = [['Revenu mensuel récurrent', resume.mrr.map((m) => argent(m.mrr, m.devise)).join(' · ') || argent(0)], ['Encaissé ce mois', resume.encaisse_mois.map((m) => argent(m.total, m.devise)).join(' · ') || argent(0)],
    ['Solde à recevoir', [...tot('emise'), ...tot('partiellement_payee'), ...tot('en_retard')].reduce((n, e) => n + Number(e.solde), 0)], ['En retard', tot('en_retard').reduce((n, e) => n + e.n, 0)], ['Abonnements à facturer', resume.abonnements_a_facturer]];
  const lignesF = factures.map((f) => `<tr><td>${esc(f.numero || `Brouillon ${f.id}`)}</td><td>${esc(f.client)}</td><td>${etiquette('facture', f.etat)}</td><td class="num">${esc(argent(f.total, f.devise))}</td><td class="num">${esc(argent(f.solde, f.devise))}</td><td>${esc(f.echeance_le ? jour(f.echeance_le) : '—')}</td>
    <td><div class="ligne serre">${f.statut === 'brouillon' ? bouton('Émettre', 'f-emettre', 'btn pri', f.id) : ''}${f.statut === 'emise' && Number(f.solde) > 0 ? bouton('Paiement', 'f-payer', 'btn', f.id) : ''}${f.statut !== 'brouillon' ? bouton('PDF', 'f-pdf', 'btn', f.id) : ''}${f.statut !== 'annulee' && Number(f.paye) === 0 ? bouton('Annuler', 'f-annuler', 'btn discret', f.id) : ''}${bouton('Détail', 'f-detail', 'btn discret', f.id)}</div></td></tr>`).join('');
  const lignesA = abonnements.map((a) => `<tr><td>${esc(a.libelle)}</td><td>${esc(a.contrat)}</td><td>${esc(LIB.periodicite[a.periodicite])}</td><td class="num">${esc(argent(a.montant_periode, a.devise))} HT</td><td>${esc(jour(a.prochaine_facture_le))}</td><td>${esc(a.statut)}</td>
    <td><div class="ligne serre">${a.statut === 'actif' ? bouton('Facturer la période', 'a-facturer', 'btn', a.id) + bouton('Suspendre', 'a-suspendre', 'btn discret', a.id) : a.statut === 'suspendu' ? bouton('Réactiver', 'a-reactiver', 'btn', a.id) : ''}</div></td></tr>`).join('');
  const lignesT = tarifs.map((t) => `<tr><td>${esc(t.code)}</td><td>${esc(t.libelle)}</td><td class="num">${esc(argent(t.prix_unitaire))}</td><td>${esc(LIB.periodicite[t.periodicite])}</td><td>${t.taxable ? 'oui' : 'non'}</td><td>${t.actif ? 'actif' : 'inactif'}</td></tr>`).join('');
  const lignesTaxes=taxes.map(t=>`<tr><td>${esc(t.pays_code)} / ${esc(t.region)}</td><td>${esc(t.code)} · ${esc(t.nom)}</td><td class="num">${esc(t.taux)} %</td><td>${esc(jourIso(t.valide_de))} → ${esc(t.valide_jusqua?jourIso(t.valide_jusqua):'sans échéance')}</td><td>${t.source_url?`<a href="${esc(t.source_url)}" target="_blank" rel="noopener">${esc(t.source_nom)}</a>`:'—'}<div class="note">Vérifié : ${esc(jourIso(t.verifie_le)||'—')}</div></td><td>${bouton('Modifier la règle','tax-edit','btn discret',t.id)}</td></tr>`).join('');
  const lignesProfils=profilsTaxes.map(p=>`<tr><td>${esc(p.pays_code)} / ${esc(p.region)}</td><td>${esc(p.statut)}</td><td>${esc(p.source_nom||'—')}<div class="note">${esc(p.motif||'')}</div></td><td>${esc(jour(p.verifie_le)||'—')}</td><td>${bouton(p.statut==='valide'?'Réviser le profil':'Vérifier le profil','tax-profile-edit','btn discret',p.id)}</td></tr>`).join('');
  v.innerHTML = `<div class="entete"><div><h2>Facturation</h2><p>Factures numérotées sans trou à l’émission, taxes selon la province du client, paiements partiels et relances par échéance.</p></div>
    <div class="ligne serre">${bouton('Générer les factures dues', 'f-generer', 'btn pri')}${bouton('Nouvelle facture', 'f-nouvelle')}${bouton('Export CSV', 'f-export')}</div></div>
    <div class="cartes-kpi">${cartes.map(([n, x]) => `<article class="carte"><span class="note">${esc(n)}</span><strong>${esc(typeof x === 'number' && n === 'Solde à recevoir' ? argent(x) : x)}</strong></article>`).join('')}</div>
    <div class="ligne filtres"><div class="champ"><label class="lbl" for="ff-etat">État</label><select id="ff-etat"><option value="">Toutes</option>${options('facture', etat.filtreFacture)}</select></div></div>
    <h3>Factures</h3>${tableSH(['Numéro', 'Client', 'État', 'Total', 'Solde', 'Échéance', 'Actions'], lignesF)}
    <h3>Abonnements</h3>${tableSH(['Abonnement', 'Contrat', 'Périodicité', 'Montant', 'Prochaine facture', 'Statut', ''], lignesA, 'Les abonnements sont créés à la signature d’un contrat.')}
    <h3>Grille tarifaire</h3>${tableSH(['Code', 'Libellé', 'Prix', 'Périodicité', 'Taxable', 'État'], lignesT)}<div class="ligne">${bouton('Ajouter ou modifier un tarif', 't-edit')}</div>
    <h3>Profils fiscaux par pays et région</h3><p class="note">Une région sans profil validé bloque la facturation. Une exonération doit être explicite, datée et sourcée.</p>${tableSH(['Pays / région', 'État', 'Source et justification', 'Vérifié le', ''],lignesProfils,'Aucun profil fiscal.')}<div class="ligne">${bouton('Ajouter un profil fiscal','tax-profile-new')}</div>
    <h3>Marges par projet</h3><p class="note">Revenus facturés hors taxes moins coûts réels, par devise et sans conversion. Les projets sans budget, coût ni facture n’apparaissent pas.</p>${tableSH(['Projet','Hôpital','Devise','Budget','Coût réel','Revenus HT','Marge','Taux'],margesProjets.flatMap(pj=>pj.synthese.map(s=>`<tr><td>${esc(pj.reference)} · ${esc(pj.nom)}</td><td>${esc(pj.hopital||'—')}</td><td>${esc(s.devise)}</td><td class="num">${esc(argent(s.budget,s.devise))}</td><td class="num">${esc(argent(s.cout_reel,s.devise))}</td><td class="num">${esc(argent(s.revenus,s.devise))}</td><td class="num">${esc(argent(s.marge,s.devise))}</td><td class="num">${esc(pct(s.taux_marge))}</td></tr>`)).join(''),'Aucun projet avec données financières.')}
    <h3>Taux de change officiels</h3><p class="note">Source : <a href="${esc(tauxChange.source.url)}" target="_blank" rel="noopener">${esc(tauxChange.source.nom)}</a>, taux moyens quotidiens. Un taux publié n’est jamais modifié; une devise non publiée par la Banque du Canada n’a aucun taux. À l’émission, l’équivalent en CAD est figé à titre informatif avec le taux publié au plus ${esc(tauxChange.anciennete_max_jours)} jours plus tôt.</p>${tableSH(['Devise','Jour','CAD par unité','Série'],tauxChange.derniers.map(t=>`<tr><td>${esc(t.devise)}</td><td>${esc(jourIso(t.jour))}</td><td class="num">${esc(Number(t.cad_par_unite))}</td><td>${esc(t.serie)}</td></tr>`).join(''),'Aucun taux importé.')}<div class="ligne">${bouton('Actualiser depuis la Banque du Canada','change-actualiser')}</div>
    <h3>Règles de taxe avec dates d’effet et sources</h3>${tableSH(['Juridiction','Taxe','Taux','Période','Source officielle',''],lignesTaxes,'Aucun taux fiscal sourcé.')}<div class="ligne">${bouton('Ajouter un taux sourcé','tax-new')}</div>`;
  $('#ff-etat').onchange = (e) => { etat.filtreFacture = e.target.value; afficher(); };
  await barreFiltres(v, 'facturation', { etat: etat.filtreFacture || '' }, (f) => { etat.filtreFacture = f.etat || ''; });
  surAction(v, 'f-generer', (id, b) => agir(b, () => api('POST', '/facturation/generer'), (r) => pl('{n|aucune facture due|# facture préparée en brouillon|# factures préparées en brouillon}', { n: r.factures_creees })+(r.bloquees?.length?` · Abonnements bloqués par le profil fiscal : ${r.bloquees.length}`:'')));
  surAction(v, 'change-actualiser', (id, b) => agir(b, () => api('POST', '/facturation/change/actualiser', {}), 'Taux de change actualisés.'));
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
      <p class="note">Sous-total ${esc(argent(f.sous_total, f.devise))} · ${f.taxes.map((t) => `${esc(t.nom)} ${esc(t.taux)} % ${esc(argent(t.montant, f.devise))}${t.source_nom?` · <a href="${esc(t.source_url)}" target="_blank" rel="noopener">${esc(t.source_nom)}</a> · en vigueur du ${esc(jourIso(t.valide_de))}${t.valide_jusqua?` au ${esc(jourIso(t.valide_jusqua))}`:' (sans échéance)'} · vérifié ${esc(jourIso(t.verifie_le))}`:''}`).join(' · ') || 'aucune taxe'} · total ${esc(argent(f.total, f.devise))}</p>${f.change?`<p class="note">${f.change.indisponible?'Équivalent en dollars canadiens non indiqué : aucun taux officiel récent de la Banque du Canada pour cette devise.':`Équivalent informatif : ${esc(argent(f.change.total_cad,'CAD'))} au taux ${esc(f.change.cad_par_unite)} CAD/${esc(f.change.devise)} du ${esc(f.change.jour)} · <a href="${esc(f.change.source_url)}" target="_blank" rel="noopener">${esc(f.change.source_nom)}</a> (${esc(f.change.serie)})`}</p>`:''}
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
  const sourcesTaxe=`${champ('tx-source','Organisme source','')}${champ('tx-url','URL officielle','', 'type="url" placeholder="https://…"')}${champ('tx-motif','Justification / fourniture concernée','')}`;
  surAction(v,'tax-profile-new',()=>modale('Nouveau profil fiscal',`<div class="form-modale"><div class="ligne">${champ('tp-pays','Pays ISO','')}${champ('tp-region','Région / province ISO','', 'placeholder="QC ou *"')}</div><div class="champ"><label class="lbl" for="tp-statut">État</label><select id="tp-statut"><option value="a_verifier">À vérifier</option><option value="valide">Validé</option><option value="exonere">Exonéré</option></select></div>${sourcesTaxe}</div>`,[{label:'Annuler'},{label:'Créer le profil',pri:true,run:enregistrer(()=>api('POST','/facturation/profils-fiscaux',{pays_code:valeur('#tp-pays'),region:valeur('#tp-region'),statut:valeur('#tp-statut'),source_nom:valeur('#tx-source'),source_url:valeur('#tx-url'),motif:valeur('#tx-motif')}),'Profil fiscal créé.')} ]));
  surAction(v,'tax-profile-edit',id=>{const p=profilsTaxes.find(x=>String(x.id)===String(id));modale(`Profil ${p.pays_code}/${p.region}`,`<div class="form-modale"><div class="champ"><label class="lbl" for="tp-statut">État</label><select id="tp-statut"><option value="a_verifier" ${p.statut==='a_verifier'?'selected':''}>À vérifier</option><option value="valide" ${p.statut==='valide'?'selected':''}>Validé</option><option value="exonere" ${p.statut==='exonere'?'selected':''}>Exonéré</option></select></div>${sourcesTaxe}</div>`,[{label:'Annuler'},{label:'Enregistrer',pri:true,run:enregistrer(()=>api('PUT',`/facturation/profils-fiscaux/${id}`,{statut:valeur('#tp-statut'),source_nom:valeur('#tx-source'),source_url:valeur('#tx-url'),motif:valeur('#tx-motif')}),'Profil fiscal mis à jour.')} ]);$('#tx-source').value=p.source_nom||'';$('#tx-url').value=p.source_url||'';$('#tx-motif').value=p.motif||'';});
  surAction(v,'tax-new',()=>modale('Nouvelle règle fiscale',`<div class="form-modale"><div class="ligne">${champ('tx-pays','Pays ISO','CA')}${champ('tx-region','Région ISO','', 'placeholder="QC ou *"')}</div><div class="ligne">${champ('tx-code','Code taxe','')}${champ('tx-nom','Nom de taxe','')}${champ('tx-taux','Taux (%)','','type="number" min="0" max="99.999" step="0.001"')}</div><div class="ligne">${champ('tx-de','Valide à partir du',aujourdhuiIso(),'type="date"')}${champ('tx-jusqua','Valide jusqu’au','','type="date"')}</div>${sourcesTaxe}</div>`,[{label:'Annuler'},{label:'Enregistrer la règle',pri:true,run:enregistrer(()=>api('POST','/facturation/taxes',{pays_code:valeur('#tx-pays'),region:valeur('#tx-region'),code:valeur('#tx-code'),nom:valeur('#tx-nom'),taux:Number(valeur('#tx-taux')),valide_de:valeur('#tx-de'),valide_jusqua:valeur('#tx-jusqua')||null,source_nom:valeur('#tx-source'),source_url:valeur('#tx-url'),motif:valeur('#tx-motif')}),'Règle fiscale créée.')} ]));
  surAction(v,'tax-edit',id=>{const x=taxes.find(t=>String(t.id)===String(id));modale(`Règle ${x.pays_code}/${x.region} · ${x.code}`,`<div class="form-modale"><div class="ligne">${champ('tx-taux','Taux (%)',x.taux,'type="number" min="0" max="99.999" step="0.001"')}${champ('tx-de','Valide à partir du',jour(x.valide_de),'type="date"')}${champ('tx-jusqua','Valide jusqu’au',jour(x.valide_jusqua),'type="date"')}</div>${sourcesTaxe}</div>`,[{label:'Annuler'},{label:'Enregistrer',pri:true,run:enregistrer(()=>api('PUT',`/facturation/taxes/${id}`,{taux:Number(valeur('#tx-taux')),valide_de:valeur('#tx-de'),valide_jusqua:valeur('#tx-jusqua')||null,source_nom:valeur('#tx-source'),source_url:valeur('#tx-url'),motif:valeur('#tx-motif')}),'Règle fiscale mise à jour.')} ]);$('#tx-source').value=x.source_nom||'';$('#tx-url').value=x.source_url||'';$('#tx-motif').value='Mise à jour sourcée';});
}

/* ---------------- projets ---------------- */
/* Vues du portefeuille : liste, Kanban par étape du cahier, calendrier des échéances et chronologie. */
const VUES_PROJETS = [['liste', 'Liste'], ['kanban', 'Kanban'], ['calendrier', 'Calendrier'], ['chronologie', 'Chronologie']];
const ETAPES_PROJET = [['nouveau', 'Nouveau'], ['qualification', 'Qualification'], ['cadrage', 'Cadrage'], ['preparation', 'Préparation'], ['configuration', 'Configuration'], ['migration', 'Migration'],
  ['integrations', 'Intégrations'], ['formation', 'Formation'], ['tests_uat', 'Tests et recette utilisateur'], ['pret_lancement', 'Prêt au lancement'], ['go_live', 'Go Live'], ['stabilisation', 'Stabilisation'], ['maintenance', 'Maintenance'], ['termine', 'Terminé']];
function vueProjetsSelon(vue, ps, lignes) {
  const ouvrir = (p) => `<button class="lien-ligne" type="button" data-action="p-ouvrir" data-id="${p.id}">${esc(p.nom)}</button>`;
  if (vue === 'kanban') {
    const colonnes = [['', 'À classer'], ...ETAPES_PROJET].map(([code, libelle]) => {
      const liste = ps.filter((p) => (p.etape || '') === code);
      if (!code && !liste.length) return '';
      return `<section class="sh-kanban-col"><h3>${esc(libelle)} <span>${liste.length}</span></h3>${liste.map((p) => `<article class="carte-kanban">${ouvrir(p)}<div class="note">${esc(p.hopital || p.organisation || '')} · ${p.avancement} %</div>
        ${peut('implantation') && !p.archive_le ? `<label class="lbl" for="etape-${p.id}">Étape</label><select id="etape-${p.id}" data-etape-projet="${p.id}">${ETAPES_PROJET.map(([c, l]) => `<option value="${c}"${p.etape === c ? ' selected' : ''}>${esc(l)}</option>`).join('')}${p.etape ? '' : '<option value="" selected disabled>À classer</option>'}</select>` : ''}</article>`).join('')}</section>`;
    }).join('');
    return `<div class="sh-kanban">${colonnes}</div>`;
  }
  if (vue === 'calendrier') {
    const evts = ps.flatMap((p) => [p.debut && { jour: jourIso(p.debut), quoi: 'Début', p }, p.echeance && { jour: jourIso(p.echeance), quoi: 'Échéance', p }].filter(Boolean)).sort((a, b) => a.jour.localeCompare(b.jour));
    const mois = [...new Set(evts.map((e) => e.jour.slice(0, 7)))];
    return mois.length ? mois.map((m) => `<h3>${esc(new Date(`${m}-15T12:00:00`).toLocaleDateString(L, { month: 'long', year: 'numeric' }))}</h3>${tableSH(['Date', 'Événement', 'Projet'], evts.filter((e) => e.jour.startsWith(m)).map((e) => `<tr><td>${esc(e.jour)}</td><td>${esc(e.quoi)}</td><td>${ouvrir(e.p)}</td></tr>`).join(''))}`).join('') : '<p class="note">Aucun projet daté.</p>';
  }
  if (vue === 'chronologie') {
    const dates = ps.filter((p) => p.debut && p.echeance);
    if (!dates.length) return '<p class="note">Renseignez le début et l’échéance des projets pour afficher la chronologie.</p>';
    const t = (d) => new Date(`${jourIso(d)}T12:00:00`).getTime();
    const min = Math.min(...dates.map((p) => t(p.debut))), max = Math.max(...dates.map((p) => t(p.echeance))), span = Math.max(max - min, 86400000);
    return `<div class="chronologie">${dates.map((p) => `<div class="chrono-ligne">${ouvrir(p)}<div class="chrono-piste" aria-label="${esc(jourIso(p.debut))} → ${esc(jourIso(p.echeance))}"><i style="margin-left:${(100 * (t(p.debut) - min) / span).toFixed(2)}%;width:${Math.max(1, 100 * (t(p.echeance) - t(p.debut)) / span).toFixed(2)}%"><b style="width:${p.avancement}%"></b></i></div><span class="note">${esc(jourIso(p.debut))} → ${esc(jourIso(p.echeance))} · ${p.avancement} %</span></div>`).join('')}</div>`;
  }
  return tableSH(['Projet', 'Établissement', 'Statut', 'Responsable', 'Avancement', 'Échéance'], lignes);
}
async function vueProjets(v) {
  if (etat.projet) return vueProjet(v);
  const [ps, hs] = await Promise.all([api('GET', `/projets${etat.projetsArchives?'?archives=1':''}`), api('GET', '/hopitaux')]);
  const lignes = ps.map((p) => `<tr><td><button class="lien-ligne" type="button" data-action="p-ouvrir" data-id="${p.id}">${esc(p.nom)}</button></td><td>${esc(p.hopital || p.organisation || '—')}</td><td>${etiquette('projet', p.statut)}</td><td>${responsablePresenceHTML(p.responsable_id,p.responsable)}</td>
    <td><div class="progres"><i style="width:${p.avancement}%"></i></div><span class="note">${p.avancement} % · ${esc(pl('{n|# tâche|# tâches}', { n: p.taches }))}${p.taches_en_retard ? ` · ${p.taches_en_retard} en retard` : ''}</span></td><td>${esc(p.echeance ? jour(p.echeance) : '—')}</td></tr>`).join('');
  v.innerHTML = `<div class="entete"><div><h2>Projets</h2><p>Projets d’implantation : créés à la signature d’un contrat, rattachés à l’établissement dès sa fiche créée. L’avancement suit les tâches, dont celles qui se terminent avec les étapes réelles.</p></div>${peut('implantation') ? bouton('Nouveau projet', 'p-nouveau', 'btn pri') : ''}</div>
    ${bouton(etat.projetsArchives?'Voir les projets actifs':'Voir les projets archivés','p-archives')}
    <div class="ligne serre" role="group" aria-label="Vue des projets">${VUES_PROJETS.map(([c, l]) => `<button class="chip" type="button" data-action="p-vue" data-id="${c}" aria-pressed="${(etat.vueProjets || 'liste') === c}">${esc(l)}</button>`).join('')}</div>
    ${vueProjetsSelon(etat.vueProjets || 'liste', ps, lignes)}`;
  surAction(v, 'p-vue', (c) => { etat.vueProjets = c; afficher(); });
  await barreFiltres(v, 'projets', { vue: etat.vueProjets || 'liste', archives: !!etat.projetsArchives }, (f) => { etat.vueProjets = f.vue; etat.projetsArchives = !!f.archives; });
  v.querySelectorAll('[data-etape-projet]').forEach((s) => { s.onchange = () => agir(s, () => api('PUT', `/projets/${s.dataset.etapeProjet}/etape`, { etape: s.value }), 'Étape enregistrée.'); });
  surAction(v,'p-archives',()=>{etat.projetsArchives=!etat.projetsArchives;afficher();});
  surAction(v, 'p-ouvrir', (id) => { etat.projet = Number(id); afficher(); });
  surAction(v, 'p-nouveau', async () => {
    if (!hs.length) { toast('Créez d’abord la fiche de l’établissement.', true); return; }
    modale('Nouveau projet', `<div class="form-modale"><div class="champ"><label class="lbl" for="pr-hop">Établissement</label><select id="pr-hop">${hs.map((h) => `<option value="${h.id}">${esc(h.nom)}</option>`).join('')}</select></div>${champ('pr-nom', 'Nom du projet', '')}
      <div class="champ"><label for="pr-type">Type de projet</label><select id="pr-type"><option value="implantation">Implantation</option><option value="pilote">Pilote</option><option value="extension">Extension</option><option value="integration">Intégration</option><option value="migration">Migration</option><option value="maintenance">Maintenance</option><option value="mise_a_niveau">Mise à niveau</option></select></div>
      <div class="ligne">${champ('pr-debut', 'Début', '', 'type="date"')}${champ('pr-date', 'Échéance', '', 'type="date"')}</div>${await choixPersonne('pr-resp', null,'Chef de projet')}
      ${await choixMembresProjet('pr-membres',[])}<p class="note">Un pilote nécessite un chef et au moins deux membres actifs. Le projet ne crée pas automatiquement un environnement hospitalier.</p></div>`,
    [{ label: 'Annuler' }, { label: 'Créer', pri: true, run: enregistrer(() => api('POST', '/projets', { hopital_id: Number(valeur('#pr-hop')), nom: valeur('#pr-nom'),type_projet:valeur('#pr-type'),membres:membresProjetSelectionnes('#pr-membres'), debut: valeur('#pr-debut') || null, echeance: valeur('#pr-date') || null, responsable_id: valeur('#pr-resp') || null }), 'Projet créé.') }]);
  });
}
/** Finances du projet : par devise, sans conversion ; revenus = factures émises (HT) du contrat du projet. */
const LIB_NATURE = { budget: 'Budget', cout_prevu: 'Coût prévu', cout_reel: 'Coût réel' };
const LIB_CATEGORIE = { main_oeuvre: 'Main-d’œuvre', licences: 'Licences', deplacements: 'Déplacements', materiel: 'Matériel', sous_traitance: 'Sous-traitance', formation: 'Formation', autre: 'Autre' };
const pct = (x) => (x == null ? '—' : `${x} %`);
function tableSynthese(synthese) {
  return tableSH(['Devise', 'Budget', 'Coût prévu', 'Coût réel', 'Revenus facturés HT', 'Marge', 'Taux de marge', 'Budget consommé'],
    synthese.map((s) => `<tr><td>${esc(s.devise)}</td><td class="num">${esc(argent(s.budget, s.devise))}</td><td class="num">${esc(argent(s.cout_prevu, s.devise))}</td><td class="num">${esc(argent(s.cout_reel, s.devise))}</td>
      <td class="num">${esc(argent(s.revenus, s.devise))}</td><td class="num">${esc(argent(s.marge, s.devise))}</td><td class="num">${esc(pct(s.taux_marge))}</td><td class="num">${esc(pct(s.consommation_budget))}</td></tr>`).join(''),
    'Aucune donnée financière.');
}
const NIVEAU = { faible: 'Faible', moderee: 'Modérée', elevee: 'Élevée' };
const ETAT_REGISTRE = { ouvert: 'Ouvert', en_traitement: 'En traitement', clos: 'Clos' };
async function afficherRegistreProjet(v, p) {
  const r = await api('GET', `/projets/${p.id}/registre`); const gerer = peut('implantation') && !p.archive_le;
  const risques = r.filter((x) => x.type === 'risque'), decisions = r.filter((x) => x.type === 'decision');
  $('#pj-registre').innerHTML = `<h3>Risques</h3>${tableSH(['Risque', 'Gravité', 'Probabilité', 'Responsable', 'Échéance', 'État', ''], risques.map((x) => `<tr><td><b>${esc(x.titre)}</b><div class="note">${esc(x.description || '')}</div></td><td>${esc(NIVEAU[x.gravite])}</td><td>${esc(NIVEAU[x.probabilite])}</td><td>${esc(x.responsable || '—')}</td><td>${esc(jourIso(x.echeance) || '—')}</td><td>${esc(ETAT_REGISTRE[x.statut])}</td><td>${gerer && x.statut !== 'clos' ? bouton('Clore', 'rg-clore', 'btn discret', x.id) : ''}</td></tr>`).join(''), 'Aucun risque enregistré.')}
    <h3>Décisions</h3>${tableSH(['Décision', 'Décidée par', 'Le'], decisions.map((x) => `<tr><td><b>${esc(x.titre)}</b><div class="note">${esc(x.description || '')}</div></td><td>${esc(x.decide_par)}</td><td>${esc(jourIso(x.decide_le))}</td></tr>`).join(''), 'Aucune décision enregistrée.')}
    ${gerer ? `<div class="ligne serre">${bouton('Ajouter un risque', 'rg-risque')}${bouton('Consigner une décision', 'rg-decision')}</div>` : ''}`;
  const niveaux = (idc, lib) => `<div class="champ"><label class="lbl" for="${idc}">${lib}</label><select id="${idc}">${Object.entries(NIVEAU).map(([c, l]) => `<option value="${c}">${esc(l)}</option>`).join('')}</select></div>`;
  surAction(v, 'rg-risque', () => modale('Nouveau risque', `<div class="form-modale">${champ('rg-titre', 'Risque', '')}<div class="champ"><label class="lbl" for="rg-desc">Description et mesure prévue</label><textarea id="rg-desc"></textarea></div><div class="ligne">${niveaux('rg-gravite', 'Gravité')}${niveaux('rg-proba', 'Probabilité')}${champ('rg-ech', 'Échéance', '', 'type="date"')}</div></div>`,
    [{ label: 'Annuler' }, { label: 'Enregistrer', pri: true, run: enregistrer(() => api('POST', `/projets/${p.id}/registre`, { type: 'risque', titre: valeur('#rg-titre'), description: valeur('#rg-desc'), gravite: valeur('#rg-gravite'), probabilite: valeur('#rg-proba'), echeance: valeur('#rg-ech') || null }), 'Risque enregistré.') }]));
  surAction(v, 'rg-decision', () => modale('Nouvelle décision', `<div class="form-modale">${champ('rg-titre', 'Décision', '')}<div class="champ"><label class="lbl" for="rg-desc">Contexte et justification</label><textarea id="rg-desc"></textarea></div><div class="ligne">${champ('rg-par', 'Décidée par', '')}${champ('rg-le', 'Date', aujourdhuiIso(), 'type="date"')}</div></div>`,
    [{ label: 'Annuler' }, { label: 'Enregistrer', pri: true, run: enregistrer(() => api('POST', `/projets/${p.id}/registre`, { type: 'decision', titre: valeur('#rg-titre'), description: valeur('#rg-desc'), decide_par: valeur('#rg-par'), decide_le: valeur('#rg-le') }), 'Décision enregistrée.') }]));
  surAction(v, 'rg-clore', (id, b) => agir(b, () => api('PUT', `/projets/${p.id}/registre/${id}`, { statut: 'clos' }), 'Risque clos.'));
}
async function afficherFinancesProjet(v, p) {
  const f = await api('GET', `/projets/${p.id}/finances`);
  const modifier = peut('finance') && !p.archive_le;
  $('#pj-finances').innerHTML = `<h3>Finances du projet</h3><p class="note">Montants par devise, sans conversion. Les revenus sont les factures émises, hors taxes, du contrat du projet.</p>${tableSynthese(f.synthese)}
    ${tableSH(['Date', 'Nature', 'Catégorie', 'Libellé', 'Montant', ''], f.lignes.map((l) => `<tr><td>${esc(jourIso(l.jour))}</td><td>${esc(LIB_NATURE[l.nature])}</td><td>${esc(LIB_CATEGORIE[l.categorie])}</td><td>${esc(l.libelle)}</td>
      <td class="num">${esc(argent(l.montant, l.devise))}</td><td>${modifier ? bouton('Retirer', 'pf-retirer', 'btn discret', l.id) : ''}</td></tr>`).join(''), 'Aucune ligne de budget ou de coût.')}
    ${modifier ? `<div class="ligne">${bouton('Ajouter un budget ou un coût', 'pf-ajouter')}</div>` : ''}`;
  surAction(v, 'pf-ajouter', () => modale('Budget ou coût du projet', `<div class="form-modale"><div class="ligne"><div class="champ"><label class="lbl" for="pf-nature">Nature</label><select id="pf-nature">${f.natures.map((n) => `<option value="${n}">${esc(LIB_NATURE[n])}</option>`).join('')}</select></div>
      <div class="champ"><label class="lbl" for="pf-categorie">Catégorie</label><select id="pf-categorie">${f.categories.map((c) => `<option value="${c}">${esc(LIB_CATEGORIE[c])}</option>`).join('')}</select></div></div>
      ${champ('pf-libelle', 'Libellé', '')}<div class="ligne">${champ('pf-montant', 'Montant', '', 'type="number" min="0" step="0.01"')}${champ('pf-devise', 'Devise (ISO)', p.devise || 'CAD')}${champ('pf-jour', 'Date', aujourdhuiIso(), 'type="date"')}</div></div>`,
    [{ label: 'Annuler' }, { label: 'Enregistrer', pri: true, run: enregistrer(() => api('POST', `/projets/${p.id}/finances`, { nature: valeur('#pf-nature'), categorie: valeur('#pf-categorie'), libelle: valeur('#pf-libelle'),
      montant: Number(valeur('#pf-montant')), devise: valeur('#pf-devise').trim().toUpperCase(), jour: valeur('#pf-jour') }), 'Ligne financière enregistrée.') }]));
  surAction(v, 'pf-retirer', (id, b) => agir(b, () => api('DELETE', `/projets/${p.id}/finances/${id}`), 'Ligne retirée.'));
}
async function vueProjet(v) {
  const p = await api('GET', `/projets/${etat.projet}`);
  const gerer = peut('implantation')&&!p.archive_le;
  v.innerHTML = `<div class="entete"><div><button class="btn discret retour" type="button" id="b-retour-projets">← Tous les projets</button><h2>${esc(p.nom)}</h2>
      <p>${etiquette('projet', p.statut)} · ${esc(p.hopital || p.organisation || '')}${p.contrat ? ` · contrat ${esc(p.contrat)}` : ''} · ${p.avancement} %</p></div>
      ${gerer ? `<div class="ligne serre">${bouton('Modifier', 'pj-modifier')}${bouton('Nouvelle tâche', 'pj-tache', 'btn pri')}${bouton('Nouveau jalon', 'pj-jalon')}</div>` : ''}</div>
    <div class="progres large"><i style="width:${p.avancement}%"></i></div>
    <p>${esc(p.reference)} · ${esc(p.type_projet)} · Équipe : ${p.membres.map(m=>esc(m.nom)+presenceHTML(m.utilisateur_id)).join(', ')||'Non constituée'}</p>
    ${p.archive_le?`<p class="note">Projet archivé : restaurez-le avant modification.</p>`:''}
    ${peut('implantation')?`<div class="ligne serre">${p.archive_le?bouton('Restaurer le projet','pj-restaurer')+bouton('Demander la suppression','pj-demander-suppression'):['termine','annule'].includes(p.statut)?bouton('Archiver le projet','pj-archiver'):''}${p.suppression_demandee_le&&etat.moi.utilisateur.role==='administration'?bouton('Supprimer définitivement','pj-supprimer','btn dan'):''}${!p.archive_le&&etat.moi.utilisateur.role==='administration'?bouton('Supprimer (créé par erreur)','pj-supprimer-erreur','btn dan'):''}</div>`:''}
    <h3>Jalons</h3>${tableSH(['Jalon', 'Échéance', 'Responsable', 'État'], p.jalons.map((j) => `<tr><td>${esc(j.nom)}</td><td>${esc(j.echeance ? jour(j.echeance) : '—')}</td><td>${esc(j.responsable || '—')}</td><td>${j.termine_le ? `atteint le ${esc(jour(j.termine_le))}` : gerer ? bouton('Marquer atteint', 'pj-jalon-fait', 'btn', j.id) : 'à venir'}</td></tr>`).join(''), 'Aucun jalon.')}
    <h3>Tâches</h3>${tableauTaches(p.taches, { projet: false })}<div id="pj-registre"></div><div id="pj-finances"></div>`;
  $('#b-retour-projets').onclick = () => { etat.projet = null; afficher(); };
  if (peut('implantation', 'support', 'formation')) await afficherRegistreProjet(v, p);
  if (peut('finance', 'implantation')) await afficherFinancesProjet(v, p);
  if(!p.archive_le)brancherTaches(v, p.taches);
  for(const action of ['archiver','restaurer'])surAction(v,`pj-${action}`,()=>modale(action==='archiver'?'Archiver le projet':'Restaurer le projet',`<p>${esc(p.reference)} · ${esc(p.nom)}</p>`,[
    {label:'Annuler'},{label:action==='archiver'?'Archiver':'Restaurer',pri:true,run:enregistrer(()=>api('POST',`/projets/${p.id}/${action}`),'Projet enregistré.')}
  ]));
  surAction(v,'pj-demander-suppression',()=>modale('Demander la suppression',`<p>${esc(p.reference)} · ${esc(p.nom)}</p><div class="champ"><label for="suppression-motif">Motif de suppression</label><textarea id="suppression-motif" minlength="10" maxlength="2000"></textarea></div>`,[
    {label:'Annuler'},{label:'Demander la suppression',pri:true,run:enregistrer(()=>api('POST',`/projets/${p.id}/demander-suppression`,{motif:valeur('#suppression-motif')}),'Demande enregistrée.')}
  ]));
  surAction(v,'pj-supprimer-erreur',()=>modale('Supprimer un projet créé par erreur',`<p>Réservé à un projet encore vide : aucune tâche, aucun jalon, document, ticket, contrat ni ligne financière. Sinon, archivez-le puis demandez sa suppression.</p><p>${esc(p.reference)} · ${esc(p.nom)}</p><div class="champ"><label for="erreur-motif">Motif (10 caractères au moins)</label><textarea id="erreur-motif" minlength="10" maxlength="2000"></textarea></div>${champ('erreur-confirmation',`Tapez SUPPRIMER ${p.reference}`,'')}`,[
    {label:'Annuler'},{label:'Supprimer le projet',dan:true,run:async()=>{try{await api('POST',`/projets/${p.id}/supprimer-erreur`,{confirmation:valeur('#erreur-confirmation'),motif:valeur('#erreur-motif')});etat.projet=null;toast('Projet supprimé.');await afficher();return true;}catch(e){toast(e.message,true);return false;}}}
  ]));
  surAction(v,'pj-supprimer',()=>modale('Supprimer définitivement',`<p>La suppression reste soumise aux contrôles de conservation et de dépendances.</p><p>${esc(p.reference)} · ${esc(p.nom)}</p>${champ('suppression-confirmation',`SUPPRIMER ${p.reference}`,'')}`,[
    {label:'Annuler'},{label:'Supprimer définitivement',dan:true,run:async()=>{try{await api('POST',`/projets/${p.id}/supprimer`,{confirmation:valeur('#suppression-confirmation')});etat.projet=null;await afficher();return true;}catch(e){toast(e.message,true);return false;}}}
  ]));
  surAction(v, 'pj-jalon-fait', (id, b) => agir(b, () => api('PUT', `/jalons/${id}`, { termine: true }), 'Jalon atteint.'));
  surAction(v, 'pj-jalon', async () => modale('Nouveau jalon', `<div class="form-modale">${champ('jl-nom', 'Nom', '')}${champ('jl-date', 'Échéance', '', 'type="date"')}${await choixPersonne('jl-resp', null)}</div>`,
    [{ label: 'Annuler' }, { label: 'Ajouter', pri: true, run: enregistrer(() => api('POST', `/projets/${p.id}/jalons`, { nom: valeur('#jl-nom'), echeance: valeur('#jl-date') || null, responsable_id: valeur('#jl-resp') || null }), 'Jalon ajouté.') }]));
  surAction(v, 'pj-tache', async () => modale('Nouvelle tâche', `<div class="form-modale">${champ('nt-titre', 'Titre', '')}<div class="ligne"><div class="champ"><label class="lbl" for="nt-prio">Priorité</label><select id="nt-prio">${options('priorite', 'normale')}</select></div>${champ('nt-date', 'Échéance', '', 'type="date"')}</div>
    ${await choixPersonne('nt-resp', null)}<div class="champ"><label class="lbl" for="nt-desc">Description</label><textarea id="nt-desc"></textarea></div>
    <label class="case"><input id="nt-critique" type="checkbox">Critique : bloque le Go Live tant qu’elle n’est pas terminée</label>
    <div class="champ"><label for="nt-acceptation">Critères d’acceptation</label><textarea id="nt-acceptation"></textarea></div></div>`,
  [{ label: 'Annuler' }, { label: 'Créer', pri: true, run: enregistrer(() => api('POST', `/projets/${p.id}/taches`, { titre: valeur('#nt-titre'), priorite: valeur('#nt-prio'), echeance: valeur('#nt-date') || null, responsable_id: valeur('#nt-resp') || null, description: valeur('#nt-desc'),critique_golive:$('#nt-critique').checked,criteres_acceptation:valeur('#nt-acceptation') }), 'Tâche créée.') }]));
  surAction(v, 'pj-modifier', async () => modale('Modifier le projet', `<div class="form-modale">${champ('mp-nom', 'Nom', p.nom)}<div class="ligne"><div class="champ"><label class="lbl" for="mp-statut">Statut</label><select id="mp-statut">${options('projet', p.statut)}</select></div>${champ('mp-debut', 'Début', jourIso(p.debut), 'type="date"')}${champ('mp-fin', 'Échéance', jourIso(p.echeance), 'type="date"')}</div>${await choixPersonne('mp-resp', p.responsable_id,'Chef de projet')}${await choixMembresProjet('mp-membres',p.membres.map(m=>m.utilisateur_id))}</div>`,
    [{ label: 'Annuler' }, { label: 'Enregistrer', pri: true, run: enregistrer(() => api('PUT', `/projets/${p.id}`, { nom: valeur('#mp-nom'), statut: valeur('#mp-statut'), debut: valeur('#mp-debut') || null, echeance: valeur('#mp-fin') || null, responsable_id: valeur('#mp-resp') || null,membres:membresProjetSelectionnes('#mp-membres') }), 'Projet enregistré.') }]));
}

/* ---------------- tâches ---------------- */
function tableauTaches(ts, { projet = true } = {}) {
  const moi = etat.moi.utilisateur.id; const gestion = peut('implantation');
  return tableSH(['Tâche', ...(projet ? ['Projet'] : []), 'Statut', 'Priorité', 'Responsable', 'Échéance', ''], ts.map((t) => {
    const modifiable = gestion || t.responsable_id === moi || t.collaborateur === true;
    return `<tr><td><b>${esc(t.titre)}</b>${t.code_auto ? ' <span class="badge">suit la console</span>' : ''}${t.en_retard ? ` ${etiquette('facture', 'en_retard')}` : ''}</td>${projet ? `<td>${esc(t.projet)}<div class="note">${esc(t.hopital || '')}</div></td>` : ''}
      <td>${modifiable ? `<select data-tache-statut="${t.id}" aria-label="Statut de ${esc(t.titre)}">${options('tache', t.statut)}</select>` : etiquette('tache', t.statut)}</td><td>${etiquette('priorite', t.priorite)}</td><td>${responsablePresenceHTML(t.responsable_id,t.responsable)}</td><td>${esc(t.echeance ? jour(t.echeance) : '—')}</td>
      <td><div class="ligne serre">${modifiable ? bouton('Modifier', 't-modifier', 'btn', t.id) : ''}${bouton('Suivi', 't-suivi', 'btn discret', t.id)}${bouton(`Commentaires${t.commentaires ? ` (${t.commentaires})` : ''}`, 't-commentaires', 'btn discret', t.id)}</div></td></tr>`;
  }).join(''), 'Aucune tâche.');
}
function brancherTaches(v, ts) {
  v.querySelectorAll('[data-tache-statut]').forEach((s) => { s.onchange = () => {
    const id = s.dataset.tacheStatut;
    // L'annulation exige un motif ; les autres changements s'appliquent directement.
    if (s.value === 'annulee') return modale('Annuler la tâche', `${champ('ta-motif', 'Motif de l’annulation', '')}`, [{ label: 'Fermer', run: () => { afficher(); return true; } },
      { label: 'Annuler la tâche', dan: true, run: enregistrer(() => api('PUT', `/taches/${id}`, { statut: 'annulee', motif: valeur('#ta-motif') }), 'Tâche annulée.') }]);
    return agir(s, () => api('PUT', `/taches/${id}`, { statut: s.value }), 'Tâche mise à jour.');
  }; });
  surAction(v, 't-suivi', async (id) => {
    const t = ts.find((x) => String(x.id) === String(id)); const s = await api('GET', `/taches/${id}/suivi`);
    const modifiable = (peut('implantation') || t.responsable_id === etat.moi.utilisateur.id || t.collaborateur === true) && !['terminee', 'annulee'].includes(t.statut);
    const h = (m) => (m == null ? '—' : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`);
    modale(`Suivi · ${t.titre}`, `<p>Estimé : <b>${esc(h(s.temps_estime_minutes))}</b> · Réalisé : <b>${esc(h(s.temps_realise_minutes))}</b>${s.ecart_minutes == null ? '' : ` · Écart : ${s.ecart_minutes < 0 ? '−' : '+'}${esc(h(Math.abs(s.ecart_minutes)))}`}</p>
      ${peut('implantation') && modifiable ? `<div class="ligne">${champ('ts-estime', 'Estimation (minutes)', s.temps_estime_minutes ?? '', 'type="number" min="0" step="15"')}<div>${bouton('Enregistrer l’estimation', 'ts-estimer')}</div></div>` : ''}
      <p>Collaborateurs : ${s.collaborateurs.length ? s.collaborateurs.map((c) => esc(c.nom)).join(', ') : 'aucun'}</p>
      ${peut('implantation') && modifiable ? `${await choixMembresProjet('ts-collab', s.collaborateurs.map((c) => c.id))}<div>${bouton('Enregistrer les collaborateurs', 'ts-collaborateurs')}</div>` : ''}
      <h3>Checklist</h3>${s.checklist.length ? `<ul class="liste-simple">${s.checklist.map((c) => `<li><label class="case"><input type="checkbox" data-check="${c.id}"${c.faite ? ' checked' : ''}${modifiable ? '' : ' disabled'}> ${esc(c.libelle)}</label>${c.faite ? ` <span class="note">${esc(c.faite_par_nom || '')}</span>` : ''}</li>`).join('')}</ul>` : '<p class="note">Aucun élément.</p>'}
      ${modifiable ? `<div class="ligne">${champ('ts-check', 'Nouvel élément', '')}<div>${bouton('Ajouter', 'ts-ajouter')}</div></div>` : ''}
      <h3>Temps réalisé</h3>${tableSH(['Date', 'Personne', 'Durée', 'Note'], s.temps.map((x) => `<tr><td>${esc(jourIso(x.jour))}</td><td>${esc(x.utilisateur)}</td><td>${esc(h(x.minutes))}</td><td>${esc(x.note || '')}</td></tr>`).join(''), 'Aucun temps saisi.')}
      ${modifiable ? `<div class="ligne">${champ('ts-minutes', 'Minutes', '', 'type="number" min="1" max="1440"')}${champ('ts-jour', 'Date', aujourdhuiIso(), 'type="date"')}${champ('ts-note', 'Note', '')}<div>${bouton('Saisir le temps', 'ts-temps')}</div></div>` : ''}`,
    [{ label: 'Fermer' }]);
    const m = $('#modale');
    const rafraichir = () => { m.hidden = true; m.innerHTML = ''; v.querySelector(`[data-action="t-suivi"][data-id="${id}"]`)?.click(); };
    m.querySelectorAll('[data-check]').forEach((c) => { c.onchange = () => agir(c, () => api('PUT', `/taches/${id}/checklist/${c.dataset.check}`, { faite: c.checked }), 'Checklist mise à jour.'); });
    surAction(m, 'ts-collaborateurs', (x, b) => agir(b, () => api('PUT', `/taches/${id}/collaborateurs`, { utilisateurs: membresProjetSelectionnes('#ts-collab') }), 'Collaborateurs enregistrés.').then(rafraichir));
    surAction(m, 'ts-estimer', (x, b) => agir(b, () => api('PUT', `/taches/${id}/estimation`, { minutes: valeur('#ts-estime') === '' ? null : Number(valeur('#ts-estime')) }), 'Estimation enregistrée.').then(rafraichir));
    surAction(m, 'ts-ajouter', (x, b) => agir(b, () => api('POST', `/taches/${id}/checklist`, { libelle: valeur('#ts-check') }), 'Élément ajouté.').then(rafraichir));
    surAction(m, 'ts-temps', (x, b) => agir(b, () => api('POST', `/taches/${id}/temps`, { minutes: Number(valeur('#ts-minutes')), jour: valeur('#ts-jour'), note: valeur('#ts-note') }), 'Temps saisi.').then(rafraichir));
  });
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
  const etapesKanban=[['nouveau','Nouveau'],['assigne','Assigné'],['en_cours','En cours'],['en_attente','En attente'],['resolu','Résolu'],['ferme','Fermé']];
  const kanban=etapesKanban.map(([code,label])=>{const liste=items.filter(t=>(t.statut==='ouvert'?(t.responsable_id?'assigne':'nouveau'):t.statut)===code);return `<section class="sh-kanban-col" data-colonne="${code}"><h3>${esc(label)} <span>${liste.length}</span></h3>${liste.slice(0,50).map(t=>`<article class="sh-kanban-card"><button type="button" class="lien-ligne" data-action="tk-ouvrir" data-id="${Number(t.id)}">${esc(t.reference)} · ${esc(t.titre)}</button><p>${esc(t.hopital)}</p><p>${etiquette('priorite',t.priorite)} ${esc(t.responsable||'Non attribué')}</p><p class="note">${esc(t.echeance?quand(t.echeance):'—')}</p></article>`).join('')||'<p class="note">Aucun ticket.</p>'}${liste.length>50?`<p class="note">50 premiers sur ${liste.length} tickets.</p>`:''}</section>`;}).join('');
  const lignes = items.map((t) => `<tr><td><button class="lien-ligne" type="button" data-action="tk-ouvrir" data-id="${t.id}">${esc(t.titre)}</button>${t.hors_delai ? ` ${etiquette('facture', 'en_retard')}` : ''}</td><td>${esc(t.hopital)}</td><td>${esc(LIB.type_ticket[t.type])}${t.gravite ? ` · ${esc(t.gravite)}` : ''}</td>
    <td>${etiquette('ticket', t.statut)}</td><td>${etiquette('priorite', t.priorite)}</td><td>${responsablePresenceHTML(t.responsable_id,t.responsable)}</td><td>${esc(t.echeance ? quand(t.echeance) : '—')}</td></tr>`).join('');
  v.innerHTML = `<div class="entete"><div><h2>Support</h2><p>${esc(pl('{n|# ticket|# tickets}', { n: items.length }))} · ${items.filter((t) => t.hors_delai).length} hors délai. Délai de prise en charge : 4 h (urgente), 24 h (haute), 72 h (normale), 7 jours (basse).</p></div><div class="ligne">${roleMoi()==='administration'?bouton('SLA contractuels','sla-configurer','btn'):''}${peut('support')?bouton('Vérifier les escalades','sla-verifier','btn'):''}${bouton('Nouveau ticket', 'tk-nouveau', 'btn pri')}</div></div>
    <section class="carte"><h3>OG · recherche et résumés de tickets</h3><p class="note">Recherche locale en lecture seule. Résumé factuel : état, priorité, établissement et responsable.</p><form id="support-og-form" class="ligne"><input id="support-og-query" maxlength="160" minlength="2" required placeholder="Référence ou mots-clés"><button class="btn" type="submit">Rechercher</button></form><div id="support-og-resultats" aria-live="polite"></div></section>
    <h3>Suivi des tickets</h3><div class="sh-kanban tk-kanban">${kanban}</div>
    <div class="ligne filtres"><div class="champ"><label class="lbl" for="fs-statut">Statut</label><select id="fs-statut"><option value="">Tous</option>${options('ticket', f.statut)}</select></div>
      <div class="champ"><label class="lbl" for="fs-type">Type</label><select id="fs-type"><option value="">Tous</option>${options('type_ticket', f.type)}</select></div><label class="case"><input type="checkbox" id="fs-moi"${f.moi ? ' checked' : ''}> Attribués à moi</label></div>
    ${tableSH(['Sujet', 'Établissement', 'Type', 'Statut', 'Priorité', 'Responsable', 'Échéance'], lignes)}`;
  $('#fs-statut').onchange = (e) => { f.statut = e.target.value; afficher(); };
  $('#fs-type').onchange = (e) => { f.type = e.target.value; afficher(); };
  $('#fs-moi').onchange = (e) => { f.moi = e.target.checked; afficher(); };
  surAction(v,'sla-configurer',()=>choisirSlaSupport(hs));
  surAction(v,'sla-verifier',(id,b)=>agir(b,()=>api('POST','/support/escalades/executer',{}),'Escalades vérifiées.'));
  const ogForm=$('#support-og-form',v); if(ogForm) ogForm.onsubmit=async(e)=>{e.preventDefault();const zone=$('#support-og-resultats',v),btn=ogForm.querySelector('button');btn.disabled=true;zone.textContent='Recherche…';try{const resultat=await api('POST','/support/og/recherche',{recherche:$('#support-og-query',v).value});zone.innerHTML=resultat.tickets.length?`<p>${esc(resultat.nombre)} ticket(s) trouvé(s).</p><ul>${resultat.tickets.map(t=>`<li><button type="button" class="lien-ligne" data-og-ticket="${Number(t.id)}">${esc(t.resume)}</button></li>`).join('')}</ul>`:'<p>Aucun ticket trouvé.</p>';if(typeof traduireNoeuds==='function')traduireNoeuds(zone);for(const b of zone.querySelectorAll('[data-og-ticket]'))b.onclick=async()=>{f.statut='';f.type='';f.moi=false;await afficher();v.querySelectorAll('[data-action="tk-ouvrir"]').forEach(x=>{if(x.dataset.id===b.dataset.ogTicket)x.click();});};}catch(err){zone.textContent=err.message;}finally{btn.disabled=false;}};
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
    modale(t.reference+' · '+t.titre, `<p>${etiquette('ticket', t.statut)} ${etiquette('priorite', t.priorite)} · ${esc(t.hopital)} · ${esc(LIB.type_ticket[t.type])}${t.gravite ? ` ${esc(t.gravite)}` : ''}</p>
      <p class="note">Créé ${esc(quand(t.cree_le))} par ${esc(t.createur || t.demandeur_client || '—')} · échéance ${esc(quand(t.echeance))}${t.contact ? ` · contact ${esc(t.contact)}` : ''}</p>${t.description ? `<p>${esc(t.description)}</p>` : ''}${detailSlaSupport(t)}
      ${gerer ? `<div class="ligne"><div class="champ"><label class="lbl" for="tm-statut">Statut</label><select id="tm-statut">${options('ticket', t.statut)}</select></div><div class="champ"><label class="lbl" for="tm-prio">Priorité</label><select id="tm-prio">${options('priorite', t.priorite)}</select></div>${await choixPersonne('tm-resp', t.responsable_id)}</div>
        <div class="champ"><label class="lbl" for="tm-resol">Résolution</label><textarea id="tm-resol">${esc(t.resolution || '')}</textarea></div><label class="case"><input type="checkbox" id="tm-client"${t.client_visible?' checked':''}>Visible au client : description et résolution partagées</label>` : ''}
      <h4>Pièces jointes</h4><ul class="liste-simple" id="tm-pieces">Chargement…</ul>${gerer?'<div class="ligne"><input type="file" id="tm-fichier" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt"><button class="btn" id="tm-joindre" type="button">Joindre au ticket</button></div>':''}
      <h4>Échanges</h4>${t.messages.length ? `<ul class="liste-simple">${t.messages.map((m) => `<li><b>${esc(m.auteur || '—')}</b> <span class="note">${esc(quand(m.cree_le))}</span><br>${esc(m.message)}</li>`).join('')}</ul>` : '<p class="note">Aucun échange.</p>'}
      <div class="champ"><label class="lbl" for="tm-msg">Nouveau message</label><textarea id="tm-msg"></textarea></div><label class="case"><input type="checkbox" id="tm-public">Partager ce message avec le client</label>
      <h4>Historique</h4><p class="note">${t.evenements.map((e) => `${esc(quand(e.quand))} · ${esc(e.champ)} : ${esc(e.avant ?? '—')} → ${esc(e.apres ?? '—')} · ${esc(e.par)}`).join('<br>') || 'Aucun changement.'}</p>`,
    [{ label: 'Fermer' }, ...(gerer&&!t.prise_en_charge_le&&!['resolu','ferme'].includes(t.statut)?[{label:'Prendre en charge',run:enregistrer(()=>api('POST',`/support/tickets/${id}/prise-en-charge`,{}),'Ticket pris en charge.')}]:[]), { label: 'Envoyer le message', run: enregistrer(() => api('POST', `/support/tickets/${id}/messages`, { message: valeur('#tm-msg'),interne:!$('#tm-public').checked }), 'Message ajouté.') },
      ...(gerer ? [{ label: 'Enregistrer', pri: true, run: enregistrer(() => api('PUT', `/support/tickets/${id}`, { statut: valeur('#tm-statut'), priorite: valeur('#tm-prio'), responsable_id: valeur('#tm-resp') || null, resolution: valeur('#tm-resol'),client_visible:$('#tm-client').checked }), 'Ticket enregistré.') }] : [])]);
    $('#modale .boite').classList.add('large');
    (async()=>{const docs=await api('GET',`/documents?ticket_id=${id}`);const ul=$('#tm-pieces');if(!ul)return;ul.innerHTML=docs.map(d=>`<li><button class="btn" data-pj="${esc(d.id)}">${esc(d.nom)} · ${esc(taille(d.taille))}</button></li>`).join('')||'<li>Aucune pièce jointe.</li>';ul.querySelectorAll('[data-pj]').forEach(b=>b.onclick=()=>telechargerApi(`/documents/${b.dataset.pj}/fichier`,b.textContent.split(' · ')[0]));})().catch(e=>toast(e.message,true));
    const joindre=$('#tm-joindre');if(joindre)joindre.onclick=async()=>{joindre.disabled=true;try{const f=await lireFichier($('#tm-fichier'));await api('POST','/documents',{...f,categorie:'support',ticket_id:Number(id)});toast('Pièce jointe ajoutée.');await afficher();}catch(e){toast(e.message,true);}finally{if(joindre.isConnected)joindre.disabled=false;}};
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
    const groupes=window.ArrimoShFinances.pipelineParDevise(r.pipeline,Object.keys(LIB.opp));
    const pipeline=groupes.map(g=>`<h4>${esc(g.devise)}</h4>${barres(g.lignes,'valeur',x=>`${LIB.opp[x.statut]} (${x.n})`,x=>argent(x.valeur,g.devise))}`).join('');
    blocs.push(`<article class="carte"><h3>Pipeline commercial</h3>${pipeline||'<p>Aucune donnée enregistrée.</p>'}<p class="note">Taux de conversion : ${r.taux_conversion == null ? '—' : `${esc(r.taux_conversion)} %`} · relances en retard : ${esc(r.relances_en_retard)}</p>
      <p class="note">Contrats actifs ${esc(r.contrats.actifs)} · en cours ${esc(r.contrats.en_cours)} · préavis sous 90 jours ${esc(r.contrats.a_renouveler)}</p>${peut('commercial', 'finance') ? bouton('Exporter le pipeline (CSV)', 'exp-pipeline') : ''}</article>`);
  }
  if (r.factures) {
    blocs.push(`<article class="carte"><h3>Facturation</h3>${barres(r.factures.filter((f) => f.etat !== 'brouillon'), 'total', (x) => `${LIB.facture[x.etat]} (${x.n})`, (x) => argent(x.total, x.devise))}<p class="note">Revenu mensuel récurrent : ${r.mrr.map((m) => esc(argent(m.mrr, m.devise))).join(' · ') || '—'} · délai moyen de paiement : ${r.delai_moyen_paiement_jours == null ? '—' : `${esc(r.delai_moyen_paiement_jours)} jours`}</p>${bouton('Exporter les factures (CSV)', 'exp-factures')}</article>`);
  }
  if (r.projets) {
    blocs.push(`<article class="carte"><h3>Implantation</h3>${barres(r.projets, 'n', (x) => LIB.projet[x.statut] || x.statut)}<p class="note">Tâches ouvertes ${esc(r.taches.ouvertes)} · en retard ${esc(r.taches.en_retard)} · terminées ${esc(r.taches.terminees)}</p>
      <h4>Formation par établissement</h4>${barres(r.formation, 'faits', (x) => x.nom, (x) => `${x.faits}/${x.elements} · ${pl('{n|aucun participant validé|# participant validé|# participants validés}', { n: x.participants_valides })}`)}</article>`);
  }
  if (r.support) blocs.push(`<article class="carte"><h3>Support</h3><p>Ouverts ${esc(r.support.ouverts)} · hors délai ${esc(r.support.hors_delai)} · incidents ouverts ${esc(r.support.incidents_ouverts)}</p><p class="note">Résolution moyenne : ${r.support.resolution_moyenne_heures == null ? '—' : `${esc(r.support.resolution_moyenne_heures)} h`}</p><p class="note">SLA respecté — prise en charge : ${r.support.prise_en_charge_sla_pct == null ? '—' : `${esc(r.support.prise_en_charge_sla_pct)} %`} (${esc(r.support.prises_en_charge_sla_respectees)}/${esc(r.support.prises_en_charge_sla_eligibles)}) · résolution : ${r.support.resolution_sla_pct == null ? '—' : `${esc(r.support.resolution_sla_pct)} %`} (${esc(r.support.resolutions_sla_respectees)}/${esc(r.support.resolutions_sla_eligibles)})</p>${bouton('Exporter les tickets (CSV)', 'exp-support')}</article>`);
  v.innerHTML = `<div class="entete"><div><h2>Rapports</h2><p>Indicateurs calculés à la demande depuis la base SH (${esc(quand(r.genere_le))}) ; aucune valeur de démonstration. Les sections dépendent de votre rôle.</p></div></div><div class="grille-rapports">${blocs.join('') || '<p class="note">Aucun indicateur pour votre rôle.</p>'}</div>`;
  for (const s of ['pipeline', 'factures', 'support']) surAction(v, `exp-${s}`, (id, b) => agir(b, () => telechargerApi(`/rapports/export?section=${s}`, `arrimo-sh-${s}.csv`)));
}

/* ---------------- équipe : équipes et permissions (complète l'écran Équipe SH de sh.js) ---------------- */
/** Compétences, zones et charge réelle (tâches ouvertes et estimations restantes) de chaque membre. */
const NIVEAU_COMPETENCE = { notions: 'Notions', autonome: 'Autonome', expert: 'Expert' };
async function afficherCompetences(v, recherche = '') {
  const membres = await api('GET', `/equipe/competences${recherche ? `?q=${encodeURIComponent(recherche)}` : ''}`);
  let zone = $('#zone-competences'); if (!zone) { zone = document.createElement('section'); zone.id = 'zone-competences'; v.appendChild(zone); }
  const h = (m) => `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  zone.innerHTML = `<h3>Compétences, zones et charge</h3><p class="note">La charge vient des tâches ouvertes et de leurs estimations restantes ; les tâches sans estimation sont signalées.</p>
    <div class="ligne filtres"><div class="champ"><label class="lbl" for="cp-q">Rechercher une compétence ou une zone</label><input id="cp-q" value="${esc(recherche)}"></div></div>
    ${tableSH(['Membre', 'Compétences', 'Zones', 'Tâches ouvertes', 'Reste estimé', ''], membres.map((m) => `<tr><td><b>${esc(m.nom)}</b><div class="note">${esc(m.fonction || LIB.role[m.role] || m.role)}</div></td>
      <td>${m.competences.map((c) => `<span class="badge">${esc(c.competence)} · ${esc(NIVEAU_COMPETENCE[c.niveau])}</span>`).join(' ') || '—'}</td><td>${esc(m.zones.join(', ') || '—')}</td>
      <td class="num">${m.charge.taches_ouvertes}${m.charge.en_retard ? ` · ${m.charge.en_retard} en retard` : ''}${m.charge.sans_estimation ? `<div class="note">${m.charge.sans_estimation} sans estimation</div>` : ''}</td><td class="num">${esc(h(m.charge.minutes_restantes))}</td>
      <td>${peut() ? bouton('Modifier', 'cp-modifier', 'btn discret', m.id) : ''}</td></tr>`).join(''), 'Aucun membre ne correspond.')}`;
  let minuterie; $('#cp-q').oninput = (e) => { clearTimeout(minuterie); minuterie = setTimeout(() => afficherCompetences(v, e.target.value.trim()).then(() => { const q = $('#cp-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }), 300); };
  surAction(zone, 'cp-modifier', (id) => {
    const m = membres.find((x) => String(x.id) === String(id));
    modale(`Compétences · ${m.nom}`, `<div class="form-modale"><div class="champ"><label class="lbl" for="cp-liste">Une compétence par ligne : libellé ; niveau (notions, autonome ou expert)</label><textarea id="cp-liste" rows="6">${esc(m.competences.map((c) => `${c.competence} ; ${c.niveau}`).join('\n'))}</textarea></div>
      ${champ('cp-zones', 'Zones d’intervention (séparées par des virgules)', m.zones.join(', '))}</div>`,
    [{ label: 'Annuler' }, { label: 'Enregistrer', pri: true, run: enregistrer(() => api('PUT', `/equipe/${m.id}/competences`, {
      competences: valeur('#cp-liste').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [competence, niveau] = l.split(';').map((x) => x.trim()); return { competence, niveau: (niveau || '').toLowerCase() }; }),
      zones: valeur('#cp-zones').split(',').map((z) => z.trim()).filter(Boolean) }), 'Compétences enregistrées.') }]);
  });
}
async function completerEquipe(v) {
  const [equipes, perso, matrice] = await Promise.all([api('GET', '/equipes'), personnel(), api('GET', '/permissions')]);
  const zone = document.createElement('div');
  zone.innerHTML = `<h3>Équipes</h3>${tableSH(['Équipe', 'Membres', ''], equipes.map((e) => `<tr><td><b>${esc(e.nom)}</b><div class="note">${esc(e.description || '')}</div></td><td>${e.membres.map((m) => `${esc(m.nom)}${m.chef ? ' <span class="badge">chef</span>' : ''}`).join(', ') || '—'}</td><td>${bouton('Modifier', 'eq-modifier', 'btn', e.id)}</td></tr>`).join(''), 'Aucune équipe.')}
    <div class="ligne">${bouton('Nouvelle équipe', 'eq-nouvelle')}</div>
    <details class="matrice"><summary>Matrice des permissions par rôle (${matrice.routes.length} actions)</summary>${tableSH(['Action', ...matrice.roles.map((r) => LIB.role[r] || r)], matrice.routes.map((x) => `<tr><td class="num">${esc(x.route)}</td>${matrice.roles.map((r) => `<td>${x.roles.includes(r) ? '✓' : ''}</td>`).join('')}</tr>`).join(''))}</details>`;
  v.appendChild(zone);
  if (peut('implantation')) await afficherCompetences(v);
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
/** Parcours d'implantation en 17 étapes (cahier §11) : statut, responsable, livrables, preuves et dépendances. */
const STATUT_DEPLOIEMENT = { a_faire: 'À faire', en_cours: 'En cours', bloquee: 'Bloquée', terminee: 'Terminée', non_applicable: 'Non applicable' };
async function afficherDeploiement(v, h) {
  const d = await api('GET', `/hopitaux/${h.id}/deploiement`); const gerer = peut('implantation');
  let zone = $('#deploiement-17'); if (!zone) { zone = document.createElement('section'); zone.id = 'deploiement-17'; zone.className = 'panneau-c'; v.appendChild(zone); }
  const noms = new Map(d.etapes.map((e) => [e.code, e.nom]));
  zone.innerHTML = `<h3>Parcours de déploiement (17 étapes)</h3><div class="progres large"><i style="width:${d.avancement}%"></i></div><p class="note">Avancement réel : ${d.avancement} % (étapes terminées ou non applicables). Une étape se termine seulement avec une preuve et après ses étapes préalables.</p>
    ${d.actions_bloquantes.length ? `<p class="note"><b>Actions bloquantes :</b> ${d.actions_bloquantes.map((a) => `${esc(a.nom)} (${a.raison === 'bloquee' ? 'bloquée' : 'sans responsable'})`).join(' · ')}</p>` : ''}
    ${tableSH(['Étape', 'Statut', 'Responsable', 'Livrables', 'Preuves', 'Dépend de', ''], d.etapes.map((e) => `<tr><td>${e.rang}. <b>${esc(e.nom)}</b>${e.prete ? ' <span class="badge">prête</span>' : ''}</td>
      <td>${gerer ? `<select data-dep-statut="${e.code}" aria-label="Statut de ${esc(e.nom)}">${Object.entries(STATUT_DEPLOIEMENT).filter(([c]) => c !== 'non_applicable' || e.code === 'connexions').map(([c, l]) => `<option value="${c}"${c === e.statut ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>` : esc(STATUT_DEPLOIEMENT[e.statut])}</td>
      <td>${esc(e.responsable || '—')}</td><td>${esc(e.livrables || '—')}</td><td>${e.preuves.length ? e.preuves.map((p) => esc(`${p.type} : ${p.valeur}`)).join('<br>') : '—'}</td>
      <td class="note">${e.dependances.map((x) => esc(noms.get(x))).join(', ') || '—'}</td><td>${gerer ? bouton('Détails', 'dep-details', 'btn discret', e.code) : ''}</td></tr>`).join(''))}`;
  zone.querySelectorAll('[data-dep-statut]').forEach((sel) => { sel.onchange = async () => {
    const corps = { statut: sel.value };
    if (sel.value === 'non_applicable') { const m = prompt('Motif (10 caractères au moins)'); if (!m) { afficherDeploiement(v, h); return; } corps.motif = m; }
    try { await api('PUT', `/hopitaux/${h.id}/deploiement/${sel.dataset.depStatut}`, corps); toast('Étape enregistrée.'); } catch (e) { toast(e.message, true); }
    afficherDeploiement(v, h);
  }; });
  surAction(zone, 'dep-details', async (code) => {
    const e = d.etapes.find((x) => x.code === code);
    modale(`${e.rang}. ${e.nom}`, `<div class="form-modale">${await choixPersonne('dep-resp', e.responsable_id, 'Responsable')}<div class="champ"><label class="lbl" for="dep-livrables">Livrables</label><textarea id="dep-livrables">${esc(e.livrables || '')}</textarea></div>
      <div class="ligne"><div class="champ"><label class="lbl" for="dep-type">Ajouter une preuve</label><select id="dep-type"><option value="note">Note</option><option value="lien">Lien HTTPS</option><option value="document">Document (identifiant)</option></select></div>${champ('dep-valeur', 'Contenu de la preuve', '')}</div></div>`,
    [{ label: 'Annuler' }, { label: 'Enregistrer', pri: true, run: enregistrer(async () => {
      await api('PUT', `/hopitaux/${h.id}/deploiement/${code}`, { responsable_id: valeur('#dep-resp') || null, livrables: valeur('#dep-livrables') });
      if (valeur('#dep-valeur').trim()) await api('POST', `/hopitaux/${h.id}/deploiement/${code}/preuves`, { type: valeur('#dep-type'), valeur: valeur('#dep-valeur').trim() });
    }, 'Étape enregistrée.') }]);
  });
}
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
  if (peut('implantation', 'formation', 'support')) await afficherDeploiement(v, h);
  traduireNoeuds(zone);
}


/* ---------------- recherche globale et filtres enregistrables ---------------- */
const TYPE_RESULTAT = { hopital: 'Hôpital', organisation: 'Organisation', projet: 'Projet', tache: 'Tâche', ticket: 'Ticket', contrat: 'Contrat', facture: 'Facture' };
function ouvrirRecherche() {
  modale('Rechercher', `<div class="champ"><label class="lbl" for="rg-q">Hôpital, client, projet, tâche, ticket, contrat ou facture</label><input id="rg-q" autocomplete="off"></div><div id="rg-resultats" aria-live="polite"><p class="note">Saisissez au moins deux caractères.</p></div>`, [{ label: 'Fermer' }]);
  let minuterie; const q = $('#rg-q'); q.focus();
  q.oninput = () => { clearTimeout(minuterie); minuterie = setTimeout(async () => {
    const texte = q.value.trim(), zone = $('#rg-resultats'); if (texte.length < 2) { zone.innerHTML = '<p class="note">Saisissez au moins deux caractères.</p>'; return; }
    try {
      const r = await api('GET', `/recherche?q=${encodeURIComponent(texte)}`);
      zone.innerHTML = r.resultats.length ? `<ul class="liste-simple">${r.resultats.map((x, i) => `<li><button class="lien-ligne" type="button" data-resultat="${i}">${esc(x.libelle)}</button> <span class="badge">${esc(TYPE_RESULTAT[x.type])}</span> <span class="note">${esc(x.detail || '')}</span></li>`).join('')}</ul>` : '<p class="note">Aucun résultat dans votre périmètre.</p>';
      zone.querySelectorAll('[data-resultat]').forEach((b) => { b.onclick = () => { const x = r.resultats[Number(b.dataset.resultat)];
        etat.vue = x.vue; etat.hopital = x.type === 'hopital' ? x.id : null; etat.projet = x.type === 'projet' ? x.id : null; $('#modale').hidden = true; afficher(); }; });
    } catch (e) { zone.innerHTML = `<p class="erreur">${esc(e.message)}</p>`; }
  }, 250); };
}
{ const b = globalThis.document?.querySelector('#b-recherche'); if (b) b.onclick = ouvrirRecherche; }
/** Barre de filtres enregistrables d'une vue : appliquer, enregistrer l'état courant, retirer. Propre à chaque utilisateur. */
async function barreFiltres(v, vue, courant, appliquer) {
  const filtres = await api('GET', `/moi/filtres?vue=${vue}`);
  const zone = document.createElement('div'); zone.className = 'ligne filtres';
  zone.innerHTML = `<div class="champ"><label class="lbl" for="fe-${vue}">Filtres enregistrés</label><select id="fe-${vue}"><option value="">Choisir…</option>${filtres.map((f) => `<option value="${f.id}">${esc(f.nom)}</option>`).join('')}</select></div>
    <div class="ligne serre">${bouton('Enregistrer ce filtre', 'fe-enregistrer')}${filtres.length ? bouton('Retirer', 'fe-retirer', 'btn discret') : ''}</div>`;
  v.querySelector('.entete')?.after(zone);
  zone.querySelector('select').onchange = (e) => { const f = filtres.find((x) => String(x.id) === e.target.value); if (f) { appliquer(f.filtres); afficher(); } };
  surAction(zone, 'fe-enregistrer', () => modale('Enregistrer le filtre', champ('fe-nom', 'Nom du filtre', ''), [{ label: 'Annuler' }, { label: 'Enregistrer', pri: true, run: enregistrer(() => api('POST', '/moi/filtres', { vue, nom: valeur('#fe-nom'), filtres: courant }), 'Filtre enregistré.') }]));
  surAction(zone, 'fe-retirer', (x, b) => { const id = zone.querySelector('select').value; if (!id) { toast('Choisissez d’abord un filtre.', true); return; } agir(b, () => api('DELETE', `/moi/filtres/${id}`), 'Filtre retiré.'); });
}
