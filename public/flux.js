/* Mise à jour en direct (SSE lu par fetch : le jeton reste dans l'en-tête, jamais dans l'adresse).
   Le serveur n'envoie qu'un signal sans donnée ; l'écran relit ses informations par les routes habituelles.
   Reconnexion automatique ; en cas d'échec, l'écran garde sa relecture lente habituelle. */
(() => {
  function ecouter(jeton, surSignal) {
    let arret = false; let attente = 2000; let controle = null; let dernierId = null; const latences = [];
    const etat = { fini: false, arreter() { arret = true; controle?.abort(); }, dernier: () => dernierId,
      /** Délai observé émission → réception (ms), 50 derniers signaux : mesure réelle, horloges client et serveur supposées proches. */
      latence: () => { const d = [...latences].sort((a, b) => a - b); return d.length ? { n: d.length, p50: d[Math.floor(d.length / 2)], p95: d[Math.min(d.length - 1, Math.floor(d.length * 0.95))] } : null; } };
    async function boucle() {
      while (!arret) {
        try {
          controle = new AbortController();
          const r = await fetch('/api/flux', { headers: { Authorization: `Bearer ${jeton()}`, ...(dernierId ? { 'Last-Event-ID': dernierId } : {}) }, signal: controle.signal, cache: 'no-store' });
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
              if (/^event: secours$/m.test(bloc)) {
                const id = bloc.match(/^id: (.+)$/m)?.[1]; if (id) dernierId = id;
                try { const d = JSON.parse(bloc.match(/^data: (.+)$/m)?.[1] || '{}'); if (d.t && !d.rattrapage) { latences.push(Date.now() - d.t); if (latences.length > 50) latences.shift(); } } catch { /* ancien format */ }
                try { surSignal(); } catch { /* écran indisponible */ }
              }
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
