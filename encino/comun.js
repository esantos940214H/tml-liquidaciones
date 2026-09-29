// Utilidades compartidas por admin.html (administración), carta.html (menú
// QR) y pedidos.html (pedidos en línea).
(function(){
  'use strict';
  var DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

  var DEFAULT_CFG = {
    id: 'general',
    nombre: 'Restaurante Encino',
    direccion: '',
    telefono: '',
    rfc: '',
    leyenda: '¡Gracias por su visita!',
    mesas: 12,
    anchoTicket: 80,
    pedidosActivos: true,
    urlPublica: '',
    // Un platillo sin menús asignados aparece en TODOS (útil para bebidas).
    menus: [
      { id: 'vie-des', nombre: 'Viernes · Desayunos', dias: [5], desde: '08:00', hasta: '12:30' },
      { id: 'vie-com', nombre: 'Viernes · Comidas', dias: [5], desde: '12:30', hasta: '18:00' },
      { id: 'fds-des', nombre: 'Sábado y Domingo · Desayunos', dias: [6, 0], desde: '08:00', hasta: '12:30' },
      { id: 'fds-com', nombre: 'Sábado y Domingo · Comidas', dias: [6, 0], desde: '12:30', hasta: '18:00' }
    ]
  };

  function cfgFrom(docs){
    var g = (docs || []).find(function(d){ return d.id === 'general'; }) || {};
    var c = Object.assign({}, DEFAULT_CFG, g);
    if (!Array.isArray(c.menus) || !c.menus.length) c.menus = DEFAULT_CFG.menus;
    return c;
  }
  function money(n){ return '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }
  function dkey(ts){ var d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
  function hm(d){ return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }

  // Variantes de un platillo (ej. chilaquiles solos / con pollo / con
  // tasajo), cada una con su precio. Vacío = platillo de precio único.
  function variantes(item){ return Array.isArray(item.variantes) ? item.variantes.filter(function(v){ return v && v.nombre; }) : []; }
  function precioMin(item){
    var vs = variantes(item);
    if (!vs.length) return Number(item.precio) || 0;
    return Math.min.apply(null, vs.map(function(v){ return Number(v.precio) || 0; }));
  }
  function precioTxt(item){
    var vs = variantes(item);
    if (!vs.length) return money(item.precio);
    var min = precioMin(item), iguales = vs.every(function(v){ return (Number(v.precio) || 0) === min; });
    return (iguales ? '' : 'desde ') + money(min);
  }

  // ¿En qué menús aparece el platillo? (vacío = en todos)
  function enMenu(item, menuId){
    var ms = Array.isArray(item.menus) ? item.menus : [];
    return !menuId || !ms.length || ms.indexOf(menuId) >= 0;
  }
  // Menú que corresponde a una fecha/hora; si ninguno está en horario, el
  // siguiente que va a abrir.
  function menuActual(cfg, date){
    date = date || new Date();
    var menus = cfg.menus || [], t = hm(date), dow = date.getDay();
    var hoy = menus.filter(function(m){ return (m.dias || []).indexOf(dow) >= 0; });
    var ahora = hoy.find(function(m){ return (!m.desde || t >= m.desde) && (!m.hasta || t < m.hasta); });
    if (ahora) return ahora;
    var luego = hoy.filter(function(m){ return m.desde && t < m.desde; }).sort(function(a,b){ return a.desde < b.desde ? -1 : 1; })[0];
    if (luego) return luego;
    for (var i = 1; i <= 7; i++) {
      var d = (dow + i) % 7;
      var m = menus.filter(function(x){ return (x.dias || []).indexOf(d) >= 0; }).sort(function(a,b){ return (a.desde||'') < (b.desde||'') ? -1 : 1; })[0];
      if (m) return m;
    }
    return menus[0] || null;
  }
  function diasTxt(m){
    var d = (m.dias || []).slice().sort(function(a,b){ return ((a+6)%7) - ((b+6)%7); });
    return d.map(function(x){ return DIAS[x]; }).join(', ') + (m.desde ? ' · ' + m.desde + (m.hasta ? '–' + m.hasta : '') : '');
  }
  // Agrupa platillos por categoría manteniendo alimentos antes que bebidas.
  function porCategoria(items){
    var g = {}, orden = [];
    items.slice().sort(function(a,b){
      var ta = a.tipo === 'bebida' ? 1 : 0, tb = b.tipo === 'bebida' ? 1 : 0;
      if (ta !== tb) return ta - tb;
      var ca = (a.categoria||'').toLowerCase(), cb = (b.categoria||'').toLowerCase();
      if (ca !== cb) return ca < cb ? -1 : 1;
      return (a.nombre||'').localeCompare(b.nombre||'', 'es');
    }).forEach(function(it){
      var k = it.categoria || (it.tipo === 'bebida' ? 'Bebidas' : 'Platillos');
      if (!g[k]) { g[k] = []; orden.push(k); }
      g[k].push(it);
    });
    return orden.map(function(k){ return { categoria: k, items: g[k] }; });
  }

  // ── Carta (menú para clientes por QR) ──────────────────────────────────
  var CARTA_CSS = [
    ':root{--bg:#f7f3ec;--card:#fffdf8;--ink:#2b2a26;--mut:#7a7466;--acc:#4f6b3a;--line:#e4dccd}',
    '@media (prefers-color-scheme:dark){:root{--bg:#171a15;--card:#1f231c;--ink:#ece8df;--mut:#a9a392;--acc:#a8c48c;--line:#343a2f}}',
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Georgia,"Times New Roman",serif}',
    '.c-wrap{max-width:720px;margin:0 auto;padding:24px 16px 48px}',
    '.c-head{text-align:center;margin-bottom:18px}.c-head h1{margin:0;font-size:2rem;letter-spacing:.04em;color:var(--acc)}',
    '.c-head p{margin:4px 0 0;color:var(--mut);font-family:system-ui,sans-serif;font-size:.85rem}',
    '.c-tabs{display:flex;gap:8px;overflow-x:auto;padding:4px 0 12px;position:sticky;top:0;background:var(--bg);z-index:2}',
    '.c-tabs button{flex:0 0 auto;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;padding:8px 14px;font:600 .85rem system-ui,sans-serif;cursor:pointer}',
    '.c-tabs button.on{background:var(--acc);border-color:var(--acc);color:var(--bg)}',
    '.c-menu{display:none}.c-menu.on{display:block}.c-menu h2{font-size:1.3rem;margin:8px 0 2px}',
    '.c-hor{color:var(--mut);font:.8rem system-ui,sans-serif;margin-bottom:10px}',
    '.c-cat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:6px 16px 10px;margin:14px 0}',
    '.c-cat h3{margin:10px 0 4px;font-size:1rem;text-transform:uppercase;letter-spacing:.12em;color:var(--acc)}',
    '.c-it{display:flex;gap:12px;align-items:baseline;padding:9px 0;border-bottom:1px dashed var(--line)}.c-it:last-child{border-bottom:0}',
    '.c-it .n{flex:1;font-weight:600}.c-it .d{display:block;font-weight:400;color:var(--mut);font-size:.88rem;margin-top:2px}',
    '.c-it .p{white-space:nowrap;font-family:system-ui,sans-serif;font-weight:700}',
    '.c-vars{display:block;margin-top:6px;font-weight:400}.c-var{display:flex;gap:10px;justify-content:space-between;font-family:system-ui,sans-serif;font-size:.88rem;padding:2px 0 2px 12px;border-left:2px solid var(--line)}',
    '.c-var b{white-space:nowrap}',
    '.c-foot{text-align:center;color:var(--mut);font:.8rem system-ui,sans-serif;margin-top:24px}',
    '.c-foot a{color:var(--acc)}'
  ].join('\n');

  function cartaBody(cfg, items, opts){
    opts = opts || {};
    var visibles = items.filter(function(i){ return i.disponible !== false && i.enCarta !== false; });
    var actual = menuActual(cfg);
    var menus = cfg.menus || [];
    var h = '<div class="c-wrap"><div class="c-head"><h1>' + esc(cfg.nombre) + '</h1>';
    var sub = [cfg.direccion, cfg.telefono].filter(Boolean).map(esc).join(' · ');
    if (sub) h += '<p>' + sub + '</p>';
    h += '</div><div class="c-tabs">';
    menus.forEach(function(m){
      h += '<button data-m="' + esc(m.id) + '"' + (actual && actual.id === m.id ? ' class="on"' : '') + '>' + esc(m.nombre) + '</button>';
    });
    h += '</div>';
    menus.forEach(function(m){
      var its = visibles.filter(function(i){ return enMenu(i, m.id); });
      h += '<section class="c-menu' + (actual && actual.id === m.id ? ' on' : '') + '" data-m="' + esc(m.id) + '"><h2>' + esc(m.nombre) + '</h2><div class="c-hor">' + esc(diasTxt(m)) + '</div>';
      if (!its.length) h += '<p class="c-hor">Sin platillos cargados todavía.</p>';
      porCategoria(its).forEach(function(g){
        h += '<div class="c-cat"><h3>' + esc(g.categoria) + '</h3>';
        g.items.forEach(function(i){
          var vs = variantes(i);
          h += '<div class="c-it"><span class="n">' + esc(i.nombre) + (i.descripcion ? '<span class="d">' + esc(i.descripcion) + '</span>' : '') +
            (vs.length ? '<span class="c-vars">' + vs.map(function(v){ return '<span class="c-var"><span>' + esc(v.nombre) + '</span><b>' + money(v.precio) + '</b></span>'; }).join('') + '</span>' : '') +
            '</span><span class="p">' + (vs.length ? '' : money(i.precio)) + '</span></div>';
        });
        h += '</div>';
      });
      h += '</section>';
    });
    h += '<div class="c-foot">Precios en MXN, IVA incluido.' + (opts.linkPedidos ? '<br><a href="' + esc(opts.linkPedidos) + '">Ordenar en línea →</a>' : '') + '</div></div>';
    return h;
  }
  var CARTA_JS = "document.addEventListener('click',function(e){var b=e.target.closest('.c-tabs button');if(!b)return;var m=b.getAttribute('data-m');document.querySelectorAll('.c-tabs button').forEach(function(x){x.classList.toggle('on',x===b)});document.querySelectorAll('.c-menu').forEach(function(s){s.classList.toggle('on',s.getAttribute('data-m')===m)});window.scrollTo(0,0);});";

  // Archivo HTML autocontenido (sin Firebase) para subir a cualquier hosting
  // y apuntar el QR ahí.
  function cartaEstatica(cfg, items, opts){
    return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + esc(cfg.nombre) + ' — Menú</title><style>' + CARTA_CSS + '</style></head><body>' +
      cartaBody(cfg, items, opts) + '<script>' + CARTA_JS + '<\/script></body></html>';
  }

  window.Encino = {
    DIAS: DIAS, DEFAULT_CFG: DEFAULT_CFG, cfgFrom: cfgFrom, money: money, esc: esc, dkey: dkey, hm: hm,
    variantes: variantes, precioMin: precioMin, precioTxt: precioTxt, enMenu: enMenu, menuActual: menuActual, diasTxt: diasTxt, porCategoria: porCategoria,
    CARTA_CSS: CARTA_CSS, CARTA_JS: CARTA_JS, cartaBody: cartaBody, cartaEstatica: cartaEstatica
  };
})();
