/* Arrimo — interface. Toutes les règles sont appliquées par le serveur. */
'use strict';

const ETATS = { libre: 'Libre', reserve: 'Réservé', occupe: 'Occupé', nettoyage: 'Nettoyage', indispo: 'Indisponible' };
const ORDRE_ETATS = ['libre', 'reserve', 'occupe', 'nettoyage', 'indispo'];
const ACTIONS = {
  libre: [['reserver', 'Réserver', true], ['hors_service', 'Hors service']],
  reserve: [['admettre', 'Admettre', true], ['annuler', 'Annuler']],
  occupe: [['liberer', 'Libérer (départ)', true], ['conge', 'Congé'], ['nsa', 'NSA']],
  nettoyage: [['nettoyage_ok', 'Confirmer le nettoyage', true]],
  indispo: [['remettre', 'Remettre en service', true]],
};
const STATUTS = [['demande', 'Demande', 'var(--attention)'], ['validee', 'Validée', 'var(--secondaire)'],
  ['transport', 'Transport organisé', 'var(--info)'], ['en_route', 'En transfert', 'var(--principal)'],
  ['recu', 'Reçu', 'var(--succes)'], ['refuse', 'Refusé', 'var(--critique)']];
const PARTAGE = { complet: 'Partage complet', agrege: 'Partage agrégé', aucun: 'Aucun partage' };
const ORIENTATIONS = { chsld: 'CHSLD', ri: 'Ressource intermédiaire', readaptation: 'Réadaptation', domicile: 'Retour à domicile avec soutien', palliatif: 'Soins palliatifs', autre: 'Autre' };
const MOTIFS = { personnel: 'Manque de personnel', equipement: 'Équipement', travaux: 'Travaux', infection: 'Contrôle des infections', autre: 'Autre' };
const CONGES = { prevu: 'Prévu', confirme: 'Confirmé', attente_transport: 'En attente de transport' };
const BESOINS = { isolement: 'Isolement', pression_negative: 'Pression négative', ventilation: 'Ventilation', telemetrie: 'Télémétrie' };
const NIVEAUX = { vert: 'Vert', jaune: 'Jaune', orange: 'Orange', rouge: 'Rouge' };
const PRIOS = { 1: 'Urgent', 2: 'Important', 3: 'À faire' };

const etat = {
  token: null, moi: null, ctx: null, vue: 'copilote', filtreUnite: '*', jours: 30,
  recherche: { type_id: null, patient_ref: '', urgent: true, res: null, choix: null, besoins: {} },
  question: '', reponse: '',
};
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lire = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const ecrire = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };

function depuis(iso) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
  return `${Math.floor(h / 24)} j`;
}
const heure = (iso) => new Date(iso).toLocaleString('fr-CA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function toast(msg, err) {
  const el = document.createElement('div');
  el.className = `toast${err ? ' err' : ''}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), err ? 7000 : 4500);
}

/* ---------------- API ---------------- */
async function api(methode, chemin, corps) {
  const r = await fetch(`/api${chemin}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...(etat.token ? { Authorization: `Bearer ${etat.token}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* réponse vide */ }
  if (r.status === 401 && etat.token) { deconnecter(true); }
  if (!r.ok) throw new Error((data && data.erreur) || `Erreur ${r.status}`);
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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#modale').hidden = true; $('#panneau-notif').hidden = true; } });

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
  ['#f-connexion', '#f-2fa', '#f-mdp-temp'].forEach((f) => { $(f).hidden = f !== sel; });
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
    if (/expirée|essais/.test(ex.message)) setTimeout(() => montrerFormulaire('#f-connexion'), 1800);
  }
});
$('#b-retour-connexion').onclick = () => montrerFormulaire('#f-connexion');
$('#f-mdp-temp').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#t-erreur'); err.hidden = true;
  try {
    if ($('#t-nouveau').value !== $('#t-confirme').value) throw new Error('Les deux mots de passe ne correspondent pas.');
    await api('PUT', '/moi/mot-de-passe', { actuel: $('#t-actuel').value, nouveau: $('#t-nouveau').value });
    ['#t-actuel', '#t-nouveau', '#t-confirme'].forEach((x) => { $(x).value = ''; });
    toast('Mot de passe enregistré.');
    await demarrer();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});

function deconnecter(expire) {
  if (etat.token && !expire) api('POST', '/deconnexion').catch(() => {});
  etat.token = null;
  ecrire('arrimo-token', null);
  montrerFormulaire('#f-connexion');
  if (expire) { $('#c-erreur').textContent = 'Session expirée. Reconnectez-vous.'; $('#c-erreur').hidden = false; }
}
$('#b-deconnexion').onclick = () => deconnecter(false);
$('#b-compte').onclick = () => allerA('compte');
function allerA(vue) {
  etat.vue = vue;
  document.querySelectorAll('#onglets button').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.v === vue)));
  document.querySelectorAll('.contenu > section').forEach((sec) => { sec.hidden = sec.id !== `v-${vue}`; });
  rafraichir();
}

async function demarrer() {
  etat.moi = await api('GET', '/moi');
  if (etat.moi.utilisateur.mdp_temporaire) { montrerFormulaire('#f-mdp-temp'); $('#t-actuel').focus(); return; }
  const etabs = etat.moi.etablissements;
  $('#nom-utilisateur').textContent = `${etat.moi.utilisateur.nom}${etat.moi.utilisateur.role === 'gestionnaire' ? ' · gestionnaire réseau' : ''}`;
  if (!etabs.length) {
    $('#ecran-connexion').hidden = false;
    $('#c-erreur').textContent = 'Votre compte n’est rattaché à aucun établissement. Contactez votre gestionnaire.';
    $('#c-erreur').hidden = false;
    return;
  }
  const memo = Number(lire('arrimo-ctx'));
  etat.ctx = etabs.some((e) => e.id === memo) ? memo : (etabs.find((e) => e.module_actif) || etabs[0]).id;
  $('#ctx').innerHTML = etabs.map((e) => `<option value="${e.id}">${esc(e.nom)}${e.module_actif ? '' : ' (module désactivé)'}</option>`).join('');
  $('#ctx').value = etat.ctx;
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
}
const estEntretien = () => etat.moi && etat.moi.utilisateur.role === 'entretien';

$('#ctx').onchange = async (e) => {
  etat.ctx = Number(e.target.value);
  ecrire('arrimo-ctx', etat.ctx);
  etat.filtreUnite = '*';
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
    bandeau.innerHTML = e.module_actif ? '' : `<div>Le module n'est pas activé pour <b>${esc(e.nom)}</b>. L'activation se fait depuis SH. Vous pouvez consulter, mais pas agir.</div>`;
    await Promise.all([majCompteurs(), ({
      copilote: vueCopilote, reseau: vueReseau, lits: vueLits, admissions: vueAdmissions, transferts: vueTransferts,
      nettoyage: vueNettoyage, nsa: vueNsa, indicateurs: vueIndicateurs, journal: vueJournal, params: vueParams,
      admin: vueAdmin, compte: vueCompte,
    })[etat.vue]()]);
  } catch (err) {
    if (etat.token) toast(err.message, true);
  } finally {
    enCours = false;
  }
}
setInterval(() => { if ($('#modale').hidden && document.visibilityState === 'visible') rafraichir(); }, 30000);

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
  $('#n-tr').textContent = trs.filter((t) => !['recu', 'refuse'].includes(t.statut)).length;
  etat.notifs = notifs;
}
$('#b-notif').onclick = async () => {
  const p = $('#panneau-notif');
  if (!p.hidden) { p.hidden = true; return; }
  const n = etat.notifs || [];
  p.innerHTML = `<div class="entete"><h3>Notifications</h3><button class="btn" id="b-fermer-notif">Fermer</button></div>${
    n.length ? n.map((x) => `<div class="notif${x.lu ? '' : ' nouvelle'}"><div>${esc(x.message)}</div><div class="note">${heure(x.date)}</div></div>`).join('')
      : '<p class="note">Aucune notification.</p>'}`;
  p.hidden = false;
  $('#b-fermer-notif').onclick = () => { p.hidden = true; };
  if (n.some((x) => !x.lu)) { await api('POST', '/notifications/lues', { etablissement_id: etat.ctx }).catch(() => {}); majCompteurs(); }
};

/* ---------------- Réseau ---------------- */
function barre(rep, total) {
  if (!rep) return '<div class="barre-c"></div>';
  return `<div class="barre-c">${ORDRE_ETATS.map((k) => (rep[k] ? `<i class="f-${k}" style="width:${(rep[k] / total) * 100}%" title="${ETATS[k]} : ${rep[k]}"></i>` : '')).join('')}</div>`;
}

async function vueReseau() {
  const v = $('#v-reseau');
  const e = etabCtx();
  if (!e.module_actif) { v.innerHTML = '<p class="note">La capacité du réseau est disponible une fois le module activé.</p>'; return; }
  const cfg = configCtx();
  const R = etat.recherche;
  if (!R.type_id || !cfg.types.some((t) => t.id === R.type_id)) R.type_id = cfg.types[0]?.id;
  const [res, blocages] = await Promise.all([
    api('GET', `/reseau?depuis=${etat.ctx}`),
    api('GET', `/blocages?etablissement_id=${etat.ctx}`),
  ]);

  const resume = cfg.types.map((t) => {
    let libres = 0; let dotes = 0;
    res.etablissements.forEach((x) => x.unites.filter((u) => u.type_id === t.id).forEach((u) => { libres += u.libres; dotes += u.dotes; }));
    return `<div><span class="lbl">${esc(t.nom)}</span><span class="gros mono">${libres} <small>libres / ${dotes}</small></span><span class="note">Occupation ${dotes ? Math.round(((dotes - libres) / dotes) * 100) : 0} %</span></div>`;
  }).join('');

  let resHTML = '';
  if (R.res) {
    resHTML = R.res.suggestions.length ? R.res.suggestions.map((s) => {
      const choisi = R.choix && R.choix.etablissement_id === s.etablissement_id;
      return `<div class="item${choisi ? ' choisi' : ''}"><div><strong>${esc(s.nom)}</strong>${s.recommande ? ' <span class="badge fort">Recommandé</span>' : ''}${!s.libres ? ' <span class="badge">Prévision seulement</span>' : ''}
        <div class="note">${esc(s.ville)}${s.partage === 'agrege' ? ' · lit attribué par le receveur' : s.lit ? ` · lit ${esc(s.lit.code)}` : ''}</div>
        <div class="note mono">${esc(s.raison)}</div>${s.pourquoi ? `<div class="note">${esc(s.pourquoi)}</div>` : ''}</div>
        ${s.libres ? `<button class="btn${choisi ? ' pri' : ''}" data-choix="${s.etablissement_id}">${choisi ? 'Proposé' : 'Proposer'}</button>` : ''}</div>`;
    }).join('') : `<p class="note">Aucun lit libre ni prévu dans un rayon de ${cfg.rayon_km} km parmi les établissements qui partagent leur capacité.</p>`;
    resHTML = `<p class="note">Chez vous : ${R.res.libres_ici} lit(s) libre(s) de ce type.</p><div class="liste">${resHTML}</div>`;
  }
  let confirmHTML = '';
  if (R.choix) {
    confirmHTML = `<div class="confirmer"><span class="lbl">Validation humaine requise</span>
      <div>Réserver ${R.choix.lit ? `le lit <b class="mono">${esc(R.choix.lit.code)}</b>` : 'un lit'} à <b>${esc(R.choix.nom)}</b> pour <b class="mono">${esc(R.patient_ref || '—')}</b>${R.urgent ? ' <span class="urgent">Urgent</span>' : ''}.</div>
      <div class="note">À la validation : le lit est bloqué, la référence est transmise, le receveur est notifié et la demande de transfert est créée.</div>
      <div class="ligne"><button class="btn pri" id="b-valider">Valider et réserver</button><button class="btn" id="b-annuler-choix">Annuler</button></div></div>`;
  }

  const blocHTML = blocages.length ? blocages.map((b) => {
    const act = b.etat === 'nettoyage' ? ['nettoyage_ok', 'Confirmer le nettoyage'] : b.etat === 'reserve' ? ['annuler', 'Annuler la réservation'] : b.etat === 'indispo' ? ['remettre', 'Remettre en service'] : null;
    return `<div class="item"><div><span class="risque ${b.blocage_niveau}">${{ eleve: 'Prioritaire', modere: 'À vérifier', faible: 'Info' }[b.blocage_niveau]}</span> <b class="mono">${esc(b.code)}</b><div class="note">${esc(b.blocage_motif)}</div></div>
      ${act ? `<button class="btn" data-lit="${b.id}" data-action="${act[0]}" data-version="${b.version}">${act[1]}</button>` : ''}</div>`;
  }).join('') : '<p class="note">Aucun blocage détecté.</p>';

  const etabsHTML = res.etablissements.map((x) => `<article class="etab${x.moi ? ' moi' : ''}"><header><div><h3>${esc(x.nom)}</h3>
      <span class="note">${esc(x.ville || '')}${x.moi ? '' : ` · <span class="mono">${x.distance_km} km</span>`}</span></div>
      <div>${x.moi ? '<span class="badge fort">Votre établissement</span>' : `<span class="badge">${PARTAGE[x.partage]}</span>`}</div></header>
      <div class="unites">${x.unites.map((u) => `<div class="unite"><span>${esc(u.type_nom)}</span>${barre(u.repartition, u.dotes + (u.repartition?.indispo || 0))}
        <span class="mono">${u.libres} / ${u.dotes}${u.prevus != null ? ` <small class="muted" title="Prévus libres">+${u.prevus}</small>` : ''}</span>
        <span class="risque ${u.risque}" title="Risque de saturation">${{ eleve: 'Saturation', modere: 'Tension', faible: 'Disponible' }[u.risque]}</span></div>`).join('')}</div>
      ${x.partage === 'agrege' && !x.moi ? '<p class="note" style="margin:8px 0 0">Cet établissement partage seulement le nombre de lits libres.</p>' : ''}</article>`).join('');

  v.innerHTML = `<div class="entete"><div><h2>Capacité du réseau</h2><p>Lits dotés en personnel, vus depuis ${esc(e.nom)}. Le chiffre « +n » indique les lits qui devraient se libérer d’ici ${cfg.horizon_h} h.</p></div>
    <div class="legende">${ORDRE_ETATS.map((k) => `<span><i class="f-${k}"></i>${ETATS[k]}</span>`).join('')}</div></div>
    <div class="resume">${resume}</div>
    <div class="deux"><div class="pile">
      <div class="panneau-c"><div><h3>Chercher un lit ailleurs</h3><p class="note">Classement selon les lits libres, les lits prévus, la tension et la distance. Rien n’est réservé sans validation.</p></div>
        <div class="ligne"><div class="champ"><label class="lbl" for="r-type">Type d’unité</label><select id="r-type">${cfg.types.map((t) => `<option value="${t.id}"${t.id === R.type_id ? ' selected' : ''}>${esc(t.nom)}</option>`).join('')}</select></div>
        <div class="champ"><label class="lbl" for="r-pat">Référence patient</label><input id="r-pat" placeholder="${esc(cfg.reference_exemple)}" value="${esc(R.patient_ref)}" autocomplete="off"></div></div>
        <div class="cases">${Object.entries(BESOINS).map(([k, l]) => `<label class="case"><input type="checkbox" data-besoin="${k}"${R.besoins[k] ? ' checked' : ''}> ${l}</label>`).join('')}</div>
        <div class="ligne" style="justify-content:space-between"><label class="case"><input type="checkbox" id="r-urg"${R.urgent ? ' checked' : ''}> Urgent</label><button class="btn pri" id="b-chercher">Rechercher</button></div>
        ${resHTML}${confirmHTML}</div>
      <div class="panneau-c"><div><h3>Blocages détectés</h3><p class="note">Lits qui ne tournent pas alors qu’ils le devraient. Mise à jour toutes les 15 minutes.</p></div><div class="liste">${blocHTML}</div></div>
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
    }, (tr) => `Lit ${tr.lit_code} bloqué. Demande ${tr.numero} envoyée au receveur.`);
  }
  const an = $('#b-annuler-choix');
  if (an) an.onclick = () => { R.choix = null; rafraichir(); };
  brancherActionsLit(v);
  v.querySelectorAll('[data-besoin]').forEach((c) => { c.onchange = () => { R.besoins[c.dataset.besoin] = c.checked; R.res = null; R.choix = null; }; });
}

/* ---------------- Lits ---------------- */
function brancherActionsLit(racine) {
  racine.querySelectorAll('[data-lit]').forEach((b) => {
    b.onclick = () => {
      const id = Number(b.dataset.lit);
      const action = b.dataset.action;
      const version = Number(b.dataset.version);
      const code = b.dataset.code || '';
      const cfg = configCtx();
      if (action === 'reserver') {
        modale(`Réserver ${code}`, `<div class="champ"><label class="lbl" for="m-pat">Référence patient</label><input id="m-pat" placeholder="${esc(cfg.reference_exemple)}" autocomplete="off"></div>
          <p class="note">Référence seulement. N’inscrivez aucune information médicale.</p>`,
        [{ label: 'Annuler' }, { label: 'Réserver', pri: true, run: async () => (await agir(null, () => api('POST', `/lits/${id}/action`, { action, version, patient_ref: $('#m-pat').value.trim() }), `Lit ${code} réservé.`)) !== null || false }]);
        return;
      }
      if (action === 'conge') {
        modale(`Congé · ${code}`, `<div class="champ"><label class="lbl" for="m-conge-statut">Statut</label><select id="m-conge-statut"><option value="">Aucun</option>${Object.entries(CONGES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
          <div class="champ"><label class="lbl" for="m-conge">Date et heure prévues</label><input id="m-conge" type="datetime-local"></div>
          <p class="note">Sert à prévoir les lits qui vont se libérer et à repérer les congés dépassés.</p>`,
        [{ label: 'Annuler' }, { label: 'Enregistrer', pri: true, run: async () => {
          const val = $('#m-conge').value;
          const statut = $('#m-conge-statut').value || null;
          const corps = { statut };
          if (val) corps.sortie_prevue = new Date(val).toISOString();
          return (await agir(null, () => api('PUT', `/lits/${id}/conge`, corps), 'Congé enregistré.')) !== null || false;
        } }]);
        return;
      }
      if (action === 'nsa') {
        modale(`Désigner NSA · ${code}`, `<p class="note">Le patient n’a plus besoin de soins aigus et attend une autre ressource.</p>
          <div class="champ"><label class="lbl" for="m-orient">Orientation attendue</label><select id="m-orient">${Object.entries(ORIENTATIONS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>`,
        [{ label: 'Annuler' }, { label: 'Désigner', pri: true, run: async () => (await agir(null, () => api('POST', `/lits/${id}/nsa`, { orientation: $('#m-orient').value }), `${code} désigné NSA.`)) !== null || false }]);
        return;
      }
      if (action === 'retirer_nsa') {
        agir(b, () => api('DELETE', `/lits/${id}/nsa`), `Statut NSA retiré pour ${code}.`);
        return;
      }
      if (action === 'hors_service') {
        modale(`Mettre ${code} hors service`, `<div class="champ"><label class="lbl" for="m-motif-i">Motif</label><select id="m-motif-i">${Object.entries(MOTIFS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
          <p class="note">Les lits fermés faute de personnel sont comptés à part : c’est de la capacité perdue.</p>`,
        [{ label: 'Annuler' }, { label: 'Mettre hors service', pri: true, run: async () => (await agir(null, () => api('POST', `/lits/${id}/action`, { action, version, motif: $('#m-motif-i').value }), `${code} hors service.`)) !== null || false }]);
        return;
      }
      agir(b, () => api('POST', `/lits/${id}/action`, { action, version }), (l) => `${l.code} : ${ETATS[l.etat]}`);
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
    return `<div class="col e-${st}"><h3>${ETATS[st]} <span class="mono">${items.length}</span></h3>${items.map((l) => `<div class="fiche e-${st}">
      <div class="t"><b>${esc(l.code)}</b><span class="note mono" title="Dans cet état depuis">${depuis(l.etat_depuis)}</span></div>
      <div class="note">${esc(l.unite)} · chambre ${esc(l.chambre)}</div>
      ${l.patient_ref ? `<div class="note">Patient <span class="mono">${esc(l.patient_ref)}</span>${l.transfert_numero ? ` · ${esc(l.transfert_numero)}` : ''}</div>` : ''}
      ${attributs(l)}
      ${l.nsa_depuis ? `<div><span class="nsa-tag">NSA · ${depuis(l.nsa_depuis)} · ${esc(ORIENTATIONS[l.nsa_orientation] || '')}</span></div>` : ''}
      ${l.sortie_prevue ? `<div class="note">Congé ${esc(CONGES[l.conge_statut] || 'prévu').toLowerCase()} · ${heure(l.sortie_prevue)}</div>` : ''}
      ${l.motif_indispo ? `<div class="note">Motif : ${esc(MOTIFS[l.motif_indispo])}</div>` : ''}
      ${l.blocage_motif ? `<div class="alerte">${esc(l.blocage_motif)}</div>` : ''}
      ${actif ? `<div class="actions">${ACTIONS[st].map(([a, lib, p]) => (a === 'nsa' && l.nsa_depuis ? ['retirer_nsa', 'Retirer NSA', false] : [a, lib, p])).map(([a, lib, p]) => `<button class="btn${p ? ' pri' : ''}" data-lit="${l.id}" data-action="${a}" data-version="${l.version}" data-code="${esc(l.code)}">${lib}</button>`).join('')}</div>` : ''}
    </div>`).join('') || '<div class="vide">Aucun lit</div>'}</div>`;
  }).join('');
  v.innerHTML = `<div class="entete"><div><h2>Lits · ${esc(etabCtx().nom)}</h2><p>Cycle : libre, réservé, occupé, nettoyage, puis libre après confirmation. Chaque changement est journalisé.</p></div></div>
    <div class="chips"><button class="chip" aria-pressed="${etat.filtreUnite === '*'}" data-u="*">Toutes les unités</button>${unites.map(([id, nom]) => `<button class="chip" aria-pressed="${String(etat.filtreUnite) === String(id)}" data-u="${id}">${esc(nom)}</button>`).join('')}</div>
    <div class="kanban">${cols}</div>`;
  v.querySelectorAll('[data-u]').forEach((c) => { c.onclick = () => { etat.filtreUnite = c.dataset.u; rafraichir(); }; });
  brancherActionsLit(v);
}

/* ---------------- Transferts ---------------- */
function actionsTransfert(t) {
  const a = [];
  const dest = t.destination_id === etat.ctx;
  const orig = t.origine_id === etat.ctx;
  if (t.statut === 'demande' && dest) a.push(['accepter', 'Accepter', true]);
  if (['demande', 'validee'].includes(t.statut) && dest) a.push(['refuser', 'Refuser']);
  if (t.statut === 'validee' && orig) a.push(['transport', 'Organiser le transport', true]);
  if (t.statut === 'transport' && orig) a.push(['depart', 'Confirmer le départ', true]);
  if (t.statut === 'en_route' && dest) a.push(['reception', 'Confirmer la réception', true]);
  return a;
}
function attente(t) {
  const cote = { demande: 'destination', validee: 'origine', transport: 'origine', en_route: 'destination' }[t.statut];
  if (!cote) return '';
  const id = cote === 'origine' ? t.origine_id : t.destination_id;
  return id === etat.ctx ? '' : `En attente de ${cote === 'origine' ? t.origine_nom : t.destination_nom}`;
}
async function vueTransferts() {
  const v = $('#v-transferts');
  const trs = await api('GET', `/transferts?etablissement_id=${etat.ctx}`);
  const actif = etabCtx().module_actif;
  const cols = STATUTS.map(([k, lib, c]) => {
    const items = trs.filter((t) => t.statut === k);
    return `<div class="col" style="--c:${c}"><h3>${lib} <span class="mono">${items.length}</span></h3>${items.map((t) => `<div class="fiche" style="--c:${t.urgent ? 'var(--critique)' : 'var(--secondaire)'}">
      <div class="t"><b>${esc(t.numero)}</b>${t.urgent ? '<span class="urgent">Urgent</span>' : `<span class="note">${t.destination_id === etat.ctx ? 'Entrant' : 'Sortant'}</span>`}</div>
      <div style="font-size:12px">${esc(t.origine_nom)} → ${esc(t.destination_nom)}</div>
      <div class="note">${esc(t.type_nom)} · lit <span class="mono">${esc(t.lit_code || '—')}</span> · <span class="mono">${esc(t.patient_ref)}</span></div>
      <div class="note"><span class="mono">${t.distance_km ?? '—'} km</span> · ${depuis(t.date_demande)}${t.transport_info ? ` · ${esc(t.transport_info)}` : ''}</div>
      ${t.motif_refus ? `<div class="note">Motif : ${esc(t.motif_refus)}</div>` : ''}
      ${attente(t) ? `<div class="note">${esc(attente(t))}</div>` : ''}
      ${actif ? `<div class="actions">${actionsTransfert(t).map(([a, l, p]) => `<button class="btn${p ? ' pri' : ''}${a === 'refuser' ? ' dan' : ''}" data-tr="${t.id}" data-etape="${a}" data-num="${esc(t.numero)}">${l}</button>`).join('')}</div>` : ''}
    </div>`).join('') || '<div class="vide">Aucun transfert</div>'}</div>`;
  }).join('');
  v.innerHTML = `<div class="entete"><div><h2>Transferts · ${esc(etabCtx().nom)}</h2><p>Seuls les transferts qui concernent votre établissement sont visibles. Chaque étape revient au bon établissement.</p></div></div><div class="kanban">${cols}</div>`;
  v.querySelectorAll('[data-tr]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.tr; const etape = b.dataset.etape; const num = b.dataset.num;
      if (etape === 'refuser') {
        modale(`Refuser ${num}`, `<div class="champ"><label class="lbl" for="m-motif">Motif (facultatif)</label><input id="m-motif" maxlength="300" autocomplete="off"></div>
          <p class="note">Le lit redeviendra libre et le demandeur sera notifié.</p>`,
        [{ label: 'Retour' }, { label: 'Refuser le transfert', pri: true, run: async () => (await agir(null, () => api('POST', `/transferts/${id}/refuser`, { motif: $('#m-motif').value }), `${num} refusé.`)) !== null || false }]);
        return;
      }
      agir(b, () => api('POST', `/transferts/${id}/${etape}`), { accepter: `${num} validé. Le demandeur est notifié.`, transport: 'Transport demandé.', depart: 'Départ confirmé. Le receveur est notifié.', reception: 'Réception confirmée. Le lit est occupé.' }[etape]);
    };
  });
}

/* ---------------- Journal ---------------- */
async function vueJournal() {
  const lignes = await api('GET', `/journal?etablissement_id=${etat.ctx}`);
  $('#v-journal').innerHTML = `<div class="entete"><div><h2>Journal · ${esc(etabCtx().nom)}</h2><p>Qui a changé quoi, et quand. Les tentatives refusées sont aussi conservées. Ce journal ne peut être ni modifié ni supprimé.</p></div></div>
    <div class="tableau"><table><thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Lit</th><th>Changement</th><th>Détail</th><th>Transfert</th></tr></thead><tbody>${
  lignes.map((j) => `<tr><td class="mono">${heure(j.date)}</td><td>${esc(j.utilisateur || 'Système')}</td><td${j.refuse ? ' class="refuse"' : ''}>${esc(j.action)}</td>
      <td class="mono">${esc(j.lit_code || '')}</td><td>${j.ancien_etat || j.nouvel_etat ? `${ETATS[j.ancien_etat] || '—'} → ${ETATS[j.nouvel_etat] || '—'}` : ''}</td>
      <td>${esc(j.detail || '')}</td><td class="mono">${esc(j.transfert_numero || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Aucune entrée.</td></tr>'
}</tbody></table></div>`;
}

/* ---------------- Paramètres ---------------- */
async function vueParams() {
  const cfg = configCtx();
  const gest = etat.moi.utilisateur.role === 'gestionnaire';
  const etabs = etat.moi.etablissements.filter((e) => e.config_id === cfg.id);
  $('#v-params').innerHTML = `<div class="entete"><div><h2>Paramètres</h2><p>Configuration du pays et activation par établissement. Ces valeurs sont lues par le module ; aucune n’est codée en dur.</p></div></div>
    <div class="grille">
      <div class="panneau-c"><h3>Configuration · ${esc(cfg.nom)}</h3><dl>
        <dt>Types d’unité</dt><dd>${cfg.types.map((t) => esc(t.nom)).join(', ')}</dd>
        <dt>Rayon de suggestion</dt><dd class="mono">${cfg.rayon_km} km</dd>
        <dt>Horizon de prévision</dt><dd class="mono">${cfg.horizon_h} h</dd>
        <dt>Nettoyage cible</dt><dd class="mono">${cfg.nettoyage_cible_min} min</dd>
        <dt>Réservation sans admission</dt><dd class="mono">${cfg.reservation_max_min} min max</dd>
        <dt>Congé dépassé</dt><dd class="mono">après ${cfg.marge_conge_min} min</dd>
        <dt>Hors service</dt><dd class="mono">${cfg.hors_service_max_h} h max</dd>
        <dt>Référence patient</dt><dd>${esc(cfg.reference_exemple)} (aucune donnée clinique)</dd>
        <dt>Transport</dt><dd>${esc(cfg.transport_libelle)}</dd></dl></div>
      <div class="panneau-c"><h3>Cycle d’un lit</h3><div class="cycle"><span class="pill f-libre">Libre</span>→<span class="pill f-reserve">Réservé</span>→<span class="pill f-occupe">Occupé</span>→<span class="pill f-nettoyage">Nettoyage</span>→<span class="pill f-libre">Libre</span></div>
        <p class="note">Hors service est possible depuis Libre et revient à Libre. Un lit ne peut être pris qu’une fois : une réservation concurrente est refusée et journalisée.</p></div>
      <div class="panneau-c"><h3>Établissements</h3><div>${etabs.map((e) => `<div class="reglage"><div><div>${esc(e.nom)}</div><div class="note">${PARTAGE[e.partage]} · ${e.module_actif ? 'module activé' : 'module désactivé'}</div></div>
        ${gest ? `<div class="ligne"><select data-partage="${e.id}" aria-label="Partage">${Object.entries(PARTAGE).map(([k, l]) => `<option value="${k}"${k === e.partage ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn${e.module_actif ? '' : ' pri'}" data-activer="${e.id}" data-val="${!e.module_actif}">${e.module_actif ? 'Désactiver' : 'Activer'}</button></div>` : ''}</div>`).join('')}</div>
        <p class="note">${gest ? 'En production, l’activation est pilotée par SH via l’API sécurisée.' : 'L’activation et le partage se gèrent depuis SH.'}</p></div>
    </div>`;
  const recharger = async () => { etat.moi = await api('GET', '/moi'); };
  document.querySelectorAll('[data-activer]').forEach((b) => {
    b.onclick = () => agir(b, async () => { await api('PUT', `/admin/etablissements/${b.dataset.activer}`, { module_actif: b.dataset.val === 'true' }); await recharger(); }, 'Établissement mis à jour.');
  });
  document.querySelectorAll('[data-partage]').forEach((s) => {
    s.onchange = () => agir(s, async () => { await api('PUT', `/admin/etablissements/${s.dataset.partage}`, { partage: s.value }); await recharger(); }, 'Partage mis à jour.');
  });
}


/* ---------------- outils v2 ---------------- */
const qsBesoins = (b) => Object.entries(b || {}).filter(([, v]) => v).map(([k]) => `&${k}=1`).join('');
function attributs(l) {
  const a = [['isolement', 'ISO'], ['pression_negative', 'PN'], ['ventilation', 'VENT'], ['telemetrie', 'TÉLÉ']].filter(([k]) => l[k]);
  return a.length ? `<div class="attr" title="Équipement du lit">${a.map(([k, x]) => `<span title="${BESOINS[k]}">${x}</span>`).join('')}</div>` : '';
}
function besoinsTexte(d) {
  const b = Object.entries(BESOINS).filter(([k]) => d[`besoin_${k}`]).map(([, l]) => l.toLowerCase());
  return b.length ? b.join(', ') : 'aucun besoin particulier';
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
  }[a.type];
  if (!faire) return;
  if (a.type === 'transferer') {
    modale('Confirmer le transfert', `<p>${esc(a.libelle)}.</p><p class="note">Le lit sera bloqué chez le receveur, qui sera notifié et devra accepter.</p>`,
      [{ label: 'Annuler' }, { label: 'Confirmer', pri: true, run: async () => (await agir(null, faire, 'Demande de transfert envoyée.')) !== null || false }]);
    return;
  }
  const messages = { assigner: 'Lit assigné et réservé pour ce patient.', debut_nettoyage: 'Nettoyage lancé.', lit: 'Lit mis à jour.',
    conge: 'Congé confirmé.', transfert: a.etape === 'accepter' ? 'Transfert accepté. Le demandeur est notifié.' : 'Transport demandé.' };
  agir(bouton, faire, messages[a.type] || 'Fait.');
}

/* ---------------- Copilote ---------------- */
async function vueCopilote() {
  const v = $('#v-copilote');
  if (!etabCtx().module_actif) { v.innerHTML = '<p class="note">Le Copilote est disponible une fois le module activé.</p>'; return; }
  const [b, r] = await Promise.all([
    api('GET', `/copilote/briefing?etablissement_id=${etat.ctx}`),
    api('GET', `/copilote/reseau?etablissement_id=${etat.ctx}`),
  ]);
  etat.recos = b.recommandations;
  const exemples = ['Que faire en priorité ?', 'Qui attend un lit à l’urgence ?', 'Dans quel ordre nettoyer ?', 'Où en sont les NSA ?', 'Où trouver un lit de soins intensifs ?', 'Le réseau déborde-t-il ?'];
  v.innerHTML = `<div class="entete"><div class="copilote-tete"><span class="ic">C</span><div><h2>Copilote · ${esc(b.etablissement)}</h2><p style="margin:0">Briefing pour la réunion de gestion des lits, mis à jour à ${new Date(b.genere_le).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}. Le Copilote propose ; vous décidez.</p></div></div></div>
    <div class="niveau n-${b.alerte.niveau}"><span class="pastille-niveau">Niveau ${NIVEAUX[b.alerte.niveau]}</span><p>${esc(b.resume)}</p><p class="note" style="flex-basis:100%">Protocole : ${esc(b.alerte.protocole)}</p></div>
    <div class="deux"><div class="pile">
      <div class="panneau-c"><h3>Recommandations (${b.recommandations.length})</h3><div class="recos">${b.recommandations.length ? b.recommandations.map((x, i) => `<div class="reco">
        <span class="prio prio-${x.priorite}">${PRIOS[x.priorite]}</span><div><h4>${esc(x.titre)}</h4><p>${esc(x.raison)}</p></div>
        ${x.action ? `<button class="btn pri" data-reco="${i}">${esc(x.action.libelle)}</button>` : '<span></span>'}</div>`).join('') : '<p class="note">Rien à signaler. Tout tourne.</p>'}</div></div>
    </div><div class="pile">
      <div class="panneau-c"><h3>Poser une question</h3>
        <form id="f-copilote" class="ligne"><div class="champ" style="flex:1 1 200px"><label class="lbl" for="q">Question</label><input id="q" value="${esc(etat.question)}" placeholder="Que faire en priorité ?" autocomplete="off"></div><button class="btn pri" type="submit">Demander</button></form>
        <div class="chips">${exemples.map((x, i) => `<button class="chip" data-ex="${i}">${esc(x)}</button>`).join('')}</div>
        ${etat.reponse ? `<div class="reponse">${esc(etat.reponse)}</div><span class="mode">${etat.modeReponse === 'ia' ? 'Réponse du mode IA, à partir des données du réseau, sans référence patient.' : 'Réponse calculée localement à partir des données.'}</span>` : ''}</div>
      <div class="panneau-c"><h3>Réseau</h3><div class="liste">${r.etablissements.map((e) => `<div class="item"><div><strong>${esc(e.nom)}</strong>${e.moi ? ' <span class="badge fort">Vous</span>' : ''}
        <div class="note">${e.libres} lit(s) libre(s)${e.en_attente != null ? ` · ${e.en_attente} en attente` : ''}${e.moi ? '' : ` · ${e.distance_km} km`}</div></div>
        <span class="risque" style="color:${{ vert: 'var(--succes)', jaune: '#B45309', orange: '#D97706', rouge: 'var(--critique)' }[e.niveau]}">${NIVEAUX[e.niveau]} · ${e.pression} %</span></div>`).join('')}</div>
        ${r.delestages.length ? `<h3 style="margin-top:6px">Délestages possibles</h3><div class="liste">${r.delestages.map((d) => `<div class="item"><div><strong>${esc(d.de)} → ${esc(d.vers)}</strong><div class="note">${esc(d.type)} · ${esc(d.raison)}</div></div></div>`).join('')}</div>` : ''}</div>
    </div></div>`;
  v.querySelectorAll('[data-reco]').forEach((btn) => { btn.onclick = () => executerProposition(etat.recos[Number(btn.dataset.reco)].action, btn); });
  const poser = (q) => agir(null, async () => {
    etat.question = q;
    const rep = await api('POST', '/copilote/question', { etablissement_id: etat.ctx, question: q });
    etat.reponse = rep.reponse; etat.modeReponse = rep.mode;
  });
  $('#f-copilote').onsubmit = (ev) => { ev.preventDefault(); const q = $('#q').value.trim(); if (q) poser(q); };
  v.querySelectorAll('[data-ex]').forEach((c) => { c.onclick = () => poser(exemples[Number(c.dataset.ex)]); });
}

/* ---------------- Admissions ---------------- */
async function vueAdmissions() {
  const v = $('#v-admissions');
  const actif = etabCtx().module_actif;
  const cfg = configCtx();
  const file = await api('GET', `/admissions?etablissement_id=${etat.ctx}`);
  const carte = (d) => `<div class="fiche" style="--c:${d.priorite === 'p1' ? 'var(--critique)' : d.depasse ? 'var(--attention)' : 'var(--secondaire)'}">
      <div class="t"><b>${esc(d.patient_ref)}</b><span class="${d.depasse ? 'urgent' : 'note mono'}">${d.priorite.toUpperCase()} · ${depuis(d.cree_le)}</span></div>
      <div class="note">${esc(d.type_nom)} · ${esc(d.provenance)} · ${esc(besoinsTexte(d))}</div>
      ${d.statut === 'assignee' ? `<div class="note">Lit assigné : <b class="mono">${esc(d.lit_code)}</b></div>` : d.lit_suggere ? `<div class="note">Lit libre adapté : <b class="mono">${esc(d.lit_suggere.code)}</b></div>` : '<div class="alerte">Aucun lit adapté libre ici</div>'}
      ${actif ? `<div class="actions">${d.statut === 'attente'
    ? `${d.lit_suggere ? `<button class="btn pri" data-adm="${d.id}" data-a="assigner" data-lit="${d.lit_suggere.id}" data-version="${d.lit_suggere.version}">Assigner ${esc(d.lit_suggere.code)}</button>` : ''}
           <button class="btn${d.lit_suggere ? '' : ' pri'}" data-adm="${d.id}" data-a="ailleurs">Chercher ailleurs</button>`
    : `<button class="btn pri" data-adm="${d.id}" data-a="admettre">Admettre</button>`}
        <button class="btn dan" data-adm="${d.id}" data-a="annuler">Annuler</button></div>` : ''}</div>`;
  v.innerHTML = `<div class="entete"><div><h2>File d’admission · ${esc(etabCtx().nom)}</h2><p>Patients qui attendent un lit, souvent sur civière à l’urgence. Au-delà de ${Math.round(cfg.attente_admission_max_min / 60)} h, la demande passe en alerte.</p></div></div>
    <div class="deux"><div class="pile"><div class="panneau-c"><h3>Nouvelle demande de lit</h3>
      <div class="ligne"><div class="champ"><label class="lbl" for="a-type">Type d’unité</label><select id="a-type">${cfg.types.map((x) => `<option value="${x.id}">${esc(x.nom)}</option>`).join('')}</select></div>
      <div class="champ"><label class="lbl" for="a-ref">Référence patient</label><input id="a-ref" placeholder="${esc(cfg.reference_exemple)}" autocomplete="off"></div></div>
      <div class="ligne"><div class="champ"><label class="lbl" for="a-prio">Priorité</label><select id="a-prio"><option value="p1">P1 · immédiat</option><option value="p2" selected>P2 · rapide</option><option value="p3">P3 · planifiable</option></select></div>
      <div class="champ"><label class="lbl" for="a-prov">Provenance</label><select id="a-prov"><option value="urgence">Urgence</option><option value="bloc">Bloc opératoire</option><option value="externe">Externe</option><option value="autre">Autre</option></select></div></div>
      <div class="cases">${Object.entries(BESOINS).map(([k, l]) => `<label class="case"><input type="checkbox" data-abesoin="${k}"> ${l}</label>`).join('')}</div>
      <button class="btn pri" id="b-demande"${actif ? '' : ' disabled'}>Ajouter à la file</button>
      <p class="note">Référence seulement. Aucune information médicale.</p></div></div>
    <div class="kanban" style="margin-top:0;grid-auto-columns:minmax(260px,1fr)">
      <div class="col" style="--c:var(--attention)"><h3>En attente <span class="mono">${file.filter((d) => d.statut === 'attente').length}</span></h3>${file.filter((d) => d.statut === 'attente').map(carte).join('') || '<div class="vide">Personne n’attend</div>'}</div>
      <div class="col" style="--c:var(--secondaire)"><h3>Lit assigné <span class="mono">${file.filter((d) => d.statut === 'assignee').length}</span></h3>${file.filter((d) => d.statut === 'assignee').map(carte).join('') || '<div class="vide">Aucune</div>'}</div>
    </div></div>`;
  $('#b-demande').onclick = (ev) => {
    const besoins = {};
    v.querySelectorAll('[data-abesoin]').forEach((c) => { besoins[c.dataset.abesoin] = c.checked; });
    agir(ev.target, () => api('POST', '/admissions', { etablissement_id: etat.ctx, type_id: Number($('#a-type').value), patient_ref: $('#a-ref').value.trim(),
      priorite: $('#a-prio').value, provenance: $('#a-prov').value, besoins }), 'Demande ajoutée à la file.');
  };
  v.querySelectorAll('[data-adm]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.adm; const a = b.dataset.a;
      if (a === 'assigner') return agir(b, () => api('POST', `/admissions/${id}/assigner`, { lit_id: Number(b.dataset.lit), version: Number(b.dataset.version) }), 'Lit assigné et réservé.');
      if (a === 'admettre') return agir(b, () => api('POST', `/admissions/${id}/admettre`), 'Patient admis.');
      if (a === 'annuler') return agir(b, () => api('POST', `/admissions/${id}/annuler`), 'Demande annulée.');
      const d = file.find((x) => String(x.id) === id);
      const be = {}; Object.keys(BESOINS).forEach((k) => { be[k] = d[`besoin_${k}`]; });
      const res = await api('GET', `/recherche?depuis=${etat.ctx}&type_id=${d.type_id}${qsBesoins(be)}`).catch((e) => { toast(e.message, true); return null; });
      if (!res) return null;
      const sug = res.suggestions.filter((x) => x.libres);
      modale(`Chercher un lit ailleurs · ${d.patient_ref}`, sug.length ? `<div class="liste">${sug.map((x, i) => `<label class="item"><div><strong>${esc(x.nom)}</strong>${x.recommande ? ' <span class="badge fort">Recommandé</span>' : ''}<div class="note mono">${esc(x.raison)}</div>${x.pourquoi ? `<div class="note">${esc(x.pourquoi)}</div>` : ''}</div><input type="radio" name="m-sug" value="${i}"${i === 0 ? ' checked' : ''}></label>`).join('')}</div>
        <p class="note">Le lit sera bloqué chez le receveur, qui devra accepter. Besoins respectés : ${esc(besoinsTexte(d))}.</p>` : '<p>Aucun lit adapté dans le rayon. Escaladez à la coordination régionale.</p>',
      sug.length ? [{ label: 'Annuler' }, { label: 'Demander le transfert', pri: true, run: async () => {
        const x = sug[Number(($('input[name="m-sug"]:checked') || {}).value || 0)];
        return (await agir(null, () => api('POST', `/admissions/${id}/transferer`, { destination_id: x.etablissement_id, lit_id: x.lit?.id, version: x.lit?.version }), (t) => `Demande ${t.numero} envoyée à ${x.nom}.`)) !== null || false;
      } }] : [{ label: 'Fermer' }]);
      return null;
    };
  });
}

/* ---------------- Nettoyage ---------------- */
async function vueNettoyage() {
  const v = $('#v-nettoyage');
  const liste = await api('GET', `/nettoyage?etablissement_id=${etat.ctx}`);
  const couleur = { haute: 'var(--critique)', moyenne: 'var(--attention)', normale: 'var(--secondaire)' };
  v.innerHTML = `<div class="entete"><div><h2>Nettoyage · ${esc(etabCtx().nom)}</h2><p>Dans l’ordre recommandé : les unités où des patients attendent un lit passent en premier.</p></div></div>
    <div class="liste">${liste.map((l, i) => `<div class="net-item" style="--c:${couleur[l.priorite]}"><div>
      <div class="grand">${i + 1}. ${esc(l.code)}</div>
      <div class="note">${esc(l.unite)} · chambre ${esc(l.chambre)}${l.isolement ? ' · chambre d’isolement' : ''}</div>
      <div style="font-size:13px">${esc(l.raison)}</div>
      <div class="note">${l.nettoyage_debut ? `Commencé il y a ${depuis(l.nettoyage_debut)}` : `En attente depuis ${depuis(l.etat_depuis)}`}</div></div>
      <div class="actions" style="display:flex;flex-direction:column;gap:6px">${l.nettoyage_debut ? '' : `<button class="btn" data-debut="${l.id}">Commencer</button>`}
        <button class="btn pri" data-fini="${l.id}" data-version="${l.version}" data-code="${esc(l.code)}">Terminé</button></div></div>`).join('') || '<p class="note">Aucun lit à nettoyer.</p>'}</div>`;
  v.querySelectorAll('[data-debut]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/nettoyage/${b.dataset.debut}/debut`), 'Nettoyage commencé.'); });
  v.querySelectorAll('[data-fini]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/lits/${b.dataset.fini}/action`, { action: 'nettoyage_ok', version: Number(b.dataset.version) }), `${b.dataset.code} est prêt.`); });
}

/* ---------------- NSA ---------------- */
async function vueNsa() {
  const v = $('#v-nsa');
  const n = await api('GET', `/nsa?etablissement_id=${etat.ctx}`);
  v.innerHTML = `<div class="entete"><div><h2>Patients NSA · ${esc(etabCtx().nom)}</h2><p>Patients qui n’ont plus besoin de soins aigus et attendent une autre ressource. Chaque jour compte : c’est un lit qui manque à l’urgence.</p></div></div>
    <div class="tuiles">
      <div class="tuile"><span class="lbl">Taux NSA</span><span class="v${n.taux > n.cible ? ' mauvais' : ''}">${n.taux} %</span><span class="note">cible ${n.cible} % des lits occupés</span></div>
      <div class="tuile"><span class="lbl">Patients NSA</span><span class="v">${n.total}</span><span class="note">sur ${n.occupes} lits occupés</span></div>
      <div class="tuile"><span class="lbl">Jours-lits NSA</span><span class="v">${n.jours_lits}</span><span class="note">cumul des attentes en cours</span></div>
      <div class="tuile"><span class="lbl">Orientations</span><span class="note" style="font-size:13px">${Object.entries(n.par_orientation).map(([k, x]) => `${esc(ORIENTATIONS[k])} : ${x}`).join('<br>') || '—'}</span></div></div>
    <div class="tableau"><table><thead><tr><th>Lit</th><th>Unité</th><th>Patient</th><th>Depuis</th><th>Orientation</th><th></th></tr></thead><tbody>${n.lits.map((l) => `<tr>
      <td class="mono">${esc(l.code)}</td><td>${esc(l.unite)}</td><td class="mono">${esc(l.patient_ref)}</td><td class="mono${l.jours >= 30 ? ' refuse' : ''}">${l.jours} j</td>
      <td><select data-orient="${l.id}" aria-label="Orientation">${Object.entries(ORIENTATIONS).map(([k, x]) => `<option value="${k}"${k === l.nsa_orientation ? ' selected' : ''}>${x}</option>`).join('')}</select></td>
      <td><button class="btn" data-retirer="${l.id}">Retirer</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Aucun patient NSA.</td></tr>'}</tbody></table></div>`;
  v.querySelectorAll('[data-orient]').forEach((sel) => { sel.onchange = () => agir(sel, () => api('PUT', `/lits/${sel.dataset.orient}/nsa`, { orientation: sel.value }), 'Orientation mise à jour.'); });
  v.querySelectorAll('[data-retirer]').forEach((b) => { b.onclick = () => agir(b, () => api('DELETE', `/lits/${b.dataset.retirer}/nsa`), 'Statut NSA retiré.'); });
}

/* ---------------- Indicateurs ---------------- */
const min = (x) => (x == null ? '—' : x >= 120 ? `${Math.floor(x / 60)} h ${String(x % 60).padStart(2, '0')}` : `${x} min`);
async function vueIndicateurs() {
  const v = $('#v-indicateurs');
  const i = await api('GET', `/indicateurs?etablissement_id=${etat.ctx}&jours=${etat.jours}`);
  const tuile = (l, val, note, mauvais) => `<div class="tuile"><span class="lbl">${l}</span><span class="v${mauvais ? ' mauvais' : ''}">${val}</span><span class="note">${note}</span></div>`;
  v.innerHTML = `<div class="entete"><div><h2>Indicateurs · ${esc(etabCtx().nom)}</h2><p>Pour suivre les progrès et alimenter les rapports. Période : ${i.periode_jours} derniers jours.</p></div>
    <div class="ligne"><select id="i-jours" aria-label="Période">${[7, 30, 90].map((j) => `<option value="${j}"${j === etat.jours ? ' selected' : ''}>${j} jours</option>`).join('')}</select><button class="btn" id="b-csv">Exporter (CSV)</button></div></div>
    <h3 style="margin-bottom:8px">Capacité maintenant</h3><div class="tuiles">
      ${tuile('Occupation', `${i.capacite.occupation} %`, `${i.capacite.libres} libre(s) sur ${i.capacite.dotes} lits dotés`, i.capacite.occupation >= 95)}
      ${tuile('Niveau d’alerte', NIVEAUX[i.alerte.niveau], `pression ${i.alerte.pression} %`, ['orange', 'rouge'].includes(i.alerte.niveau))}
      ${tuile('Lits fermés', i.capacite.indispo, Object.entries(i.capacite.indispo_par_motif).map(([k, x]) => `${MOTIFS[k]} : ${x}`).join(' · ') || 'aucun', i.capacite.indispo > 0)}
      ${tuile('Taux NSA', `${i.nsa.taux} %`, `cible ${i.nsa.cible} % · ${i.nsa.jours_lits} jours-lits`, i.nsa.taux > i.nsa.cible)}</div>
    <h3 style="margin-bottom:8px">Fluidité sur la période</h3><div class="tuiles">
      ${tuile('Attente avant lit assigné', min(i.admissions.delai_assignation_min), `${i.admissions.total} demande(s), ${i.admissions.en_attente} en attente, ${i.admissions.transferees} transférée(s)`)}
      ${tuile('Délai de réponse transfert', min(i.transferts.delai_validation_min), `${i.transferts.total} transfert(s) : ${i.transferts.sortants} sortant(s), ${i.transferts.entrants} entrant(s)`)}
      ${tuile('Délai total de transfert', min(i.transferts.delai_total_min), 'de la demande à la réception')}
      ${tuile('Refus de transfert', `${i.transferts.taux_refus} %`, Object.entries(i.transferts.refus_par_motif).map(([k, x]) => `${k.replace(/_/g, ' ')} : ${x}`).join(' · ') || 'aucun refus', i.transferts.taux_refus > 20)}
      ${tuile('Durée de nettoyage', min(i.nettoyage.duree_moy_min), `${i.nettoyage.nettoyages} nettoyage(s) mesuré(s)`, i.nettoyage.duree_moy_min > configCtx().nettoyage_cible_min)}</div>`;
  $('#i-jours').onchange = (ev) => { etat.jours = Number(ev.target.value); rafraichir(); };
  $('#b-csv').onclick = async () => {
    try {
      const r = await fetch(`/api/indicateurs.csv?etablissement_id=${etat.ctx}&jours=${etat.jours}`, { headers: { Authorization: `Bearer ${etat.token}` } });
      if (!r.ok) throw new Error('Export impossible.');
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
  v.innerHTML = `<div class="entete"><div><h2>Mon compte</h2><p>${esc(u.nom)} · ${esc(u.email)} · rôle ${esc({ coordonnateur: 'coordination', entretien: 'entretien', admin_etab: 'administration d’établissement', gestionnaire: 'gestionnaire réseau' }[u.role])}</p></div></div>
    <div class="grille">
      <form class="panneau-c" id="f-mdp"><h3>Changer le mot de passe</h3>
        <div class="champ"><label class="lbl" for="m-actuel">Mot de passe actuel</label><input id="m-actuel" type="password" autocomplete="current-password"></div>
        <div class="champ"><label class="lbl" for="m-nouveau">Nouveau mot de passe</label><input id="m-nouveau" type="password" autocomplete="new-password"></div>
        <div class="champ"><label class="lbl" for="m-confirme">Confirmer</label><input id="m-confirme" type="password" autocomplete="new-password"></div>
        <p class="note">Au moins 12 caractères, avec des lettres et des chiffres. Vos autres sessions seront fermées.</p>
        <button class="btn pri" type="submit">Enregistrer</button></form>
      <div class="panneau-c"><h3>Double authentification</h3>
        ${u.totp_actif
    ? `<p><span class="badge fort">Activée</span> Un code de votre application est demandé à chaque connexion.</p>
           <div class="ligne"><div class="champ"><label class="lbl" for="d-code">Code actuel pour désactiver</label><input id="d-code" inputmode="numeric" maxlength="7"></div><button class="btn dan" id="b-2fa-off">Désactiver</button></div>`
    : `<p>Protège votre compte même si votre mot de passe est découvert. <b>Obligatoire pour l’administration.</b></p>
           <div id="zone-2fa"><button class="btn pri" id="b-2fa-prep">Activer</button></div>`}
      </div></div>`;
  $('#f-mdp').onsubmit = (e) => {
    e.preventDefault();
    if ($('#m-nouveau').value !== $('#m-confirme').value) { toast('Les deux mots de passe ne correspondent pas.', true); return; }
    agir(null, async () => {
      await api('PUT', '/moi/mot-de-passe', { actuel: $('#m-actuel').value, nouveau: $('#m-nouveau').value });
      ['#m-actuel', '#m-nouveau', '#m-confirme'].forEach((x) => { const el = $(x); if (el) el.value = ''; });
    }, 'Mot de passe changé.');
  };
  const prep = $('#b-2fa-prep');
  if (prep) {
    prep.onclick = async () => {
      try {
        const r = await api('POST', '/moi/2fa/preparer');
        $('#zone-2fa').innerHTML = `<ol class="note" style="padding-left:18px;margin:0">
            <li>Installez une application d’authentification (Microsoft Authenticator, Google Authenticator…).</li>
            <li>Scannez ce code QR, ou entrez la clé à la main.</li><li>Entrez le code à 6 chiffres affiché.</li></ol>
          <div style="width:200px;max-width:100%;background:#fff;padding:6px;border:1px solid var(--bordure);border-radius:8px">${r.qr_svg}</div>
          <div class="note">Clé : <span class="mono" style="word-break:break-all">${esc(r.secret)}</span></div>
          <div class="ligne"><div class="champ"><label class="lbl" for="a-code">Code à 6 chiffres</label><input id="a-code" inputmode="numeric" maxlength="7" autocomplete="one-time-code"></div>
          <button class="btn pri" id="b-2fa-ok">Confirmer</button></div>`;
        $('#b-2fa-ok').onclick = (ev) => agir(ev.target, async () => {
          await api('POST', '/moi/2fa/activer', { code: $('#a-code').value });
          etat.moi = await api('GET', '/moi');
        }, 'Double authentification activée.');
      } catch (e) { toast(e.message, true); }
    };
  }
  const off = $('#b-2fa-off');
  if (off) off.onclick = () => agir(off, async () => { await api('POST', '/moi/2fa/desactiver', { code: $('#d-code').value }); etat.moi = await api('GET', '/moi'); }, 'Double authentification désactivée.');
}

/* ---------------- Administration ---------------- */
const ROLES_LIB = { coordonnateur: 'Coordination', entretien: 'Entretien', admin_etab: 'Admin d’établissement', gestionnaire: 'Gestionnaire réseau' };
etat.adminOnglet = 'utilisateurs';
function montrerSecret(titre, texte, explication) {
  modale(titre, `<p class="note">${esc(explication)}</p><div class="reponse mono" style="word-break:break-all;user-select:all">${esc(texte)}</div>
    <p class="note">Il ne sera plus affiché. Transmettez-le par un moyen sûr.</p>`,
  [{ label: 'Copier', run: async () => { try { await navigator.clipboard.writeText(texte); toast('Copié.'); } catch { toast('Sélectionnez le texte pour le copier.', true); } return false; } }, { label: 'Fermer', pri: true }]);
}
async function vueAdmin() {
  const v = $('#v-admin');
  const u = etat.moi.utilisateur;
  if (!u.totp_actif) {
    v.innerHTML = `<div class="entete"><div><h2>Administration</h2></div></div><div class="panneau-c"><h3>Double authentification requise</h3>
      <p>Pour protéger les comptes et la configuration, l’administration exige la double authentification.</p><button class="btn pri" id="b-vers-compte">Activer dans Mon compte</button></div>`;
    $('#b-vers-compte').onclick = () => allerA('compte');
    return;
  }
  const onglets = [['utilisateurs', 'Utilisateurs'], ['structure', 'Unités et lits'], ['connecteurs', 'Connecteurs'], ['journal', 'Journal d’administration']];
  if (u.gestionnaire) onglets.splice(2, 0, ['config', 'Configuration pays']);
  v.innerHTML = `<div class="entete"><div><h2>Administration</h2><p>${u.gestionnaire ? 'Tout le réseau.' : 'Vos établissements.'} Chaque action est inscrite au journal d’administration.</p></div></div>
    <div class="chips">${onglets.map(([k, l]) => `<button class="chip" aria-pressed="${etat.adminOnglet === k}" data-ao="${k}">${l}</button>`).join('')}</div><div id="admin-corps" style="margin-top:14px"></div>`;
  v.querySelectorAll('[data-ao]').forEach((b) => { b.onclick = () => { etat.adminOnglet = b.dataset.ao; rafraichir(); }; });
  const corps = $('#admin-corps');
  const etabs = etat.moi.etablissements;
  const nomEtab = (id) => (etabs.find((e) => e.id === id) || {}).nom || `#${id}`;
  const casesEtab = (choisis = []) => etabs.map((e) => `<label class="case"><input type="checkbox" data-etabu="${e.id}"${choisis.includes(e.id) ? ' checked' : ''}> ${esc(e.nom)}</label>`).join('');
  const rolesPermis = Object.entries(ROLES_LIB).filter(([k]) => u.gestionnaire || k !== 'gestionnaire');

  if (etat.adminOnglet === 'utilisateurs') {
    const comptes = await api('GET', '/admin/utilisateurs');
    corps.innerHTML = `<div class="deux"><div class="panneau-c"><h3>Nouveau compte</h3>
        <div class="champ"><label class="lbl" for="n-nom">Nom</label><input id="n-nom" autocomplete="off"></div>
        <div class="champ"><label class="lbl" for="n-email">Adresse courriel</label><input id="n-email" type="email" autocomplete="off"></div>
        <div class="champ"><label class="lbl" for="n-role">Rôle</label><select id="n-role">${rolesPermis.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
        <div class="champ"><span class="lbl">Établissements</span><div class="cases">${casesEtab([etat.ctx])}</div></div>
        <button class="btn pri" id="b-creer-compte">Créer le compte</button>
        <p class="note">Un mot de passe temporaire est généré ; la personne le change à sa première connexion.</p></div>
      <div class="tableau"><table><thead><tr><th>Nom</th><th>Rôle</th><th>Établissements</th><th>Sécurité</th><th>Dernière connexion</th><th></th></tr></thead><tbody>${comptes.map((c) => `<tr>
        <td>${esc(c.nom)}<div class="note">${esc(c.email)}</div></td><td>${esc(ROLES_LIB[c.role])}${c.actif ? '' : ' <span class="badge">désactivé</span>'}</td>
        <td class="note">${c.etablissements.map((e) => esc(nomEtab(e))).join('<br>') || 'Tout le réseau'}</td>
        <td class="note">${c.totp_actif ? 'Double auth. ✓' : 'Mot de passe seul'}${c.mdp_temporaire ? '<br>Mot de passe temporaire' : ''}</td>
        <td class="note">${c.derniere_connexion ? heure(c.derniere_connexion) : 'Jamais'}</td>
        <td><div class="ligne" style="gap:6px">${c.id === u.id ? '' : `<button class="btn" data-reinit="${c.id}" data-nom="${esc(c.nom)}">Réinitialiser</button>
          <button class="btn${c.actif ? ' dan' : ''}" data-actif="${c.id}" data-val="${!c.actif}">${c.actif ? 'Désactiver' : 'Réactiver'}</button>`}</div></td></tr>`).join('')}</tbody></table></div></div>`;
    $('#b-creer-compte').onclick = (ev) => {
      const choisis = [...corps.querySelectorAll('[data-etabu]:checked')].map((c) => Number(c.dataset.etabu));
      agir(ev.target, async () => {
        const r = await api('POST', '/admin/utilisateurs', { nom: $('#n-nom').value, email: $('#n-email').value, role: $('#n-role').value, etablissements: choisis });
        montrerSecret(`Compte créé : ${r.email}`, r.mot_de_passe_temporaire, 'Mot de passe temporaire à transmettre à la personne :');
      });
    };
    corps.querySelectorAll('[data-reinit]').forEach((b) => {
      b.onclick = () => modale(`Réinitialiser · ${b.dataset.nom}`, `<p>Un nouveau mot de passe temporaire sera créé et toutes ses sessions seront fermées.</p>
        <label class="case"><input type="checkbox" id="r-2fa"> Réinitialiser aussi la double authentification (téléphone perdu)</label>`,
      [{ label: 'Annuler' }, { label: 'Réinitialiser', pri: true, run: async () => {
        try {
          const r = await api('POST', `/admin/utilisateurs/${b.dataset.reinit}/reinitialiser`, { reinitialiser_2fa: $('#r-2fa').checked });
          setTimeout(() => montrerSecret('Nouveau mot de passe temporaire', r.mot_de_passe_temporaire, `Pour ${b.dataset.nom} :`), 50);
          rafraichir();
          return true;
        } catch (e) { toast(e.message, true); return false; }
      } }]);
    });
    corps.querySelectorAll('[data-actif]').forEach((b) => { b.onclick = () => agir(b, () => api('PUT', `/admin/utilisateurs/${b.dataset.actif}`, { actif: b.dataset.val === 'true' }), 'Compte mis à jour.'); });
  }

  if (etat.adminOnglet === 'structure') {
    const cfg = configCtx();
    const st = await api('GET', `/admin/structure?etablissement_id=${etat.ctx}`);
    const eq = [['isolement', 'ISO'], ['pression_negative', 'PN'], ['ventilation', 'VENT'], ['telemetrie', 'TÉLÉ']];
    corps.innerHTML = `<p class="note">Établissement : <b>${esc(etabCtx().nom)}</b> (changez-le en haut de l’écran).</p>
      <div class="ligne" style="margin-bottom:14px"><div class="champ"><label class="lbl" for="s-type">Type</label><select id="s-type">${cfg.types.map((t) => `<option value="${t.id}">${esc(t.nom)}</option>`).join('')}</select></div>
        <div class="champ"><label class="lbl" for="s-nom">Nom de la nouvelle unité</label><input id="s-nom" autocomplete="off"></div><button class="btn pri" id="b-unite">Ajouter l’unité</button></div>
      <div class="pile">${st.map((un) => `<div class="panneau-c"><div class="entete" style="margin:0"><h3>${esc(un.nom)} <span class="note">${esc(un.type_nom)}</span></h3>
          <div class="ligne"><input placeholder="N° de chambre" data-chnum="${un.id}" style="width:130px" aria-label="Numéro de chambre"><button class="btn" data-ch="${un.id}">Ajouter la chambre</button></div></div>
        ${un.chambres.map((ch) => `<div class="item"><div style="flex:1 1 100%"><strong>Chambre ${esc(ch.numero)}</strong>
          <div class="liste" style="margin-top:6px">${ch.lits.map((l) => `<div class="ligne" style="justify-content:space-between;gap:8px"><span class="mono">${esc(l.code)} <span class="note">${esc(ETATS[l.etat])}</span></span>
            <span class="cases">${eq.map(([k, lab]) => `<label class="case" title="${BESOINS[k]}"><input type="checkbox" data-eq="${l.id}" data-k="${k}"${l[k] ? ' checked' : ''}> ${lab}</label>`).join('')}</span></div>`).join('') || '<span class="note">Aucun lit</span>'}</div>
          <div class="ligne" style="margin-top:6px"><input placeholder="Code du lit (ex. ${esc(un.type_nom.slice(0, 3).toUpperCase())}-${esc(ch.numero)}C)" data-litcode="${ch.id}" style="width:230px" aria-label="Code du lit"><button class="btn" data-lit-ch="${ch.id}">Ajouter le lit</button></div></div></div>`).join('') || '<p class="note">Aucune chambre.</p>'}</div>`).join('')}</div>`;
    $('#b-unite').onclick = (ev) => agir(ev.target, () => api('POST', '/admin/unites', { etablissement_id: etat.ctx, type_id: Number($('#s-type').value), nom: $('#s-nom').value }), 'Unité ajoutée.');
    corps.querySelectorAll('[data-ch]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', '/admin/chambres', { unite_id: Number(b.dataset.ch), numero: corps.querySelector(`[data-chnum="${b.dataset.ch}"]`).value }), 'Chambre ajoutée.'); });
    corps.querySelectorAll('[data-lit-ch]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', '/admin/lits', { chambre_id: Number(b.dataset.litCh), code: corps.querySelector(`[data-litcode="${b.dataset.litCh}"]`).value }), 'Lit ajouté, à l’état Libre.'); });
    corps.querySelectorAll('[data-eq]').forEach((c) => { c.onchange = () => agir(null, () => api('PUT', `/admin/lits/${c.dataset.eq}/equipement`, { [c.dataset.k]: c.checked }), 'Équipement mis à jour.'); });
  }

  if (etat.adminOnglet === 'config') {
    const cfgs = await api('GET', '/admin/config');
    const champs = [['rayon_km', 'Rayon de recherche (km)'], ['vitesse_kmh', 'Vitesse moyenne ambulance (km/h)'], ['facteur_route', 'Facteur route / vol d’oiseau'],
      ['penalite_orange_km', 'Recul d’un hôpital orange (km)'], ['penalite_rouge_km', 'Recul d’un hôpital rouge (km)'], ['horizon_h', 'Horizon de prévision (h)'],
      ['seuil_jaune', 'Seuil jaune (%)'], ['seuil_orange', 'Seuil orange (%)'], ['seuil_rouge', 'Seuil rouge (%)'], ['attente_admission_max_min', 'Attente d’admission max (min)'],
      ['nettoyage_cible_min', 'Nettoyage cible (min)'], ['reservation_max_min', 'Réservation sans admission max (min)'], ['marge_conge_min', 'Tolérance congé dépassé (min)'],
      ['hors_service_max_h', 'Hors service max (h)'], ['cible_nsa_pct', 'Cible NSA (%)']];
    corps.innerHTML = cfgs.map((c) => `<form class="panneau-c" data-cfg="${c.id}"><h3>${esc(c.nom)}</h3><div class="grille" style="gap:10px">${champs.map(([k, l]) => `<div class="champ"><label class="lbl" for="cfg-${c.id}-${k}">${l}</label><input id="cfg-${c.id}-${k}" data-k="${k}" value="${esc(c[k])}" inputmode="decimal"></div>`).join('')}</div>
      <h3>Protocoles par niveau d’alerte</h3>${['vert', 'jaune', 'orange', 'rouge'].map((n) => `<div class="champ"><label class="lbl" for="pr-${c.id}-${n}">${NIVEAUX[n]}</label><textarea id="pr-${c.id}-${n}" data-pr="${n}" rows="2">${esc(c.protocoles[n])}</textarea></div>`).join('')}
      <button class="btn pri" type="submit">Enregistrer</button></form>`).join('');
    corps.querySelectorAll('[data-cfg]').forEach((f) => {
      f.onsubmit = (e) => {
        e.preventDefault();
        const corpsCfg = { protocoles: {} };
        f.querySelectorAll('[data-k]').forEach((i) => { corpsCfg[i.dataset.k] = Number(i.value); });
        f.querySelectorAll('[data-pr]').forEach((t) => { corpsCfg.protocoles[t.dataset.pr] = t.value; });
        agir(null, async () => { await api('PUT', `/admin/config/${f.dataset.cfg}`, corpsCfg); etat.moi = await api('GET', '/moi'); }, 'Configuration enregistrée.');
      };
    });
  }

  if (etat.adminOnglet === 'connecteurs') {
    const cons = await api('GET', '/admin/connecteurs');
    corps.innerHTML = `<div class="deux"><div class="panneau-c"><h3>Nouveau connecteur</h3>
        <div class="champ"><label class="lbl" for="c-nom-con">Nom</label><input id="c-nom-con" placeholder="Interface ADT de l’hôpital" autocomplete="off"></div>
        <div class="champ"><label class="lbl" for="c-etab-con">Établissement</label><select id="c-etab-con">${etabs.map((e) => `<option value="${e.id}"${e.id === etat.ctx ? ' selected' : ''}>${esc(e.nom)}</option>`).join('')}${u.gestionnaire ? '<option value="">Réseau (lecture seulement)</option>' : ''}</select></div>
        <button class="btn pri" id="b-con">Créer et afficher la clé</button>
        <p class="note">La clé permet au système de l’hôpital d’envoyer admissions, transferts et congés. Elle n’est affichée qu’une fois.</p></div>
      <div class="tableau"><table><thead><tr><th>Nom</th><th>Établissement</th><th>Dernier message</th><th>Rejets 24 h</th><th></th></tr></thead><tbody>${cons.map((c) => `<tr>
        <td>${esc(c.nom)}${c.actif ? '' : ' <span class="badge">révoqué</span>'}</td><td>${esc(c.etablissement || 'Réseau (lecture)')}</td>
        <td class="note">${c.dernier_message ? heure(c.dernier_message) : 'Aucun'}</td><td class="mono${c.rejets_24h ? ' refuse' : ''}">${c.rejets_24h}</td>
        <td>${c.actif ? `<button class="btn dan" data-revoquer="${c.id}">Révoquer</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucun connecteur.</td></tr>'}</tbody></table></div></div>`;
    $('#b-con').onclick = (ev) => agir(ev.target, async () => {
      const r = await api('POST', '/admin/connecteurs', { nom: $('#c-nom-con').value || 'Connecteur', etablissement_id: $('#c-etab-con').value ? Number($('#c-etab-con').value) : null });
      montrerSecret(`Clé du connecteur : ${r.nom}`, r.cle, 'À configurer dans le moteur d’interface de l’hôpital (en-tête X-Connecteur-Key) :');
    });
    corps.querySelectorAll('[data-revoquer]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/admin/connecteurs/${b.dataset.revoquer}/revoquer`), 'Connecteur révoqué. Sa clé ne fonctionne plus.'); });
  }

  if (etat.adminOnglet === 'journal') {
    const j = await api('GET', '/admin/journal');
    corps.innerHTML = `<div class="tableau"><table><thead><tr><th>Date</th><th>Par</th><th>Action</th><th>Cible</th><th>Détail</th><th>Établissement</th></tr></thead><tbody>${j.map((x) => `<tr>
      <td class="mono">${heure(x.date)}</td><td>${esc(x.utilisateur || '')}</td><td>${esc(x.action)}</td><td>${esc(x.cible || '')}</td><td class="note">${esc(x.detail || '')}</td><td class="note">${esc(x.etablissement || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Aucune action.</td></tr>'}</tbody></table></div>`;
  }
}

/* ---------------- démarrage ---------------- */
(async () => {
  etat.token = lire('arrimo-token');
  if (!etat.token) { $('#ecran-connexion').hidden = false; return; }
  try { await demarrer(); } catch { deconnecter(true); }
})();
