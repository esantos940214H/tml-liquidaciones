// Optimiza la foto de cada receta: WebP + JPG de respaldo en 3 tamaños, y
// una imagen 1200×630 para compartir (WhatsApp, Facebook).
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ANCHOS = [480, 800, 1200];

// Genera las variantes en `destino` (carpeta) con el prefijo `foto`.
// Devuelve { ancho, alto, tamanos: [480, 800, …], og: 'foto-og.jpg' }.
async function procesar(origen, destino) {
  fs.mkdirSync(destino, { recursive: true });
  const meta = await sharp(origen).rotate().metadata();
  const anchoOrig = meta.autoOrient ? meta.autoOrient.width : meta.width;
  const altoOrig = meta.autoOrient ? meta.autoOrient.height : meta.height;
  let tamanos = ANCHOS.filter(a => a <= anchoOrig);
  if (!tamanos.length) tamanos = [anchoOrig];
  for (const a of tamanos) {
    const base = sharp(origen).rotate().resize({ width: a, withoutEnlargement: true });
    await base.clone().webp({ quality: 74 }).toFile(path.join(destino, `foto-${a}.webp`));
    await base.clone().jpeg({ quality: 78, mozjpeg: true }).toFile(path.join(destino, `foto-${a}.jpg`));
  }
  await sharp(origen).rotate().resize(1200, 630, { fit: 'cover', position: 'attention' }).jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(destino, 'foto-og.jpg'));
  return { ancho: anchoOrig, alto: altoOrig, tamanos, og: 'foto-og.jpg' };
}

module.exports = { procesar };
