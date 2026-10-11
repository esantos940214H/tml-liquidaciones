// Pre-renderiza carta.html con el menú actual de Firestore, para que Google
// y las vistas previas de WhatsApp vean la carta completa sin JavaScript.
// En el navegador, carta.html sigue conectándose a Firestore y reemplaza
// este HTML con los datos en vivo (precios recién cambiados, etc.).
// Si Firestore no responde, se deja la carta como estaba (no rompe el build).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function valor(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(valor);
  if ('mapValue' in v) return campos(v.mapValue.fields || {});
  return null;
}
function campos(f) { const o = {}; for (const k of Object.keys(f)) o[k] = valor(f[k]); return o; }

async function coleccion(projectId, nombre, mascara) {
  const docs = [];
  let token = '';
  do {
    let url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${nombre}?pageSize=300` + (token ? '&pageToken=' + encodeURIComponent(token) : '');
    if (mascara) url += mascara.map(c => '&mask.fieldPaths=' + c).join('');
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`${nombre}: HTTP ${r.status}`);
    const j = await r.json();
    for (const d of j.documents || []) docs.push(Object.assign(campos(d.fields || {}), { id: d.name.split('/').pop() }));
    token = j.nextPageToken || '';
  } while (token);
  return docs;
}

// Carga comun.js (el mismo que usa el navegador) para dibujar la carta igual.
function cargaEncino(raiz) {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(raiz, 'comun.js'), 'utf8'), ctx);
  return ctx.window.Encino;
}

async function prerender({ raiz, html, projectId, extraHead }) {
  const E = cargaEncino(raiz);
  // Sin la imagen de fondo: pesa mucho y la página en vivo la agrega sola.
  const [config, menu] = await Promise.all([
    coleccion(projectId, 'encino_config').then(ds => ds.filter(d => d.id === 'general')),
    coleccion(projectId, 'encino_menu')
  ]);
  if (!menu.length) throw new Error('el menú llegó vacío');
  const cfg = E.cfgFrom(config);
  let cuerpo = E.cartaBody(cfg, menu, { linkPedidos: cfg.pedidosActivos ? 'pedidos.html' : '' });
  // El build corre de madrugada: si a esa hora no hay menú "activo", se
  // marca el primero para que la página sin JavaScript muestre algo.
  if (!/class="c-menu on"/.test(cuerpo)) cuerpo = cuerpo.replace('class="c-menu"', 'class="c-menu on"');
  return html
    .replace('<style id="cartaCss"></style>', () => '<style id="cartaCss">' + E.CARTA_CSS + '</style>' + (extraHead || ''))
    .replace(/<div id="app">[\s\S]*?<\/div><\/div>/, () => '<div id="app">' + cuerpo + '</div>');
}

module.exports = { prerender };
