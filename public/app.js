/* Arrimo — interface. Toutes les règles sont appliquées par le serveur. Textes : public/i18n/<langue>.js, via t(). */
'use strict';

const ORDRE_ETATS = ['libre', 'reserve', 'occupe', 'nettoyage', 'indispo'];
const ACTIONS = {
  libre: [['reserver', true], ['hors_service']],
  reserve: [['admettre', true], ['annuler']],
  occupe: [['liberer', true], ['conge'], ['nsa']],
  nettoyage: [['nettoyage_ok', true]],
  indispo: [['remettre', true]],
};
const STATUTS = [['demande', 'var(--attention)'], ['validee', 'var(--secondaire)'], ['transport', 'var(--info)'],
  ['en_route', 'var(--principal)'], ['recu', 'var(--succes)'], ['refuse', 'var(--critique)']];
const BESOINS = ['isolement', 'pression_negative', 'ventilation', 'telemetrie'];
/** Niveau d'alerte : petite pastille de couleur et libellé en couleur de texte normale. */
const niveauHTML = (n, suite = '') => `<span class="etat-niveau n-${n}">${esc(t(`niveaux.${n}`))}${suite}</span>`;

const etat = {
  token: null, moi: null, ctx: null, vue: 'copilote', filtreUnite: '*', jours: 30,
  recherche: { type_id: null, patient_ref: '', urgent: true, res: null, choix: null, besoins: {} },
  question: '', reponse: '',
};
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Icône de la bibliothèque (public/icones.svg, Lucide), décorative. */
const icone = (nom, cls = 'ic') => `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="icones.svg#i-${nom}"/></svg>`;
const lire = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const ecrire = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };

/* ---------------- langue ---------------- */
const LANGUES = ['fr', 'en'];
// Choix mémorisé ; s'il n'est pas disponible (stockage bloqué), il est gardé en mémoire pour la session
let langue = LANGUES.includes(lire('arrimo-langue')) ? lire('arrimo-langue') : 'fr';
const dicoDe = (l) => (window.ARRIMO_I18N || {})[l] || {};
const chercher = (l, cle) => cle.split('.').reduce((o, k) => (o == null ? o : o[k]), dicoDe(l));
const aTrad = (cle) => chercher(langue, cle) != null;

/** Texte de l'interface dans la langue choisie (repli sur le français, puis sur la clé). Variables : {nom}. */
function t(cle, vars) {
  let v = chercher(langue, cle);
  if (v == null) v = chercher('fr', cle);
  if (v == null) return cle;
  if (typeof v !== 'string' || !vars) return v;
  // Pluriels {n|un|plusieurs}, nombres selon la langue ; une variable « *_etat » est un état de lit ou de civière
  return F.remplir(locale(), v, vars, (k, x) => (k.endsWith('_etat') ? t(`etats.${x}`) : undefined));
}
const F = window.ArrimoFormat;
const locale = () => chercher(langue, 'langue.locale') || 'fr-CA';
/** Mise en forme selon la langue : nombre, pourcentage, durée (minutes). */
const nb = (n, dec = 1) => F.nombre(locale(), n, dec);
const pct = (n, dec = 1) => F.pourcent(locale(), n, dec);
const duree = (min) => F.duree(locale(), min);
const nomType = (ty) => (ty ? (langue === 'en' && ty.nom_en) || ty.nom : '');
const fuseau = () => { try { return configCtx().fuseau; } catch { return undefined; } };

/** Applique la langue aux textes fixes de la page (attributs data-i18n). */
function appliquerLangue() {
  document.documentElement.lang = locale();
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(';').forEach((paire) => { const [attr, cle] = paire.split(':'); el.setAttribute(attr, t(cle)); });
  });
  document.querySelectorAll('select.choix-langue').forEach((s) => { s.value = langue; });
}
function changerLangue(l) {
  if (!LANGUES.includes(l) || l === langue) return;
  langue = l;
  ecrire('arrimo-langue', l);
  appliquerLangue();
  if (etat.moi) { majNomUtilisateur(); majSelecteurCtx(); etat.reponse = ''; rafraichir(); }
}
document.querySelectorAll('select.choix-langue').forEach((s) => {
  s.innerHTML = LANGUES.map((l) => `<option value="${l}">${esc(dicoDe(l).langue?.court || l.toUpperCase())} · ${esc(dicoDe(l).langue?.nom || l)}</option>`).join('');
  s.onchange = () => changerLangue(s.value);
});

/** Temps écoulé depuis une date : « 25 min », « 5 h 08 », « 3 j 4 h ». */
const depuis = (iso) => duree((Date.now() - new Date(iso)) / 60000);
const heure = (iso) => new Date(iso).toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: fuseau() });

function toast(msg, err) {
  const el = document.createElement('div');
  el.className = `toast${err ? ' err' : ''}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), err ? 7000 : 4500);
}

/* ---------------- API ---------------- */
/** Message d'erreur dans la langue choisie, à partir du code stable du serveur (repli : texte français du serveur). */
function messageErreur(data, statut) {
  if (data && data.code && aTrad(`erreurs.${data.code}`)) return t(`erreurs.${data.code}`, data.vars || {});
  return (data && data.erreur) || t('general.erreur_http', { statut });
}
async function api(methode, chemin, corps) {
  const r = await fetch(`/api${chemin}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', 'X-Langue': langue, ...(etat.token ? { Authorization: `Bearer ${etat.token}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* réponse vide */ }
  if (r.status === 401 && etat.token && !etat.pause) { deconnecter(true); }
  if (!r.ok) {
    const e = new Error(messageErreur(data, r.status));
    e.code = data && data.code;
    throw e;
  }
  return data;
}

/** Exécute une action en désactivant le bouton, affiche l'erreur du serveur si refus. */
async function agir(bouton, fn, succes) {
  if (bouton) bouton.disabled = true;
  try {
    const r = await fn();
    if (succes) toast(typeof succes === 'function' ? succes(r) : succes);
    await rafraichir();
    return r;
  } catch (e) {
    toast(e.message, true);
    await rafraichir();
    return null;
  } finally {
    if (bouton) bouton.disabled = false;
  }
}

/* ---------------- modale ---------------- */
function modale(titre, corps, actions) {
  const m = $('#modale');
  m.innerHTML = `<div class="boite" role="dialog" aria-modal="true" aria-label="${esc(titre)}"><h3>${esc(titre)}</h3>${corps}<div class="actions"></div></div>`;
  const zone = $('.actions', m);
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.className = `btn${a.pri ? ' pri' : ''}`;
    b.textContent = a.label;
    b.onclick = async () => {
      if (a.run) { b.disabled = true; const garder = await a.run(); b.disabled = false; if (garder === false) return; }
      m.hidden = true;
    };
    zone.appendChild(b);
  });
  m.hidden = false;
  ($('input, textarea', m) || zone.lastChild).focus();
}
$('#modale').addEventListener('click', (e) => { if (e.target.id === 'modale') e.target.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#modale').hidden = true; $('#panneau-notif').hidden = true; fermerAide(); fermerMenu(); } });

/* ---------------- menu du compte : aide, mon compte, langue, déconnexion ---------------- */
function fermerMenu(rendreFocus) {
  const m = $('#menu-compte');
  if (!m || m.hidden) return;
  m.hidden = true;
  $('#b-menu').setAttribute('aria-expanded', 'false');
  if (rendreFocus) $('#b-menu').focus();
}
$('#b-menu').onclick = (e) => {
  e.stopPropagation();
  const m = $('#menu-compte');
  if (!m.hidden) { fermerMenu(); return; }
  m.hidden = false;
  $('#b-menu').setAttribute('aria-expanded', 'true');
  $('.menu-item', m).focus();
};
document.addEventListener('click', (e) => { if (!e.target.closest('.menu-compte')) fermerMenu(); });
// Flèches haut/bas entre les éléments du menu
$('#menu-compte').addEventListener('keydown', (e) => {
  if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
  e.preventDefault();
  const items = [...document.querySelectorAll('#menu-compte .menu-item, #menu-compte select')];
  const i = items.indexOf(document.activeElement);
  items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
});
document.querySelectorAll('#menu-compte .menu-item').forEach((b) => b.addEventListener('click', () => fermerMenu()));

/* ---------------- connexion ---------------- */
$('#f-connexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#c-erreur');
  err.hidden = true;
  try {
    const r = await api('POST', '/connexion', { email: $('#c-email').value, mot_de_passe: $('#c-mdp').value });
    $('#c-mdp').value = '';
    if (r.etape === '2fa') {
      etat.jeton2fa = r.jeton;
      montrerFormulaire('#f-2fa');
      $('#c-code').value = '';
      $('#c-code').focus();
      return;
    }
    await ouvrir(r.token);
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

function montrerFormulaire(sel) {
  ['#f-connexion', '#f-2fa', '#f-mdp-temp', '#f-oubli', '#f-reinit'].forEach((f) => { $(f).hidden = f !== sel; });
  $('#ecran-connexion').hidden = false;
  $('#ecran-app').hidden = true;
}
async function ouvrir(token) {
  etat.token = token;
  ecrire('arrimo-token', token);
  await demarrer();
}
$('#f-2fa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#c-erreur-2fa'); err.hidden = true;
  try {
    const r = await api('POST', '/connexion/2fa', { jeton: etat.jeton2fa, code: $('#c-code').value });
    await ouvrir(r.token);
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
    if (['etape_expiree', 'trop_essais'].includes(ex.code)) setTimeout(() => montrerFormulaire('#f-connexion'), 1800);
  }
});
$('#b-retour-connexion').onclick = () => montrerFormulaire('#f-connexion');

/* Mot de passe oublié : lien par courriel (visible seulement si l'envoi de courriels est configuré) */
$('#b-oubli').onclick = () => { $('#o-email').value = $('#c-email').value; $('#o-message').hidden = true; $('#o-erreur').hidden = true; montrerFormulaire('#f-oubli'); $('#o-email').focus(); };
$('#b-oubli-retour').onclick = () => montrerFormulaire('#f-connexion');
$('#f-oubli').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#o-erreur').hidden = true;
  try {
    await api('POST', '/mot-de-passe/oubli', { email: $('#o-email').value });
    $('#o-message').textContent = t('connexion.oubli_envoye');
    $('#o-message').hidden = false;
  } catch (ex) { $('#o-erreur').textContent = ex.message; $('#o-erreur').hidden = false; }
});
let jetonReinit = null;
$('#f-reinit').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#r-erreur'); err.hidden = true;
  try {
    if ($('#r-nouveau').value !== $('#r-confirme').value) throw new Error(t('general.deux_mdp_differents'));
    await api('POST', '/mot-de-passe/reinitialiser', { jeton: jetonReinit, nouveau: $('#r-nouveau').value });
    ['#r-nouveau', '#r-confirme'].forEach((x) => { $(x).value = ''; });
    jetonReinit = null;
    montrerFormulaire('#f-connexion');
    $('#c-erreur').hidden = true;
    toast(t('connexion.reinit_ok'));
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});
$('#f-mdp-temp').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#t-erreur'); err.hidden = true;
  try {
    if ($('#t-nouveau').value !== $('#t-confirme').value) throw new Error(t('general.deux_mdp_differents'));
    await api('PUT', '/moi/mot-de-passe', { actuel: $('#t-actuel').value, nouveau: $('#t-nouveau').value });
    ['#t-actuel', '#t-nouveau', '#t-confirme'].forEach((x) => { $(x).value = ''; });
    toast(t('connexion.mdp_enregistre'));
    await demarrer();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});

function deconnecter(expire) {
  if (etat.token && !expire) api('POST', '/deconnexion').catch(() => {});
  etat.token = null;
  etat.moi = null;
  ecrire('arrimo-token', null);
  fermerAide();
  montrerFormulaire('#f-connexion');
  if (expire) { $('#c-erreur').textContent = t('connexion.session_expiree'); $('#c-erreur').hidden = false; }
}
$('#b-deconnexion').onclick = () => deconnecter(false);
$('#b-compte').onclick = () => allerA('compte');
function allerA(vue) {
  etat.vue = vue;
  document.querySelectorAll('#onglets button').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.v === vue)));
  document.querySelectorAll('.contenu > section').forEach((sec) => { sec.hidden = sec.id !== `v-${vue}`; });
  rafraichir();
}

function majNomUtilisateur() {
  const u = etat.moi.utilisateur;
  $('#nom-utilisateur').textContent = `${u.nom}${u.role === 'gestionnaire' ? t('barre.gestionnaire') : ''}`;
  $('#menu-qui').innerHTML = `<strong>${esc(u.nom)}</strong><span>${esc(u.email)}</span>`;
}
function majSelecteurCtx() {
  $('#ctx').innerHTML = etat.moi.etablissements.map((e) => `<option value="${e.id}">${esc(e.nom)}${e.module_actif ? '' : esc(t('barre.module_desactive'))}</option>`).join('');
  $('#ctx').value = etat.ctx;
}

async function demarrer() {
  etat.moi = await api('GET', '/moi');
  $('#bandeau-demo').hidden = !etat.moi.demo;
  if (etat.moi.utilisateur.mdp_temporaire) { montrerFormulaire('#f-mdp-temp'); $('#t-actuel').focus(); return; }
  const etabs = etat.moi.etablissements;
  majNomUtilisateur();
  if (!etabs.length) {
    $('#ecran-connexion').hidden = false;
    $('#c-erreur').textContent = t('connexion.sans_etab');
    $('#c-erreur').hidden = false;
    return;
  }
  const memo = Number(lire('arrimo-ctx'));
  etat.ctx = etabs.some((e) => e.id === memo) ? memo : (etabs.find((e) => e.module_actif) || etabs[0]).id;
  majSelecteurCtx();
  $('#ecran-connexion').hidden = true;
  $('#ecran-app').hidden = false;
  const entretien = estEntretien();
  document.querySelectorAll('#onglets button').forEach((b) => {
    b.hidden = (entretien && b.dataset.v !== 'nettoyage') || (b.dataset.v === 'admin' && !etat.moi.utilisateur.admin);
  });
  $('#b-notif').hidden = entretien;
  if (entretien) etat.vue = 'nettoyage';
  document.querySelectorAll('#onglets button').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.v === etat.vue)));
  document.querySelectorAll('.contenu > section').forEach((sec) => { sec.hidden = sec.id !== `v-${etat.vue}`; });
  await rafraichir();
  veilleNotifs();
  if (!etat.moi.utilisateur.premiers_pas_vus) premiersPas();
  document.body.dataset.pret = '1';
}
const estEntretien = () => etat.moi && etat.moi.utilisateur.role === 'entretien';

$('#ctx').onchange = async (e) => {
  etat.ctx = Number(e.target.value);
  ecrire('arrimo-ctx', etat.ctx);
  etat.filtreUnite = '*';
  etat.suites = {};
  etat.recherche = { ...etat.recherche, res: null, choix: null };
  etat.reponse = '';
  await rafraichir();
};
document.querySelectorAll('#onglets button').forEach((b) => {
  b.onclick = async () => {
    etat.vue = b.dataset.v;
    document.querySelectorAll('#onglets button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('.contenu > section').forEach((s) => { s.hidden = s.id !== `v-${etat.vue}`; });
    await rafraichir();
  };
});

const etabCtx = () => etat.moi.etablissements.find((e) => e.id === etat.ctx);
const configCtx = () => etat.moi.configs.find((c) => c.id === etabCtx().config_id);

let enCours = false;
async function rafraichir() {
  if (!etat.token || !etat.moi || enCours) return;
  enCours = true;
  try {
    const e = etabCtx();
    const bandeau = $('#bandeau');
    bandeau.hidden = e.module_actif;
    bandeau.innerHTML = e.module_actif ? '' : `<div>${t('barre.bandeau_inactif', { etab: esc(e.nom) })}</div>`;
    await Promise.all([majCompteurs(), ({
      copilote: vueCopilote, reseau: vueReseau, national: vueNational, lits: vueLits, urgence: vueUrgence, admissions: vueAdmissions, transferts: vueTransferts,
      nettoyage: vueNettoyage, nsa: vueNsa, indicateurs: vueIndicateurs, journal: vueJournal, params: vueParams,
      admin: vueAdmin, compte: vueCompte,
    })[etat.vue]()]);
    if (!$('#panneau-aide').hidden) afficherAide();
  } catch (err) {
    if (etat.token) toast(err.message, true);
  } finally {
    enCours = false;
  }
}
setInterval(() => { if ($('#modale').hidden && document.visibilityState === 'visible') rafraichir(); }, 30000);

/* ---------------- Notifications en direct : pastille et bandeau « disponibilité à côté », sans recharger la page ---------------- */
async function veilleNotifs() {
  if (!etat.token || !etat.moi || etat.pause || estEntretien() || document.visibilityState !== 'visible') return;
  const ctx = etat.ctx;
  const notifs = await api('GET', `/notifications?etablissement_id=${ctx}`).catch(() => null);
  if (!notifs || ctx !== etat.ctx) return;
  const nonLues = notifs.filter((n) => !n.lu).length;
  $('#n-notif').hidden = !nonLues; $('#n-notif').textContent = nonLues;
  etat.notifs = notifs;
  const max = notifs.reduce((m, n) => Math.max(m, Number(n.id)), 0);
  const dernier = etat.derniereNotif?.[ctx];
  etat.derniereNotif = { ...(etat.derniereNotif || {}), [ctx]: max };
  if (dernier == null) return;   // premier passage : rien n'est « nouveau »
  const dispo = notifs.find((n) => Number(n.id) > dernier && !n.lu && ['dispo_lit', 'dispo_civiere'].includes(n.code));
  if (dispo) montrerDispo(dispo);
}
setInterval(veilleNotifs, Number(window.ARRIMO_VEILLE_MS || 15000));
function montrerDispo(n) {
  const b = $('#bandeau-dispo');
  const lit = n.code === 'dispo_lit';
  b.innerHTML = `<div>${icone(lit ? 'bed-double' : 'siren')}<span>${esc(n.message)}</span>
    <span class="actions-dispo">${lit ? `<button class="btn pri" id="b-dispo-ici">${esc(t('national.transferer_ici'))}</button>` : `<button class="btn" id="b-dispo-voir">${esc(t('dispo.voir'))}</button>`}
    <button class="btn discret" id="b-dispo-fermer" aria-label="${esc(t('general.fermer'))}">${icone('x')}</button></span></div>`;
  b.hidden = false;
  $('#b-dispo-fermer').onclick = () => { b.hidden = true; };
  const voir = $('#b-dispo-voir');
  if (voir) voir.onclick = () => { b.hidden = true; allerA('national'); };
  const ici = $('#b-dispo-ici');
  if (ici) {
    ici.onclick = async () => {
      const r = await api('GET', `/national?depuis=${etat.ctx}&type_id=${n.vars.type_id}&avec_lit=1&taille=50`).catch((e) => { toast(e.message, true); return null; });
      const x = r && r.etablissements.find((e) => e.id === Number(n.vars.etab_id));
      if (!x) { toast(t('dispo.plus_libre'), true); b.hidden = true; return; }
      b.hidden = true;
      etat.national.type_id = String(n.vars.type_id);
      transfererIci(x);
    };
  }
}

async function majCompteurs() {
  const net = await api('GET', `/nettoyage?etablissement_id=${etat.ctx}`);
  $('#n-net').textContent = net.length;
  if (estEntretien()) return;
  const [notifs, trs, adm] = await Promise.all([
    api('GET', `/notifications?etablissement_id=${etat.ctx}`),
    api('GET', `/transferts?etablissement_id=${etat.ctx}`),
    api('GET', `/admissions?etablissement_id=${etat.ctx}`),
  ]);
  $('#n-adm').textContent = adm.filter((d) => d.statut === 'attente').length;
  const nonLues = notifs.filter((n) => !n.lu).length;
  $('#n-notif').hidden = !nonLues;
  $('#n-notif').textContent = nonLues;
  $('#n-tr').textContent = trs.filter((x) => !['recu', 'refuse'].includes(x.statut)).length;
  etat.notifs = notifs;
}
$('#b-notif').onclick = async () => {
  const p = $('#panneau-notif');
  if (!p.hidden) { p.hidden = true; return; }
  fermerAide();
  const n = etat.notifs || [];
  p.innerHTML = `<div class="entete"><h3>${esc(t('notifs.titre'))}</h3><button class="btn" id="b-fermer-notif">${esc(t('general.fermer'))}</button></div>${
    n.length ? n.map((x) => `<div class="notif${x.lu ? '' : ' nouvelle'}"><div>${esc(x.message)}</div><div class="note">${heure(x.date)}</div></div>`).join('')
      : `<p class="note">${esc(t('notifs.aucune'))}</p>`}`;
  p.hidden = false;
  $('#b-fermer-notif').onclick = () => { p.hidden = true; };
  if (n.some((x) => !x.lu)) { await api('POST', '/notifications/lues', { etablissement_id: etat.ctx }).catch(() => {}); majCompteurs(); }
};

/* ---------------- Réseau ---------------- */
function barre(rep, total) {
  if (!rep) return '<div class="barre-c"></div>';
  return `<div class="barre-c">${ORDRE_ETATS.map((k) => (rep[k] ? `<i class="f-${k}" style="width:${(rep[k] / total) * 100}%" title="${esc(t(`etats.${k}`))} : ${rep[k]}"></i>` : '')).join('')}</div>`;
}
const casesBesoins = (attr, coches = {}) => BESOINS.map((k) => `<label class="case"><input type="checkbox" ${attr}="${k}"${coches[k] ? ' checked' : ''}> ${esc(t(`besoins.${k}`))}</label>`).join('');

async function vueReseau() {
  const v = $('#v-reseau');
  const e = etabCtx();
  if (!e.module_actif) { v.innerHTML = `<p class="note">${esc(t('reseau.inactif'))}</p>`; return; }
  const cfg = configCtx();
  const R = etat.recherche;
  if (!R.type_id || !cfg.types.some((x) => x.id === R.type_id)) R.type_id = cfg.types[0]?.id;
  const [res, blocages] = await Promise.all([
    api('GET', `/reseau?depuis=${etat.ctx}`),
    api('GET', `/blocages?etablissement_id=${etat.ctx}`),
  ]);

  const resume = cfg.types.map((ty) => {
    let libres = 0; let dotes = 0;
    res.etablissements.forEach((x) => x.unites.filter((u) => u.type_id === ty.id).forEach((u) => { libres += u.libres; dotes += u.dotes; }));
    return `<div><span class="lbl">${esc(nomType(ty))}</span><span class="gros num">${t('reseau.libres_sur', { libres, dotes })}</span><span class="note">${esc(t('reseau.occupation', { n: pct(dotes ? ((dotes - libres) / dotes) * 100 : 0) }))}</span></div>`;
  }).join('');

  let resHTML = '';
  if (R.res) {
    resHTML = R.res.suggestions.length ? R.res.suggestions.map((s) => {
      const choisi = R.choix && R.choix.etablissement_id === s.etablissement_id;
      return `<div class="item${choisi ? ' choisi' : ''}"><div><strong>${esc(s.nom)}</strong>${s.recommande ? ` <span class="badge fort">${esc(t('reseau.recommande'))}</span>` : ''}${!s.libres ? ` <span class="badge">${esc(t('reseau.prevision_seulement'))}</span>` : ''}
        <div class="note">${esc(s.ville)}${s.partage === 'agrege' ? esc(t('reseau.lit_par_receveur')) : s.lit ? esc(t('reseau.lit_code', { code: s.lit.code })) : ''}</div>
        <div class="note num">${esc(s.raison)}</div>${s.pourquoi ? `<div class="note">${esc(s.pourquoi)}</div>` : ''}</div>
        ${s.libres ? `<button class="btn${choisi ? ' pri' : ''}" data-choix="${s.etablissement_id}">${esc(t(choisi ? 'reseau.propose' : 'reseau.proposer'))}</button>` : ''}</div>`;
    }).join('') : `<p class="note">${esc(t('reseau.aucun_rayon', { km: cfg.rayon_km }))}</p>`;
    resHTML = `<p class="note">${esc(t('reseau.chez_vous', { n: R.res.libres_ici }))}</p><div class="liste">${resHTML}</div>`;
  }
  let confirmHTML = '';
  if (R.choix) {
    const lit = R.choix.lit ? t('reseau.reserver_le_lit', { code: esc(R.choix.lit.code) }) : esc(t('reseau.reserver_un_lit'));
    confirmHTML = `<div class="confirmer"><span class="lbl">${esc(t('reseau.validation_humaine'))}</span>
      <div>${t('reseau.reserver_phrase', { lit, etab: esc(R.choix.nom), ref: esc(R.patient_ref || '—'), urgent: R.urgent ? ` <span class="urgent">${esc(t('reseau.urgent'))}</span>` : '' })}</div>
      <div class="note">${esc(t('reseau.validation_aide'))}</div>
      <div class="ligne"><button class="btn pri" id="b-valider">${esc(t('reseau.valider'))}</button><button class="btn" id="b-annuler-choix">${esc(t('general.annuler'))}</button></div></div>`;
  }

  const blocHTML = blocages.length ? blocages.map((b) => {
    const act = b.etat === 'nettoyage' ? ['nettoyage_ok', 'nettoyage_ok'] : b.etat === 'reserve' ? ['annuler', 'annuler_reservation'] : b.etat === 'indispo' ? ['remettre', 'remettre'] : null;
    return `<div class="item"><div><span class="risque ${b.blocage_niveau}">${esc(t(`blocages_niveaux.${b.blocage_niveau}`))}</span> <b class="num">${esc(b.code)}</b><div class="note">${esc(b.blocage_motif)}</div></div>
      ${act ? `<button class="btn" data-lit="${b.id}" data-action="${act[0]}" data-version="${b.version}">${esc(t(`actions_lit.${act[1]}`))}</button>` : ''}</div>`;
  }).join('') : `<p class="note">${esc(t('reseau.aucun_blocage'))}</p>`;

  const etabsHTML = res.etablissements.map((x) => `<article class="etab${x.moi ? ' moi' : ''}"><header><div><h3>${esc(x.nom)}</h3>
      <span class="note">${esc(x.ville || '')}${x.moi ? '' : ` · <span class="num">${esc(t('general.km', { n: x.distance_km }))}</span>`}</span></div>
      <div>${x.moi ? `<span class="badge fort">${esc(t('reseau.votre_etab'))}</span>` : `<span class="badge">${esc(t(`partage.${x.partage}`))}</span>`}</div></header>
      <div class="unites">${x.unites.map((u) => `<div class="unite"><span>${esc(u.type_nom)}</span>${barre(u.repartition, u.dotes + (u.repartition?.indispo || 0))}
        <span class="num">${u.libres} / ${u.dotes}${u.prevus != null ? ` <small class="muted" title="${esc(t('reseau.prevus_titre'))}">+${u.prevus}</small>` : ''}</span>
        <span class="risque ${u.risque}" title="${esc(t('reseau.risque_titre'))}">${esc(t(`risques.${u.risque}`))}</span></div>`).join('')}</div>
      ${x.urgence ? `<div class="urgence-etab"><span>${esc(t('reseau.urgence', { occ: x.urgence.occupees, fonc: x.urgence.fonctionnelles }))}</span>
        <span><b class="num">${pct(x.urgence.taux)}</b>${x.urgence.plus_24h != null ? ` · ${esc(t('reseau.urgence_24h', { n: x.urgence.plus_24h }))}` : ''}
        ${niveauHTML(x.urgence.niveau)}</span></div>` : ''}
      ${x.partage === 'agrege' && !x.moi ? `<p class="note" style="margin:8px 0 0">${esc(t('reseau.agrege_note'))}</p>` : ''}</article>`).join('');

  v.innerHTML = `<div class="entete"><div><h2>${esc(t('reseau.titre'))}</h2><p>${esc(t('reseau.intro', { etab: e.nom, h: cfg.horizon_h }))}</p></div>
    <div class="legende">${ORDRE_ETATS.map((k) => `<span><i class="f-${k}"></i>${esc(t(`etats.${k}`))}</span>`).join('')}</div></div>
    <div class="resume">${resume}</div>
    <div class="deux"><div class="pile">
      <div class="panneau-c"><div><h3>${esc(t('reseau.chercher_titre'))}</h3><p class="note">${esc(t('reseau.chercher_aide'))}</p></div>
        <div class="ligne"><div class="champ"><label class="lbl" for="r-type">${esc(t('reseau.type_unite'))}</label><select id="r-type">${cfg.types.map((ty) => `<option value="${ty.id}"${ty.id === R.type_id ? ' selected' : ''}>${esc(nomType(ty))}</option>`).join('')}</select></div>
        <div class="champ"><label class="lbl" for="r-pat">${esc(t('reseau.ref_patient'))}</label><input id="r-pat" placeholder="${esc(cfg.reference_exemple)}" value="${esc(R.patient_ref)}" autocomplete="off"></div></div>
        <div class="cases">${casesBesoins('data-besoin', R.besoins)}</div>
        <div class="ligne" style="justify-content:space-between"><label class="case"><input type="checkbox" id="r-urg"${R.urgent ? ' checked' : ''}> ${esc(t('reseau.urgent'))}</label><button class="btn pri" id="b-chercher">${esc(t('reseau.rechercher'))}</button></div>
        ${resHTML}${confirmHTML}</div>
      <div class="panneau-c"><div><h3>${esc(t('reseau.blocages_titre'))}</h3><p class="note">${esc(t('reseau.blocages_aide'))}</p></div><div class="liste">${blocHTML}</div></div>
    </div><div class="etabs">${etabsHTML}</div></div>`;

  $('#r-type').onchange = (ev) => { R.type_id = Number(ev.target.value); R.res = null; R.choix = null; rafraichir(); };
  $('#r-pat').oninput = (ev) => { R.patient_ref = ev.target.value.trim(); };
  $('#r-urg').onchange = (ev) => { R.urgent = ev.target.checked; };
  $('#b-chercher').onclick = (ev) => agir(ev.target, async () => {
    R.res = await api('GET', `/recherche?depuis=${etat.ctx}&type_id=${R.type_id}${qsBesoins(R.besoins)}`);
    R.choix = null;
  });
  v.querySelectorAll('[data-choix]').forEach((b) => { b.onclick = () => { R.choix = R.res.suggestions.find((s) => s.etablissement_id === Number(b.dataset.choix)); rafraichir(); }; });
  const val = $('#b-valider');
  if (val) {
    val.onclick = () => agir(val, async () => {
      const tr = await api('POST', '/transferts', {
        origine_id: etat.ctx, destination_id: R.choix.etablissement_id, type_id: R.type_id,
        lit_id: R.choix.lit?.id, version: R.choix.lit?.version, patient_ref: R.patient_ref, urgent: R.urgent, besoins: R.besoins,
      });
      R.res = null; R.choix = null; R.patient_ref = '';
      return tr;
    }, (tr) => t('reseau.lit_bloque', { lit: tr.lit_code, numero: tr.numero }));
  }
  const an = $('#b-annuler-choix');
  if (an) an.onclick = () => { R.choix = null; rafraichir(); };
  brancherActionsLit(v);
  v.querySelectorAll('[data-besoin]').forEach((c) => { c.onchange = () => { R.besoins[c.dataset.besoin] = c.checked; R.res = null; R.choix = null; }; });
}

/* ---------------- Tableau national par proximité ---------------- */
etat.national = { type_id: '', max: '', besoins: {}, avec_lit: false, page: 1, carte: false };
const COULEURS_NIVEAU = { vert: '#16A34A', jaune: '#F59E0B', orange: '#D97706', rouge: '#DC2626' };
let leaflet = null; let carteNat = null;
/** Charge Leaflet (hébergé ici) seulement quand la carte est ouverte. */
function chargerLeaflet() {
  if (leaflet) return leaflet;
  leaflet = new Promise((ok, ko) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet/leaflet.css'; document.head.appendChild(css);
    const js = document.createElement('script'); js.src = 'vendor/leaflet/leaflet.js'; js.onload = () => ok(window.L); js.onerror = ko; document.head.appendChild(js);
  });
  return leaflet;
}
async function vueNational() {
  const v = $('#v-national');
  const e = etabCtx();
  const N = (k, vars) => esc(t(`national.${k}`, vars));
  if (!e.module_actif) { v.innerHTML = `<p class="note">${N('inactif')}</p>`; return; }
  const cfg = configCtx(); const F = etat.national;
  const qs = `depuis=${etat.ctx}&page=${F.page}${F.type_id ? `&type_id=${F.type_id}` : ''}${F.max ? `&max_minutes=${F.max}` : ''}${F.avec_lit && F.type_id ? '&avec_lit=1' : ''}${qsBesoins(F.besoins)}`;
  const r = await api('GET', `/national?${qs}`);
  const typeChoisi = cfg.types.find((x) => String(x.id) === String(F.type_id));
  const carteEtab = (x) => {
    const u = x.urgence;
    const lignes = x.unites.map((un) => `<div class="nat-unite${String(un.type_id) === String(F.type_id) ? ' choisie' : ''}"><span>${esc(un.type_nom)}</span>
      <span class="num">${esc(t('national.libres', { n: un.libres }))}</span><span class="note num">${un.prevus != null ? esc(t('national.prevus', { n: un.prevus, h: cfg.horizon_h })) : esc(t('national.prevus_inconnu'))}</span></div>`).join('');
    const peut = !x.moi && (!typeChoisi || x.unites.some((un) => un.type_id === typeChoisi.id && un.libres > 0));
    return `<article class="etab${x.moi ? ' moi' : ''}"><header><div><h3>${esc(x.nom)}</h3>
        <div class="note donnee">${esc([x.adresse, x.ville].filter(Boolean).join(', '))}</div>
        ${x.moi ? '' : `<div class="nat-route">${icone('map-pin')}<span class="num">${esc(t('national.route', { km: x.distance_km, duree: duree(x.minutes_route) }))}</span></div>`}</div>
        <div class="nat-etat">${x.moi ? `<span class="badge fort">${N('vous')}</span>` : `<span class="badge">${esc(t(`partage.${x.partage}`))}</span>`} ${niveauHTML(x.niveau, ` · ${esc(pct(x.pression))}`)}</div></header>
      <div class="nat-unites">${lignes || `<p class="note">${N('aucune_unite')}</p>`}</div>
      ${u ? `<div class="urgence-etab"><span>${esc(t('reseau.urgence', { occ: u.occupees, fonc: u.fonctionnelles }))}</span><span><b class="num">${esc(pct(u.taux))}</b>${u.plus_24h != null ? ` · ${esc(t('reseau.urgence_24h', { n: u.plus_24h }))}` : ''} ${niveauHTML(u.niveau)}</span></div>` : ''}
      ${peut ? `<div class="actions-etab"><button class="btn pri" data-ici="${x.id}">${icone('ambulance')}${N('transferer_ici')}</button></div>` : ''}
      ${x.partage === 'agrege' && !x.moi ? `<p class="note">${esc(t('reseau.agrege_note'))}</p>` : ''}</article>`;
  };
  v.innerHTML = `<div class="entete"><div><h2>${N('titre')}</h2><p>${N('intro', { etab: e.nom })}</p></div>
      <div class="chips" role="group" aria-label="${N('affichage')}"><button class="chip" data-nv="liste" aria-pressed="${!F.carte}">${N('liste')}</button><button class="chip" data-nv="carte" aria-pressed="${F.carte}">${N('carte')}</button></div></div>
    <div class="panneau-c filtres"><div class="ligne">
      <div class="champ"><label class="lbl" for="n-type">${N('type')}</label><select id="n-type"><option value="">${N('tous_types')}</option>${cfg.types.map((ty) => `<option value="${ty.id}"${String(ty.id) === String(F.type_id) ? ' selected' : ''}>${esc(nomType(ty))}</option>`).join('')}</select></div>
      <div class="champ"><label class="lbl" for="n-max">${N('temps_max')}</label><select id="n-max"><option value="">${N('sans_limite')}</option>${[30, 60, 120, 240].map((m) => `<option value="${m}"${String(m) === String(F.max) ? ' selected' : ''}>${esc(t('national.au_plus', { duree: duree(m) }))}</option>`).join('')}</select></div></div>
      <div class="cases">${casesBesoins('data-nbesoin', F.besoins)}<label class="case"><input type="checkbox" id="n-libre"${F.avec_lit ? ' checked' : ''}${F.type_id ? '' : ' disabled'}> ${N('avec_lit')}</label></div>
      ${F.type_id ? '' : `<p class="note">${N('avec_lit_aide')}</p>`}</div>
    <p class="nat-total">${N('total', { n: r.total })}${r.pages > 1 ? ` · ${N('page', { p: r.page, n: r.pages })}` : ''}</p>
    ${F.carte ? `<div id="carte-nat" class="carte-nat" role="region" aria-label="${N('carte')}"></div><p class="note">${N('carte_note')}</p>` : ''}
    <div class="etabs">${r.etablissements.map(carteEtab).join('') || `<p class="vide">${N('aucun')}</p>`}</div>
    ${r.pages > 1 ? `<div class="pagination"><button class="btn" id="n-prec"${r.page <= 1 ? ' disabled' : ''}>${N('precedent')}</button><button class="btn" id="n-suiv"${r.page >= r.pages ? ' disabled' : ''}>${N('suivant')}</button></div>` : ''}`;
  const changer = (fn) => { fn(); F.page = 1; rafraichir(); };
  $('#n-type').onchange = (ev) => changer(() => { F.type_id = ev.target.value; if (!F.type_id) F.avec_lit = false; });
  $('#n-max').onchange = (ev) => changer(() => { F.max = ev.target.value; });
  $('#n-libre').onchange = (ev) => changer(() => { F.avec_lit = ev.target.checked; });
  v.querySelectorAll('[data-nbesoin]').forEach((c) => { c.onchange = () => changer(() => { F.besoins[c.dataset.nbesoin] = c.checked; }); });
  v.querySelectorAll('[data-nv]').forEach((b) => { b.onclick = () => { F.carte = b.dataset.nv === 'carte'; rafraichir(); }; });
  if ($('#n-prec')) { $('#n-prec').onclick = () => { F.page -= 1; rafraichir(); }; $('#n-suiv').onclick = () => { F.page += 1; rafraichir(); }; }
  v.querySelectorAll('[data-ici]').forEach((b) => { b.onclick = () => transfererIci(r.etablissements.find((x) => x.id === Number(b.dataset.ici))); });
  if (F.carte) dessinerCarte();
}
async function dessinerCarte() {
  try {
    const [L, points] = await Promise.all([chargerLeaflet(), api('GET', `/national/carte?depuis=${etat.ctx}`)]);
    const zone = $('#carte-nat');
    if (!zone) return;
    if (carteNat) { carteNat.remove(); carteNat = null; }
    carteNat = L.map(zone, { scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 15, attribution: '&copy; OpenStreetMap' }).addTo(carteNat);
    const bornes = [];
    for (const p of points) {
      const m = L.circleMarker([p.latitude, p.longitude], { radius: p.moi ? 10 : 7, color: p.moi ? '#0E5E6F' : '#FFFFFF', weight: p.moi ? 3 : 2,
        fillColor: COULEURS_NIVEAU[p.niveau], fillOpacity: 0.95 }).addTo(carteNat);
      m.bindPopup(`<strong>${esc(p.nom)}</strong><br>${esc(p.ville || '')}<br>${esc(t(`niveaux.${p.niveau}`))} · ${esc(t('national.libres', { n: p.libres }))}`);
      bornes.push([p.latitude, p.longitude]);
    }
    if (bornes.length) carteNat.fitBounds(bornes, { padding: [24, 24], maxZoom: 11 });
  } catch (err) { toast(t('national.carte_indisponible'), true); }
}
/** « Transférer ici » : la référence, l'urgence et les besoins ; le lit est réservé chez le receveur, qui doit accepter. */
function transfererIci(x) {
  const cfg = configCtx(); const F = etat.national;
  const types = cfg.types.filter((ty) => x.unites.some((u) => u.type_id === ty.id && u.libres > 0));
  modale(t('national.transfert_titre', { etab: x.nom }), `<p class="note">${esc(t('national.route', { km: x.distance_km, duree: duree(x.minutes_route) }))}</p>
    <div class="champ"><label class="lbl" for="m-ntype">${esc(t('national.type'))}</label><select id="m-ntype">${types.map((ty) => `<option value="${ty.id}"${String(ty.id) === String(F.type_id) ? ' selected' : ''}>${esc(nomType(ty))}</option>`).join('')}</select></div>
    <div class="champ"><label class="lbl" for="m-npat">${esc(t('reseau.ref_patient'))}</label><input id="m-npat" placeholder="${esc(cfg.reference_exemple)}" autocomplete="off"></div>
    <div class="cases">${casesBesoins('data-mnbesoin', F.besoins)}<label class="case"><input type="checkbox" id="m-nurg"> ${esc(t('reseau.urgent'))}</label></div>
    <p class="note">${esc(t('national.transfert_aide'))}</p>`,
  [{ label: t('general.annuler') }, { label: t('national.demander'), pri: true, run: async () => {
    const besoins = {}; document.querySelectorAll('#modale [data-mnbesoin]').forEach((c) => { besoins[c.dataset.mnbesoin] = c.checked; });
    return (await agir(null, () => api('POST', '/transferts', { origine_id: etat.ctx, destination_id: x.id, type_id: Number($('#m-ntype').value),
      patient_ref: $('#m-npat').value.trim(), urgent: $('#m-nurg').checked, besoins, hors_rayon: true }), (tr) => t('reseau.lit_bloque', { lit: tr.lit_code, numero: tr.numero }))) !== null || false;
  } }]);
}

/* ---------------- Lits ---------------- */
const options = (groupe, cles, choisi) => cles.map((k) => `<option value="${k}"${k === choisi ? ' selected' : ''}>${esc(t(`${groupe}.${k}`))}</option>`).join('');
const ORIENTATIONS = ['chsld', 'ri', 'readaptation', 'domicile', 'palliatif', 'autre'];
const MOTIFS = ['personnel', 'equipement', 'travaux', 'infection', 'autre'];
const CONGES = ['prevu', 'confirme', 'attente_transport'];

function brancherActionsLit(racine) {
  racine.querySelectorAll('[data-lit]').forEach((b) => {
    b.onclick = () => {
      const id = Number(b.dataset.lit);
      const action = b.dataset.action;
      const version = Number(b.dataset.version);
      const code = b.dataset.code || '';
      const cfg = configCtx();
      if (action === 'reserver') {
        modale(t('lits.reserver_titre', { code }), `<div class="champ"><label class="lbl" for="m-pat">${esc(t('reseau.ref_patient'))}</label><input id="m-pat" placeholder="${esc(cfg.reference_exemple)}" autocomplete="off"></div>
          <p class="note">${esc(t('lits.ref_seulement'))}</p>`,
        [{ label: t('general.annuler') }, { label: t('actions_lit.reserver'), pri: true, run: async () => (await agir(null, () => api('POST', `/lits/${id}/action`, { action, version, patient_ref: $('#m-pat').value.trim() }), t('lits.reserve_ok', { code }))) !== null || false }]);
        return;
      }
      if (action === 'conge') {
        modale(t('lits.conge_titre', { code }), `<div class="champ"><label class="lbl" for="m-conge-statut">${esc(t('lits.statut'))}</label><select id="m-conge-statut"><option value="">${esc(t('general.aucun'))}</option>${options('conges', CONGES)}</select></div>
          <div class="champ"><label class="lbl" for="m-conge">${esc(t('lits.date_prevue'))}</label><input id="m-conge" type="datetime-local"></div>
          <p class="note">${esc(t('lits.conge_aide'))}</p>`,
        [{ label: t('general.annuler') }, { label: t('general.enregistrer'), pri: true, run: async () => {
          const val = $('#m-conge').value;
          const statut = $('#m-conge-statut').value || null;
          const corps = { statut };
          if (val) corps.sortie_prevue = new Date(val).toISOString();
          return (await agir(null, () => api('PUT', `/lits/${id}/conge`, corps), t('lits.conge_ok'))) !== null || false;
        } }]);
        return;
      }
      if (action === 'nsa') {
        modale(t('lits.nsa_titre', { code }), `<p class="note">${esc(t('lits.nsa_aide'))}</p>
          <div class="champ"><label class="lbl" for="m-orient">${esc(t('lits.orientation'))}</label><select id="m-orient">${options('orientations', ORIENTATIONS)}</select></div>`,
        [{ label: t('general.annuler') }, { label: t('lits.designer'), pri: true, run: async () => (await agir(null, () => api('POST', `/lits/${id}/nsa`, { orientation: $('#m-orient').value }), t('lits.nsa_ok', { code }))) !== null || false }]);
        return;
      }
      if (action === 'retirer_nsa') {
        agir(b, () => api('DELETE', `/lits/${id}/nsa`), t('lits.nsa_retire', { code }));
        return;
      }
      if (action === 'hors_service') {
        modale(t('lits.hs_titre', { code }), `<div class="champ"><label class="lbl" for="m-motif-i">${esc(t('lits.motif_lbl'))}</label><select id="m-motif-i">${options('motifs', MOTIFS)}</select></div>
          <p class="note">${esc(t('lits.hs_aide'))}</p>`,
        [{ label: t('general.annuler') }, { label: t('lits.hs_bouton'), pri: true, run: async () => (await agir(null, () => api('POST', `/lits/${id}/action`, { action, version, motif: $('#m-motif-i').value }), t('lits.hs_ok', { code }))) !== null || false }]);
        return;
      }
      agir(b, () => api('POST', `/lits/${id}/action`, { action, version }), (l) => t('lits.etat_ok', { code: l.code, etat: t(`etats.${l.etat}`) }));
    };
  });
}

async function vueLits() {
  const v = $('#v-lits');
  const lits = await api('GET', `/lits?etablissement_id=${etat.ctx}`);
  const actif = etabCtx().module_actif;
  const unites = [...new Map(lits.map((l) => [l.type_id, l.unite])).entries()];
  const liste = etat.filtreUnite === '*' ? lits : lits.filter((l) => l.type_id === Number(etat.filtreUnite));
  const cols = ORDRE_ETATS.map((st) => {
    const items = liste.filter((l) => l.etat === st);
    return `<div class="col e-${st}"><h3>${esc(t(`etats.${st}`))} <span class="num">${items.length}</span></h3>${items.map((l) => `<div class="fiche e-${st}">
      <div class="t"><b>${esc(l.code)}</b><span class="note num" title="${esc(t('lits.depuis_titre'))}">${depuis(l.etat_depuis)}</span></div>
      <div class="note">${esc(t('lits.chambre', { unite: l.unite, ch: l.chambre }))}</div>
      ${l.patient_ref ? `<div class="note">${t('lits.patient', { ref: esc(l.patient_ref) })}${l.transfert_numero ? ` · ${esc(l.transfert_numero)}` : ''}</div>` : ''}
      ${attributs(l)}
      ${l.nsa_depuis ? `<div><span class="nsa-tag">${esc(t('lits.nsa_tag', { depuis: depuis(l.nsa_depuis), orient: l.nsa_orientation ? t(`orientations.${l.nsa_orientation}`) : '' }))}</span></div>` : ''}
      ${l.sortie_prevue ? `<div class="note">${esc(t('lits.conge', { statut: t(`conges.${l.conge_statut || 'prevu'}`).toLowerCase(), heure: heure(l.sortie_prevue) }))}</div>` : ''}
      ${l.motif_indispo ? `<div class="note">${esc(t('lits.motif', { motif: t(`motifs.${l.motif_indispo}`) }))}</div>` : ''}
      ${l.blocage_motif ? `<div class="alerte">${esc(l.blocage_motif)}</div>` : ''}
      ${actif ? `<div class="actions">${ACTIONS[st].map(([a, p]) => (a === 'nsa' && l.nsa_depuis ? ['retirer_nsa', false] : [a, p])).map(([a, p]) => `<button class="btn${p ? ' pri' : ''}" data-lit="${l.id}" data-action="${a}" data-version="${l.version}" data-code="${esc(l.code)}">${esc(t(`actions_lit.${a}`))}</button>`).join('')}</div>` : ''}
    </div>`).join('') || `<div class="vide">${esc(t('lits.aucun'))}</div>`}</div>`;
  }).join('');
  v.innerHTML = `<div class="entete"><div><h2>${esc(t('lits.titre', { etab: etabCtx().nom }))}</h2><p>${esc(t('lits.intro'))}</p></div></div>
    <div class="chips"><button class="chip" aria-pressed="${etat.filtreUnite === '*'}" data-u="*">${esc(t('lits.toutes_unites'))}</button>${unites.map(([id, nom]) => `<button class="chip" aria-pressed="${String(etat.filtreUnite) === String(id)}" data-u="${id}">${esc(nom)}</button>`).join('')}</div>
    <div class="kanban">${cols}</div>`;
  v.querySelectorAll('[data-u]').forEach((c) => { c.onclick = () => { etat.filtreUnite = c.dataset.u; rafraichir(); }; });
  brancherActionsLit(v);
}

/* ---------------- Transferts ---------------- */
function actionsTransfert(x) {
  const a = [];
  const dest = x.destination_id === etat.ctx;
  const orig = x.origine_id === etat.ctx;
  if (x.statut === 'demande' && dest) a.push(['accepter', true]);
  if (['demande', 'validee'].includes(x.statut) && dest) a.push(['refuser']);
  if (x.statut === 'validee' && orig) a.push(['transport', true]);
  if (x.statut === 'transport' && orig) a.push(['depart', true]);
  if (x.statut === 'en_route' && dest) a.push(['reception', true]);
  if (['validee', 'transport', 'en_route'].includes(x.statut) && dest && !x.date_chambre_prete) a.push(['chambre_prete', x.statut !== 'en_route']);
  return a;
}
const heureCourte = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', timeZone: fuseau() });
/** Compte à rebours jusqu'à l'heure d'arrivée prévue, mis à jour sans recharger la page. */
function majDecomptes() {
  document.querySelectorAll('[data-eta]').forEach((el) => {
    const m = (new Date(el.dataset.eta) - Date.now()) / 60000;
    const z = el.querySelector('.decompte');
    if (z) z.textContent = m >= 1 ? t('transferts.dans', { duree: duree(m) }) : m > -1 ? t('transferts.imminente') : t('transferts.retard', { duree: duree(-m) });
  });
}
setInterval(majDecomptes, 15000);
function attente(x) {
  const cote = { demande: 'destination', validee: 'origine', transport: 'origine', en_route: 'destination' }[x.statut];
  if (!cote) return '';
  const id = cote === 'origine' ? x.origine_id : x.destination_id;
  return id === etat.ctx ? '' : t('transferts.attente_de', { etab: cote === 'origine' ? x.origine_nom : x.destination_nom });
}
async function vueTransferts() {
  const v = $('#v-transferts');
  const page = await api('GET', `/transferts?etablissement_id=${etat.ctx}`);
  const termine = (x) => ['recu', 'refuse'].includes(x.statut);
  const { lignes: trs, plus } = avecSuite('transferts', page, page.filter(termine).length);
  const actif = etabCtx().module_actif;
  const cols = STATUTS.map(([k, c]) => {
    const tous = trs.filter((x) => x.statut === k);
    // Transferts terminés (reçus, refusés) : les plus récents d'abord, le reste sur demande
    const items = ['recu', 'refuse'].includes(k) && !etat.toutTermines ? tous.slice(0, 8) : tous;
    const reste = tous.length - items.length;
    return `<div class="col" style="--c:${c}"><h3>${esc(t(`statuts.${k}`))} <span class="num">${tous.length}</span></h3>${reste ? `<button class="btn discret" data-tout-termines>${esc(t('transferts.tout_afficher', { n: reste }))}</button>` : ''}${items.map((x) => `<div class="fiche" style="--c:${x.urgent ? 'var(--critique)' : 'var(--secondaire)'}">
      <div class="t"><b>${esc(x.numero)}</b>${x.urgent ? `<span class="urgent">${esc(t('transferts.urgent'))}</span>` : `<span class="note">${esc(t(x.destination_id === etat.ctx ? 'transferts.entrant' : 'transferts.sortant'))}</span>`}</div>
      <div style="font-size:12px">${esc(x.origine_nom)} → ${esc(x.destination_nom)}</div>
      <div class="note">${esc(x.type_nom)} · ${esc(t('transferts.lit'))} <span class="num">${esc(x.lit_code || '—')}</span> · <span class="num">${esc(x.patient_ref)}</span></div>
      <div class="note"><span class="num">${x.distance_km != null ? esc(t('general.km', { n: x.distance_km })) : '—'}</span> · ${depuis(x.date_demande)}${x.transport_info ? ` · ${esc(x.transport_info)}` : ''}</div>
      ${besoinsTransfert(x) ? `<div class="note">${esc(t('transferts.besoins', { liste: besoinsTransfert(x) }))}</div>` : ''}
      ${x.statut === 'en_route' && x.arrivee_prevue ? `<div class="arrivee" data-eta="${esc(x.arrivee_prevue)}">${icone('clock')}<span><strong>${esc(t('transferts.arrivee', { heure: heureCourte(x.arrivee_prevue) }))}</strong> · <span class="decompte"></span></span></div>` : ''}
      ${['validee', 'transport', 'en_route'].includes(x.statut) ? (x.date_chambre_prete ? `<div><span class="etat-niveau n-vert">${esc(t('transferts.badge_prete'))}</span></div>`
    : x.destination_id === etat.ctx ? `<div><span class="etat-niveau n-jaune">${esc(t('transferts.a_preparer'))}</span></div>` : `<div class="note">${esc(t('transferts.chambre_en_preparation'))}</div>`) : ''}
      ${x.motif_refus ? `<div class="note">${esc(t('transferts.motif', { motif: '' }))}<span class="donnee">${esc(x.motif_refus)}</span></div>` : ''}
      ${attente(x) ? `<div class="note">${esc(attente(x))}</div>` : ''}
      ${actif ? `<div class="actions">${actionsTransfert(x).map(([a, p]) => `<button class="btn${p ? ' pri' : ''}${a === 'refuser' ? ' dan' : ''}" data-tr="${x.id}" data-etape="${a}" data-num="${esc(x.numero)}">${esc(t(`transferts.${a}`))}</button>`).join('')}</div>` : ''}
    </div>`).join('') || `<div class="vide">${esc(t('transferts.aucun'))}</div>`}</div>`;
  }).join('');
  v.innerHTML = `<div class="entete"><div><h2>${esc(t('transferts.titre', { etab: etabCtx().nom }))}</h2><p>${esc(t('transferts.intro'))}</p></div></div><div class="kanban">${cols}</div>${plus ? boutonPlus('transferts') : ''}`;
  brancherPlus(v, 'transferts', `/transferts?etablissement_id=${etat.ctx}`, trs.filter(termine));
  v.querySelectorAll('[data-tr]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.tr; const etape = b.dataset.etape; const numero = b.dataset.num;
      if (etape === 'refuser') {
        modale(t('transferts.refuser_titre', { numero }), `<div class="champ"><label class="lbl" for="m-motif">${esc(t('transferts.motif_facultatif'))}</label><input id="m-motif" maxlength="300" autocomplete="off"></div>
          <p class="note">${esc(t('transferts.refuser_aide'))}</p>`,
        [{ label: t('general.retour') }, { label: t('transferts.refuser_bouton'), pri: true, run: async () => (await agir(null, () => api('POST', `/transferts/${id}/refuser`, { motif: $('#m-motif').value }), t('transferts.refuse_ok', { numero }))) !== null || false }]);
        return;
      }
      agir(b, () => api('POST', `/transferts/${id}/${etape}`), t({ accepter: 'transferts.accepte_ok', chambre_prete: 'transferts.chambre_prete_ok', transport: 'transferts.transport_ok', depart: 'transferts.depart_ok', reception: 'transferts.reception_ok' }[etape], { numero }));
    };
  });
  v.querySelectorAll('[data-tout-termines]').forEach((b) => { b.onclick = () => { etat.toutTermines = true; rafraichir(); }; });
  majDecomptes();
}
const besoinsTransfert = (x) => BESOINS.filter((k) => x.besoins?.[k]).map((k) => t(`besoins.${k}`).toLowerCase()).join(', ');

/* ---------------- Listes longues : pages de 300 lignes, « Afficher plus » ---------------- */
const PAGE = 300;
etat.suites = {};
/** Ajoute aux lignes de la première page celles déjà chargées par « Afficher plus ». */
function avecSuite(cle, premiere, nbPagine = premiere.length) {
  const s = etat.suites[cle] || (etat.suites[cle] = { lignes: [], fin: false });
  const vus = new Set(premiere.map((x) => x.id));
  return { lignes: [...premiere, ...s.lignes.filter((x) => !vus.has(x.id))], plus: !s.fin && (s.lignes.length > 0 || nbPagine >= PAGE) };
}
const boutonPlus = (cle) => `<div class="plus"><button class="btn" data-plus="${cle}">${esc(t('journal.plus'))}</button></div>`;
function brancherPlus(racine, cle, chemin, dernieres) {
  const b = racine.querySelector(`[data-plus="${cle}"]`);
  if (!b) return;
  b.onclick = () => agir(b, async () => {
    const der = dernieres[dernieres.length - 1];
    const res = await api('GET', `${chemin}${chemin.includes('?') ? '&' : '?'}avant=${encodeURIComponent(der.curseur)}`);
    const s = etat.suites[cle];
    s.lignes.push(...res);
    if (res.length < PAGE) s.fin = true;
  });
}

/* ---------------- Journal ---------------- */
const libelleAction = (groupe, a) => (aTrad(`${groupe}.${a}`) ? t(`${groupe}.${a}`) : a);
async function vueJournal() {
  const { lignes, plus } = avecSuite('journal', await api('GET', `/journal?etablissement_id=${etat.ctx}`));
  const etatLib = (k) => (k ? t(`etats.${k}`) : '—');
  $('#v-journal').innerHTML = `<div class="entete"><div><h2>${esc(t('journal.titre', { etab: etabCtx().nom }))}</h2><p>${esc(t('journal.intro'))}</p></div></div>
    <div class="tableau"><table><thead><tr><th>${esc(t('journal.date'))}</th><th>${esc(t('journal.utilisateur'))}</th><th>${esc(t('journal.action'))}</th><th>${esc(t('journal.lit'))}</th><th>${esc(t('journal.changement'))}</th><th>${esc(t('journal.detail'))}</th><th>${esc(t('journal.transfert'))}</th></tr></thead><tbody>${
  lignes.map((j) => `<tr><td class="num">${heure(j.date)}</td><td class="donnee">${esc(j.utilisateur || t('general.systeme'))}</td><td${j.refuse ? ' class="refuse"' : ''}>${esc(libelleAction('journal_actions', j.action))}</td>
      <td class="num">${esc(j.lit_code || '')}</td><td>${j.ancien_etat || j.nouvel_etat ? `${esc(etatLib(j.ancien_etat))} → ${esc(etatLib(j.nouvel_etat))}` : ''}</td>
      <td class="donnee">${esc(j.detail || '')}</td><td class="num">${esc(j.transfert_numero || '')}</td></tr>`).join('') || `<tr><td colspan="7" class="muted">${esc(t('journal.aucune'))}</td></tr>`
}</tbody></table></div>${plus ? boutonPlus('journal') : ''}`;
  brancherPlus($('#v-journal'), 'journal', `/journal?etablissement_id=${etat.ctx}`, lignes);
}

/* ---------------- Paramètres ---------------- */
async function vueParams() {
  const cfg = configCtx();
  const gest = etat.moi.utilisateur.role === 'gestionnaire';
  const etabs = etat.moi.etablissements.filter((e) => e.config_id === cfg.id);
  const P = (k, vars) => esc(t(`params.${k}`, vars));
  $('#v-params').innerHTML = `<div class="entete"><div><h2>${P('titre')}</h2><p>${P('intro')}</p></div></div>
    <div class="grille">
      <div class="panneau-c"><h3>${P('configuration', { nom: '' })}<span class="donnee">${esc(cfg.nom)}</span></h3><dl>
        <dt>${P('types')}</dt><dd>${cfg.types.map((ty) => esc(nomType(ty))).join(', ')}</dd>
        <dt>${P('rayon')}</dt><dd class="num">${esc(t('general.km', { n: cfg.rayon_km }))}</dd>
        <dt>${P('horizon')}</dt><dd class="num">${esc(duree(cfg.horizon_h * 60))}</dd>
        <dt>${P('nettoyage_cible')}</dt><dd class="num">${esc(duree(cfg.nettoyage_cible_min))}</dd>
        <dt>${P('reservation')}</dt><dd class="num">${P('reservation_val', { duree: duree(cfg.reservation_max_min) })}</dd>
        <dt>${P('conge_depasse')}</dt><dd class="num">${P('conge_val', { duree: duree(cfg.marge_conge_min) })}</dd>
        <dt>${P('hors_service')}</dt><dd class="num">${P('hs_val', { duree: duree(cfg.hors_service_max_h * 60) })}</dd>
        <dt>${P('reference')}</dt><dd>${P('reference_val', { ex: cfg.reference_exemple })}</dd>
        <dt>${P('transport')}</dt><dd>${esc(cfg.transport_libelle)}</dd></dl></div>
      <div class="panneau-c"><h3>${P('cycle')}</h3><div class="cycle">${['libre', 'reserve', 'occupe', 'nettoyage', 'libre'].map((k) => `<span class="pill f-${k}">${esc(t(`etats.${k}`))}</span>`).join('→')}</div>
        <p class="note">${P('cycle_aide')}</p></div>
      <div class="panneau-c"><h3>${P('etablissements')}</h3><div>${etabs.map((e) => `<div class="reglage"><div><div>${esc(e.nom)}</div><div class="note">${esc(t(`partage.${e.partage}`))} · ${P(e.module_actif ? 'module_active' : 'module_desactive')}</div></div>
        ${gest ? `<div class="ligne"><select data-partage="${e.id}" aria-label="${P('partage')}">${options('partage', ['complet', 'agrege', 'aucun'], e.partage)}</select>
        <button class="btn${e.module_actif ? '' : ' pri'}" data-activer="${e.id}" data-val="${!e.module_actif}">${P(e.module_actif ? 'desactiver' : 'activer')}</button></div>` : ''}</div>`).join('')}</div>
        <p class="note">${P(gest ? 'note_gest' : 'note')}</p></div>
      <div class="panneau-c"><h3>${P('alertes_titre')}</h3><p class="note">${P('alertes_aide')}</p>
        ${etat.moi.utilisateur.admin ? `<div class="ligne"><div class="champ"><label class="lbl" for="p-rayon">${P('alertes_rayon')}</label>
          <input id="p-rayon" type="number" min="1" max="200" inputmode="numeric" value="${etabCtx().rayon_alerte_km}"></div><button class="btn" id="b-rayon">${esc(t('general.enregistrer'))}</button></div>`
    : `<p>${P('alertes_valeur', { km: etabCtx().rayon_alerte_km })}</p>`}</div>
    </div>`;
  const br = $('#b-rayon');
  if (br) br.onclick = () => agir(br, async () => { await api('PUT', `/admin/etablissements/${etat.ctx}/rayon-alerte`, { rayon_alerte_km: Number($('#p-rayon').value) }); await recharger(); }, t('params.alertes_ok'));
  const recharger = async () => { etat.moi = await api('GET', '/moi'); };
  document.querySelectorAll('[data-activer]').forEach((b) => {
    b.onclick = () => agir(b, async () => { await api('PUT', `/admin/etablissements/${b.dataset.activer}`, { module_actif: b.dataset.val === 'true' }); await recharger(); }, t('params.etab_ok'));
  });
  document.querySelectorAll('[data-partage]').forEach((s) => {
    s.onchange = () => agir(s, async () => { await api('PUT', `/admin/etablissements/${s.dataset.partage}`, { partage: s.value }); await recharger(); }, t('params.partage_ok'));
  });
}

/* ---------------- outils ---------------- */
const qsBesoins = (b) => Object.entries(b || {}).filter(([, v]) => v).map(([k]) => `&${k}=1`).join('');
function attributs(l) {
  const a = BESOINS.filter((k) => l[k]);
  return a.length ? `<div class="attr" title="${esc(t('lits.equipement_titre'))}">${a.map((k) => `<span title="${esc(t(`besoins.${k}`))}">${esc(t(`equipement_court.${k}`))}</span>`).join('')}</div>` : '';
}
function besoinsTexte(d) {
  const b = BESOINS.filter((k) => d[`besoin_${k}`]).map((k) => t(`besoins.${k}`).toLowerCase());
  return b.length ? b.join(', ') : t('besoins.aucun');
}

/** Exécute l'action proposée par le Copilote, après confirmation humaine quand elle engage un autre établissement. */
function executerProposition(a, bouton) {
  const faire = {
    assigner: () => api('POST', `/admissions/${a.demande_id}/assigner`, { lit_id: a.lit_id, version: a.version }),
    transferer: () => api('POST', `/admissions/${a.demande_id}/transferer`, { destination_id: a.destination_id, lit_id: a.lit_id, version: a.version }),
    debut_nettoyage: () => api('POST', `/nettoyage/${a.lit_id}/debut`),
    transfert: () => api('POST', `/transferts/${a.transfert_id}/${a.etape}`),
    lit: () => api('POST', `/lits/${a.lit_id}/action`, { action: a.action, version: a.version }),
    conge: () => api('PUT', `/lits/${a.lit_id}/conge`, { statut: a.statut }),
    civiere: () => api('POST', `/civieres/${a.civiere_id}/action`, { action: a.action, version: a.version }),
    deplacer: () => api('POST', `/civieres/${a.civiere_id}/deplacer`, { vers_id: a.vers_id, version: a.version }),
  }[a.type];
  if (a.type === 'aller') { allerA(a.vue); return; }
  if (!faire) return;
  if (a.type === 'transferer') {
    modale(t('copilote.transfert_titre'), `<p>${esc(a.libelle)}.</p><p class="note">${esc(t('copilote.transfert_aide'))}</p>`,
      [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => (await agir(null, faire, t('copilote.transfert_ok'))) !== null || false }]);
    return;
  }
  const messages = { assigner: 'copilote.assigner_ok', debut_nettoyage: 'copilote.nettoyage_ok', lit: 'copilote.lit_ok', civiere: 'copilote.civiere_ok', deplacer: 'copilote.deplace_ok',
    conge: 'copilote.conge_ok', transfert: { accepter: 'copilote.accepte_ok', chambre_prete: 'transferts.chambre_prete_ok' }[a.etape] || 'copilote.transport_ok' };
  agir(bouton, faire, t(messages[a.type] || 'general.fait'));
}

/* ---------------- Copilote ---------------- */
async function vueCopilote() {
  const v = $('#v-copilote');
  if (!etabCtx().module_actif) { v.innerHTML = `<p class="note">${esc(t('copilote.inactif'))}</p>`; return; }
  const [b, r] = await Promise.all([
    api('GET', `/copilote/briefing?etablissement_id=${etat.ctx}&langue=${langue}`),
    api('GET', `/copilote/reseau?etablissement_id=${etat.ctx}&langue=${langue}`),
  ]);
  etat.recos = b.recommandations;
  const exemples = t('copilote.exemples');
  const C = (k, vars) => esc(t(`copilote.${k}`, vars));
  v.innerHTML = `<div class="entete"><div class="copilote-tete"><span class="copilote-ic">${icone('sparkles')}</span><div><h2>${C('titre', { etab: b.etablissement })}</h2><p style="margin:0">${C('intro', { heure: new Date(b.genere_le).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', timeZone: fuseau() }) })}</p></div></div></div>
    <div class="niveau n-${b.alerte.niveau}"><span class="pastille-niveau">${C('niveau', { niveau: t(`niveaux.${b.alerte.niveau}`) })}</span><p>${esc(b.resume)}</p><p class="note" style="flex-basis:100%">${C('protocole', { texte: b.alerte.protocole })}</p></div>
    ${vueEnsemble(b.vue)}
    <div class="deux"><div class="pile">
      <div class="panneau-c"><h3>${C('recommandations', { n: b.recommandations.length })}</h3><div class="recos">${b.recommandations.length ? b.recommandations.map((x, i) => `<div class="reco">
        <span class="prio prio-${x.priorite}">${esc(t(`prios.${x.priorite}`))}</span><div><h4>${esc(x.titre)}</h4><p>${esc(x.raison)}</p></div>
        ${x.action ? `<button class="btn pri" data-reco="${i}">${esc(x.action.libelle)}</button>` : '<span></span>'}</div>`).join('') : `<p class="note">${C('rien')}</p>`}</div></div>
    </div><div class="pile">
      ${tableauPrevisions(b.previsions)}
      <div class="panneau-c"><h3>${C('question_titre')}</h3>
        <form id="f-copilote" class="ligne"><div class="champ" style="flex:1 1 200px"><label class="lbl" for="q">${C('question')}</label><input id="q" value="${esc(etat.question)}" placeholder="${esc(exemples[0])}" autocomplete="off"></div><button class="btn pri" type="submit">${C('demander')}</button></form>
        <div class="chips">${exemples.map((x, i) => `<button class="chip" data-ex="${i}">${esc(x)}</button>`).join('')}</div>
        ${etat.reponse ? `<div class="reponse">${esc(etat.reponse)}</div><span class="mode">${C(etat.modeReponse === 'ia' ? 'mode_ia' : 'mode_local')}</span>` : ''}</div>
      <div class="panneau-c"><h3>${C('reseau')}</h3><p class="note">${C('reseau_proches', { n: Math.min(8, r.etablissements.length) })}</p><div class="liste">${r.etablissements.slice(0, 8).map((e) => `<div class="item"><div><strong>${esc(e.nom)}</strong>${e.moi ? ` <span class="badge fort">${C('vous')}</span>` : ''}
        <div class="note">${C('libres', { n: e.libres })}${e.en_attente != null ? C('en_attente', { n: e.en_attente }) : ''}${e.urgence ? C('urgence_taux', { n: pct(e.urgence.taux) }) : ''}${e.moi ? '' : ` · ${esc(t('general.km', { n: e.distance_km }))}`}</div></div>
        ${niveauHTML(e.niveau, ` · ${esc(pct(e.pression))}`)}</div>`).join('')}</div>
        <button class="btn discret" id="b-vers-national">${C('voir_national')}</button>
        ${r.delestages.length ? `<h3 style="margin-top:6px">${C('delestages')}</h3><div class="liste">${r.delestages.slice(0, 6).map((d) => `<div class="item"><div><strong>${esc(d.de)} → ${esc(d.vers)}</strong><div class="note">${esc(d.type)} · ${esc(d.raison)}</div></div></div>`).join('')}</div>` : ''}</div>
    </div></div>`;
  $('#b-vers-national').onclick = () => allerA('national');
  v.querySelectorAll('[data-reco]').forEach((btn) => { btn.onclick = () => executerProposition(etat.recos[Number(btn.dataset.reco)].action, btn); });
  const poser = (q) => agir(null, async () => {
    etat.question = q;
    const rep = await api('POST', '/copilote/question', { etablissement_id: etat.ctx, question: q, langue });
    etat.reponse = rep.reponse; etat.modeReponse = rep.mode;
  });
  $('#f-copilote').onsubmit = (ev) => { ev.preventDefault(); const q = $('#q').value.trim(); if (q) poser(q); };
  v.querySelectorAll('[data-ex]').forEach((c) => { c.onclick = () => poser(exemples[Number(c.dataset.ex)]); });
}

/* ---------------- Urgence : civières ---------------- */
const classeDuree = (h) => (h >= 48 ? 'duree-48' : h >= 24 ? 'duree-24' : 'note');
const ACTIONS_CIV = {
  libre: [['placer', true], ['hors_service']],
  occupee: [['demander', true], ['deplacer'], ['liberer']],
  nettoyage: [['nettoyage_ok', true]],
  indispo: [['remettre', true]],
};
async function vueUrgence() {
  const v = $('#v-urgence');
  const { civieres, stats } = await api('GET', `/civieres?etablissement_id=${etat.ctx}`);
  const actif = etabCtx().module_actif;
  const cfg = configCtx();
  const U = (k, vars) => esc(t(`urgence.${k}`, vars));
  if (!stats) {
    v.innerHTML = `<div class="entete"><div><h2>${U('titre', { etab: etabCtx().nom })}</h2><p>${U('aucune')}</p></div></div>`;
    return;
  }
  const libres = civieres.filter((c) => c.etat === 'libre');
  const carte = (c) => {
    const actions = (ACTIONS_CIV[c.etat] || []).filter(([a]) => !(a === 'demander' && c.demande_id) && !(a === 'deplacer' && !libres.length));
    return `<div class="fiche e-${c.etat}">
      <div class="t"><b>${esc(c.code)}</b><span class="note">${esc(t(`etats.${c.etat}`))}</span></div>
      ${c.patient_ref ? `<div class="note">${t('lits.patient', { ref: esc(c.patient_ref) })} · <span class="${classeDuree(c.heures)}">${U('depuis_h', { duree: duree(c.heures * 60) })}</span></div>` : ''}
      ${c.demande_id ? `<div class="note">${c.demande_statut === 'assignee' ? t('urgence.lit_assigne', { code: esc(c.lit_code) }) : U('demande', { type: c.type_nom, prio: c.demande_priorite.toUpperCase() })}</div>`
    : c.etat === 'occupee' ? `<div class="alerte">${U('sans_demande')}</div>` : ''}
      ${c.motif_indispo ? `<div class="note">${esc(t('lits.motif', { motif: t(`motifs.${c.motif_indispo}`) }))}</div>` : ''}
      ${c.etat !== 'occupee' ? `<div class="note num" title="${esc(t('lits.depuis_titre'))}">${depuis(c.etat_depuis)}</div>` : ''}
      ${actif && actions.length ? `<div class="actions">${actions.map(([a, p]) => `<button class="btn${p ? ' pri' : ''}" data-civ="${c.id}" data-a="${a}" data-version="${c.version}" data-code="${esc(c.code)}">${U(`a_${a}`)}</button>`).join('')}</div>` : ''}
    </div>`;
  };
  const groupe = (cat) => {
    const liste = civieres.filter((c) => c.categorie === cat);
    return liste.length ? `<h3>${U(`cat_${cat}`)} <span class="note num">${liste.filter((c) => c.etat === 'occupee').length} / ${liste.length}</span></h3><div class="civieres">${liste.map(carte).join('')}</div>` : '';
  };
  v.innerHTML = `<div class="entete"><div><h2>${U('titre', { etab: etabCtx().nom })}</h2><p>${U('intro')}</p></div>
    <div class="legende">${['libre', 'occupee', 'nettoyage', 'indispo'].map((k) => `<span><i class="f-${k === 'occupee' ? 'occupe' : k}"></i>${esc(t(`etats.${k}`))}</span>`).join('')}</div></div>
    <div class="tuiles">
      ${tuile({ lbl: t('urgence.taux'), val: pct(stats.taux), note: U('taux_note', { occ: stats.occupees, fonc: stats.fonctionnelles }),
    etat: etatSeuil(stats.taux, cfg.seuil_civieres_jaune, cfg.seuil_civieres_rouge), cible: t('indicateurs.cible_max', { v: pct(cfg.seuil_civieres_jaune) }) })}
      ${tuile({ lbl: t('urgence.corridor'), val: nb(stats.en_corridor), note: U('corridor_note', { n: stats.libres }), etat: stats.en_corridor ? 'attention' : null })}
      ${tuile({ lbl: t('urgence.plus_24h'), val: nb(stats.plus_24h), note: U('plus_48h', { n: stats.plus_48h }), etat: stats.plus_48h ? 'critique' : stats.plus_24h ? 'attention' : null })}
      ${tuile({ lbl: t('urgence.duree'), val: duree((stats.duree_moy_h ?? 0) * 60), note: U('duree_note') })}</div>
    ${groupe('reguliere')}${groupe('debordement')}
    <p class="note">${U('ref_seulement')}</p>`;
  v.querySelectorAll('[data-civ]').forEach((b) => {
    b.onclick = () => {
      const id = Number(b.dataset.civ); const a = b.dataset.a; const version = Number(b.dataset.version); const code = b.dataset.code;
      const c = civieres.find((x) => x.id === id);
      const post = (corps, msg) => agir(null, () => api('POST', `/civieres/${id}/action`, { version, ...corps }), msg);
      if (a === 'placer') {
        modale(t('urgence.placer_titre', { code }), `<div class="champ"><label class="lbl" for="m-pat">${esc(t('reseau.ref_patient'))}</label><input id="m-pat" placeholder="${esc(cfg.reference_exemple)}" autocomplete="off"></div>
          <p class="note">${esc(t('lits.ref_seulement'))}</p>`,
        [{ label: t('general.annuler') }, { label: t('urgence.a_placer'), pri: true, run: async () => (await post({ action: 'placer', patient_ref: $('#m-pat').value.trim() }, t('urgence.place_ok', { code }))) !== null || false }]);
        return;
      }
      if (a === 'demander') {
        modale(t('urgence.demander_titre', { ref: c.patient_ref }), `<div class="champ"><label class="lbl" for="m-type">${esc(t('admissions.type_unite'))}</label><select id="m-type">${cfg.types.map((x) => `<option value="${x.id}">${esc(nomType(x))}</option>`).join('')}</select></div>
          <div class="champ"><label class="lbl" for="m-prio">${esc(t('admissions.priorite'))}</label><select id="m-prio">${options('priorites_adm', ['p1', 'p2', 'p3'], 'p2')}</select></div>
          <div class="cases">${casesBesoins('data-mbesoin')}</div><p class="note">${esc(t('urgence.demander_aide'))}</p>`,
        [{ label: t('general.annuler') }, { label: t('urgence.a_demander'), pri: true, run: async () => {
          const besoins = {}; document.querySelectorAll('#modale [data-mbesoin]').forEach((x) => { besoins[x.dataset.mbesoin] = x.checked; });
          return (await agir(null, () => api('POST', '/admissions', { etablissement_id: etat.ctx, civiere_id: id, type_id: Number($('#m-type').value),
            priorite: $('#m-prio').value, provenance: 'urgence', besoins }), t('admissions.ajoutee'))) !== null || false;
        } }]);
        return;
      }
      if (a === 'deplacer') {
        modale(t('urgence.deplacer_titre', { ref: c.patient_ref }), `<div class="champ"><label class="lbl" for="m-vers">${esc(t('urgence.vers'))}</label><select id="m-vers">${libres.map((x) => `<option value="${x.id}" data-version="${x.version}">${esc(x.code)} · ${esc(t(`urgence.cat_${x.categorie}`))}</option>`).join('')}</select></div>
          <p class="note">${esc(t('urgence.deplacer_aide'))}</p>`,
        [{ label: t('general.annuler') }, { label: t('urgence.a_deplacer'), pri: true, run: async () => {
          const o = $('#m-vers').selectedOptions[0];
          return (await agir(null, () => api('POST', `/civieres/${id}/deplacer`, { vers_id: Number(o.value), version: Number(o.dataset.version) }), t('copilote.deplace_ok'))) !== null || false;
        } }]);
        return;
      }
      if (a === 'liberer') {
        modale(t('urgence.liberer_titre', { code }), `<p>${esc(t('urgence.liberer_aide', { ref: c.patient_ref }))}</p>`,
          [{ label: t('general.annuler') }, { label: t('urgence.a_liberer'), pri: true, run: async () => (await post({ action: 'liberer' }, t('urgence.libere_ok', { code }))) !== null || false }]);
        return;
      }
      if (a === 'hors_service') {
        modale(t('lits.hs_titre', { code }), `<div class="champ"><label class="lbl" for="m-motif-i">${esc(t('lits.motif_lbl'))}</label><select id="m-motif-i">${options('motifs', MOTIFS)}</select></div>`,
          [{ label: t('general.annuler') }, { label: t('lits.hs_bouton'), pri: true, run: async () => (await post({ action: 'hors_service', motif: $('#m-motif-i').value }, t('lits.hs_ok', { code }))) !== null || false }]);
        return;
      }
      agir(b, () => api('POST', `/civieres/${id}/action`, { action: a, version }), (x) => t('lits.etat_ok', { code: x.code, etat: t(`etats.${x.etat}`) }));
    };
  });
}

/* ---------------- Copilote : vue d'ensemble et prévisions ---------------- */
function vueEnsemble(v) {
  if (!v) return '';
  const C = (k, vars) => t(`copilote.${k}`, vars);
  const cases = [
    [C('v_lits'), nb(v.lits.libres), C('v_lits_note', { occ: v.lits.occupes, net: v.lits.nettoyage, fermes: v.lits.fermes })],
    [C('v_chambres'), nb(v.chambres.libres), C('v_chambres_note', { n: v.chambres.total })],
    ...(v.civieres ? [[C('v_civieres'), pct(v.civieres.taux), C('v_civieres_note', { occ: v.civieres.occupees, fonc: v.civieres.fonctionnelles, h24: v.civieres.plus_24h })]] : []),
    [C('v_file'), nb(v.file.attente), C('v_file_note', { n: v.file.assignees })],
    [C('v_transferts'), nb(v.transferts.entrants + v.transferts.sortants), C('v_transferts_note', { e: v.transferts.entrants, s: v.transferts.sortants })],
    [C('v_nsa'), nb(v.nsa), C('v_nettoyage', { n: v.nettoyage })],
    [C('v_proches'), nb(v.proches.avec_place), C('v_proches_note', { n: v.proches.etablissements, km: v.proches.rayon_km, libres: v.proches.libres })],
  ];
  return `<section class="ensemble" aria-label="${esc(C('vue_titre'))}"><h3 class="titre-section">${esc(C('vue_titre'))}</h3>
    <div class="ensemble-cases">${cases.map(([l, val, note]) => `<div class="case-ens"><span class="lbl">${esc(l)}</span><span class="v">${esc(val)}</span><span class="note">${esc(note)}</span></div>`).join('')}</div></section>`;
}
function tableauPrevisions(p) {
  if (!p) return '';
  const C = (k, vars) => esc(t(`copilote.${k}`, vars));
  const cellule = (x) => (x.sature ? `<span class="etat-niveau n-rouge">${C('prev_sature')}</span>`
    : `<span class="${x.risque ? 'prev-risque' : ''}">${C('prev_libres', { n: x.libres_prevus })}</span>`) + ` <span class="note">± ${esc(nb(x.marge))}</span>`;
  return `<div class="panneau-c"><div><h3>${C('prev_titre')}</h3><p class="note">${C('prev_intro')}</p></div>
    <div class="tableau prev"><table><thead><tr><th>${C('prev_unite')}</th>${p.horizons.map((h) => `<th>${C('prev_heures', { h })}</th>`).join('')}</tr></thead><tbody>
    ${p.unites.map((u) => `<tr><td>${esc(u.type_nom)}</td>${p.horizons.map((h) => `<td>${cellule(u.horizons[h])}</td>`).join('')}</tr>`).join('')}
    ${p.civieres ? `<tr><td>${C('prev_civieres')}</td>${p.horizons.map((h) => { const x = p.civieres.horizons[h]; return `<td>${C('prev_civ_val', { occ: x.occupees, taux: pct(x.taux) })} <span class="note">± ${esc(nb(x.marge))}</span></td>`; }).join('')}</tr>` : ''}
    </tbody></table></div><p class="note">${C('prev_methode', { s: p.semaines })}</p></div>`;
}

/* ---------------- Admissions ---------------- */
async function vueAdmissions() {
  const v = $('#v-admissions');
  const actif = etabCtx().module_actif;
  const cfg = configCtx();
  const [file, urg] = await Promise.all([api('GET', `/admissions?etablissement_id=${etat.ctx}`), api('GET', `/civieres?etablissement_id=${etat.ctx}`)]);
  const sansDemande = urg.civieres.filter((c) => c.etat === 'occupee' && !c.demande_id);
  const A = (k, vars) => esc(t(`admissions.${k}`, vars));
  const carte = (d) => `<div class="fiche" style="--c:${d.priorite === 'p1' ? 'var(--critique)' : d.depasse ? 'var(--attention)' : 'var(--secondaire)'}">
      <div class="t"><b>${esc(d.patient_ref)}</b><span class="${d.depasse ? 'urgent' : 'note num'}">${d.priorite.toUpperCase()} · ${depuis(d.cree_le)}</span></div>
      <div class="note">${esc(d.type_nom)} · ${esc(t(`provenances.${d.provenance}`).toLowerCase())} · ${esc(besoinsTexte(d))}</div>
      ${d.civiere_code ? `<div class="note">${A('sur_civiere', { code: d.civiere_code })} · <span class="${classeDuree(d.heures_civiere)}">${esc(t('urgence.depuis_h', { duree: duree(d.heures_civiere * 60) }))}</span></div>` : ''}
      ${d.statut === 'assignee' ? `<div class="note">${t('admissions.lit_assigne', { code: esc(d.lit_code) })}</div>` : d.lit_suggere ? `<div class="note">${t('admissions.lit_adapte', { code: esc(d.lit_suggere.code) })}</div>` : `<div class="alerte">${A('aucun_lit')}</div>`}
      ${actif ? `<div class="actions">${d.statut === 'attente'
    ? `${d.lit_suggere ? `<button class="btn pri" data-adm="${d.id}" data-a="assigner" data-lit="${d.lit_suggere.id}" data-version="${d.lit_suggere.version}">${A('assigner', { code: d.lit_suggere.code })}</button>` : ''}
           <button class="btn${d.lit_suggere ? '' : ' pri'}" data-adm="${d.id}" data-a="ailleurs">${A('chercher_ailleurs')}</button>`
    : `<button class="btn pri" data-adm="${d.id}" data-a="admettre">${A('admettre')}</button>`}
        <button class="btn dan" data-adm="${d.id}" data-a="annuler">${A('annuler')}</button></div>` : ''}</div>`;
  const attenteF = file.filter((d) => d.statut === 'attente');
  const assignees = file.filter((d) => d.statut === 'assignee');
  v.innerHTML = `<div class="entete"><div><h2>${A('titre', { etab: etabCtx().nom })}</h2><p>${A('intro', { h: Math.round(cfg.attente_admission_max_min / 60) })}</p></div></div>
    <div class="deux"><div class="pile"><div class="panneau-c"><h3>${A('nouvelle')}</h3>
      <div class="ligne"><div class="champ"><label class="lbl" for="a-type">${A('type_unite')}</label><select id="a-type">${cfg.types.map((x) => `<option value="${x.id}">${esc(nomType(x))}</option>`).join('')}</select></div>
      <div class="champ"><label class="lbl" for="a-ref">${A('ref_patient')}</label><input id="a-ref" placeholder="${esc(cfg.reference_exemple)}" autocomplete="off"></div></div>
      ${sansDemande.length ? `<div class="champ"><label class="lbl" for="a-civ">${A('civiere')}</label><select id="a-civ"><option value="">${A('sans_civiere')}</option>${sansDemande.map((c) => `<option value="${c.id}" data-ref="${esc(c.patient_ref)}">${esc(c.code)} · ${esc(c.patient_ref)} · ${esc(t('urgence.depuis_h', { duree: duree(c.heures * 60) }))}</option>`).join('')}</select></div>` : ''}
      <div class="ligne"><div class="champ"><label class="lbl" for="a-prio">${A('priorite')}</label><select id="a-prio">${options('priorites_adm', ['p1', 'p2', 'p3'], 'p2')}</select></div>
      <div class="champ"><label class="lbl" for="a-prov">${A('provenance')}</label><select id="a-prov">${options('provenances', ['urgence', 'bloc', 'externe', 'autre'])}</select></div></div>
      <div class="cases">${casesBesoins('data-abesoin')}</div>
      <button class="btn pri" id="b-demande"${actif ? '' : ' disabled'}>${A('ajouter')}</button>
      <p class="note">${A('ref_seulement')}</p></div></div>
    <div class="kanban" style="margin-top:0;grid-auto-columns:minmax(260px,1fr)">
      <div class="col" style="--c:var(--attention)"><h3>${A('en_attente')} <span class="num">${attenteF.length}</span></h3>${attenteF.map(carte).join('') || `<div class="vide">${A('personne')}</div>`}</div>
      <div class="col" style="--c:var(--secondaire)"><h3>${A('assigne_col')} <span class="num">${assignees.length}</span></h3>${assignees.map(carte).join('') || `<div class="vide">${A('aucune')}</div>`}</div>
    </div></div>`;
  $('#b-demande').onclick = (ev) => {
    const besoins = {};
    v.querySelectorAll('[data-abesoin]').forEach((c) => { besoins[c.dataset.abesoin] = c.checked; });
    const civ = $('#a-civ') ? Number($('#a-civ').value) || null : null;
    agir(ev.target, () => api('POST', '/admissions', { etablissement_id: etat.ctx, type_id: Number($('#a-type').value), patient_ref: $('#a-ref').value.trim(),
      priorite: $('#a-prio').value, provenance: $('#a-prov').value, besoins, civiere_id: civ }), t('admissions.ajoutee'));
  };
  const selCiv = $('#a-civ');
  if (selCiv) selCiv.onchange = () => { const o = selCiv.selectedOptions[0]; if (o && o.dataset.ref) { $('#a-ref').value = o.dataset.ref; $('#a-prov').value = 'urgence'; } };
  v.querySelectorAll('[data-adm]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.adm; const a = b.dataset.a;
      if (a === 'assigner') return agir(b, () => api('POST', `/admissions/${id}/assigner`, { lit_id: Number(b.dataset.lit), version: Number(b.dataset.version) }), t('admissions.assigne_ok'));
      if (a === 'admettre') return agir(b, () => api('POST', `/admissions/${id}/admettre`), t('admissions.admis_ok'));
      if (a === 'annuler') return agir(b, () => api('POST', `/admissions/${id}/annuler`), t('admissions.annule_ok'));
      const d = file.find((x) => String(x.id) === id);
      const be = {}; BESOINS.forEach((k) => { be[k] = d[`besoin_${k}`]; });
      const res = await api('GET', `/recherche?depuis=${etat.ctx}&type_id=${d.type_id}${qsBesoins(be)}`).catch((e) => { toast(e.message, true); return null; });
      if (!res) return null;
      const sug = res.suggestions.filter((x) => x.libres);
      modale(t('admissions.ailleurs_titre', { ref: d.patient_ref }), sug.length ? `<div class="liste">${sug.map((x, i) => `<label class="item"><div><strong>${esc(x.nom)}</strong>${x.recommande ? ` <span class="badge fort">${esc(t('reseau.recommande'))}</span>` : ''}<div class="note num">${esc(x.raison)}</div>${x.pourquoi ? `<div class="note">${esc(x.pourquoi)}</div>` : ''}</div><input type="radio" name="m-sug" value="${i}"${i === 0 ? ' checked' : ''}></label>`).join('')}</div>
        <p class="note">${A('ailleurs_aide', { besoins: besoinsTexte(d) })}</p>` : `<p>${A('ailleurs_aucun')}</p>`,
      sug.length ? [{ label: t('general.annuler') }, { label: t('admissions.demander_transfert'), pri: true, run: async () => {
        const x = sug[Number(($('input[name="m-sug"]:checked') || {}).value || 0)];
        return (await agir(null, () => api('POST', `/admissions/${id}/transferer`, { destination_id: x.etablissement_id, lit_id: x.lit?.id, version: x.lit?.version }), (tr) => t('admissions.transfert_ok', { numero: tr.numero, etab: x.nom }))) !== null || false;
      } }] : [{ label: t('general.fermer') }]);
      return null;
    };
  });
}

/* ---------------- Nettoyage ---------------- */
async function vueNettoyage() {
  const v = $('#v-nettoyage');
  const liste = await api('GET', `/nettoyage?etablissement_id=${etat.ctx}`);
  const couleur = { haute: 'var(--critique)', moyenne: 'var(--attention)', normale: 'var(--secondaire)' };
  const N = (k, vars) => esc(t(`nettoyage.${k}`, vars));
  v.innerHTML = `<div class="entete"><div><h2>${N('titre', { etab: etabCtx().nom })}</h2><p>${N('intro')}</p></div></div>
    <div class="liste">${liste.map((l, i) => `<div class="net-item" style="--c:${couleur[l.priorite]}"><div>
      <div class="grand">${i + 1}. ${esc(l.code)}</div>
      <div class="note">${l.genre === 'civiere' ? N('civiere', { cat: t(`urgence.une_${l.categorie}`) }) : `${N('chambre', { unite: l.unite, ch: l.chambre })}${l.isolement ? N('isolement') : ''}`}</div>
      <div style="font-size:13px">${esc(l.raison)}</div>
      <div class="note">${l.nettoyage_debut ? N('commence_il_y_a', { duree: depuis(l.nettoyage_debut) }) : N('attente_depuis', { duree: depuis(l.etat_depuis) })}</div></div>
      <div class="actions">${l.nettoyage_debut || l.genre === 'civiere' ? '' : `<button class="btn" data-debut="${l.id}">${N('commencer')}</button>`}
        <button class="btn pri" data-fini="${l.id}" data-genre="${l.genre}" data-version="${l.version}" data-code="${esc(l.code)}">${N('termine')}</button></div></div>`).join('') || `<p class="note">${N('aucun')}</p>`}</div>`;
  v.querySelectorAll('[data-debut]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/nettoyage/${b.dataset.debut}/debut`), t('nettoyage.commence_ok')); });
  v.querySelectorAll('[data-fini]').forEach((b) => {
    const chemin = b.dataset.genre === 'civiere' ? 'civieres' : 'lits';
    b.onclick = () => agir(b, () => api('POST', `/${chemin}/${b.dataset.fini}/action`, { action: 'nettoyage_ok', version: Number(b.dataset.version) }), t('nettoyage.pret', { code: b.dataset.code }));
  });
}

/* ---------------- NSA ---------------- */
async function vueNsa() {
  const v = $('#v-nsa');
  const n = await api('GET', `/nsa?etablissement_id=${etat.ctx}`);
  const S = (k, vars) => esc(t(`nsa.${k}`, vars));
  v.innerHTML = `<div class="entete"><div><h2>${S('titre', { etab: etabCtx().nom })}</h2><p>${S('intro')}</p></div></div>
    <div class="tuiles">
      ${tuile({ lbl: t('nsa.taux'), val: pct(n.taux), etat: etatSeuil(n.taux, n.cible, n.cible * 1.5), note: S('cible', { n: pct(n.cible) }) })}
      ${tuile({ lbl: t('nsa.patients'), val: nb(n.total), note: S('sur_occupes', { n: n.occupes }) })}
      ${tuile({ lbl: t('nsa.jours_lits'), val: nb(n.jours_lits), note: S('cumul') })}
      <div class="tuile"><span class="lbl">${S('orientations')}</span><span class="note" style="font-size:13px">${Object.entries(n.par_orientation).map(([k, x]) => `${esc(t(`orientations.${k}`))} : ${x}`).join('<br>') || '—'}</span></div></div>
    <div class="tableau"><table><thead><tr><th>${S('lit')}</th><th>${S('unite')}</th><th>${S('patient')}</th><th>${S('depuis')}</th><th>${S('orientation')}</th><th></th></tr></thead><tbody>${n.lits.map((l) => `<tr>
      <td class="num">${esc(l.code)}</td><td class="donnee">${esc(l.unite)}</td><td class="num">${esc(l.patient_ref)}</td><td class="num">${S('jours', { n: l.jours })}${l.jours >= 30 ? ' <span class="pt pt-attention" aria-hidden="true"></span>' : ''}</td>
      <td><select data-orient="${l.id}" aria-label="${S('orientation')}">${options('orientations', ORIENTATIONS, l.nsa_orientation)}</select></td>
      <td><button class="btn" data-retirer="${l.id}">${S('retirer')}</button></td></tr>`).join('') || `<tr><td colspan="6" class="muted">${S('aucun')}</td></tr>`}</tbody></table></div>`;
  v.querySelectorAll('[data-orient]').forEach((sel) => { sel.onchange = () => agir(sel, () => api('PUT', `/lits/${sel.dataset.orient}/nsa`, { orientation: sel.value }), t('nsa.orient_ok')); });
  v.querySelectorAll('[data-retirer]').forEach((b) => { b.onclick = () => agir(b, () => api('DELETE', `/lits/${b.dataset.retirer}/nsa`), t('nsa.retire_ok')); });
}

/* ---------------- Tuiles d'indicateurs ---------------- */
/** État d'un indicateur où « plus bas est mieux » : rien sous la cible, « attention » au-delà, « critique » au-delà du seuil critique. */
const etatSeuil = (val, cible, critique) => (val == null || cible == null ? null : critique != null && val >= critique ? 'critique' : val > cible ? 'attention' : null);
/** Tuile : libellé, valeur en couleur de texte normale, petite pastille d'état seulement si le seuil est dépassé, note, cible, tendance. */
function tuile({ lbl, val, note = '', etat: e = null, cible = '', tendance: tend = '' }) {
  const pt = e ? `<span class="pt pt-${e}" role="img" aria-label="${esc(t(`indicateurs.etat_${e}`))}" title="${esc(t(`indicateurs.etat_${e}`))}"></span>` : '';
  return `<div class="tuile"><span class="lbl">${esc(lbl)}</span><span class="v">${esc(val)}${pt}</span>${note ? `<span class="note">${note}</span>` : ''}${
    cible ? `<span class="cible">${esc(cible)}</span>` : ''}${tend}</div>`;
}
/** Tendance par rapport à la période précédente (plus bas est mieux) : flèche, écart mis en forme, couleur selon que c'est bon ou mauvais. */
function tendance(act, prec, fmt, seuilStable) {
  if (act == null || prec == null) return `<span class="tendance">${esc(t('indicateurs.sans_comparaison'))}</span>`;
  const d = act - prec;
  if (Math.abs(d) < seuilStable) return `<span class="tendance">${icone('minus')}${esc(t('indicateurs.stable'))}</span>`;
  return `<span class="tendance ${d < 0 ? 't-bon' : 't-mauvais'}">${icone(d > 0 ? 'arrow-up' : 'arrow-down')}${esc(t(`indicateurs.${d > 0 ? 'hausse' : 'baisse'}`, { v: fmt(Math.abs(d)) }))}</span>`;
}
const points = (d) => t('indicateurs.points', { n: Math.round(d * 10) / 10 });

/* ---------------- Indicateurs ---------------- */
async function vueIndicateurs() {
  const v = $('#v-indicateurs');
  const i = await api('GET', `/indicateurs?etablissement_id=${etat.ctx}&jours=${etat.jours}`);
  const I = (k, vars) => esc(t(`indicateurs.${k}`, vars));
  const c = i.cibles; const p = i.precedent; const j = i.periode_jours;
  const cibleMax = (v) => t('indicateurs.cible_max', { v });
  const motifs = Object.entries(i.transferts.refus_par_motif).map(([k, x]) => `${t(`motifs_refus.${k}`)} ${nb(x)}`).join(', ');
  const niveauEtat = { vert: null, jaune: 'attention', orange: 'attention', rouge: 'critique' }[i.alerte.niveau];
  const capacite = [
    tuile({ lbl: t('indicateurs.occupation'), val: pct(i.capacite.occupation), note: I('occupation_note', { libres: i.capacite.libres, dotes: i.capacite.dotes }),
      etat: etatSeuil(i.capacite.occupation, c.seuil_jaune, c.seuil_rouge), cible: cibleMax(pct(c.seuil_jaune)) }),
    tuile({ lbl: t('indicateurs.niveau'), val: t(`niveaux.${i.alerte.niveau}`), note: I('pression', { p: pct(i.alerte.pression) }), etat: niveauEtat }),
    tuile({ lbl: t('indicateurs.fermes'), val: nb(i.capacite.indispo),
      note: esc(Object.entries(i.capacite.indispo_par_motif).map(([k, x]) => `${t(`motifs.${k}`)} ${nb(x)}`).join(' · ')) || I('fermes_aucun') }),
    tuile({ lbl: t('indicateurs.taux_nsa'), val: pct(i.nsa.taux), note: I('nsa_note', { n: i.nsa.total, jl: i.nsa.jours_lits }),
      etat: etatSeuil(i.nsa.taux, i.nsa.cible, i.nsa.cible * 1.5), cible: cibleMax(pct(i.nsa.cible)) }),
  ];
  const fluidite = [
    tuile({ lbl: t('indicateurs.attente_lit'), val: duree(i.admissions.delai_assignation_min), note: I('attente_note', { total: i.admissions.total, transf: i.admissions.transferees }),
      etat: etatSeuil(i.admissions.delai_assignation_min, c.attente_admission_max_min, 2 * c.attente_admission_max_min), cible: cibleMax(duree(c.attente_admission_max_min)),
      tendance: tendance(i.admissions.delai_assignation_min, p.delai_assignation_min, duree, 1) }),
    tuile({ lbl: t('indicateurs.reponse'), val: duree(i.transferts.delai_validation_min), note: I('reponse_note', { total: i.transferts.total, sortants: i.transferts.sortants, entrants: i.transferts.entrants }),
      tendance: tendance(i.transferts.delai_validation_min, p.delai_validation_min, duree, 1) }),
    tuile({ lbl: t('indicateurs.total'), val: duree(i.transferts.delai_total_min), note: I('total_note'), tendance: tendance(i.transferts.delai_total_min, p.delai_total_min, duree, 1) }),
    tuile({ lbl: t('indicateurs.refus'), val: pct(i.transferts.taux_refus), note: esc(motifs ? t('indicateurs.refus_motifs', { n: i.transferts.refuses, motifs }) : t('indicateurs.refus_note', { n: i.transferts.refuses })),
      tendance: tendance(i.transferts.taux_refus, p.taux_refus, points, 0.5) }),
    tuile({ lbl: t('indicateurs.nettoyage'), val: duree(i.nettoyage.duree_moy_min), note: I('nettoyage_note', { n: i.nettoyage.nettoyages }),
      etat: etatSeuil(i.nettoyage.duree_moy_min, c.nettoyage_cible_min, 2 * c.nettoyage_cible_min), cible: cibleMax(duree(c.nettoyage_cible_min)),
      tendance: tendance(i.nettoyage.duree_moy_min, p.nettoyage_min, duree, 1) }),
  ];
  const u = i.urgence;
  const urgence = u ? [
    tuile({ lbl: t('indicateurs.taux_civieres'), val: pct(u.taux), note: I('taux_civieres_note', { occ: u.occupees, fonc: u.fonctionnelles, cor: u.en_corridor }),
      etat: etatSeuil(u.taux, c.seuil_civieres_jaune, c.seuil_civieres_rouge), cible: cibleMax(pct(c.seuil_civieres_jaune)) }),
    tuile({ lbl: t('indicateurs.plus_24h'), val: nb(u.plus_24h), note: I('plus_48h_note', { n: u.plus_48h }),
      etat: u.plus_48h ? 'critique' : u.plus_24h ? 'attention' : null, cible: t('indicateurs.cible_zero') }),
    tuile({ lbl: t('indicateurs.duree_civiere'), val: duree((u.duree_moy_h ?? 0) * 60), note: I('duree_civiere_note') }),
    tuile({ lbl: t('indicateurs.duree_civiere_periode'), val: duree(u.periode.duree_moy_h == null ? null : u.periode.duree_moy_h * 60),
      note: I('duree_periode_note', { n: u.periode.sejours, h24: u.periode.sejours_24h }),
      tendance: tendance(u.periode.duree_moy_h == null ? null : u.periode.duree_moy_h * 60, p.civiere_h == null ? null : p.civiere_h * 60, duree, 1) }),
  ] : null;
  v.innerHTML = `<div class="entete"><div><h2>${I('titre', { etab: etabCtx().nom })}</h2><p>${I('intro', { n: j })}</p></div>
    <div class="ligne"><select id="i-jours" aria-label="${I('periode')}">${[7, 30, 90].map((x) => `<option value="${x}"${x === etat.jours ? ' selected' : ''}>${I('jours', { n: x })}</option>`).join('')}</select>
      <button class="btn" id="b-csv">${icone('download')}${I('exporter')}</button></div></div>
    <h3 class="titre-section">${I('capacite')}</h3><div class="tuiles">${capacite.join('')}</div>
    <h3 class="titre-section">${I('fluidite')}</h3><div class="tuiles">${fluidite.join('')}</div>
    ${urgence ? `<h3 class="titre-section">${I('urgence')}</h3><div class="tuiles">${urgence.join('')}</div>` : ''}`;
  $('#i-jours').onchange = (ev) => { etat.jours = Number(ev.target.value); rafraichir(); };
  $('#b-csv').onclick = async () => {
    try {
      const r = await fetch(`/api/indicateurs.csv?etablissement_id=${etat.ctx}&jours=${etat.jours}`, { headers: { Authorization: `Bearer ${etat.token}`, 'X-Langue': langue } });
      if (!r.ok) throw new Error(t('indicateurs.export_impossible'));
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url; a.download = `arrimo-indicateurs-${etabCtx().nom.replace(/\W+/g, '-')}-${etat.jours}j.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { toast(e.message, true); }
  };
}

/* ---------------- Mon compte ---------------- */
async function vueCompte() {
  const v = $('#v-compte');
  const u = etat.moi.utilisateur;
  const K = (k, vars) => esc(t(`compte.${k}`, vars));
  v.innerHTML = `<div class="entete"><div><h2>${K('titre')}</h2><p><span class="donnee">${esc(u.nom)}</span> · ${esc(u.email)} · ${K('role', { role: t(`roles_texte.${u.role}`) })}</p></div></div>
    <div class="grille">
      <form class="panneau-c" id="f-mdp"><h3>${K('changer_mdp')}</h3>
        <div class="champ"><label class="lbl" for="m-actuel">${K('actuel')}</label><input id="m-actuel" type="password" autocomplete="current-password"></div>
        <div class="champ"><label class="lbl" for="m-nouveau">${K('nouveau')}</label><input id="m-nouveau" type="password" autocomplete="new-password"></div>
        <div class="champ"><label class="lbl" for="m-confirme">${K('confirmer')}</label><input id="m-confirme" type="password" autocomplete="new-password"></div>
        <p class="note">${K('mdp_aide')}</p>
        <button class="btn pri" type="submit">${esc(t('general.enregistrer'))}</button></form>
      <div class="panneau-c"><h3>${K('deux_fa')}</h3>
        ${u.totp_actif
    ? `<p><span class="badge fort">${K('active')}</span> ${K('active_aide')}</p>
           <div class="ligne"><div class="champ"><label class="lbl" for="d-code">${K('code_desactiver')}</label><input id="d-code" inputmode="numeric" maxlength="7"></div><button class="btn dan" id="b-2fa-off">${K('desactiver')}</button></div>`
    : `<p>${t('compte.inactive_aide')}</p>
           <div id="zone-2fa"><button class="btn pri" id="b-2fa-prep">${K('activer')}</button></div>`}
      </div>
      <div class="panneau-c"><h3>${K('langue')}</h3><select id="langue-compte" aria-label="${K('langue')}">${LANGUES.map((l) => `<option value="${l}"${l === langue ? ' selected' : ''}>${esc(dicoDe(l).langue.nom)}</option>`).join('')}</select></div></div>`;
  $('#langue-compte').onchange = (e) => changerLangue(e.target.value);
  $('#f-mdp').onsubmit = (e) => {
    e.preventDefault();
    if ($('#m-nouveau').value !== $('#m-confirme').value) { toast(t('general.deux_mdp_differents'), true); return; }
    agir(null, async () => {
      await api('PUT', '/moi/mot-de-passe', { actuel: $('#m-actuel').value, nouveau: $('#m-nouveau').value });
      ['#m-actuel', '#m-nouveau', '#m-confirme'].forEach((x) => { const el = $(x); if (el) el.value = ''; });
    }, t('compte.mdp_ok'));
  };
  const prep = $('#b-2fa-prep');
  if (prep) {
    prep.onclick = async () => {
      try {
        const r = await api('POST', '/moi/2fa/preparer');
        $('#zone-2fa').innerHTML = `<ol class="note" style="padding-left:18px;margin:0">
            <li>${K('etape1')}</li><li>${K('etape2')}</li><li>${K('etape3')}</li></ol>
          <div style="width:200px;max-width:100%;background:#fff;padding:6px;border:1px solid var(--bordure);border-radius:8px">${r.qr_svg}</div>
          <div class="note">${K('cle')} <span class="num" style="word-break:break-all">${esc(r.secret)}</span></div>
          <div class="ligne"><div class="champ"><label class="lbl" for="a-code">${K('code6')}</label><input id="a-code" inputmode="numeric" maxlength="7" autocomplete="one-time-code"></div>
          <button class="btn pri" id="b-2fa-ok">${esc(t('general.confirmer'))}</button></div>`;
        $('#b-2fa-ok').onclick = (ev) => agir(ev.target, async () => {
          await api('POST', '/moi/2fa/activer', { code: $('#a-code').value });
          etat.moi = await api('GET', '/moi');
        }, t('compte.active_ok'));
      } catch (e) { toast(e.message, true); }
    };
  }
  const off = $('#b-2fa-off');
  if (off) off.onclick = () => agir(off, async () => { await api('POST', '/moi/2fa/desactiver', { code: $('#d-code').value }); etat.moi = await api('GET', '/moi'); }, t('compte.desactive_ok'));
}

/* ---------------- Administration ---------------- */
etat.adminOnglet = 'utilisateurs';
function montrerSecret(titre, texte, explication) {
  modale(titre, `<p class="note">${esc(explication)}</p><div class="reponse num" style="word-break:break-all;user-select:all">${esc(texte)}</div>
    <p class="note">${esc(t('admin.secret_note'))}</p>`,
  [{ label: t('general.copier'), run: async () => { try { await navigator.clipboard.writeText(texte); toast(t('general.copie')); } catch { toast(t('general.copier_manuel'), true); } return false; } }, { label: t('general.fermer'), pri: true }]);
}
async function vueAdmin() {
  const v = $('#v-admin');
  const u = etat.moi.utilisateur;
  const D = (k, vars) => esc(t(`admin.${k}`, vars));
  if (!u.totp_actif) {
    v.innerHTML = `<div class="entete"><div><h2>${D('titre')}</h2></div></div><div class="panneau-c"><h3>${D('exige_2fa_titre')}</h3>
      <p>${D('exige_2fa')}</p><button class="btn pri" id="b-vers-compte">${D('vers_compte')}</button></div>`;
    $('#b-vers-compte').onclick = () => allerA('compte');
    return;
  }
  const onglets = ['utilisateurs', 'structure', 'connecteurs', 'journal'];
  if (u.gestionnaire) onglets.splice(2, 0, 'config');
  if (u.gestionnaire && etat.moi.demo) onglets.push('demo');
  if (!onglets.includes(etat.adminOnglet)) etat.adminOnglet = 'utilisateurs';
  v.innerHTML = `<div class="entete"><div><h2>${D('titre')}</h2><p>${D('intro', { portee: t(u.gestionnaire ? 'admin.tout_reseau' : 'admin.vos_etabs') })}</p></div></div>
    <div class="chips">${onglets.map((k) => `<button class="chip" aria-pressed="${etat.adminOnglet === k}" data-ao="${k}">${D(`o_${k}`)}</button>`).join('')}</div><div id="admin-corps" style="margin-top:14px"></div>`;
  v.querySelectorAll('[data-ao]').forEach((b) => { b.onclick = () => { etat.adminOnglet = b.dataset.ao; rafraichir(); }; });
  const corps = $('#admin-corps');
  const etabs = etat.moi.etablissements;
  const nomEtab = (id) => (etabs.find((e) => e.id === id) || {}).nom || `#${id}`;
  const casesEtab = (choisis = []) => etabs.map((e) => `<label class="case"><input type="checkbox" data-etabu="${e.id}"${choisis.includes(e.id) ? ' checked' : ''}> ${esc(e.nom)}</label>`).join('');
  const rolesPermis = ['coordonnateur', 'entretien', 'admin_etab', 'gestionnaire'].filter((k) => u.gestionnaire || k !== 'gestionnaire');

  if (etat.adminOnglet === 'utilisateurs') {
    const comptes = await api('GET', '/admin/utilisateurs');
    corps.innerHTML = `<div class="deux"><div class="panneau-c"><h3>${D('nouveau_compte')}</h3>
        <div class="champ"><label class="lbl" for="n-nom">${D('nom')}</label><input id="n-nom" autocomplete="off"></div>
        <div class="champ"><label class="lbl" for="n-email">${D('courriel')}</label><input id="n-email" type="email" autocomplete="off"></div>
        <div class="champ"><label class="lbl" for="n-role">${D('role')}</label><select id="n-role">${options('roles', rolesPermis)}</select></div>
        <div class="champ"><span class="lbl">${D('etablissements')}</span><div class="cases">${casesEtab([etat.ctx])}</div></div>
        <button class="btn pri" id="b-creer-compte">${D('creer')}</button>
        <p class="note">${D('creer_aide')}</p></div>
      <div class="tableau"><table><thead><tr><th>${D('th_nom')}</th><th>${D('th_role')}</th><th>${D('th_etabs')}</th><th>${D('th_securite')}</th><th>${D('th_connexion')}</th><th></th></tr></thead><tbody>${comptes.map((c) => `<tr>
        <td><span class="donnee">${esc(c.nom)}</span><div class="note">${esc(c.email)}</div></td><td>${esc(t(`roles.${c.role}`))}${c.actif ? '' : ` <span class="badge">${D('desactive')}</span>`}</td>
        <td class="note">${c.etablissements.map((e) => esc(nomEtab(e))).join('<br>') || D('tout_le_reseau')}</td>
        <td class="note">${D(c.totp_actif ? 'double_ok' : 'mdp_seul')}${c.mdp_temporaire ? `<br>${D('mdp_temp')}` : ''}</td>
        <td class="note">${c.derniere_connexion ? heure(c.derniere_connexion) : esc(t('general.jamais'))}</td>
        <td><div class="ligne" style="gap:6px">${c.id === u.id ? '' : `<button class="btn" data-reinit="${c.id}" data-nom="${esc(c.nom)}">${D('reinitialiser')}</button>
          <button class="btn${c.actif ? ' dan' : ''}" data-actif="${c.id}" data-val="${!c.actif}">${D(c.actif ? 'desactiver' : 'reactiver')}</button>`}</div></td></tr>`).join('')}</tbody></table></div></div>`;
    $('#b-creer-compte').onclick = (ev) => {
      const choisis = [...corps.querySelectorAll('[data-etabu]:checked')].map((c) => Number(c.dataset.etabu));
      agir(ev.target, async () => {
        const r = await api('POST', '/admin/utilisateurs', { nom: $('#n-nom').value, email: $('#n-email').value, role: $('#n-role').value, etablissements: choisis });
        montrerSecret(t('admin.compte_cree', { email: r.email }), r.mot_de_passe_temporaire, t('admin.temp_a_transmettre'));
      });
    };
    corps.querySelectorAll('[data-reinit]').forEach((b) => {
      b.onclick = () => modale(t('admin.reinit_titre', { nom: b.dataset.nom }), `<p>${D('reinit_aide')}</p>
        <label class="case"><input type="checkbox" id="r-2fa"> ${D('reinit_2fa')}</label>`,
      [{ label: t('general.annuler') }, { label: t('admin.reinitialiser'), pri: true, run: async () => {
        try {
          const r = await api('POST', `/admin/utilisateurs/${b.dataset.reinit}/reinitialiser`, { reinitialiser_2fa: $('#r-2fa').checked });
          setTimeout(() => montrerSecret(t('admin.nouveau_temp'), r.mot_de_passe_temporaire, t('admin.pour', { nom: b.dataset.nom })), 50);
          rafraichir();
          return true;
        } catch (e) { toast(e.message, true); return false; }
      } }]);
    });
    corps.querySelectorAll('[data-actif]').forEach((b) => { b.onclick = () => agir(b, () => api('PUT', `/admin/utilisateurs/${b.dataset.actif}`, { actif: b.dataset.val === 'true' }), t('admin.compte_ok')); });
  }

  if (etat.adminOnglet === 'structure') {
    const cfg = configCtx();
    const st = await api('GET', `/admin/structure?etablissement_id=${etat.ctx}`);
    corps.innerHTML = `<p class="note">${t('admin.etab_courant', { etab: esc(etabCtx().nom) })}</p>
      <div class="ligne" style="margin-bottom:14px"><div class="champ"><label class="lbl" for="s-type">${D('type')}</label><select id="s-type">${cfg.types.map((ty) => `<option value="${ty.id}">${esc(nomType(ty))}</option>`).join('')}</select></div>
        <div class="champ"><label class="lbl" for="s-nom">${D('nom_unite')}</label><input id="s-nom" autocomplete="off"></div><button class="btn pri" id="b-unite">${D('ajouter_unite')}</button></div>
      <div class="pile">${st.map((un) => `<div class="panneau-c"><div class="entete" style="margin:0"><h3><span class="donnee">${esc(un.nom)}</span> <span class="note">${esc(un.type_nom)}</span></h3>
          <div class="ligne"><input placeholder="${D('num_chambre')}" data-chnum="${un.id}" style="width:130px" aria-label="${D('num_chambre')}"><button class="btn" data-ch="${un.id}">${D('ajouter_chambre')}</button></div></div>
        ${un.chambres.map((ch) => `<div class="item"><div style="flex:1 1 100%"><strong>${D('chambre', { n: ch.numero })}</strong>
          <div class="liste" style="margin-top:6px">${ch.lits.map((l) => `<div class="ligne" style="justify-content:space-between;gap:8px"><span class="num">${esc(l.code)} <span class="note">${esc(t(`etats.${l.etat}`))}</span></span>
            <span class="cases">${BESOINS.map((k) => `<label class="case" title="${esc(t(`besoins.${k}`))}"><input type="checkbox" data-eq="${l.id}" data-k="${k}"${l[k] ? ' checked' : ''}> ${esc(t(`equipement_court.${k}`))}</label>`).join('')}</span></div>`).join('') || `<span class="note">${D('aucun_lit')}</span>`}</div>
          <div class="ligne" style="margin-top:6px"><input placeholder="${D('code_lit', { ex: `${un.type_code}-${ch.numero}C` })}" data-litcode="${ch.id}" style="width:230px" aria-label="${D('code_lit', { ex: '' })}"><button class="btn" data-lit-ch="${ch.id}">${D('ajouter_lit')}</button></div></div></div>`).join('') || `<p class="note">${D('aucune_chambre')}</p>`}</div>`).join('')}</div>`;
    $('#b-unite').onclick = (ev) => agir(ev.target, () => api('POST', '/admin/unites', { etablissement_id: etat.ctx, type_id: Number($('#s-type').value), nom: $('#s-nom').value }), t('admin.unite_ok'));
    corps.querySelectorAll('[data-ch]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', '/admin/chambres', { unite_id: Number(b.dataset.ch), numero: corps.querySelector(`[data-chnum="${b.dataset.ch}"]`).value }), t('admin.chambre_ok')); });
    corps.querySelectorAll('[data-lit-ch]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', '/admin/lits', { chambre_id: Number(b.dataset.litCh), code: corps.querySelector(`[data-litcode="${b.dataset.litCh}"]`).value }), t('admin.lit_ok')); });
    corps.querySelectorAll('[data-eq]').forEach((c) => { c.onchange = () => agir(null, () => api('PUT', `/admin/lits/${c.dataset.eq}/equipement`, { [c.dataset.k]: c.checked }), t('admin.equipement_ok')); });
    // Civières de l'urgence
    const civs = await api('GET', `/admin/civieres?etablissement_id=${etat.ctx}`);
    corps.insertAdjacentHTML('beforeend', `<div class="panneau-c" style="margin-top:14px"><h3>${D('civieres')}</h3><p class="note">${D('civieres_aide')}</p>
      <div class="chips">${civs.map((c) => `<span class="chip num">${esc(c.code)} · ${esc(t(`urgence.cat_${c.categorie}`))}</span>`).join('') || `<span class="note">${D('aucune_civiere')}</span>`}</div>
      <div class="ligne"><div class="champ"><label class="lbl" for="s-civ-code">${D('code_civiere')}</label><input id="s-civ-code" placeholder="URG-01" autocomplete="off"></div>
        <div class="champ"><label class="lbl" for="s-civ-cat">${D('categorie')}</label><select id="s-civ-cat">${['reguliere', 'debordement'].map((k) => `<option value="${k}">${esc(t(`urgence.cat_${k}`))}</option>`).join('')}</select></div>
        <button class="btn" id="b-civiere">${D('ajouter_civiere')}</button></div></div>`);
    $('#b-civiere').onclick = (ev) => agir(ev.target, () => api('POST', '/admin/civieres', { etablissement_id: etat.ctx, code: $('#s-civ-code').value, categorie: $('#s-civ-cat').value }), t('admin.civiere_ok'));
  }

  if (etat.adminOnglet === 'config') {
    const cfgs = await api('GET', '/admin/config');
    const champs = ['rayon_km', 'vitesse_kmh', 'facteur_route', 'penalite_orange_km', 'penalite_rouge_km', 'horizon_h', 'seuil_jaune', 'seuil_orange',
      'seuil_rouge', 'attente_admission_max_min', 'nettoyage_cible_min', 'reservation_max_min', 'marge_conge_min', 'hors_service_max_h', 'cible_nsa_pct',
      'seuil_civieres_jaune', 'seuil_civieres_orange', 'seuil_civieres_rouge', 'nettoyage_civiere_cible_min'];
    const niveaux = ['vert', 'jaune', 'orange', 'rouge'];
    const protocoles = (c, cle, attr) => niveaux.map((n) => `<div class="champ"><label class="lbl" for="${attr}-${c.id}-${n}">${esc(t(`niveaux.${n}`))}</label><textarea id="${attr}-${c.id}-${n}" data-${attr}="${n}" rows="2" class="donnee">${esc((c[cle] || {})[n] || '')}</textarea></div>`).join('');
    corps.innerHTML = cfgs.map((c) => `<form class="panneau-c" data-cfg="${c.id}"><h3 class="donnee">${esc(c.nom)}</h3><div class="grille" style="gap:10px">${champs.map((k) => `<div class="champ"><label class="lbl" for="cfg-${c.id}-${k}">${D(`champs.${k}`)}</label><input id="cfg-${c.id}-${k}" data-k="${k}" value="${esc(c[k])}" inputmode="decimal"></div>`).join('')}</div>
      <h3>${D('protocoles')}</h3>${protocoles(c, 'protocoles', 'pr')}
      <h3>${D('protocoles_en')}</h3>${protocoles(c, 'protocoles_en', 'pren')}
      <button class="btn pri" type="submit">${esc(t('general.enregistrer'))}</button></form>`).join('');
    corps.querySelectorAll('[data-cfg]').forEach((f) => {
      f.onsubmit = (e) => {
        e.preventDefault();
        const corpsCfg = { protocoles: {}, protocoles_en: {} };
        f.querySelectorAll('[data-k]').forEach((i) => { corpsCfg[i.dataset.k] = Number(i.value); });
        f.querySelectorAll('[data-pr]').forEach((x) => { corpsCfg.protocoles[x.dataset.pr] = x.value; });
        f.querySelectorAll('[data-pren]').forEach((x) => { corpsCfg.protocoles_en[x.dataset.pren] = x.value; });
        agir(null, async () => { await api('PUT', `/admin/config/${f.dataset.cfg}`, corpsCfg); etat.moi = await api('GET', '/moi'); }, t('admin.config_ok'));
      };
    });
  }

  if (etat.adminOnglet === 'connecteurs') {
    const cons = await api('GET', '/admin/connecteurs');
    corps.innerHTML = `<div class="deux"><div class="panneau-c"><h3>${D('nouveau_connecteur')}</h3>
        <div class="champ"><label class="lbl" for="c-nom-con">${D('nom')}</label><input id="c-nom-con" placeholder="${D('nom_connecteur')}" autocomplete="off"></div>
        <div class="champ"><label class="lbl" for="c-etab-con">${D('etablissement')}</label><select id="c-etab-con">${etabs.map((e) => `<option value="${e.id}"${e.id === etat.ctx ? ' selected' : ''}>${esc(e.nom)}</option>`).join('')}${u.gestionnaire ? `<option value="">${D('reseau_lecture')}</option>` : ''}</select></div>
        <button class="btn pri" id="b-con">${D('creer_cle')}</button>
        <p class="note">${D('connecteur_aide')}</p></div>
      <div class="tableau"><table><thead><tr><th>${D('th_nom')}</th><th>${D('etablissement')}</th><th>${D('th_dernier')}</th><th>${D('th_rejets')}</th><th></th></tr></thead><tbody>${cons.map((c) => `<tr>
        <td><span class="donnee">${esc(c.nom)}</span>${c.actif ? '' : ` <span class="badge">${D('revoque')}</span>`}</td><td>${esc(c.etablissement || t('admin.reseau_lect'))}</td>
        <td class="note">${c.dernier_message ? heure(c.dernier_message) : esc(t('general.aucun'))}</td><td class="num${c.rejets_24h ? ' refuse' : ''}">${c.rejets_24h}</td>
        <td>${c.actif ? `<button class="btn dan" data-revoquer="${c.id}">${D('revoquer')}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="5" class="muted">${D('aucun_connecteur')}</td></tr>`}</tbody></table></div></div>`;
    $('#b-con').onclick = (ev) => agir(ev.target, async () => {
      const r = await api('POST', '/admin/connecteurs', { nom: $('#c-nom-con').value || t('admin.connecteur_defaut'), etablissement_id: $('#c-etab-con').value ? Number($('#c-etab-con').value) : null });
      montrerSecret(t('admin.cle_titre', { nom: r.nom }), r.cle, t('admin.cle_aide'));
    });
    corps.querySelectorAll('[data-revoquer]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/admin/connecteurs/${b.dataset.revoquer}/revoquer`), t('admin.revoque_ok')); });
  }

  if (etat.adminOnglet === 'journal') {
    const { lignes: j, plus } = avecSuite('admin-journal', await api('GET', '/admin/journal'));
    corps.innerHTML = `<div class="tableau"><table><thead><tr><th>${D('th_date')}</th><th>${D('th_par')}</th><th>${D('th_action')}</th><th>${D('th_cible')}</th><th>${D('th_detail')}</th><th>${D('th_etab')}</th></tr></thead><tbody>${j.map((x) => `<tr>
      <td class="num">${heure(x.date)}</td><td class="donnee">${esc(x.utilisateur || '')}</td><td>${esc(libelleAction('journal_admin_actions', x.action))}</td><td class="donnee">${esc(x.cible || '')}</td><td class="note donnee">${esc(x.detail || '')}</td><td class="note">${esc(x.etablissement || '')}</td></tr>`).join('') || `<tr><td colspan="6" class="muted">${D('aucune_action')}</td></tr>`}</tbody></table></div>${plus ? boutonPlus('admin-journal') : ''}`;
    brancherPlus(corps, 'admin-journal', '/admin/journal', j);
  }

  if (etat.adminOnglet === 'demo') await vueAdminDemo(corps);
}

/* ---------------- Aide intégrée ---------------- */
/** Écrans accessibles au rôle connecté (ceux dont l'onglet est visible, plus Mon compte). */
const ecransDuRole = () => [...document.querySelectorAll('#onglets button')].filter((b) => !b.hidden).map((b) => b.dataset.v).concat('compte');

function blocAide(cle, ouvert) {
  const e = t(`aide.ecrans.${cle}`);
  const erreurs = e.erreurs.length ? `<h4>${esc(t('aide.erreurs'))}</h4><dl class="aide-erreurs">${e.erreurs.map(([m, quoi]) => `<dt>${esc(m)}</dt><dd>${esc(quoi)}</dd>`).join('')}</dl>` : '';
  return `<details class="aide-ecran" data-aide="${cle}"${ouvert ? ' open' : ''}><summary>${esc(ouvert ? t('aide.cet_ecran', { ecran: e.nom }) : e.nom)}</summary>
    <h4>${esc(t('aide.a_quoi'))}</h4><p>${esc(e.but)}</p>
    <h4>${esc(t('aide.gestes'))}</h4><ol>${e.gestes.map((g) => `<li>${esc(g)}</li>`).join('')}</ol>${erreurs}</details>`;
}
function afficherAide() {
  const p = $('#panneau-aide');
  const role = etat.moi.utilisateur.role;
  const ecrans = ecransDuRole();
  const actuel = ecrans.includes(etat.vue) ? etat.vue : ecrans[0];
  const garderOuverts = [...p.querySelectorAll('details[open]')].map((d) => d.dataset.aide);
  p.innerHTML = `<div class="entete"><h3>${esc(t('aide.titre'))}</h3><button class="btn" id="b-fermer-aide">${esc(t('aide.fermer'))}</button></div>
    <section class="aide-role" data-role="${role}"><h4>${esc(t('aide.votre_role'))} · ${esc(t(`aide.roles.${role}.titre`))}</h4><p>${esc(t(`aide.roles.${role}.texte`))}</p></section>
    ${blocAide(actuel, true)}
    <h4 class="aide-autres">${esc(t('aide.autres'))}</h4>
    ${ecrans.filter((k) => k !== actuel).map((k) => blocAide(k, garderOuverts.includes(k))).join('')}
    <p class="note">${esc(t('aide.contact'))}</p>
    <button class="btn" id="b-revoir-premiers-pas">${esc(t('aide.revoir'))}</button>`;
  $('#b-fermer-aide').onclick = fermerAide;
  $('#b-revoir-premiers-pas').onclick = () => { fermerAide(); premiersPas(true); };
}
function fermerAide() { const p = $('#panneau-aide'); if (p) p.hidden = true; }
$('#b-aide').onclick = () => {
  const p = $('#panneau-aide');
  if (!p.hidden) { fermerAide(); return; }
  $('#panneau-notif').hidden = true;
  afficherAide();
  p.hidden = false;
  $('#b-fermer-aide').focus();
};

/** Premiers pas : affichés une seule fois (mémorisé côté serveur), puis accessibles depuis l'aide. */
function premiersPas(revoir) {
  const role = etat.moi.utilisateur.role;
  const m = $('#modale');
  m.innerHTML = `<div class="boite premiers-pas" role="dialog" aria-modal="true" aria-labelledby="pp-titre"><h3 id="pp-titre">${esc(t('aide.premiers_pas.titre'))}</h3>
    <p>${esc(t('aide.premiers_pas.intro'))}</p>
    <ol>${[...t(`aide.premiers_pas.roles.${role}`), ...t('aide.premiers_pas.commun')].map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
    <div class="actions"><button class="btn pri" id="b-premiers-pas-ok">${esc(t('aide.premiers_pas.ok'))}</button></div></div>`;
  m.hidden = false;
  $('#b-premiers-pas-ok').onclick = () => { m.hidden = true; };
  $('#b-premiers-pas-ok').focus();
  if (!revoir) {
    etat.moi.utilisateur.premiers_pas_vus = true;
    api('POST', '/moi/premiers-pas').catch(() => {});
  }
}

/* ---------------- Démonstration : remise à zéro (gestionnaire réseau, serveur de démonstration) ---------------- */
async function vueAdminDemo(corps) {
  const D = (k) => esc(t(`admin.${k}`));
  corps.innerHTML = `<div class="panneau-c" style="max-width:640px"><h3>${D('demo_titre')}</h3><p>${D('demo_aide')}</p><p class="note">${D('demo_recalage')}</p>
    <div><button class="btn dan" id="b-demo-zero">${D('demo_bouton')}</button></div></div>`;
  $('#b-demo-zero').onclick = () => modale(t('admin.demo_titre'), `<p>${D('demo_confirmer')}</p>`,
    [{ label: t('general.annuler') }, { label: t('admin.demo_bouton'), pri: true, run: async () => {
      etat.pause = true;   // les sessions sont fermées par la remise à zéro : pas de « session expirée » entre-temps
      try {
        await api('POST', '/admin/demo/reinitialiser');
        deconnecter(true);
        $('#c-erreur').textContent = t('admin.demo_ok');
        return true;
      } catch (e) { toast(e.message, true); return false; } finally { etat.pause = false; }
    } }]);
}

/* ---------------- démarrage ---------------- */
appliquerLangue();
fetch('/api/public').then((r) => r.json()).then((p) => { $('#bandeau-demo').hidden = !p.demo; $('#b-oubli').hidden = !p.mot_de_passe_oublie; }).catch(() => {});
(async () => {
  // Lien reçu par courriel : /?reinit=<jeton> ; le jeton est retiré de l'adresse aussitôt lu
  const reinit = new URLSearchParams(location.search).get('reinit');
  if (reinit) {
    jetonReinit = reinit;
    history.replaceState(null, '', location.pathname);
    montrerFormulaire('#f-reinit');
    $('#r-nouveau').focus();
    return;
  }
  etat.token = lire('arrimo-token');
  if (!etat.token) { $('#ecran-connexion').hidden = false; return; }
  try { await demarrer(); } catch { deconnecter(true); }
})();
