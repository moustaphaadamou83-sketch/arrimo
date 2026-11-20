'use strict';
/** Archive ZIP minimale (méthode « deflate »), sans dépendance : { 'chemin/fichier': Buffer|string } → Buffer. */
const zlib = require('node:zlib');
const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = TABLE[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(fichiers) {
  const locaux = []; const centraux = []; let offset = 0;
  for (const [nom, contenu] of Object.entries(fichiers)) {
    const n = Buffer.from(nom, 'utf8'); const d = Buffer.isBuffer(contenu) ? contenu : Buffer.from(String(contenu), 'utf8');
    const z = zlib.deflateRawSync(d); const crc = crc32(d);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(z.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(z.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locaux.push(lh, n, z); centraux.push(ch, n); offset += 30 + n.length + z.length;
  }
  const central = Buffer.concat(centraux); const fin = Buffer.alloc(22); const nb = Object.keys(fichiers).length;
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(nb, 8); fin.writeUInt16LE(nb, 10); fin.writeUInt32LE(central.length, 12); fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locaux, central, fin]);
}
/** Lecture (tests et vérification d'archive) : { nom: Buffer }. */
function lire(buf) {
  const sortie = {}; let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const methode = buf.readUInt16LE(i + 8); const taille = buf.readUInt32LE(i + 18); const ln = buf.readUInt16LE(i + 26); const le = buf.readUInt16LE(i + 28);
    const nom = buf.slice(i + 30, i + 30 + ln).toString('utf8'); const d = buf.slice(i + 30 + ln + le, i + 30 + ln + le + taille);
    sortie[nom] = methode === 8 ? zlib.inflateRawSync(d) : d; i += 30 + ln + le + taille;
  }
  return sortie;
}
module.exports = { zip, lire, crc32 };
