#!/usr/bin/env node
// npm run validar-recetas — revisa todas las recetas sin construir el sitio.
'use strict';
const path = require('path');
const R = require('./recetas');
const { args } = require('./build');

const op = args(process.argv.slice(2));
const carpeta = path.resolve(__dirname, '..', op.contenido || 'recetas');
const res = R.cargar(carpeta);
R.imprimeProblemas(res);
if (res.errores.length) {
  console.error(`\n❌ ${res.errores.length} error(es). El sitio no se publicará hasta corregirlos.`);
  process.exit(1);
}
console.log(`✅ ${res.recetas.length} receta(s) sin errores.`);
