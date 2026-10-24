'use strict';

const zlib = require('node:zlib');
const MAX_FICHIER = 1_000_000;
const MAX_DECOMPRESSE = 8_000_000;
const MAX_LIGNES = 5000;
const MAX_COLONNES = 100;
const crcTable = (()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc32=(b)=>{let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
function ouvrirZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_FICHIER) throw new Error('Fichier XLSX absent ou trop volumineux.');
  let end=-1;for(let p=Math.max(0,buffer.length-65557);p<=buffer.length-22;p++)if(buffer.readUInt32LE(p)===0x06054b50)end=p;
  if(end<0)throw new Error('Archive Excel invalide.');
  const count=buffer.readUInt16LE(end+10);let p=buffer.readUInt32LE(end+16);const files=new Map();let total=0;
  if(count>200)throw new Error('Archive Excel trop complexe.');
  for(let i=0;i<count;i++){
    if(buffer.readUInt32LE(p)!==0x02014b50)throw new Error('Annuaire ZIP invalide.');
    const method=buffer.readUInt16LE(p+10),crc=buffer.readUInt32LE(p+16),compressed=buffer.readUInt32LE(p+20),size=buffer.readUInt32LE(p+24),nl=buffer.readUInt16LE(p+28),el=buffer.readUInt16LE(p+30),cl=buffer.readUInt16LE(p+32),local=buffer.readUInt32LE(p+42);
    const name=buffer.toString('utf8',p+46,p+46+nl);p+=46+nl+el+cl;
    if(size>MAX_DECOMPRESSE||compressed>MAX_FICHIER)throw new Error('Entrée Excel trop volumineuse.');
    total+=size;if(total>MAX_DECOMPRESSE)throw new Error('Contenu Excel décompressé trop volumineux.');
    if(!['[Content_Types].xml','xl/workbook.xml','xl/_rels/workbook.xml.rels','xl/sharedStrings.xml'].includes(name)&&!/^xl\/worksheets\/sheet\d+\.xml$/.test(name))continue;
    if(buffer.readUInt32LE(local)!==0x04034b50)throw new Error('Entrée ZIP invalide.');
    const ln=buffer.readUInt16LE(local+26),le=buffer.readUInt16LE(local+28),start=local+30+ln+le;const packed=buffer.subarray(start,start+compressed);
    const data=method===0?Buffer.from(packed):method===8?zlib.inflateRawSync(packed,{maxOutputLength:MAX_DECOMPRESSE}):null;
    if(!data)throw new Error('Compression Excel non prise en charge.');
    if(data.length!==size||crc32(data)!==crc)throw new Error('Archive Excel endommagée.');files.set(name,data.toString('utf8'));
  }
  return files;
}
const decode=(s)=>String(s).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function colIndex(ref){let n=0;for(const c of ref.match(/^[A-Z]+/i)?.[0]||''){n=n*26+c.toUpperCase().charCodeAt(0)-64;}return n-1;}
function lireXlsx(buffer){
  const files=ouvrirZip(buffer);let sheet=[...files.keys()].find(x=>/^xl\/worksheets\/sheet\d+\.xml$/.test(x));
  if(!files.has('xl/workbook.xml')||!sheet)throw new Error('Classeur Excel sans feuille lisible.');
  const shared=(files.get('xl/sharedStrings.xml')||'').match(/<si\b[\s\S]*?<\/si>/g)||[];
  const strings=shared.map(si=>[...si.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>decode(m[1])).join(''));
  const xml=files.get(sheet);if(/<f(?:\s|>)/i.test(xml))throw new Error('Les formules Excel sont refusées dans les fichiers importés. Remplacez-les par des valeurs.');
  const rows=[];for(const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){
    const row=[];for(const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){
      const attrs=cm[1],body=cm[2],ref=attrs.match(/\br="([A-Z]+\d+)"/i)?.[1];if(!ref)continue;const col=colIndex(ref);if(col>=MAX_COLONNES)throw new Error('Le classeur dépasse 100 colonnes.');
      const type=attrs.match(/\bt="([^"]+)"/)?.[1],val=body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const inline=[...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>decode(m[1])).join('');
      row[col]=type==='s'?strings[Number(val)]||'':type==='inlineStr'?inline:decode(val||'');
    }
    rows.push(row.map(x=>x||''));if(rows.length>MAX_LIGNES+1)throw new Error('Le classeur dépasse 5 000 lignes.');
  }
  while(rows.length&&rows.at(-1).every(x=>!x))rows.pop();if(!rows.length)throw new Error('La première feuille est vide.');
  return rows;
}
const escCsv=(x)=>{const s=String(x??'');return /[;",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
function versCsv(buffer,mapping={}){
  const rows=lireXlsx(buffer),headers=rows[0].map((x)=>String(x).trim());
  if(!headers.length||headers.every(x=>!x))throw new Error('La première ligne doit contenir les noms de colonnes.');
  const selected=Object.keys(mapping).length?Object.entries(mapping).map(([target,source])=>({target,source:String(source)})):headers.map(h=>({target:h,source:h}));
  const index=new Map(headers.map((h,i)=>[h,i]));
  if(selected.some(x=>!index.has(x.source)))throw new Error('Correspondance de colonne introuvable.');
  const output=[selected.map(x=>escCsv(x.target)).join(';')];
  for(const row of rows.slice(1))output.push(selected.map(x=>escCsv(row[index.get(x.source)]||'')).join(';'));
  return {headers,colonnes:selected.map(x=>x.target),apercu:rows.slice(1,11).map(row=>Object.fromEntries(selected.map(x=>[x.target,row[index.get(x.source)]||'']))),contenu:output.join('\n')};
}
function xlsxDepuisLignes(rows){
  const xmlEsc=(s)=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const col=(n)=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
  const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r,i)=>`<row r="${i+1}">${r.map((v,j)=>`<c r="${col(j)}${i+1}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files={'[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>','_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>','xl/workbook.xml':'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Modèle" sheetId="1" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':sheet};
  const locals=[],centrals=[];let offset=0;
  for(const [name,value]of Object.entries(files)){const n=Buffer.from(name),d=Buffer.from(value),crc=crc32(d);const lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50);lh.writeUInt16LE(20,4);lh.writeUInt32LE(crc,14);lh.writeUInt32LE(d.length,18);lh.writeUInt32LE(d.length,22);lh.writeUInt16LE(n.length,26);locals.push(lh,n,d);const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50);ch.writeUInt16LE(20,4);ch.writeUInt16LE(20,6);ch.writeUInt32LE(crc,16);ch.writeUInt32LE(d.length,20);ch.writeUInt32LE(d.length,24);ch.writeUInt16LE(n.length,28);ch.writeUInt32LE(offset,42);centrals.push(ch,n);offset+=lh.length+n.length+d.length;}
  const central=Buffer.concat(centrals);const end=Buffer.alloc(22);const count=Object.keys(files).length;end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,central,end]);
}
module.exports={lireXlsx,versCsv,xlsxDepuisLignes,MAX_FICHIER,MAX_LIGNES};
