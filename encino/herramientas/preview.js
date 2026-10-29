#!/usr/bin/env node
// npm run preview            → el sitio tal como se publicaría hoy
// npm run preview -- --futuras → incluye recetas futuras y borradores
// Construye en publico-preview/ y lo sirve en http://localhost:8080
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { construir, args } = require('./build');

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const op = args(process.argv.slice(2));
op.salida = op.salida || 'publico-preview';
const puerto = Number(op.puerto) || 8080;
construir(op).then(({ salida }) => {
  http.createServer((req, res) => {
    let ruta = decodeURIComponent(req.url.split('?')[0]);
    let archivo = path.join(salida, path.normalize(ruta).replace(/^(\.\.[/\\])+/, ''));
    if (!archivo.startsWith(salida)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(archivo) && fs.statSync(archivo).isDirectory()) {
      if (!ruta.endsWith('/')) { res.writeHead(301, { Location: ruta + '/' }); return res.end(); }
      archivo = path.join(archivo, 'index.html');
    }
    if (!fs.existsSync(archivo)) { res.writeHead(404, { 'Content-Type': TIPOS['.html'] }); return res.end(fs.readFileSync(path.join(salida, '404.html'))); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(archivo).pipe(res);
  }).listen(puerto, () => console.log(`\nVista previa en http://localhost:${puerto}/recetas/  (Ctrl+C para salir)`));
}).catch(e => { console.error('\n❌ ' + e.message); process.exit(1); });
