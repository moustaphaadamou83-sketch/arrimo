'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function empreinteSources(racine=path.resolve(__dirname,'..')) {
  const chemins = [];
  const parcourir = (rel) => {
    for (const entree of fs.readdirSync(path.join(racine, rel), { withFileTypes: true })) {
      const chemin = `${rel}/${entree.name}`;
      if (entree.isDirectory()&&entree.name!=='__pycache__') parcourir(chemin);
      else if (entree.isFile()) chemins.push(chemin);
    }
  };
  for (const dossier of ['src', 'public', 'public-sh', 'db', 'scripts', 'tests']) parcourir(dossier);
  for (const fichier of ['package.json', 'package-lock.json']) if (fs.existsSync(path.join(racine, fichier))) chemins.push(fichier);
  const hash = crypto.createHash('sha256');
  for (const rel of chemins.sort()) hash.update(rel).update('\0').update(fs.readFileSync(path.join(racine, rel))).update('\0');
  return hash.digest('hex');
}
module.exports={empreinteSources};
