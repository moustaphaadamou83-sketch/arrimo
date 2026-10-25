// Le runner Node avec isolation processus ne doit jamais annoncer des fichiers
// réussis si le sandbox empêche réellement le démarrage ou les communications.
const { spawnSync } = require('node:child_process');
const marqueur = 'arrimo-test-child-ok';
const r = spawnSync(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(marqueur)})`], { encoding: 'utf8', timeout: 10000 });
if (r.error || r.status !== 0 || r.stdout !== marqueur) {
  console.error(`Exécution des suites isolées impossible : ${r.error?.code || r.signal || 'sous-processus incomplet'}. Aucun test intégré déclaré réussi.`);
  console.error('Les tests indépendants restent disponibles avec npm run test:vnext-local.');
  process.exitCode = 1;
}
