/* Urgences en direct, page publique (20 nov. 2026) : sans compte, FR/EN, pensée pour le téléphone. DÉMONSTRATION SEULEMENT.
   Seulement les urgences qui ont accepté d'être publiées ; état, services et heures ; heure de mise à jour toujours visible ;
   une déclaration trop ancienne est marquée « non à jour », jamais présentée comme actuelle ; numéro d'urgence vitale toujours affiché. */
(() => {
  const TXT = {
    fr: { sous: 'Urgences en direct', titre: 'Urgences en direct', intro: 'État déclaré par les urgences participantes. Aucune attente n’est estimée : en cas de doute, appelez.',
      vital: 'En cas d’urgence vitale, appelez le {n}.', demo: 'Démonstration : données fictives, établissements fictifs. Cette page n’est pas en service.',
      ouverte: 'Ouverte', capacite_reduite: 'Capacité réduite', fermee_temporairement: 'Fermée temporairement', inconnu: 'État non déclaré',
      maj: 'Mis à jour à {h}', non_a_jour: 'Non à jour : dernière déclaration à {h}', jamais: 'Aucune déclaration', reouv: 'Réouverture prévue : {h}',
      services: 'Services fermés : {s}', proche: 'Urgence ouverte la plus proche : {nom} ({km} km à vol d’oiseau)', planifiee: 'Fermeture prévue : {d} → {f} ({s})',
      options: 'Autres options', licence: 'Données sous licence {l}. {a}. Mise à jour toutes les minutes au plus.', aucune: 'Aucune urgence publiée.', erreur: 'Données indisponibles pour le moment.',
      sv: { toute_urgence: 'toute l’urgence', pediatrie: 'pédiatrie', obstetrique: 'obstétrique', imagerie: 'imagerie', sante_mentale: 'santé mentale', traumatologie: 'traumatologie' } },
    en: { sous: 'Live emergency status', titre: 'Live emergency status', intro: 'Status declared by participating emergency departments. No wait time is estimated: if in doubt, call.',
      vital: 'In a life-threatening emergency, call {n}.', demo: 'Demonstration: fictitious data, fictitious facilities. This page is not in service.',
      ouverte: 'Open', capacite_reduite: 'Reduced capacity', fermee_temporairement: 'Temporarily closed', inconnu: 'Status not declared',
      maj: 'Updated at {h}', non_a_jour: 'Not up to date: last declaration at {h}', jamais: 'No declaration', reouv: 'Expected reopening: {h}',
      services: 'Closed services: {s}', proche: 'Nearest open emergency department: {nom} ({km} km as the crow flies)', planifiee: 'Planned closure: {d} → {f} ({s})',
      options: 'Other options', licence: 'Data under the {l} licence. {a}. Updated every minute at most.', aucune: 'No published emergency department.', erreur: 'Data unavailable right now.',
      sv: { toute_urgence: 'the whole department', pediatrie: 'paediatrics', obstetrique: 'obstetrics', imagerie: 'imaging', sante_mentale: 'mental health', traumatologie: 'trauma' } },
  };
  let L = (() => { try { return localStorage.getItem('arrimo-langue') === 'en' ? 'en' : (navigator.language || '').startsWith('en') && !localStorage.getItem('arrimo-langue') ? 'en' : 'fr'; } catch { return 'fr'; } })();
  let donnees = null;
  const t = (k, v = {}) => String(TXT[L][k]).replace(/\{(\w+)\}/g, (m, x) => (v[x] ?? m));
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s) => document.querySelector(s);
  const h = (d) => new Date(d).toLocaleString(L === 'en' ? 'en-CA' : 'fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const sv = (l) => l.map((x) => TXT[L].sv[x] || x).join(', ');
  function rendre() {
    document.documentElement.lang = L === 'en' ? 'en-CA' : 'fr-CA';
    document.querySelectorAll('[data-ud-langue]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.udLangue === L)));
    $('#ud-sous').textContent = t('sous'); $('#ud-titre').textContent = t('titre'); $('#ud-intro').textContent = t('intro'); $('#ud-demo').textContent = t('demo');
    $('#ud-options-titre').textContent = t('options');
    $('#ud-vital').textContent = t('vital', { n: donnees?.numero_urgence || '911' });
    if (!donnees) { $('#ud-liste').innerHTML = `<p class="note">${esc(t('erreur'))}</p>`; return; }
    $('#ud-liste').innerHTML = donnees.urgences.length ? donnees.urgences.map((u) => {
      const etat = u.a_jour ? u.etat : 'inconnu';
      return `<article class="ud-carte etat-${etat}"><div class="ud-tete"><h2>${esc(u.nom)}</h2><span class="ud-etat">${esc(t(etat))}</span></div>
        <p class="note">${esc(u.ville || '')}</p>
        <p class="ud-maj">${u.mis_a_jour_le ? esc(u.a_jour ? t('maj', { h: h(u.mis_a_jour_le) }) : t('non_a_jour', { h: h(u.mis_a_jour_le) })) : esc(t('jamais'))}</p>
        ${u.reouverture_prevue_le ? `<p><strong>${esc(t('reouv', { h: h(u.reouverture_prevue_le) }))}</strong></p>` : ''}
        ${u.services_touches.length ? `<p>${esc(t('services', { s: sv(u.services_touches) }))}</p>` : ''}
        ${u.ouverte_la_plus_proche ? `<p>${esc(t('proche', { nom: u.ouverte_la_plus_proche.nom, km: u.ouverte_la_plus_proche.km }))}</p>` : ''}
        ${u.fermetures_planifiees.map((f) => `<p class="note">${esc(t('planifiee', { d: h(f.debut_le), f: h(f.fin_prevue_le), s: sv(f.services) }))}</p>`).join('')}</article>`;
    }).join('') : `<p class="note">${esc(t('aucune'))}</p>`;
    $('#ud-options').innerHTML = donnees.options.map((o) => `<li>${esc(o[L] || o.fr)}</li>`).join('');
    $('#ud-licence').textContent = t('licence', { l: donnees.licence, a: donnees.attribution });
  }
  async function charger() {
    try { const r = await fetch('/api/public/v1/urgences'); donnees = r.ok ? await r.json() : null; } catch { donnees = null; }
    rendre();
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-ud-langue]'); if (!b) return; L = b.dataset.udLangue; try { localStorage.setItem('arrimo-langue', L); } catch { /* */ } rendre(); });
  rendre(); charger(); setInterval(charger, 60000);
})();
