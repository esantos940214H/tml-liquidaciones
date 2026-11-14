#!/usr/bin/env node
// Construye el sitio público de Encino en la carpeta publico/ (lo que se
// sube a Firebase Hosting):
//   - copia las páginas existentes (inicio, carta, pedidos, administración)
//   - genera /recetas/, /recetas/<slug>/ y /recetas/temporada/<t>/ en HTML
//     estático, SOLO con las recetas cuya fecha ya llegó (hora de México)
//   - pre-renderiza la carta con el menú de Firestore
//   - genera sitemap.xml, robots.txt y sitio.js (datos del restaurante)
//
// Opciones:
//   --futuras            incluye recetas con fecha futura y borradores (vista previa)
//   --hoy=AAAA-MM-DD     simula otra fecha
//   --salida=carpeta     (por defecto publico/, o publico-preview/ con --futuras)
//   --contenido=carpeta  carpeta de recetas (por defecto recetas/)
//   --sin-carta          no consulta Firestore para la carta
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('./recetas');
const P = require('./plantillas');
const { procesar } = require('./imagenes');
const carta = require('./carta');

const RAIZ = path.resolve(__dirname, '..');

function args(argv) {
  const o = {};
  for (const a of argv) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) o[m[1]] = m[2] === undefined ? true : m[2]; }
  return o;
}

// Páginas y archivos que ya existían en encino/ y se publican tal cual.
const COPIAR = /\.(html|js|css|png|jpe?g|svg|webp|ico|webmanifest|txt)$/i;
const NO_COPIAR = new Set(['firestore.rules.txt']);

function escribe(archivo, texto) { fs.mkdirSync(path.dirname(archivo), { recursive: true }); fs.writeFileSync(archivo, texto); }

async function construir(op = {}) {
  const futuras = !!op.futuras;
  const hoy = op.hoy || R.hoyMexico();
  if (!R.fechaValida(hoy)) throw new Error(`--hoy=${hoy} no es una fecha válida`);
  const contenido = path.resolve(RAIZ, op.contenido || 'recetas');
  const salida = path.resolve(RAIZ, op.salida || (futuras ? 'publico-preview' : 'publico'));
  const cfg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'sitio.config.json'), 'utf8'));
  const version = Date.now().toString(36);
  // El CSS va dentro de cada página (sin una petición extra que bloquee el primer pintado).
  const css = fs.readFileSync(path.join(__dirname, 'cliente', 'recetas.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '');
  const robots = futuras ? 'noindex,nofollow' : '';
  const log = op.silencio ? () => {} : console.log;

  // 1) Validar. Cualquier error detiene el build (y el despliegue).
  const carga = R.cargar(contenido);
  R.imprimeProblemas(carga);
  if (carga.errores.length) {
    const e = new Error(`Hay ${carga.errores.length} error(es) en las recetas; no se publicó nada. Corrígelos y vuelve a intentar.`);
    e.validacion = true; throw e;
  }
  const visibles = carga.recetas.filter(r => futuras || R.publicada(r, hoy))
    .sort((a, b) => b.fecha_publicacion.localeCompare(a.fecha_publicacion) || a.titulo.localeCompare(b.titulo, 'es'));

  // 2) Carpeta limpia: lo que no se genere hoy no existe en el sitio.
  fs.rmSync(salida, { recursive: true, force: true });
  fs.mkdirSync(salida, { recursive: true });
  for (const f of fs.readdirSync(RAIZ)) {
    const ruta = path.join(RAIZ, f);
    if (fs.statSync(ruta).isFile() && COPIAR.test(f) && !NO_COPIAR.has(f)) fs.copyFileSync(ruta, path.join(salida, f));
  }

  // 3) Recursos de recetas
  const escala = fs.readFileSync(path.join(__dirname, 'escala.js'), 'utf8');
  const cliente = fs.readFileSync(path.join(__dirname, 'cliente', 'recetas.js'), 'utf8');
  escribe(path.join(salida, 'recetas', 'recetas.js'), escala + '\n' + cliente);

  // 4) Fotos
  const imgs = {};
  for (const r of visibles) imgs[r.slug] = await procesar(r.fotoRuta, path.join(salida, 'recetas', r.slug));

  // 5) Páginas de receta
  for (const r of visibles) {
    const misma = visibles.filter(x => x.slug !== r.slug && x.temporada === r.temporada);
    const otras = visibles.filter(x => x.slug !== r.slug && x.temporada !== r.temporada);
    const relacionadas = misma.concat(otras).slice(0, 3);
    escribe(path.join(salida, 'recetas', r.slug, 'index.html'), P.paginaReceta(cfg, r, { img: imgs[r.slug], relacionadas, imgs, version, robots, css }));
  }

  // 6) Índice y temporadas
  const temporadas = Object.keys(R.TEMPORADAS).filter(k => visibles.some(r => r.temporada === k)).map(k => R.TEMPORADAS[k]);
  escribe(path.join(salida, 'recetas', 'index.html'), P.paginaIndice(cfg, { recetas: visibles, imgs, temporadas, version, robots, css }));
  for (const t of temporadas) {
    const k = Object.keys(R.TEMPORADAS).find(x => R.TEMPORADAS[x] === t);
    escribe(path.join(salida, 'recetas', 'temporada', t.slug, 'index.html'),
      P.paginaIndice(cfg, { recetas: visibles.filter(r => r.temporada === k), imgs, temporadas, actual: t.slug, version, robots, css }));
  }
  escribe(path.join(salida, '404.html'), P.pagina404(cfg, version, css));

  // 7) Datos del restaurante para inicio (sitio.js) y datos estructurados
  //    estáticos en inicio y carta.
  const sitio = { nombre: cfg.nombre, lema: cfg.lema, descripcion: cfg.descripcion, direccion: P.direccionTxt(cfg), telefono: cfg.telefono, whatsapp: cfg.whatsapp,
    mapa: cfg.mapa, facebook: cfg.facebook, instagram: cfg.instagram, cocina: cfg.cocina.join(', '), rangoPrecio: cfg.rangoPrecio, horario: cfg.horario.texto, notaHorario: cfg.horario.nota };
  escribe(path.join(salida, 'sitio.js'), '// Generado por herramientas/build.js desde sitio.config.json. No editar aquí.\nwindow.ENCINO_SITIO = ' + JSON.stringify(sitio, null, 2) + ';\n');
  const ldRest = P.ldScript(P.ldRestaurante(cfg));
  const head = (desc, ruta) => `<meta name="description" content="${P.esc(desc)}">\n<link rel="canonical" href="${cfg.url}${ruta}">\n` + ldRest + (robots ? `\n<meta name="robots" content="${robots}">` : '');
  // Enlace "Recetas" en inicio y carta: solo si ya hay recetas publicadas.
  const enlaces = html => visibles.length ? html : html.replace(/<!--recetas-->[\s\S]*?<!--\/recetas-->/g, '');

  const inicio = path.join(salida, 'index.html');
  let hi = fs.readFileSync(inicio, 'utf8').replace('</head>', ldRest + (robots ? `\n<meta name="robots" content="${robots}">` : '') + '\n</head>');
  fs.writeFileSync(inicio, enlaces(hi));

  const cartaArchivo = path.join(salida, 'carta.html');
  let hc = fs.readFileSync(cartaArchivo, 'utf8');
  hc = hc.replace('<html lang="es">', '<html lang="es-MX">').replace('</head>',
    head(`Carta de ${cfg.nombre} en ${cfg.direccion.localidad}, Oaxaca: desayunos y comidas de viernes a domingo, cocina oaxaqueña a las brasas de encino y barbacoa de borrego. Precios y pedidos en línea.`, '/carta.html') +
    `\n<meta property="og:type" content="website"><meta property="og:title" content="Carta | ${P.esc(cfg.nombre)}, Oaxaca"><meta property="og:url" content="${cfg.url}/carta.html">\n</head>`);
  if (!op['sin-carta']) {
    try {
      const fb = fs.readFileSync(path.join(RAIZ, 'config.js'), 'utf8').match(/projectId:\s*"([^"]+)"/);
      hc = await carta.prerender({ raiz: RAIZ, html: hc, projectId: fb[1] });
      log('Carta pre-renderizada con el menú de Firestore.');
    } catch (e) {
      console.warn('⚠️  No se pudo pre-renderizar la carta (' + e.message + '); se publica la versión que carga con JavaScript.');
    }
  }
  fs.writeFileSync(cartaArchivo, enlaces(hc));

  // 8) sitemap.xml y robots.txt
  const urls = [['/', hoy], [cfg.carta, hoy], [cfg.pedidos, null]];
  if (visibles.length) {
    urls.push(['/recetas/', visibles[0].fecha_publicacion]);
    for (const t of temporadas) {
      const k = Object.keys(R.TEMPORADAS).find(x => R.TEMPORADAS[x] === t);
      urls.push([`/recetas/temporada/${t.slug}/`, visibles.find(r => r.temporada === k).fecha_publicacion]);
    }
    for (const r of visibles) urls.push([`/recetas/${r.slug}/`, r.fecha_actualizacion && r.fecha_actualizacion > r.fecha_publicacion ? r.fecha_actualizacion : r.fecha_publicacion]);
  }
  escribe(path.join(salida, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(([u, f]) => `  <url><loc>${P.esc(P.urlAbs(cfg, u))}</loc>${f ? `<lastmod>${f}</lastmod>` : ''}</url>`).join('\n') + '\n</urlset>\n');
  escribe(path.join(salida, 'robots.txt'), futuras ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nDisallow: /admin.html\nSitemap: ${cfg.url}/sitemap.xml\n`);

  log(`Listo: ${visibles.length} receta(s) ${futuras ? '(incluye futuras y borradores) ' : ''}en ${path.relative(process.cwd(), salida) || '.'} — hoy en México es ${hoy}.`);
  return { salida, visibles, todas: carga.recetas, hoy };
}

module.exports = { construir, args };

if (require.main === module) {
  construir(args(process.argv.slice(2))).catch(e => {
    console.error('\n❌ ' + e.message);
    if (!e.validacion) console.error(e.stack);
    process.exit(1);
  });
}
