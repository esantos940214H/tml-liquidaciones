#!/usr/bin/env node
// npm test — prueba los criterios de aceptación de publicación programada y
// validación con recetas de prueba en una carpeta temporal.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const sharp = require('sharp');
const { construir } = require('../build');
const R = require('../recetas');

const ejemplo = fs.readFileSync(path.join(__dirname, '..', '..', 'recetas', 'mole-coloradito.md'), 'utf8').replace(/^borrador: true\n/m, '');
const receta = (slug, fecha, extra = s => s) => extra(ejemplo
  .replace(/^slug: .*$/m, `slug: "${slug}"`).replace(/^titulo: .*$/m, `titulo: "Receta ${slug}"`)
  .replace(/^fecha_publicacion: .*$/m, `fecha_publicacion: "${fecha}"`).replace(/^foto: .*$/m, `foto: "fotos/${slug}.jpg"`));

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'encino-prueba-'));
  const cont = path.join(tmp, 'recetas'), sal = path.join(tmp, 'publico');
  fs.mkdirSync(path.join(cont, 'fotos'), { recursive: true });
  for (const s of ['pasada', 'futura']) await sharp({ create: { width: 900, height: 600, channels: 3, background: '#8e2c1f' } }).jpeg().toFile(path.join(cont, 'fotos', s + '.jpg'));
  fs.writeFileSync(path.join(cont, 'pasada.md'), receta('pasada', '2026-10-01'));
  fs.writeFileSync(path.join(cont, 'futura.md'), receta('futura', '2026-10-20'));
  fs.copyFileSync(path.join(__dirname, '..', '..', 'recetas', '_plantilla.md'), path.join(cont, '_plantilla.md'));
  const op = { contenido: cont, salida: sal, 'sin-carta': true, silencio: true };
  const lee = f => fs.readFileSync(path.join(sal, f), 'utf8');

  // 1) Solo la pasada existe: página, índice, temporada, sitemap, relacionadas
  await construir(Object.assign({ hoy: '2026-10-11' }, op));
  assert(fs.existsSync(path.join(sal, 'recetas/pasada/index.html')), 'la receta pasada debe existir');
  assert(!fs.existsSync(path.join(sal, 'recetas/futura')), 'la receta futura NO debe existir');
  for (const f of ['recetas/index.html', 'recetas/temporada/muertos/index.html', 'sitemap.xml', 'recetas/pasada/index.html']) {
    assert(!lee(f).includes('/recetas/futura/'), `${f} no debe mencionar la futura`);
  }
  assert(lee('sitemap.xml').includes('/recetas/pasada/'), 'el sitemap debe tener la pasada');
  assert(lee('index.html').includes('href="/recetas/"'), 'inicio debe enlazar a Recetas');
  console.log('✅ Con fecha de hoy 2026-10-11 solo se publica la receta pasada.');

  // 2) El día de su fecha (hora de México) aparece la futura
  await construir(Object.assign({ hoy: '2026-10-20' }, op));
  assert(fs.existsSync(path.join(sal, 'recetas/futura/index.html')));
  assert(lee('sitemap.xml').includes('/recetas/futura/') && lee('recetas/index.html').includes('/recetas/futura/'));
  assert(lee('recetas/pasada/index.html').includes('/recetas/futura/'), 'debe salir en relacionadas');
  console.log('✅ Al llegar su fecha, la receta futura aparece en página, índice, sitemap y relacionadas.');

  // 3) Hora de México: 20 oct 03:00 UTC todavía es 19 oct en Oaxaca
  assert.strictEqual(R.hoyMexico(new Date('2026-10-20T03:00:00Z')), '2026-10-19');
  assert.strictEqual(R.hoyMexico(new Date('2026-10-20T06:30:00Z')), '2026-10-20');
  console.log('✅ "Hoy" se calcula en hora de México.');

  // 4) El validador detecta un {id} inexistente y una fecha inválida
  fs.writeFileSync(path.join(cont, 'futura.md'), receta('futura', '2026-02-30', s => s.replace('Cuece {i10}', 'Cuece {i99}')));
  const v = R.cargar(cont);
  assert(v.errores.some(e => /\{i99\}/.test(e.msg)), 'debe detectar {i99}');
  assert(v.errores.some(e => /2026-02-30/.test(e.msg)), 'debe detectar la fecha inválida');
  await assert.rejects(construir(Object.assign({ hoy: '2026-10-20' }, op, { silencio: true })), /error/);
  console.log('✅ El validador detecta {id} inexistente y fecha inválida, y el build se detiene.');

  // 5) Sin errores en las recetas reales del repo
  const real = R.cargar(path.join(__dirname, '..', '..', 'recetas'));
  assert.strictEqual(real.errores.length, 0, 'las recetas del repo tienen errores');
  console.log('✅ Las recetas del repositorio pasan la validación.');
  fs.rmSync(tmp, { recursive: true, force: true });
}
main().catch(e => { console.error('❌ ' + e.message); process.exit(1); });
