(() => {
  const textes = {
    fr: { titre: 'Motif de retard observé', enregistrer: 'Consigner le retard', choix: 'Choisir un motif', motifs: {
      civiere: 'Civière indisponible', personnel: 'Personnel indisponible', chambre: 'Chambre en préparation',
      dossier: 'Attente de transmission du dossier', saturation: 'Saturation du service', nettoyage: 'Nettoyage',
      technique: 'Incident technique', autre: 'Autre motif',
    } },
    en: { titre: 'Observed reason for delay', enregistrer: 'Record delay', choix: 'Choose a reason', motifs: {
      civiere: 'Stretcher unavailable', personnel: 'Staff unavailable', chambre: 'Room being prepared',
      dossier: 'Waiting for record transfer', saturation: 'Department at capacity', nettoyage: 'Cleaning',
      technique: 'Technical incident', autre: 'Other reason',
    } },
  };
  const dico = () => textes[(document.documentElement.lang || '').startsWith('en') ? 'en' : 'fr'];
  function champ(passage, editable) {
    const { titre, enregistrer, choix, motifs } = dico();
    const courant = passage.motif_retard;
    const note = courant && Object.hasOwn(motifs, courant) ? `<p class="note">${titre} · ${motifs[courant]}</p>` : '';
    if (!editable) return note;
    return `${note}<form data-chrono-retard="${Number(passage.id)}" data-version="${Number(passage.version)}" class="ligne">
      <label>${titre} <select name="motif" required><option value="">${choix}</option>
        ${Object.entries(motifs).map(([code, lib]) => `<option value="${code}"${code === courant ? ' selected' : ''}>${lib}</option>`).join('')}
      </select></label><button class="btn" type="submit">${enregistrer}</button>
    </form>`;
  }
  window.ArrimoChronoRetards = { champ, libelle: (motif) => dico().motifs[motif] };
})();
