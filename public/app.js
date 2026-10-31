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
  if (typeof v !== 'string') return v;
  if (!vars) return avecNomOg(v);
  // Pluriels {n|un|plusieurs}, nombres selon la langue ; une variable « *_etat » est un état de lit ou de civière
  return avecNomOg(F.remplir(locale(), v, vars, (k, x) => (k.endsWith('_etat') ? t(`etats.${x}`) : undefined)));
}

/* ---------------- Nom de l'assistant : source unique, propre à l'établissement courant ---------------- */
// « OG » reste l'identifiant technique (API, code, journaux) ; seul l'affichage prend le nom choisi par l'établissement.
let nomAssistant = 'OG';
// Mêmes caractères que ceux acceptés pour un nom (lettres, chiffres, espace, point, trait d'union, apostrophe typographique).
const nomPropre = (n) => String(n || '').replace(/'/g, '’').replace(/[^\p{L}\p{N} .\-’]/gu, '').trim().slice(0, 30) || 'OG';
/** Remplace « OG » par le nom de l'établissement dans un texte affiché ou lu (élision française comprise : « d’OG » → « de Charles »). */
function avecNomOg(texte) {
  if (typeof texte !== 'string' || nomAssistant === 'OG' || !texte.includes('OG')) return texte;
  const voyelle = /^[aeiouyhàâäéèêëîïôöûüœ]/i.test(nomAssistant);
  return texte.replace(/\b(d|D|qu|Qu)['’]OG\b/g, (m, p) => (voyelle ? `${p}’${nomAssistant}` : `${{ d: 'de', D: 'De', qu: 'que', Qu: 'Que' }[p]} ${nomAssistant}`))
    .replace(/\bOG\b/g, nomAssistant);
}
window.ArrimoNomOg = { nom: () => nomAssistant, appliquer: (x) => avecNomOg(x) };
function definirNomOg(nom, rendre = true) {
  const nouveau = nomPropre(nom);
  if (nouveau === nomAssistant) return;
  nomAssistant = nouveau;
  appliquerLangue();
  window.dispatchEvent(new Event('arrimo:og-nom'));
  // Les écrans à formulaire ne sont pas redessinés (saisie en cours) : leurs titres suivront au prochain affichage.
  if (rendre && etat.moi && !VUES_FORMULAIRES.includes(etat.vue)) rafraichir();
}
/** Nom de l'assistant de l'établissement courant : affiché tout de suite depuis le dernier connu, puis confirmé par le serveur. */
async function chargerNomOg() {
  const ctx = etat.ctx;
  if (!ctx || !etat.token) { definirNomOg('OG', false); return; }
  definirNomOg(lire(`arrimo-og-nom-${ctx}`) || 'OG', false);
  try {
    const c = await api('GET', `/og/configuration?etablissement_id=${ctx}`);
    if (ctx !== etat.ctx) return;
    const nom = nomPropre(c.personnalisation?.nom);
    ecrire(`arrimo-og-nom-${ctx}`, nom);
    window.ArrimoOgVoix = c.personnalisation?.voix || 'feminine';
    definirNomOg(nom);
  } catch { /* nom connu conservé */ }
}
window.addEventListener('arrimo:og-configuration', chargerNomOg);
/** Texte dans une langue donnée (réponse de l'assistant dans la langue de la question, quelle que soit celle de l'interface). */
function tL(l, cle, vars) { const avant = langue; langue = LANGUES.includes(l) ? l : avant; try { return t(cle, vars); } finally { langue = avant; } }
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
  document.querySelectorAll('[data-langue-choix]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.langueChoix === langue)));
  document.querySelectorAll('[data-og-nom]').forEach((el) => { el.textContent = nomAssistant; });
  majApparence();
  if (etat.lien) $('#c-lien').textContent = t('connexion.lien', { nom: etat.lien.nom });
}
/* Apparence (clair, sombre, automatique, soleil) : préférence du compte, appliquée à toutes ses pages. */
function lieuApparence() {
  const e = etat.moi?.etablissements?.find((x) => x.id === etat.ctx) || etat.moi?.etablissements?.[0];
  return e && Number.isFinite(e.latitude) ? { latitude: e.latitude, longitude: e.longitude, source: 'etablissement' } : null;
}
function majApparence() {
  const s = $('#apparence-barre'); if (!s) return;
  const actuel = etat.moi?.utilisateur?.apparence || window.ArrimoApparence?.mode() || 'automatique';
  s.innerHTML = ['clair', 'sombre', 'automatique', 'soleil'].map((m) => `<option value="${m}"${m === actuel ? ' selected' : ''}>${esc(t(`apparence.${m}`))}</option>`).join('');
  const b = $('#b-theme'); if (b) { const l = `${t('apparence.basculer')} · ${t(`apparence.${actuel}`)}`; b.setAttribute('aria-label', l); b.title = l; }
}
/** Préférence personnelle d'apparence : appliquée tout de suite, enregistrée sur le compte, retrouvée à la reconnexion. */
async function choisirApparence(choix) {
  try {
    const r = await api('PUT', '/moi/apparence', { apparence: choix });
    if (etat.moi) etat.moi.utilisateur.apparence = r.apparence;
    window.ArrimoApparence?.definir(r.apparence, { lieu: lieuApparence() });
    majApparence();
    toast(t('apparence.enregistree'));
  } catch (err) { toast(err.message, true); majApparence(); }
}
$('#apparence-barre')?.addEventListener('change', (e) => choisirApparence(e.target.value));
// Bascule de l'en-tête : clair → sombre → automatique (système), sans ouvrir les Paramètres.
$('#b-theme')?.addEventListener('click', () => {
  const ordre = ['clair', 'sombre', 'automatique'];
  const actuel = etat.moi?.utilisateur?.apparence || window.ArrimoApparence?.mode() || 'automatique';
  choisirApparence(ordre[(ordre.indexOf(actuel) + 1) % ordre.length]);
});
/** Valeurs saisies dans l'écran courant (par identifiant de champ), pour les retrouver après un nouveau rendu. */
function saisiesEcran() {
  const s = document.querySelector(`#v-${etat.vue}`); if (!s) return [];
  return [...s.querySelectorAll('input[id], select[id], textarea[id]')].filter((el) => el.type !== 'file')
    .map((el) => [el.id, ['checkbox', 'radio'].includes(el.type) ? el.checked : el.value]);
}
function restaurerSaisies(saisies) {
  for (const [id, v] of saisies) {
    const el = document.getElementById(id); if (!el || el.disabled) continue;
    if (['checkbox', 'radio'].includes(el.type)) el.checked = v;
    else if (el.tagName !== 'SELECT' || [...el.options].some((o) => o.value === v)) el.value = v;
  }
}
/**
 * Langue de l'interface : textes changés tout de suite, sans déconnexion ; saisies et écran conservés ;
 * préférence enregistrée sur cet appareil et sur le compte (retrouvée à la reconnexion).
 * La conversation avec l'assistant n'est pas effacée : seule sa langue par défaut suit.
 */
async function changerLangue(l, { enregistrer = true } = {}) {
  if (!LANGUES.includes(l) || l === langue) return;
  const saisies = etat.moi ? saisiesEcran() : [];
  langue = l;
  ecrire('arrimo-langue', l);
  appliquerLangue();
  window.dispatchEvent(new Event('arrimo:langue'));
  if (etat.environnement) bandeauEnvironnement(etat.environnement);
  if (enregistrer && etat.token && etat.moi) api('PUT', '/moi/langue', { langue_interface: l }).then((r) => { if (etat.moi) etat.moi.utilisateur.langue_interface = r.langue_interface; }).catch(() => {});
  if (etat.moi) {
    majNomUtilisateur(); majSelecteurCtx(); etat.reponse = '';
    await rafraichir();
    while (enCours) await new Promise((ok) => setTimeout(ok, 40));
    restaurerSaisies(saisies);
  }
}
document.querySelectorAll('[data-langue-choix]').forEach((b) => { b.onclick = () => changerLangue(b.dataset.langueChoix); });
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
  ouvrirNav(false); definirNomOg('OG', false);
  etat.supportBrouillons={};etat.supportFiche=null;etat.supportNavigation=null;
  $('#v-support').innerHTML='';
  window.dispatchEvent(new Event('arrimo:session-reset'));
  etat.question = ''; etat.reponse = ''; etat.recos = [];
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
/* ---------------- Disposition de la navigation : barre horizontale ou barre verticale à gauche ---------------- */
// Préférence propre à cet appareil (un écran large et un téléphone ne se prêtent pas à la même disposition).
const DISPOSITIONS = ['horizontale', 'verticale'];
const disposition = () => (lire('arrimo-disposition') === 'verticale' ? 'verticale' : 'horizontale');
function appliquerDisposition(d) {
  const v = d === 'verticale';
  document.body.classList.toggle('nav-verticale', v);
  // Météo, heure et date : en tête de la barre verticale ou du tiroir du téléphone, sinon dans l'en-tête (déplacées seulement si besoin).
  const infos = $('#infos-lieu'); const nav = $('#onglets'); const dansNav = v || window.matchMedia('(max-width: 600px)').matches;
  if (infos && nav && (infos.parentElement === nav) !== dansNav) { if (dansNav) nav.prepend(infos); else $('.barre-in .marque')?.after(infos); }
  const b = $('#b-disposition');
  if (b) { const l = `${t('disposition.basculer')} · ${t(`disposition.${d}`)}`; b.setAttribute('aria-label', l); b.title = l; b.setAttribute('aria-pressed', String(v)); }
  majHauteurBarre();
}
function choisirDisposition(d) {
  if (!DISPOSITIONS.includes(d)) return;
  ecrire('arrimo-disposition', d); appliquerDisposition(d); toast(t('disposition.enregistree'));
}
/** Hauteur réelle de l'en-tête : la barre verticale commence juste dessous (mesurée seulement quand elle change, jamais au défilement). */
function majHauteurBarre() { const h = $('.barre')?.getBoundingClientRect().height; if (h) document.body.style.setProperty('--haut-barre', `${Math.ceil(h)}px`); }
if (window.ResizeObserver && $('.barre')) new ResizeObserver(majHauteurBarre).observe($('.barre'));
/* Menu tiroir du téléphone : ouverture et fermeture contrôlées (bouton, voile, Échap, choix d'un écran). */
const telephone = window.matchMedia('(max-width: 600px)');
function ouvrirNav(ouvrir) {
  const b = $('#b-nav'); if (!b) return;
  const ouvert = !!ouvrir && telephone.matches;
  if (ouvert === document.body.classList.contains('nav-ouverte')) return;
  document.body.classList.toggle('nav-ouverte', ouvert);
  $('#voile-nav').hidden = !ouvert;
  b.setAttribute('aria-expanded', String(ouvert));
  const l = t(ouvert ? 'nav.fermer' : 'nav.ouvrir'); b.setAttribute('aria-label', l); b.title = l;
  if (ouvert) ($('#onglets button[aria-selected="true"]:not([hidden])') || $('#onglets button:not([hidden])'))?.focus();
  else if (document.activeElement?.closest?.('#onglets')) b.focus();
}
$('#b-nav')?.addEventListener('click', () => ouvrirNav(!document.body.classList.contains('nav-ouverte')));
$('#voile-nav')?.addEventListener('click', () => ouvrirNav(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ouvrirNav(false); });
telephone.addEventListener?.('change', () => { ouvrirNav(false); appliquerDisposition(disposition()); });
/** Changement d'écran : la page repart du haut (pas de position héritée de l'écran précédent ni de saut). */
const hautDePage = () => { if (window.scrollY) window.scrollTo(0, 0); };
$('#b-disposition')?.addEventListener('click', () => choisirDisposition(disposition() === 'verticale' ? 'horizontale' : 'verticale'));

/* ---------------- Météo, heure et date de l'établissement (fuseau de sa configuration) ---------------- */
// Codes météo de l'OMM regroupés en familles lisibles ; l'icône accompagne toujours un libellé (jamais l'icône seule).
const METEO = [[[0], 'degage', '☀️', '🌙'], [[1, 2], 'nuageux', '🌤️', '☁️'], [[3], 'couvert', '☁️', '☁️'], [[45, 48], 'brouillard', '🌫️', '🌫️'],
  [[51, 53, 55, 56, 57], 'bruine', '🌦️', '🌧️'], [[61, 63, 65, 66, 67, 80, 81, 82], 'pluie', '🌧️', '🌧️'], [[71, 73, 75, 77, 85, 86], 'neige', '❄️', '❄️'], [[95, 96, 99], 'orage', '⛈️', '⛈️']];
let meteoCtx = { ctx: null, donnees: null, lu: 0 };
function majInfosLieu() {
  const z = $('#infos-lieu'); const e = etabCtx(); if (!z) return;
  if (!e || !etat.moi) { z.hidden = true; return; }
  const maintenant = new Date(); const tz = fuseau();
  const date = maintenant.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });
  const h = maintenant.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', timeZone: tz });
  const m = meteoCtx.ctx === etat.ctx && meteoCtx.donnees?.disponible ? meteoCtx.donnees : null;
  const famille = m ? METEO.find(([codes]) => codes.includes(m.code)) : null;
  const meteoHtml = m ? `<span class="il-meteo" title="${esc(t('infos.source', { source: m.source }))}"><span aria-hidden="true">${famille ? (m.jour ? famille[2] : famille[3]) : '🌡️'}</span>
      <span class="num">${esc(nb(Math.round(m.temperature)))} °C</span><span class="il-ciel">${famille ? esc(t(`infos.ciel_${famille[1]}`)) : ''}</span></span>` : '';
  z.innerHTML = `${meteoHtml}<span class="il-lieu">${esc(m?.ville || e.ville || '')}</span><span class="il-date">${esc(date)}</span><span class="il-heure num">${esc(h)}</span>`;
  z.setAttribute('aria-label', t('infos.resume', { ville: m?.ville || e.ville || '', date, heure: h, meteo: m ? `${Math.round(m.temperature)} °C${famille ? `, ${t(`infos.ciel_${famille[1]}`)}` : ''}` : t('infos.meteo_indisponible') }));
  z.hidden = false;
}
async function majMeteo(forcer) {
  if (!etat.ctx || !etat.token) return;
  if (!forcer && meteoCtx.ctx === etat.ctx && Date.now() - meteoCtx.lu < 15 * 60 * 1000) { majInfosLieu(); return; }
  const ctx = etat.ctx;
  meteoCtx = { ctx, donnees: meteoCtx.ctx === ctx ? meteoCtx.donnees : null, lu: Date.now() };
  try { const d = await api('GET', `/meteo?etablissement_id=${ctx}`); if (etat.ctx === ctx) meteoCtx.donnees = d; } catch { /* l'heure et la date restent affichées */ }
  majInfosLieu();
}
setInterval(majInfosLieu, 30000);
setInterval(() => majMeteo(false), 5 * 60 * 1000);

/** Modifications OG non enregistrées : demander avant de quitter l'écran. */
function quitterSansEnregistrer() {
  if (!etat.ogModifie) return true;
  if (!window.confirm(t('ogperso.quitter_sans_enregistrer'))) return false;
  etat.ogModifie = false; return true;
}
window.addEventListener('beforeunload', (e) => { if (etat.ogModifie) { e.preventDefault(); e.returnValue = ''; } });
function allerA(vue) {
  if (vue !== etat.vue && !quitterSansEnregistrer()) return;
  if (vue !== etat.vue) hautDePage();
  ouvrirNav(false);
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
  $('label.ctx').hidden = !etat.moi.etablissements.length;   // environnement neuf : rien à choisir
}

async function demarrer() {
  etat.moi = await api('GET', '/moi');
  // Langue : un choix fait sur cet appareil l'emporte et est recopié sur le compte ; sur un appareil sans choix,
  // la langue enregistrée sur le compte est reprise (reconnexion sur un autre appareil).
  const langueCompte = etat.moi.utilisateur.langue_interface;
  const choixAppareil = LANGUES.includes(lire('arrimo-langue')) ? lire('arrimo-langue') : null;
  if (choixAppareil) { if (choixAppareil !== langueCompte) api('PUT', '/moi/langue', { langue_interface: choixAppareil }).then((r) => { if (etat.moi) etat.moi.utilisateur.langue_interface = r.langue_interface; }).catch(() => {}); }
  else if (LANGUES.includes(langueCompte) && langueCompte !== langue) { langue = langueCompte; ecrire('arrimo-langue', langue); appliquerLangue(); window.dispatchEvent(new Event('arrimo:langue')); }
  window.ArrimoApparence?.definir(etat.moi.utilisateur.apparence || 'automatique', { lieu: lieuApparence() });
  majApparence();
  bandeauEnvironnement(etat.moi.environnement);
  if (etat.moi.utilisateur.mdp_temporaire) { montrerFormulaire('#f-mdp-temp'); $('#t-actuel').focus(); return; }
  const etabs = etat.moi.etablissements;
  majNomUtilisateur();
  if (!etabs.length && etat.moi.utilisateur.gestionnaire) {
    // Environnement neuf (recette, production) : le gestionnaire crée le premier établissement dans l'administration
    etat.ctx = null; majSelecteurCtx();
    $('#ecran-connexion').hidden = true;
    $('#ecran-app').hidden = false;
    document.querySelectorAll('#onglets button').forEach((b) => { b.hidden = b.dataset.v !== 'admin'; });
    $('#b-notif').hidden = true;
    allerA(etat.moi.utilisateur.totp_actif ? 'admin' : 'compte');
    document.body.dataset.pret = '1';
    return;
  }
  if (!etabs.length) {
    $('#ecran-connexion').hidden = false;
    $('#c-erreur').textContent = t('connexion.sans_etab');
    $('#c-erreur').hidden = false;
    return;
  }
  const memo = Number(lire('arrimo-ctx'));
  const duLien = etat.lien && etabs.some((e) => e.id === etat.lien.id) ? etat.lien.id : null;
  etat.ctx = duLien || (etabs.some((e) => e.id === memo) ? memo : (etabs.find((e) => e.module_actif) || etabs[0]).id);
  majSelecteurCtx();
  $('#ecran-connexion').hidden = true;
  $('#ecran-app').hidden = false;
  const entretien = estEntretien();
  appliquerModules();
  appliquerDisposition(disposition()); majInfosLieu(); majMeteo(true); chargerNomOg();
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
/** Modules de l'établissement courant : un module désactivé (ex. NSA pour un hôpital pédiatrique) n'a pas d'onglet. */
const MODULE_ONGLET = { urgence: 'urgence', nsa: 'nsa', nettoyage: 'nettoyage', national: 'national' };
function appliquerModules() {
  const entretien = estEntretien();
  const mods = (etabCtx() && etabCtx().modules) || {};
  document.querySelectorAll('#onglets button').forEach((b) => {
    const mod = Object.keys(MODULE_ONGLET).find((k) => MODULE_ONGLET[k] === b.dataset.v);
    b.hidden = (entretien && b.dataset.v !== 'nettoyage') || (b.dataset.v === 'admin' && !etat.moi.utilisateur.admin) || (mod && mods[mod] === false)
      || (b.dataset.v === 'patients' && !etat.moi.patients_fictifs);
  });
  const cur = document.querySelector(`#onglets button[data-v="${etat.vue}"]`);
  if (cur && cur.hidden && !entretien) { etat.vue = 'copilote'; document.querySelectorAll('.contenu > section').forEach((sec) => { sec.hidden = sec.id !== 'v-copilote'; }); }
}
const libelleAge = (g) => (g && g !== 'adulte' ? `<span class="badge age-${esc(g)}">${esc(t(`fin.age_${g}`))}</span>` : '');

$('#ctx').onchange = async (e) => {
  etat.ctx = Number(e.target.value);
  window.dispatchEvent(new Event('arrimo:session-reset'));
  etat.question = '';
  ecrire('arrimo-ctx', etat.ctx);
  etat.filtreUnite = '*';
  etat.suites = {};
  etat.recherche = { ...etat.recherche, res: null, choix: null };
  etat.reponse = '';
  appliquerModules();
  majInfosLieu(); majMeteo(true); chargerNomOg();
  await rafraichir();
};
document.querySelectorAll('#onglets button').forEach((b) => {
  b.onclick = async () => {
    ouvrirNav(false);
    if (etat.vue !== b.dataset.v) hautDePage();
    etat.vue = b.dataset.v;
    document.querySelectorAll('#onglets button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('.contenu > section').forEach((s) => { s.hidden = s.id !== `v-${etat.vue}`; });
    await rafraichir();
  };
});

const etabCtx = () => etat.moi.etablissements.find((e) => e.id === etat.ctx);
const configCtx = () => (etabCtx() ? etat.moi.configs.find((c) => c.id === etabCtx().config_id) : etat.moi.configs[0]);

let enCours = false;
// Une demande de rendu pendant un rendu en cours (clic rapide après une action) n'est pas perdue : elle est rejouée ensuite.
let rafraichirEnAttente = false;
async function rafraichir() {
  if (!etat.token || !etat.moi) return;
  if (enCours) { rafraichirEnAttente = true; return; }
  enCours = true;
  try {
    const e = etabCtx();
    const bandeau = $('#bandeau');
    bandeau.hidden = !e || e.module_actif;
    bandeau.innerHTML = !e || e.module_actif ? '' : `<div>${t('barre.bandeau_inactif', { etab: esc(e.nom) })}</div>`;
    await Promise.all([e ? majCompteurs() : null, ({
      copilote: vueCopilote, reseau: vueReseau, national: vueNational, lits: vueLits, urgence: vueUrgence, admissions: vueAdmissions, transferts: vueTransferts,
      nettoyage: vueNettoyage, vigilance: vueVigilance, nsa: vueNsa, indicateurs: vueIndicateurs, journal: vueJournal, params: vueParams,
      admin: vueAdmin, compte: vueCompte, support:vueSupportClient, patients: vuePatients,
    })[etat.vue]()]);
    poserMenuParametres();
    majInfosLieu();
    if (!$('#panneau-aide').hidden) afficherAide();
  } catch (err) {
    if (etat.token) toast(err.message, true);
  } finally {
    enCours = false;
    if (rafraichirEnAttente) { rafraichirEnAttente = false; rafraichir(); }
  }
}
// Rafraîchissement automatique des écrans opérationnels seulement : les formulaires (paramètres, compte, administration)
// ne sont jamais redessinés pendant une saisie, sinon les modifications en cours seraient effacées.
const VUES_FORMULAIRES = ['params', 'compte', 'admin', 'patients'];
setInterval(() => {
  if ($('#modale').hidden && document.visibilityState === 'visible' && !VUES_FORMULAIRES.includes(etat.vue) && !etat.ogModifie
    && !$('#v-support').contains(document.activeElement)) rafraichir();
}, 30000);

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

/** Lits du même type écartés par la recherche, avec la raison (groupe d'âge, équipement ou isolement). */
function exclusionsHTML(x) {
  if (!x || (!x.age && !x.besoins)) return '';
  const p = [];
  if (x.age) p.push(t('fin.exclus_age', { n: x.age }));
  if (x.besoins) p.push(t('fin.exclus_besoins', { n: x.besoins }));
  return `<div class="note">${esc(t('fin.exclus', { liste: p.join(' · ') }))}</div>`;
}

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
      return `<div class="item${choisi ? ' choisi' : ''}"><div><strong>${esc(s.nom)}</strong>${s.recommande ? ` <span class="badge fort">${esc(t('reseau.recommande'))}</span>` : ''}${!s.libres_confirmes ? ` <span class="badge">${esc(t('reseau.prevision_seulement'))}</span>` : ''}
        <div class="note">${esc(s.ville)}${s.partage === 'agrege' ? esc(t('reseau.lit_par_receveur')) : s.lit ? esc(t('reseau.lit_code', { code: s.lit.code })) : ''}</div>
        <span class="badge">${esc(t(`reseau.confirmation_${s.confirmation.statut}`))}${s.confirmation.confirme_le ? ` · ${esc(heureCourte(s.confirmation.confirme_le))}` : ''}</span>
        <div class="note num">${esc(s.raison)}${s.statut_route === 'calcule' ? ` · ${esc(t('reseau.route_actualisee', { heure: heureCourte(s.confirmation.route_actualise_le) }))}` : ''}</div>${s.pourquoi ? `<div class="note">${esc(s.pourquoi)}</div>` : ''}${exclusionsHTML(s.exclusions)}</div>
        ${s.libres_confirmes && s.statut_route === 'calcule' ? `<button class="btn${choisi ? ' pri' : ''}" data-choix="${s.etablissement_id}">${esc(t(choisi ? 'reseau.propose' : 'reseau.proposer'))}</button>` : ''}</div>`;
    }).join('') : `<p class="note">${esc(t('reseau.aucun_rayon', { km: cfg.rayon_km }))}</p>`;
    const suiviRoute = R.res.routage.disponible
      ? t('reseau.route_source', { source: R.res.routage.fournisseur, heure: heureCourte(R.res.routage.actualise_le) })
      : t('reseau.routeur_indisponible');
    resHTML = `<p class="note">${esc(t('reseau.chez_vous', { n: R.res.libres_ici }))}</p><p class="note">${esc(suiviRoute)} · ${esc(t('reseau.capacite_actualisee', { heure: heureCourte(R.res.capacite_verifiee_le) }))}</p><div class="liste">${resHTML}</div><div id="carte-rescue" class="carte-nat" role="region" aria-label="${esc(t('reseau.carte_recommandations'))}"></div>`;
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
      <span class="note">${esc(x.ville || '')}${!x.moi && x.distance_km != null ? ` · <span class="num">${esc(t('general.km', { n: x.distance_km }))}</span>` : ''}</span></div>
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
        <div class="ligne"><div class="champ"><label class="lbl" for="r-age">${esc(t('fin.groupe_age'))}</label><select id="r-age"><option value="">${esc(t('fin.age_selon_type'))}</option>${GROUPES_AGE.map((g) => `<option value="${g}"${R.groupe_age === g ? ' selected' : ''}>${esc(t(`fin.age_${g}`))}</option>`).join('')}</select></div></div>
        <div class="cases">${casesBesoins('data-besoin', R.besoins)}</div>
        <div class="ligne" style="justify-content:space-between"><label class="case"><input type="checkbox" id="r-urg"${R.urgent ? ' checked' : ''}> ${esc(t('reseau.urgent'))}</label><button class="btn pri" id="b-chercher">${esc(t('reseau.rechercher'))}</button></div>
        ${resHTML}${confirmHTML}</div>
      <div class="panneau-c"><div><h3>${esc(t('reseau.blocages_titre'))}</h3><p class="note">${esc(t('reseau.blocages_aide'))}</p></div><div class="liste">${blocHTML}</div></div>
    </div><div class="etabs">${etabsHTML}</div></div>`;

  $('#r-type').onchange = (ev) => { R.type_id = Number(ev.target.value); R.res = null; R.choix = null; rafraichir(); };
  $('#r-pat').oninput = (ev) => { R.patient_ref = ev.target.value.trim(); };
  $('#r-urg').onchange = (ev) => { R.urgent = ev.target.checked; };
  $('#r-age').onchange = (ev) => { R.groupe_age = ev.target.value || null; R.res = null; R.choix = null; };
  $('#b-chercher').onclick = (ev) => agir(ev.target, async () => {
    R.res = await api('GET', `/recherche?depuis=${etat.ctx}&type_id=${R.type_id}${qsBesoins(R.besoins)}${R.groupe_age ? `&groupe_age=${R.groupe_age}` : ''}`);
    R.choix = null;
  });
  v.querySelectorAll('[data-choix]').forEach((b) => { b.onclick = async () => {
    R.choix = R.res.suggestions.find((s) => s.etablissement_id === Number(b.dataset.choix));
    try { R.choix.geometrie = (await api('GET', `/itineraire?depuis=${etat.ctx}&vers=${R.choix.etablissement_id}`)).geometrie; } catch { /* Seule la ligne de carte peut manquer. */ }
    rafraichir();
  }; });
  const val = $('#b-valider');
  if (val) {
    val.onclick = () => agir(val, async () => {
      const tr = await api('POST', '/transferts', {
        origine_id: etat.ctx, destination_id: R.choix.etablissement_id, type_id: R.type_id,
        lit_id: R.choix.lit?.id, version: R.choix.lit?.version, patient_ref: R.patient_ref, urgent: R.urgent, besoins: R.besoins,
        groupe_age: R.groupe_age || undefined,
      });
      R.res = null; R.choix = null; R.patient_ref = '';
      return tr;
    }, (tr) => t('reseau.lit_bloque', { lit: tr.lit_code, numero: tr.numero }));
  }
  const an = $('#b-annuler-choix');
  if (an) an.onclick = () => { R.choix = null; rafraichir(); };
  brancherActionsLit(v);
  v.querySelectorAll('[data-besoin]').forEach((c) => { c.onchange = () => { R.besoins[c.dataset.besoin] = c.checked; R.res = null; R.choix = null; }; });
  if (R.res) dessinerCarteRescue(R.res, R.choix);
}

async function dessinerCarteRescue(resultat, choix) {
  try {
    const L = await chargerLeaflet(); const zone = $('#carte-rescue');
    if (!zone) return;
    if (carteRescue) { carteRescue.remove(); carteRescue = null; }
    carteRescue = L.map(zone, { scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 15, attribution: '&copy; OpenStreetMap' }).addTo(carteRescue);
    const bornes = [];
    const marker = (x, local = false) => {
      if (!Number.isFinite(x.latitude) || !Number.isFinite(x.longitude)) return;
      const p = [x.latitude, x.longitude]; bornes.push(p);
      const m = L.circleMarker(p, { radius: local ? 9 : 7, color: local ? '#0E5E6F' : '#fff', weight: 2,
        fillColor: local ? '#0E5E6F' : COULEURS_NIVEAU[x.niveau] || '#64748b', fillOpacity: 0.95 }).addTo(carteRescue);
      const route = x.minutes_route == null ? t('reseau.route_indisponible') : t('reseau.route_popup', { km: x.distance_km, duree: duree(x.minutes_route) });
      const libre = local ? '' : t('reseau.capacite_popup', { n: x.libres });
      m.bindPopup(`<strong>${esc(x.nom)}</strong><br>${esc(local ? t('reseau.origine_carte') : route)}<br>${esc(libre)}${local ? '' : `<br>${esc(t(`niveaux.${x.niveau}`))}`}`);
    };
    marker(resultat.origine, true); resultat.suggestions.forEach((x) => marker(x));
    if (choix?.geometrie) L.geoJSON(choix.geometrie, { style: { color: '#087e8b', weight: 5, opacity: 0.8 } }).addTo(carteRescue);
    if (bornes.length) carteRescue.fitBounds(bornes, { padding: [24, 24], maxZoom: 11 });
  } catch { toast(t('national.carte_indisponible'), true); }
}

/* ---------------- Tableau national par proximité ---------------- */
etat.national = { type_id: '', max: '', besoins: {}, avec_lit: false, page: 1, carte: false };
const COULEURS_NIVEAU = { vert: '#16A34A', jaune: '#F59E0B', orange: '#D97706', rouge: '#DC2626' };
let leaflet = null; let carteNat = null; let carteRescue = null;
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
const CONGES = ['prevu', 'confirme', 'attente_transport', 'reporte'];
const GROUPES_AGE = ['adulte', 'pediatrique', 'neonatal'];
const CAT_CIVIERES = ['reguliere', 'pediatrique', 'isolement', 'fauteuil', 'debordement'];

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
  const [lits, structure] = await Promise.all([
    api('GET', `/lits?etablissement_id=${etat.ctx}`),
    api('GET', `/structure?etablissement_id=${etat.ctx}`),
  ]);
  const actif = etabCtx().module_actif;
  const unites = [...new Map(lits.map((l) => [l.type_id, l.unite])).entries()];
  const liste = etat.filtreUnite === '*' ? lits : lits.filter((l) => l.type_id === Number(etat.filtreUnite));
  const cols = ORDRE_ETATS.map((st) => {
    const items = liste.filter((l) => l.etat === st);
    return `<div class="col e-${st}"><h3>${esc(t(`etats.${st}`))} <span class="num">${items.length}</span></h3>${items.map((l) => `<div class="fiche e-${st}">
      <div class="t"><b>${esc(l.code)}</b><span class="note num" title="${esc(t('lits.depuis_titre'))}">${depuis(l.etat_depuis)}</span></div>
      <div class="note">${esc(t('lits.chambre', { unite: l.unite, ch: l.chambre }))}</div>
      ${l.etat === 'libre' ? `<div class="note"><span class="badge">${esc(t(`reseau.confirmation_${l.disponibilite_confirmation}`))}</span>${l.disponibilite_confirmee_le ? ` · ${esc(heure(l.disponibilite_confirmee_le))}${l.disponibilite_confirmee_par ? ` · ${esc(l.disponibilite_confirmee_par)}` : ''} · ${esc(t('lits.confirmation_validite', { min: l.confirmation_lit_validite_min }))}` : ''}</div>` : ''}
      ${l.patient_ref ? `<div class="note">${t('lits.patient', { ref: esc(l.patient_ref) })}${l.patient_nom_court ? ` · ${esc(l.patient_nom_court)}` : ''}${l.transfert_numero ? ` · ${esc(l.transfert_numero)}` : ''}</div>` : ''}
      ${libelleAge(l.groupe_age)}${attributs(l)}
      ${l.nsa_depuis ? `<div><span class="nsa-tag">${esc(t('lits.nsa_tag', { depuis: depuis(l.nsa_depuis), orient: l.nsa_orientation ? t(`orientations.${l.nsa_orientation}`) : '' }))}</span></div>` : ''}
      ${l.sortie_prevue ? `<div class="note">${esc(t('lits.conge', { statut: t(`conges.${l.conge_statut || 'prevu'}`).toLowerCase(), heure: heure(l.sortie_prevue) }))}</div>` : ''}
      ${l.motif_indispo ? `<div class="note">${esc(t('lits.motif', { motif: t(`motifs.${l.motif_indispo}`) }))}</div>` : ''}
      ${l.blocage_motif ? `<div class="alerte">${esc(l.blocage_motif)}</div>` : ''}
      ${actif ? `<div class="actions">${ACTIONS[st].map(([a, p]) => (a === 'nsa' && l.nsa_depuis ? ['retirer_nsa', false] : [a, p])).map(([a, p]) => `<button class="btn${p ? ' pri' : ''}" data-lit="${l.id}" data-action="${a}" data-version="${l.version}" data-code="${esc(l.code)}">${esc(t(`actions_lit.${a}`))}</button>`).join('')}${l.etat === 'libre' && !estEntretien() ? `<button class="btn" data-confirmer-libre="${l.id}" data-code="${esc(l.code)}">${esc(t('reseau.confirmer_disponibilite'))}</button>` : ''}</div>` : ''}
    </div>`).join('') || `<div class="vide">${esc(t('lits.aucun'))}</div>`}</div>`;
  }).join('');
  const parUnite = structure.unites.map((u) => {
    const dep = structure.departements.find((x) => x.id === u.departement_id);
    const serv = structure.services.find((x) => x.id === u.service_id);
    const etages = structure.etages.filter((x) => x.unite_id === u.id);
    const chambres = structure.chambres.filter((x) => x.unite_id === u.id);
    const nbChambres=structure.chambres.filter(x=>x.unite_id===u.id&&x.actif).length, nbLits=structure.lits.filter(x=>x.unite_id===u.id&&x.actif).length;
    return `<details class="panneau-c structure-resume"><summary><strong>${esc(u.nom)}</strong> · ${esc(u.type_nom)} · ${nbChambres} ${nbChambres===1?'chambre':'chambres'} · ${nbLits} ${nbLits===1?'lit':'lits'}${u.actif?'':' · inactif'}</summary>
      <p class="note">${dep ? `Département : ${esc(dep.nom)} · ` : ''}${serv ? `Service : ${esc(serv.nom)}` : ''}</p>
      ${chambres.map(ch => `<div class="item"><div><strong>Chambre ${esc(ch.numero)}</strong><div class="note">${esc(ch.type_chambre||'Type non précisé')} · ${ch.lits_calcules}${ch.capacite_declaree?` / ${ch.capacite_declaree}`:''} lits · ${esc(ch.statut_operationnel)}${ch.accessible?' · accessible':''}${!ch.actif?' · inactive':''}${ch.etage_id?` · ${esc(etages.find(x=>x.id===ch.etage_id)?.nom||'')}`:''}</div>
        ${ch.attributs&&Object.keys(ch.attributs).length?`<div class="note">Attributs : ${esc(JSON.stringify(ch.attributs))}</div>`:''}
        <div class="chips">${structure.lits.filter(l=>l.chambre_id===ch.id).map(l=>`<span class="chip num">${esc(l.code)} · ${esc(t(`etats.${l.etat}`))}${l.categorie?` · ${esc(l.categorie)}`:''}${l.disponibilite_confirmee_le?` · confirmé ${esc(heure(l.disponibilite_confirmee_le))}`:''}${!l.actif?' · inactif':''}</span>`).join('')||'<span class="note">Aucun lit</span>'}</div></div></div>`).join('')||'<p class="note">Aucune chambre configurée.</p>'}
      ${etages.length?`<p class="note">Étages / ailes : ${etages.map(x=>`${esc(x.nom)}${x.aile?` (${esc(x.aile)})`:''}${x.actif?'':' · inactif'}`).join(' · ')}</p>`:''}
      ${structure.civieres.filter(c=>c.unite_id===u.id).length?`<p class="note">Civières : ${structure.civieres.filter(c=>c.unite_id===u.id).map(c=>`${esc(c.code)} · ${esc(t(`etats.${c.etat}`))}${c.actif?'':' · inactive'}`).join(' · ')}</p>`:''}</details>`;
  }).join('');
  // La hiérarchie nouvellement ajoutée est présentée ici en français; sa traduction complète n’est pas dans ce lot.
  const panneauStructure=langue==='fr'?`<details class="panneau-c" style="margin-bottom:14px"><summary>Structure de l’établissement</summary><p class="note">${t('admin.etab_courant',{etab:esc(etabCtx().nom)})} · Capacités calculées depuis les chambres, lits et civières enregistrés.</p><div class="pile">${parUnite||'<p class="vide">Aucune unité configurée.</p>'}</div></details>`:'';
  const adminStructure = etat.moi.utilisateur.admin ? `<button class="btn" data-structure-admin>Gérer la structure</button>` : '';
  v.innerHTML = `<div class="entete"><div><h2>${esc(t('lits.titre', { etab: etabCtx().nom }))}</h2><p>${esc(t('lits.intro'))}</p></div>${adminStructure}</div>
    ${panneauStructure}
    <div class="chips"><button class="chip" aria-pressed="${etat.filtreUnite === '*'}" data-u="*">${esc(t('lits.toutes_unites'))}</button>${unites.map(([id, nom]) => `<button class="chip" aria-pressed="${String(etat.filtreUnite) === String(id)}" data-u="${id}">${esc(nom)}</button>`).join('')}</div>
    <div class="kanban">${cols}</div>`;
  const gestion = v.querySelector('[data-structure-admin]');
  if (gestion) gestion.onclick = () => { etat.adminOnglet = 'structure'; allerA('admin'); };
  v.querySelectorAll('[data-u]').forEach((c) => { c.onclick = () => { etat.filtreUnite = c.dataset.u; rafraichir(); }; });
  v.querySelectorAll('[data-confirmer-libre]').forEach((b) => { b.onclick = () => agir(b,
    () => api('POST', `/lits/${b.dataset.confirmerLibre}/confirmer-disponibilite`), t('lits.confirmation_lit_ok', { code: b.dataset.code })); });
  brancherActionsLit(v);
}

/* ---------------- Transferts ---------------- */
function actionsTransfert(x) {
  const a = [];
  const dest = x.destination_id === etat.ctx;
  const orig = x.origine_id === etat.ctx;
  if (x.statut === 'demande' && dest) a.push(['accepter', true]);
  if (x.statut === 'demande' && orig) a.push(['relancer']);
  if (['demande', 'validee'].includes(x.statut) && dest) a.push(['refuser']);
  if (x.statut === 'validee' && orig) a.push(['transport', true]);
  if (x.statut === 'transport' && orig) a.push(['depart', true]);
  if (x.statut === 'en_route' && dest) a.push(['reception', true]);
  if (['validee', 'transport', 'en_route'].includes(x.statut) && dest && !x.date_chambre_prete) a.push(['chambre_prete', x.statut !== 'en_route']);
  return a;
}
const jourHeure = (iso) => heure(iso);
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
      <div class="note">${esc(t('transferts.trajet_estime'))} : <span class="num">${x.distance_km != null ? esc(t('general.km', { n: x.distance_km })) : '—'}</span> · ${esc(x.minutes_route != null && x.route_actualise_le ? duree(x.minutes_route) : t('transferts.trajet_non_renseigne'))}${x.transport_info ? ` · ${esc(x.transport_info)}` : ''}</div>
      <div class="note">${esc(t('transferts.age_creation'))} : ${depuis(x.date_demande)}</div>
      <div class="note">${esc(t('transferts.transport_reel'))} : ${esc(x.date_depart && x.date_reception ? new Intl.NumberFormat(locale(), {style:'unit',unit:'second',unitDisplay:'short',maximumFractionDigits:0}).format((new Date(x.date_reception)-new Date(x.date_depart))/1000) : t('transferts.transport_non_mesure'))}</div>
      ${besoinsTransfert(x) ? `<div class="note">${esc(t('transferts.besoins', { liste: besoinsTransfert(x) }))}</div>` : ''}
      ${x.statut === 'en_route' && x.arrivee_prevue ? `<div class="arrivee" data-eta="${esc(x.arrivee_prevue)}">${icone('clock')}<span><strong>${esc(t('transferts.arrivee', { heure: heureCourte(x.arrivee_prevue) }))}</strong> · <span class="decompte"></span></span></div>` : ''}
      ${['validee', 'transport', 'en_route'].includes(x.statut) ? (x.date_chambre_prete ? `<div><span class="etat-niveau n-vert">${esc(t('transferts.badge_prete'))}</span></div>`
    : x.destination_id === etat.ctx ? `<div><span class="etat-niveau n-jaune">${esc(t('transferts.a_preparer'))}</span></div>` : `<div class="note">${esc(t('transferts.chambre_en_preparation'))}</div>`) : ''}
      ${x.motif_refus ? `<div class="note">${esc(t('transferts.motif', { motif: '' }))}<span class="donnee">${esc(x.motif_refus)}</span></div>` : ''}
      ${attente(x) ? `<div class="note">${esc(attente(x))}</div>` : ''}
      ${x.statut === 'demande' ? `<div class="note">${esc(t('transferts.relances', { n: x.nombre_relances || 0 }))}${x.service_responsable ? ` · ${esc(t('transferts.service_responsable_valeur', { service: x.service_responsable }))}` : ''}</div>
        ${x.destination_id === etat.ctx ? `<div class="ligne"><input class="champ" maxlength="100" data-service-responsable="${x.id}" value="${esc(x.service_responsable || '')}" placeholder="${esc(t('transferts.service_responsable'))}"><button class="btn" data-enregistrer-responsable="${x.id}" data-num="${esc(x.numero)}">${esc(t('transferts.enregistrer_responsable'))}</button></div>` : ''}` : ''}
      ${actif ? `<div class="actions">${actionsTransfert(x).map(([a, p]) => `<button class="btn${p ? ' pri' : ''}${a === 'refuser' ? ' dan' : ''}" data-tr="${x.id}" data-etape="${a}" data-num="${esc(x.numero)}">${esc(t(`transferts.${a}`))}</button>`).join('')}</div>` : ''}
    </div>`).join('') || `<div class="vide">${esc(t('transferts.aucun'))}</div>`}</div>`;
  }).join('');
  v.innerHTML = `<div class="entete"><div><h2>${esc(t('transferts.titre', { etab: etabCtx().nom }))}</h2><p>${esc(t('transferts.intro'))}</p></div></div><div class="kanban">${cols}</div>${plus ? boutonPlus('transferts') : ''}`;
  brancherPlus(v, 'transferts', `/transferts?etablissement_id=${etat.ctx}`, trs.filter(termine));
  v.querySelectorAll('[data-tr]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.tr; const etape = b.dataset.etape; const numero = b.dataset.num;
      if (etape === 'relancer') {
        agir(b, () => api('POST', `/transferts/${id}/relancer`), t('transferts.relance_ok', { numero }));
        return;
      }
      if (etape === 'refuser') {
        modale(t('transferts.refuser_titre', { numero }), `<div class="champ"><label class="lbl" for="m-motif">${esc(t('transferts.motif_facultatif'))}</label><input id="m-motif" maxlength="300" autocomplete="off"></div>
          <p class="note">${esc(t('transferts.refuser_aide'))}</p>`,
        [{ label: t('general.retour') }, { label: t('transferts.refuser_bouton'), pri: true, run: async () => (await agir(null, () => api('POST', `/transferts/${id}/refuser`, { motif: $('#m-motif').value }), t('transferts.refuse_ok', { numero }))) !== null || false }]);
        return;
      }
      agir(b, () => api('POST', `/transferts/${id}/${etape}`), t({ accepter: 'transferts.accepte_ok', chambre_prete: 'transferts.chambre_prete_ok', transport: 'transferts.transport_ok', depart: 'transferts.depart_ok', reception: 'transferts.reception_ok' }[etape], { numero }));
    };
  });
  v.querySelectorAll('[data-enregistrer-responsable]').forEach((b) => { b.onclick = () => {
    const id = b.dataset.enregistrerResponsable; const champ = v.querySelector(`[data-service-responsable="${id}"]`);
    agir(b, () => api('PUT', `/transferts/${id}/responsable`, { service_responsable: champ.value }), t('transferts.responsable_ok', { numero: b.dataset.num }));
  }; });
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
/* OG par établissement : personnalisation (aperçu, voix) et fonctions, bornées par la licence SH. */
async function panneauOg(etab) {
  const zone = $('#params-og'); if (!zone || !etab) return;
  const cfg = await api('GET', `/og/configuration?etablissement_id=${etab}`);
  const admin = cfg.modifiable === true;
  const O = (k, v) => esc(t(`ogperso.${k}`, v)); const A = window.ArrimoOgAvatar;
  const choix = { modele: ['robot', 'symbole', 'humain'], style: ['professionnel', 'moderne', 'amical'], tenue: ['blouse', 'veste', 'polo'], accessoire: ['aucun', 'lunettes', 'casque'] };
  const couleurs = ['#0E5E6F', '#159895', '#1E3A5F', '#3B4A6B', '#2F6F5E'], peaux = ['#F5D6BE', '#E0AC86', '#C68642', '#8D5524', '#5C3A21'];
  const prefixe = { modele: 'm', style: 's', tenue: 't', accessoire: 'a' };
  const p = cfg.personnalisation, dis = admin ? '' : ' disabled';
  const select = (cle, valeurs, actuelle, lib) => `<div class="champ"><label class="lbl" for="og-${cle}">${O(cle)}</label><select id="og-${cle}"${dis}>${valeurs.map((v, i) => `<option value="${esc(v)}"${v === actuelle ? ' selected' : ''}>${esc(lib(v, i))}</option>`).join('')}</select></div>`;
  zone.innerHTML = `<div class="panneau-c"><h3>${O('titre')}</h3><p class="note">${O('intro')}</p>
    <div class="og-perso"><div class="og-apercu" id="og-apercu" aria-hidden="true"></div><div class="og-perso-champs">
      <div class="champ"><label class="lbl" for="og-nom">${O('nom')}</label><input id="og-nom" maxlength="30" value="${esc(p.nom)}"${dis}></div>
      ${Object.entries(choix).map(([cle, vals]) => select(cle, vals, p.avatar[cle], (v) => t(`ogperso.${prefixe[cle]}_${v}`))).join('')}
      ${select('couleur', couleurs, p.avatar.couleur, (v, i) => t('ogperso.couleur_n', { n: i + 1 }))}${select('peau', peaux, p.avatar.peau, (v, i) => t('ogperso.peau_n', { n: i + 1 }))}
      ${select('voix', ['feminine', 'masculine'], p.voix, (v) => t(`ogperso.v_${v}`))}${select('langue', ['fr', 'en'], p.langue, (v) => dicoDe(v).langue?.nom || v)}
      <div class="champ"><label class="lbl" for="og-accueil">${O('accueil')}</label><input id="og-accueil" maxlength="200" value="${esc(p.accueil)}"${dis}></div></div></div>
    <h4>${O('fonctions')}</h4><div class="og-fonctions">${Object.keys(cfg.licence).map((f) => `<label class="case"><input type="checkbox" data-og-fonction="${f}"${cfg.effectif[f] ? ' checked' : ''}${admin && cfg.licence[f] ? '' : ' disabled'}> ${O(`f_${f}`)}${cfg.licence[f] ? '' : ` <span class="note">(${O('hors_licence')})</span>`}</label>`).join('')}</div>
    <div class="ligne serre"><button class="btn" type="button" id="og-tester">${O('tester')}</button>${admin ? `<button class="btn" type="button" id="og-reinit">${O('reinitialiser')}</button><button class="btn pri" type="button" id="og-enregistrer">${O('enregistrer')}</button>` : ''}</div>
    ${admin ? `<p class="note" id="og-etat" role="status" aria-live="polite"></p>` : `<p class="note">${O('lecture_seule')}</p>`}</div>`;
  etat.ogModifie = false;
  const marquer = (m) => { etat.ogModifie = m; const e = $('#og-etat'); if (e) e.textContent = m ? t('ogperso.non_enregistre') : ''; };
  if (admin) { zone.addEventListener('input', () => marquer(true)); zone.addEventListener('change', () => marquer(true)); }
  const lireAvatar = () => ({ modele: $('#og-modele').value, style: $('#og-style').value, couleur: $('#og-couleur').value, peau: $('#og-peau').value, tenue: $('#og-tenue').value, accessoire: $('#og-accessoire').value });
  const apercu = () => { $('#og-apercu').innerHTML = A ? A.svg(lireAvatar(), 96) : ''; };
  zone.querySelectorAll('select').forEach((s) => { s.onchange = apercu; }); apercu();
  $('#og-tester').onclick = () => essayerVoix($('#og-langue').value, $('#og-voix').value, nomPropre($('#og-nom').value));
  const reinit = $('#og-reinit'); if (reinit) reinit.onclick = () => {
    $('#og-nom').value = 'OG'; $('#og-modele').value = 'robot'; $('#og-style').value = 'professionnel'; $('#og-couleur').value = '#0E5E6F'; $('#og-peau').value = '#C68642';
    $('#og-tenue').value = 'blouse'; $('#og-accessoire').value = 'aucun'; $('#og-accueil').value = ''; apercu(); marquer(true);
  };
  const enr = $('#og-enregistrer'); if (enr) enr.onclick = () => agir(enr, async () => {
    const fonctions = Object.fromEntries([...zone.querySelectorAll('[data-og-fonction]:not(:disabled)')].map((c) => [c.dataset.ogFonction, c.checked]));
    await api('PUT', '/og/configuration', { etablissement_id: etab, fonctions, personnalisation: { nom: $('#og-nom').value.trim(), voix: $('#og-voix').value, langue: $('#og-langue').value, accueil: $('#og-accueil').value, avatar: lireAvatar() } });
    marquer(false);
    window.dispatchEvent(new Event('arrimo:og-configuration'));
  }, t('ogperso.enregistre'));
}
/* ---------------- Centre de paramètres : menu secondaire commun aux vues de gestion ---------------- */
// Chaque entrée n'apparaît que si l'utilisateur a accès à la vue correspondante (mêmes règles que la barre principale).
const VUES_GESTION = ['params', 'compte', 'admin', 'support', 'journal'];
function entreesParametres() {
  const accessible = (v) => { const b = document.querySelector(`#onglets button[data-v="${v}"]`); return b && !b.hidden; };
  return [['compte', 'compte'], ['params:apparence', 'apparence'], ['params:etablissement', 'etablissement'], ['params:og', 'og'],
    ['params:notifications', 'notifications'], ...(accessible('admin') ? [['admin', 'personnel']] : []),
    ...(accessible('support') ? [['support', 'support']] : []), ...(accessible('journal') ? [['journal', 'journal']] : [])];
}
function menuParametres(actif) {
  return `<nav class="params-nav" aria-label="${esc(t('params.titre'))}">${entreesParametres().map(([cible, cle]) =>
    `<button type="button" class="btn${cible === actif ? ' actif' : ''}" data-param-nav="${cible}"${cible === actif ? ' aria-current="page"' : ''}>${esc(t(`params.nav_${cle}`))}</button>`).join('')}</nav>`;
}
/** Essai de voix : même choix que pendant les conversations (langue stricte, genre si disponible), avec un message clair sinon. */
function essayerVoix(langueVoix, genre, nom) {
  const V = window.ArrimoOgVocal, synthese = window.speechSynthesis;
  if (!synthese || !window.SpeechSynthesisUtterance || !V) { toast(t('ogperso.voix_indisponible'), true); return; }
  const code = langueVoix === 'en' ? 'en-CA' : 'fr-CA';
  const lancer = () => {
    const choix = V.choisirVoix(synthese.getVoices(), code, genre);
    if (!choix.voix) { toast(window.ArrimoOgVoixPrefs?.texte(langueVoix === 'en' ? 'voix_indisponible_en' : 'voix_indisponible_fr') || t('ogperso.voix_indisponible'), true); return; }
    const u = new SpeechSynthesisUtterance(tL(langueVoix, 'ogperso.essai_voix', { nom })); u.lang = choix.voix.lang || code; u.voice = choix.voix;
    u.volume = window.ArrimoOgVoixPrefs?.lire().volume ?? 1;
    synthese.cancel(); synthese.speak(u);
    toast(`${t('ogperso.voix_utilisee', { voix: choix.voix.name || code })}${choix.genreRespecte ? '' : ` ${window.ArrimoOgVoixPrefs?.texte('voix_genre') || ''}`}`);
  };
  if (synthese.getVoices().length) lancer(); else { synthese.addEventListener('voiceschanged', lancer, { once: true }); setTimeout(() => { if (!synthese.getVoices().length) toast(t('ogperso.voix_indisponible'), true); }, 1500); }
}
/** Voix : réglages personnels (autorisation, langue de conversation, lecture automatique, volume), enregistrés à chaque changement. */
function panneauVoixOg() {
  const zone = $('#params-og-voix'); const V = window.ArrimoOgVoixPrefs;
  if (!zone || !V || !V.disponible()) return;
  const p = V.lire(); const x = (k) => esc(V.texte(k));
  const opt = (v, l) => `<option value="${v}"${p.langue === v ? ' selected' : ''}>${l}</option>`;
  zone.innerHTML = `<section class="panneau-c og-voix-perso" aria-labelledby="pv-titre"><h3 id="pv-titre">${x('titre')}</h3><p class="note">${x('information')}</p>
    <label class="case"><input type="checkbox" id="pv-consentement"${p.consentement ? ' checked' : ''}> ${x('consentement')}</label>
    <div class="ligne"><div class="champ"><label class="lbl" for="pv-langue">${x('langue')}</label><select id="pv-langue" aria-describedby="pv-langue-aide">${opt('auto', x('langue_auto'))}${opt('fr', 'Français')}${opt('en', 'English')}</select><p class="note" id="pv-langue-aide">${x('langue_aide')}</p></div>
      <div class="champ"><label class="lbl" for="pv-volume">${x('volume')}</label><input type="range" id="pv-volume" min="0.2" max="1" step="0.1" value="${p.volume}"></div></div>
    <label class="case"><input type="checkbox" id="pv-automatique"${p.automatique ? ' checked' : ''}> ${x('automatique')}</label>
    <div class="ligne serre"><button type="button" class="btn" id="pv-tester">${esc(t('ogperso.tester'))}</button></div>
    <p class="note">${x('perso')}</p></section>`;
  const enregistrer = () => V.ecrire({ consentement: $('#pv-consentement').checked, langue: $('#pv-langue').value, automatique: $('#pv-automatique').checked });
  ['#pv-consentement', '#pv-langue', '#pv-automatique'].forEach((id) => { $(id).onchange = enregistrer; });
  $('#pv-volume').onchange = () => { V.ecrire({ volume: Number($('#pv-volume').value) }); toast(V.texte('enregistre')); };
  $('#pv-tester').onclick = () => essayerVoix(V.langueConversation(), window.ArrimoOgVoix || 'feminine', nomAssistant);
}
window.addEventListener('arrimo:ouvrir-parametres', (e) => ouvrirParametre(e.detail || 'params'));
function ouvrirParametre(cible) {
  const [vue, section] = cible.split(':');
  if ((vue !== etat.vue || (section && section !== etat.paramsSection)) && !quitterSansEnregistrer()) return;
  if (section) etat.paramsSection = section;
  allerA(vue);
}
/** Ajoute le menu en tête des vues de gestion, après leur rendu. */
function poserMenuParametres() {
  if (!VUES_GESTION.includes(etat.vue)) return;
  const v = $(`#v-${etat.vue}`); if (!v) return;
  if (etat.vue !== 'params' && !v.querySelector(':scope > .params-nav')) v.insertAdjacentHTML('afterbegin', menuParametres(etat.vue));
  v.querySelectorAll('[data-param-nav]').forEach((b) => { b.onclick = () => ouvrirParametre(b.dataset.paramNav); });
}

async function vueParams() {
  const cfg = configCtx();
  const gest = etat.moi.utilisateur.role === 'gestionnaire';
  const etabs = etat.moi.etablissements.filter((e) => e.config_id === cfg.id);
  const P = (k, vars) => esc(t(`params.${k}`, vars));
  const section = ['etablissement', 'og', 'apparence', 'notifications'].includes(etat.paramsSection) ? etat.paramsSection : 'etablissement';
  const e0 = etabCtx(); const u = etat.moi.utilisateur;
  let corps;
  if (section === 'apparence') {
    corps = `<div class="grille"><div class="panneau-c"><h3>${P('apparence_titre')}</h3><p class="note">${P('apparence_aide')}</p>
      <fieldset class="choix-apparence"><legend class="lbl">${esc(t('apparence.choisir'))}</legend>${['clair', 'sombre', 'automatique', 'soleil'].map((m) =>
        `<label class="case"><input type="radio" name="p-apparence" value="${m}"${(u.apparence || 'automatique') === m ? ' checked' : ''}> ${esc(t(`apparence.${m}`))}</label>`).join('')}</fieldset></div>
      <div class="panneau-c"><h3>${esc(t('disposition.titre'))}</h3><p class="note">${esc(t('disposition.aide'))}</p>
        <fieldset class="choix-apparence"><legend class="lbl">${esc(t('disposition.titre'))}</legend>${DISPOSITIONS.map((d) =>
          `<label class="case"><input type="radio" name="p-disposition" value="${d}"${disposition() === d ? ' checked' : ''}> ${esc(t(`disposition.${d}`))}</label>`).join('')}</fieldset></div>
      <div class="panneau-c"><h3>${esc(t('langue.choisir'))}</h3><p class="note">${P('langue_aide')}</p><select class="choix-langue" id="p-langue" aria-label="${esc(t('langue.choisir'))}"></select></div></div>`;
  } else if (section === 'notifications') {
    corps = `<div class="grille"><div class="panneau-c"><h3>${P('alertes_titre')}</h3><p class="note">${P('alertes_aide')}</p>
      ${u.admin ? `<div class="ligne"><div class="champ"><label class="lbl" for="p-rayon">${P('alertes_rayon')}</label>
        <input id="p-rayon" type="number" min="1" max="200" inputmode="numeric" value="${e0.rayon_alerte_km}"></div><button class="btn" id="b-rayon">${esc(t('general.enregistrer'))}</button></div>`
      : `<p>${P('alertes_valeur', { km: e0.rayon_alerte_km })}</p>`}</div>
      <div class="panneau-c"><h3>${P('notif_titre')}</h3><p class="note">${P('notif_aide')}</p><button class="btn" type="button" id="p-voir-notifs">${P('notif_ouvrir')}</button></div>
      <div class="panneau-c"><h3>${P('seuils_titre')}</h3><p class="note">${P('seuils_aide')}</p><dl>
        <dt>${P('seuil_occupation')}</dt><dd class="num">${esc([cfg.seuil_jaune, cfg.seuil_orange, cfg.seuil_rouge].map((x) => pct(x)).join(' · '))}</dd>
        <dt>${P('seuil_civieres')}</dt><dd class="num">${esc([cfg.seuil_civieres_jaune, cfg.seuil_civieres_orange, cfg.seuil_civieres_rouge].map((x) => pct(x)).join(' · '))}</dd>
        <dt>${P('seuil_relance')}</dt><dd>${P('seuil_relance_val')}</dd></dl></div></div>`;
  } else if (section === 'og') {
    corps = '<div id="params-og"></div><div id="params-og-voix"></div>';
  } else {
    const st = await api('GET', `/structure?etablissement_id=${etat.ctx}`).catch(() => null);
    const nbActifs = (l) => (l || []).filter((x) => x.actif !== false).length;
    const coord = e0.latitude != null && e0.longitude != null ? `${Number(e0.latitude).toFixed(3)}, ${Number(e0.longitude).toFixed(3)}` : '—';
    corps = `<h3 class="titre-section">${P('administratif')}</h3><div class="grille">
      <div class="panneau-c"><h3>${P('identite')}</h3><dl><dt>${P('nom')}</dt><dd>${esc(e0.nom)}</dd><dt>${P('code')}</dt><dd>${esc(e0.code)}</dd>
        <dt>${P('module')}</dt><dd>${P(e0.module_actif ? 'module_active' : 'module_desactive')}</dd></dl></div>
      <div class="panneau-c"><h3>${P('localisation')}</h3><dl><dt>${P('ville')}</dt><dd>${esc(e0.ville || '—')}</dd><dt>${P('coordonnees')}</dt><dd class="num">${esc(coord)}</dd>
        <dt>${P('fuseau')}</dt><dd>${esc(cfg.fuseau || '—')}</dd><dt>${P('reseau')}</dt><dd>${esc(cfg.nom)}</dd></dl></div></div>
      <h3 class="titre-section">${P('operationnel')}</h3><div class="grille">
      <div class="panneau-c"><h3>${P('structure_titre')}</h3>${st ? `<dl class="compteurs">${[['departements', st.departements], ['services', st.services], ['unites', st.unites], ['chambres', st.chambres], ['lits', st.lits], ['civieres', st.civieres]]
        .map(([k, l]) => `<dt>${P(`s_${k}`)}</dt><dd class="num">${nb(nbActifs(l))}</dd>`).join('')}</dl>` : ''}
        <p class="note">${P('structure_aide')}</p>${u.admin ? `<button class="btn" type="button" data-param-nav="admin">${P('structure_gerer')}</button>` : ''}</div>
      <div class="panneau-c"><h3>${P('cycle')}</h3><div class="cycle">${['libre', 'reserve', 'occupe', 'nettoyage', 'libre'].map((k) => `<span class="pill f-${k}">${esc(t(`etats.${k}`))}</span>`).join('→')}</div>
        <p class="note">${P('cycle_aide')}</p></div>
      <div class="panneau-c"><h3>${P('etablissements')}</h3><div>${etabs.map((e) => `<div class="reglage"><div><div>${esc(e.nom)}</div><div class="note">${esc(t(`partage.${e.partage}`))} · ${P(e.module_actif ? 'module_active' : 'module_desactive')}</div></div>
        ${gest ? `<div class="ligne"><select data-partage="${e.id}" aria-label="${P('partage')}">${options('partage', ['complet', 'agrege', 'aucun'], e.partage)}</select>
        <button class="btn${e.module_actif ? '' : ' pri'}" data-activer="${e.id}" data-val="${!e.module_actif}">${P(e.module_actif ? 'desactiver' : 'activer')}</button></div>` : ''}</div>`).join('')}</div>
        <p class="note">${P(gest ? 'note_gest' : 'note')}</p></div></div>
      ${u.admin ? `<details class="panneau-c params-avance"><summary>${P('avance')}</summary><h3>${P('configuration', { nom: '' })}<span class="donnee">${esc(cfg.nom)}</span></h3><dl>
        <dt>${P('types')}</dt><dd>${cfg.types.map((ty) => esc(nomType(ty))).join(', ')}</dd>
        <dt>${P('rayon')}</dt><dd class="num">${esc(t('general.km', { n: cfg.rayon_km }))}</dd>
        <dt>${P('horizon')}</dt><dd class="num">${esc(duree(cfg.horizon_h * 60))}</dd>
        <dt>${P('nettoyage_cible')}</dt><dd class="num">${esc(duree(cfg.nettoyage_cible_min))}</dd>
        <dt>${P('reservation')}</dt><dd class="num">${P('reservation_val', { duree: duree(cfg.reservation_max_min) })}</dd>
        <dt>${P('conge_depasse')}</dt><dd class="num">${P('conge_val', { duree: duree(cfg.marge_conge_min) })}</dd>
        <dt>${P('hors_service')}</dt><dd class="num">${P('hs_val', { duree: duree(cfg.hors_service_max_h * 60) })}</dd>
        <dt>${P('reference')}</dt><dd>${P('reference_val', { ex: cfg.reference_exemple })}</dd>
        <dt>${P('transport')}</dt><dd>${esc(cfg.transport_libelle)}</dd></dl></details>` : ''}`;
  }
  $('#v-params').innerHTML = `<div class="entete"><div><h2>${P('titre')}</h2><p>${P('intro')}</p></div></div>${menuParametres('params:' + section)}<div id="params-corps">${corps}</div>`;
  poserMenuParametres();
  const recharger = async () => { etat.moi = await api('GET', '/moi'); };
  if (section === 'og') { await panneauOg(etat.ctx); panneauVoixOg(); }
  if (section === 'apparence') {
    const sel = $('#p-langue');
    sel.innerHTML = LANGUES.map((l) => `<option value="${l}">${esc(dicoDe(l).langue?.court || l.toUpperCase())} · ${esc(dicoDe(l).langue?.nom || l)}</option>`).join('');
    sel.value = langue; sel.onchange = () => changerLangue(sel.value);
    document.querySelectorAll('input[name="p-apparence"]').forEach((r) => { r.onchange = () => choisirApparence(r.value); });
    document.querySelectorAll('input[name="p-disposition"]').forEach((r) => { r.onchange = () => choisirDisposition(r.value); });
  }
  if (section === 'notifications') { const n = $('#p-voir-notifs'); if (n) n.onclick = () => $('#b-notif').click(); }
  const br = $('#b-rayon');
  if (br) br.onclick = () => agir(br, async () => { await api('PUT', `/admin/etablissements/${etat.ctx}/rayon-alerte`, { rayon_alerte_km: Number($('#p-rayon').value) }); await recharger(); }, t('params.alertes_ok'));
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
  if (a.type === 'plan_b') {
    agir(bouton, async () => {
      const r = await api('GET', `/transferts/${a.transfert_id}/alternatives`);
      Object.assign(etat.recherche, { type_id: r.type_id, patient_ref: r.patient_ref, urgent: r.urgent,
        besoins: r.besoins, groupe_age: r.groupe_age || null, res: r, choix: null });
      return r;
    }, t('reseau.plan_b_carte')).then((r) => { if (r) allerA('reseau'); });   // ouvre l'écran Réseau sur les alternatives
    return;
  }
  if (a.type === 'recherche_reseau') {
    agir(bouton, async () => {
      const r = await api('GET', `/recherche?depuis=${etat.ctx}&type_id=${a.type_id}${qsBesoins(a.besoins || {})}${a.groupe_age ? `&groupe_age=${encodeURIComponent(a.groupe_age)}` : ''}`);
      Object.assign(etat.recherche, { type_id: a.type_id, patient_ref: a.patient_ref, urgent: !!a.urgent,
        besoins: a.besoins || {}, groupe_age: a.groupe_age || null, res: r, choix: null });
      return r;
    }, t('reseau.recherche_actualisee')).then((r) => { if (r) allerA('reseau'); });
    return;
  }
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
  modale(t('general.confirmer'), `<p>${esc(a.libelle || t(messages[a.type] || 'general.fait'))}</p><p class="note">${esc(t('priorites_ui.confirmation_og'))}</p>`,
    [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true,
      run: async () => (await agir(null, faire, t(messages[a.type] || 'general.fait'))) !== null || false }]);
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
  const plans = b.plans_coordination || [];
  const planHTML = plans.map((p) => `<article class="plan-coordination"><div class="plan-coordination-tete"><strong>${C('plan_demande', { type: p.type_unite, attente: p.attente_min })}</strong><span class="note">${C('plan_actualise', { heure: new Date(p.genere_le).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', timeZone: fuseau() }) })}</span></div>
    ${p.alternatives.length ? `<div class="liste">${p.alternatives.slice(0, 5).map((x) => `<div class="plan-option"><div class="plan-option-tete"><strong>${esc(x.etablissement)}</strong><span class="badge ${x.capacites.lits_confirmes ? 'fort' : ''}">${esc(x.etat)}</span></div>
      <p class="note">${C('plan_capacites', { confirmes: x.capacites.lits_confirmes, non_confirmes: x.capacites.libres_non_confirmes, perimes: x.capacites.libres_perimes, prevus: x.capacites.prevus })}</p>
      <p class="note">${x.trajet.statut === 'calcule' ? C('plan_route', { km: x.trajet.distance_km, minutes: x.trajet.duree_min, fournisseur: x.trajet.fournisseur }) : C('plan_route_indisponible')}</p>
      <p class="note">${C('plan_pression', { actuelle: x.saturation.pression, apres: x.saturation.simulation.pression_apres_reservation })} · ${C('plan_concurrence', { admissions: x.demandes_admission_en_attente ?? '—', transferts: x.transferts_a_repondre ?? '—' })}</p>
      ${x.capacites.nettoyage != null ? `<p class="note">${C('plan_nettoyage', { n: x.capacites.nettoyage })}</p>` : ''}
      ${x.actions.length ? `<ul class="plan-actions">${x.actions.map((a) => `<li><strong>${esc(a.libelle || a.type.replaceAll('_', ' '))}</strong> · ${esc(a.statut)} · ${esc(a.responsable)}${a.motif ? `<br><span class="note">${esc(a.motif)}</span>` : ''}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div>${p.alternatives.length > 5 ? `<p class="note">${C('plan_plus', { n: p.alternatives.length - 5 })}</p>` : ''}` : `<p class="note">${C('plan_aucune')}</p>`}
    ${p.escalade ? `<p class="plan-escalade"><strong>${C('plan_escalade')}</strong> · ${esc(p.escalade.responsable)} · ${esc(p.escalade.motif)}</p>` : ''}
    <p class="note plan-limite">${C('plan_simulation_note')}</p></article>`).join('');
  v.innerHTML = `<header class="copilote-hero">
      <div class="copilote-tete"><span class="copilote-ic"><img src="og-robot.svg" width="64" height="64" alt=""></span><div><span class="copilote-surtitre">${C('vue_operationnelle')}</span><h2>${C('titre', { etab: b.etablissement })}</h2><p>${C('hero_description')}</p></div></div>
      <span class="copilote-heure">${icone('clock')}${C('mis_a_jour', { heure: new Date(b.genere_le).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', timeZone: fuseau() }) })}</span>
    </header>
    <section class="niveau n-${b.alerte.niveau} alerte-copilote" aria-label="${C('niveau', { niveau: t(`niveaux.${b.alerte.niveau}`) })}">
      <span class="alerte-icone" aria-hidden="true">${icone('siren')}</span><div class="alerte-contenu"><span class="pastille-niveau">${C('niveau', { niveau: t(`niveaux.${b.alerte.niveau}`) })}</span><p class="alerte-resume">${esc(b.resume)}</p><p class="note alerte-protocole">${C('protocole', { texte: b.alerte.protocole })}</p></div>
    </section>
    ${vueEnsemble(b.vue, b.alerte)}
    <div class="deux copilote-colonnes"><div class="pile">
      <div class="panneau-c panneau-recommandations"><div class="panneau-tete"><span class="panneau-icone">${icone('clipboard-list')}</span><div><span class="panneau-surtitre">${C('priorites_equipe')}</span><h3>${C('recommandations', { n: b.recommandations.length })}</h3></div></div><div class="recos">${b.recommandations.length
    ? b.recommandations.slice(0, etat.toutesRecos ? undefined : 5).map((x, i) => `<div class="reco priorite-${x.priorite}">
        <span class="prio prio-${x.priorite}">${esc(t(`prios.${x.priorite}`))}</span><div><h4>${esc(x.titre)}</h4><p>${esc(x.raison)}</p>
        ${x.details ? `<details class="groupe"><summary>${C('voir_liste', { n: x.details.length })}</summary><ul class="groupe-liste">${x.details.map((d, j) => `<li><div><span>${esc(d.titre)}</span>${d.raison ? `<span class="note">${esc(d.raison)}</span>` : ''}</div>
          ${d.action ? `<button class="btn" data-reco="${i}.${j}">${esc(d.action.libelle)}</button>` : ''}</li>`).join('')}</ul></details>` : ''}</div>
        ${x.action ? `<button class="btn pri" data-reco="${i}">${esc(x.action.libelle)}</button>` : '<span></span>'}</div>`).join('')
      + (b.recommandations.length > 5 ? `<button class="btn discret" id="b-recos-plus">${C(etat.toutesRecos ? 'voir_moins' : 'voir_autres', { n: b.recommandations.length - 5 })}</button>` : '')
    : `<p class="note">${C('rien')}</p>`}</div></div>
      ${plans.length ? `<section class="panneau-c panneau-plan"><div class="panneau-tete"><span class="panneau-icone">${icone('network')}</span><div><span class="panneau-surtitre">${C('plan_titre')}</span><h3>${C('plan_intro')}</h3></div></div>${planHTML}</section>` : ''}
    </div><div class="pile">
      ${tableauPrevisions(b.previsions)}
      ${graphiqueCapacite(b)}
      <div class="panneau-c panneau-question"><div class="panneau-tete"><span class="panneau-icone">${icone('circle-help')}</span><h3>${C('question_titre')}</h3></div><p class="note question-confidentialite">${C('confidentialite_question')}</p>
        <form id="f-copilote" class="ligne"><div class="champ" style="flex:1 1 200px"><label class="lbl" for="q">${C('question')}</label><input id="q" value="${esc(etat.question)}" placeholder="${esc(exemples[0])}" autocomplete="off"></div><button class="btn pri" type="submit">${C('demander')}</button></form>
        <div class="chips">${exemples.map((x, i) => `<button class="chip" data-ex="${i}">${esc(x)}</button>`).join('')}</div>
        ${etat.reponse ? `<div class="reponse">${esc(etat.reponse)}</div><span class="mode">${C(etat.modeReponse === 'ia' ? 'mode_ia' : 'mode_local')}</span>` : ''}</div>
      <div class="panneau-c panneau-reseau"><div class="panneau-tete"><span class="panneau-icone">${icone('network')}</span><h3>${C('reseau')}</h3></div><p class="note">${C('reseau_proches', { n: Math.min(8, r.etablissements.length) })}</p><div class="liste">${r.etablissements.slice(0, 8).map((e) => `<div class="item"><div><strong>${esc(e.nom)}</strong>${e.moi ? ` <span class="badge fort">${C('vous')}</span>` : ''}
        <div class="note">${C('libres', { n: e.libres })}${e.en_attente != null ? C('en_attente', { n: e.en_attente }) : ''}${e.urgence ? C('urgence_taux', { n: pct(e.urgence.taux) }) : ''}${!e.moi && e.distance_km != null ? ` · ${esc(t('general.km', { n: e.distance_km }))}` : ''}</div></div>
        ${niveauHTML(e.niveau, ` · ${esc(pct(e.pression))}`)}</div>`).join('')}</div>
        <button class="btn discret" id="b-vers-national">${C('voir_national')}</button>
        ${r.delestages.length ? `<h3 style="margin-top:6px">${C('delestages')}</h3><div class="liste">${r.delestages.slice(0, 6).map((d) => `<div class="item"><div><strong>${esc(d.de)} → ${esc(d.vers)}</strong><div class="note">${esc(d.type)} · ${esc(d.raison)}</div></div></div>`).join('')}</div>` : ''}</div>
    </div></div>`;
  $('#b-vers-national').onclick = () => allerA('national');
  v.querySelectorAll('[data-reco]').forEach((btn) => {
    const [i, j] = btn.dataset.reco.split('.').map(Number);
    btn.onclick = () => executerProposition(j == null ? etat.recos[i].action : etat.recos[i].details[j].action, btn);
  });
  const plus = $('#b-recos-plus');
  if (plus) plus.onclick = () => { etat.toutesRecos = !etat.toutesRecos; rafraichir(); };
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
      ${c.patient_ref ? `<div class="note">${t('lits.patient', { ref: esc(c.patient_ref) })}${c.patient_nom_court ? ` · ${esc(c.patient_nom_court)}` : ''} · <span class="${classeDuree(c.heures)}">${U('depuis_h', { duree: duree(c.heures * 60) })}</span></div>${libelleAge(c.groupe_age)}` : ''}
      ${c.demande_id ? `<div class="note">${c.demande_statut === 'assignee' ? t('urgence.lit_assigne', { code: esc(c.lit_code) }) : U('demande', { type: c.type_nom, prio: c.demande_priorite_affichage })}</div><div class="note">${esc(c.demande_priorite_explication)}</div>`
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
  const boutonArrivee = actif && etat.moi.patients_fictifs ? `<button class="btn pri" id="b-arrivee"><svg class="ic" aria-hidden="true"><use href="icones.svg#i-plus"/></svg> ${esc(t('fin.arrivee'))}</button>` : '';
  v.innerHTML = `<div class="entete"><div><h2>${U('titre', { etab: etabCtx().nom })}</h2><p>${U('intro')}</p>${boutonArrivee}</div>
    <div class="legende">${['libre', 'occupee', 'nettoyage', 'indispo'].map((k) => `<span><i class="f-${k === 'occupee' ? 'occupe' : k}"></i>${esc(t(`etats.${k}`))}</span>`).join('')}</div></div>
    <div class="tuiles">
      ${tuile({ lbl: t('urgence.taux'), val: pct(stats.taux), note: U('taux_note', { occ: stats.occupees, fonc: stats.fonctionnelles }),
    etat: etatSeuil(stats.taux, cfg.seuil_civieres_jaune, cfg.seuil_civieres_rouge), cible: t('indicateurs.cible_max', { v: pct(cfg.seuil_civieres_jaune) }) })}
      ${tuile({ lbl: t('urgence.corridor'), val: nb(stats.en_corridor), note: U('corridor_note', { n: stats.libres }), etat: stats.en_corridor ? 'attention' : null })}
      ${tuile({ lbl: t('urgence.plus_24h'), val: nb(stats.plus_24h), note: U('plus_48h', { n: stats.plus_48h }), etat: stats.plus_48h ? 'critique' : stats.plus_24h ? 'attention' : null })}
      ${tuile({ lbl: t('urgence.duree'), val: duree((stats.duree_moy_h ?? 0) * 60), note: U('duree_note') })}</div>
    ${CAT_CIVIERES.map(groupe).join('')}
    <p class="note">${U('ref_seulement')}</p>`;
  const ba = $('#b-arrivee');
  if (ba) ba.onclick = () => (libres.length ? modaleArrivee(libres, cfg) : toast(t('fin.aucune_civiere'), true));
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

/** Arrivée à l'urgence (patient fictif, démonstration et recette) : identité minimale, civière, heure, demande de lit facultative. */
function modaleArrivee(libres, cfg) {
  const F = (k, vars) => esc(t(`fin.${k}`, vars));
  const maintenant = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  modale(t('fin.arrivee'), `<p class="note">${F('arrivee_aide')}</p>
    <div class="ligne"><div class="champ"><label class="lbl" for="m-prenom">${F('prenom')}</label><input id="m-prenom" autocomplete="off"></div>
    <div class="champ"><label class="lbl" for="m-nom">${F('nom')}</label><input id="m-nom" autocomplete="off"></div></div>
    <div class="ligne"><div class="champ"><label class="lbl" for="m-dn">${F('naissance')}</label><input id="m-dn" type="date"></div>
    <div class="champ"><label class="lbl" for="m-refloc">${F('ref_locale')}</label><input id="m-refloc" autocomplete="off"></div></div>
    <div class="ligne"><div class="champ"><label class="lbl" for="m-civ">${esc(t('admissions.civiere'))}</label><select id="m-civ">${libres.map((c) => `<option value="${c.id}" data-version="${c.version}">${esc(c.code)} · ${esc(t(`urgence.cat_${c.categorie}`))}</option>`).join('')}</select></div>
    <div class="champ"><label class="lbl" for="m-heure">${F('heure_arrivee')}</label><input id="m-heure" type="datetime-local" value="${maintenant}"></div></div>
    <div class="champ"><label class="lbl" for="m-dtype">${F('demande_lit')}</label><select id="m-dtype"><option value="">${F('pas_encore')}</option>${typesEtab(cfg).map((x) => `<option value="${x.id}">${esc(nomType(x))}</option>`).join('')}</select></div>
    <div class="champ"><label class="lbl" for="m-existant">${esc(t('patients.dossier_existant'))} (${esc(t('patients.reference'))})</label><input id="m-existant" autocomplete="off" placeholder="P-00000">
      <span class="note">${esc(t('patients.existant_aide'))}</span></div>
    <label class="case"><input type="checkbox" id="m-doublon"> ${F('confirmer_doublon')}</label>`,
  [{ label: t('general.annuler') }, { label: t('fin.enregistrer_arrivee'), pri: true, run: async () => {
    const o = $('#m-civ').selectedOptions[0];
    const corps = { etablissement_id: etat.ctx, civiere_id: Number(o.value), version: Number(o.dataset.version), prenom: $('#m-prenom').value, nom: $('#m-nom').value,
      date_naissance: $('#m-dn').value, reference_locale: $('#m-refloc').value || undefined, arrivee_le: $('#m-heure').value ? new Date($('#m-heure').value).toISOString() : undefined,
      confirmer_doublon: $('#m-doublon').checked, patient_reference: $('#m-existant').value.trim() || undefined };
    if ($('#m-dtype').value) corps.demande = { type_id: Number($('#m-dtype').value), priorite: 'p2' };
    return (await agir(null, () => api('POST', '/urgence/arrivees', corps), (r) => t('fin.arrivee_ok', { ref: r.patient.reference, code: r.civiere.code }))) !== null || false;
  } }]);
}

/* ---------------- Patients fictifs : recherche, vérification d'identité, historique des passages ---------------- */
// Démonstration et recette seulement (fiches fictives) ; historique administratif, aucune donnée clinique.
async function vuePatients() {
  const v = $('#v-patients');
  const P = (k, vars) => esc(t(`patients.${k}`, vars));
  const q = etat.patientsRecherche || '';
  const liste = await api('GET', `/patients?etablissement_id=${etat.ctx}&q=${encodeURIComponent(q)}`);
  v.innerHTML = `<div class="entete"><div><h2>${P('titre', { etab: etabCtx().nom })}</h2><p>${P('intro')}</p></div></div>
    <form class="ligne filtres-nsa" id="f-patients" role="search"><div class="champ"><label class="lbl" for="p-recherche">${P('rechercher')}</label>
      <input id="p-recherche" type="search" autocomplete="off" value="${esc(q)}"></div><button class="btn" type="submit">${icone('search')}${P('chercher')}</button>
      <span class="note">${P('resultats', { n: liste.length })}</span></form>
    <div class="tableau"><table><thead><tr><th>${P('reference')}</th><th>${P('identite')}</th><th>${P('naissance')}</th><th>${P('parcours')}</th><th>${P('emplacement')}</th><th></th></tr></thead>
    <tbody>${liste.map((p) => `<tr><td class="num">${esc(p.reference)}</td><td class="donnee">${esc(p.prenom)} ${esc(p.nom)}</td><td class="num">${esc(String(p.date_naissance).slice(0, 10))}</td>
      <td>${P(`parcours_${p.parcours}`)}</td><td class="num">${esc(p.lit_code || p.civiere_code || '—')}</td>
      <td><button class="btn" type="button" data-historique="${p.id}">${P('historique')}</button></td></tr>`).join('') || `<tr><td colspan="6" class="muted">${P('aucun')}</td></tr>`}</tbody></table></div>
    <div id="patient-historique"></div>`;
  $('#f-patients').onsubmit = (e) => { e.preventDefault(); etat.patientsRecherche = $('#p-recherche').value.trim(); rafraichir(); };
  v.querySelectorAll('[data-historique]').forEach((b) => {
    b.onclick = () => verifierIdentitePatient(liste.find((p) => p.id === Number(b.dataset.historique)));
  });
  if (etat.patientOuvert && liste.some((p) => p.id === etat.patientOuvert)) await afficherHistoriquePatient(etat.patientOuvert);
}
/** Étape obligatoire avant l'historique : le professionnel confirme avoir vérifié l'identité (nom, date de naissance). */
function verifierIdentitePatient(p) {
  if (!p) return;
  const P = (k, vars) => esc(t(`patients.${k}`, vars));
  modale(t('patients.verifier_titre'), `<p>${P('verifier_aide')}</p><dl class="detail-nsa"><dt>${P('identite')}</dt><dd class="donnee">${esc(p.prenom)} ${esc(p.nom)}</dd>
    <dt>${P('naissance')}</dt><dd class="num">${esc(String(p.date_naissance).slice(0, 10))}</dd><dt>${P('reference')}</dt><dd class="num">${esc(p.reference)}</dd>
    ${p.reference_locale ? `<dt>${P('ref_locale')}</dt><dd class="num">${esc(p.reference_locale)}</dd>` : ''}</dl>`,
  [{ label: t('general.annuler') }, { label: t('patients.identite_verifiee'), pri: true, run: async () => { etat.patientOuvert = p.id; await afficherHistoriquePatient(p.id); } }]);
}
async function afficherHistoriquePatient(id) {
  const zone = $('#patient-historique'); if (!zone) return;
  const P = (k, vars) => esc(t(`patients.${k}`, vars));
  let h;
  try { h = await api('GET', `/patients/${id}/historique?identite_verifiee=1`); } catch (e) { toast(e.message, true); return; }
  const evts = (pid) => [
    ...h.mouvements.filter((m) => m.passage_id === pid).map((m) => ({ d: m.date, txt: `${m.action}${m.nouvel_etat ? ` → ${t(`etats.${m.nouvel_etat}`)}` : ''}${m.emplacement ? ` · ${m.emplacement}` : ''}${m.unite ? ` (${m.unite})` : ''}` })),
    ...h.demandes.filter((d) => d.passage_id === pid).map((d) => ({ d: d.cree_le, txt: t('patients.demande_lit', { type: d.type_unite || '—', statut: t(`patients.demande_${d.statut}`) }) })),
    ...h.transferts.filter((x) => x.passage_id === pid).map((x) => ({ d: x.date_demande, txt: t('patients.transfert', { numero: x.numero, origine: x.origine, destination: x.destination, statut: t(`statuts.${x.statut}`) }) })),
  ].sort((a, b) => new Date(b.d) - new Date(a.d));
  const listeEvts = (pid) => { const l = evts(pid); return l.length ? `<ul class="evenements-nsa">${l.map((e) => `<li><span class="num">${esc(heure(e.d))}</span> · ${esc(e.txt)}</li>`).join('')}</ul>` : `<p class="muted">${P('aucun_evenement')}</p>`; };
  const passage = (x) => `<article class="panneau-c passage" data-passage="${x.id}"><div class="ligne passage-tete"><h4><span class="num">${esc(x.reference)}</span> · ${P(`type_${x.type}`)}</h4>
      <span class="badge${x.resultat === 'en_cours' ? ' fort' : ''}">${P(`resultat_${x.resultat}`)}</span></div>
    <dl class="detail-nsa"><dt>${P('etablissement')}</dt><dd>${esc(x.etablissement)}</dd><dt>${P('arrivee')}</dt><dd class="num">${esc(heure(x.arrivee_le))}</dd>
      <dt>${P('sortie')}</dt><dd class="num">${x.sortie_le ? esc(heure(x.sortie_le)) : '—'}</dd>${x.cree_par ? `<dt>${P('ouvert_par')}</dt><dd>${esc(x.cree_par)}</dd>` : ''}</dl>
    ${listeEvts(x.id)}${x.sortie_le ? '' : `<div class="ligne serre"><label class="lbl" for="c-res-${x.id}">${P('resultat')}</label><select id="c-res-${x.id}">${['sorti', 'hospitalise', 'transfere', 'annule'].map((r) => `<option value="${r}">${P(`resultat_${r}`)}</option>`).join('')}</select>
      <button class="btn" type="button" data-clore="${x.id}">${P('clore')}</button></div>`}</article>`;
  const horsPassage = evts(null);
  const maintenant = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  zone.innerHTML = `<section class="historique-patient" aria-labelledby="h-patient"><div class="entete"><div><h3 id="h-patient">${P('historique_de', { nom: `${h.patient.prenom} ${h.patient.nom}`, ref: h.patient.reference })}</h3>
      <p class="note">${P('conservation')}</p></div><button class="btn" type="button" id="b-fermer-hist">${esc(t('general.fermer'))}</button></div>
    <form class="panneau-c" id="f-passage"><h4>${P('nouveau_passage')}</h4>
      <div class="ligne filtres-nsa"><div class="champ"><label class="lbl" for="np-type">${P('type')}</label><select id="np-type">${['consultation', 'admission'].map((x) => `<option value="${x}">${P(`type_${x}`)}</option>`).join('')}</select></div>
      <div class="champ"><label class="lbl" for="np-date">${P('arrivee')}</label><input id="np-date" type="datetime-local" max="${maintenant}"><span class="note">${P('arrivee_aide')}</span></div>
      <button class="btn pri" type="submit">${P('ouvrir_passage')}</button></div><p class="note">${P('urgence_aide')}</p></form>
    <p class="note">${P('passages', { n: h.passages.length })}</p>
    ${h.passages.map(passage).join('')}
    ${horsPassage.length ? `<article class="panneau-c passage"><h4>${P('hors_passage')}</h4>${listeEvts(null)}</article>` : ''}</section>`;
  $('#b-fermer-hist').onclick = () => { etat.patientOuvert = null; zone.innerHTML = ''; };
  $('#f-passage').onsubmit = (e) => {
    e.preventDefault();
    agir(e.submitter, async () => {
      // Heure vide : c'est l'heure du serveur (« maintenant ») qui s'applique.
      const date = $('#np-date').value;
      await api('POST', `/patients/${id}/passages`, { type: $('#np-type').value, arrivee_le: date ? new Date(date).toISOString() : undefined });
    }, t('patients.passage_ouvert'));
  };
  zone.querySelectorAll('[data-clore]').forEach((b) => {
    b.onclick = () => agir(b, async () => {
      await api('POST', `/passages/${b.dataset.clore}/cloture`, { resultat: $(`#c-res-${b.dataset.clore}`).value });
    }, t('patients.passage_clos'));
  });
  zone.scrollIntoView({ block: 'start' });
}

/* ---------------- Congés et alertes : congés par lit, disponibilités prévues, blocages explicables ---------------- */
async function vueVigilance() {
  const v = $('#v-vigilance');
  const F = (k, vars) => esc(t(`fin.${k}`, vars));
  const f = etat.filtreConges || (etat.filtreConges = { horizon: '24', jour: '', unite: '', statut: '' });
  const qs = new URLSearchParams({ etablissement_id: etat.ctx, ...(f.jour ? { jour: f.jour } : f.horizon ? { horizon: f.horizon } : {}), ...(f.unite ? { unite: f.unite } : {}), ...(f.statut ? { statut: f.statut } : {}) });
  const [c, al, lits] = await Promise.all([api('GET', `/conges?${qs}`), api('GET', `/vigilance?etablissement_id=${etat.ctx}`), api('GET', `/lits?etablissement_id=${etat.ctx}`)]);
  const unites = [...new Map(lits.map((l) => [l.unite_id, l.unite])).entries()];
  const filtres = [['4', F('h4')], ['12', F('h12')], ['24', F('h24')], ['aujourdhui', F('aujourdhui')], ['demain', F('demain')]];
  const fraicheur = `<p class="note">${F('lu_a', { heure: heure(c.donnees_lues_le) })} · ${c.controle_periodique.dernier_le ? F('controle', { heure: heure(c.controle_periodique.dernier_le), min: c.controle_periodique.periode_min }) : F('controle_jamais')}${c.controle_periodique.en_retard ? ` · <span class="alerte">${F('controle_retard')}</span>` : ''}</p>`;
  const ligne = (x) => `<tr class="${x.verification ? 'retard' : ''}"><td><b class="num">${esc(x.lit)}</b></td><td>${esc(x.service || '—')}<div class="note">${esc(x.unite)}</div></td><td class="num">${esc(x.chambre)}</td>
    <td>${esc(t(`etats.${x.etat}`))}</td><td>${x.sortie_prevue ? esc(jourHeure(x.sortie_prevue)) : '—'}</td>
    <td><span class="badge${x.statut === 'confirme' ? ' fort' : ''}">${esc(t(`fin.statut_${x.statut}`))}</span>${x.verification ? `<div class="alerte">${F('verification', { duree: duree(x.retard_min) })}</div>` : ''}</td>
    <td>${x.depart_reel_le ? esc(jourHeure(x.depart_reel_le)) : '—'}</td><td>${x.nettoyage_requis ? F('oui') : F('non')}</td>
    <td>${x.disponibilite_estimee ? `${esc(heure(x.disponibilite_estimee))}<div class="note">${F('estimation')}</div>` : `<span class="note">${F('non_calculable')}</span>`}</td>
    <td class="note">${esc(t(`fin.source_${x.source}`))}<div>${esc(jourHeure(x.derniere_maj))}${x.maj_par ? ` · ${esc(x.maj_par)}` : ''}</div></td></tr>`;
  const resume = [4, 12, 24].map((h) => `<div><span class="lbl">${F('dans_h', { h })}</span><span class="gros num">${c.resume[h].confirmes + c.resume[h].prevus}</span><span class="note">${F('dont', { c: c.resume[h].confirmes, p: c.resume[h].prevus })}</span></div>`).join('');
  const couleur = { eleve: 'critique', modere: 'attention', faible: 'info' };
  const alertes = al.alertes.map((a) => `<div class="fiche alerte-vig" style="--c:var(--${couleur[a.niveau]})">
      <div class="t"><b>${esc(a.titre)}</b><span class="risque ${a.niveau}">${esc(t(`blocages_niveaux.${a.niveau}`))}</span></div>
      <div class="note">${esc(a.etablissement)} · ${esc(a.unite || '')}${a.chambre ? ` · ${F('chambre', { n: a.chambre })}` : ''} · ${F('depuis', { duree: duree(a.duree_min) })}</div>
      <dl class="explication"><dt>${F('origine')}</dt><dd>${esc(a.evenement)}${a.dernier_evenement ? ` — ${F('dernier_evt', { action: a.dernier_evenement.action, heure: jourHeure(a.dernier_evenement.date) })}` : ''}</dd>
      <dt>${F('seuil')}</dt><dd>${esc(a.seuil.regle)}</dd>
      <dt>${a.cause.nature === 'fait' ? F('fait') : F('hypothese')}</dt><dd>${esc(a.cause.texte)}</dd>
      <dt>${F('proposition')}</dt><dd>${esc(a.action)} <span class="note">(${esc(a.responsable)})</span></dd></dl></div>`).join('');
  v.innerHTML = `<div class="entete"><div><h2>${F('titre', { etab: etabCtx().nom })}</h2><p>${F('intro')}</p>${fraicheur}</div></div>
    <div class="resume">${resume}<div><span class="lbl">${F('retards')}</span><span class="gros num">${c.retards}</span><span class="note">${F('retards_note')}</span></div></div>
    <div class="panneau-c"><h3>${F('conges_titre')}</h3>
      <div class="chips">${filtres.map(([k, lib]) => `<button class="chip" aria-pressed="${(f.jour || f.horizon) === k}" data-fh="${k}">${lib}</button>`).join('')}</div>
      <div class="ligne"><div class="champ"><label class="lbl" for="vg-unite">${F('unite')}</label><select id="vg-unite"><option value="">${F('toutes')}</option>${unites.map(([id, nom]) => `<option value="${id}"${String(id) === f.unite ? ' selected' : ''}>${esc(nom)}</option>`).join('')}</select></div>
      <div class="champ"><label class="lbl" for="vg-statut">${F('statut')}</label><select id="vg-statut"><option value="">${F('tous')}</option>${['prevu', 'confirme', 'attente_transport', 'reporte', 'retard', 'realise', 'annule'].map((k) => `<option value="${k}"${f.statut === k ? ' selected' : ''}>${esc(t(`fin.statut_${k}`))}</option>`).join('')}</select></div></div>
      ${c.lignes.length ? `<div class="tableau"><table><thead><tr><th>${F('lit')}</th><th>${F('service_unite')}</th><th>${F('chambre_col')}</th><th>${F('occupation')}</th><th>${F('conge_prevu')}</th><th>${F('statut')}</th><th>${F('depart_reel')}</th><th>${F('nettoyage')}</th><th>${F('dispo_estimee')}</th><th>${F('source')}</th></tr></thead><tbody>${c.lignes.map(ligne).join('')}</tbody></table></div>`
    : `<p class="vide">${F('aucun_conge')}</p>`}
      <p class="note">${esc(c.regles.deterministe)} ${esc(c.regles.retard)} ${esc(c.regles.estimation)}</p></div>
    <div class="panneau-c"><h3>${F('alertes_titre', { n: al.alertes.length })}</h3><p class="note">${Object.values(al.regles_couleurs).map(esc).join(' ')}</p>
      <div class="pile">${alertes || `<p class="vide">${F('aucune_alerte')}</p>`}</div></div>`;
  v.querySelectorAll('[data-fh]').forEach((b) => { b.onclick = () => { const k = b.dataset.fh; if (['aujourdhui', 'demain'].includes(k)) { f.jour = k; f.horizon = ''; } else { f.horizon = k; f.jour = ''; } rafraichir(); }; });
  $('#vg-unite').onchange = (e) => { f.unite = e.target.value; rafraichir(); };
  $('#vg-statut').onchange = (e) => { f.statut = e.target.value; rafraichir(); };
  const n = $('#n-vig'); if (n) { const k = al.alertes.filter((a) => a.niveau === 'eleve').length; n.hidden = !k; n.textContent = k; }
}

/* ---------------- Copilote : vue d'ensemble et prévisions ---------------- */
function vueEnsemble(v, alerte = {}) {
  if (!v) return '';
  const C = (k, vars) => t(`copilote.${k}`, vars);
  const niveauUrgence = ['vert', 'jaune', 'orange', 'rouge'].includes(alerte.urgence?.niveau) ? alerte.urgence.niveau : null;
  const principales = [
    { id: 'lits', ic: 'bed-double', libelle: C('v_lits'), valeur: nb(v.lits.libres), note: C('v_lits_note', { occ: v.lits.occupes, net: v.lits.nettoyage, fermes: v.lits.fermes }), vedette: true },
    ...(v.civieres ? [{ id: 'urgence', ic: 'siren', libelle: C('v_civieres'), valeur: pct(v.civieres.taux), note: C('v_civieres_note', { occ: v.civieres.occupees, fonc: v.civieres.fonctionnelles, h24: v.civieres.plus_24h }), niveau: niveauUrgence }] : []),
    { id: 'attente', ic: 'hourglass', libelle: C('v_file'), valeur: nb(v.file.attente), note: C('v_file_note', { n: v.file.assignees }) },
    { id: 'transferts', ic: 'ambulance', libelle: C('v_transferts'), valeur: nb(v.transferts.entrants + v.transferts.sortants), note: C('v_transferts_note', { e: v.transferts.entrants, s: v.transferts.sortants }) },
  ];
  const secondaires = [
    { id: 'chambres', ic: 'building-2', libelle: C('v_chambres'), valeur: nb(v.chambres.libres), note: C('v_chambres_note', { n: v.chambres.total }) },
    { id: 'nsa', ic: 'users', libelle: C('v_nsa'), valeur: nb(v.nsa), note: C('v_nettoyage', { n: v.nettoyage }) },
    { id: 'proches', ic: 'map-pin', libelle: C('v_proches'), valeur: nb(v.proches.avec_place), note: C('v_proches_note', { n: v.proches.etablissements, km: v.proches.rayon_km, libres: v.proches.libres }) },
  ];
  const carte = (x) => `<div class="case-ens${x.vedette ? ' kpi-vedette' : ''}${x.niveau ? ` kpi-${x.niveau}` : ''}" data-kpi="${x.id}">
    <div class="kpi-tete"><span class="kpi-icone" aria-hidden="true">${icone(x.ic)}</span><span class="lbl">${esc(x.libelle)}</span>${x.niveau ? `<span class="kpi-niveau">${esc(t(`niveaux.${x.niveau}`))}</span>` : ''}</div>
    <span class="v">${esc(x.valeur)}</span><span class="note">${esc(x.note)}</span></div>`;
  return `<section class="ensemble" aria-label="${esc(C('vue_titre'))}"><h3 class="titre-section">${esc(C('vue_titre'))}</h3>
    <div class="ensemble-cases kpi-principaux">${principales.map(carte).join('')}</div><div class="ensemble-cases kpi-secondaires">${secondaires.map(carte).join('')}</div></section>`;
}
/** Répartition à cet instant, calculée à partir des seuls nombres autorisés du briefing. */
function graphiqueCapacite(b) {
  const C = (k, vars) => esc(t(`copilote.${k}`, vars));
  const l = b.vue?.lits; const total = b.alerte?.dotes;
  if (!l || !Number.isFinite(total) || total <= 0) return '';
  const reserves = total - l.occupes - l.libres - l.nettoyage;
  if (reserves < 0) return ''; // Ne pas dessiner un graphique incohérent pendant une mise à jour concurrente.
  const parts = [
    ['occupe', l.occupes], ['libre', l.libres], ['reserve', reserves], ['nettoyage', l.nettoyage],
  ];
  const description = parts.map(([cle, n]) => `${t(`etats.${cle}`)} : ${nb(n)}`).join(' · ');
  return `<figure class="panneau-c panneau-capacite"><figcaption class="panneau-tete"><span class="panneau-icone">${icone('bed-double')}</span><div><span class="panneau-surtitre">${C('capacite_instant')}</span><h3>${C('capacite_repartition')}</h3></div></figcaption>
    <div class="capacite-chiffre"><strong>${esc(pct(l.occupes / total * 100))}</strong><span>${C('capacite_occupation')}<small>${C('capacite_dotes', { n: total })}</small></span></div>
    <div class="capacite-barre" role="img" aria-label="${esc(description)}">${parts.filter(([, n]) => n > 0).map(([cle, n]) => `<span class="part-${cle}" style="width:${n / total * 100}%"></span>`).join('')}</div>
    <ul class="capacite-legende">${parts.map(([cle, n]) => `<li><span class="point part-${cle}" aria-hidden="true"></span><span>${esc(t(`etats.${cle}`))}</span><strong>${esc(nb(n))}</strong></li>`).join('')}</ul></figure>`;
}
function tableauPrevisions(p) {
  if (!p) return '';
  const C = (k, vars) => esc(t(`copilote.${k}`, vars));
  const cellule = (x) => (x.sature ? `<span class="etat-niveau n-rouge">${C('prev_sature')}</span>`
    : `<span class="${x.risque ? 'prev-risque' : ''}">${C('prev_libres', { n: x.libres_prevus })}</span>`) + ` <span class="note">± ${esc(nb(x.marge))}</span>`;
  return `<div class="panneau-c panneau-previsions"><div class="panneau-tete"><span class="panneau-icone">${icone('chart-column')}</span><div><span class="panneau-surtitre">${C('anticiper')}</span><h3>${C('prev_titre')}</h3></div></div><p class="note">${C('prev_intro')}</p>
    <div class="tableau prev"><table><thead><tr><th>${C('prev_unite')}</th>${p.horizons.map((h) => `<th>${C('prev_heures', { h })}</th>`).join('')}</tr></thead><tbody>
    ${p.unites.map((u) => `<tr><td>${esc(u.type_nom)}</td>${p.horizons.map((h) => `<td>${cellule(u.horizons[h])}</td>`).join('')}</tr>`).join('')}
    ${p.civieres ? `<tr><td>${C('prev_civieres')}</td>${p.horizons.map((h) => { const x = p.civieres.horizons[h]; return `<td>${C('prev_civ_val', { occ: x.occupees, taux: pct(x.taux) })} <span class="note">± ${esc(nb(x.marge))}</span></td>`; }).join('')}</tr>` : ''}
    </tbody></table></div><p class="note">${C('prev_methode', { s: p.semaines })}</p></div>`;
}

/* ---------------- Admissions ---------------- */
/* Alternatives du réseau (demandes sans lit local) : dernier résultat gardé par établissement pour un affichage
   immédiat lors des rafraîchissements, puis actualisé (le serveur limite et met en cache les recherches). */
function alternativesConnues(id) { return etat.alternatives?.ctx === etat.ctx ? etat.alternatives.parDemande.get(Number(id)) : undefined; }
function panneauAlternatives(d, alt) {
  const A = (k, vars) => esc(t(`admissions.${k}`, vars));
  const def = d.deficit || alt?.deficit;
  const tete = `<h4>${A(def && def.manque > 0 ? 'alt_titre_deficit' : 'alt_titre')}</h4>${def ? `<p class="note">${A('alt_manque', { n: def.manque, type: d.type_nom, d: def.demandes, l: def.lits })}</p>` : ''}`;
  if (alt === undefined) return `${tete}<p class="note" role="status">${A('alt_recherche')}</p>`;
  if (alt === null) return `${tete}<p class="note">${A('alt_erreur')}</p>`;
  const sug = alt.suggestions || [];
  if (!sug.length) return `${tete}<p>${A('alt_aucune')}</p>`;
  const hm = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', timeZone: fuseau() });
  const statut = (x) => x.confirmation?.statut === 'capacite_confirmee' ? ['ok', A('alt_confirme')] : x.confirmation?.statut === 'capacite_perimee' ? ['perime', A('alt_a_reconfirmer')] : ['verifier', A('alt_non_confirme')];
  return `${tete}<ul class="alt-liste">${sug.slice(0, 3).map((x, i) => { const [cls, lib] = statut(x); return `<li class="alt-item">
      <div><strong>${esc(x.nom)}</strong>${x.recommande ? ` <span class="badge fort">${esc(t('reseau.recommande'))}</span>` : ''}
        <div class="note">${esc(d.type_nom)} · ${A('alt_lits', { n: x.libres })}</div>
        <div class="note"><span class="alt-statut alt-${cls}">${lib}</span>${x.confirmation?.confirme_le ? ` · ${A('alt_confirme_le', { heure: hm(x.confirmation.confirme_le) })}` : ''}</div>
        ${x.statut_route === 'calcule' ? `<div class="note num">${A('alt_route', { km: nb(x.distance_km), duree: duree(x.minutes_route) })}</div>` : ''}
        ${x.exclusions && (x.exclusions.age || x.exclusions.besoins) ? `<div class="note">${A('alt_exclus', { age: x.exclusions.age, besoins: x.exclusions.besoins })}</div>` : ''}</div>
      ${etabCtx()?.module_actif ? `<button class="btn" data-adm="${d.id}" data-a="alt-transfert" data-i="${i}">${A('alt_preparer')}</button>` : ''}</li>`; }).join('')}</ul>
    <p class="note">${A('alt_maj', { heure: hm(alt.capacite_verifiee_le || alt.verifie_le) })}${sug.length > 3 ? ` · <button class="lien" type="button" data-adm="${d.id}" data-a="alt-tout">${A('alt_tout_voir', { n: sug.length })}</button>` : ''}</p>`;
}
let alternativesEnCours = null;
async function chargerAlternatives(v, file) {
  const ctx = etat.ctx;
  if (alternativesEnCours?.ctx === ctx) return alternativesEnCours.p;   // une seule recherche à la fois par établissement
  const p = (async () => {
    let r = null;
    try { r = await api('GET', `/admissions/alternatives?etablissement_id=${ctx}`); } catch { r = null; }
    if (ctx !== etat.ctx) return;
    const parDemande = new Map((r?.demandes || []).map((x) => [x.demande_id, { ...x, verifie_le: r.verifie_le }]));
    etat.alternatives = { ctx, parDemande, echec: !r };
    if (etat.vue !== 'admissions') return;
    document.querySelectorAll('#v-admissions [data-alt]').forEach((zone) => {
      const d = file.find((x) => String(x.id) === zone.dataset.alt); if (!d) return;
      zone.innerHTML = panneauAlternatives(d, r ? parDemande.get(d.id) || { suggestions: [], verifie_le: r.verifie_le } : null);
      zone.querySelectorAll('[data-adm]').forEach((b) => { const orig = document.querySelector(`#v-admissions .actions [data-adm="${b.dataset.adm}"][data-a="ailleurs"]`);
        b.onclick = b.dataset.a === 'alt-tout' ? () => orig?.click() : () => preparerTransfert(d, parDemande.get(d.id)?.suggestions?.[Number(b.dataset.i)]); });
    });
  })().finally(() => { alternativesEnCours = null; });
  alternativesEnCours = { ctx, p };
  return p;
}
/** Préparer une demande de transfert vers une destination proposée : confirmation explicite ; le receveur doit accepter. */
function preparerTransfert(d, x) {
  if (!d || !x) return null;
  const A = (k, vars) => esc(t(`admissions.${k}`, vars)); const etab = etat.ctx;
  modale(t('admissions.alt_confirmer_titre', { ref: d.patient_ref }), `<p><strong>${esc(x.nom)}</strong></p><p class="note num">${esc(x.raison || '')}</p>
    <p class="note">${A('alt_confirmer_aide', { etab: x.nom })}</p><label><input type="checkbox" id="m-transfert-urgent"> ${esc(t('priorites_ui.transport_urgent'))}</label>`,
  [{ label: t('general.annuler') }, { label: t('admissions.demander_transfert'), pri: true, run: async () => {
    if (etab !== etat.ctx) return false;
    return (await agir(null, () => api('POST', `/admissions/${d.id}/transferer`, { destination_id: x.etablissement_id, lit_id: x.lit?.id, version: x.lit?.version, urgent: $('#m-transfert-urgent').checked }),
      (tr) => t('admissions.transfert_ok', { numero: tr.numero, etab: x.nom }))) !== null || false;
  } }]);
  return null;
}
/** Types d'unité proposés dans les formulaires : ceux qui existent dans l'établissement (sinon tout le catalogue de la configuration). */
function typesEtab(cfg) {
  const presents = (etabCtx() && etabCtx().types_presents) || [];
  const l = cfg.types.filter((x) => presents.includes(x.id));
  return l.length ? l : cfg.types;
}
async function vueAdmissions() {
  const v = $('#v-admissions');
  const actif = etabCtx().module_actif;
  const cfg = configCtx();
  const [file, urg, priorites] = await Promise.all([api('GET', `/admissions?etablissement_id=${etat.ctx}`), api('GET', `/civieres?etablissement_id=${etat.ctx}`), api('GET', `/admissions/referentiel?etablissement_id=${etat.ctx}`)]);
  const sansDemande = urg.civieres.filter((c) => c.etat === 'occupee' && !c.demande_id);
  const A = (k, vars) => esc(t(`admissions.${k}`, vars));
  const carte = (d) => `<div class="fiche" style="--c:${d.depasse ? 'var(--attention)' : 'var(--secondaire)'}">
      <div class="t"><b>${esc(d.patient_ref)}</b><span class="${d.depasse ? 'urgent' : 'note num'}">${esc(d.priorite_affichage)} · ${depuis(d.cree_le)}</span></div>
      <p class="note">${esc(d.priorite_explication)}</p>
      ${d.patient_nom_court ? `<div class="note">${esc(d.patient_nom_court)}</div>` : ''}${libelleAge(d.groupe_age)}
      <div class="note">${esc(d.type_nom)} · ${esc(t(`provenances.${d.provenance}`).toLowerCase())} · ${esc(besoinsTexte(d))}</div>
      ${d.civiere_code ? `<div class="note">${t('admissions.sur_civiere', { code: esc(d.civiere_code) })} · <span class="${classeDuree(d.heures_civiere)}">${esc(t('urgence.depuis_h', { duree: duree(d.heures_civiere * 60) }))}</span></div>` : ''}
      ${d.statut === 'assignee' ? `<div class="note">${t('admissions.lit_assigne', { code: esc(d.lit_code) })}</div>` : d.lit_suggere ? `<div class="note">${t('admissions.lit_adapte', { code: esc(d.lit_suggere.code) })}</div>` : `<div class="alerte">${A('aucun_lit')}</div>`}
      ${d.statut === 'attente' && !d.lit_suggere ? `${d.lit_concurrent ? `<p class="note">${A('alt_lit_concurrent', { code: d.lit_concurrent.code })}</p>` : ''}<div class="alternatives" data-alt="${d.id}">${panneauAlternatives(d, alternativesConnues(d.id))}</div>` : ''}
      ${actif ? `<div class="actions">${d.statut === 'attente'
    ? `${d.lit_suggere ? `<button class="btn pri" data-adm="${d.id}" data-a="assigner" data-lit="${d.lit_suggere.id}" data-version="${d.lit_suggere.version}">${A('assigner', { code: d.lit_suggere.code })}</button>` : ''}
           ${!d.lit_suggere && d.lit_concurrent ? `<button class="btn" data-adm="${d.id}" data-a="assigner" data-lit="${d.lit_concurrent.id}" data-version="${d.lit_concurrent.version}">${A('alt_assigner_quand_meme', { code: d.lit_concurrent.code })}</button>` : ''}
           <button class="btn" data-adm="${d.id}" data-a="ailleurs">${A('chercher_ailleurs')}</button>`
    : `<button class="btn pri" data-adm="${d.id}" data-a="admettre">${A('admettre')}</button>`}
        ${priorites.peut_valider && priorites.referentiel ? `<button class="btn" data-adm="${d.id}" data-a="priorite">${esc(t('priorites_ui.valider'))}</button>` : ''}
        <button class="btn dan" data-adm="${d.id}" data-a="annuler">${A('annuler')}</button></div>` : ''}</div>`;
  const attenteF = file.filter((d) => d.statut === 'attente');
  const assignees = file.filter((d) => d.statut === 'assignee');
  v.innerHTML = `<div class="entete"><div><h2>${A('titre', { etab: etabCtx().nom })}</h2><p>${A('intro', { h: Math.round(cfg.attente_admission_max_min / 60) })}</p></div></div>
    <div class="panneau-c"><h3>${esc(t('priorites_ui.titre'))}</h3><p>${esc(t('priorites_ui.regle'))}</p>
      <p class="note">${esc(priorites.referentiel ? t('priorites_ui.revision', { n: priorites.referentiel.revision }) : t('priorites_ui.absent'))}</p>
      ${etat.moi.utilisateur.admin ? `<div class="actions"><button class="btn" id="p-habilitations">${esc(t('priorites_ui.habilitations'))}</button>${priorites.peut_valider ? `<button class="btn" id="p-referentiel">${esc(t('priorites_ui.configurer'))}</button>` : ''}</div>` : ''}</div>
    <div class="deux"><div class="pile"><div class="panneau-c"><h3>${A('nouvelle')}</h3>
      <div class="ligne"><div class="champ"><label class="lbl" for="a-type">${A('type_unite')}</label><select id="a-type">${typesEtab(cfg).map((x) => `<option value="${x.id}">${esc(nomType(x))}</option>`).join('')}</select></div>
      <div class="champ"><label class="lbl" for="a-age">${esc(t('fin.groupe_age'))}</label><select id="a-age"><option value="">${esc(t('fin.age_selon_type'))}</option>${GROUPES_AGE.map((g) => `<option value="${g}">${esc(t(`fin.age_${g}`))}</option>`).join('')}</select></div>
      <div class="champ"><label class="lbl" for="a-ref">${A('ref_patient')}</label><input id="a-ref" placeholder="${esc(cfg.reference_exemple)}" autocomplete="off"></div></div>
      ${sansDemande.length ? `<div class="champ"><label class="lbl" for="a-civ">${A('civiere')}</label><select id="a-civ"><option value="">${A('sans_civiere')}</option>${sansDemande.map((c) => `<option value="${c.id}" data-ref="${esc(c.patient_ref)}">${esc(c.code)} · ${esc(c.patient_ref)} · ${esc(t('urgence.depuis_h', { duree: duree(c.heures * 60) }))}</option>`).join('')}</select></div>` : ''}
      <div class="ligne"><div class="champ"><label class="lbl" for="a-prio">${A('priorite')}</label><select id="a-prio">${options('priorites_adm', ['p1', 'p2', 'p3'], 'p2')}</select></div>
      <div class="champ"><label class="lbl" for="a-prov">${A('provenance')}</label><select id="a-prov">${options('provenances', ['urgence', 'bloc', 'externe', 'autre'])}</select></div></div>
      <div class="cases">${casesBesoins('data-abesoin')}</div>
      <p class="note">${esc(t('priorites_ui.creation'))}</p>
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
      priorite: $('#a-prio').value, provenance: $('#a-prov').value, besoins, civiere_id: civ, groupe_age: $('#a-age').value || undefined }), t('admissions.ajoutee'));
  };
  // Alternatives du réseau : chargées sans bloquer l'écran, puis placées sous chaque demande sans lit local.
  if (actif && attenteF.some((d) => !d.lit_suggere)) chargerAlternatives(v, file);
  const selCiv = $('#a-civ');
  if ($('#p-habilitations')) $('#p-habilitations').onclick = () => gererHabilitationsPriorites();
  if ($('#p-referentiel')) $('#p-referentiel').onclick = () => configurerPriorites(priorites.referentiel);
  if (selCiv) selCiv.onchange = () => { const o = selCiv.selectedOptions[0]; if (o && o.dataset.ref) { $('#a-ref').value = o.dataset.ref; $('#a-prov').value = 'urgence'; } };
  v.querySelectorAll('[data-adm]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.adm; const a = b.dataset.a === 'alt-tout' ? 'ailleurs' : b.dataset.a;
      if (a === 'priorite') return validerPriorite(file.find((d) => String(d.id) === id), priorites.referentiel);
      if (a === 'assigner') return agir(b, () => api('POST', `/admissions/${id}/assigner`, { lit_id: Number(b.dataset.lit), version: Number(b.dataset.version) }), t('admissions.assigne_ok'));
      if (a === 'admettre') return agir(b, () => api('POST', `/admissions/${id}/admettre`), t('admissions.admis_ok'));
      if (a === 'annuler') return agir(b, () => api('POST', `/admissions/${id}/annuler`), t('admissions.annule_ok'));
      const d = file.find((x) => String(x.id) === id);
      if (a === 'alt-transfert') return preparerTransfert(d, alternativesConnues(d.id)?.suggestions?.[Number(b.dataset.i)]);
      const be = {}; BESOINS.forEach((k) => { be[k] = d[`besoin_${k}`]; });
      const res = await api('GET', `/recherche?depuis=${etat.ctx}&type_id=${d.type_id}${qsBesoins(be)}&groupe_age=${d.groupe_age || 'adulte'}`).catch((e) => { toast(e.message, true); return null; });
      if (!res) return null;
      const sug = res.suggestions.filter((x) => x.libres);
      modale(t('admissions.ailleurs_titre', { ref: d.patient_ref }), sug.length ? `<div class="liste">${sug.map((x, i) => `<label class="item"><div><strong>${esc(x.nom)}</strong>${x.recommande ? ` <span class="badge fort">${esc(t('reseau.recommande'))}</span>` : ''}<div class="note num">${esc(x.raison)}</div>${x.pourquoi ? `<div class="note">${esc(x.pourquoi)}</div>` : ''}${exclusionsHTML(x.exclusions)}</div><input type="radio" name="m-sug" value="${i}"${i === 0 ? ' checked' : ''}></label>`).join('')}</div>
        <p class="note">${A('ailleurs_aide', { besoins: besoinsTexte(d) })}</p><label><input type="checkbox" id="m-transfert-urgent"> ${esc(t('priorites_ui.transport_urgent'))}</label>` : `<p>${A('ailleurs_aucun')}</p>`,
      sug.length ? [{ label: t('general.annuler') }, { label: t('admissions.demander_transfert'), pri: true, run: async () => {
        const x = sug[Number(($('input[name="m-sug"]:checked') || {}).value || 0)];
        return (await agir(null, () => api('POST', `/admissions/${id}/transferer`, { destination_id: x.etablissement_id, lit_id: x.lit?.id, version: x.lit?.version, urgent: $('#m-transfert-urgent').checked }), (tr) => t('admissions.transfert_ok', { numero: tr.numero, etab: x.nom }))) !== null || false;
      } }] : [{ label: t('general.fermer') }]);
      return null;
    };
  });
}

/* ---------------- Nettoyage ---------------- */
function validerPriorite(d, referentiel) {
  const etab = etat.ctx;
  const P = (k) => esc(t(`priorites_ui.${k}`));
  modale(t('priorites_ui.valider'), `<p>${esc(etabCtx().nom)} · ${esc(d.patient_ref)}</p>
    <p class="note">${P('responsabilite')}</p><label class="lbl" for="p-categorie">${P('categorie')}</label>
    <select id="p-categorie"><option value="">${P('categorie')}</option>${referentiel.categories.map((p) => `<option value="${esc(p.code)}"${p.code === d.priorite_code ? ' selected' : ''}>${esc(p.libelle)} · ${p.rang}</option>`).join('')}</select>
    <label class="lbl" for="p-motif">${P('motif')}</label><textarea id="p-motif" maxlength="500"></textarea>
    <label><input type="checkbox" id="p-confirmation"> ${P('attestation')}</label>`,
  [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => {
    if (etat.ctx !== etab) { toast(t('priorites_ui.contexte_change'), true); return false; }
    return (await agir(null, () => api('POST', `/admissions/${d.id}/priorite`, { code: $('#p-categorie').value,
      revision: referentiel.revision, version: d.priorite_version, motif: $('#p-motif').value,
      confirmation: $('#p-confirmation').checked }), t('priorites_ui.enregistre'))) !== null || false;
  } }]);
}
function configurerPriorites(referentiel) {
  const etab = etat.ctx;
  const categories = referentiel?.categories || [];
  const P = (k) => esc(t(`priorites_ui.${k}`));
  modale(t('priorites_ui.configurer'), `<p>${esc(etabCtx().nom)}</p><p class="note">${P('configuration_aide')}</p>
    <div class="pile">${Array.from({ length: 12 }, (_, i) => {
    const p = categories[i];
    return `<div class="ligne" data-p-categorie="${esc(p?.code || `nouveau_${i + 1}`)}"><input aria-label="${P('categorie')} ${i + 1}" data-p-libelle maxlength="80" value="${esc(p?.libelle || '')}" placeholder="${P('categorie')}"><input aria-label="${P('rang')} ${i + 1}" data-p-rang type="number" min="1" max="100" value="${p?.rang || ''}" placeholder="${P('rang')}"></div>`;
  }).join('')}</div>
    <label class="lbl" for="p-motif">${P('motif')}</label><textarea id="p-motif" maxlength="500"></textarea>
    <label><input type="checkbox" id="p-confirmation"> ${P('attestation_referentiel')}</label>`,
  [{ label: t('general.annuler') }, { label: t('general.enregistrer'), pri: true, run: async () => {
    if (etat.ctx !== etab) { toast(t('priorites_ui.contexte_change'), true); return false; }
    const nouvelles = [...document.querySelectorAll('[data-p-categorie]')].filter((row) => row.querySelector('[data-p-libelle]').value.trim() || row.querySelector('[data-p-rang]').value)
      .map((row) => ({ code: row.dataset.pCategorie, libelle: row.querySelector('[data-p-libelle]').value, rang: Number(row.querySelector('[data-p-rang]').value) }));
    return (await agir(null, () => api('PUT', '/admissions/referentiel', { etablissement_id: etab, revision: referentiel?.revision || 0,
      categories: nouvelles, motif: $('#p-motif').value, confirmation: $('#p-confirmation').checked }), t('priorites_ui.enregistre'))) !== null || false;
  } }]);
}
async function gererHabilitationsPriorites() {
  const etab = etat.ctx;
  const donnees = await Promise.all([api('GET', '/admin/utilisateurs'), api('GET', `/admissions/habilitations?etablissement_id=${etab}`)]).catch((e) => { toast(e.message, true); return null; });
  if (!donnees || etat.ctx !== etab) return;
  const [comptes, habilitations] = donnees;
  const eligibles = comptes.filter((u) => (u.actif || habilitations.some((h) => h.utilisateur_id === u.id)) && u.role !== 'entretien' && (u.role === 'gestionnaire' || u.etablissements.includes(etab)));
  const P = (k) => esc(t(`priorites_ui.${k}`));
  modale(t('priorites_ui.habilitations'), `<p>${esc(etabCtx().nom)}</p><p class="note">${P('habilitation_aide')}</p>
    <label class="lbl" for="p-compte">${P('compte')}</label><select id="p-compte">${eligibles.map((u) => `<option value="${u.id}">${esc(u.nom)} · ${esc(u.email)}</option>`).join('')}</select>
    <label><input type="checkbox" id="p-active"> ${P('autoriser')}</label>
    <label class="lbl" for="p-motif">${P('motif')}</label><textarea id="p-motif" maxlength="500"></textarea>
    <label><input type="checkbox" id="p-confirmation"> ${P('attestation_habilitation')}</label>`,
  [{ label: t('general.annuler') }, { label: t('general.enregistrer'), pri: true, run: async () => {
    if (etat.ctx !== etab) { toast(t('priorites_ui.contexte_change'), true); return false; }
    return (await agir(null, () => api('PUT', `/admissions/habilitations/${$('#p-compte').value}`, {
      etablissement_id: etab, active: $('#p-active').checked, motif: $('#p-motif').value,
      version: habilitations.find((h) => h.utilisateur_id === Number($('#p-compte').value))?.version || 0,
      confirmation: $('#p-confirmation').checked }), t('priorites_ui.enregistre'))) !== null || false;
  } }]);
  const selectionner = () => { $('#p-active').checked = !!habilitations.find((h) => h.utilisateur_id === Number($('#p-compte').value))?.active; };
  $('#p-compte').onchange = selectionner;
  selectionner();
}

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
    <div class="ligne filtres-nsa"><div class="champ"><label class="lbl" for="n-recherche">${S('rechercher')}</label><input id="n-recherche" type="search" autocomplete="off" value="${esc(etat.nsaRecherche || '')}"></div>
      <div class="champ"><label class="lbl" for="n-filtre">${S('filtre_orientation')}</label><select id="n-filtre"><option value="">${S('toutes')}</option>${options('orientations', ORIENTATIONS, etat.nsaOrientation || '')}</select></div>
      <span class="note" id="n-compte"></span></div>
    <div class="tableau"><table><thead><tr><th>${S('lit')}</th><th>${S('unite')}</th><th>${S('patient')}</th><th>${S('depuis')}</th><th>${S('orientation')}</th><th></th></tr></thead><tbody>${[...n.lits].sort((a, b) => b.jours - a.jours).map((l) => `<tr data-nsa-ligne="${esc(`${l.code} ${l.unite} ${l.patient_ref}`.toLowerCase())}" data-nsa-orient="${esc(l.nsa_orientation || '')}">
      <td class="num">${esc(l.code)}</td><td class="donnee">${esc(l.unite)}</td><td class="num">${esc(l.patient_ref)}</td><td class="num">${S('jours', { n: l.jours })}${l.jours >= 30 ? ' <span class="pt pt-attention" aria-hidden="true"></span>' : ''}</td>
      <td><select data-orient="${l.id}" aria-label="${S('orientation')}">${options('orientations', ORIENTATIONS, l.nsa_orientation)}</select></td>
      <td><div class="ligne serre"><button class="btn" type="button" data-nsa-detail="${l.id}">${S('details')}</button><button class="btn" data-retirer="${l.id}">${S('retirer')}</button></div></td></tr>`).join('') || `<tr><td colspan="6" class="muted">${S('aucun')}</td></tr>`}</tbody></table></div>`;
  const filtrer = () => {
    etat.nsaRecherche = $('#n-recherche').value; etat.nsaOrientation = $('#n-filtre').value;
    const q = etat.nsaRecherche.trim().toLowerCase(); let vus = 0;
    v.querySelectorAll('[data-nsa-ligne]').forEach((tr) => {
      const ok = (!q || tr.dataset.nsaLigne.includes(q)) && (!etat.nsaOrientation || tr.dataset.nsaOrient === etat.nsaOrientation);
      tr.hidden = !ok; if (ok) vus += 1;
    });
    $('#n-compte').textContent = t('nsa.affiches', { n: vus, total: n.lits.length });
  };
  v.querySelectorAll('[data-nsa-detail]').forEach((b) => { b.onclick = () => detailNsa(Number(b.dataset.nsaDetail)); });
  $('#n-recherche').oninput = filtrer; $('#n-filtre').onchange = filtrer; filtrer();
  v.querySelectorAll('[data-orient]').forEach((sel) => { sel.onchange = () => agir(sel, () => api('PUT', `/lits/${sel.dataset.orient}/nsa`, { orientation: sel.value }), t('nsa.orient_ok')); });
  v.querySelectorAll('[data-retirer]').forEach((b) => { b.onclick = () => agir(b, () => api('DELETE', `/lits/${b.dataset.retirer}/nsa`), t('nsa.retire_ok')); });
}

/** Panneau de détails d'un lit ALC : informations existantes et événements du journal depuis le début du séjour. */
async function detailNsa(id) {
  const S = (k, vars) => esc(t(`nsa.${k}`, vars));
  let d;
  try { d = await api('GET', `/nsa/lits/${id}`); } catch (e) { toast(e.message, true); return; }
  const evts = d.evenements.map((e) => `<li><span class="num">${esc(heure(e.date))}</span> · ${esc(e.action)}${e.nouvel_etat ? ` → ${esc(t(`etats.${e.nouvel_etat}`))}` : ''}${
    e.utilisateur ? ` <span class="note">(${esc(e.utilisateur)})</span>` : ''}${e.refuse ? ` <span class="badge">${S('refuse')}</span>` : ''}</li>`).join('');
  modale(t('nsa.detail_titre', { lit: d.code }), `<dl class="detail-nsa">
      <dt>${S('patient')}</dt><dd class="num">${esc(d.patient_ref || '—')}</dd>
      <dt>${S('unite')}</dt><dd>${esc(d.unite)}</dd>
      <dt>${S('orientation')}</dt><dd>${esc(t(`orientations.${d.nsa_orientation}`))}</dd>
      <dt>${S('depuis_le')}</dt><dd class="num">${esc(heure(d.nsa_depuis))} · ${S('jours', { n: d.jours })}</dd>
      <dt>${S('statut')}</dt><dd>${S(d.jours >= 30 ? 'statut_long' : 'statut_en_cours')}</dd></dl>
    <h4>${S('evenements')}</h4>${evts ? `<ul class="evenements-nsa">${evts}</ul>` : `<p class="muted">${S('aucun_evenement')}</p>`}`,
  [{ label: t('general.fermer'), pri: true }]);
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
    tuile({ lbl: t('indicateurs.occupation'), val: pct(i.capacite.occupation_patients), note: I('occupation_note', { occupes: i.capacite.occupes, libres: i.capacite.libres, dotes: i.capacite.dotes }),
      etat: etatSeuil(i.capacite.occupation_patients, c.seuil_jaune, c.seuil_rouge), cible: cibleMax(pct(c.seuil_jaune)) }),
    tuile({ lbl: t('indicateurs.niveau'), val: t(`niveaux.${i.alerte.niveau}`), note: I('pression', { p: pct(i.alerte.pression) }), etat: niveauEtat }),
    tuile({ lbl: t('indicateurs.fermes'), val: nb(i.capacite.indispo),
      note: esc(Object.entries(i.capacite.indispo_par_motif).map(([k, x]) => `${t(`motifs.${k}`)} ${nb(x)}`).join(' · ')) || I('fermes_aucun') }),
    tuile({ lbl: I('capacites_confirmees'), val: nb(i.capacite.libres_confirmes), note: I('capacites_confirmees_note') }),
    tuile({ lbl: I('capacites_a_confirmer'), val: nb(i.capacite.libres_non_confirmes), note: I('capacites_a_confirmer_note') }),
    tuile({ lbl: I('capacites_perimees'), val: nb(i.capacite.libres_perimes), note: I('capacites_perimees_note'), etat: i.capacite.libres_perimes ? 'attention' : null }),
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
    tuile({ lbl: I('transferts_en_attente'), val: nb(i.transferts.attentes), note: I('transferts_en_attente_note') }),
    tuile({ lbl: I('confirmations_periode'), val: nb(i.transferts.confirmations), note: I('confirmations_periode_note') }),
    tuile({ lbl: I('reorientations'), val: nb(i.transferts.reorientations), note: I('reorientations_note') }),
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
  // Sections du tableau de bord : les mêmes tuiles et les mêmes calculs, regroupés par usage.
  const categories = [['ensemble', [capacite[0], capacite[1], capacite[3], capacite[2], capacite[6]]],
    ['flux', [fluidite[0], fluidite[4], fluidite[5], fluidite[6], fluidite[7], capacite[4], capacite[5]]],
    ['performance', [fluidite[1], fluidite[2], fluidite[3]]], ...(urgence ? [['urgence', urgence]] : [])];
  const cat = categories.some(([k]) => k === etat.indicCat) ? etat.indicCat : 'tout';
  const horsCible = categories.flatMap(([, l]) => l).filter((h) => h.includes('class="pt pt-')).length;
  v.innerHTML = `<div class="entete"><div><h2>${I('titre', { etab: etabCtx().nom })}</h2><p>${I('intro', { n: j })}</p></div>
    <div class="ligne"><select id="i-jours" aria-label="${I('periode')}">${[7, 30, 90].map((x) => `<option value="${x}"${x === etat.jours ? ' selected' : ''}>${I('jours', { n: x })}</option>`).join('')}</select>
      <button class="btn" id="b-csv">${icone('download')}${I('exporter')}</button></div></div>
    <div class="ligne filtres-indic"><div class="chips" role="group" aria-label="${I('categorie')}">${['tout', ...categories.map(([k]) => k)].map((k) =>
      `<button class="chip" type="button" data-icat="${k}" aria-pressed="${cat === k}">${I(k === 'tout' ? 'toutes' : k)}</button>`).join('')}</div>
      <span class="note" id="i-hors-cible">${I(horsCible ? 'hors_cible' : 'hors_cible_aucun', { n: horsCible })}</span></div>
    ${categories.filter(([k]) => cat === 'tout' || cat === k).map(([k, l]) => `<h3 class="titre-section">${I(k)}</h3><p class="note section-aide">${I(`${k}_aide`)}</p><div class="tuiles">${l.join('')}</div>`).join('')}
    ${cat === 'tout' || cat === 'performance' ? graphiquesIndicateurs(i) : ''}`;
  v.querySelectorAll('[data-icat]').forEach((b) => { b.onclick = () => { etat.indicCat = b.dataset.icat; rafraichir(); }; });
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

/** Graphiques (données réelles, lecture seule) : disponibilité actuelle par unité et transferts par jour sur la période. */
function graphiquesIndicateurs(i) {
  const I = (k, vars) => esc(t(`indicateurs.${k}`, vars));
  const unites = (i.par_unite || []).filter((u) => u.dotes > 0);
  const barresUnites = unites.map((u) => {
    const autres = Math.max(u.dotes - u.libres - u.occupes, 0);
    const lib = t('indicateurs.g_unite_val', { unite: u.unite, libres: u.libres, occupes: u.occupes, autres, dotes: u.dotes });
    const seg = (n, c) => (n ? `<span class="g-seg ${c}" style="flex:${n}"></span>` : '');
    return `<div class="g-ligne" title="${esc(lib)}"><span class="g-lbl donnee">${esc(u.unite)}</span><span class="g-barre" role="img" aria-label="${esc(lib)}">${seg(u.libres, 'f-libre')}${seg(u.occupes, 'f-occupe')}${seg(autres, 'g-autre')}</span>
      <span class="g-val num">${esc(t('indicateurs.g_libres_sur', { n: u.libres, total: u.dotes }))}</span></div>`;
  }).join('');
  const jours = i.transferts_par_jour || [];
  const max = Math.max(1, ...jours.map((d) => d.total));
  const total = jours.reduce((a, d) => a + d.total, 0);
  const jourLib = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale(), { day: '2-digit', month: 'short' });
  const colonnes = jours.map((d) => {
    const lib = t('indicateurs.g_jour_val', { jour: jourLib(d.jour), n: d.total, refuses: d.refuses });
    return `<span class="g-col" title="${esc(lib)}" aria-label="${esc(lib)}" role="img"><span class="g-pile" style="height:${(d.total / max) * 100}%">${
      d.refuses ? `<span class="g-seg f-refuse" style="flex:${d.refuses}"></span>` : ''}${d.total - d.refuses ? `<span class="g-seg g-transfert" style="flex:${d.total - d.refuses}"></span>` : ''}</span></span>`;
  }).join('');
  return `<h3 class="titre-section">${I('graphiques')}</h3><div class="grille graphiques">
    <figure class="panneau-c graphique"><figcaption><strong>${I('g_unites')}</strong><span class="note">${I('g_unites_aide')}</span></figcaption>
      <div class="g-legende"><span><i class="f-libre"></i>${I('g_libres')}</span><span><i class="f-occupe"></i>${I('g_occupes')}</span><span><i class="g-autre"></i>${I('g_autres')}</span></div>
      ${barresUnites || `<p class="muted">${I('g_aucune_unite')}</p>`}</figure>
    <figure class="panneau-c graphique"><figcaption><strong>${I('g_transferts', { n: i.periode_jours })}</strong><span class="note">${I('g_transferts_aide', { n: total })}</span></figcaption>
      <div class="g-legende"><span><i class="g-transfert"></i>${I('g_non_refuses')}</span><span><i class="f-refuse"></i>${I('g_refuses')}</span></div>
      ${total ? `<div class="g-colonnes" data-max="${max}">${colonnes}</div><div class="g-axe note"><span>${esc(jourLib(jours[0].jour))}</span><span>${I('g_max', { n: max })}</span><span>${esc(jourLib(jours[jours.length - 1].jour))}</span></div>`
        : `<p class="muted">${I('g_aucun_transfert')}</p>`}</figure></div>`;
}

/* ---------------- Mon compte ---------------- */
async function vueCompte() {
  const v = $('#v-compte');
  const u = etat.moi.utilisateur;
  const K = (k, vars) => esc(t(`compte.${k}`, vars));
  v.innerHTML = `<div class="entete"><div><h2>${K('titre')}</h2><p><span class="donnee">${esc(u.nom)}</span> · ${esc(u.email)} · ${K('role', { role: t(`roles_texte.${u.role}`) })}</p></div></div>
    <div class="grille">
      <div class="panneau-c"><h3>${K('profil')}</h3><dl><dt>${K('profil_nom')}</dt><dd class="donnee">${esc(u.nom)}</dd><dt>${K('profil_courriel')}</dt><dd>${esc(u.email)}</dd>
        <dt>${K('profil_role')}</dt><dd>${esc(t(`roles.${u.role}`))}</dd><dt>${K('profil_etabs')}</dt><dd>${etat.moi.etablissements.map((e) => esc(e.nom)).join('<br>') || '—'}</dd></dl>
        <p class="note">${K('profil_aide')}</p><button class="btn" type="button" id="b-compte-deconnexion">${icone('log-out')}${K('deconnexion')}</button></div>
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
  $('#b-compte-deconnexion').onclick = () => $('#b-deconnexion').click();
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
function modifierRessourceStructure(type, x, contexte = {}) {
  const fmt = (v) => JSON.stringify(v || {});
  const champs = {
    departement: [['nom','Nom',x.nom],['attributs','Attributs JSON',fmt(x.attributs),'json'],['actif','Actif',x.actif,'bool']],
    service: [['nom','Nom',x.nom],['departement_id','Département',x.departement_id||'','select',contexte.departements||[]],['attributs','Attributs JSON',fmt(x.attributs),'json'],['actif','Actif',x.actif,'bool']],
    etage: [['nom','Nom',x.nom],['aile','Aile',x.aile||''],['attributs','Attributs JSON',fmt(x.attributs),'json'],['actif','Actif',x.actif,'bool']],
    unite: [['nom','Nom',x.nom],['departement_id','Département',x.departement_id||'','select',contexte.departements||[]],['service_id','Service',x.service_id||'','select',contexte.services||[]],['attributs','Attributs JSON',fmt(x.attributs),'json'],['actif','Actif',x.actif,'bool']],
    chambre: [['type_chambre','Type de chambre',x.type_chambre||''],['etage_id','Étage',x.etage_id||'','select',contexte.etages||[]],['capacite_declaree','Capacité déclarée',x.capacite_declaree??'','number'],['accessible','Accessible',x.accessible,'bool'],['statut_operationnel','État opérationnel',x.statut_operationnel,'select-val',['actif','maintenance','ferme']],['attributs','Attributs JSON',fmt(x.attributs),'json'],['restrictions','Restrictions JSON',fmt(x.restrictions),'json'],['actif','Actif',x.actif,'bool']],
    lit: [['categorie','Catégorie',x.categorie||''],['groupe_age',t('fin.groupe_age'),x.groupe_age||'adulte','select',[...GROUPES_AGE,'tous'].map((g)=>({id:g,nom:t(`fin.age_${g}`)}))],['attributs','Attributs JSON',fmt(x.attributs),'json'],['actif','Actif',x.actif,'bool'],['isolement','Isolement',x.isolement,'bool'],['pression_negative','Pression négative',x.pression_negative,'bool'],['ventilation','Ventilation',x.ventilation,'bool'],['telemetrie','Télémétrie',x.telemetrie,'bool']],
    civiere: [['unite_id','Unité',x.unite_id||'','select',contexte.unites||[]],['attributs','Attributs JSON',fmt(x.attributs),'json'],['actif','Actif',x.actif,'bool']],
  }[type];
  if (!champs) return;
  const ident = (type === 'chambre' ? `Chambre ${x.numero}` : type === 'lit' ? `Lit ${x.code}` : type === 'civiere' ? `Civière ${x.code}` : x.nom || x.code);
  const html = champs.map(([k,label,val,mode,opts]) => `<div class="champ"><label class="lbl" for="ms-${k}">${esc(label)}</label>${mode==='bool'
    ? `<label class="case"><input id="ms-${k}" type="checkbox"${val?' checked':''}> ${esc(label)}</label>`
    : mode==='select'||mode==='select-val' ? `<select id="ms-${k}">${(opts||[]).map(o=>{const ov=mode==='select'?o.id:o;const on=mode==='select'?o.nom:o;return `<option value="${esc(ov)}"${String(val)===String(ov)?' selected':''}>${esc(on)}</option>`}).join('')}</select>`
    : `<input id="ms-${k}" ${mode==='number'?'type="number" min="1" max="100"':''} value="${esc(val??'')}">`}</div>`).join('');
  const urls={departement:`/admin/departements/${x.id}`,service:`/admin/services/${x.id}`,etage:`/admin/etages/${x.id}`,unite:`/admin/unites/${x.id}`,chambre:`/admin/chambres/${x.id}`,lit:`/admin/lits/${x.id}/details`,civiere:`/admin/civieres/${x.id}/details`};
  modale(`Modifier ${ident}`, `<div class="pile">${html}<p class="note">La désactivation est refusée par le serveur si une ressource dépendante est encore opérationnelle. Les états cliniques restent gérés dans leurs workflows.</p></div>`, [
    {label:t('general.annuler')}, {label:'Enregistrer',pri:true,run:async()=>{
      try {
        const payload={};
        for(const [k,, ,mode] of champs){const el=$(`#ms-${k}`);if(mode==='bool')payload[k]=el.checked;else if(mode==='json'){try{payload[k]=JSON.parse(el.value||'{}')}catch{throw new Error('Le JSON des attributs ou restrictions est invalide.')}}else if(k==='capacite_declaree')payload[k]=el.value===''?null:Number(el.value);else if(k==='departement_id'||k==='service_id'||k==='etage_id'||k==='unite_id')payload[k]=el.value===''?null:Number(el.value);else payload[k]=el.value;}
        const eq=['isolement','pression_negative','ventilation','telemetrie']; const details={...payload}; for(const k of eq)delete details[k];
        await api('PUT',urls[type],details);
        if(type==='lit'&&eq.some(k=>k in payload))await api('PUT',`/admin/lits/${x.id}/equipement`,Object.fromEntries(eq.map(k=>[k,payload[k]])));
        toast('Structure enregistrée.'); setTimeout(()=>rafraichir(),30); return true;
      }catch(e){toast(e.message,true);return false;}
    }}]);
}
/** Accès effectifs par rôle, en langage simple. Reflète les règles appliquées par le serveur et la barre de navigation ;
 *  les modules désactivés pour un établissement restent masqués pour tous. */
function matriceAcces() {
  const D = (k) => esc(t(`admin.${k}`));
  const roles = ['coordonnateur', 'entretien', 'admin_etab', 'gestionnaire'];
  const lignes = [
    ['acces_operations', ['oui', 'non', 'oui', 'oui']], ['acces_nettoyage', ['oui', 'oui', 'oui', 'oui']],
    ['acces_pilotage', ['oui', 'non', 'oui', 'oui']], ['acces_preferences', ['oui', 'oui', 'oui', 'oui']],
    ['acces_og', ['demo', 'non', 'oui_2fa', 'oui_2fa']], ['acces_comptes', ['non', 'non', 'ses_etabs', 'reseau']],
    ['acces_config', ['non', 'non', 'non', 'oui_2fa']],
  ];
  return `<div class="tableau matrice-acces"><table><caption class="note">${D('acces_titre')}</caption><thead><tr><th scope="col">${D('acces_fonction')}</th>${roles.map((r) => `<th scope="col">${esc(t(`roles.${r}`))}</th>`).join('')}</tr></thead>
    <tbody>${lignes.map(([k, v]) => `<tr><th scope="row">${D(k)}</th>${v.map((x) => `<td data-acces="${x}">${x === 'non' ? `<span class="muted">${D('acces_non')}</span>` : D(`acces_${x}`)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
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
  const onglets = ['utilisateurs', 'structure', 'import', 'connecteurs', 'journal'];
  if (u.gestionnaire) onglets.splice(3, 0, 'config');
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
      <div><details class="panneau-c roles-aide"><summary>${D('roles_titre')}</summary><dl>${['coordonnateur', 'entretien', 'admin_etab', 'gestionnaire'].map((k) =>
        `<dt>${esc(t(`roles.${k}`))}</dt><dd>${D(`role_aide_${k}`)}</dd>`).join('')}</dl>${matriceAcces()}<p class="note">${D('roles_serveur')}</p></details>
      <div class="ligne filtres-acl"><div class="champ"><label class="lbl" for="a-recherche">${D('rechercher')}</label><input id="a-recherche" type="search" autocomplete="off" value="${esc(etat.aclRecherche || '')}"></div>
        <div class="champ"><label class="lbl" for="a-role">${D('filtre_role')}</label><select id="a-role"><option value="">${D('tous_roles')}</option>${options('roles', ['coordonnateur', 'entretien', 'admin_etab', 'gestionnaire'], etat.aclRole || '')}</select></div>
        <div class="champ"><label class="lbl" for="a-statut">${D('filtre_statut')}</label><select id="a-statut">${['', 'actifs', 'desactives'].map((k) => `<option value="${k}"${(etat.aclStatut || '') === k ? ' selected' : ''}>${D(`statut_${k || 'tous'}`)}</option>`).join('')}</select></div>
        <span class="note" id="a-compte"></span></div>
      <div class="tableau"><table><thead><tr><th>${D('th_nom')}</th><th>${D('th_role')}</th><th>${D('th_etabs')}</th><th>${D('th_securite')}</th><th>${D('th_connexion')}</th><th></th></tr></thead><tbody>${[...comptes].sort((a, b) => a.role.localeCompare(b.role) || a.nom.localeCompare(b.nom)).map((c) => `<tr data-acl-ligne="${esc(`${c.nom} ${c.email}`.toLowerCase())}" data-acl-role="${c.role}" data-acl-actif="${c.actif ? '1' : '0'}">
        <td><span class="donnee">${esc(c.nom)}</span><div class="note">${esc(c.email)}</div></td><td>${esc(t(`roles.${c.role}`))}${c.actif ? '' : ` <span class="badge">${D('desactive')}</span>`}</td>
        <td class="note">${c.etablissements.map((e) => esc(nomEtab(e))).join('<br>') || D('tout_le_reseau')}</td>
        <td class="note">${D(c.totp_actif ? 'double_ok' : 'mdp_seul')}${c.mdp_temporaire ? `<br>${D('mdp_temp')}` : ''}</td>
        <td class="note">${c.derniere_connexion ? heure(c.derniere_connexion) : esc(t('general.jamais'))}</td>
        <td><div class="ligne" style="gap:6px">${c.id === u.id ? '' : `<button class="btn" data-reinit="${c.id}" data-nom="${esc(c.nom)}">${D('reinitialiser')}</button>
          <button class="btn${c.actif ? ' dan' : ''}" data-actif="${c.id}" data-val="${!c.actif}">${D(c.actif ? 'desactiver' : 'reactiver')}</button>`}</div></td></tr>`).join('')}</tbody></table></div></div></div>`;
    const filtrerComptes = () => {
      etat.aclRecherche = $('#a-recherche').value; etat.aclRole = $('#a-role').value; etat.aclStatut = $('#a-statut').value;
      const q = etat.aclRecherche.trim().toLowerCase(); let vus = 0;
      corps.querySelectorAll('[data-acl-ligne]').forEach((tr) => {
        const ok = (!q || tr.dataset.aclLigne.includes(q)) && (!etat.aclRole || tr.dataset.aclRole === etat.aclRole)
          && (!etat.aclStatut || (etat.aclStatut === 'actifs') === (tr.dataset.aclActif === '1'));
        tr.hidden = !ok; if (ok) vus += 1;
      });
      $('#a-compte').textContent = t('admin.affiches', { n: vus, total: comptes.length });
    };
    $('#a-recherche').oninput = filtrerComptes; $('#a-role').onchange = filtrerComptes; $('#a-statut').onchange = filtrerComptes; filtrerComptes();
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

  if (!etabCtx()) {
    corps.innerHTML = `<p>${esc(t('import.aucun_etab'))}</p>${u.gestionnaire ? formNouvelEtab() : ''}`;
    const d = corps.querySelector('details.nouvel-etab'); if (d) d.open = true;
    brancherNouvelEtab();
    return;
  }
  if (etat.adminOnglet === 'structure') {
    const cfg = configCtx();
    const st = await api('GET', `/admin/structure?etablissement_id=${etat.ctx}`);
    const detail = await api('GET', `/admin/structure/detaillee?etablissement_id=${etat.ctx}`);
    const detailChambres = new Map(detail.chambres.map((x) => [x.id, x]));
    const detailLits = new Map(detail.lits.map((x) => [x.id, x]));
    const ec = etabCtx(); const mods = ec.modules || {};
    const panneauModules = u.gestionnaire ? `<details class="panneau-c" style="margin-bottom:14px"><summary>${esc(t('fin.modules_titre'))}</summary><p class="note">${esc(t('fin.modules_aide'))}</p>
      <div class="ligne"><div class="champ"><label class="lbl" for="s-vocation">${esc(t('fin.vocation'))}</label><select id="s-vocation">${['general', 'pediatrique', 'specialise'].map((k) => `<option value="${k}"${(ec.vocation || 'general') === k ? ' selected' : ''}>${esc(t(`fin.vocation_${k}`))}</option>`).join('')}</select></div>
      <div class="cases">${['urgence', 'nsa', 'nettoyage', 'national'].map((k) => `<label class="case"><input type="checkbox" data-module="${k}"${mods[k] === false ? '' : ' checked'}> ${esc(t(`onglets.${k}`))}</label>`).join('')}</div>
      <button class="btn" id="b-modules">${esc(t('general.enregistrer'))}</button></div></details>` : '';
    corps.innerHTML = `${u.gestionnaire ? formNouvelEtab() : ''}<p class="note">${t('admin.etab_courant', { etab: esc(etabCtx().nom) })}</p>${panneauModules}
      <details class="panneau-c" style="margin-bottom:14px"><summary>${D('structure_niveaux')}</summary><p class="note">${D('structure_aide')}</p>
        <div class="ligne"><div class="champ"><label class="lbl" for="s-dept-code">${D('code_departement')}</label><input id="s-dept-code" maxlength="30"></div><div class="champ"><label class="lbl" for="s-dept-nom">${D('nom_departement')}</label><input id="s-dept-nom"></div><div class="champ"><label class="lbl" for="s-dept-attrs">${D('attributs_json')}</label><input id="s-dept-attrs" placeholder='{"secteur":"adulte"}'></div><button class="btn" id="b-dept">${D('ajouter_departement')}</button></div>
        <div class="chips">${detail.departements.map(d=>`<span class="chip">${esc(d.code)} · ${esc(d.nom)}${d.actif?'':` · ${D('inactif')}`} <button class="btn discret" data-modifier="departement" data-id="${d.id}">Modifier</button></span>`).join('')||`<span class="note">${D('aucun_departement')}</span>`}</div>
        <div class="ligne"><div class="champ"><label class="lbl" for="s-serv-code">${D('code_service')}</label><input id="s-serv-code" maxlength="30"></div><div class="champ"><label class="lbl" for="s-serv-nom">${D('nom_service')}</label><input id="s-serv-nom"></div><div class="champ"><label class="lbl" for="s-serv-dept">${D('departement')}</label><select id="s-serv-dept"><option value="">${D('sans_departement')}</option>${detail.departements.filter(d=>d.actif).map(d=>`<option value="${d.id}">${esc(d.nom)}</option>`).join('')}</select></div><div class="champ"><label class="lbl" for="s-serv-attrs">${D('attributs_json')}</label><input id="s-serv-attrs"></div><button class="btn" id="b-service">${D('ajouter_service')}</button></div>
        <div class="chips">${detail.services.map(s=>`<span class="chip">${esc(s.code)} · ${esc(s.nom)}${!s.actif?` · ${D('inactif')}`:''} <button class="btn discret" data-modifier="service" data-id="${s.id}">Modifier</button></span>`).join('')||`<span class="note">${D('aucun_service')}</span>`}</div>
        <div class="ligne"><div class="champ"><label class="lbl" for="s-floor-unit">${D('unite')}</label><select id="s-floor-unit">${detail.unites.map(x=>`<option value="${x.id}">${esc(x.nom)}</option>`).join('')}</select></div><div class="champ"><label class="lbl" for="s-floor-code">${D('code_etage')}</label><input id="s-floor-code"></div><div class="champ"><label class="lbl" for="s-floor-nom">${D('nom_etage')}</label><input id="s-floor-nom"></div><div class="champ"><label class="lbl" for="s-floor-aile">${D('aile')}</label><input id="s-floor-aile"></div><div class="champ"><label class="lbl" for="s-floor-attrs">${D('attributs_json')}</label><input id="s-floor-attrs"></div><button class="btn" id="b-floor">${D('ajouter_etage')}</button></div>
        <div class="chips">${detail.etages.map(g=>`<span class="chip">${esc(g.code)} · ${esc(g.nom)}${g.aile?` · ${esc(g.aile)}`:''}${g.actif?'':` · ${D('inactif')}`} <button class="btn discret" data-modifier="etage" data-id="${g.id}">Modifier</button></span>`).join('')||`<span class="note">${D('aucun_etage')}</span>`}</div>
      </details>
      <div class="ligne" style="margin-bottom:14px"><div class="champ"><label class="lbl" for="s-type">${D('type')}</label><select id="s-type">${cfg.types.map((ty) => `<option value="${ty.id}">${esc(nomType(ty))}</option>`).join('')}</select></div>
        <div class="champ"><label class="lbl" for="s-nom">${D('nom_unite')}</label><input id="s-nom" autocomplete="off"></div>
        <div class="champ"><label class="lbl" for="s-unite-dept">${D('departement')}</label><select id="s-unite-dept"><option value="">${D('sans_departement')}</option>${detail.departements.filter(d=>d.actif).map(d=>`<option value="${d.id}">${esc(d.nom)}</option>`).join('')}</select></div>
        <div class="champ"><label class="lbl" for="s-unite-service">${D('service')}</label><select id="s-unite-service"><option value="">${D('sans_departement')}</option>${detail.services.filter(s=>s.actif).map(s=>`<option value="${s.id}">${esc(s.nom)}</option>`).join('')}</select></div>
        <div class="champ"><label class="lbl" for="s-unite-attrs">${D('attributs_json')}</label><input id="s-unite-attrs"></div>
        <button class="btn pri" id="b-unite">${D('ajouter_unite')}</button></div>
      <div class="pile">${st.map((un) => `<div class="panneau-c"><div class="entete" style="margin:0"><h3><span class="donnee">${esc(un.nom)}</span> <span class="note">${esc(un.type_nom)}</span>${un.actif?'':` · ${D('inactif')}`} <button class="btn discret" data-modifier="unite" data-id="${un.id}">Modifier</button></h3>
          <div class="ligne"><input placeholder="${D('num_chambre')}" data-chnum="${un.id}" style="width:100px" aria-label="${D('num_chambre')}">
            <select data-chfloor="${un.id}" aria-label="${D('nom_etage')}"><option value="">${D('sans_etage')}</option>${detail.etages.filter(g=>g.unite_id===un.id&&g.actif).map(g=>`<option value="${g.id}">${esc(g.nom)}${g.aile?` · ${esc(g.aile)}`:''}</option>`).join('')}</select>
            <input placeholder="${D('type_chambre')}" data-chtype="${un.id}" style="width:120px" aria-label="${D('type_chambre')}">
            <input type="number" min="1" max="100" placeholder="${D('capacite_declaree')}" data-chcapacity="${un.id}" style="width:100px" aria-label="${D('capacite_declaree')}">
            <input placeholder="${D('attributs_json')}" data-chattributes="${un.id}" aria-label="${D('attributs_json')}"><input placeholder="Restrictions JSON" data-chrestrictions="${un.id}" aria-label="Restrictions JSON">
            <label class="case"><input type="checkbox" data-chaccess="${un.id}"> ${D('accessible')}</label><button class="btn" data-ch="${un.id}">${D('ajouter_chambre')}</button></div></div>
        ${un.chambres.map((ch) => { const meta=detailChambres.get(ch.id); return `<div class="item"><div style="flex:1 1 100%"><strong>${D('chambre', { n: ch.numero })}</strong>
          <div class="note">${esc(meta?.type_chambre||D('type_non_precise'))} · ${D('capacite_calculee',{n:meta?.lits_calcules??ch.lits.length})}${meta?.capacite_declaree?` / ${D('capacite_declaree',{n:meta.capacite_declaree})}`:''}${meta?.accessible?` · ${D('accessible')}`:''}${meta?.statut_operationnel&&meta.statut_operationnel!=='actif'?` · ${esc(D(meta.statut_operationnel))}`:''}${meta?.actif===false?` · ${D('inactif')}`:''} <button class="btn discret" data-modifier="chambre" data-id="${ch.id}">Modifier</button></div>
            <div class="liste" style="margin-top:6px">${ch.lits.map((l) => { const ml=detailLits.get(l.id); return `<div class="ligne" style="justify-content:space-between;gap:8px"><span class="num">${esc(l.code)} <span class="note">${esc(t(`etats.${l.etat}`))}${ml?.groupe_age&&ml.groupe_age!=='adulte'?` · ${esc(t(`fin.age_${ml.groupe_age}`))}`:''}${ml?.categorie?` · ${esc(ml.categorie)}`:''}${ml?.actif===false?` · ${D('inactif')}`:''}</span>${ml?.attributs&&Object.keys(ml.attributs).length?`<span class="note">${esc(JSON.stringify(ml.attributs))}</span>`:''}</span><button class="btn discret" data-modifier="lit" data-id="${l.id}">Modifier</button>
            <span class="cases">${BESOINS.map((k) => `<label class="case" title="${esc(t(`besoins.${k}`))}"><input type="checkbox" data-eq="${l.id}" data-k="${k}"${l[k] ? ' checked' : ''}> ${esc(t(`equipement_court.${k}`))}</label>`).join('')}</span></div>`; }).join('') || `<span class="note">${D('aucun_lit')}</span>`}</div>
          <div class="ligne" style="margin-top:6px"><input placeholder="${D('code_lit', { ex: `${un.type_code}-${ch.numero}C` })}" data-litcode="${ch.id}" style="width:180px" aria-label="${D('code_lit', { ex: '' })}">
            <input placeholder="${D('categorie_lit')}" data-litcat="${ch.id}" style="width:130px" aria-label="${D('categorie_lit')}">
            <select data-litage="${ch.id}" aria-label="${esc(t('fin.groupe_age'))}"><option value="">${esc(t('fin.age_selon_type'))}</option>${[...GROUPES_AGE, 'tous'].map((g) => `<option value="${g}">${esc(t(`fin.age_${g}`))}</option>`).join('')}</select>
            <input placeholder="${D('attributs_json')}" data-litattrs="${ch.id}" style="width:200px" aria-label="${D('attributs_json')}">${BESOINS.map(k=>`<label class="case"><input type="checkbox" data-new-eq="${ch.id}" data-k="${k}"> ${esc(t(`equipement_court.${k}`))}</label>`).join('')}<button class="btn" data-lit-ch="${ch.id}">${D('ajouter_lit')}</button></div></div></div>`; }).join('') || `<p class="note">${D('aucune_chambre')}</p>`}</div>`).join('')}</div>`;
    brancherNouvelEtab();
    const bm = $('#b-modules');
    if (bm) bm.onclick = (ev) => agir(ev.target, async () => {
      const modules = {}; corps.querySelectorAll('[data-module]').forEach((x) => { modules[x.dataset.module] = x.checked; });
      await api('PUT', `/admin/etablissements/${etat.ctx}/modules`, { modules, vocation: $('#s-vocation').value });
      etat.moi = await api('GET', '/moi'); appliquerModules();
    }, t('fin.modules_ok'));
    const lireJson = (el) => { try { return el?.value ? JSON.parse(el.value) : {}; } catch { throw new Error(t('admin.attributs_json_invalides')); } };
    $('#b-dept').onclick=(ev)=>agir(ev.target,()=>api('POST','/admin/departements',{etablissement_id:etat.ctx,code:$('#s-dept-code').value,nom:$('#s-dept-nom').value,attributs:lireJson($('#s-dept-attrs'))}),t('admin.departement_ok'));
    $('#b-service').onclick=(ev)=>agir(ev.target,()=>api('POST','/admin/services',{etablissement_id:etat.ctx,code:$('#s-serv-code').value,nom:$('#s-serv-nom').value,departement_id:$('#s-serv-dept').value||null,attributs:lireJson($('#s-serv-attrs'))}),t('admin.service_ok'));
    $('#b-floor').onclick=(ev)=>agir(ev.target,()=>api('POST','/admin/etages',{unite_id:Number($('#s-floor-unit').value),code:$('#s-floor-code').value,nom:$('#s-floor-nom').value,aile:$('#s-floor-aile').value,attributs:lireJson($('#s-floor-attrs'))}),t('admin.etage_ok'));
    $('#b-unite').onclick = (ev) => agir(ev.target, () => api('POST', '/admin/unites', { etablissement_id: etat.ctx, type_id: Number($('#s-type').value), nom: $('#s-nom').value,departement_id:$('#s-unite-dept').value||null,service_id:$('#s-unite-service').value||null,attributs:lireJson($('#s-unite-attrs')) }), t('admin.unite_ok'));
    corps.querySelectorAll('[data-ch]').forEach((b) => { b.onclick = () => { let attributs, restrictions; try { attributs=lireJson(corps.querySelector(`[data-chattributes="${b.dataset.ch}"]`)); restrictions=lireJson(corps.querySelector(`[data-chrestrictions="${b.dataset.ch}"]`)); } catch(e){toast(e.message,true);return;}
      return agir(b, () => api('POST', '/admin/chambres', { unite_id: Number(b.dataset.ch), numero: corps.querySelector(`[data-chnum="${b.dataset.ch}"]`).value,
      etage_id:corps.querySelector(`[data-chfloor="${b.dataset.ch}"]`).value||null,type_chambre:corps.querySelector(`[data-chtype="${b.dataset.ch}"]`).value,capacite_declaree:corps.querySelector(`[data-chcapacity="${b.dataset.ch}"]`).value||null,accessible:corps.querySelector(`[data-chaccess="${b.dataset.ch}"]`).checked,attributs,restrictions }), t('admin.chambre_ok')); }; });
    corps.querySelectorAll('[data-lit-ch]').forEach((b) => { b.onclick = () => {
      const attrs=corps.querySelector(`[data-litattrs="${b.dataset.litCh}"]`).value; let attributs={};
      try { attributs=attrs?JSON.parse(attrs):{}; } catch { toast(t('admin.attributs_json_invalides'),true); return; }
      const equip=Object.fromEntries([...corps.querySelectorAll(`[data-new-eq="${b.dataset.litCh}"]`)].map(x=>[x.dataset.k,x.checked]));
      return agir(b, () => api('POST', '/admin/lits', { chambre_id: Number(b.dataset.litCh), code: corps.querySelector(`[data-litcode="${b.dataset.litCh}"]`).value,categorie:corps.querySelector(`[data-litcat="${b.dataset.litCh}"]`).value,groupe_age:corps.querySelector(`[data-litage="${b.dataset.litCh}"]`).value||null,attributs,...equip }), t('admin.lit_ok'));
    }; });
    corps.querySelectorAll('[data-eq]').forEach((c) => { c.onchange = () => agir(null, () => api('PUT', `/admin/lits/${c.dataset.eq}/equipement`, { [c.dataset.k]: c.checked }), t('admin.equipement_ok')); });
    // Civières de l'urgence
    const civs = await api('GET', `/admin/civieres?etablissement_id=${etat.ctx}`);
    corps.insertAdjacentHTML('beforeend', `<div class="panneau-c" style="margin-top:14px"><h3>${D('civieres')}</h3><p class="note">${D('civieres_aide')}</p>
      <div class="chips">${civs.map((c) => `<span class="chip num">${esc(c.code)} · ${esc(t(`urgence.cat_${c.categorie}`))} · ${esc(t(`etats.${c.etat}`))}${c.actif?'':` · ${D('inactif')}`} <button class="btn discret" data-civiere-modifier="${c.id}">Modifier</button></span>`).join('') || `<span class="note">${D('aucune_civiere')}</span>`}</div>
      <div class="ligne"><div class="champ"><label class="lbl" for="s-civ-code">${D('code_civiere')}</label><input id="s-civ-code" placeholder="URG-01" autocomplete="off"></div>
        <div class="champ"><label class="lbl" for="s-civ-cat">${D('categorie')}</label><select id="s-civ-cat">${CAT_CIVIERES.map((k) => `<option value="${k}">${esc(t(`urgence.cat_${k}`))}</option>`).join('')}</select></div>
        <div class="champ"><label class="lbl" for="s-civ-unit">${D('unite')}</label><select id="s-civ-unit"><option value="">${D('sans_departement')}</option>${detail.unites.map(x=>`<option value="${x.id}">${esc(x.nom)}</option>`).join('')}</select></div>
        <div class="champ"><label class="lbl" for="s-civ-attrs">${D('attributs_json')}</label><input id="s-civ-attrs" placeholder='{"moniteur":true}'></div>
        <button class="btn" id="b-civiere">${D('ajouter_civiere')}</button></div></div>`);
    $('#b-civiere').onclick = (ev) => {
      let attributs={}; try { attributs=$('#s-civ-attrs').value?JSON.parse($('#s-civ-attrs').value):{}; } catch { toast(t('admin.attributs_json_invalides'),true); return; }
      return agir(ev.target, () => api('POST', '/admin/civieres', { etablissement_id: etat.ctx, code: $('#s-civ-code').value, categorie: $('#s-civ-cat').value,unite_id:$('#s-civ-unit').value||null,attributs }), t('admin.civiere_ok'));
    };
    const ressources = {departement:detail.departements,service:detail.services,unite:detail.unites,etage:detail.etages,chambre:detail.chambres,lit:detail.lits,civiere:civs};
    corps.querySelectorAll('[data-modifier]').forEach(b=>b.onclick=()=>modifierRessourceStructure(b.dataset.modifier,ressources[b.dataset.modifier].find(x=>x.id===Number(b.dataset.id)),{departements:detail.departements.filter(x=>x.actif),services:detail.services.filter(x=>x.actif),unites:detail.unites.filter(x=>x.actif),etages:detail.etages.filter(x=>x.actif)}));
    corps.querySelectorAll('[data-civiere-modifier]').forEach(b=>b.onclick=()=>modifierRessourceStructure('civiere',civs.find(x=>x.id===Number(b.dataset.civiereModifier)),{unites:detail.unites.filter(x=>x.actif)}));
  }

  if (etat.adminOnglet === 'config') {
    const cfgs = await api('GET', '/admin/config');
    const champs = ['rayon_km', 'vitesse_kmh', 'facteur_route', 'penalite_orange_km', 'penalite_rouge_km', 'horizon_h', 'seuil_jaune', 'seuil_orange',
      'seuil_rouge', 'attente_admission_max_min', 'nettoyage_cible_min', 'reservation_max_min', 'marge_conge_min', 'hors_service_max_h', 'confirmation_lit_validite_min', 'cible_nsa_pct',
      'seuil_civieres_jaune', 'seuil_civieres_orange', 'seuil_civieres_rouge', 'nettoyage_civiere_cible_min'];
    const niveaux = ['vert', 'jaune', 'orange', 'rouge'];
    const protocoles = (c, cle, attr) => niveaux.map((n) => `<div class="champ"><label class="lbl" for="${attr}-${c.id}-${n}">${esc(t(`niveaux.${n}`))}</label><textarea id="${attr}-${c.id}-${n}" data-${attr}="${n}" rows="2" class="donnee">${esc((c[cle] || {})[n] || '')}</textarea></div>`).join('');
    const catalogue = await api('GET', '/specialites');
    const blocSpecialites = (c) => { const presents = (etat.moi.configs.find((x) => x.id === c.id)?.types || []).map((x) => x.code);
      return `<div class="panneau-c"><h3>${esc(t('fin.specialites_titre'))}</h3><p class="note">${esc(t('fin.specialites_aide'))}</p><div class="chips">${catalogue.map((sp) => presents.includes(sp.code)
        ? `<span class="chip" aria-pressed="true">${esc(langue === 'en' ? sp.nom_en : sp.nom)} · ${esc(t(`fin.age_${sp.groupe_age}`))}</span>`
        : `<button class="chip" data-spec="${esc(sp.code)}" data-cfgspec="${c.id}">+ ${esc(langue === 'en' ? sp.nom_en : sp.nom)} · ${esc(t(`fin.age_${sp.groupe_age}`))}</button>`).join('')}</div></div>`; };
    corps.innerHTML = cfgs.map((c) => `${blocSpecialites(c)}<form class="panneau-c" data-cfg="${c.id}"><h3 class="donnee">${esc(c.nom)}</h3><div class="grille" style="gap:10px">${champs.map((k) => `<div class="champ"><label class="lbl" for="cfg-${c.id}-${k}">${D(`champs.${k}`)}</label><input id="cfg-${c.id}-${k}" data-k="${k}" value="${esc(c[k])}" inputmode="decimal"></div>`).join('')}</div>
      <h3>${D('protocoles')}</h3>${protocoles(c, 'protocoles', 'pr')}
      <h3>${D('protocoles_en')}</h3>${protocoles(c, 'protocoles_en', 'pren')}
      <button class="btn pri" type="submit">${esc(t('general.enregistrer'))}</button></form>`).join('');
    corps.querySelectorAll('[data-spec]').forEach((b) => { b.onclick = () => agir(b, async () => {
      await api('POST', '/admin/specialites', { config_id: Number(b.dataset.cfgspec), code: b.dataset.spec }); etat.moi = await api('GET', '/moi');
    }, t('fin.specialite_ok')); });
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
  if (etat.adminOnglet === 'import') await vueAdminImport(corps);
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

/* ---------------- Administration : nouvel établissement et import CSV ---------------- */
function formNouvelEtab() {
  const I = (k, vars) => esc(t(`import.${k}`, vars));
  return `<details class="panneau-c nouvel-etab"><summary><h3>${I('etab_titre')}</h3></summary><p class="note">${I('etab_aide')}</p>
    <div class="champ"><label class="lbl" for="ne-profil">${I('profil_hospitalier')}</label><select id="ne-profil" disabled><option value="">${I('profil_chargement')}</option></select></div>
    <div class="ligne"><div class="champ"><label class="lbl" for="ne-code">${I('etab_code')}</label><input id="ne-code" maxlength="12" autocomplete="off" placeholder="HOP-A"></div>
      <div class="champ"><label class="lbl" for="ne-nom">${I('etab_nom')}</label><input id="ne-nom" autocomplete="off"></div></div>
    <div class="ligne"><div class="champ"><label class="lbl" for="ne-ville">${I('etab_ville')}</label><input id="ne-ville" autocomplete="off"></div>
      <div class="champ"><label class="lbl" for="ne-adresse">${I('etab_adresse')}</label><input id="ne-adresse" autocomplete="off"></div></div>
    <div class="ligne"><div class="champ"><label class="lbl" for="ne-lat">${I('etab_lat')}</label><input id="ne-lat" inputmode="decimal" placeholder="${nb(45.4)}"></div>
      <div class="champ"><label class="lbl" for="ne-lon">${I('etab_lon')}</label><input id="ne-lon" inputmode="decimal" placeholder="${nb(-71.89, 2)}"></div>
      <button class="btn pri" id="b-ne-creer">${I('etab_creer')}</button></div></details>`;
}
function brancherNouvelEtab() {
  const b = $('#b-ne-creer');
  if (!b) return;
  const profil=$('#ne-profil');b.disabled=true;
  b.onclick = () => agir(b, async () => {
    if(!profil.value)throw new Error(t('erreurs.profil_pays_ambigu'));
    const e = await api('POST', '/admin/etablissements', {config_id:Number(profil.value), code: $('#ne-code').value, nom: $('#ne-nom').value, ville: $('#ne-ville').value,
      adresse: $('#ne-adresse').value, latitude: $('#ne-lat').value.replace(',', '.'), longitude: $('#ne-lon').value.replace(',', '.') });
    const premier = !etat.ctx;
    etat.moi = await api('GET', '/moi');
    etat.ctx = e.id; ecrire('arrimo-ctx', e.id); majSelecteurCtx();
    if (premier) { await demarrer(); allerA('admin'); }
    return e;
  }, (e) => t('import.etab_ok', { nom: e.nom }));
  return api('GET','/admin/config').then(profils=>{
    if(!profils.length)throw new Error(t('erreurs.profil_pays_absent'));
    profil.innerHTML=`<option value="">${esc(t('import.profil_choisir'))}</option>`+profils.map(p=>`<option value="${esc(p.id)}">${esc(p.nom)} (${esc(p.code)})</option>`).join('');
    profil.value=profils.length===1?String(profils[0].id):'';profil.disabled=false;b.disabled=false;
  }).catch(e=>toast(e.message,true));
}
const TYPES_IMPORT = ['unites', 'chambres', 'lits', 'civieres', 'utilisateurs'];
// Noms de colonnes des modèles : identifiants fixes du fichier, identiques dans les deux langues
const COLONNES_IMPORT = { unites: 'unite;type_unite', chambres: 'unite;chambre', lits: 'unite;chambre;lit;isolement;pression_negative;ventilation;telemetrie',
  civieres: 'civiere;categorie', utilisateurs: 'nom;courriel;role' };
etat.imports = {};
async function vueAdminImport(corps) {
  const I = (k, vars) => esc(t(`import.${k}`, vars));
  const carte = (type) => {
    const x = etat.imports[type] || {};
    const v = x.verif;
    let res = '';
    if (v && v.nb_erreurs) {
      res = `<div class="import-res erreur-res"><p><b>${I('erreurs_titre', { n: v.nb_erreurs })}</b></p><div class="tableau"><table><thead><tr><th>${I('th_ligne')}</th><th>${I('th_colonne')}</th><th>${I('th_probleme')}</th></tr></thead><tbody>
        ${v.erreurs.map((e) => `<tr><td class="num">${e.ligne}</td><td class="donnee">${esc(e.colonne || '—')}</td><td>${esc(t(`import.e.${e.code}`, { ...e.vars, colonne: e.colonne }))}</td></tr>`).join('')}</tbody></table></div></div>`;
    } else if (v) {
      res = `<div class="import-res"><p>${I('pret', { n: v.lignes })}</p><p class="note">${I('resume', { creer: v.resume.creer, maj: v.resume.maj, inchange: v.resume.inchange })}</p>
        <button class="btn pri" data-imp-importer="${type}"${v.resume.creer + v.resume.maj ? '' : ' disabled'}>${I('importer')}</button></div>`;
    }
    return `<div class="panneau-c import-carte"><div><h3>${I(`t_${type}`)}</h3><p class="note">${t(`import.d_${type}`, { colonnes: `<code class="donnee">${esc(COLONNES_IMPORT[type])}</code>` })}</p></div>
      <div class="ligne"><button class="btn" data-imp-modele="${type}">${icone('download')}${I('modele')}</button>
        <label class="btn">${I('choisir')}<input type="file" accept=".csv,text/csv" data-imp-fichier="${type}" hidden></label>
        <span class="note donnee">${esc(x.nom || '')}</span>
        <button class="btn pri" data-imp-verifier="${type}"${x.contenu ? '' : ' disabled'}>${I('verifier')}</button></div>${res}</div>`;
  };
  corps.innerHTML = `<p class="note">${t('admin.etab_courant', { etab: esc(etabCtx().nom) })}</p>
    <div class="panneau-c"><h3>${I('titre')}</h3><p>${I('intro')}</p><p class="note">${I('ordre')}</p></div>
    <div class="pile" style="margin-top:16px">${TYPES_IMPORT.map(carte).join('')}</div>`;
  corps.querySelectorAll('[data-imp-modele]').forEach((b) => {
    b.onclick = async () => {
      try {
        const r = await fetch(`/api/admin/import/modeles/${b.dataset.impModele}`, { headers: { Authorization: `Bearer ${etat.token}`, 'X-Langue': langue } });
        if (!r.ok) throw new Error(t('import.modele_impossible'));
        telecharger(await r.blob(), `arrimo-${b.dataset.impModele}.csv`);
      } catch (e) { toast(e.message, true); }
    };
  });
  corps.querySelectorAll('[data-imp-fichier]').forEach((inp) => {
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      if (f.size > 1024 * 1024) { toast(t('import.trop_gros'), true); return; }
      etat.imports[inp.dataset.impFichier] = { nom: f.name, contenu: await f.text() };
      rafraichir();
    };
  });
  corps.querySelectorAll('[data-imp-verifier]').forEach((b) => {
    const type = b.dataset.impVerifier;
    b.onclick = () => agir(b, async () => {
      etat.imports[type].verif = await api('POST', '/admin/import/verifier', { etablissement_id: etat.ctx, type, contenu: etat.imports[type].contenu });
    });
  });
  corps.querySelectorAll('[data-imp-importer]').forEach((b) => {
    const type = b.dataset.impImporter;
    b.onclick = () => agir(b, async () => {
      const x = etat.imports[type];
      const r = await api('POST', '/admin/import/importer', { etablissement_id: etat.ctx, type, contenu: x.contenu, empreinte: x.verif.empreinte });
      delete etat.imports[type];
      if (r.comptes && r.comptes.length) montrerComptes(r.comptes);
      return r;
    }, (r) => t('import.fait', { creer: r.resume.creer, maj: r.resume.maj }));
  });
}
/** Mots de passe temporaires des comptes créés : affichés une seule fois, liste téléchargeable une seule fois. */
function montrerComptes(comptes) {
  const I = (k, vars) => esc(t(`import.${k}`, vars));
  modale(t('import.comptes_titre', { n: comptes.length }), `<p class="note">${I('comptes_aide')}</p>
    <div class="tableau"><table><thead><tr><th>${I('th_nom')}</th><th>${I('th_courriel')}</th><th>${I('th_mdp')}</th></tr></thead><tbody>
    ${comptes.map((c) => `<tr><td class="donnee">${esc(c.nom)}</td><td class="donnee">${esc(c.courriel)}</td><td class="num">${esc(c.mot_de_passe_temporaire)}</td></tr>`).join('')}</tbody></table></div>`,
  [{ label: t('import.comptes_telecharger'), run: async () => {
    const csv = `\ufeffnom;courriel;role;mot_de_passe_temporaire\r\n${comptes.map((c) => [c.nom, c.courriel, c.role, c.mot_de_passe_temporaire].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n')}\r\n`;
    telecharger(new Blob([csv], { type: 'text/csv' }), 'arrimo-comptes-a-transmettre.csv');
    const b = [...document.querySelectorAll('#modale .actions .btn')].find((x) => x.textContent === t('import.comptes_telecharger'));
    if (b) { b.disabled = true; b.textContent = t('import.comptes_telecharge'); }
    return false;
  } }, { label: t('general.fermer'), pri: true }]);
}
function telecharger(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
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
/** Bandeau de l'environnement : démonstration (données fictives) ou recette (données de test) ; rien en production. */
function bandeauEnvironnement(env) {
  const b = $('#bandeau-demo');
  etat.environnement = env;
  b.hidden = !['demo', 'recette'].includes(env);
  b.classList.toggle('recette', env === 'recette');
  b.textContent = env === 'recette' ? t('barre.recette') : t('barre.demo');
}
fetch('/api/public').then((r) => r.json()).then((p) => {
  bandeauEnvironnement(p.environnement);
  $('#b-oubli').hidden = !p.mot_de_passe_oublie;
  // Lien propre d'un hôpital (hopital-x.<domaine>) : son nom à la connexion, son établissement à l'ouverture
  etat.lien = p.lien || null;
  $('#c-lien').hidden = !etat.lien;
  if (etat.lien) $('#c-lien').textContent = t('connexion.lien', { nom: etat.lien.nom });
}).catch(() => {});
(async () => {
  // Jeton dans le fragment : il n'est pas transmis au serveur et n'apparaît pas dans ses journaux.
  // Accepte encore l'ancien paramètre de requête pour les liens de récupération non expirés.
  const reinit = new URLSearchParams(location.hash.slice(1)).get('reinit') || new URLSearchParams(location.search).get('reinit');
  if (reinit) {
    jetonReinit = reinit;
    history.replaceState(null, '', location.pathname + location.search.replace(/([?&])reinit=[^&]*/, '$1').replace(/[?&]$/, ''));
    history.replaceState(null, '', location.pathname);
    montrerFormulaire('#f-reinit');
    $('#r-nouveau').focus();
    return;
  }
  etat.token = lire('arrimo-token');
  if (!etat.token) { $('#ecran-connexion').hidden = false; return; }
  try { await demarrer(); } catch { deconnecter(true); }
})();
