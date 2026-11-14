#!/usr/bin/env node
// npm run calendario — qué recetas ya están publicadas y cuáles salen y cuándo.
'use strict';
const path = require('path');
const R = require('./recetas');
const { args } = require('./build');

const op = args(process.argv.slice(2));
const hoy = op.hoy || R.hoyMexico();
const res = R.cargar(path.resolve(__dirname, '..', op.contenido || 'recetas'));
R.imprimeProblemas(res);
const dias = f => Math.round((Date.parse(f) - Date.parse(hoy)) / 864e5);
const filas = res.recetas.slice().sort((a, b) => a.fecha_publicacion.localeCompare(b.fecha_publicacion)).map(r => {
  const estado = r.borrador ? '📝 borrador (no se publica)' : R.publicada(r, hoy) ? '✅ publicada' : `⏳ sale en ${dias(r.fecha_publicacion)} día(s)`;
  return [r.fecha_publicacion, estado, R.TEMPORADAS[r.temporada].nombre, r.titulo];
});
console.log(`Calendario de recetas — hoy en México: ${hoy}\n`);
if (!filas.length) console.log('(No hay recetas todavía.)');
const anchos = [10, 28, 20];
for (const f of filas) console.log(f.map((c, i) => i < anchos.length ? String(c).padEnd(anchos[i]) : c).join('  '));
if (res.errores.length) console.log(`\n❌ Además hay ${res.errores.length} error(es) arriba: esas recetas no aparecen en el calendario.`);
