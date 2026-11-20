/* Données (20 nov. 2026, cahier v2, C.6) : tableaux par région et par établissement, listes d'attente par type de ressource,
   refus par motif ; petits nombres masqués (« < 5 ») ; CSV sans référence. Utilisé dans l'application (onglet Données) et dans
   la page de la direction régionale ; textes FR/EN propres à ce fichier. */
(() => {
  const TXT = {
    fr: { titre: 'Données', intro: 'Agrégats calculés sur les données enregistrées ; aucune référence patient ; cellules de 1 à 4 masquées (« < 5 »).', periode: 'Période', jours: '{n} derniers jours',
      csv: 'Exporter en CSV', etab: 'Établissement', region: 'Région', chrono: 'Passages Chrono', porte: 'Porte médiane (min)', transferts: 'Transferts', refuses: 'Refusés', decision: 'Décision médiane (min)',
      nsa: 'NSA ouverts', jours_nsa: 'Jours NSA médians', places: 'Places libres', totaux: 'Total', attente: 'Listes d’attente par type de ressource', genre: 'Type', personnes: 'Personnes en attente',
      anciennete: 'Ancienneté médiane (jours)', en_face: 'Places libres en face', refus: 'Refus par motif', aucun: 'Aucune donnée sur la période.', masque: '< 5',
      g: { chsld: 'CHSLD', chsld_prive: 'CHSLD privé', rpa: 'RPA', ri: 'RI', rtf: 'RTF', maison_aines: 'Maison des aînés', soins_palliatifs: 'Soins palliatifs', hospitalisation_domicile: 'HAD', sante_mentale: 'Santé mentale', chsld_prive_conventionne: 'CHSLD conventionné', maison_retraite: 'Résidence' },
      c: { transfert: 'Transfert', hebergement: 'Hébergement', transport: 'Transport', mission_ccs: 'Mission CCS', prealerte: 'Préalerte' } },
    en: { titre: 'Data', intro: 'Aggregates computed from recorded data; no patient reference; cells of 1 to 4 masked (“< 5”).', periode: 'Period', jours: 'last {n} days',
      csv: 'Export as CSV', etab: 'Facility', region: 'Region', chrono: 'Chrono visits', porte: 'Door median (min)', transferts: 'Transfers', refuses: 'Declined', decision: 'Decision median (min)',
      nsa: 'ALC open', jours_nsa: 'ALC median days', places: 'Free places', totaux: 'Total', attente: 'Waiting lists by resource type', genre: 'Type', personnes: 'People waiting',
      anciennete: 'Median wait (days)', en_face: 'Free places available', refus: 'Declines by reason', aucun: 'No data for the period.', masque: '< 5',
      g: { chsld: 'CHSLD', chsld_prive: 'Private CHSLD', rpa: 'RPA', ri: 'RI', rtf: 'RTF', maison_aines: 'Seniors’ home', soins_palliatifs: 'Palliative care', hospitalisation_domicile: 'Hospital at home', sante_mentale: 'Mental health', chsld_prive_conventionne: 'Contracted CHSLD', maison_retraite: 'Residence' },
      c: { transfert: 'Transfer', hebergement: 'Placement', transport: 'Transport', mission_ccs: 'CCS mission', prealerte: 'Pre-alert' } },
  };
  const etatD = { jours: 30 };
  const e = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function afficher(v, { api, langue, etablissement_id }) {
    const L = langue === 'en' ? 'en' : 'fr'; const T = (k, x = {}) => e(String(TXT[L][k]).replace(/\{(\w+)\}/g, (m, y) => x[y] ?? m));
    const n = (x) => (x && x.masque ? TXT[L].masque : x == null ? '—' : x);
    const debut = new Date(Date.now() - etatD.jours * 86400000).toISOString();
    const qs = `${etablissement_id ? `etablissement_id=${etablissement_id}&` : ''}debut=${encodeURIComponent(debut)}`;
    const d = await api('GET', `/donnees?${qs}`);
    if (!d) return;
    v.innerHTML = `<div class="entete"><div><h2>${T('titre')}</h2><p class="note">${T('intro')}</p></div>
        <div class="ligne"><label class="lbl" for="do-jours">${T('periode')}</label><select id="do-jours">${[7, 30, 90, 365].map((j) => `<option value="${j}"${etatD.jours === j ? ' selected' : ''}>${T('jours', { n: j })}</option>`).join('')}</select>
        <button class="btn" id="do-csv">${T('csv')}</button></div></div>
      <section class="panneau-c">${d.etablissements.length ? `<div class="tableau"><table><thead><tr><th>${T('etab')}</th><th>${T('region')}</th><th>${T('chrono')}</th><th>${T('porte')}</th><th>${T('transferts')}</th><th>${T('refuses')}</th><th>${T('decision')}</th><th>${T('nsa')}</th><th>${T('jours_nsa')}</th><th>${T('places')}</th></tr></thead><tbody>
        ${d.etablissements.map((l) => `<tr><td>${e(l.nom)}</td><td>${e(l.region || '')}</td><td>${n(l.chrono_passages)}</td><td>${n(l.chrono_porte_mediane_min)}</td><td>${n(l.transferts)}</td><td>${n(l.transferts_refuses)}</td><td>${n(l.transferts_decision_mediane_min)}</td><td>${n(l.nsa_actifs)}</td><td>${n(l.nsa_jours_median)}</td><td>${n(l.places_libres)}</td></tr>`).join('')}
        <tr><th>${T('totaux')}</th><td></td><td>${n(d.totaux.chrono_passages)}</td><td></td><td>${n(d.totaux.transferts)}</td><td>${n(d.totaux.transferts_refuses)}</td><td></td><td>${n(d.totaux.nsa_actifs)}</td><td></td><td>${n(d.totaux.places_libres)}</td></tr></tbody></table></div>` : `<p class="note">${T('aucun')}</p>`}</section>
      <section class="panneau-c"><h3>${T('attente')}</h3>${d.listes_attente.length ? `<div class="tableau"><table><thead><tr><th>${T('genre')}</th><th>${T('personnes')}</th><th>${T('anciennete')}</th><th>${T('en_face')}</th></tr></thead><tbody>
        ${d.listes_attente.map((a) => `<tr><td>${e(TXT[L].g[a.genre] || a.genre)}</td><td>${n(a.personnes)}</td><td>${n(a.anciennete_mediane_jours)}</td><td>${n(a.places_libres)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="note">${T('aucun')}</p>`}</section>
      <section class="panneau-c"><h3>${T('refus')}</h3>${Object.keys(d.refus_par_motif).length ? `<ul class="liste-simple">${Object.entries(d.refus_par_motif).map(([k, x]) => `<li>${e(TXT[L].c[k.split(':')[0]] || k.split(':')[0])} · ${e(k.split(':')[1].replaceAll('_', ' '))} : ${n(x)}</li>`).join('')}</ul>` : `<p class="note">${T('aucun')}</p>`}</section>`;
    v.querySelector('#do-jours').onchange = (ev) => { etatD.jours = Number(ev.target.value); afficher(v, { api, langue, etablissement_id }); };
    v.querySelector('#do-csv').onclick = async () => {
      const jeton = (() => { try { return localStorage.getItem('arrimo-token'); } catch { return null; } })();
      const r = await fetch(`/api/donnees.csv?${qs}`, { headers: { Authorization: `Bearer ${jeton}`, 'X-Langue': L } });
      if (!r.ok) return;
      const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = 'arrimo-donnees.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    };
  }
  window.ArrimoDonnees = { afficher, TXT };
})();
