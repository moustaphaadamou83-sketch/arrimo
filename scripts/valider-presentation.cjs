const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const cwd = path.join(__dirname, '..');
const preuves = path.join(cwd, '.local', 'preuves-' + crypto.randomBytes(7).toString('hex'));
fs.mkdirSync(preuves, { recursive: true, mode: 0o700 });
const { Pool } = require(cwd + '/node_modules/pg');
const prefix = 'postgresql://arrimo_audit@127.0.0.1:55439/';
async function verifier(nom, args, baseRequise) {
  const base = baseRequise ? 'arrimo_final_' + crypto.randomBytes(7).toString('hex') : null;
  if (base) {
    const p = new Pool({ connectionString: prefix + 'postgres' });
    try { await p.query('CREATE DATABASE ' + base); } finally { await p.end(); }
  }
  return new Promise((resolve) => {
    const env = { ...process.env, TEST_DATABASE_URL: base ? prefix + base : '', COPILOTE_IA_CLE: '', DATABASE_URL: base ? prefix + base : '', SH_DATABASE_URL: '', SH_API_KEY: 'cle-test-local', SMTP_URL: '', ARRIMO_ENV: '', ARRIMO_DEMO: '', NODE_ENV: 'test', ARRIMO_REFERENCE_AVANT: process.env.ARRIMO_REFERENCE_AVANT || path.resolve(cwd, '..', 'preparation-livraison-20261022') };
    const proc = spawn(process.execPath, args, { cwd, env });
    let log = '';
    proc.stdout.on('data', d => log += d);
    proc.stderr.on('data', d => log += d);
    proc.on('close', code => {
      fs.writeFileSync(preuves + '/' + nom + '.txt', log);
      const resultat = { nom, base_fictive: base, exit: code, resume: log.split('\n').filter(l => /^ℹ |^✔ |^✖ /.test(l)) };
      fs.writeFileSync(preuves + '/' + nom + '.json', JSON.stringify(resultat, null, 2));
      console.log(nom + ' : ' + (code === 0 ? 'réussi' : 'échec') + ' ; preuves : ' + preuves);
      resolve(resultat);
    });
  });
}
(async () => {
  const r = await Promise.all([
    verifier('api-finale', ['--test', '--test-concurrency=1', 'tests/api.test.js'], true),
    verifier('interface-finale', ['--test', '--test-concurrency=1', 'tests/interface.spec.js'], true),
    verifier('og-interface', ['--test', '--test-concurrency=1', 'tests/og.interface.spec.js'], true),
    verifier('courriel-final', ['--test', 'tests/courriel-transport.test.cjs'], false),
  ]);
  fs.writeFileSync(preuves + '/validation-finale.json', JSON.stringify(r, null, 2));
  if (r.some(x => x.exit !== 0)) process.exitCode = 1;
})().catch(e => { console.error(e.code || e.message); process.exitCode = 1; });
