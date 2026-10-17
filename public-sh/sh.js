/* Console SH : interface (français ; console interne de l'équipe SH). Aucun script en ligne : la politique de sécurité l'interdit. */
const F = window.ArrimoFormat;
const L = 'fr-CA';
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icone = (nom) => `<svg class="ic" aria-hidden="true" focusable="false"><use href="icones.svg#i-${nom}"/></svg>`;
const pl = (modele, vars) => F.remplir(L, modele, vars);
const quand = (iso) => (iso ? new Date(iso).toLocaleString(L, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const jour = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString(L, { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const lire = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const ecrire = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* stockage indisponible */ } };

const STATUTS = { prospect: 'Prospect', implantation: 'En implantation', actif: 'Actif', suspendu: 'Suspendu' };
const ENVS = { demo: 'Démonstration', recette: 'Recette', production: 'Production' };
const TYPES = { unites: 'Unités', chambres: 'Chambres', lits: 'Lits', civieres: 'Civières de l’urgence', utilisateurs: 'Utilisateurs' };
const COLONNES = { unites: 'unite;type_unite', chambres: 'unite;chambre', lits: 'unite;chambre;lit;isolement;pression_negative;ventilation;telemetrie', civieres: 'civiere;categorie', utilisateurs: 'nom;courriel;role' };
const AIDE_TYPES = { unites: 'Type d’unité : SI, MED, CHIR, MAT ou leur nom.', chambres: 'L’unité doit déjà exister.', lits: 'Équipement : oui ou non.',
  civieres: 'Catégorie : reguliere ou debordement.', utilisateurs: 'Rôle : coordonnateur, entretien ou admin_etab. Chaque compte reçoit un mot de passe temporaire.' };
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
  el.textContent = msg;
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
const FORMULAIRES = ['#f-connexion', '#f-2fa', '#f-mdp-temp', '#f-2fa-act'];
function montrer(sel) {
  $('#ecran-app').hidden = true;
  $('#ecran-connexion').hidden = false;
  FORMULAIRES.forEach((f) => { $(f).hidden = f !== sel; });
  const champ = $(`${sel} input`);
  if (champ) champ.focus();
}
function erreurDans(id, msg) { const el = $(id); el.textContent = msg || ''; el.hidden = !msg; }
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
  if (u.mdp_temporaire) { montrer('#f-mdp-temp'); return; }
  if (!u.totp_actif) { montrer('#f-2fa-act'); return; }
  $('#ecran-connexion').hidden = true;
  $('#ecran-app').hidden = false;
  $('#nom-utilisateur').textContent = u.nom;
  afficher();
}

/* ---------------- navigation ---------------- */
document.querySelectorAll('#onglets button').forEach((b) => { b.onclick = () => { etat.vue = b.dataset.v; etat.hopital = null; afficher(); }; });
async function afficher() {
  if (!etat.moi) return;
  document.querySelectorAll('#onglets button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === etat.vue)));
  const v = $('#contenu');
  try {
    if (etat.vue === 'hopitaux') await (etat.hopital ? vueHopital(v) : vueHopitaux(v));
    else if (etat.vue === 'journal') await vueJournal(v);
    else if (etat.vue === 'equipe') await vueEquipe(v);
    else vueCompte(v);
  } catch (e) { toast(e.message, true); }
  document.body.dataset.pret = '1';
  document.body.dataset.rendus = String(Number(document.body.dataset.rendus || 0) + 1);   // repère pour les tests d'interface
}

/* ---------------- hôpitaux ---------------- */
const champ = (id, libelle, valeur, attrs = '') => `<div class="champ"><label class="lbl" for="${id}">${esc(libelle)}</label><input id="${id}" value="${esc(valeur ?? '')}" autocomplete="off" ${attrs}></div>`;
const choixEnv = (id, choisi, verrou) => `<div class="champ"><label class="lbl" for="${id}">Environnement</label><select id="${id}"${verrou ? ' disabled' : ''}>
  ${Object.entries(ENVS).map(([k, n]) => `<option value="${k}"${k === choisi ? ' selected' : ''}>${esc(n)}${etat.moi.environnements.some((e) => e.code === k) ? '' : ' (non relié)'}</option>`).join('')}</select></div>`;
const nb = (n) => F.nombre(L, n, 6);
function formHopital(h = {}) {
  const verrou = !!h.relie;
  return `<div class="ligne">${champ('h-nom', 'Nom de l’hôpital', h.nom)}${champ('h-code', 'Code d’établissement', h.code_etab, `placeholder="HOP-A"${verrou ? ' disabled' : ''}`)}${choixEnv('h-env', h.environnement || 'recette', verrou)}</div>
    <div class="ligne">${champ('h-adresse', 'Adresse', h.adresse)}${champ('h-ville', 'Ville', h.ville)}</div>
    <div class="ligne">${champ('h-lat', 'Latitude', h.latitude == null ? '' : nb(h.latitude), `inputmode="decimal" placeholder="${nb(45.4)}"`)}${champ('h-lon', 'Longitude', h.longitude == null ? '' : nb(h.longitude), `inputmode="decimal" placeholder="${nb(-71.89)}"`)}
      ${champ('h-sd', 'Lien propre (sous-domaine)', h.sous_domaine, 'placeholder="hopital-x"')}</div>
    <div class="ligne">${champ('h-cnom', 'Contact : nom', h.contact_nom)}${champ('h-ccourriel', 'Contact : courriel', h.contact_courriel, 'type="email"')}${champ('h-ctel', 'Contact : téléphone', h.contact_telephone, 'type="tel"')}</div>`;
}
const lireFormHopital = () => ({
  nom: $('#h-nom').value, code_etab: $('#h-code').value, environnement: $('#h-env').value, adresse: $('#h-adresse').value, ville: $('#h-ville').value,
  latitude: $('#h-lat').value, longitude: $('#h-lon').value, sous_domaine: $('#h-sd').value,
  contact_nom: $('#h-cnom').value, contact_courriel: $('#h-ccourriel').value, contact_telephone: $('#h-ctel').value,
});
function etapeCourte(h) {
  if (!h.etape_en_cours) return 'Toutes les étapes terminées';
  const e = etat.moi.etapes.find((x) => x.rang === h.etape_en_cours);
  return `${h.etape_en_cours}/7 · ${e ? e.nom : ''}`;
}

async function vueHopitaux(v) {
  const f = etat.filtres;
  const qs = new URLSearchParams(Object.entries(f).filter(([, x]) => x)).toString();
  const [liste, envs] = await Promise.all([api('GET', `/hopitaux${qs ? `?${qs}` : ''}`), api('GET', '/environnements')]);
  v.innerHTML = `<div class="entete"><div><h2>Hôpitaux clients</h2><p>Chaque hôpital suit un projet d’implantation en 7 étapes, du contrat à la production. Le module ne s’active qu’une fois les étapes avant le go-live cochées.</p></div>
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
    <ol class="frise">${h.etapes.map((e) => {
    const faits = e.verifications.filter((x) => x.faite).length;
    const cl = faits === e.verifications.length ? 'fait' : enCours && e.id === enCours.id ? 'en-cours' : '';
    return `<li class="${cl}"><a href="#etape-${e.rang}"><span class="rond">${cl === 'fait' ? icone('check') : e.rang}</span><span>${esc(e.nom)}</span><span class="note">${faits}/${e.verifications.length}</span></a></li>`;
  }).join('')}</ol>
    <div class="deux hopital-fiche">
      <div class="pile">
        <div class="panneau-c"><h3>Établissement dans l’environnement</h3>${etatEtab}</div>
        ${h.environnement === 'recette' || h.golive_le ? `<div class="panneau-c" id="golive"><h3>Go-live</h3>${blocGolive(h)}</div>` : ''}
        <div class="panneau-c"><h3>Activation du module</h3>${blocActivation(h)}</div>
        <div class="panneau-c"><h3>Rapport de go-live</h3><p class="note">Établissement, dates des 7 étapes, imports, comptes (sans mot de passe), formation et responsables, avec signatures.</p>
          <div><button class="btn" id="b-rapport">${icone('download')}Télécharger le rapport (PDF)</button></div></div>
        <div class="panneau-c"><h3>Fiche</h3><div class="form-fiche">${formHopital(h)}</div>
          <div class="ligne">${['prospect', 'implantation'].includes(h.statut) ? `<div class="champ"><label class="lbl" for="h-statut">Statut</label><select id="h-statut">${['prospect', 'implantation'].map((k) => `<option value="${k}"${h.statut === k ? ' selected' : ''}>${STATUTS[k]}</option>`).join('')}</select></div>` : ''}
          <button class="btn pri" id="b-enregistrer">Enregistrer la fiche</button></div>
          ${h.relie ? '<p class="note">Relié à son établissement : l’environnement et le code ne changent plus.</p>' : ''}</div>
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
  $('#b-enregistrer').onclick = (ev) => agir(ev.target, () => api('PUT', `/hopitaux/${h.id}`, { ...lireFormHopital(), ...($('#h-statut') ? { statut: $('#h-statut').value } : {}) }), 'Fiche enregistrée.');
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
    gl.onclick = () => modale(`Go-live de ${h.nom}`, `<p>La structure et les comptes validés en recette sont importés en production. Chaque compte reçoit un <b>nouveau</b> mot de passe temporaire.</p>
      <p>Aucune donnée de test ne passe en production : ni patients, ni mouvements, ni journal. L’établissement de production est créé inactif ; vous l’activerez ensuite.</p>`,
    [{ label: 'Annuler' }, { label: 'Passer en production', pri: true, run: async () => {
      try {
        const r = await api('POST', `/hopitaux/${h.id}/golive`);
        toast('Go-live fait : l’hôpital est en production.');
        await afficher();
        if (r.comptes.length) setTimeout(() => montrerComptes(r.comptes), 50);
        return true;
      } catch (e) { toast(e.message, true); return false; }
    } }]);
  }
}

function blocGolive(h) {
  if (h.golive_le) return `<p>Passé en production le ${esc(quand(h.golive_le))} par ${esc(h.golive_par)}.</p><p class="note">Structure et comptes importés depuis la recette, avec de nouveaux mots de passe temporaires. Les données de test sont restées en recette.</p>`;
  const raison = !h.golive.production_reliee ? 'La production n’est pas encore reliée à la console (serveur au Canada à installer).'
    : !h.relie ? 'Créez d’abord l’établissement dans la recette.' : h.manquants.length ? 'Toutes les étapes avant le go-live doivent être cochées.' : '';
  return `<p>Importe en production la structure et les comptes validés en recette, avec de nouveaux mots de passe temporaires. Aucune donnée de test ne passe.</p>
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
      <div class="ligne"><button class="btn" data-imp-modele="${type}">${icone('download')}Modèle</button>
        <label class="btn">Choisir le fichier<input type="file" accept=".csv,text/csv" data-imp-fichier="${type}" hidden></label>
        <span class="note donnee">${esc(x.nom || '')}</span>
        <button class="btn pri" data-imp-verifier="${type}"${x.contenu ? '' : ' disabled'}>Vérifier</button></div>${res}</div>`;
  };
  return `<p class="note">Dans cet ordre : unités, chambres, lits, civières, utilisateurs. La vérification n’écrit rien ; l’import est tout ou rien, journalisé, et réimporter met à jour sans doublon. Aucune donnée de patient.</p>
    <div class="imports">${etat.moi.types_import.map(carte).join('')}</div>`;
}

function brancherImports(v, h) {
  v.querySelectorAll('[data-imp-modele]').forEach((b) => {
    b.onclick = async () => {
      try {
        const r = await fetch(`/api/hopitaux/${h.id}/import/modeles/${b.dataset.impModele}`, { headers: { Authorization: `Bearer ${etat.token}` } });
        if (!r.ok) throw new Error('Modèle indisponible : l’environnement ne répond pas.');
        telecharger(await r.blob(), `arrimo-${b.dataset.impModele}.csv`);
      } catch (e) { toast(e.message, true); }
    };
  });
  v.querySelectorAll('[data-imp-fichier]').forEach((inp) => {
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      if (f.size > 1024 * 1024) { toast('Fichier trop gros (1 Mo au plus).', true); return; }
      etat.imports[inp.dataset.impFichier] = { nom: f.name, contenu: await f.text() };
      afficher();
    };
  });
  v.querySelectorAll('[data-imp-verifier]').forEach((b) => {
    const type = b.dataset.impVerifier;
    b.onclick = () => agir(b, async () => { etat.imports[type].verif = await api('POST', `/hopitaux/${h.id}/import/verifier`, { type, contenu: etat.imports[type].contenu }); });
  });
  v.querySelectorAll('[data-imp-importer]').forEach((b) => {
    const type = b.dataset.impImporter;
    b.onclick = () => agir(b, async () => {
      const x = etat.imports[type];
      const r = await api('POST', `/hopitaux/${h.id}/import/importer`, { type, contenu: x.contenu, empreinte: x.verif.empreinte });
      delete etat.imports[type];
      if (r.comptes && r.comptes.length) setTimeout(() => montrerComptes(r.comptes), 50);
      return r;
    }, (r) => `Import fait : ${pl('{n|aucune création|# création|# créations}', { n: r.resume.creer })}, ${pl('{n|aucune mise à jour|# mise à jour|# mises à jour}', { n: r.resume.maj })}.`);
  });
}
/** Mots de passe temporaires des comptes créés : affichés une seule fois, liste téléchargeable une seule fois, jamais conservés. */
function montrerComptes(comptes) {
  modale(pl('{n|# compte créé|# comptes créés}', { n: comptes.length }), `<p class="note">Transmettez ces mots de passe temporaires à l’hôpital par un moyen sûr. Ils ne seront plus jamais affichés.</p>
    <div class="tableau"><table class="compact"><thead><tr><th>Nom</th><th>Courriel</th><th>Mot de passe temporaire</th></tr></thead><tbody>
    ${comptes.map((c) => `<tr><td class="donnee">${esc(c.nom)}</td><td class="donnee">${esc(c.courriel)}</td><td class="num">${esc(c.mot_de_passe_temporaire)}</td></tr>`).join('')}</tbody></table></div>`,
  [{ label: 'Télécharger la liste (une fois)', run: async (b) => {
    const csv = `﻿nom;courriel;role;mot_de_passe_temporaire\r\n${comptes.map((c) => [c.nom, c.courriel, c.role, c.mot_de_passe_temporaire].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n')}\r\n`;
    telecharger(new Blob([csv], { type: 'text/csv' }), 'arrimo-comptes-a-transmettre.csv');
    setTimeout(() => { b.disabled = true; b.textContent = 'Liste téléchargée'; }, 0);
    return false;
  } }, { label: 'Fermer', pri: true }]);
  $('#modale .boite').classList.add('large');
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
  const moi = etat.moi.utilisateur;
  v.innerHTML = `<div class="entete"><div><h2>Équipe SH</h2><p>Comptes de la console. La double authentification est obligatoire pour chacun, dès la première connexion.</p></div></div>
    <div class="deux"><div class="panneau-c"><h3>Nouveau membre</h3>
        <div class="champ"><label class="lbl" for="m-nom">Nom</label><input id="m-nom" autocomplete="off"></div>
        <div class="champ"><label class="lbl" for="m-email">Courriel</label><input id="m-email" type="email" autocomplete="off"></div>
        <button class="btn pri" id="b-membre">Créer le compte</button>
        <p class="note">Un mot de passe temporaire est affiché une seule fois, à transmettre par un moyen sûr.</p></div>
      <div class="tableau"><table><thead><tr><th>Membre</th><th>Sécurité</th><th>Dernière connexion</th><th></th></tr></thead><tbody>
      ${equipe.map((m) => `<tr><td><span class="donnee">${esc(m.nom)}</span>${m.actif ? '' : ' <span class="badge">Désactivé</span>'}<div class="note">${esc(m.email)}</div></td>
        <td class="note">${m.totp_actif ? 'Double authentification' : 'Double authentification à activer'}${m.mdp_temporaire ? '<br>Mot de passe temporaire' : ''}</td>
        <td class="note">${m.derniere_connexion ? esc(quand(m.derniere_connexion)) : 'Jamais'}</td>
        <td>${m.id === moi.id ? '<span class="note">Vous</span>' : `<div class="ligne serre"><button class="btn" data-reinit="${m.id}" data-nom="${esc(m.nom)}">Réinitialiser</button>
          <button class="btn${m.actif ? ' dan' : ''}" data-actif="${m.id}" data-val="${!m.actif}">${m.actif ? 'Désactiver' : 'Réactiver'}</button></div>`}</td></tr>`).join('')}</tbody></table></div></div>`;
  $('#b-membre').onclick = (ev) => agir(ev.target, async () => {
    const r = await api('POST', '/equipe', { nom: $('#m-nom').value, email: $('#m-email').value });
    setTimeout(() => montrerSecret(`Compte créé : ${r.email}`, r.mot_de_passe_temporaire, 'Mot de passe temporaire à transmettre par un moyen sûr.'), 50);
  });
  v.querySelectorAll('[data-reinit]').forEach((b) => {
    b.onclick = () => modale(`Réinitialiser ${b.dataset.nom}`, '<p>Un nouveau mot de passe temporaire est créé et la double authentification est remise à zéro : le membre la réactivera à sa prochaine connexion.</p>',
      [{ label: 'Annuler' }, { label: 'Réinitialiser', pri: true, run: async () => {
        try {
          const r = await api('POST', `/equipe/${b.dataset.reinit}/reinitialiser`);
          setTimeout(() => montrerSecret('Nouveau mot de passe temporaire', r.mot_de_passe_temporaire, `Pour ${b.dataset.nom}.`), 50);
          afficher();
          return true;
        } catch (e) { toast(e.message, true); return false; }
      } }]);
  });
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
if (etat.token) demarrer(); else montrer('#f-connexion');
