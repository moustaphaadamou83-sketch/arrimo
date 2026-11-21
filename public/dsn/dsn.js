/* DSN (22 nov. 2026) : interface du dossier clinique, démonstration et recette seulement (patients synthétiques). FR/EN.
   Formulaires construits à partir du schéma du serveur (/api/dsn/schema) ; le serveur contrôle tout (habilitations, transitions). */
(() => {
  const TXT = {
    fr: { demo: 'ENVIRONNEMENT DÉMO — DONNÉES FICTIVES', nav: { patients: 'Patients', tableau: 'Tableau de bord', dossier: 'Dossier', recues: 'Transitions reçues', parametres: 'Paramètres' },
      sous: { resume: 'Résumé', consultations: 'Consultations', hospitalisations: 'Hospitalisations', prescriptions: 'Prescriptions', examens: 'Examens', documents: 'Documents', transferts: 'Sorties et transferts', historique: 'Historique' },
      rechercher: 'Rechercher (nom, prénom, référence, date de naissance)', nouveau: 'Nouveau patient', prenom: 'Prénom', nom: 'Nom', naissance: 'Date de naissance', creer: 'Créer', ouvrir: 'Ouvrir',
      aucun: 'Aucun élément.', choisir_patient: 'Choisissez un patient dans « Patients ».', allergies: 'Allergies', ajouter: 'Ajouter', fermer: 'Fermer', annuler: 'Annuler', enregistrer: 'Enregistrer',
      signer: 'Signer', valider: 'Valider', resultat: 'Saisir le résultat', sortie: 'Préparer la sortie', amender: 'Amender', annuler_el: 'Annuler l’élément', motif: 'Motif', version: 'v{v}',
      auteur: 'Auteur', statut: 'Statut', quand: 'Date', numero: 'Numéro', urgence: 'Accès d’urgence', justification: 'Justification (obligatoire, journalisée)',
      sans_habilitation: 'Vous n’avez pas d’habilitation DSN pour ce dossier. En cas d’urgence, l’accès d’urgence est journalisé et limité à 4 h.',
      transition_nouvelle: 'Nouvelle transition', destination: 'Destination', a_partager: 'Éléments à partager (minimum nécessaire)', note_transition: 'Note de transition',
      valider_trx: 'Valider (figer le contenu)', envoyer: 'Envoyer', avec_transport: 'Réserver aussi un transport', transporteur: 'Transporteur', plage: 'Plage (début, fin)', vehicule: 'Véhicule',
      accepter: 'Accepter', refuser: 'Refuser', reception: 'Confirmer la réception', arrivee_prevue: 'Arrivée prévue', ouvrir_dossier: 'Ouvrir notre dossier', source: 'Source', paquet: 'Paquet de transition (seulement ce qui a été partagé)',
      habilitations: 'Habilitations DSN', journal: 'Journal d’accès', utilisateur: 'Utilisateur', action: 'Action', objet: 'Objet', prescription_simulee: 'Prescription SIMULÉE : jamais envoyée à une pharmacie.',
      tableau_txt: 'Patients du DSN : {p} · séjours en cours : {s} · transitions en attente : {t}', inactif: 'Le DSN n’est pas activé pour cet établissement, ou vous n’y avez pas d’habilitation.', ok: 'Enregistré.', telecharger: 'Télécharger',
      deposer: 'Déposer un document (PDF, PNG, JPEG, 5 Mo)', titre_doc: 'Titre', type_doc: 'Type', fichier: 'Fichier',
      g: { allergie: 'Allergie', antecedent: 'Antécédent', rencontre: 'Rencontre', note: 'Note', observation: 'Observation', diagnostic: 'Diagnostic', prescription: 'Prescription', examen: 'Examen', sejour: 'Séjour' },
      c: { substance: 'Substance', reaction: 'Réaction', gravite: 'Gravité', verification: 'Vérification', libelle: 'Libellé', type: 'Type', motif: 'Motif', equipe: 'Équipe', titre: 'Titre', texte: 'Texte', valeur: 'Valeur', unite: 'Unité', code: 'Code', certitude: 'Certitude', dose: 'Dose', voie: 'Voie', frequence: 'Fréquence', duree: 'Durée', indication: 'Indication', type_examen: 'Examen', prestataire: 'Prestataire', resultat: 'Résultat', priorite: 'Priorité', service: 'Service', lit: 'Lit', destination: 'Destination', synthese: 'Synthèse de sortie', consignes: 'Consignes' } },
    en: { demo: 'DEMO ENVIRONMENT — FICTITIOUS DATA', nav: { patients: 'Patients', tableau: 'Dashboard', dossier: 'Record', recues: 'Received transitions', parametres: 'Settings' },
      sous: { resume: 'Summary', consultations: 'Encounters', hospitalisations: 'Hospital stays', prescriptions: 'Prescriptions', examens: 'Tests', documents: 'Documents', transferts: 'Discharge and transfers', historique: 'History' },
      rechercher: 'Search (last name, first name, reference, date of birth)', nouveau: 'New patient', prenom: 'First name', nom: 'Last name', naissance: 'Date of birth', creer: 'Create', ouvrir: 'Open',
      aucun: 'Nothing yet.', choisir_patient: 'Choose a patient in “Patients”.', allergies: 'Allergies', ajouter: 'Add', fermer: 'Close', annuler: 'Cancel', enregistrer: 'Save',
      signer: 'Sign', valider: 'Validate', resultat: 'Enter the result', sortie: 'Prepare discharge', amender: 'Amend', annuler_el: 'Cancel item', motif: 'Reason', version: 'v{v}',
      auteur: 'Author', statut: 'Status', quand: 'Date', numero: 'Number', urgence: 'Emergency access', justification: 'Justification (required, logged)',
      sans_habilitation: 'You have no EHR authorization for this record. In an emergency, emergency access is logged and limited to 4 hours.',
      transition_nouvelle: 'New transition', destination: 'Destination', a_partager: 'Items to share (minimum necessary)', note_transition: 'Transition note',
      valider_trx: 'Validate (freeze the content)', envoyer: 'Send', avec_transport: 'Also book a transport', transporteur: 'Carrier', plage: 'Time slot (start, end)', vehicule: 'Vehicle',
      accepter: 'Accept', refuser: 'Decline', reception: 'Confirm receipt', arrivee_prevue: 'Expected arrival', ouvrir_dossier: 'Open our record', source: 'Source', paquet: 'Transition package (only what was shared)',
      habilitations: 'EHR authorizations', journal: 'Access log', utilisateur: 'User', action: 'Action', objet: 'Object', prescription_simulee: 'SIMULATED prescription: never sent to a pharmacy.',
      tableau_txt: 'EHR patients: {p} · ongoing stays: {s} · pending transitions: {t}', inactif: 'The EHR is not turned on for this facility, or you have no authorization there.', ok: 'Saved.', telecharger: 'Download',
      deposer: 'Upload a document (PDF, PNG, JPEG, 5 MB)', titre_doc: 'Title', type_doc: 'Type', fichier: 'File',
      g: { allergie: 'Allergy', antecedent: 'History item', rencontre: 'Encounter', note: 'Note', observation: 'Observation', diagnostic: 'Diagnosis', prescription: 'Prescription', examen: 'Test', sejour: 'Stay' },
      c: { substance: 'Substance', reaction: 'Reaction', gravite: 'Severity', verification: 'Verification', libelle: 'Label', type: 'Type', motif: 'Reason', equipe: 'Team', titre: 'Title', texte: 'Text', valeur: 'Value', unite: 'Unit', code: 'Code', certitude: 'Certainty', dose: 'Dose', voie: 'Route', frequence: 'Frequency', duree: 'Duration', indication: 'Indication', type_examen: 'Test', prestataire: 'Provider', resultat: 'Result', priorite: 'Priority', service: 'Service', lit: 'Bed', destination: 'Destination', synthese: 'Discharge summary', consignes: 'Instructions' } },
  };
  window.ArrimoDsn = { TXT };
  const lire = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  let L = lire('arrimo-langue') === 'en' ? 'en' : 'fr'; const jeton = lire('arrimo-token');
  const X = () => TXT[L]; const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
  const main = document.getElementById('ds-main'); const modale = document.getElementById('ds-modale'); const mform = document.getElementById('ds-modale-form');
  const etat = { vue: 'patients', sous: 'resume', etab: null, patient: null, schema: null, moi: null, q: '' };
  const quand = (d) => (d ? new Date(d).toLocaleString(L === 'en' ? 'en-CA' : 'fr-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '');
  async function api(m, c, b) {
    const r = await fetch(`/api${c}`, { method: m, headers: { Authorization: `Bearer ${jeton}`, 'X-Langue': L, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    if (r.status === 401) { location.replace('/'); throw new Error('session'); }
    const d = await r.json().catch(() => null); if (!r.ok) { const e = new Error((d && d.erreur) || `Erreur ${r.status}`); e.statut = r.status; e.code = d?.code; throw e; } return d;
  }
  // Statuts lisibles (FR/EN) ; jamais un code brut à l'écran
  const STATUTS = {
    fr: { hospitalise: 'Hospitalisé', enregistre: 'Enregistré', transfere: 'Transféré', signee: 'Signée', validee: 'Validée (simulée)', actif: 'Actif', recu: 'Reçu', accepte: 'Accepté',
      resultat: 'Résultat disponible', finale: 'Finale', confirmee: 'Confirmée', annule: 'Annulé', refuse: 'Refusé', brouillon: 'Brouillon', demande: 'Demandé', envoye: 'Envoyé',
      en_cours: 'En cours', sortie_preparee: 'Sortie préparée', valide: 'Validé', ouverte: 'Ouverte', fermee: 'Fermée' },
    en: { hospitalise: 'In hospital', enregistre: 'Registered', transfere: 'Transferred', signee: 'Signed', validee: 'Validated (simulated)', actif: 'Active', recu: 'Received', accepte: 'Accepted',
      resultat: 'Result available', finale: 'Final', confirmee: 'Confirmed', annule: 'Cancelled', refuse: 'Declined', brouillon: 'Draft', demande: 'Requested', envoye: 'Sent',
      en_cours: 'In progress', sortie_preparee: 'Discharge prepared', valide: 'Validated', ouverte: 'Open', fermee: 'Closed' } };
  const badge = (s) => `<span class="badge ${['signee', 'validee', 'actif', 'recu', 'accepte', 'resultat', 'finale', 'confirmee'].includes(s) ? 'ok' : ['annule', 'refuse'].includes(s) ? 'ko' : ['brouillon', 'demande', 'envoye', 'en_cours', 'sortie_preparee', 'valide'].includes(s) ? 'att' : ''}">${esc(STATUTS[L][s] || String(s).replaceAll('_', ' '))}</span>`;
  // Valeurs des listes fermées, lisibles (FR/EN)
  const VALEURS = {
    fr: { legere: 'légère', moderee: 'modérée', severe: 'sévère', suspectee: 'suspectée', confirmee: 'confirmée', medical: 'médical', chirurgical: 'chirurgical', familial: 'familial',
      ambulatoire: 'ambulatoire', urgence: 'urgence', hospitalisation: 'hospitalisation', suivi: 'suivi', ta: 'Tension artérielle', fc: 'Fréquence cardiaque', temperature: 'Température',
      spo2: 'Saturation', poids: 'Poids', glycemie: 'Glycémie', douleur: 'Douleur', autre: 'Autre', provisoire: 'provisoire', confirme: 'confirmé', routine: 'routine', urgente: 'urgente' },
    en: { legere: 'mild', moderee: 'moderate', severe: 'severe', suspectee: 'suspected', confirmee: 'confirmed', medical: 'medical', chirurgical: 'surgical', familial: 'family',
      ambulatoire: 'outpatient', urgence: 'emergency', hospitalisation: 'inpatient', suivi: 'follow-up', ta: 'Blood pressure', fc: 'Heart rate', temperature: 'Temperature',
      spo2: 'Oxygen saturation', poids: 'Weight', glycemie: 'Blood glucose', douleur: 'Pain', autre: 'Other', provisoire: 'provisional', confirme: 'confirmed', routine: 'routine', urgente: 'urgent' } };
  const resume = (g, d) => { const k = { allergie: ['substance', 'gravite'], antecedent: ['libelle', 'type'], rencontre: ['type', 'motif'], note: ['titre', 'texte'], observation: ['type', 'valeur', 'unite'], diagnostic: ['libelle', 'certitude'], prescription: ['substance', 'dose', 'voie', 'frequence'], examen: ['type_examen', 'resultat'], sejour: ['service', 'destination'] }[g] || []; return k.map((x) => d[x]).filter(Boolean).map((x) => esc((VALEURS[L][x] || String(x)).slice(0, 160))).join(' · '); };

  // ---------------------------------------------------------------- formulaires (modale)
  function demander(titre, champs, ok) {
    mform.innerHTML = `<h2>${esc(titre)}</h2>${champs}<p class="erreur" id="ds-err" role="alert"></p><div class="ligne" style="justify-content:flex-end"><button class="btn" value="annuler">${esc(X().annuler)}</button><button class="btn pri" value="ok" id="ds-ok">${esc(X().enregistrer)}</button></div>`;
    modale.showModal(); mform.querySelector('input, select, textarea')?.focus();
    mform.onsubmit = async (ev) => {
      if (ev.submitter?.value !== 'ok') return; ev.preventDefault();
      try { await ok(new FormData(mform)); modale.close(); rendre(); } catch (e) { document.getElementById('ds-err').textContent = e.message; }
    };
  }
  function champsGenre(genre) {
    const s = etat.schema.genres[genre];
    const ch = s.champs.filter((k) => !(genre === 'examen' && k === 'resultat')).map((k) => `<div class="champ"><label for="g-${k}">${esc(X().c[k] || k)}${s.requis.includes(k) ? ' *' : ''}</label>${['texte', 'synthese', 'consignes', 'resultat'].includes(k) ? `<textarea id="g-${k}" name="${k}" rows="4"></textarea>` : `<input id="g-${k}" name="${k}">`}</div>`).join('');
    const li = Object.entries(s.listes).map(([k, v]) => `<div class="champ"><label for="g-${k}">${esc(X().c[k] || k)}${s.requis.includes(k) ? ' *' : ''}</label><select id="g-${k}" name="${k}"><option value=""></option>${v.map((x) => `<option value="${x}">${esc(VALEURS[L][x] || x.replaceAll('_', ' '))}</option>`).join('')}</select></div>`).join('');
    return ch + li;
  }
  function ajouterElement(genre, rencontreId = null) {
    demander(`${X().ajouter} · ${X().g[genre]}`, `${genre === 'prescription' ? `<p class="note">⚠ ${esc(X().prescription_simulee)}</p>` : ''}${champsGenre(genre)}`, async (fd) => {
      const donnees = Object.fromEntries([...fd.entries()].filter(([, v]) => v !== ''));
      await api('POST', `/dsn/patients/${etat.patient}/elements`, { genre, donnees, ...(rencontreId ? { rencontre_id: rencontreId } : {}) });
    });
  }
  async function action(id, a, extra = {}) {
    if (['amender', 'annuler'].includes(a)) {
      return demander(a === 'amender' ? X().amender : X().annuler_el, `<div class="champ"><label for="m-motif">${esc(X().motif)} *</label><input id="m-motif" name="motif" required minlength="5"></div>`, async (fd) => api('POST', `/dsn/elements/${id}/action`, { action: a, motif: fd.get('motif'), ...extra }));
    }
    if (a === 'resultat') return demander(X().resultat, `<div class="champ"><label for="m-res">${esc(X().c.resultat)} *</label><textarea id="m-res" name="resultat" rows="4" required></textarea></div>`, async (fd) => api('POST', `/dsn/elements/${id}/action`, { action: a, resultat: fd.get('resultat') }));
    if (a === 'sortie') return demander(X().sortie, ['destination', 'synthese', 'consignes'].map((k) => `<div class="champ"><label for="m-${k}">${esc(X().c[k])}</label>${k === 'destination' ? `<input id="m-${k}" name="${k}">` : `<textarea id="m-${k}" name="${k}" rows="3"></textarea>`}</div>`).join(''), async (fd) => api('POST', `/dsn/elements/${id}/action`, { action: a, donnees: Object.fromEntries(fd.entries()) }));
    try { await api('POST', `/dsn/elements/${id}/action`, { action: a }); rendre(); } catch (e) { alert(e.message); }
  }
  const boutons = (x, fon) => {
    if (x.remplace_par || x.statut === 'annule') return '';
    const b = []; const c = fon.some((y) => ['infirmier', 'medecin'].includes(y)); const m = fon.includes('medecin');
    if (['note', 'rencontre'].includes(x.genre) && x.statut !== 'signee' && c) b.push(['signer', X().signer]);
    if (x.genre === 'prescription' && x.statut === 'brouillon' && m) b.push(['valider', X().valider]);
    if (x.genre === 'examen' && x.statut === 'demande' && c) b.push(['resultat', X().resultat]);
    if (x.genre === 'sejour' && x.statut === 'en_cours' && (m || fon.includes('sortie'))) b.push(['sortie', X().sortie]);
    if (c || fon.includes('admission')) b.push(['amender', X().amender], ['annuler', X().annuler_el]);
    return b.map(([a, l]) => `<button class="btn" data-el-action="${a}" data-id="${x.id}">${esc(l)}</button>`).join('');
  };
  const table = (xs, fon, extra = '') => (xs.length ? `<div class="tableau"><table><thead><tr><th>${X().numero}</th><th></th><th>${X().statut}</th><th>${X().auteur}</th><th>${X().quand}</th><th></th></tr></thead><tbody>
    ${xs.map((x) => `<tr><td><b>${esc(x.numero)}</b>${x.version > 1 ? ` <span class="note">${esc(f(X().version, { v: x.version }))}</span>` : ''}${x.source === 'transition' ? ` <span class="badge">${esc(X().source)} : transition</span>` : ''}</td><td>${resume(x.genre, x.donnees)}${x.genre === 'prescription' ? ' <span class="badge att">SIMULÉE</span>' : ''}</td><td>${badge(x.statut)}</td><td>${esc(x.auteur || '')}${x.signataire ? `<div class="note">✍ ${esc(x.signataire)}</div>` : ''}</td><td class="note">${esc(quand(x.cree_le))}</td><td><div class="ligne">${boutons(x, fon)}${extra && x.genre === 'rencontre' ? `<button class="btn" data-ajout="note" data-rencontre="${x.id}">+ ${esc(X().g.note)}</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>` : `<p class="vide">${esc(X().aucun)}</p>`);
  const ajout = (genre, fon) => (etat.schema.genres[genre].creer.some((x) => fon.includes(x)) ? `<button class="btn pri" data-ajout="${genre}">+ ${esc(X().g[genre])}</button>` : '');

  // ---------------------------------------------------------------- vues
  async function vuePatients() {
    let d; try { d = await api('GET', `/dsn/patients?etablissement_id=${etat.etab}&q=${encodeURIComponent(etat.q)}`); } catch (e) { main.innerHTML = `<p class="carte">${esc(X().inactif)}<br><span class="note">${esc(e.message)}</span></p>`; return; }
    main.innerHTML = `<div class="carte"><div class="ligne"><input id="ds-q" type="search" value="${esc(etat.q)}" placeholder="${esc(X().rechercher)}" aria-label="${esc(X().rechercher)}" style="flex:1 1 320px;padding:9px 11px;border:1px solid var(--b);border-radius:9px;min-height:40px;background:var(--fond);color:var(--t)">${d.fonctions.includes('admission') ? `<button class="btn pri" id="ds-nouveau">+ ${esc(X().nouveau)}</button>` : ''}</div></div>
      <div class="carte tableau"><table><thead><tr><th>Ref.</th><th>${X().nom}</th><th>${X().naissance}</th><th>${X().allergies}</th><th>${X().statut}</th><th></th></tr></thead><tbody>
      ${d.patients.map((p) => `<tr><td><b>${esc(p.reference)}</b></td><td>${esc(p.nom)}, ${esc(p.prenom)}</td><td>${esc(String(p.date_naissance).slice(0, 10))}</td><td>${p.allergies ? `<span class="allergie">⚠ ${p.allergies}</span>` : ''}</td><td>${badge(p.parcours)}</td><td><button class="btn" data-ouvrir="${p.id}">${esc(X().ouvrir)}</button></td></tr>`).join('') || `<tr><td colspan="6" class="vide">${esc(X().aucun)}</td></tr>`}</tbody></table></div>`;
  }
  async function vueTableau() {
    let d; try { d = await api('GET', `/dsn/patients?etablissement_id=${etat.etab}`); } catch (e) { main.innerHTML = `<p class="carte">${esc(X().inactif)}</p>`; return; }
    const r = await api('GET', `/dsn/transitions/recues?etablissement_id=${etat.etab}`).catch(() => []);
    main.innerHTML = `<div class="carte"><h1>${esc(X().nav.tableau)}</h1><p>${esc(f(X().tableau_txt, { p: d.patients.length, s: d.patients.filter((p) => p.parcours === 'hospitalise').length, t: r.filter((x) => x.statut === 'envoye').length }))}</p></div>`;
  }
  async function vueDossier() {
    if (!etat.patient) { main.innerHTML = `<p class="carte">${esc(X().choisir_patient)}</p>`; return; }
    let d; try { d = await api('GET', `/dsn/patients/${etat.patient}`); } catch (e) {
      main.innerHTML = `<div class="carte"><p>${esc(e.message)}</p>${e.code === 'dsn_habilitation_requise' ? `<p class="note">${esc(X().sans_habilitation)}</p><button class="btn dan" id="ds-urgence">${esc(X().urgence)}</button>` : ''}</div>`; return;
    }
    const fon = d.fonctions; const p = d.patient;
    const act = d.allergies.filter((x) => x.statut === 'actif');
    const S = X().sous;
    let corps = '';
    if (etat.sous === 'resume') corps = ['allergie', 'antecedent', 'diagnostic', 'observation'].map((g) => `<div class="carte"><div class="ligne" style="justify-content:space-between"><h2>${esc(X().g[g])}</h2>${ajout(g, fon)}</div>${table(d[{ allergie: 'allergies', antecedent: 'antecedents', diagnostic: 'diagnostics', observation: 'observations' }[g]], fon)}</div>`).join('');
    if (etat.sous === 'consultations') corps = `<div class="carte"><div class="ligne" style="justify-content:space-between"><h2>${esc(X().g.rencontre)}</h2>${ajout('rencontre', fon)}</div>${table(d.rencontres, fon, true)}</div><div class="carte"><h2>${esc(X().g.note)}</h2>${table(d.notes, fon)}</div>`;
    if (etat.sous === 'hospitalisations') corps = `<div class="carte"><div class="ligne" style="justify-content:space-between"><h2>${esc(X().g.sejour)}</h2>${ajout('sejour', fon)}</div>${table(d.sejours, fon)}</div>`;
    if (etat.sous === 'prescriptions') corps = `<div class="carte"><p class="note">⚠ ${esc(X().prescription_simulee)}</p><div class="ligne" style="justify-content:space-between"><h2>${esc(X().g.prescription)}</h2>${ajout('prescription', fon)}</div>${table(d.prescriptions, fon)}</div>`;
    if (etat.sous === 'examens') corps = `<div class="carte"><div class="ligne" style="justify-content:space-between"><h2>${esc(X().g.examen)}</h2>${ajout('examen', fon)}</div>${table(d.examens, fon)}</div>`;
    if (etat.sous === 'documents') corps = `<div class="carte"><div class="ligne" style="justify-content:space-between"><h2>${esc(X().sous.documents)}</h2><button class="btn pri" id="ds-deposer">+ ${esc(X().deposer)}</button></div>
      ${d.documents.length ? `<div class="tableau"><table><tbody>${d.documents.map((x) => `<tr><td><b>${esc(x.numero)}</b></td><td>${esc(x.titre)}</td><td>${esc(x.type_doc)}</td><td class="note">${Math.round(x.taille / 1024)} Ko · ${esc(quand(x.cree_le))} · ${esc(x.auteur)}</td><td><button class="btn" data-doc="${x.id}">${esc(X().telecharger)}</button></td></tr>`).join('')}</tbody></table></div>` : `<p class="vide">${esc(X().aucun)}</p>`}</div>`;
    if (etat.sous === 'transferts') corps = `<div class="carte"><div class="ligne" style="justify-content:space-between"><h2>${esc(X().sous.transferts)}</h2>${fon.some((x) => ['medecin', 'sortie'].includes(x)) ? `<button class="btn pri" id="ds-trx">+ ${esc(X().transition_nouvelle)}</button>` : ''}</div>
      ${d.transitions.length ? `<div class="tableau"><table><tbody>${d.transitions.map((t) => `<tr><td><b>${esc(t.numero)}</b></td><td>→ ${esc(t.destination)}</td><td>${badge(t.statut)}</td><td class="note">${esc(quand(t.envoye_le || t.cree_le))}</td><td><div class="ligne">${t.statut === 'brouillon' ? `<button class="btn" data-trx-valider="${t.id}">${esc(X().valider_trx)}</button>` : ''}${t.statut === 'valide' ? `<button class="btn pri" data-trx-envoyer="${t.id}">${esc(X().envoyer)}</button>` : ''}<button class="btn" data-sillage="dsn_transition:${t.id}">Sillage</button></div></td></tr>`).join('')}</tbody></table></div>` : `<p class="vide">${esc(X().aucun)}</p>`}</div>`;
    if (etat.sous === 'historique') corps = `<div class="carte"><h2>${esc(X().sous.historique)}</h2><ol class="chrono">${d.chronologie.map((c) => `<li><span class="note">${esc(quand(c.quand))}</span> · <b>${esc(X().g[c.genre] || c.genre)}</b> ${esc(c.numero)} ${badge(c.statut)}${c.auteur ? ` <span class="note">· ${esc(c.auteur)}</span>` : ''}</li>`).join('')}</ol></div>
      ${d.versions.length ? `<div class="carte"><h2>Versions</h2>${table(d.versions, [])}</div>` : ''}${fon.includes('auditeur') ? '<div class="carte" id="ds-journal-patient"></div>' : ''}`;
    main.innerHTML = `<div class="carte"><div class="entete-patient"><div><div class="id">${esc(p.nom)}, ${esc(p.prenom)}</div><div class="note">${esc(p.reference)} · ${esc(String(p.date_naissance).slice(0, 10))} · ${badge(p.parcours)}</div></div>
        <div>${act.map((x) => `<span class="allergie">⚠ ${esc(x.donnees.substance)}${x.donnees.gravite ? ` (${esc(VALEURS[L][x.donnees.gravite] || x.donnees.gravite)})` : ''}</span>`).join('')}</div></div></div>
      <div class="sous" role="tablist">${Object.keys(S).map((k) => `<button role="tab" data-sous="${k}" aria-selected="${etat.sous === k}">${esc(S[k])}</button>`).join('')}</div>${corps}`;
    if (fon.includes('auditeur') && etat.sous === 'historique') {
      const j = await api('GET', `/dsn/acces?etablissement_id=${etat.etab}&patient_id=${p.id}`).catch(() => []);
      document.getElementById('ds-journal-patient').innerHTML = `<h2>${esc(X().journal)}</h2><div class="tableau"><table><tbody>${j.map((x) => `<tr><td class="note">${esc(quand(x.cree_le))}</td><td>${esc(x.utilisateur)}</td><td>${badge(x.action)}</td><td>${esc(x.objet || '')}${x.justification ? ` · ${esc(x.justification)}` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    }
  }
  async function vueRecues() {
    let r; try { r = await api('GET', `/dsn/transitions/recues?etablissement_id=${etat.etab}`); } catch (e) { main.innerHTML = `<p class="carte">${esc(e.message)}</p>`; return; }
    main.innerHTML = `<h1>${esc(X().nav.recues)}</h1>${r.map((t) => { const c = t.contenu || {}; const pt = c.patient || {};
      return `<div class="carte"><div class="ligne" style="justify-content:space-between"><h2>${esc(t.numero)} · ${esc(t.source)}</h2>${badge(t.statut)}</div>
        <p><b>${esc(pt.nom)}, ${esc(pt.prenom)}</b> · ${esc(String(pt.date_naissance || '').slice(0, 10))} · ${esc(pt.reference)}</p>
        <h3>${esc(X().paquet)}</h3><ul>${(c.elements || []).map((x) => `<li><b>${esc(X().g[x.genre] || x.genre)}</b> : ${resume(x.genre, x.donnees)} <span class="note">(${esc(x.numero)})</span></li>`).join('') || `<li class="note">${esc(X().aucun)}</li>`}</ul>
        ${c.note_transition ? `<p><b>${esc(X().note_transition)}</b> : ${esc(c.note_transition)}</p>` : ''}
        <div class="ligne">${t.statut === 'envoye' ? `<button class="btn pri" data-trx-decision="accepter" data-id="${t.id}">${esc(X().accepter)}</button><button class="btn" data-trx-decision="refuser" data-id="${t.id}">${esc(X().refuser)}</button>` : ''}
          ${t.statut === 'accepte' ? `<button class="btn pri" data-trx-decision="reception" data-id="${t.id}">${esc(X().reception)}</button>` : ''}${t.statut === 'recu' ? `<button class="btn" data-trx-dossier="${t.id}">${esc(X().ouvrir_dossier)}</button>` : ''}
          <button class="btn" data-sillage="dsn_transition:${t.id}">Sillage</button></div></div>`; }).join('') || `<p class="carte vide">${esc(X().aucun)}</p>`}`;
  }
  async function vueParametres() {
    let h = null; try { h = await api('GET', `/dsn/habilitations?etablissement_id=${etat.etab}`); } catch { /* */ }
    let j = null; try { j = await api('GET', `/dsn/acces?etablissement_id=${etat.etab}`); } catch { /* */ }
    main.innerHTML = `${h ? `<div class="carte"><h2>${esc(X().habilitations)}</h2><div class="tableau"><table><thead><tr><th>${X().utilisateur}</th>${etat.schema.fonctions.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>
      ${h.map((u) => `<tr><td>${esc(u.nom)} <span class="note">${esc(u.role)}</span></td>${etat.schema.fonctions.map((x) => `<td><input type="checkbox" data-hab="${u.id}" data-fonction="${x}"${u.fonctions.includes(x) ? ' checked' : ''} aria-label="${esc(u.nom)} · ${esc(x)}"></td>`).join('')}</tr>`).join('')}</tbody></table></div></div>` : ''}
      ${j ? `<div class="carte"><h2>${esc(X().journal)}</h2><div class="tableau"><table><tbody>${j.map((x) => `<tr><td class="note">${esc(quand(x.cree_le))}</td><td>${esc(x.utilisateur)}</td><td>${badge(x.action)}</td><td>${esc(x.reference || '')} ${esc(x.objet || '')}${x.justification ? ` · ${esc(x.justification)}` : ''}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      ${!h && !j ? `<p class="carte">${esc(X().inactif)}</p>` : ''}`;
  }
  async function rendre() {
    document.documentElement.lang = L === 'en' ? 'en-CA' : 'fr-CA';
    document.getElementById('ds-demo').textContent = X().demo;
    document.querySelectorAll('[data-ds-langue]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dsLangue === L)));
    document.getElementById('ds-nav').innerHTML = Object.keys(X().nav).map((k) => `<button role="tab" data-vue="${k}" aria-selected="${etat.vue === k}">${esc(X().nav[k])}</button>`).join('');
    if (!etat.schema) etat.schema = await api('GET', '/dsn/schema').catch((e) => { main.innerHTML = `<p class="carte">${esc(e.message)}</p>`; return null; });
    if (!etat.schema) return;
    ({ patients: vuePatients, tableau: vueTableau, dossier: vueDossier, recues: vueRecues, parametres: vueParametres })[etat.vue]();
  }

  // ---------------------------------------------------------------- événements
  document.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button'); if (!t) return;
    if (t.dataset.dsLangue) { L = t.dataset.dsLangue; try { localStorage.setItem('arrimo-langue', L); } catch { /* */ } rendre(); return; }
    if (t.dataset.vue) { etat.vue = t.dataset.vue; rendre(); return; }
    if (t.dataset.sous) { etat.sous = t.dataset.sous; rendre(); return; }
    if (t.dataset.ouvrir) { etat.patient = Number(t.dataset.ouvrir); etat.vue = 'dossier'; etat.sous = 'resume'; rendre(); return; }
    if (t.dataset.ajout) { ajouterElement(t.dataset.ajout, t.dataset.rencontre ? Number(t.dataset.rencontre) : null); return; }
    if (t.dataset.elAction) { action(t.dataset.id, t.dataset.elAction); return; }
    if (t.id === 'ds-nouveau') { demander(X().nouveau, ['prenom', 'nom'].map((k) => `<div class="champ"><label for="n-${k}">${esc(X()[k])} *</label><input id="n-${k}" name="${k}" required></div>`).join('') + `<div class="champ"><label for="n-dn">${esc(X().naissance)} *</label><input id="n-dn" name="date_naissance" type="date" required></div>`,
      async (fd) => { const p = await api('POST', '/dsn/patients', { etablissement_id: etat.etab, prenom: fd.get('prenom'), nom: fd.get('nom'), date_naissance: fd.get('date_naissance') }); etat.patient = p.id; etat.vue = 'dossier'; etat.sous = 'resume'; }); return; }
    if (t.id === 'ds-urgence') { demander(X().urgence, `<div class="champ"><label for="u-j">${esc(X().justification)} *</label><input id="u-j" name="justification" required minlength="10"></div>`, async (fd) => api('POST', `/dsn/patients/${etat.patient}/urgence`, { justification: fd.get('justification') })); return; }
    if (t.dataset.doc) { const r = await fetch(`/api/dsn/documents/${t.dataset.doc}`, { headers: { Authorization: `Bearer ${jeton}` } }); if (!r.ok) return alert(X().inactif); const u = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = u; a.download = ''; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000); return; }
    if (t.id === 'ds-deposer') { demander(X().deposer, `<div class="champ"><label for="d-t">${esc(X().titre_doc)} *</label><input id="d-t" name="titre" required></div><div class="champ"><label for="d-ty">${esc(X().type_doc)}</label><select id="d-ty" name="type_doc">${['rapport', 'resultat', 'imagerie', 'lettre', 'consentement', 'autre'].map((x) => `<option>${x}</option>`).join('')}</select></div><div class="champ"><label for="d-f">${esc(X().fichier)} *</label><input id="d-f" name="fichier" type="file" accept="application/pdf,image/png,image/jpeg" required></div>`,
      async (fd) => { const fi = fd.get('fichier'); const b64 = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(fi); }); await api('POST', `/dsn/patients/${etat.patient}/documents`, { titre: fd.get('titre'), type_doc: fd.get('type_doc'), mime: fi.type, contenu_base64: b64 }); }); return; }
    if (t.id === 'ds-trx') {
      const d = await api('GET', `/dsn/patients/${etat.patient}`); const etabs = await api('GET', '/etablissements').catch(() => []);
      const part = [...d.allergies, ...d.antecedents, ...d.diagnostics, ...d.prescriptions.filter((x) => x.statut === 'validee'), ...d.observations, ...d.sejours].filter((x) => etat.schema.partageables.includes(x.genre));
      demander(X().transition_nouvelle, `<div class="champ"><label for="t-d">${esc(X().destination)} *</label><select id="t-d" name="destination_id" required>${(Array.isArray(etabs) ? etabs : etabs.etablissements || []).filter((e) => e.id !== etat.etab).map((e) => `<option value="${e.id}">${esc(e.nom)}</option>`).join('')}</select></div>
        <fieldset class="cases"><legend><b>${esc(X().a_partager)}</b></legend>${part.map((x) => `<label><input type="checkbox" name="elements" value="${x.id}"> ${esc(X().g[x.genre])} : ${resume(x.genre, x.donnees)}</label>`).join('') || `<p class="note">${esc(X().aucun)}</p>`}</fieldset>
        <div class="champ"><label for="t-n">${esc(X().note_transition)}</label><textarea id="t-n" name="note_transition" rows="3"></textarea></div>`,
      async (fd) => api('POST', `/dsn/patients/${etat.patient}/transitions`, { destination_id: Number(fd.get('destination_id')), elements: fd.getAll('elements').map(Number), note_transition: fd.get('note_transition'), sejour_id: d.sejours[0]?.id }));
      return;
    }
    if (t.dataset.trxValider) { try { await api('POST', `/dsn/transitions/${t.dataset.trxValider}/valider`); rendre(); } catch (e) { alert(e.message); } return; }
    if (t.dataset.trxEnvoyer) { try { await api('POST', `/dsn/transitions/${t.dataset.trxEnvoyer}/envoyer`, {}); rendre(); } catch (e) { alert(e.message); } return; }
    if (t.dataset.trxDecision) {
      const id = t.dataset.id; const dec = t.dataset.trxDecision;
      if (dec === 'refuser') return demander(X().refuser, `<div class="champ"><label for="r-m">${esc(X().motif)} *</label><input id="r-m" name="motif" required minlength="3"></div>`, async (fd) => api('POST', `/dsn/transitions/${id}/decision`, { decision: 'refuser', motif: fd.get('motif') }));
      if (dec === 'accepter') return demander(X().accepter, `<div class="champ"><label for="a-h">${esc(X().arrivee_prevue)}</label><input id="a-h" name="arrivee" type="datetime-local"></div>`, async (fd) => api('POST', `/dsn/transitions/${id}/decision`, { decision: 'accepter', arrivee_prevue_le: fd.get('arrivee') ? new Date(fd.get('arrivee')).toISOString() : null }));
      try { await api('POST', `/dsn/transitions/${id}/decision`, { decision: dec }); rendre(); } catch (e) { alert(e.message); } return;
    }
    if (t.dataset.trxDossier) { try { const p = await api('POST', `/dsn/transitions/${t.dataset.trxDossier}/dossier`); etat.patient = p.id; etat.vue = 'dossier'; rendre(); } catch (e) { alert(e.message); } }
  });
  document.addEventListener('change', async (ev) => {
    if (ev.target.id === 'ds-etab') { etat.etab = Number(ev.target.value); etat.patient = null; rendre(); return; }
    const h = ev.target.closest('[data-hab]'); if (h) { try { await api('PUT', '/dsn/habilitations', { etablissement_id: etat.etab, utilisateur_id: Number(h.dataset.hab), fonction: h.dataset.fonction, actif: h.checked }); } catch (e) { h.checked = !h.checked; alert(e.message); } }
  });
  document.addEventListener('keydown', (ev) => { if (ev.target.id === 'ds-q' && ev.key === 'Enter') { etat.q = ev.target.value; rendre(); } });
  if (!jeton) { location.replace('/'); return; }
  api('GET', '/moi').then((m) => {
    etat.moi = m; const e = m.etablissements || []; etat.etab = e[0]?.id || null;
    document.getElementById('ds-etab').innerHTML = e.map((x) => `<option value="${x.id}">${esc(x.nom)}</option>`).join('');
    rendre();
  }).catch(() => location.replace('/'));
})();
