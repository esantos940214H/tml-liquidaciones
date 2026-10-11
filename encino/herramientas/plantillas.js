// HTML de las páginas de recetas. Todo el contenido sale ya escrito en el
// HTML (se lee sin JavaScript); recetas.js solo agrega porciones,
// cronómetros, modo cocina, compartir e imprimir.
'use strict';
const { marked } = require('marked');
const { ingredienteTxt, cantidadTxt } = require('./escala');
const { TEMPORADAS } = require('./recetas');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FUENTES = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&amp;family=Source+Sans+3:wght@400;600;700&amp;display=swap';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaTxt = f => { const [a, m, d] = f.split('-').map(Number); return `${d} de ${MESES[m - 1]} de ${a}`; };
const minTxt = m => { const h = Math.floor(m / 60), r = Math.round(m % 60); return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`; };
const isoDur = m => { const h = Math.floor(m / 60), r = Math.round(m % 60); return 'PT' + (h ? h + 'H' : '') + (r || !h ? r + 'M' : ''); };
const relojTxt = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60, p = n => String(n).padStart(2, '0'); return (h ? h + ':' + p(m) : m) + ':' + p(x); };
const telLimpio = t => String(t || '').replace(/\D/g, '');
// En la historia y las notas, los títulos bajan a h3 para no romper la jerarquía (un solo h1).
const titulos = h => h.replace(/<(\/?)h[12]\b/g, '<$1h3');
const ldScript = o => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, '\\u003c') + '</script>';

function urlReceta(cfg, r) { return `${cfg.url}/recetas/${r.slug}/`; }
function urlAbs(cfg, p) { return /^https?:/.test(p) ? p : cfg.url + p; }
function direccionTxt(cfg) { const d = cfg.direccion; return `${d.calle}, ${d.localidad}, ${d.estado}, C.P. ${d.cp}`; }
function whatsappUrl(cfg, texto) { return `https://wa.me/52${telLimpio(cfg.whatsapp)}` + (texto ? '?text=' + encodeURIComponent(texto) : ''); }

// ── Datos estructurados ──────────────────────────────────────────────────
function ldRestaurante(cfg) {
  const d = cfg.direccion, h = cfg.horario;
  const o = {
    '@context': 'https://schema.org', '@type': 'Restaurant', '@id': cfg.url + '/#restaurante',
    name: cfg.nombre, url: cfg.url + '/', description: cfg.descripcion || undefined,
    address: { '@type': 'PostalAddress', streetAddress: d.calle, addressLocality: d.localidad, addressRegion: d.estado, postalCode: d.cp, addressCountry: d.pais },
    geo: cfg.geo && cfg.geo.lat != null && cfg.geo.lng != null ? { '@type': 'GeoCoordinates', latitude: cfg.geo.lat, longitude: cfg.geo.lng } : undefined,
    telephone: '+52 ' + cfg.telefono,
    openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: h.dias.map(x => 'https://schema.org/' + x), opens: h.abre, closes: h.cierra }],
    servesCuisine: cfg.cocina, priceRange: cfg.rangoPrecio || undefined,
    menu: urlAbs(cfg, cfg.carta), hasMenu: urlAbs(cfg, cfg.carta), acceptsReservations: !!cfg.aceptaReservaciones,
    hasMap: cfg.mapa || undefined,
    sameAs: [cfg.facebook, cfg.instagram].filter(Boolean),
    potentialAction: { '@type': 'OrderAction', target: urlAbs(cfg, cfg.pedidos) }
  };
  return JSON.parse(JSON.stringify(o));
}
function ldMigas(cfg, migas) {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: migas.map((m, i) => ({ '@type': 'ListItem', position: i + 1, name: m[0], item: urlAbs(cfg, m[1]) })) };
}
function textoPlano(r, paso, mapa) {
  return paso.texto.replace(/\{([^{}\s]+)\}/g, (_, id) => ingredienteTxt(mapa[id], 1)).replace(/[*_`]/g, '');
}
function ldReceta(cfg, r, img, mapa) {
  const url = urlReceta(cfg, r);
  const fotos = [`${url}foto-og.jpg`].concat(img.tamanos.slice(-1).map(a => `${url}foto-${a}.jpg`));
  const org = { '@type': 'Organization', name: cfg.nombre, url: cfg.url + '/' };
  return {
    '@context': 'https://schema.org', '@type': 'Recipe', name: r.titulo, image: fotos, description: r.descripcion_seo,
    datePublished: r.fecha_publicacion, dateModified: r.fecha_actualizacion || undefined,
    author: org, publisher: org,
    prepTime: isoDur(r.tiempo_preparacion_min), cookTime: isoDur(r.tiempo_coccion_min), totalTime: isoDur(r.tiempo_preparacion_min + r.tiempo_coccion_min),
    recipeYield: [String(r.porciones_base), `${r.porciones_base} porciones`], recipeCategory: r.categoria, recipeCuisine: 'Oaxaqueña',
    keywords: (r.palabras_clave || []).join(', ') || undefined,
    recipeIngredient: r.ingredientes.flatMap(g => g.items.map(it => ingredienteTxt(it, 1))),
    recipeInstructions: r.pasos.map((p, i) => ({ '@type': 'HowToStep', name: p.titulo || `Paso ${i + 1}`, text: textoPlano(r, p, mapa), url: `${url}#paso-${i + 1}` }))
  };
}

// ── Piezas comunes ───────────────────────────────────────────────────────
function pagina(cfg, o) {
  // o: { titulo, descripcion, ruta, ogImg, ogTipo, ld: [], cuerpo, clase, robots, version }
  const canon = urlAbs(cfg, o.ruta);
  const img = o.ogImg ? `<meta property="og:image" content="${esc(o.ogImg)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:image" content="${esc(o.ogImg)}">` : '';
  return `<!doctype html>
<html lang="es-MX" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.titulo)}</title>
<meta name="description" content="${esc(o.descripcion)}">
${o.robots ? `<meta name="robots" content="${o.robots}">` : ''}
<link rel="canonical" href="${esc(canon)}">
<meta property="og:type" content="${o.ogTipo || 'website'}">
<meta property="og:locale" content="es_MX">
<meta property="og:site_name" content="${esc(cfg.nombre)}">
<meta property="og:title" content="${esc(o.ogTitulo || o.titulo)}">
<meta property="og:description" content="${esc(o.descripcion)}">
<meta property="og:url" content="${esc(canon)}">
<meta name="twitter:card" content="${o.ogImg ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(o.ogTitulo || o.titulo)}">
<meta name="twitter:description" content="${esc(o.descripcion)}">
${img}
<meta name="theme-color" content="#46612f">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="${FUENTES}" onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet" href="${FUENTES}"></noscript>
${o.preload || ''}
<style>${o.css}</style>
<script>document.documentElement.classList.replace('no-js','js')</script>
${(o.ld || []).map(ldScript).join('\n')}
</head>
<body class="${o.clase || ''}">
<a class="saltar" href="#contenido">Saltar al contenido</a>
<header class="sitio"><div class="w sitio-in">
  <a class="marca" href="/">Encino</a>
  <nav aria-label="Principal"><a href="${esc(cfg.carta)}">Carta</a><a href="/recetas/"${o.seccion === 'recetas' ? ' aria-current="page"' : ''}>Recetas</a><a href="${esc(cfg.pedidos)}">Ordenar</a></nav>
</div></header>
${o.cuerpo}
<footer class="pie"><div class="w">
  <p class="pie-nombre">${esc(cfg.nombre)}</p>
  <p>${esc(direccionTxt(cfg))}<br>${esc(cfg.horario.texto)}<br>Tel. y WhatsApp <a href="tel:+52${telLimpio(cfg.telefono)}">${esc(cfg.telefono)}</a></p>
  <p><a href="/">Inicio</a> · <a href="${esc(cfg.carta)}">Carta</a> · <a href="/recetas/">Recetas</a> · <a href="${esc(cfg.pedidos)}">Ordenar en línea</a> · <a href="${esc(cfg.mapa)}" target="_blank" rel="noopener">Cómo llegar</a></p>
</div></footer>
${o.scripts || ''}
</body>
</html>
`;
}

function migasHtml(migas) {
  return '<nav class="migas" aria-label="Ruta"><ol>' + migas.map((m, i) => i === migas.length - 1 ? `<li aria-current="page">${esc(m[0])}</li>` : `<li><a href="${esc(m[1])}">${esc(m[0])}</a></li>`).join('') + '</ol></nav>';
}

function picture(r, img, { clase, eager, sizes }) {
  const base = `/recetas/${r.slug}/`;
  const set = ext => img.tamanos.map(a => `${base}foto-${a}.${ext} ${a}w`).join(', ');
  const def = img.tamanos.includes(800) ? 800 : img.tamanos[img.tamanos.length - 1];
  const alto = Math.round(img.alto * def / img.ancho);
  return `<picture class="${clase || ''}"><source type="image/webp" srcset="${set('webp')}" sizes="${sizes}"><img src="${base}foto-${def}.jpg" srcset="${set('jpg')}" sizes="${sizes}" width="${def}" height="${alto}" alt="${esc(r.foto_alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"'}></picture>`;
}

function tarjeta(r, img) {
  const t = TEMPORADAS[r.temporada];
  return `<li class="tarjeta"><a href="/recetas/${r.slug}/">${picture(r, img, { sizes: '(min-width: 760px) 340px, 92vw' })}<span class="tarj-txt"><span class="chip">${esc(t.nombre)}</span><span class="tarj-tit">${esc(r.titulo)}</span><span class="tarj-meta">${minTxt(r.tiempo_preparacion_min + r.tiempo_coccion_min)} · ${esc(r.dificultad)}</span></span></a></li>`;
}

// ── Página de receta ─────────────────────────────────────────────────────
function paginaReceta(cfg, r, { img, relacionadas, imgs, version, robots, css }) {
  const t = TEMPORADAS[r.temporada];
  const mapa = {};
  r.ingredientes.forEach(g => g.items.forEach(it => { mapa[it.id] = it; }));
  const url = urlReceta(cfg, r);
  const total = r.tiempo_preparacion_min + r.tiempo_coccion_min;
  const migas = [['Inicio', '/'], ['Recetas', '/recetas/'], [r.titulo, `/recetas/${r.slug}/`]];

  const ingredientes = r.ingredientes.map(g => `<div class="ing-grupo">${g.grupo ? `<h4>${esc(g.grupo)}</h4>` : ''}<ul class="ings">${g.items.map(it =>
    `<li><label><input type="checkbox" data-id="${esc(it.id)}"><span class="q" data-cant="${it.cantidad == null ? '' : it.cantidad}" data-uni="${esc(it.unidad || '')}">${esc(cantidadTxt(it.cantidad, it.unidad, 1))}</span><span class="n">${esc(it.nombre)}</span></label></li>`).join('')}</ul></div>`).join('');

  const pasos = r.pasos.map((p, i) => {
    let h = marked.parseInline(p.texto);
    h = h.replace(/\{([^{}\s]+)\}/g, (_, id) => { const it = mapa[id]; return `<span class="ing" data-cant="${it.cantidad == null ? '' : it.cantidad}" data-uni="${esc(it.unidad || '')}" data-nombre="${esc(it.nombre)}">${esc(ingredienteTxt(it, 1))}</span>`; });
    const nombre = p.titulo || `Paso ${i + 1}`;
    const crono = p.cronometro_seg ? `<button type="button" class="crono solo-js" data-seg="${p.cronometro_seg}" data-nombre="${esc(nombre)}">Iniciar ⏱ ${relojTxt(p.cronometro_seg)}</button>` : '';
    return `<li id="paso-${i + 1}" class="paso"><h4 class="paso-tit">${esc(nombre)}</h4><p class="paso-txt">${h}</p>${p.cronometro_seg ? `<p class="paso-tiempo solo-nojs">Tiempo: ${minTxt(p.cronometro_seg / 60)}</p>` : ''}${crono}</li>`;
  }).join('');

  const ctaTxt = r.en_carta ? r.disponibilidad_carta : r.cta_alterno;
  const waTxt = `Hola, vi la receta de ${r.titulo} en ${cfg.url.replace(/^https?:\/\//, '')}`;
  const rel = relacionadas.length ? `<section class="relacionadas w" aria-labelledby="t-rel"><h2 id="t-rel">Más recetas</h2><ul class="tarjetas">${relacionadas.map(x => tarjeta(x, imgs[x.slug])).join('')}</ul></section>` : '';
  const def = img.tamanos.includes(800) ? 800 : img.tamanos[img.tamanos.length - 1];

  const cuerpo = `<main id="contenido">
<article class="receta" data-slug="${esc(r.slug)}" data-porciones="${r.porciones_base}">
<header class="hero w">
  ${migasHtml(migas)}
  ${picture(r, img, { clase: 'hero-foto', eager: true, sizes: '(min-width: 760px) 728px, 100vw' })}
  <div class="hero-txt">
    <a class="chip" href="/recetas/temporada/${t.slug}/">${esc(t.nombre)}</a>
    <h1>${esc(r.titulo)}</h1>
    <ul class="datos-receta">
      <li><span>Preparación</span>${minTxt(r.tiempo_preparacion_min)}</li>
      <li><span>Cocción</span>${minTxt(r.tiempo_coccion_min)}</li>
      <li><span>Total</span>${minTxt(total)}</li>
      <li><span>Porciones</span>${r.porciones_base}</li>
      <li><span>Dificultad</span>${esc(r.dificultad)}</li>
    </ul>
    <div class="hero-btns"><a class="btn p" href="#receta">Ir a la receta</a><a class="btn" href="#encino">Pruébala en Encino</a></div>
  </div>
</header>
${r.historia ? `<section class="historia w" aria-labelledby="t-hist"><h2 id="t-hist">La historia</h2>${titulos(marked.parse(r.historia))}<p class="publicada">Publicada el <time datetime="${r.fecha_publicacion}">${fechaTxt(r.fecha_publicacion)}</time></p></section>` : ''}
<section id="receta" class="recetario w" aria-labelledby="t-rec">
  <h2 id="t-rec">La receta</h2>
  <div class="herramientas">
    <div class="porciones solo-js" role="group" aria-label="Porciones"><button type="button" class="menos" aria-label="Menos porciones">−</button><output aria-live="polite"><b class="porc-num">${r.porciones_base}</b> porciones</output><button type="button" class="mas" aria-label="Más porciones">+</button></div>
    <p class="solo-nojs">Rinde ${r.porciones_base} porciones.</p>
    <div class="acciones solo-js"><button type="button" class="btn p" id="modoCocina">👩‍🍳 Modo cocina</button><button type="button" class="btn" id="compartir">Compartir</button><button type="button" class="btn" id="imprimir">Imprimir</button></div>
  </div>
  <h3>Ingredientes</h3>
  <p class="ayuda">Palomea lo que ya tienes.</p>
  ${ingredientes}
  <h3>Pasos</h3>
  <ol class="pasos">${pasos}</ol>
  ${r.notas ? `<h3>Notas y tips</h3><div class="notas">${titulos(marked.parse(r.notas))}</div>` : ''}
</section>
<section id="encino" class="cta" aria-labelledby="t-cta"><div class="w">
  <h2 id="t-cta">¿Mejor ven a probarla?</h2>
  <p class="cta-txt">${esc(ctaTxt)}</p>
  <div class="cta-btns">
    <a class="btn p" href="${esc(cfg.carta)}">Ver la carta</a>
    <a class="btn" href="${esc(cfg.mapa)}" target="_blank" rel="noopener">Cómo llegar</a>
    <a class="btn" href="${esc(cfg.pedidos)}">Pedir en línea</a>
    <a class="btn wa" href="${esc(whatsappUrl(cfg, waTxt))}" target="_blank" rel="noopener">WhatsApp</a>
  </div>
  <dl class="cta-datos">
    <div><dt>Horario</dt><dd>${esc(cfg.horario.texto)}${cfg.horario.nota ? '<br>' + esc(cfg.horario.nota) : ''}</dd></div>
    <div><dt>Dirección</dt><dd>${esc(direccionTxt(cfg))}</dd></div>
  </dl>
</div></section>
${rel}
</article>
</main>
<div id="cronos" class="cronos" aria-live="polite" hidden></div>
<div id="cocina" class="cocina" role="dialog" aria-modal="true" aria-labelledby="cocinaTit" hidden>
  <div class="cocina-top"><span id="cocinaN"></span><button type="button" class="cerrar" id="cocinaCerrar" aria-label="Salir del modo cocina">✕</button></div>
  <div class="cocina-paso"><h2 id="cocinaTit"></h2><p id="cocinaTxt"></p><div id="cocinaCrono"></div></div>
  <div class="cocina-nav"><button type="button" class="btn" id="cocinaAnt">← Anterior</button><button type="button" class="btn p" id="cocinaSig">Siguiente →</button></div>
</div>
<div id="aviso" class="aviso" role="status" hidden></div>
<p class="imprime-pie">${esc(url)}</p>`;

  return pagina(cfg, {
    titulo: `${r.titulo} | Receta | ${cfg.nombre}, Oaxaca`, ogTitulo: r.titulo,
    descripcion: r.descripcion_seo, ruta: `/recetas/${r.slug}/`, ogImg: `${url}foto-og.jpg`, ogTipo: 'article',
    ld: [ldReceta(cfg, r, img, mapa), ldRestaurante(cfg), ldMigas(cfg, migas)], cuerpo, version, robots, css, seccion: 'recetas', clase: 'pg-receta',
    preload: `<link rel="preload" as="image" type="image/webp" imagesrcset="${img.tamanos.map(a => `/recetas/${r.slug}/foto-${a}.webp ${a}w`).join(', ')}" imagesizes="(min-width: 760px) 728px, 100vw" href="/recetas/${r.slug}/foto-${def}.webp">`,
    scripts: `<script src="/recetas/recetas.js?v=${version}" defer></script>`
  });
}

// ── Índice y temporadas ──────────────────────────────────────────────────
function paginaIndice(cfg, { recetas, imgs, temporadas, actual, version, robots, css }) {
  const t = actual ? Object.values(TEMPORADAS).find(x => x.slug === actual) : null;
  const ruta = t ? `/recetas/temporada/${t.slug}/` : '/recetas/';
  const migas = [['Inicio', '/'], ['Recetas', '/recetas/']].concat(t ? [[t.nombre, ruta]] : []);
  const h1 = t ? `Recetas de ${t.nombre}` : 'Recetas oaxaqueñas';
  const intro = t ? `Recetas oaxaqueñas para ${t.nombre.toLowerCase()}, paso a paso y con cronómetro, de la cocina de ${cfg.nombre}.`
    : `Recetas tradicionales de Oaxaca paso a paso, con cronómetros y porciones ajustables, de la cocina de ${cfg.nombre}.`;
  const chips = `<nav class="filtro" aria-label="Filtrar por temporada"><a href="/recetas/"${!t ? ' aria-current="page"' : ''}>Todas</a>${temporadas.map(x => `<a href="/recetas/temporada/${x.slug}/"${t && t.slug === x.slug ? ' aria-current="page"' : ''}>${esc(x.nombre)}</a>`).join('')}</nav>`;
  const lista = recetas.length ? `<ul class="tarjetas">${recetas.map(r => tarjeta(r, imgs[r.slug])).join('')}</ul>` : '<p class="vacio">Muy pronto publicaremos aquí nuestras recetas. Mientras, te esperamos en el restaurante.</p>';
  const cuerpo = `<main id="contenido" class="w indice">
${migasHtml(migas)}
<h1>${esc(h1)}</h1>
<p class="intro">${esc(intro)}</p>
${temporadas.length > 1 ? chips : ''}
${lista}
<aside class="cta-mini"><h2>¿Sin tiempo para cocinar?</h2><p>${esc(cfg.horario.texto)} ${esc(cfg.horario.nota || '')}</p><p><a class="btn p" href="${esc(cfg.carta)}">Ver la carta</a> <a class="btn" href="${esc(cfg.mapa)}" target="_blank" rel="noopener">Cómo llegar</a></p></aside>
</main>`;
  const desc = t ? `${intro} ${cfg.direccion.localidad}, Oaxaca.` : `${intro} ${cfg.direccion.localidad}, Oaxaca.`;
  const og = recetas[0] ? `${cfg.url}/recetas/${recetas[0].slug}/foto-og.jpg` : null;
  return pagina(cfg, {
    titulo: t ? `${h1} | ${cfg.nombre}, Oaxaca` : `Recetas oaxaqueñas | ${cfg.nombre}, Oaxaca`, descripcion: desc, ruta, ogImg: og,
    ld: [ldRestaurante(cfg), ldMigas(cfg, migas)], cuerpo, version, robots, css, seccion: 'recetas', clase: 'pg-indice'
  });
}

function pagina404(cfg, version, css) {
  return pagina(cfg, {
    titulo: `Página no encontrada | ${cfg.nombre}`, descripcion: 'La página que buscas no existe.', ruta: '/404.html', robots: 'noindex', version, css,
    cuerpo: `<main id="contenido" class="w indice"><h1>No encontramos esta página</h1><p class="intro">Puede que la dirección esté mal escrita o que la receta todavía no se publique.</p><p><a class="btn p" href="/recetas/">Ver recetas</a> <a class="btn" href="${esc(cfg.carta)}">Ver la carta</a></p></main>`
  });
}

module.exports = { paginaReceta, paginaIndice, pagina404, ldRestaurante, ldScript, direccionTxt, esc, urlAbs };
