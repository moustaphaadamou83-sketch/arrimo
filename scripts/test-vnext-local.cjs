/** Tests indépendants du réseau et de PostgreSQL ; ne pas confondre avec la recette intégrée. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { run } = require('node:test');
const racine = path.resolve(__dirname, '..');
const fichiers = ['serveur-test.test.cjs', 'simulation-connecteurs.test.cjs', 'priorites.test.cjs', 'priorites-ui-contract.test.cjs', 'configuration-operationnelle.test.cjs',
  'connecteurs-atomicite.test.cjs', 'courriel-transport.test.cjs', 'routage.test.cjs'];
function empreinteSources() {
  const chemins = [];
  const parcourir = (rel) => {
    for (const entree of fs.readdirSync(path.join(racine, rel), { withFileTypes: true })) {
      const chemin = `${rel}/${entree.name}`;
      if (entree.isDirectory()) parcourir(chemin);
      else if (entree.isFile()) chemins.push(chemin);
    }
  };
  for (const dossier of ['src', 'public', 'public-sh', 'db', 'scripts', 'tests']) parcourir(dossier);
  for (const fichier of ['package.json', 'package-lock.json']) if (fs.existsSync(path.join(racine, fichier))) chemins.push(fichier);
  const hash = crypto.createHash('sha256');
  for (const rel of chemins.sort()) hash.update(rel).update('\0').update(fs.readFileSync(path.join(racine, rel))).update('\0');
  return hash.digest('hex');
}
const rapport = { date: new Date().toISOString(), type: 'tests locaux sans PostgreSQL ni navigateur', sources_sha256: empreinteSources(),
  suites: fichiers.map((fichier) => ({ fichier, reussis: 0, echecs: 0, ignores: 0 })), total: null };
// Aucun sous-processus : certains environnements refusent spawn/IPC même quand
// un statut de sortie zéro est renvoyé. Compter les événements réels du runner.
const stream = run({ files: fichiers.map((f) => path.join(racine, 'tests', f)), isolation: 'none', concurrency: 1 });
stream.on('data', ({ type, data }) => {
  if (type === 'test:pass' || type === 'test:fail') {
    const suite = rapport.suites.find((s) => s.fichier === path.basename(data.file || ''));
    if (suite) suite[data.skip ? 'ignores' : type === 'test:pass' ? 'reussis' : 'echecs'] += 1;
    console.log(`${type === 'test:pass' ? 'OK' : 'ECHEC'} ${data.name}`);
    if (type === 'test:fail') { process.exitCode = 1; console.error(data.details?.error); }
  }
  if (type === 'test:summary') {
    const n = data.counts;
    rapport.total = { reussis: n.passed, echecs: n.failed, ignores: n.skipped, annules: n.cancelled };
    if (rapport.sources_sha256 !== empreinteSources()) { console.error('Sources modifiées pendant les tests.'); process.exitCode = 1; rapport.sources_modifiees = true; }
    if (!data.success || !n.tests || rapport.suites.some((s) => s.reussis + s.echecs + s.ignores === 0)) process.exitCode = 1;
    console.log(JSON.stringify(rapport, null, 2));
    if (process.argv[2]) {
      const destination = path.resolve(process.argv[2]);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, JSON.stringify(rapport, null, 2) + '\n');
    }
  }
});
stream.on('error', (err) => { console.error(err); process.exitCode = 1; });
stream.on('end', () => { if (!rapport.total) { console.error('Aucun résultat de test reçu.'); process.exitCode = 1; } });
