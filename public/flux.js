/* Mise à jour en direct (SSE lu par fetch : le jeton reste dans l'en-tête, jamais dans l'adresse).
   Le serveur n'envoie qu'un signal sans donnée ; l'écran relit ses informations par les routes habituelles.
   Reconnexion automatique ; en cas d'échec, l'écran garde sa relecture lente habituelle. */
(() => {
  function ecouter(jeton, surSignal) {
    let arret = false; let attente = 2000; let controle = null;
    const etat = { fini: false, arreter() { arret = true; controle?.abort(); } };
    async function boucle() {
      while (!arret) {
        try {
          controle = new AbortController();
          const r = await fetch('/api/flux', { headers: { Authorization: `Bearer ${jeton()}` }, signal: controle.signal, cache: 'no-store' });
          if (r.status === 204 || r.status === 401 || r.status === 403) { etat.fini = true; return; }
          if (!r.ok || !r.body) throw new Error('flux');
          attente = 2000;
          const lecteur = r.body.getReader(); const dec = new TextDecoder(); let tampon = '';
          for (;;) {
            const { value, done } = await lecteur.read();
            if (done) break;
            tampon += dec.decode(value, { stream: true });
            let i;
            while ((i = tampon.indexOf('\n\n')) >= 0) {
              const bloc = tampon.slice(0, i); tampon = tampon.slice(i + 2);
              if (/^event: secours$/m.test(bloc)) { try { surSignal(); } catch { /* écran indisponible */ } }
            }
          }
        } catch { /* coupure : nouvelle tentative */ }
        if (arret) return;
        await new Promise((ok) => setTimeout(ok, attente)); attente = Math.min(30000, attente * 2);
      }
    }
    boucle();
    return etat;
  }
  window.ArrimoFlux = { ecouter };
})();
