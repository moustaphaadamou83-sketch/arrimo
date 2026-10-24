/* Console SH : interface (français ; console interne de l'équipe SH). Aucun script en ligne : la politique de sécurité l'interdit. */
const F = window.ArrimoFormat;
let langueUI = (() => { try { return localStorage.getItem('arrimo-sh-langue') === 'en' ? 'en' : 'fr'; } catch { return 'fr'; } })();
let L = langueUI === 'en' ? 'en-CA' : 'fr-CA';
const LEXIQUE_EN = (window.ARRIMO_SH_I18N || {}).en || {};
const LEXIQUE_FR = Object.fromEntries(Object.entries(LEXIQUE_EN).map(([fr,en])=>[en,fr]));
const traduireTexte = (texte) => (langueUI === 'en' ? LEXIQUE_EN : LEXIQUE_FR)[String(texte ?? '').trim()] || texte;
function traduireNoeuds(racine = document) {
  const walker = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) { const value = n.nodeValue, tr = traduireTexte(value); if (tr !== value) n.nodeValue = tr; }
  racine.querySelectorAll?.('[placeholder],[aria-label],[title]').forEach((el) => {
    for (const a of ['placeholder','aria-label','title']) if (el.hasAttribute(a)) el.setAttribute(a, traduireTexte(el.getAttribute(a)));
  });
}
function appliquerLangue(langue) {
  langueUI = langue === 'en' ? 'en' : 'fr'; L = langueUI === 'en' ? 'en-CA' : 'fr-CA';
  document.documentElement.lang = langueUI === 'en' ? 'en-CA' : 'fr-CA';
  const choix = $('#sh-langue'); if (choix) choix.value = langueUI;
  try { localStorage.setItem('arrimo-sh-langue', langueUI); } catch { /* préférence locale facultative */ }
  traduireNoeuds(document);
}
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icone = (nom) => `<svg class="ic" aria-hidden="true" focusable="false"><use href="icones.svg#i-${nom}"/></svg>`;
const pl = (modele, vars) => F.remplir(L, modele, vars);
const quand = (iso) => (iso ? new Date(iso).toLocaleString(L, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const jour = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString(L, { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const lire = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const ecrire = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* stockage indisponible */ } };
appliquerLangue(langueUI);

const STATUTS = { prospect: 'Prospect', implantation: 'En implantation', actif: 'Actif', suspendu: 'Suspendu' };
const ENVS = { demo: 'Démonstration', recette: 'Recette', production: 'Production' };
const TYPES = { departements:'Départements',services: 'Services hospitaliers', unites: 'Unités', etages:'Étages et ailes', chambres: 'Chambres', lits: 'Lits', civieres: 'Civières de l’urgence', utilisateurs: 'Utilisateurs' };
const COLONNES = { departements:'departement;code;attributs_json;actif',services: 'service;code;departement;attributs_json;actif', unites: 'unite;type_unite;service;departement;attributs_json;actif', etages:'unite;etage;aile;attributs_json;actif', chambres: 'unite;chambre;etage;type_chambre;capacite;accessible;attributs_json;restrictions_json;statut_operationnel;actif', lits: 'unite;chambre;lit;isolement;pression_negative;ventilation;telemetrie;categorie;attributs_json;actif', civieres: 'civiere;categorie;unite;attributs_json;actif', utilisateurs: 'nom;courriel;role' };
const AIDE_TYPES = { departements:'Codes uniques à l’établissement. Importer avant les services.',services: 'Code stable et unique dans l’établissement. Importer les départements avant les services et unités.', unites: 'Type d’unité : SI, MED, CHIR, MAT ou leur nom. Service et département doivent déjà exister.', etages:'L’unité doit déjà exister. Étage et aile sont facultatifs selon l’organisation du site.', chambres: 'L’unité doit déjà exister. Étage facultatif; capacité déclarée distincte du nombre réel de lits.', lits: 'La chambre doit déjà exister. Équipement : oui ou non.',
  civieres: 'Catégorie : reguliere ou debordement. L’unité est facultative.', utilisateurs: 'Rôle : coordonnateur, entretien ou admin_etab. Chaque personne reçoit une invitation individuelle à usage unique.' };
const COLONNES_STRUCTURE = Object.fromEntries(Object.entries(COLONNES).filter(([k])=>k!=='utilisateurs'));
const TYPES_STRUCTURE = Object.keys(COLONNES_STRUCTURE);
/** Message d'une erreur d'import, à partir de son code (mêmes textes que l'administration d'Arrimo). */
const messageImport = (e) => {
  const modele = ((window.ARRIMO_I18N || {}).fr || {}).import?.e?.[e.code];
  return modele ? F.remplir(L, modele, { ...e.vars, colonne: e.colonne }) : e.code;
};
// Éléments cochés par la console elle-même
const AUTOMATIQUES = { module_active: 'suit le bouton Activer', formation_coordination: 'suit le parcours de formation', formation_entretien: 'suit le parcours de formation', formation_admin: 'suit le parcours de formation' };
const statutHTML = (s) => `<span class="etat-niveau s-${s}">${esc(STATUTS[s] || s)}</span>`;

const etat = { token: lire('sh-token'), moi: null, vue: 'hopitaux', hopital: null, filtres: { q: '', statut: '', environnement: '' }, imports: {}, jeton2fa: null };

/* ---------------- outils ---------------- */
function toast(msg, err) {
  const el = document.createElement('div');
  el.className = `toast${err ? ' err' : ''}`;
  el.textContent = traduireTexte(msg);
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), err ? 7000 : 4500);
}
async function api(methode, chemin, corps) {
  const r = await fetch(`/api${chemin}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...(etat.token ? { Authorization: `Bearer ${etat.token}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* réponse vide */ }
  if (r.status === 401 && etat.token) { deconnecter(); }
  if (!r.ok) throw new Error((data && data.erreur) || `Erreur ${r.status}.`);
  return data;
}
async function agir(bouton, fn, succes) {
  if (bouton) bouton.disabled = true;
  try {
    const r = await fn();
    if (succes) toast(typeof succes === 'function' ? succes(r) : succes);
    await afficher();
    return r;
  } catch (e) {
    toast(e.message, true);
    return null;
  } finally {
    if (bouton && bouton.isConnected) bouton.disabled = false;
  }
}
function modale(titre, corps, actions) {
  const m = $('#modale');
  m.innerHTML = `<div class="boite" role="dialog" aria-modal="true" aria-label="${esc(titre)}"><h3>${esc(titre)}</h3>${corps}<div class="actions"></div></div>`;
  const zone = $('.actions', m);
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.className = `btn${a.pri ? ' pri' : ''}${a.dan ? ' dan' : ''}`;
    b.textContent = a.label;
    b.onclick = async () => {
      if (a.run) { b.disabled = true; const garder = await a.run(b); b.disabled = false; if (garder === false) return; }
      m.hidden = true;
    };
    zone.appendChild(b);
  });
  m.hidden = false;
  traduireNoeuds(m);
  ($('input, textarea', m) || zone.lastChild).focus();
}
$('#modale').addEventListener('click', (e) => { if (e.target.id === 'modale') e.target.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modale').hidden = true; });
function telecharger(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function montrerSecret(titre, texte, explication) {
  modale(titre, `<p class="note">${esc(explication)}</p><div class="reponse num secret">${esc(texte)}</div>
    <p class="note">Affiché une seule fois : il n’est conservé nulle part en clair. Il devra être changé à la première connexion.</p>`,
  [{ label: 'Copier', run: async () => { try { await navigator.clipboard.writeText(texte); toast('Copié.'); } catch { toast('Copiez-le manuellement.', true); } return false; } }, { label: 'Fermer', pri: true }]);
}

/* ---------------- connexion ---------------- */
const FORMULAIRES = ['#f-connexion', '#f-2fa', '#f-mdp-temp', '#f-2fa-act', '#f-invitation'];
function montrer(sel) {
  $('#ecran-app').hidden = true;
  $('#ecran-connexion').hidden = false;
  FORMULAIRES.forEach((f) => { $(f).hidden = f !== sel; });
  const champ = $(`${sel} input`);
  if (champ) champ.focus();
  traduireNoeuds($('#ecran-connexion'));
}
function erreurDans(id, msg) { const el = $(id); el.textContent = traduireTexte(msg || ''); el.hidden = !msg; }
function deconnecter() {
  etat.token = null; etat.moi = null; ecrire('sh-token', null);
  ['#c-mdp', '#c-code', '#t-actuel', '#t-nouveau', '#t-confirme'].forEach((s) => { $(s).value = ''; });
  montrer('#f-connexion');
}
$('#f-connexion').onsubmit = async (e) => {
  e.preventDefault();
  erreurDans('#c-erreur');
  try {
    const r = await api('POST', '/connexion', { email: $('#c-email').value, mot_de_passe: $('#c-mdp').value });
    $('#c-mdp').value = '';
    if (r.etape === '2fa') { etat.jeton2fa = r.jeton; montrer('#f-2fa'); return; }
    ouvrir(r.token);
  } catch (err) { erreurDans('#c-erreur', err.message); }
};
$('#f-invitation').onsubmit = async (e) => {
  e.preventDefault(); erreurDans('#i-erreur');
  if ($('#i-nouveau').value !== $('#i-confirme').value) { erreurDans('#i-erreur', 'Les deux mots de passe sont différents.'); return; }
  try {
    await api('POST', '/invitations/consommer', { jeton: new URLSearchParams(location.hash.slice(1)).get('invitation'), nouveau: $('#i-nouveau').value });
    history.replaceState(null, '', location.pathname + location.search); $('#i-nouveau').value = ''; $('#i-confirme').value = '';
    toast('Accès activé. Connectez-vous et configurez la double authentification.'); montrer('#f-connexion');
  } catch (err) { erreurDans('#i-erreur', err.message); }
};
$('#f-2fa').onsubmit = async (e) => {
  e.preventDefault();
  erreurDans('#c-erreur-2fa');
  try {
    const r = await api('POST', '/connexion/2fa', { jeton: etat.jeton2fa, code: $('#c-code').value });
    $('#c-code').value = '';
    ouvrir(r.token);
  } catch (err) { erreurDans('#c-erreur-2fa', err.message); }
};
$('#b-retour').onclick = () => montrer('#f-connexion');
$('#f-mdp-temp').onsubmit = async (e) => {
  e.preventDefault();
  erreurDans('#t-erreur');
  if ($('#t-nouveau').value !== $('#t-confirme').value) { erreurDans('#t-erreur', 'Les deux mots de passe sont différents.'); return; }
  try {
    await api('PUT', '/moi/mot-de-passe', { actuel: $('#t-actuel').value, nouveau: $('#t-nouveau').value });
    ['#t-actuel', '#t-nouveau', '#t-confirme'].forEach((s) => { $(s).value = ''; });
    toast('Mot de passe enregistré.');
    demarrer();
  } catch (err) { erreurDans('#t-erreur', err.message); }
};
$('#b-2fa-prep').onclick = async () => {
  try {
    const r = await api('POST', '/moi/2fa/preparer');
    $('#zone-2fa').innerHTML = `<ol class="note etapes-2fa"><li>Ouvrez l’application et ajoutez un compte.</li><li>Scannez ce code QR (ou entrez la clé).</li><li>Entrez le code à 6 chiffres affiché.</li></ol>
      <div class="qr">${r.qr_svg}</div>
      <p class="note">Clé : <span class="num secret">${esc(r.secret)}</span></p>
      <label for="a-code">Code à 6 chiffres</label><input id="a-code" inputmode="numeric" maxlength="7" autocomplete="one-time-code">
      <button class="btn pri large" type="button" id="b-2fa-ok">Activer</button>`;
    traduireNoeuds($('#zone-2fa'));
    $('#a-code').focus();
    $('#b-2fa-ok').onclick = async () => {
      erreurDans('#a-erreur');
      try { await api('POST', '/moi/2fa/activer', { code: $('#a-code').value }); toast('Double authentification activée.'); demarrer(); } catch (err) { erreurDans('#a-erreur', err.message); }
    };
  } catch (err) { erreurDans('#a-erreur', err.message); }
};
$('#b-deconnexion').onclick = async () => { try { await api('POST', '/deconnexion'); } catch { /* déjà fermée */ } deconnecter(); };

function ouvrir(token) { etat.token = token; ecrire('sh-token', token); demarrer(); }
async function demarrer() {
  try { etat.moi = await api('GET', '/moi'); } catch { deconnecter(); return; }
  const u = etat.moi.utilisateur;
  appliquerLangue(u.langue || langueUI);
  if (u.mdp_temporaire) { montrer('#f-mdp-temp'); return; }
  if (!u.totp_actif) { montrer('#f-2fa-act'); return; }
  $('#ecran-connexion').hidden = true;
  $('#ecran-app').hidden = false;
  $('#nom-utilisateur').textContent = u.nom;
  $('#onglets [data-v="equipe"]').hidden = u.role !== 'administration';
  $('#onglets [data-v="journal"]').hidden = !['administration', 'implantation', 'support'].includes(u.role);
  $('#onglets [data-v="crm"]').hidden = !['administration','commercial'].includes(u.role);
  $('#onglets [data-v="contrats"]').hidden = !['administration','commercial','implantation','support'].includes(u.role);
  $('#onglets [data-v="projets"]').hidden = !['administration','implantation','support'].includes(u.role);
  $('#onglets [data-v="support"]').hidden = !['administration','support','implantation'].includes(u.role);
  if (($('#onglets [data-v="crm"]').hidden && etat.vue==='crm') || ($('#onglets [data-v="contrats"]').hidden && etat.vue==='contrats') || ($('#onglets [data-v="projets"]').hidden&&etat.vue==='projets') || ($('#onglets [data-v="support"]').hidden&&etat.vue==='support')) etat.vue='hopitaux';
  if (u.role !== 'administration' && etat.vue === 'equipe') etat.vue = 'hopitaux';
  if (!['administration', 'implantation', 'support'].includes(u.role) && etat.vue === 'journal') etat.vue = 'hopitaux';
  afficher();
}

/* ---------------- navigation ---------------- */
document.querySelectorAll('#onglets button').forEach((b) => { b.onclick = () => { etat.vue = b.dataset.v; etat.hopital = null; afficher(); }; });
async function afficher() {
  if (!etat.moi) return;
  document.querySelectorAll('#onglets button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === etat.vue)));
  const v = $('#contenu');
  try {
    if (etat.vue === 'accueil') await vueAccueil(v);
    else if (etat.vue === 'crm') await vueCRM(v);
    else if (etat.vue === 'contrats') await vueContrats(v);
    else if (etat.vue === 'projets') await vueProjets(v);
    else if (etat.vue === 'taches') await vueTaches(v);
    else if (etat.vue === 'support') await vueSupport(v);
    else if (etat.vue === 'hopitaux') await (etat.hopital ? vueHopital(v) : vueHopitaux(v));
    else if (etat.vue === 'journal') await vueJournal(v);
    else if (etat.vue === 'equipe') await vueEquipe(v);
    else vueCompte(v);
  } catch (e) { toast(e.message, true); }
  traduireNoeuds(v);
  document.body.dataset.pret = '1';
  document.body.dataset.rendus = String(Number(document.body.dataset.rendus || 0) + 1);   // repère pour les tests d'interface
}

$('#sh-langue').onchange = async () => {
  appliquerLangue($('#sh-langue').value);
  if (etat.token && etat.moi?.utilisateur?.totp_actif && !etat.moi.utilisateur.mdp_temporaire) {
    try { await api('PUT', '/moi/langue', { langue: langueUI }); if (etat.moi) etat.moi.utilisateur.langue = langueUI; }
    catch (e) { toast(e.message, true); }
  }
  traduireNoeuds(document);
  if (etat.moi && !$('#ecran-app').hidden) await afficher();
};

/* ---------------- outils ERP (indicateurs calculés depuis les API, aucune valeur de démonstration) ---------------- */
const bouton = (libelle, action, classe='btn') => `<button class="${classe}" data-action="${action}">${esc(libelle)}</button>`;
function tableSH(headers, rows) { return `<div class="tableau"><table><thead><tr>${headers.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows||'<tr><td colspan="8" class="note">Aucune donnée enregistrée.</td></tr>'}</tbody></table></div>`; }
async function vueAccueil(v) {
  const [hs,os,ps,ts] = await Promise.all([
    api('GET','/hopitaux').catch(()=>[]), api('GET','/crm/opportunites').catch(()=>[]),
    api('GET','/projets').catch(()=>[]), api('GET','/taches?moi=1').catch(()=>[]),
  ]);
  const cartes=[['Établissements',hs.length],['Opportunités ouvertes',os.filter(x=>!['gagnee','perdue'].includes(x.statut)).length],['Projets en cours',ps.filter(x=>x.statut==='en_cours'||x.statut==='planification').length],['Mes tâches ouvertes',ts.filter(x=>x.statut!=='terminee').length]];
  const retards=ts.filter(x=>x.statut!=='terminee'&&x.echeance&&new Date(x.echeance)<new Date()).length, bloques=ps.filter(x=>x.statut==='bloque').length;
  v.innerHTML=`<div class="entete"><div><h2>Accueil</h2><p>Indicateurs calculés depuis les données SH accessibles à votre rôle.</p></div></div><div class="cartes-kpi">${cartes.map(([n,x])=>`<article class="carte"><span class="note">${esc(n)}</span><strong>${esc(x)}</strong></article>`).join('')}</div><div class="carte"><h3>À suivre</h3><p>${esc(pl('{n|# tâche attribuée en retard|# tâches attribuées en retard}',{n:retards}))}</p><p>${esc(pl('{n|# projet marqué bloqué|# projets marqués bloqués}',{n:bloques}))}</p></div>`;
}
async function vueCRM(v) {
  const [orgs,opps,hs,contracts]=await Promise.all([api('GET','/crm/organisations'),api('GET','/crm/opportunites'),api('GET','/hopitaux'),api('GET','/crm/contrats')]);
  const enriched=await Promise.all(opps.map(async o=>({...o,devis:await api('GET',`/crm/opportunites/${o.id}/devis`)})));
  const previsions={};for(const o of opps.filter(x=>!['gagnee','perdue'].includes(x.statut)&&x.montant!=null)){previsions[o.devise]=(previsions[o.devise]||0)+Number(o.montant)*Number(o.probabilite)/100;}
  const libellePrevision=Object.keys(previsions).length?`Prévision pondérée : ${Object.entries(previsions).map(([devise,total])=>`${new Intl.NumberFormat('fr-CA',{style:'currency',currency:devise}).format(total)}`).join(' · ')} (valeur × probabilité)`:'Aucune opportunité ouverte avec une valeur enregistrée pour établir une prévision.';
  const stages=[['qualification','Qualification'],['analyse','Analyse'],['proposition','Proposition'],['negociation','Négociation'],['gagnee','Gagnée'],['perdue','Perdue']];
  const next={qualification:'analyse',analyse:'proposition',proposition:'negociation',negociation:'gagnee'};
  const board=stages.map(([code,label])=>`<section class="sh-kanban-col"><h3>${esc(label)} <span>${enriched.filter(o=>o.statut===code).length}</span></h3>${enriched.filter(o=>o.statut===code).map(o=>{const d=o.devis[0],c=contracts.find(x=>x.opportunite_id===o.id);return `<article class="sh-kanban-card"><strong>${esc(o.titre)}</strong><p>${esc(o.organisation)}</p><p>${o.montant==null?'Valeur à confirmer':esc(`${o.montant} ${o.devise}`)} · probabilité ${o.probabilite}%</p>${d?`<p>Devis v${d.version} · ${esc(d.statut)}</p>`:''}${c?`<p>Contrat ${esc(c.reference)} · ${esc(c.statut)}</p>`:''}<div class="ligne serre">${next[code]?bouton('Avancer','crm-next'):''}${bouton('Créer un devis','crm-quote')}${d?.statut==='brouillon'&&etat.moi.utilisateur.role==='administration'?bouton('Approuver le devis','crm-approve'):''}${d&&['approuve','envoye','accepte'].includes(d.statut)&&!c?bouton('Préparer le contrat','crm-contract'):''}</div></article>`;}).join('')||'<p class="note">Aucune opportunité.</p>'}</section>`).join('');
  const orgRows=orgs.map(o=>`<tr><td>${esc(o.nom)}</td><td>${esc(o.type)}</td><td>${o.contacts}</td><td>${o.opportunites}</td><td>${o.hopital_id?esc(hs.find(h=>h.id===o.hopital_id)?.nom||'Établissement lié'):bouton('Lier un établissement','crm-link')}</td></tr>`).join('');
  v.innerHTML=`<div class="entete"><div><h2>CRM</h2><p>${esc(pl('{n|# organisation|# organisations}',{n:orgs.length}))} · ${esc(pl('{n|# opportunité enregistrée|# opportunités enregistrées}',{n:opps.length}))}. ${esc(libellePrevision)}</p></div><div>${bouton('Nouvelle organisation','crm-org','btn pri')} ${bouton('Nouvelle opportunité','crm-opp')}</div></div><h3>Pipeline commercial</h3><div class="sh-kanban">${board}</div><h3>Organisations et contacts</h3>${tableSH(['Organisation','Type','Contacts','Opportunités','Établissement'],orgRows)}`;
  v.querySelector('[data-action="crm-org"]').onclick=()=>modale('Nouvelle organisation',`<div class="champ"><label class="lbl" for="crm-nom">Nom</label><input id="crm-nom" required></div><div class="champ"><label class="lbl" for="crm-site">Site Web</label><input id="crm-site" type="url"></div>`,[{label:'Annuler'},{label:'Créer',pri:true,run:async()=>{await api('POST','/crm/organisations',{nom:$('#crm-nom',document).value,site_web:$('#crm-site',document).value});await afficher();}}]);
  v.querySelector('[data-action="crm-opp"]').onclick=()=>{if(!orgs.length){toast('Créez d’abord une organisation dans le CRM.',true);return;}modale('Nouvelle opportunité',`<div class="champ"><label class="lbl" for="opp-org">Organisation</label><select id="opp-org">${orgs.map(o=>`<option value="${o.id}">${esc(o.nom)}</option>`).join('')}</select></div><div class="champ"><label class="lbl" for="opp-titre">Titre</label><input id="opp-titre" required></div><div class="champ"><label class="lbl" for="opp-valeur">Valeur estimée</label><input id="opp-valeur" type="number" min="0" step="0.01"></div>`,[{label:'Annuler'},{label:'Créer',pri:true,run:async()=>{await api('POST','/crm/opportunites',{organisation_id:Number($('#opp-org',document).value),titre:$('#opp-titre',document).value,montant:$('#opp-valeur',document).value||null});await afficher();}}]);};
  v.querySelectorAll('[data-action="crm-link"]').forEach((b,i)=>b.onclick=()=>{const org=orgs.filter(o=>!o.hopital_id)[i];if(!hs.length){toast('Créez d’abord la fiche établissement.',true);return;}modale('Lier à une fiche établissement',`<p>Associe cette organisation CRM à une fiche existante; aucune fiche ni aucun compte Arrimo ne sera créé.</p><div class="champ"><label class="lbl" for="crm-hop">Établissement</label><select id="crm-hop">${hs.map(h=>`<option value="${h.id}">${esc(h.nom)}</option>`).join('')}</select></div>`,[{label:'Annuler'},{label:'Lier',pri:true,run:async()=>{await api('PUT',`/crm/organisations/${org.id}/etablissement`,{hopital_id:Number($('#crm-hop',document).value)});await afficher();}}]);});
  v.querySelectorAll('[data-action="crm-next"]').forEach((b,i)=>b.onclick=async()=>{const o=enriched.filter(x=>next[x.statut])[i];await agir(b,()=>api('PUT',`/crm/opportunites/${o.id}`,{statut:next[o.statut],probabilite:next[o.statut]==='gagnee'?100:Math.max(o.probabilite,40)}));});
  v.querySelectorAll('[data-action="crm-quote"]').forEach((b,i)=>b.onclick=()=>{const o=enriched[i];modale('Nouveau devis versionné',`<div class="champ"><label class="lbl" for="q-desc">Prestation</label><input id="q-desc" required></div><div class="ligne"><div class="champ"><label class="lbl" for="q-qty">Quantité</label><input id="q-qty" type="number" min="0.01" step="0.01" value="1"></div><div class="champ"><label class="lbl" for="q-prix">Prix unitaire (CAD)</label><input id="q-prix" type="number" min="0" step="0.01"></div></div><p class="note">Le devis est un brouillon. Aucun envoi ni signature électronique n’est simulé.</p>`,[{label:'Annuler'},{label:'Créer le brouillon',pri:true,run:async()=>{await api('POST',`/crm/opportunites/${o.id}/devis`,{lignes:[{description:$('#q-desc',document).value,quantite:Number($('#q-qty',document).value),prix_unitaire:Number($('#q-prix',document).value)}]});await afficher();}}]);});
  v.querySelectorAll('[data-action="crm-approve"]').forEach((b,i)=>b.onclick=async()=>{const o=enriched.filter(x=>x.devis[0]?.statut==='brouillon')[i],d=o.devis[0];await agir(b,()=>api('POST',`/crm/devis/${d.id}/valider`));});
  v.querySelectorAll('[data-action="crm-contract"]').forEach((b,i)=>b.onclick=async()=>{const o=enriched.filter(x=>x.devis[0]&&['approuve','envoye','accepte'].includes(x.devis[0].statut)&&!contracts.some(c=>c.opportunite_id===x.id))[i];await agir(b,()=>api('POST',`/crm/opportunites/${o.id}/contrats`,{devis_id:o.devis[0].id}),'Contrat préparé.');});
}
async function vueContrats(v) {
  const cs=await api('GET','/crm/contrats');
  const lines=cs.map(c=>`<tr><td>${esc(c.reference)}</td><td>${esc(c.client)}</td><td>Devis v${esc(c.devis_version||'—')}</td><td>${esc(c.statut)}</td><td>${esc(c.renouvellement_le||'—')}</td><td>${c.statut==='signe'?'—':etat.moi.utilisateur.role==='administration'?bouton('Enregistrer signature','contract-sign'): 'Validation réservée à l’administration'}</td></tr>`).join('');
  v.innerHTML=`<div class="entete"><div><h2>Devis et contrats</h2><p>Les devis sont versionnés. L’enregistrement d’une signature exige une référence de document vérifiable; aucune signature électronique n’est simulée.</p></div></div>${tableSH(['Référence','Client','Devis','Statut','Renouvellement','Action'],lines)}`;
  v.querySelectorAll('[data-action="contract-sign"]').forEach((b,i)=>b.onclick=()=>{const c=cs.filter(x=>x.statut!=='signe')[i];modale('Enregistrer la signature',`<div class="champ"><label class="lbl" for="signe-par">Nom du signataire autorisé</label><input id="signe-par"></div><div class="champ"><label class="lbl" for="signe-doc">Référence du document signé</label><input id="signe-doc"></div><p class="note">Ce formulaire journalise une signature déjà obtenue hors Arrimo.SH.</p>`,[{label:'Annuler'},{label:'Enregistrer',pri:true,run:async()=>{await api('POST',`/crm/contrats/${c.id}/signe`,{signataire:$('#signe-par',document).value,document_ref:$('#signe-doc',document).value});await afficher();}}]);});
}
async function vueProjets(v) {
  const ps=await api('GET','/projets');const hs=await api('GET','/hopitaux');
  const lignes=ps.map(p=>`<tr><td>${esc(p.nom)}</td><td>${esc(p.hopital)}</td><td>${esc(p.statut)}</td><td>${p.taches}</td><td>${p.avancement}%</td><td>${esc(p.echeance||'—')}</td></tr>`).join('');
  v.innerHTML=`<div class="entete"><div><h2>Projets</h2><p>Projets d’implantation liés aux établissements enregistrés.</p></div>${bouton('Nouveau projet','projet-new','btn pri')}</div>${tableSH(['Projet','Établissement','Statut','Tâches','Avancement','Échéance'],lignes)}`;
  v.querySelector('[data-action="projet-new"]').onclick=()=>{if(!hs.length){toast('Créez d’abord la fiche de l’établissement.',true);return;}modale('Nouveau projet',`<div class="champ"><label class="lbl" for="pr-hop">Établissement</label><select id="pr-hop">${hs.map(h=>`<option value="${h.id}">${esc(h.nom)}</option>`).join('')}</select></div><div class="champ"><label class="lbl" for="pr-nom">Nom du projet</label><input id="pr-nom"></div><div class="champ"><label class="lbl" for="pr-date">Échéance</label><input id="pr-date" type="date"></div>`,[{label:'Annuler'},{label:'Créer',pri:true,run:async()=>{await api('POST','/projets',{hopital_id:Number($('#pr-hop',document).value),nom:$('#pr-nom',document).value,echeance:$('#pr-date',document).value||null});await afficher();}}]);};
}
async function vueTaches(v) {
  const [ts,ps,eq]=await Promise.all([api('GET','/taches'),api('GET','/projets'),api('GET','/equipe').catch(()=>[])]);
  const lignes=ts.map(t=>`<tr><td>${esc(t.titre)}</td><td>${esc(t.projet)}</td><td>${esc(t.hopital)}</td><td>${esc(t.statut)}</td><td>${esc(t.priorite)}</td><td>${esc(t.responsable||'—')}</td><td>${esc(t.echeance||'—')}</td></tr>`).join('');
  v.innerHTML=`<div class="entete"><div><h2>Tâches</h2><p>Attribution, priorité et échéances des projets d’implantation.</p></div>${bouton('Nouvelle tâche','task-new','btn pri')}</div>${tableSH(['Tâche','Projet','Établissement','Statut','Priorité','Responsable','Échéance'],lignes)}`;
  v.querySelector('[data-action="task-new"]').onclick=()=>{if(!ps.length){toast('Créez d’abord un projet.',true);return;}modale('Nouvelle tâche',`<div class="champ"><label class="lbl" for="t-projet">Projet</label><select id="t-projet">${ps.map(p=>`<option value="${p.id}">${esc(p.nom)}</option>`).join('')}</select></div><div class="champ"><label class="lbl" for="t-titre">Titre</label><input id="t-titre"></div><div class="champ"><label class="lbl" for="t-resp">Responsable</label><select id="t-resp"><option value="">Non assigné</option>${eq.map(m=>`<option value="${m.id}">${esc(m.nom)} · ${esc(m.role)}</option>`).join('')}</select></div><div class="champ"><label class="lbl" for="t-date">Échéance</label><input id="t-date" type="date"></div>`,[{label:'Annuler'},{label:'Créer',pri:true,run:async()=>{await api('POST',`/projets/${$('#t-projet',document).value}/taches`,{titre:$('#t-titre',document).value,responsable_id:$('#t-resp',document).value||null,echeance:$('#t-date',document).value||null});await afficher();}}]);};
}
async function vueSupport(v) {
  const [items,hs]=await Promise.all([api('GET','/support/tickets'),api('GET','/hopitaux')]);
  const lignes=items.map(t=>`<tr><td>${esc(t.titre)}</td><td>${esc(t.hopital)}</td><td>${esc(t.statut)}</td><td>${esc(t.priorite)}</td><td>${esc(t.responsable||'—')}</td><td>${esc(quand(t.cree_le))}</td></tr>`).join('');
  v.innerHTML=`<div class="entete"><div><h2>Support</h2><p>${esc(pl('{n|# ticket enregistré|# tickets enregistrés}',{n:items.length}))}.</p></div>${bouton('Nouveau ticket','ticket-new','btn pri')}</div>${tableSH(['Sujet','Établissement','Statut','Priorité','Responsable','Créé'],lignes)}`;
  v.querySelector('[data-action="ticket-new"]').onclick=()=>{if(!hs.length){toast('Aucun établissement enregistré.',true);return;}modale('Nouveau ticket',`<div class="champ"><label class="lbl" for="tk-hop">Établissement</label><select id="tk-hop">${hs.map(h=>`<option value="${h.id}">${esc(h.nom)}</option>`).join('')}</select></div><div class="champ"><label class="lbl" for="tk-titre">Sujet</label><input id="tk-titre"></div><div class="champ"><label class="lbl" for="tk-desc">Description</label><textarea id="tk-desc"></textarea></div>`,[{label:'Annuler'},{label:'Créer',pri:true,run:async()=>{await api('POST','/support/tickets',{hopital_id:Number($('#tk-hop',document).value),titre:$('#tk-titre',document).value,description:$('#tk-desc',document).value});await afficher();}}]);};
}

/* ---------------- hôpitaux ---------------- */
const champ = (id, libelle, valeur, attrs = '') => `<div class="champ"><label class="lbl" for="${id}">${esc(libelle)}</label><input id="${id}" value="${esc(valeur ?? '')}" autocomplete="off" ${attrs}></div>`;
const choixEnv = (id, choisi, verrou) => `<div class="champ"><label class="lbl" for="${id}">Environnement</label><select id="${id}"${verrou ? ' disabled' : ''}>
  ${Object.entries(ENVS).map(([k, n]) => `<option value="${k}"${k === choisi ? ' selected' : ''}>${esc(n)}${etat.moi.environnements.some((e) => e.code === k) ? '' : ' (non relié)'}</option>`).join('')}</select></div>`;
const nb = (n) => F.nombre(L, n, 6);
function formHopital(h = {}) {
  const verrou = !!h.relie;
  return `<div class="ligne">${champ('h-nom', 'Nom de l’hôpital', h.nom)}${champ('h-code', 'Code d’établissement', h.code_etab, `placeholder="HOP-A"${verrou ? ' disabled' : ''}`)}${choixEnv('h-env', h.environnement || 'recette', verrou)}</div>
    <div class="ligne">${champ('h-raison', 'Raison sociale', h.raison_sociale)}${champ('h-legal', 'Identifiant légal', h.identifiant_legal)}${champ('h-pays', 'Pays (ISO)', h.pays_code || 'CA', 'maxlength="2"')}</div>
    <div class="ligne">${champ('h-adresse', 'Adresse', h.adresse)}${champ('h-ville', 'Ville', h.ville)}</div>
    <div class="ligne">${champ('h-region', 'Province / région', h.region)}${champ('h-tz', 'Fuseau horaire', h.fuseau_horaire || 'America/Toronto')}${champ('h-prevus', 'Utilisateurs prévus', h.utilisateurs_prevus ?? 0, 'type="number" min="0"')}${champ('h-autorises', 'Utilisateurs autorisés', h.utilisateurs_autorises ?? 0, 'type="number" min="0"')}</div>
    <div class="ligne">${champ('h-lat', 'Latitude', h.latitude == null ? '' : nb(h.latitude), `inputmode="decimal" placeholder="${nb(45.4)}"`)}${champ('h-lon', 'Longitude', h.longitude == null ? '' : nb(h.longitude), `inputmode="decimal" placeholder="${nb(-71.89)}"`)}
      ${champ('h-sd', 'Lien propre (sous-domaine)', h.sous_domaine, 'placeholder="hopital-x"')}</div>
    <div class="ligne">${champ('h-cnom', 'Contact : nom', h.contact_nom)}${champ('h-ccourriel', 'Contact : courriel', h.contact_courriel, 'type="email"')}${champ('h-ctel', 'Contact : téléphone', h.contact_telephone, 'type="tel"')}</div>`;
}
const lireFormHopital = () => ({
  nom: $('#h-nom').value, code_etab: $('#h-code').value, environnement: $('#h-env').value, adresse: $('#h-adresse').value, ville: $('#h-ville').value,
  raison_sociale: $('#h-raison').value, identifiant_legal: $('#h-legal').value, pays_code: $('#h-pays').value, region: $('#h-region').value,
  fuseau_horaire: $('#h-tz').value, utilisateurs_prevus: Number($('#h-prevus').value), utilisateurs_autorises: Number($('#h-autorises').value),
  latitude: $('#h-lat').value, longitude: $('#h-lon').value, sous_domaine: $('#h-sd').value,
  contact_nom: $('#h-cnom').value, contact_courriel: $('#h-ccourriel').value, contact_telephone: $('#h-ctel').value,
});
function etapeCourte(h) {
  if (!h.etape_en_cours) return 'Toutes les étapes terminées';
  const e = etat.moi.etapes.find((x) => x.rang === h.etape_en_cours);
  const g = { contrat: 1, configuration: 1, import: 2, tests: 4, formation: 5, golive: 6, production: 6 }[e?.code] || 1;
  return `${g}/6 · ${e ? e.nom : ''}`;
}

function friseSixEtapes(h) {
  const groupes = h.assistant_etapes || [];
  return `<ol class="frise">${groupes.map((g) => {
    const es = h.etapes.filter((e) => g.etapes.includes(e.code));
    const total = es.reduce((n,e) => n + e.verifications.length, 0);
    const faits = es.reduce((n,e) => n + e.verifications.filter((x) => x.faite).length, 0);
    const fini = total > 0 ? faits === total : g.code === 'acces_modules' && (h.modules || []).some((m) => m.licence === 'souscrit');
    const actuel = !fini && (es.some((e) => e.verifications.some((x) => !x.faite)) || g.code === 'acces_modules');
    const nbModules=(h.modules||[]).filter((m)=>m.licence==='souscrit').length;
    return `<li class="${fini ? 'fait' : actuel ? 'en-cours' : ''}"><a href="${g.code === 'structure' ? '#imports' : g.code === 'formation' ? '#formation' : g.code === 'activation' ? '#golive' : g.code === 'acces_modules' ? '#modules' : '#fiche'}"><span class="rond">${fini ? icone('check') : g.rang}</span><span>${esc(g.nom)}</span><span class="note">${total ? `${faits}/${total}` : esc(pl('{n|aucun module|# module|# modules}', {n:nbModules}))}</span></a></li>`;
  }).join('')}</ol>`;
}

function blocModules(h) {
  return `<p class="note">Catalogue et licences consignés dans SH. L'activation fonctionnelle des modules dépend des capacités réellement exposées par Arrimo.</p>
    <div class="pile">${(h.modules || []).map((m) => `<div class="module-sh"><div><b>${esc(m.nom)}</b><div class="note">${esc(m.description)} · dépendances : ${m.dependances.length ? esc(m.dependances.join(', ')) : 'aucune'}</div></div>
      <select data-module="${esc(m.code)}" aria-label="Licence ${esc(m.nom)}">${['non_selectionne','propose','souscrit','suspendu'].map((s) => `<option value="${s}"${m.licence===s?' selected':''}>${{non_selectionne:'Non sélectionné',propose:'Proposé',souscrit:'Souscrit',suspendu:'Suspendu'}[s]}</option>`).join('')}</select>
      <label class="champ"><span class="lbl">Paramètres autorisés (JSON)</span><textarea data-param="${esc(m.code)}" rows="2" spellcheck="false">${esc(JSON.stringify(m.parametres || {}, null, 2))}</textarea></label></div>`).join('')}</div>
    <button class="btn" id="b-modules">Enregistrer le catalogue</button>`;
}

function blocDossier(h) {
  return `<div class="ligne"><b>Sites (${h.sites.length})</b><button class="btn" type="button" id="b-ajout-site">Ajouter un site</button></div><div id="liste-sites">${h.sites.map((s) => `<div class="ligne site-sh" data-site-id="${s.id}"><input aria-label="Code du site" data-k="code" value="${esc(s.code)}"><input aria-label="Nom du site" data-k="nom" value="${esc(s.nom)}"><input aria-label="Ville du site" data-k="ville" value="${esc(s.ville)}"><input aria-label="Adresse du site" data-k="adresse" value="${esc(s.adresse)}"></div>`).join('')}</div>
    <div class="ligne"><b>Contacts (${h.contacts.length})</b><button class="btn" type="button" id="b-ajout-contact">Ajouter un contact</button></div><div id="liste-contacts">${h.contacts.map((c) => `<div class="ligne contact-sh" data-contact-id="${c.id}"><input aria-label="Nom du contact" data-k="nom" value="${esc(c.nom)}"><input aria-label="Fonction du contact" data-k="fonction" value="${esc(c.fonction)}"><input aria-label="Courriel du contact" data-k="courriel" value="${esc(c.courriel)}"><input aria-label="Téléphone du contact" data-k="telephone" value="${esc(c.telephone)}"><input aria-label="Catégorie du contact" data-k="categorie" value="${esc(c.categorie)}"></div>`).join('')}</div>
    <button class="btn" id="b-dossier">Enregistrer sites et contacts</button>`;
}

async function vueHopitaux(v) {
  const f = etat.filtres;
  const qs = new URLSearchParams(Object.entries(f).filter(([, x]) => x)).toString();
  const [liste, envs] = await Promise.all([api('GET', `/hopitaux${qs ? `?${qs}` : ''}`), api('GET', '/environnements')]);
  v.innerHTML = `<div class="entete"><div><h2>Hôpitaux clients</h2><p>Chaque hôpital suit un assistant en 6 étapes. Les 7 étapes de contrôle existantes restent conservées sous le capot, et le module ne s’active qu’après validation des prérequis.</p></div>
      <button class="btn pri" id="b-nouveau">${icone('plus')}Nouvel hôpital</button></div>
    <div class="envs">${envs.map((e) => `<span class="env"><span class="etat-niveau ${e.joignable ? 'n-vert' : 'n-rouge'}">${esc(e.nom)}</span>
      <span class="note">${e.joignable ? pl('{n|aucun établissement|# établissement|# établissements}', { n: e.etablissements }) : 'ne répond pas'}</span></span>`).join('') || '<span class="note">Aucun environnement relié à la console.</span>'}</div>
    <div class="ligne filtres">
      <div class="champ"><label class="lbl" for="f-q">Rechercher</label><input id="f-q" type="search" value="${esc(f.q)}" placeholder="Nom, ville ou code"></div>
      <div class="champ"><label class="lbl" for="f-statut">Statut</label><select id="f-statut"><option value="">Tous</option>${Object.entries(STATUTS).map(([k, n]) => `<option value="${k}"${f.statut === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      <div class="champ"><label class="lbl" for="f-env">Environnement</label><select id="f-env"><option value="">Tous</option>${Object.entries(ENVS).map(([k, n]) => `<option value="${k}"${f.environnement === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
    </div>
    ${liste.length ? `<div class="tableau"><table><thead><tr><th>Hôpital</th><th>Contact</th><th>Environnement</th><th>Statut</th><th>Étape en cours</th><th>Lien d’accès</th></tr></thead><tbody>
      ${liste.map((h) => `<tr><td><button class="lien-ligne" data-h="${h.id}">${esc(h.nom)}</button><div class="note">${esc([h.code_etab, h.ville].filter(Boolean).join(' · '))}</div></td>
        <td class="note">${esc(h.contact_nom || '—')}${h.contact_courriel ? `<br>${esc(h.contact_courriel)}` : ''}</td>
        <td>${esc(ENVS[h.environnement])}${h.distant && h.distant.injoignable ? '<div class="note">ne répond pas</div>' : ''}</td>
        <td>${statutHTML(h.statut)}</td>
        <td><div class="progres" title="${esc(pl('{n|# élément coché|# éléments cochés}', { n: h.faites }))}"><i style="width:${Math.round((h.faites / Math.max(h.total, 1)) * 100)}%"></i></div><div class="note">${esc(etapeCourte(h))}</div></td>
        <td class="note">${h.lien ? `<a href="${esc(h.lien)}" target="_blank" rel="noopener">${esc(h.lien.replace(/^https:\/\//, ''))}</a>` : '—'}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="panneau-c"><p>${qs ? 'Aucun hôpital ne correspond à ces filtres.' : 'Aucun hôpital pour l’instant. Créez le premier avec « Nouvel hôpital ».'}</p></div>`}`;
  let minuterie;
  $('#f-q').oninput = (e) => { clearTimeout(minuterie); minuterie = setTimeout(() => { f.q = e.target.value; afficher().then(() => { const q = $('#f-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 300); };
  $('#f-statut').onchange = (e) => { f.statut = e.target.value; afficher(); };
  $('#f-env').onchange = (e) => { f.environnement = e.target.value; afficher(); };
  v.querySelectorAll('[data-h]').forEach((b) => { b.onclick = () => { etat.hopital = Number(b.dataset.h); etat.imports = {}; afficher(); window.scrollTo(0, 0); }; });
  $('#b-nouveau').onclick = () => {
    modale('Nouvel hôpital', `<div class="form-modale">${formHopital()}</div><p class="note">La position sert à créer l’établissement dans l’environnement (proximité, carte). Vous pourrez tout modifier ensuite.</p>`,
      [{ label: 'Annuler' }, { label: 'Créer l’hôpital', pri: true, run: async () => {
        try {
          const h = await api('POST', '/hopitaux', lireFormHopital());
          toast(`${h.nom} est créé.`);
          etat.hopital = h.id; etat.imports = {};
          afficher();
          return true;
        } catch (e) { toast(e.message, true); return false; }
      } }]);
    $('#modale .boite').classList.add('large');
  };
}

async function vueHopital(v) {
  const h = await api('GET', `/hopitaux/${etat.hopital}`);
  const d = h.distant;
  const enCours = h.etapes.find((e) => e.verifications.some((x) => !x.faite));
  const etatEtab = !h.environnement_relie ? '<p class="note">Cet environnement n’est pas relié à la console.</p>'
    : d && d.injoignable ? '<p class="note">L’environnement ne répond pas pour l’instant.</p>'
      : !h.relie ? `<p>L’établissement n’existe pas encore dans l’environnement ${esc(ENVS[h.environnement])}.</p>
          <button class="btn pri" id="b-relier">${icone('building-2')}Créer l’établissement</button><p class="note">Code ${esc(h.code_etab)}. En recette, il est ouvert pour les tests et la formation ; ailleurs, il est créé inactif. S’il existe déjà avec ce code, il est simplement relié.</p>`
        : d ? `<div class="compteurs">${[['unites', 'unité', 'unités'], ['chambres', 'chambre', 'chambres'], ['lits', 'lit', 'lits'], ['civieres', 'civière', 'civières'], ['comptes', 'compte', 'comptes']]
          .map(([k, s, p]) => `<div><span class="v num">${nb(d[k])}</span><span class="note">${esc(d[k] > 1 ? p : s)}</span></div>`).join('')}</div>
          <p>Module ${d.module_actif ? '<span class="etat-niveau n-vert">activé</span>' : '<span class="etat-niveau">désactivé</span>'}</p>`
          : `<p class="note">Relié, mais l’établissement ${esc(h.code_etab)} est introuvable dans l’environnement.</p><button class="btn" id="b-relier">Relier de nouveau</button>`;

  v.innerHTML = `<div class="entete"><div><button class="btn discret retour" id="b-retour-liste">← Tous les hôpitaux</button>
      <h2>${esc(h.nom)}</h2><p>${statutHTML(h.statut)} · ${esc(h.code_etab)} · ${esc(ENVS[h.environnement])}${h.lien ? ` · <a href="${esc(h.lien)}" target="_blank" rel="noopener">${esc(h.lien.replace(/^https:\/\//, ''))}</a>` : ''}</p></div></div>
    ${friseSixEtapes(h)}
    <div class="deux hopital-fiche">
      <div class="pile">
        <div class="panneau-c"><h3>Établissement dans l’environnement</h3>${etatEtab}</div>
        ${h.environnement === 'recette' || h.golive_le ? `<div class="panneau-c" id="golive"><h3>Go-live</h3>${blocGolive(h)}</div>` : ''}
        <div class="panneau-c"><h3>Activation du module</h3>${blocActivation(h)}</div>
        <div class="panneau-c"><h3>Rapport de go-live</h3><p class="note">Établissement, dates des contrôles, imports, comptes (sans mot de passe), formation et responsables, avec signatures.</p>
          <div><button class="btn" id="b-rapport">${icone('download')}Télécharger le rapport (PDF)</button></div></div>
        <div class="panneau-c" id="fiche"><h3>Identité de l’établissement</h3><div class="form-fiche">${formHopital(h)}</div>
          <div class="ligne">${['prospect', 'implantation'].includes(h.statut) && etat.moi.utilisateur.role !== 'commercial' ? `<div class="champ"><label class="lbl" for="h-statut">Statut</label><select id="h-statut">${['prospect', 'implantation'].map((k) => `<option value="${k}"${h.statut === k ? ' selected' : ''}>${STATUTS[k]}</option>`).join('')}</select></div>` : ''}
          <button class="btn pri" id="b-enregistrer">Enregistrer la fiche</button></div>
          ${h.relie ? '<p class="note">Relié à son établissement : l’environnement et le code ne changent plus.</p>' : ''}</div>
        <div class="panneau-c"><h3>Sites et responsables</h3>${blocDossier(h)}</div>
        <div class="panneau-c" id="modules"><h3>Modules et licences</h3>${blocModules(h)}</div>
        <div class="panneau-c"><h3>Comptes de l’établissement</h3><p>${nb(h.utilisateurs_prevus)} prévus · ${nb(h.utilisateurs_autorises)} autorisés · ${h.comptes.invites == null ? '—' : nb(h.comptes.invites)} invités · ${h.comptes.actifs == null ? '—' : nb(h.comptes.actifs)} activés</p>${h.comptes.par_role ? `<ul>${Object.entries(h.comptes.par_role).map(([role,x])=>`<li>${esc(role)} : ${nb(x.invites)} invité(s), ${nb(x.actifs)} activé(s)</li>`).join('')}</ul>` : ''}<p class="note">Les comptes invités et activés sont lus depuis l’environnement relié; aucune donnée d’authentification n’est affichée.</p></div>
      </div>
      <div class="pile">
        <div class="panneau-c"><h3>Projet d’implantation</h3><div class="etapes">${h.etapes.map(blocEtape).join('')}</div></div>
        <div class="panneau-c" id="formation"><h3>Parcours de formation</h3>${blocFormation(h)}</div>
        <div class="panneau-c" id="imports"><h3>Import des données</h3>${h.relie ? blocImports(h) : '<p class="note">Créez d’abord l’établissement dans l’environnement.</p>'}</div>
      </div>
    </div>`;

  $('#b-retour-liste').onclick = () => { etat.hopital = null; afficher(); };
  const rel = $('#b-relier');
  if (rel) rel.onclick = () => agir(rel, () => api('POST', `/hopitaux/${h.id}/relier`), (r) => (r.cree ? `Établissement créé dans l’environnement (${r.actif ? 'ouvert pour les tests et la formation' : 'inactif'}).` : 'Établissement relié.'));
  $('#b-enregistrer').onclick = (ev) => agir(ev.target, () => {
    const data=lireFormHopital();
    if(etat.moi.utilisateur.role==='commercial'){
      for(const k of ['code_etab','environnement','sous_domaine','latitude','longitude','utilisateurs_prevus','utilisateurs_autorises']) delete data[k];
      const permises=['nom','adresse','ville','contact_nom','contact_courriel','contact_telephone','raison_sociale','identifiant_legal','pays_code','region','fuseau_horaire'];
      for(const k of Object.keys(data)) if(!permises.includes(k)) delete data[k];
    }
    return api('PUT', `/hopitaux/${h.id}`, { ...data, ...($('#h-statut') ? { statut: $('#h-statut').value } : {}) });
  }, 'Fiche enregistrée.');
  const lireLignes = (conteneur, classe) => [...v.querySelectorAll(`${conteneur} .${classe}`)].map((row) => ({ ...(row.dataset.siteId ? { id: Number(row.dataset.siteId) } : row.dataset.contactId ? { id: Number(row.dataset.contactId) } : {}), ...Object.fromEntries([...row.querySelectorAll('[data-k]')].map((x) => [x.dataset.k, x.value])) }));
  const ajouterLigne = (conteneur, classe, champs) => { const row=document.createElement('div'); row.className=`ligne ${classe}`; row.innerHTML=champs.map(([k,label])=>`<input aria-label="${label}" data-k="${k}" placeholder="${label}">`).join(''); $(conteneur,v).appendChild(row); };
  $('#b-ajout-site').onclick=()=>ajouterLigne('#liste-sites','site-sh',[['code','Code du site'],['nom','Nom du site'],['ville','Ville du site'],['adresse','Adresse du site']]);
  $('#b-ajout-contact').onclick=()=>ajouterLigne('#liste-contacts','contact-sh',[['nom','Nom du contact'],['fonction','Fonction'],['courriel','Courriel'],['telephone','Téléphone'],['categorie','Catégorie']]);
  $('#b-dossier').onclick=(ev)=>agir(ev.currentTarget,()=>api('PUT',`/hopitaux/${h.id}/dossier`,{sites:lireLignes('#liste-sites','site-sh'),contacts:lireLignes('#liste-contacts','contact-sh')}),'Dossier établissement enregistré.');
  $('#b-modules').onclick=(ev)=>agir(ev.currentTarget,()=>api('PUT',`/hopitaux/${h.id}/modules`,{modules:[...v.querySelectorAll('[data-module]')].map((x)=>({code:x.dataset.module,licence:x.value,parametres:JSON.parse(v.querySelector(`[data-param="${CSS.escape(x.dataset.module)}"]`).value)}))}),'Catalogue enregistré.');
  v.querySelectorAll('[data-verif]').forEach((c) => { c.onchange = () => agir(null, () => api('PUT', `/verifications/${c.dataset.verif}`, { faite: c.checked })); });
  v.querySelectorAll('[data-etape]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.etape;
      const val = (k) => $(`[data-e="${id}"][data-k="${k}"]`).value;
      agir(b, () => api('PUT', `/etapes/${id}`, { date_prevue: val('date_prevue'), date_reelle: val('date_reelle'), responsable: val('responsable'), notes: val('notes') }), 'Étape enregistrée.');
    };
  });
  const act = $('#b-activer');
  if (act) {
    act.onclick = () => modale(`Activer Arrimo pour ${h.nom}`, `<p>Le module sera activé dans l’environnement ${esc(ENVS[h.environnement])} : les équipes de l’hôpital pourront s’en servir dès maintenant.</p>`,
      [{ label: 'Annuler' }, { label: 'Activer', pri: true, run: async () => { try { await api('POST', `/hopitaux/${h.id}/activation`); toast('Module activé.'); afficher(); return true; } catch (e) { toast(e.message, true); return false; } } }]);
  }
  const des = $('#b-desactiver');
  if (des) {
    des.onclick = () => modale(`Désactiver Arrimo pour ${h.nom}`, `<p>Les équipes de l’hôpital ne pourront plus modifier les lits ni les transferts. Les données et le journal sont conservés.</p>
      <div class="champ"><label class="lbl" for="d-motif">Motif (obligatoire)</label><textarea id="d-motif" rows="3" maxlength="300"></textarea></div>`,
    [{ label: 'Annuler' }, { label: 'Désactiver', dan: true, run: async () => { try { await api('POST', `/hopitaux/${h.id}/desactivation`, { motif: $('#d-motif').value }); toast('Module désactivé.'); afficher(); return true; } catch (e) { toast(e.message, true); return false; } } }]);
  }
  brancherImports(v, h);
  brancherFormation(v, h);
  $('#b-rapport').onclick = async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    try {
      const r = await fetch(`/api/hopitaux/${h.id}/rapport.pdf`, { headers: { Authorization: `Bearer ${etat.token}` } });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.erreur || 'Rapport indisponible.');
      telecharger(await r.blob(), `arrimo-rapport-golive-${h.code_etab}.pdf`);
      toast('Rapport téléchargé.');
    } catch (e) { toast(e.message, true); } finally { b.disabled = false; }
  };
  const gl = $('#b-golive');
  if (gl) {
    gl.onclick = () => modale(`Go-live de ${h.nom}`, `<p>La structure est prévalidée avant le transfert. Les comptes reçoivent des invitations individuelles à usage unique.</p>
      <p>Aucune donnée de test ne passe en production : ni patients, ni mouvements, ni journal. L’établissement de production est créé inactif ; vous l’activerez ensuite.</p>`,
    [{ label: 'Annuler' }, { label: 'Passer en production', pri: true, run: async () => {
      try {
        const controle = await api('POST', `/hopitaux/${h.id}/golive/preflight`);
        if (!controle.possible) { toast(`Go-live bloqué : ${controle.bloqueurs.join(', ')}`, true); return false; }
        await api('POST', `/hopitaux/${h.id}/golive`);
        toast('Go-live fait : l’hôpital est en production.');
        await afficher();
        return true;
      } catch (e) { toast(e.message, true); return false; }
    } }]);
  }
}

function blocGolive(h) {
  if (h.golive_le) return `<p>Passé en production le ${esc(quand(h.golive_le))} par ${esc(h.golive_par)}.</p><p class="note">Structure importée depuis la recette et comptes invités par lien individuel. Les données de test sont restées en recette.</p>`;
  const raison = !h.golive.production_reliee ? 'La production n’est pas encore reliée à la console (serveur au Canada à installer).'
    : !h.relie ? 'Créez d’abord l’établissement dans la recette.' : h.manquants.length ? 'Toutes les étapes avant le go-live doivent être cochées.' : '';
  return `<p>Prévalide puis importe en production la structure et les comptes validés en recette. Les comptes reçoivent un lien individuel à usage unique. Aucune donnée de test ne passe.</p>
    ${raison ? `<p class="note">${esc(raison)}</p>` : ''}
    <div><button class="btn pri" id="b-golive"${h.golive.possible ? '' : ' disabled aria-disabled="true"'}>Passer en production</button></div>`;
}

function blocFormation(h) {
  const gen = h.environnement === 'recette'
    ? `<div class="generateur"><p>Pour les séances : des patients et des mouvements fictifs (admissions, congés, nettoyages, civières, demandes de lit) dans la structure de l’hôpital.</p>
        <p class="note">Recette seulement : jamais en production. Références fictives P-9xxxx.</p>
        <div><button class="btn" id="b-generer"${h.relie ? '' : ' disabled'}>Générer des patients fictifs</button></div></div>` : '';
  return `${gen}<p class="note">Cochez au fil des séances. Quand un rôle est terminé, l’étape Formation se coche seule.</p>
    <div class="roles-formation">${h.formation.map((f) => {
    const faits = f.elements.filter((e) => e.faite).length;
    return `<details class="etape${faits === f.elements.length ? ' fini' : ''}"><summary><span class="rond">${faits === f.elements.length ? icone('check') : faits}</span><span class="titre">${esc(f.nom)}</span>
      <span class="note">${faits}/${f.elements.length}${f.seance_le ? ` · séance le ${esc(jour(f.seance_le))}` : ''}</span></summary>
      <div class="cases-etape">${f.elements.map((e) => `<label class="case"><input type="checkbox" data-formation="${e.id}"${e.faite ? ' checked' : ''}>
        <span>${esc(e.libelle)}${e.faite && e.par ? `<span class="note"> · ${esc(e.par)}, ${esc(quand(e.quand))}</span>` : ''}</span></label>`).join('')}</div>
      <div class="ligne"><div class="champ"><label class="lbl" for="fo-${f.role}-date">Séance</label><input id="fo-${f.role}-date" type="date" data-fo="${f.role}" data-k="seance_le" value="${esc(f.seance_le ? String(f.seance_le).slice(0, 10) : '')}"></div>
        <div class="champ"><label class="lbl" for="fo-${f.role}-formateur">Formateur</label><input id="fo-${f.role}-formateur" data-fo="${f.role}" data-k="formateur" value="${esc(f.formateur || '')}"></div>
        <div class="champ"><label class="lbl" for="fo-${f.role}-personnes">Personnes formées</label><input id="fo-${f.role}-personnes" type="number" min="0" inputmode="numeric" data-fo="${f.role}" data-k="personnes" value="${f.personnes ?? ''}"></div></div>
      <div><button class="btn" data-fo-enregistrer="${f.role}">Enregistrer la séance</button></div></details>`;
  }).join('')}</div>`;
}

function brancherFormation(v, h) {
  v.querySelectorAll('[data-formation]').forEach((c) => {
    c.onchange = () => { etat.ouvert = c.closest('details').querySelector('.titre').textContent; agir(null, () => api('PUT', `/formation/${c.dataset.formation}`, { faite: c.checked })); };
  });
  v.querySelectorAll('[data-fo-enregistrer]').forEach((b) => {
    const role = b.dataset.foEnregistrer;
    b.onclick = () => {
      etat.ouvert = b.closest('details').querySelector('.titre').textContent;
      const val = (k) => $(`[data-fo="${role}"][data-k="${k}"]`).value;
      agir(b, () => api('PUT', `/hopitaux/${h.id}/formation/${role}`, { seance_le: val('seance_le'), formateur: val('formateur'), personnes: val('personnes') }), 'Séance enregistrée.');
    };
  });
  // Le rôle en cours reste ouvert après l'enregistrement
  if (etat.ouvert) v.querySelectorAll('.roles-formation details').forEach((d) => { if (d.querySelector('.titre').textContent === etat.ouvert) d.open = true; });
  const gen = $('#b-generer');
  if (gen) {
    gen.onclick = () => modale('Générer des patients fictifs', `<p>Des patients et des mouvements fictifs sont ajoutés dans la recette de ${esc(h.nom)}, pour les séances de formation. Vous pouvez recommencer autant de fois que nécessaire.</p>`,
      [{ label: 'Annuler' }, { label: 'Générer', pri: true, run: async () => {
        try {
          const n = await api('POST', `/hopitaux/${h.id}/formation/generer`);
          toast(`Données de formation : ${pl('{n|aucune admission|# admission|# admissions}', { n: n.admissions })}, ${pl('{n|aucune civière occupée|# civière occupée|# civières occupées}', { n: n.civieres })}, ${pl('{n|aucune demande de lit|# demande de lit|# demandes de lit}', { n: n.demandes })}.`);
          afficher();
          return true;
        } catch (e) { toast(e.message, true); return false; }
      } }]);
  }
}

function blocActivation(h) {
  const actif = h.distant && h.distant.module_actif;
  const hist = h.activations.length ? `<ul class="historique">${h.activations.slice(0, 5).map((a) => `<li><b>${a.action === 'activation' ? 'Activé' : 'Désactivé'}</b> ${esc(quand(a.quand))} · ${esc(a.par)}${a.motif ? `<br><span class="note">Motif : ${esc(a.motif)}</span>` : ''}</li>`).join('')}</ul>` : '';
  if (actif) return `<p>Le module est activé.</p><button class="btn dan" id="b-desactiver">Désactiver…</button>${hist}`;
  const reste = h.manquants.length;
  return `${reste ? `<p>${esc(pl('{n|Reste # élément|Restent # éléments}', { n: reste }))} à cocher avant le go-live :</p><ul class="manquants">${h.manquants.slice(0, 6).map((m) => `<li>${esc(m)}</li>`).join('')}${reste > 6 ? `<li class="note">${esc(pl('{n|et # autre|et # autres}', { n: reste - 6 }))}</li>` : ''}</ul>`
    : h.relie ? '<p>Toutes les étapes avant le go-live sont cochées.</p>' : '<p>Créez d’abord l’établissement dans l’environnement.</p>'}
    <button class="btn pri" id="b-activer"${h.peut_activer ? '' : ' disabled aria-disabled="true"'}>Activer le module</button>${hist}`;
}

function blocEtape(e) {
  const faits = e.verifications.filter((x) => x.faite).length;
  const fini = faits === e.verifications.length;
  const ch = (k, lib, val, type = 'text') => `<div class="champ"><label class="lbl" for="e${e.id}-${k}">${lib}</label><input id="e${e.id}-${k}" type="${type}" data-e="${e.id}" data-k="${k}" value="${esc(val ? String(val).slice(0, 10) : '')}"></div>`;
  return `<details class="etape${fini ? ' fini' : ''}" id="etape-${e.rang}"${!fini && faits > 0 ? ' open' : ''}><summary><span class="rond">${fini ? icone('check') : e.rang}</span><span class="titre">${esc(e.nom)}</span>
      <span class="note">${faits}/${e.verifications.length}${e.date_reelle ? ` · terminée le ${esc(jour(e.date_reelle))}` : e.date_prevue ? ` · prévue le ${esc(jour(e.date_prevue))}` : ''}</span></summary>
    <div class="cases-etape">${e.verifications.map((x) => `<label class="case"><input type="checkbox" data-verif="${x.id}"${x.faite ? ' checked' : ''}${AUTOMATIQUES[x.code] ? ' disabled' : ''}>
      <span>${esc(x.libelle)}${x.faite && x.par ? `<span class="note"> · ${esc(x.par)}, ${esc(quand(x.quand))}</span>` : ''}${AUTOMATIQUES[x.code] ? `<span class="note"> · ${esc(AUTOMATIQUES[x.code])}</span>` : ''}</span></label>`).join('')}</div>
    <div class="ligne">${ch('date_prevue', 'Date prévue', e.date_prevue, 'date')}${ch('date_reelle', 'Date réelle', e.date_reelle, 'date')}${ch('responsable', 'Responsable', e.responsable)}</div>
    <div class="champ"><label class="lbl" for="e${e.id}-notes">Notes</label><textarea id="e${e.id}-notes" rows="2" data-e="${e.id}" data-k="notes">${esc(e.notes || '')}</textarea></div>
    <div><button class="btn" data-etape="${e.id}">Enregistrer l’étape</button></div></details>`;
}

function blocImports(h) {
  const carte = (type) => {
    const x = etat.imports[type] || {};
    const v = x.verif;
    const dernier = h.imports.find((i) => i.type === type);
    let res = '';
    if (v && v.nb_erreurs) {
      res = `<div class="import-res erreur-res"><p><b>${esc(pl('{n|# erreur à corriger|# erreurs à corriger}', { n: v.nb_erreurs }))}</b> : rien n’a été écrit.</p><div class="tableau"><table class="compact"><thead><tr><th>Ligne</th><th>Colonne</th><th>Problème</th></tr></thead><tbody>
        ${v.erreurs.map((e) => `<tr><td class="num">${e.ligne}</td><td class="donnee">${esc(e.colonne || '—')}</td><td>${esc(messageImport(e))}</td></tr>`).join('')}</tbody></table></div></div>`;
    } else if (v) {
      res = `<div class="import-res"><p>${esc(pl('{n|# ligne vérifiée|# lignes vérifiées}', { n: v.lignes }))}, aucune erreur.</p>
        <p class="note">${esc(pl('{n|rien à créer|# à créer|# à créer}', { n: v.resume.creer }))} · ${esc(pl('{n|rien à mettre à jour|# à mettre à jour|# à mettre à jour}', { n: v.resume.maj }))} · ${esc(pl('{n|aucune inchangée|# inchangée|# inchangées}', { n: v.resume.inchange }))}</p>
        <button class="btn pri" data-imp-importer="${type}"${v.resume.creer + v.resume.maj ? '' : ' disabled'}>Importer</button></div>`;
    }
    return `<div class="import-carte"><div><h4>${esc(TYPES[type])}</h4><p class="note">Colonnes : <code class="donnee">${esc(COLONNES[type])}</code>. ${esc(AIDE_TYPES[type])}</p>
        ${dernier ? `<p class="note">Dernier import : ${esc(quand(dernier.quand))}${dernier.environnement ? ` · ${esc(ENVS[dernier.environnement])}` : ''} · ${esc(dernier.auteur)} · ${esc(pl('{n|aucune création|# création|# créations}', { n: dernier.creations }))}</p>` : ''}</div>
      <div class="ligne"><button class="btn" data-imp-modele="${type}" data-format="csv">${icone('download')}Modèle CSV</button><button class="btn" data-imp-modele="${type}" data-format="xlsx">${icone('download')}Modèle Excel</button>
        <label class="btn">Choisir CSV ou Excel<input type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-imp-fichier="${type}" hidden></label>
        <span class="note donnee">${esc(x.nom || '')}</span>
        <button class="btn pri" data-imp-verifier="${type}"${x.contenu ? '' : ' disabled'}>Vérifier</button></div>
        ${x.analyse ? `<div class="carte"><h4>Correspondance des colonnes</h4><div class="ligne">${COLONNES[type].split(';').map(c=>`<div class="champ"><label class="lbl" for="map-${type}-${c}">${esc(c)}</label><select id="map-${type}-${c}" data-map-type="${type}" data-map-cible="${c}"><option value="">— ignorer —</option>${x.analyse.headers.map(h=>`<option value="${esc(h)}"${(x.mapping?.[c]||'')===h?' selected':''}>${esc(h)}</option>`).join('')}</select></div>`).join('')}</div><p class="note">Aperçu : ${esc(JSON.stringify(x.analyse.apercu.slice(0,3)))}</p></div>`:''}${res}</div>`;
  };
  const editorAutorise=['administration','implantation'].includes(etat.moi?.utilisateur?.role) && h.environnement==='recette' && !h.golive_le && h.statut!=='actif';
  const editeur=editorAutorise?`<section class="panneau-c" id="editeur-structure"><h3>Éditeur manuel de structure</h3><p class="note">Préparation initiale en recette. Enregistrer passe par la même prévalidation et le même import transactionnel que les fichiers CSV/Excel. Après le Go Live, les changements opérationnels se font dans Arrimo.</p>
    <div class="ligne"><div class="champ"><label class="lbl" for="sh-structure-type">Élément</label><select id="sh-structure-type">${TYPES_STRUCTURE.map(t=>`<option value="${t}">${esc(TYPES[t])}</option>`).join('')}</select></div>
    <div class="champ"><label class="lbl" for="sh-structure-existant">Modifier un élément (facultatif)</label><select id="sh-structure-existant"><option value="">Nouvel élément</option></select></div></div>
    <form id="sh-structure-form"><div class="ligne" id="sh-structure-champs"></div><button class="btn pri" type="submit">Valider puis enregistrer</button><span class="note" id="sh-structure-resultat" aria-live="polite"></span></form>
    <div id="sh-structure-arbre" class="tableau"></div></section>`:'';
  return `${editeur}<p class="note">Structure initiale préparée dans SH avant le Go Live : départements, services, unités, étages et ailes, chambres, lits et civières. Les imports CSV/Excel créent ou mettent à jour les enregistrements après prévalidation; ils ne suppriment rien. La capacité est calculée dans Arrimo à partir des lits enregistrés.</p>
    <p class="note">Après le Go Live, Arrimo est la référence opérationnelle pour les états, confirmations, équipements et changements de structure. SH conserve le suivi d’implantation et l’historique des imports; il n’existe pas de synchronisation bidirectionnelle automatique. Les modifications postérieures sont faites dans Arrimo par les responsables autorisés. Aucun compte ni donnée patient ne transite dans un import de structure.</p>
    <p class="note">CSV UTF-8 ou Excel .xlsx ; modèles téléchargeables, prévisualisation, correspondance et validation avant écriture. L’import est transactionnel, journalisé et rejouable sans doublon.</p>
    <div class="imports">${etat.moi.types_import.map(carte).join('')}</div>`;
}

function brancherImports(v, h) {
  v.querySelectorAll('[data-imp-modele]').forEach((b) => {
    b.onclick = async () => {
      try {
        const format=b.dataset.format||'csv';
        const r = await fetch(`/api/hopitaux/${h.id}/import/modeles/${b.dataset.impModele}?format=${format}`, { headers: { Authorization: `Bearer ${etat.token}` } });
        if (!r.ok) throw new Error('Modèle indisponible : l’environnement ne répond pas.');
        telecharger(await r.blob(), `arrimo-${b.dataset.impModele}.${format}`);
      } catch (e) { toast(e.message, true); }
    };
  });
  v.querySelectorAll('[data-imp-fichier]').forEach((inp) => {
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      if (f.size > 1024 * 1024) { toast('Fichier trop gros (1 Mo au plus).', true); return; }
      const type=inp.dataset.impFichier;
      if (f.name.toLowerCase().endsWith('.xlsx')) {
        const bytes=new Uint8Array(await f.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
        const item={nom:f.name,format:'xlsx',contenu:btoa(binary),mapping:{}};
        item.analyse=await api('POST',`/hopitaux/${h.id}/import/analyser`,{type,contenu_xlsx:item.contenu});
        const normal=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,'_');
        for(const cible of COLONNES[type].split(';')) { const src=item.analyse.headers.find(hdr=>normal(hdr)===normal(cible));if(src)item.mapping[cible]=src; }
        etat.imports[type]=item;
      } else etat.imports[type] = { nom: f.name, format:'csv', contenu: await f.text() };
      afficher();
    };
  });
  v.querySelectorAll('[data-imp-verifier]').forEach((b) => {
    const type = b.dataset.impVerifier;
    b.onclick = () => agir(b, async () => { const x=etat.imports[type];x.verif = await api('POST', `/hopitaux/${h.id}/import/verifier`, { type, ...(x.format==='xlsx'?{contenu_xlsx:x.contenu,mapping:x.mapping}:{contenu:x.contenu}) }); });
  });
  v.querySelectorAll('[data-imp-importer]').forEach((b) => {
    const type = b.dataset.impImporter;
    b.onclick = () => agir(b, async () => {
      const x = etat.imports[type];
      const r = await api('POST', `/hopitaux/${h.id}/import/importer`, { type, ...(x.format==='xlsx'?{contenu_xlsx:x.contenu,mapping:x.mapping}:{contenu:x.contenu}), empreinte: x.verif.empreinte });
      delete etat.imports[type];
      if (r.invitations_envoyees) toast(`${r.invitations_envoyees} invitation(s) sécurisée(s) envoyée(s).`);
      return r;
    }, (r) => `Import fait : ${pl('{n|aucune création|# création|# créations}', { n: r.resume.creer })}, ${pl('{n|aucune mise à jour|# mise à jour|# mises à jour}', { n: r.resume.maj })}.`);
  });
  v.querySelectorAll('[data-map-type]').forEach(s=>s.onchange=()=>{const item=etat.imports[s.dataset.mapType];if(!item)return;if(s.value)item.mapping[s.dataset.mapCible]=s.value;else delete item.mapping[s.dataset.mapCible];item.verif=null;});
  brancherEditeurStructure(v,h);
}

function brancherEditeurStructure(v,h){
  const form=$('#sh-structure-form',v);if(!form)return;
  const types=COLONNES_STRUCTURE, labels={departements:'Département',services:'Service',unites:'Unité',etages:'Étage',chambres:'Chambre',lits:'Lit',civieres:'Civière'};
  const champs={
    departements:['departement','code','attributs_json','actif'],services:['service','code','departement','attributs_json','actif'],
    unites:['unite','type_unite','service','departement','attributs_json','actif'],etages:['unite','etage','aile','attributs_json','actif'],
    chambres:['unite','chambre','etage','type_chambre','capacite','accessible','attributs_json','restrictions_json','statut_operationnel','actif'],
    lits:['unite','chambre','lit','isolement','pression_negative','ventilation','telemetrie','categorie','attributs_json','actif'],
    civieres:['civiere','categorie','unite','attributs_json','actif']};
  let structure=null;const typeSel=$('#sh-structure-type',v), existSel=$('#sh-structure-existant',v), zone=$('#sh-structure-champs',v), arbre=$('#sh-structure-arbre',v);
  const nomChamp={departement:'Département',service:'Service',unite:'Unité',etage:'Étage',chambre:'Chambre',lit:'Identifiant du lit',civiere:'Identifiant de la civière',code:'Code',type_unite:'Type d’unité',type_chambre:'Type de chambre',capacite:'Capacité déclarée',accessible:'Accessible',aile:'Aile',categorie:'Catégorie',isolement:'Isolement',pression_negative:'Pression négative',ventilation:'Ventilation',telemetrie:'Télémétrie',attributs_json:'Attributs (JSON)',restrictions_json:'Restrictions (JSON)',statut_operationnel:'État opérationnel',actif:'Actif'};
  const cleLigne=(t,r)=>({departements:r.code,services:r.code,unites:r.unite,etages:`${r.unite} · ${r.etage}`,chambres:`${r.unite} · ${r.chambre}`,lits:r.lit,civieres:r.civiere}[t]);
  const renduArbre=()=>{
    if(!structure)return;
    const deps=structure.departements.map(d=>`<tr><td>Département</td><td>${esc(d.departement)} · ${esc(d.code)}</td><td>${d.actif?'Actif':'Inactif'}</td></tr>`);
    for(const u of structure.unites){const serv=structure.services.find(s=>s.service===u.service);deps.push(`<tr><td>Unité</td><td>↳ ${esc(u.departement||serv?.departement||'—')} / ${esc(u.service||'—')} / ${esc(u.unite)}</td><td>${u.actif?'Actif':'Inactif'}</td></tr>`);
      for(const ch of structure.chambres.filter(x=>x.unite===u.unite)){const nbLits=structure.lits.filter(x=>x.unite===u.unite&&x.chambre===ch.chambre).length;deps.push(`<tr><td>Chambre</td><td>　↳ ${esc(ch.etage||'')} / ${esc(ch.chambre)} · ${nbLits}/${esc(ch.capacite||'—')} lits</td><td>${ch.actif?'Actif':'Inactif'} · ${esc(ch.statut_operationnel||'')}</td></tr>`);
        for(const l of structure.lits.filter(x=>x.unite===u.unite&&x.chambre===ch.chambre))deps.push(`<tr><td>Lit</td><td>　　 ↳ ${esc(l.lit)}</td><td>${l.actif?'Actif':'Inactif'}</td></tr>`);}}
    for(const c of structure.civieres)deps.push(`<tr><td>Civière</td><td>${esc(c.unite||'—')} / ${esc(c.civiere)}</td><td>${c.actif?'Actif':'Inactif'}</td></tr>`);
    arbre.innerHTML=`<table class="compact"><thead><tr><th>Niveau</th><th>Rattachement et capacité calculée</th><th>État</th></tr></thead><tbody>${deps.join('')||'<tr><td colspan="3">Aucune structure configurée.</td></tr>'}</tbody></table>`;
  };
  const chargerType=()=>{
    const t=typeSel.value, rows=structure?.[t]||[];existSel.innerHTML=`<option value="">Nouvel élément</option>${rows.map((r,i)=>`<option value="${i}">${esc(cleLigne(t,r))}</option>`).join('')}`;
    zone.innerHTML=champs[t].map(k=>{const id=`sh-structure-${k}`;if(['actif','accessible','isolement','pression_negative','ventilation','telemetrie'].includes(k))return `<div class="champ"><label class="lbl" for="${id}">${esc(nomChamp[k])}</label><select id="${id}" data-k="${k}"><option value="">—</option><option value="oui">Oui</option><option value="non">Non</option></select></div>`;
      if(k==='statut_operationnel')return `<div class="champ"><label class="lbl" for="${id}">${esc(nomChamp[k])}</label><select id="${id}" data-k="${k}"><option value="actif">Actif</option><option value="maintenance">Maintenance</option><option value="ferme">Fermée</option></select></div>`;
      const big=k.endsWith('_json');return `<div class="champ${big?' large':''}"><label class="lbl" for="${id}">${esc(nomChamp[k]||k)}</label>${big?`<textarea id="${id}" data-k="${k}" rows="2">{}</textarea>`:`<input id="${id}" data-k="${k}" ${k==='capacite'?'type="number" min="1" max="100"':''}>`}</div>`;}).join('');
  };
  const prefill=()=>{const t=typeSel.value, i=existSel.value;if(i==='')return;const r=structure?.[t]?.[Number(i)];if(!r)return;zone.querySelectorAll('[data-k]').forEach(el=>{const k=el.dataset.k;let val=r[k];if(k==='actif'||['accessible','isolement','pression_negative','ventilation','telemetrie'].includes(k))val=val===true?'oui':val===false?'non':val??'';if(k.endsWith('_json')&&val&&typeof val==='object')val=JSON.stringify(val);el.value=val??'';});};
  typeSel.onchange=()=>{chargerType();};existSel.onchange=prefill;chargerType();
  api('GET',`/hopitaux/${h.id}/structure`).then(data=>{structure=data;renduArbre();chargerType();}).catch(e=>{toast(e.message,true);});
  form.onsubmit=async ev=>{ev.preventDefault();const t=typeSel.value, cols=types[t].split(';'), row=Object.fromEntries([...zone.querySelectorAll('[data-k]')].map(x=>[x.dataset.k,x.value]));
    const quote=x=>{const s=String(x??'');return /[;"\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};const contenu=`${cols.join(';')}\n${cols.map(c=>quote(row[c])).join(';')}\n`;
    const out=$('#sh-structure-resultat',v);out.textContent='Vérification…';
    try{const check=await api('POST',`/hopitaux/${h.id}/import/verifier`,{type:t,contenu});if(check.nb_erreurs){out.textContent=check.erreurs.map(e=>`L${e.ligne} ${e.colonne||''}: ${messageImport(e)}`).join(' · ');return;}
      const total=check.resume.creer+check.resume.maj;if(!total){out.textContent='Aucun changement à enregistrer.';return;}
      const cle=check.actions.map(x=>x.cle).join(', ');if(!confirm(`Valider ${labels[t].toLowerCase()} ${cle} : ${check.resume.creer} création(s), ${check.resume.maj} mise(s) à jour ?`))return;
      await api('POST',`/hopitaux/${h.id}/import/importer`,{type:t,contenu,empreinte:check.empreinte});out.textContent='Enregistré et journalisé.';structure=await api('GET',`/hopitaux/${h.id}/structure`);renduArbre();chargerType();existSel.value='';toast('Structure mise à jour via l’import sécurisé.');
    }catch(e){out.textContent=e.message;toast(e.message,true);}
  };
}

/* ---------------- journal SH ---------------- */
async function vueJournal(v, avant) {
  const lignes = await api('GET', `/journal${avant ? `?avant=${avant}` : ''}`);
  const html = lignes.map((j) => `<tr><td class="note">${esc(quand(j.date))}</td><td>${esc(j.utilisateur || '—')}</td><td><b>${esc(j.action)}</b></td>
    <td>${esc(j.cible || '')}${j.hopital ? `<div class="note">${esc(j.hopital)}</div>` : ''}</td><td class="note">${esc(j.detail || '')}</td></tr>`).join('');
  if (avant) { $('#journal-corps').insertAdjacentHTML('beforeend', html); } else {
    v.innerHTML = `<div class="entete"><div><h2>Journal SH</h2><p>Qui a fait quoi et quand dans la console. Ce journal ne peut être ni modifié ni effacé, même directement dans la base.</p></div></div>
      <div class="tableau"><table><thead><tr><th>Date</th><th>Qui</th><th>Action</th><th>Cible</th><th>Détail</th></tr></thead><tbody id="journal-corps">${html}</tbody></table></div><div class="plus" id="journal-plus"></div>`;
  }
  $('#journal-plus').innerHTML = lignes.length === 100 ? '<button class="btn" id="b-plus">Voir les entrées précédentes</button>' : '';
  const plus = $('#b-plus');
  if (plus) plus.onclick = () => vueJournal(v, lignes[lignes.length - 1].id).catch((e) => toast(e.message, true));
}

/* ---------------- équipe SH ---------------- */
async function vueEquipe(v) {
  const equipe = await api('GET', '/equipe');
  const invitations = await api('GET', '/invitations');
  const moi = etat.moi.utilisateur;
  v.innerHTML = `<div class="entete"><div><h2>Équipe SH</h2><p>Comptes de la console. La double authentification est obligatoire pour chacun, dès la première connexion.</p></div></div>
    <div class="deux"><div class="panneau-c"><h3>Nouveau membre</h3>
        <div class="champ"><label class="lbl" for="m-nom">Nom</label><input id="m-nom" autocomplete="off"></div>
        <div class="champ"><label class="lbl" for="m-email">Courriel</label><input id="m-email" type="email" autocomplete="off"></div>
        <div class="champ"><label class="lbl" for="m-role">Rôle</label><select id="m-role"><option value="support">Support</option><option value="commercial">Commercial</option><option value="implantation">Implantation</option><option value="formation">Formation</option><option value="administration">Administration</option></select></div>
        <button class="btn pri" id="b-membre">Envoyer l’invitation</button>
        <p class="note">La personne choisit son propre mot de passe avec un lien individuel à usage unique. Aucun mot de passe n’est affiché.</p></div>
      <div><div class="tableau"><table><thead><tr><th>Membre</th><th>Rôle et sécurité</th><th>Dernière connexion</th><th></th></tr></thead><tbody>
      ${equipe.map((m) => `<tr><td><span class="donnee">${esc(m.nom)}</span>${m.actif ? '' : ' <span class="badge">Désactivé</span>'}<div class="note">${esc(m.email)}</div></td>
        <td><select data-role="${m.id}"${m.id === moi.id ? ' disabled' : ''}>${['administration', 'commercial', 'implantation', 'formation', 'support'].map((r) => `<option value="${r}"${m.role === r ? ' selected' : ''}>${r}</option>`).join('')}</select><div class="note">${m.totp_actif ? 'Double authentification' : 'Double authentification à activer'}</div></td>
        <td class="note">${m.derniere_connexion ? esc(quand(m.derniere_connexion)) : 'Jamais'}</td>
        <td>${m.id === moi.id ? '<span class="note">Vous</span>' : `<div class="ligne serre"><button class="btn" data-reinit="${m.id}" data-nom="${esc(m.nom)}">Envoyer un lien</button>
          <button class="btn${m.actif ? ' dan' : ''}" data-actif="${m.id}" data-val="${!m.actif}">${m.actif ? 'Désactiver' : 'Réactiver'}</button></div>`}</td></tr>`).join('')}</tbody></table></div>
      ${invitations.length ? `<section class="panneau-c"><h3>Invitations en attente</h3><div class="tableau"><table><thead><tr><th>Destinataire</th><th>Rôle</th><th>Expire</th></tr></thead><tbody>${invitations.map((i) => `<tr><td>${esc(i.nom)}<div class="note">${esc(i.email)}</div></td><td>${esc(i.role)}</td><td class="note">${esc(quand(i.expire_le))}</td></tr>`).join('')}</tbody></table></div></section>` : '<p class="note">Aucune invitation en attente.</p>'}</div></div>`;
  $('#b-membre').onclick = (ev) => agir(ev.target, async () => {
    const r = await api('POST', '/equipe', { nom: $('#m-nom').value, email: $('#m-email').value, role: $('#m-role').value });
    return r;
  }, 'Invitation envoyée.');
  v.querySelectorAll('[data-reinit]').forEach((b) => {
    b.onclick = () => modale(`Envoyer un lien à ${b.dataset.nom}`, '<p>Un lien individuel à usage unique sera envoyé. Les sessions existantes seront révoquées et la personne devra reconfigurer sa double authentification.</p>',
      [{ label: 'Annuler' }, { label: 'Envoyer', pri: true, run: async () => {
        try {
          await api('POST', `/equipe/${b.dataset.reinit}/inviter`);
          toast('Lien envoyé.'); await afficher();
          return true;
        } catch (e) { toast(e.message, true); return false; }
      } }]);
  });
  v.querySelectorAll('[data-role]').forEach((s) => { s.onchange = () => agir(s, () => api('PUT', `/equipe/${s.dataset.role}/role`, { role: s.value }), 'Rôle modifié.'); });
  v.querySelectorAll('[data-actif]').forEach((b) => { b.onclick = () => agir(b, () => api('PUT', `/equipe/${b.dataset.actif}`, { actif: b.dataset.val === 'true' }), 'Compte modifié.'); });
}

/* ---------------- mon compte ---------------- */
function vueCompte(v) {
  const u = etat.moi.utilisateur;
  v.innerHTML = `<div class="entete"><div><h2>Mon compte</h2><p><span class="donnee">${esc(u.nom)}</span> · ${esc(u.email)} · double authentification active</p></div></div>
    <form class="panneau-c compte" id="f-mdp"><h3>Changer de mot de passe</h3>
      <div class="champ"><label class="lbl" for="m-actuel">Mot de passe actuel</label><input id="m-actuel" type="password" autocomplete="current-password"></div>
      <div class="champ"><label class="lbl" for="m-nouveau">Nouveau mot de passe</label><input id="m-nouveau" type="password" autocomplete="new-password"></div>
      <div class="champ"><label class="lbl" for="m-confirme">Confirmer</label><input id="m-confirme" type="password" autocomplete="new-password"></div>
      <p class="note">Au moins 12 caractères, avec des lettres et des chiffres. Vos autres sessions seront fermées.</p>
      <div><button class="btn pri" type="submit">Enregistrer</button></div></form>`;
  $('#f-mdp').onsubmit = (e) => {
    e.preventDefault();
    if ($('#m-nouveau').value !== $('#m-confirme').value) { toast('Les deux mots de passe sont différents.', true); return; }
    agir(null, () => api('PUT', '/moi/mot-de-passe', { actuel: $('#m-actuel').value, nouveau: $('#m-nouveau').value }), 'Mot de passe enregistré.');
  };
}

/* ---------------- démarrage ---------------- */
if (new URLSearchParams(location.hash.slice(1)).has('invitation')) {
  etat.token = null; ecrire('sh-token', null); montrer('#f-invitation');
} else if (etat.token) demarrer(); else montrer('#f-connexion');
