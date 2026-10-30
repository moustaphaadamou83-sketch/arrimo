/** Tests indépendants du réseau et de PostgreSQL ; ne pas confondre avec la recette intégrée. */
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('node:test');
const racine = path.resolve(__dirname, '..');
const fichiers = ['support-sla-regles.test.cjs', 'support-configuration.test.cjs', 'coherence-applicative.test.cjs', 'environnements-pilote.test.cjs', 'profils-pays.test.cjs', 'sh-montants-devises.test.cjs', 'sh-international.test.cjs', 'sh-promotion-configuration.test.cjs', 'sh-finances.test.cjs', 'og-vocal.test.cjs', 'sh-recette-garde.test.cjs', 'sh-roles-validation.test.cjs', 'bilingue.test.cjs', 'og-correction.test.cjs', 'serveur-test.test.cjs', 'simulation-connecteurs.test.cjs', 'priorites.test.cjs', 'priorites-ui-contract.test.cjs', 'configuration-operationnelle.test.cjs',
  'connecteurs-atomicite.test.cjs', 'courriel-transport.test.cjs', 'routage.test.cjs'];
const {empreinteSources}=require('./empreinte-sources.cjs');
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
