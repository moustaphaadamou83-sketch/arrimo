// Générateur de charge : N utilisateurs virtuels, chacun connecté avec son propre compte, enchaînent des actions réalistes
// (lecture des lits, capacité réseau, recherche, notifications, confirmation de lit, réservation puis annulation, transferts)
// avec un temps de réflexion de 1 à 3 s. Mesure p50/p95/p99, erreurs, conflits, débit ; échantillonne CPU, mémoire, connexions PostgreSQL.
//   node charge-client.js <utilisateurs> <durée_s> <base_url> <pid_serveur>
const fs = require('fs'); const { execFileSync } = require('child_process');
const [N, DUREE, BASE, PID] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const MDP = 'Charge-Arrimo-2026'; const CODES = JSON.parse(process.env.CHARGE_CODES);
const lat = {}; const err = {}; let conflits = 0; let ops = 0; let transferts = 0;
const noter = (k, ms, ok, statut) => { (lat[k] = lat[k] || []).push(ms); if (!ok) err[`${k}:${statut}`] = (err[`${k}:${statut}`] || 0) + 1; ops += 1; };
async function req(k, jeton, m, chemin, corps) {
  const t0 = performance.now();
  try {
    const r = await fetch(`${BASE}/api${chemin}`, { method: m, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined, signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => null);
    if (r.status === 409) conflits += 1;
    noter(k, performance.now() - t0, r.ok || r.status === 409, r.status === 403 || r.status === 400 ? `${r.status}:${j?.code}` : r.status);
    return { s: r.status, j };
  } catch (e) { noter(k, performance.now() - t0, false, e.name); return { s: 0 }; }
}
const pause = (a, b) => new Promise((r) => setTimeout(r, a + Math.random() * (b - a)));
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]); };
const sessions = [];
async function connecter(i) {
  const etab = CODES[i % CODES.length]; const email = `charge.${etab.code.toLowerCase()}.${Math.floor(i / CODES.length) + 1}@audit.exemple`;
  const c = await req('connexion', null, 'POST', '/connexion', { email, mot_de_passe: MDP });
  if (c.j?.token) sessions[i] = c.j.token;
}
async function vu(i, fin) {
  const etab = CODES[i % CODES.length];
  const j = sessions[i]; if (!j) return;
  const e = etab.id; const type = etab.type;
  while (Date.now() < fin) {
    const x = Math.random();
    if (x < 0.35) await req('lits', j, 'GET', `/lits?etablissement_id=${e}`);
    else if (x < 0.55) await req('reseau', j, 'GET', `/reseau?depuis=${e}`);
    else if (x < 0.70) await req('recherche', j, 'GET', `/recherche?depuis=${e}&type_id=${type}`);
    else if (x < 0.85) await req('notifications', j, 'GET', `/notifications?etablissement_id=${e}`);
    else if (x < 0.95) {
      const l = await req('lits', j, 'GET', `/lits?etablissement_id=${e}`);
      const libre = (l.j?.lits || l.j || []).filter?.((y) => y.etat === 'libre') || [];
      const cible = libre[Math.floor(Math.random() * Math.min(5, libre.length))];
      if (cible) {
        const r = await req('reserver', j, 'POST', `/lits/${cible.id}/action`, { action: 'reserver', version: cible.version, patient_ref: `P-${String(10000 + Math.floor(Math.random() * 89999))}` });
        if (r.s === 200) await req('annuler', j, 'POST', `/lits/${cible.id}/action`, { action: 'annuler', version: r.j.version });
      }
    } else {
      const dest = CODES[(CODES.indexOf(etab) + 1 + Math.floor(Math.random() * 3)) % CODES.length];
      const t = await req('transfert', j, 'POST', '/transferts', { origine_id: e, destination_id: dest.id, type_id: type, patient_ref: `P-${String(10000 + Math.floor(Math.random() * 89999))}`, hors_rayon: true });
      if (t.s === 200) transferts += 1;
    }
    await pause(1000, 3000);
  }
}
const echant = [];
function echantillon() {
  try {
    const st = fs.readFileSync(`/proc/${PID}/stat`, 'utf8').split(' '); const cpu = Number(st[13]) + Number(st[14]);
    const rss = Number(fs.readFileSync(`/proc/${PID}/statm`, 'utf8').split(' ')[1]) * 4096;
    const pg = Number(execFileSync('psql', ['-d', 'postgres', '-Atc', "select count(*) from pg_stat_activity where datname='arrimo_audit_charge'"], { encoding: 'utf8' }).trim());
    echant.push({ t: Date.now(), cpu, rss, pg });
  } catch { /* processus arrêté */ }
}
(async () => {
  // Phase 1 : connexions au débit maximal (16 en parallèle), mesurées à part
  const tc = Date.now(); let suivant = 0;
  await Promise.all(Array.from({ length: 16 }, async () => { while (suivant < N) await connecter(suivant++); }));
  const connexion = { comptes: N, reussies: sessions.filter(Boolean).length, duree_s: Math.round((Date.now() - tc) / 100) / 10,
    debit_par_s: Math.round(N / ((Date.now() - tc) / 1000)), p50: pct(lat.connexion, 50), p95: pct(lat.connexion, 95), p99: pct(lat.connexion, 99) };
  delete lat.connexion; ops = 0; conflits = 0;
  // Phase 2 : régime établi, N utilisateurs connectés actifs (montée sur 10 s)
  const fin = Date.now() + DUREE * 1000; const t0 = Date.now();
  const minuterie = setInterval(echantillon, 2000); echantillon();
  await Promise.all(Array.from({ length: N }, (_, i) => pause((i / N) * 10000, (i / N) * 10000 + 1).then(() => vu(i, fin))));
  clearInterval(minuterie); echantillon();
  const tout = Object.values(lat).flat(); const duree = (Date.now() - t0) / 1000;
  const cpuPct = echant.length > 1 ? Math.round(((echant.at(-1).cpu - echant[0].cpu) / 100) / ((echant.at(-1).t - echant[0].t) / 1000) * 100) : null;
  console.log(JSON.stringify({ utilisateurs: N, connexion, duree_s: Math.round(duree), requetes: ops, debit_rps: Math.round(ops / duree),
    p50: pct(tout, 50), p95: pct(tout, 95), p99: pct(tout, 99), erreurs: Object.values(err).reduce((a, b) => a + b, 0), erreurs_par_type: err, conflits_409: conflits, transferts_crees: transferts,
    par_type: Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, { n: v.length, p50: pct(v, 50), p95: pct(v, 95), p99: pct(v, 99) }])),
    cpu_serveur_pct: cpuPct, rss_max_mo: Math.round(Math.max(...echant.map((x) => x.rss)) / 1e6), connexions_pg_max: Math.max(...echant.map((x) => x.pg)) }));
})();
