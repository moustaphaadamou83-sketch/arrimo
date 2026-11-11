/* Arrimo SH — Hébergement : serveurs ajoutés depuis la console (plusieurs par pays) et profils de pays.
   Administration seulement ; chaque écriture redemande le code de double authentification. Aucune clé n'est jamais affichée :
   seul le code d'appairage (usage unique, 15 minutes) apparaît, une fois, pour être saisi sur le serveur. */
(() => {
  const STATUTS = { en_attente: ['En attente d’appairage', 'n-orange'], appaire: ['Appairé, à vérifier', 'n-orange'], relie: ['Relié', 'n-vert'], desactive: ['Désactivé', 'n-rouge'] };
  const TYPES = { production: 'Production', pilote: 'Pilote', recette: 'Recette' };
  const champ2fa = '<div class="champ"><label class="lbl" for="code-2fa">Code de double authentification</label><input id="code-2fa" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></div>';
  const lire2fa = () => { const c = $('#code-2fa').value.trim(); if (!/^\d{6}$/.test(c)) { toast('Saisissez le code à 6 chiffres.', true); return null; } return c; };
  const montrerAppairage = (r, nom) => modale('Code d’appairage',
    `<p>Sur le serveur <b>${esc(nom)}</b>, en root, lancez <code>arrimo-appairer</code> puis saisissez ce code (il ne sera plus affiché) :</p>
     <p class="code-appairage" style="font-size:1.6rem;letter-spacing:.12em;font-family:monospace;text-align:center"><b>${esc(r.code_appairage)}</b></p>
     <p class="note">Valable jusqu’à ${esc(new Date(r.expire_le).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }))}, une seule fois. La clé de service est remise directement au serveur : elle n’apparaît jamais ici. Ensuite, cliquez « Vérifier ».</p>`,
    [{ label: 'J’ai noté le code', pri: true, run: () => true }]);

  async function sections(v) {
    if (etat.moi?.utilisateur?.role !== 'administration') return;
    const [serveurs, profils] = await Promise.all([api('GET', '/serveurs').catch(() => []), api('GET', '/profils-pays').catch(() => [])]);
    const lignesS = serveurs.map((s) => `<tr><td><b>${esc(s.nom)}</b><div class="note">${esc(s.code)}</div></td><td>${esc(s.pays_code)}${s.region ? ` · ${esc(s.region)}` : ''}</td><td>${esc(TYPES[s.type] || s.type)}</td>
      <td><span class="etat-niveau ${STATUTS[s.statut][1]}">${esc(STATUTS[s.statut][0])}</span></td><td class="note">${esc(s.public)}</td>
      <td>${s.statut !== 'desactive' ? `<button class="btn" data-srv-code="${esc(s.code)}">Nouveau code</button>` : ''}${['appaire', 'relie'].includes(s.statut) ? `<button class="btn" data-srv-verifier="${esc(s.code)}">Vérifier</button>` : ''}
      ${s.statut === 'desactive' ? `<button class="btn" data-srv-reactiver="${esc(s.code)}">Réactiver</button>` : `<button class="btn discret" data-srv-desactiver="${esc(s.code)}">Désactiver</button>`}</td></tr>`).join('');
    const lignesP = profils.map((p) => `<tr><td><b>${esc(p.nom)}</b><div class="note">${esc(p.code)} · version ${esc(p.version)}</div></td><td>${esc(p.pays_code)}</td><td>${esc(p.reference_exemple)}</td><td>${esc(p.fuseau)}</td><td>${esc(p.langues.join(', '))}</td>
      <td class="note">${p.diffusions.length ? p.diffusions.map((d) => `${esc(d.environnement)} (v${esc(d.version)})`).join(', ') : 'non diffusé'}</td><td><button class="btn" data-pays-diffuser="${esc(p.id)}">Diffuser</button></td></tr>`).join('');
    v.insertAdjacentHTML('beforeend', `<section class="carte" id="serveurs"><div class="entete"><div><h3>Serveurs</h3><p class="note">Un serveur par pays, par région, par client ou pour un seul établissement : chacun a sa base, son adresse et sa clé. La clé n’est jamais affichée.</p></div>
        <button class="btn pri" id="b-serveur-ajouter">Ajouter un serveur</button></div>
        ${tableSH(['Serveur', 'Pays · région', 'Type', 'État', 'Adresse publique', ''], lignesS, 'Aucun serveur ajouté depuis la console (les serveurs de la configuration de base restent listés plus haut).')}</section>
      <section class="carte" id="profils-pays"><div class="entete"><div><h3>Profils de pays</h3><p class="note">Format de référence des patients et des résidents, fuseau horaire, langues et réglages, envoyés au serveur du pays. Les types d’établissements du pays se règlent dans « Types locaux ».</p></div>
        <button class="btn pri" id="b-pays-ajouter">Créer un profil de pays</button></div>
        ${tableSH(['Profil', 'Pays', 'Référence', 'Fuseau', 'Langues', 'Diffusé sur', ''], lignesP, 'Aucun profil créé depuis la console.')}</section>`);

    $('#b-serveur-ajouter').onclick = () => modale('Ajouter un serveur',
      `<div class="grille-2"><div class="champ"><label class="lbl" for="srv-type">Type</label><select id="srv-type"><option value="production">Production</option><option value="pilote">Pilote</option><option value="recette">Recette</option></select></div>
       <div class="champ"><label class="lbl" for="srv-pays">Pays (code à 2 lettres)</label><input id="srv-pays" maxlength="2" placeholder="CA"></div>
       <div class="champ"><label class="lbl" for="srv-suffixe">Identifiant (région, client ou établissement)</label><input id="srv-suffixe" maxlength="24" placeholder="estrie"></div>
       <div class="champ"><label class="lbl" for="srv-region">Région (facultatif)</label><input id="srv-region" maxlength="80" placeholder="Estrie"></div></div>
       <div class="champ"><label class="lbl" for="srv-nom">Nom affiché</label><input id="srv-nom" maxlength="60" placeholder="Production Estrie"></div>
       <div class="champ"><label class="lbl" for="srv-url">Adresse de l’API (HTTPS)</label><input id="srv-url" placeholder="https://estrie.arrimo.ca"></div>
       <div class="champ"><label class="lbl" for="srv-public">Adresse publique (si différente)</label><input id="srv-public" placeholder="https://estrie.arrimo.ca"></div>${champ2fa}`,
      [{ label: 'Annuler' }, { label: 'Ajouter', pri: true, run: async () => {
        const code_2fa = lire2fa(); if (!code_2fa) return false;
        try {
          const r = await api('POST', '/serveurs', { type: $('#srv-type').value, pays_code: $('#srv-pays').value.trim().toUpperCase(), suffixe: $('#srv-suffixe').value.trim().toLowerCase(),
            region: $('#srv-region').value.trim() || null, nom: $('#srv-nom').value.trim(), url: $('#srv-url').value.trim(), public: $('#srv-public').value.trim() || undefined, code_2fa });
          setTimeout(() => { montrerAppairage(r, r.serveur.nom); afficher(); }, 50); return true;
        } catch (e) { toast(e.message, true); return false; }
      } }]);
    const avec2fa = (titre, texte, appel) => modale(titre, `<p>${texte}</p>${champ2fa}`, [{ label: 'Annuler' }, { label: 'Confirmer', pri: true, run: async () => {
      const code_2fa = lire2fa(); if (!code_2fa) return false;
      try { await appel(code_2fa); return true; } catch (e) { toast(e.message, true); return false; }
    } }]);
    v.querySelectorAll('[data-srv-code]').forEach((b) => { b.onclick = () => avec2fa('Nouveau code d’appairage', 'Un nouveau code et une nouvelle clé sont créés : l’ancienne clé cesse de servir dès que le serveur s’appaire de nouveau.',
      async (code_2fa) => { const r = await api('POST', `/serveurs/${b.dataset.srvCode}/appairage`, { code_2fa }); setTimeout(() => { montrerAppairage(r, b.dataset.srvCode); afficher(); }, 50); }); });
    v.querySelectorAll('[data-srv-desactiver]').forEach((b) => { b.onclick = () => avec2fa('Désactiver le serveur', 'La console cesse de l’appeler et aucun nouvel appairage n’est possible. Ses données restent sur le serveur.',
      async (code_2fa) => { await api('POST', `/serveurs/${b.dataset.srvDesactiver}/desactiver`, { code_2fa }); toast('Serveur désactivé.'); afficher(); }); });
    v.querySelectorAll('[data-srv-reactiver]').forEach((b) => { b.onclick = () => avec2fa('Réactiver le serveur', 'La console pourra de nouveau l’appeler.',
      async (code_2fa) => { await api('POST', `/serveurs/${b.dataset.srvReactiver}/reactiver`, { code_2fa }); toast('Serveur réactivé.'); afficher(); }); });
    v.querySelectorAll('[data-srv-verifier]').forEach((b) => { b.onclick = async () => {
      try { const r = await api('POST', `/serveurs/${b.dataset.srvVerifier}/verifier`, {}); toast(`Serveur relié : ${r.etablissements} établissement(s).`); afficher(); } catch (e) { toast(e.message, true); }
    }; });

    $('#b-pays-ajouter').onclick = () => modale('Créer un profil de pays',
      `<div class="grille-2"><div class="champ"><label class="lbl" for="pp-code">Code du profil</label><input id="pp-code" maxlength="12" placeholder="TG"></div>
       <div class="champ"><label class="lbl" for="pp-pays">Pays (code à 2 lettres)</label><input id="pp-pays" maxlength="2" placeholder="TG"></div></div>
       <div class="champ"><label class="lbl" for="pp-nom">Nom</label><input id="pp-nom" maxlength="80" placeholder="Togo"></div>
       <div class="grille-2"><div class="champ"><label class="lbl" for="pp-prefixe">Préfixe de référence</label><input id="pp-prefixe" maxlength="4" placeholder="P"></div>
       <div class="champ"><label class="lbl" for="pp-chiffres">Nombre de chiffres</label><select id="pp-chiffres">${[5, 6, 7, 8].map((n) => `<option>${n}</option>`).join('')}</select></div></div>
       <p class="note" id="pp-exemple">Exemple : P-00000</p>
       <div class="champ"><label class="lbl" for="pp-fuseau">Fuseau horaire</label><input id="pp-fuseau" list="pp-fuseaux" placeholder="Africa/Lome"><datalist id="pp-fuseaux">${(Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []).map((z) => `<option value="${esc(z)}">`).join('')}</datalist></div>
       <fieldset><legend class="lbl">Langues</legend><label class="case"><input type="checkbox" id="pp-fr" checked> Français</label> <label class="case"><input type="checkbox" id="pp-en"> Anglais</label></fieldset>
       <div class="grille-2"><div class="champ"><label class="lbl" for="pp-rayon">Rayon de recherche (km)</label><input id="pp-rayon" type="number" value="150" min="5" max="2000"></div>
       <div class="champ"><label class="lbl" for="pp-net">Nettoyage visé (min)</label><input id="pp-net" type="number" value="45" min="10" max="240"></div></div>
       <div class="champ"><label class="lbl" for="pp-transport">Transport</label><input id="pp-transport" value="Ambulance" maxlength="60"></div>${champ2fa}`,
      [{ label: 'Annuler' }, { label: 'Créer', pri: true, run: async () => {
        const code_2fa = lire2fa(); if (!code_2fa) return false;
        try {
          await api('POST', '/profils-pays', { code: $('#pp-code').value.trim().toUpperCase(), pays_code: $('#pp-pays').value.trim().toUpperCase(), nom: $('#pp-nom').value.trim(),
            reference_prefixe: $('#pp-prefixe').value.trim().toUpperCase(), reference_chiffres: Number($('#pp-chiffres').value), fuseau: $('#pp-fuseau').value.trim(),
            langues: [['fr', '#pp-fr'], ['en', '#pp-en']].filter(([, s]) => $(s).checked).map(([l]) => l), rayon_km: Number($('#pp-rayon').value), nettoyage_cible_min: Number($('#pp-net').value),
            transport_libelle: $('#pp-transport').value.trim(), code_2fa });
          toast('Profil créé. Diffusez-le sur le serveur du pays.'); afficher(); return true;
        } catch (e) { toast(e.message, true); return false; }
      } }]);
    const majExemple = () => { const p = ($('#pp-prefixe')?.value || 'P').toUpperCase() || 'P'; const n = Number($('#pp-chiffres')?.value || 5); if ($('#pp-exemple')) $('#pp-exemple').textContent = `Exemple : ${p}-${'0'.repeat(n)}`; };
    document.addEventListener('input', (e) => { if (['pp-prefixe', 'pp-chiffres'].includes(e.target.id)) majExemple(); });
    document.addEventListener('change', (e) => { if (e.target.id === 'pp-chiffres') majExemple(); });

    v.querySelectorAll('[data-pays-diffuser]').forEach((b) => { b.onclick = () => {
      const p = profils.find((x) => String(x.id) === b.dataset.paysDiffuser);
      const options = (etat.moi?.environnements || []).map((e) => `<option value="${esc(e.code)}">${esc(e.nom)} (${esc(e.code)})</option>`).join('');
      modale(`Diffuser « ${p.nom} »`, `<p>Le profil est créé ou mis à jour sur le serveur choisi. Il ne peut aller que vers un serveur de ce pays (${esc(p.pays_code)}).</p>
        <div class="champ"><label class="lbl" for="pp-env">Serveur</label><select id="pp-env">${options}</select></div>${champ2fa}`,
      [{ label: 'Annuler' }, { label: 'Diffuser', pri: true, run: async () => {
        const code_2fa = lire2fa(); if (!code_2fa) return false;
        try { const r = await api('POST', `/profils-pays/${p.id}/diffuser`, { environnement: $('#pp-env').value, code_2fa }); toast(r.cree ? 'Profil créé sur le serveur.' : 'Profil mis à jour sur le serveur.'); afficher(); return true; }
        catch (e) { toast(e.message, true); return false; }
      } }]);
    }; });
  }
  window.ArrimoServeurs = { sections };
})();
