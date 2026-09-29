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
      { id: 'vie-des', nombre: 'Viernes · Desayunos', dias: [5], desde: '08:00', hasta: '13:00' },
      { id: 'vie-com', nombre: 'Viernes · Comidas', dias: [5], desde: '12:30', hasta: '18:00' },
      { id: 'fds-des', nombre: 'Sábado y Domingo · Desayunos', dias: [6, 0], desde: '08:00', hasta: '13:00' },
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
  // Precio a mostrar junto al nombre: el de la primera variante capturada
  // (ej. "Solos"), no un "desde $X".
  function precioTxt(item){
    var vs = variantes(item);
    return money(vs.length ? vs[0].precio : item.precio);
  }

  // Paquetes / complementos (ej. "Agranda tu paquete +$50: café, pan y jugo
  // o fruta"). Son platillos marcados esPaquete: no se venden solos, se
  // agregan a cualquier alimento que comparta menú con el paquete (salvo
  // los platillos marcados sinPaquete).
  function compartenMenu(a, b){
    var ma = Array.isArray(a.menus) ? a.menus : [], mb = Array.isArray(b.menus) ? b.menus : [];
    if (!ma.length || !mb.length) return true;
    return ma.some(function(x){ return mb.indexOf(x) >= 0; });
  }
  function paquetesPara(item, menu){
    if (!item || item.tipo === 'bebida' || item.esPaquete || item.sinPaquete) return [];
    return (menu || []).filter(function(p){ return p.esPaquete && p.disponible !== false && compartenMenu(p, item); });
  }
  // Texto de opciones del paquete para carta/inicio: si tiene descripción
  // (ej. "Jugo o fruta, café o té y pan") basta con ella; si no, se listan
  // las variantes.
  function opcionesPaquete(p){ var vs = variantes(p); return !p.descripcion && vs.length ? vs.map(function(v){ return v.nombre; }).join(' o ') : ''; }

  // ¿En qué menús aparece el platillo? (vacío = en todos)
  function enMenu(item, menuId){
    var ms = Array.isArray(item.menus) ? item.menus : [];
    return !menuId || !ms.length || ms.indexOf(menuId) >= 0;
  }
  // Menús en horario en este momento. Puede haber más de uno cuando los
  // horarios se enciman (ej. desayunos hasta 13:00 y comidas desde 12:30):
  // en esa ventana el cliente elige qué menú ver.
  function menusActivos(cfg, date){
    date = date || new Date();
    var t = hm(date), dow = date.getDay();
    return (cfg.menus || []).filter(function(m){ return (m.dias || []).indexOf(dow) >= 0 && (!m.desde || t >= m.desde) && (!m.hasta || t < m.hasta); });
  }
  // Nombre corto para botones: "Viernes · Desayunos" → "Desayunos"
  function nombreCorto(m){ var p = String(m.nombre || '').split('·'); return p[p.length - 1].trim() || m.nombre; }
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
    '.c-tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;padding:6px 0 12px}',
    '.c-tabs button{line-height:1.25;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;padding:8px 14px;font:600 .85rem system-ui,sans-serif;cursor:pointer}',
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
    '.c-paq{border:2px dashed var(--acc);border-radius:14px;padding:10px 16px;margin:12px 0;font-family:system-ui,sans-serif}',
    '.c-paq b{font-family:Georgia,serif;font-size:1.05rem;color:var(--acc)}.c-paq .pp{float:right;font-weight:700}.c-paq .d{color:var(--mut);font-size:.88rem;margin-top:2px}',
    '.c-foot{text-align:center;color:var(--mut);font:.8rem system-ui,sans-serif;margin-top:24px}',
    '.c-foot a{color:var(--acc)}',
    '.c-tabs button.ahora::after{content:" · ahora";font-weight:400;opacity:.8}',
    '.c-elige{background:var(--card);border:2px solid var(--acc);border-radius:14px;padding:12px 16px;margin:4px 0 12px;font-family:system-ui,sans-serif;text-align:center}',
    '.c-elige p{margin:0 0 10px}.c-elige .ops{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}',
    '.c-elige button{flex:1 1 140px;border:0;border-radius:10px;padding:12px;background:var(--acc);color:var(--bg);font:700 1rem system-ui,sans-serif;cursor:pointer}'
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
      h += '<button data-m="' + esc(m.id) + '" data-dias="' + esc((m.dias || []).join(',')) + '" data-desde="' + esc(m.desde || '') + '" data-hasta="' + esc(m.hasta || '') + '" data-corto="' + esc(nombreCorto(m)) + '"' +
        (actual && actual.id === m.id ? ' class="on"' : '') + '>' + esc(m.nombre) + '</button>';
    });
    h += '</div><div class="c-elige" id="cElige" hidden><p>Son las <b class="hora"></b> y estamos sirviendo dos menús. ¿Vienes a…?</p><div class="ops"></div></div>';
    menus.forEach(function(m){
      var its = visibles.filter(function(i){ return enMenu(i, m.id) && !i.esPaquete; });
      var paqs = visibles.filter(function(i){ return i.esPaquete && enMenu(i, m.id); });
      h += '<section class="c-menu' + (actual && actual.id === m.id ? ' on' : '') + '" data-m="' + esc(m.id) + '"><h2>' + esc(m.nombre) + '</h2><div class="c-hor">' + esc(diasTxt(m)) + '</div>';
      if (!its.length) h += '<p class="c-hor">Sin platillos cargados todavía.</p>';
      paqs.forEach(function(p){
        var op = opcionesPaquete(p);
        h += '<div class="c-paq"><span class="pp">+' + precioTxt(p) + '</span><b>' + esc(p.nombre) + '</b><div class="d">' + esc(p.descripcion || '') + (op ? (p.descripcion ? '. ' : '') + 'Elige: ' + esc(op) + '.' : '') + ' Aplica en cualquier platillo de este menú.</div></div>';
      });
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
  // Se ejecuta en el celular del cliente (carta en vivo y carta estática):
  // según el día y la hora del celular elige el menú; si hay dos menús en
  // horario (ventana de cambio) pregunta cuál quiere ver. window.cartaAuto()
  // se vuelve a llamar cada vez que la carta en vivo se redibuja.
  function cartaRuntime(){
    function hm(d){ return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
    function sel(m){
      document.querySelectorAll('.c-tabs button').forEach(function(x){ x.classList.toggle('on', x.getAttribute('data-m') === m); });
      document.querySelectorAll('.c-menu').forEach(function(s){ s.classList.toggle('on', s.getAttribute('data-m') === m); });
    }
    window.cartaElegida = null;
    window.cartaAuto = function(){
      var d = new Date(), t = hm(d), dow = d.getDay(), act = [];
      document.querySelectorAll('.c-tabs button').forEach(function(b){
        var dias = (b.getAttribute('data-dias') || '').split(',').filter(function(x){ return x !== ''; }).map(Number);
        var de = b.getAttribute('data-desde') || '', ha = b.getAttribute('data-hasta') || '';
        var on = dias.indexOf(dow) >= 0 && (!de || t >= de) && (!ha || t < ha);
        b.classList.toggle('ahora', on);
        if (on) act.push(b);
      });
      var el = document.getElementById('cElige');
      if (window.cartaElegida) { sel(window.cartaElegida); if (el) el.hidden = true; return; }
      if (act.length) sel(act[0].getAttribute('data-m'));
      if (!el) return;
      if (act.length > 1) {
        el.querySelector('.hora').textContent = t;
        var ops = el.querySelector('.ops'); ops.innerHTML = '';
        act.forEach(function(b){ var x = document.createElement('button'); x.setAttribute('data-m', b.getAttribute('data-m')); x.textContent = b.getAttribute('data-corto'); ops.appendChild(x); });
        el.hidden = false;
      } else el.hidden = true;
    };
    document.addEventListener('click', function(e){
      var b = e.target.closest('.c-tabs button, .c-elige button'); if (!b) return;
      window.cartaElegida = b.getAttribute('data-m'); sel(window.cartaElegida);
      var el = document.getElementById('cElige'); if (el) el.hidden = true;
      window.scrollTo(0, 0);
    });
    window.cartaAuto();
    setInterval(function(){ if (!window.cartaElegida) window.cartaAuto(); }, 60000);
  }
  var CARTA_JS = '(' + cartaRuntime.toString() + ')();';

  // Archivo HTML autocontenido (sin Firebase) para subir a cualquier hosting
  // y apuntar el QR ahí.
  function cartaEstatica(cfg, items, opts){
    return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + esc(cfg.nombre) + ' — Menú</title><style>' + CARTA_CSS + '</style></head><body>' +
      cartaBody(cfg, items, opts) + '<script>' + CARTA_JS + '<\/script></body></html>';
  }

  window.Encino = {
    DIAS: DIAS, DEFAULT_CFG: DEFAULT_CFG, cfgFrom: cfgFrom, money: money, esc: esc, dkey: dkey, hm: hm,
    variantes: variantes, paquetesPara: paquetesPara, opcionesPaquete: opcionesPaquete, precioMin: precioMin, precioTxt: precioTxt, enMenu: enMenu, menuActual: menuActual, menusActivos: menusActivos, nombreCorto: nombreCorto, diasTxt: diasTxt, porCategoria: porCategoria,
    CARTA_CSS: CARTA_CSS, CARTA_JS: CARTA_JS, cartaBody: cartaBody, cartaEstatica: cartaEstatica
  };
})();
