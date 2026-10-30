'use strict';
/**
 * Supervision des environnements reliés : un relevé de santé (/api/sante) par environnement,
 * conservé 30 jours. Un changement d'état (panne ou retour) notifie l'administration une seule fois.
 */
const { notifier, comptesAvecRoles } = require('./automatisations');

async function verifierEnvironnements(pool, cibles, { delaiMs = 5000 } = {}) {
  const resultats = [];
  for (const c of cibles) {
    const t0 = Date.now(); let ok = false; let version = null; let detail = null;
    try {
      const r = await fetch(`${c.url}/api/sante`, { signal: AbortSignal.timeout(delaiMs) });
      const j = await r.json().catch(() => null);
      ok = r.ok && j?.etat === 'ok' && j?.base === 'ok';
      version = j?.version ? String(j.version).slice(0, 40) : null;
      if (!ok) detail = `réponse ${r.status}${j?.etat ? ` · état ${j.etat}` : ''}`;
    } catch { detail = 'injoignable'; }
    const latence = Date.now() - t0;
    const avant = (await pool.query('SELECT ok FROM sh_supervision WHERE environnement=$1 ORDER BY quand DESC LIMIT 1', [c.code])).rows[0];
    await pool.query('INSERT INTO sh_supervision(environnement, ok, latence_ms, version, detail) VALUES($1,$2,$3,$4,$5)', [c.code, ok, ok ? latence : null, version, detail]);
    if (avant && avant.ok !== ok) {
      await notifier(pool, await comptesAvecRoles(pool, ['administration', 'support']), { ressourceType:'global', type: 'hebergement',
        titre: ok ? `${c.nom} répond de nouveau` : `${c.nom} ne répond plus (${detail})`, lien: 'hebergement' });
    }
    resultats.push({ code: c.code, ok, latence_ms: ok ? latence : null, version, detail });
  }
  await pool.query("DELETE FROM sh_supervision WHERE quand < now() - interval '30 days'");
  return resultats;
}

module.exports = { verifierEnvironnements };
