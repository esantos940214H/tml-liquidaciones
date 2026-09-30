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
    // Orden de las categorías en carta, inicio, pedidos y mesas. Las que no
    // estén aquí van al final (alimentos antes que bebidas, alfabético).
    categorias: [],
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
    if (!Array.isArray(c.categorias)) c.categorias = [];
    // Fondo de temporada de la carta (documento aparte: la imagen pesa)
    var f = (docs || []).find(function(d){ return d.id === 'fondo'; });
    c.fondo = f && f.imagen ? { imagen: f.imagen, visibilidad: Number(f.visibilidad) || 35 } : null;
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
  // ── Entregas a domicilio ──────────────────────────────────────────────
  // Distancia en línea recta (km) entre dos puntos {lat, lng}
  function distanciaKm(a, b){
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function entregaCfg(cfg){
    var e = cfg.entrega || {};
    return { lat: e.lat != null ? Number(e.lat) : null, lng: e.lng != null ? Number(e.lng) : null, radioKm: Number(e.radioKm) || 4,
      prepMin: e.prepMin != null && e.prepMin !== '' ? Number(e.prepMin) : 20, avisoMin: e.avisoMin != null && e.avisoMin !== '' ? Number(e.avisoMin) : 25, minPorKm: e.minPorKm != null && e.minPorKm !== '' ? Number(e.minPorKm) : 4,
      orsKey: String(e.orsKey || '').trim(), limitePorCalle: e.limitePorCalle === true, // por defecto el límite es en línea recta (radio)
      ok: e.lat != null && e.lng != null && isFinite(Number(e.lat)) && isFinite(Number(e.lng)) };
  }
  // Distancia por calle con OpenRouteService (ruta en coche). Resuelve {km}
  // o falla (sin clave, sin internet, sin ruta) para usar la línea recta.
  function rutaCalle(cfg, destino){
    var e = entregaCfg(cfg);
    if (!e.orsKey || !e.ok) return Promise.reject(new Error('sin clave'));
    var q = '/v2/directions/driving-car?api_key=' + encodeURIComponent(e.orsKey) + '&start=' + e.lng + ',' + e.lat + '&end=' + destino.lng + ',' + destino.lat;
    // HeiGIT está cambiando api.openrouteservice.org por api.heigit.org:
    // se intenta la dirección nueva y, si falla, la anterior.
    var urls = ['https://api.heigit.org/openrouteservice' + q, 'https://api.openrouteservice.org' + q];
    function intentar(i, errPrevio){
      if (i >= urls.length) return Promise.reject(errPrevio || new Error('sin respuesta'));
      var ctl = window.AbortController ? new AbortController() : null, t = setTimeout(function(){ if (ctl) ctl.abort(); }, 7000);
      return fetch(urls[i], ctl ? { signal: ctl.signal } : {}).then(function(r){
        clearTimeout(t);
        return r.json().then(function(d){
          var s = d && d.features && d.features[0] && d.features[0].properties && d.features[0].properties.summary;
          if (!r.ok || !s || s.distance == null) throw new Error((d && d.error && (d.error.message || d.error)) || ('HTTP ' + r.status));
          return { km: s.distance / 1000, min: (s.duration || 0) / 60 };
        });
      }).catch(function(err){ clearTimeout(t); return intentar(i + 1, err); });
    }
    return intentar(0);
  }
  // Tiempo estimado: preparación + trayecto. Las calles no van en línea recta,
  // así que se considera 1.3 veces la distancia.
  function trayectoMin(cfg, km, porCalle){ var e = entregaCfg(cfg); return Math.round((km || 0) * (porCalle ? 1 : 1.3) * e.minPorKm); }
  function etaMin(cfg, km, porCalle){ return Math.round(entregaCfg(cfg).prepMin + trayectoMin(cfg, km, porCalle)); }
  // Hora aproximada de llegada del pedido a domicilio según su estado:
  // listo → +5 min en lo que sale el repartidor + trayecto; en camino → trayecto desde que salió.
  var SALIDA_MIN = 5;
  function llegadaAprox(cfg, p){
    var tr = p.trayectoMin != null ? p.trayectoMin : (p.distanciaKm != null ? trayectoMin(cfg, p.distanciaKm, p.porCalle) : null);
    if (tr == null) return null;
    if (p.estado === 'enCamino' && p.salioEn) return p.salioEn + tr * 60000;
    if (p.estado === 'listo' && p.listoEn) return p.listoEn + (SALIDA_MIN + tr) * 60000;
    return null;
  }
  // Pin del mapa sin imágenes externas
  function pinIcono(){ return window.L ? L.divIcon({ className: '', html: '<div style="font-size:32px;line-height:32px;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))">📍</div>', iconSize: [32, 32], iconAnchor: [16, 30] }) : null; }
  function etaTxt(min){ var a = Math.max(5, Math.round(min / 5) * 5); return a + '–' + (a + 10) + ' min'; }

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
  // Días abreviados para pestañas: "Vie", "Sáb y Dom", "Lun, Mié y Vie"
  var DIAS3 = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  function diasCorto(m){
    var d = (m.dias || []).slice().sort(function(a,b){ return ((a+6)%7) - ((b+6)%7); }).map(function(x){ return DIAS3[x]; });
    return d.length > 1 ? d.slice(0, -1).join(', ') + ' y ' + d[d.length - 1] : (d[0] || '');
  }
  // Nombre completo para administración: "Desayunos — Viernes · 08:00–13:00"
  function menuEtiqueta(m){ var t = diasTxt(m); return m.nombre + (t ? ' — ' + t : ''); }
  // Agrupa platillos por categoría manteniendo alimentos antes que bebidas.
  // Las categorías se manejan siempre en MAYÚSCULAS
  function catDe(it){ return String(it.categoria || (it.tipo === 'bebida' ? 'Bebidas' : 'Platillos')).toUpperCase(); }
  // Comparador: primero por el orden de categorías configurado, luego las no
  // listadas (alimentos antes que bebidas, alfabético) y al final por nombre.
  function cmpCat(orden){
    var ix = {};
    (orden || []).forEach(function(c, k){ ix[String(c).toLowerCase()] = k; });
    function llave(it){
      var c = catDe(it), k = ix[c.toLowerCase()];
      return k != null ? [0, k, ''] : [it.esPaquete ? 2 : 1, it.tipo === 'bebida' ? 1 : 0, c.toLowerCase()];
    }
    return function(a, b){
      var x = llave(a), y = llave(b);
      for (var i = 0; i < 3; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; }
      return (a.nombre || '').localeCompare(b.nombre || '', 'es');
    };
  }
  function porCategoria(items, ordenCategorias){
    var g = {}, orden = [];
    items.slice().sort(cmpCat(ordenCategorias)).forEach(function(it){
      var k = catDe(it);
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
    '.c-wrap{max-width:720px;margin:0 auto;padding:24px 16px 48px;position:relative;z-index:1}',
    '.c-fondo{position:fixed;inset:-40px;z-index:0;background-size:cover;background-position:center;filter:blur(7px);pointer-events:none}',
    '.c-fondo~.c-wrap h1,.c-fondo~.c-wrap .c-head p,.c-fondo~.c-wrap h2,.c-fondo~.c-wrap .c-hor,.c-fondo~.c-wrap .c-foot{text-shadow:0 0 6px var(--bg),0 0 2px var(--bg)}',
    '.c-head{text-align:center;margin-bottom:18px}.c-head h1{margin:0;font-size:2rem;letter-spacing:.04em;color:var(--acc)}',
    '.c-head p{margin:4px 0 0;color:var(--mut);font-family:system-ui,sans-serif;font-size:.85rem}',
    '.c-tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;padding:6px 0 12px}',
    '.c-tabs button{line-height:1.25;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;padding:8px 14px;font:600 .85rem system-ui,sans-serif;cursor:pointer}',
    '.c-tabs button.on{background:var(--acc);border-color:var(--acc);color:var(--bg)}',
    '.c-menu{display:none}.c-menu.on{display:block}',
    // Una sola hoja por menú; dentro, secciones (DESAYUNOS, BEBIDAS, POSTRES…)
    '.c-hoja{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 20px 10px;margin-top:4px}',
    '.c-hoja>h2{font-size:1.45rem;margin:0;text-align:center}.c-hoja>.c-hor{text-align:center}',
    '.c-hor{color:var(--mut);font:.8rem system-ui,sans-serif;margin-bottom:10px}',
    '.c-cat{margin:24px 0 8px}',
    '.c-cat h3{display:flex;align-items:center;gap:14px;margin:0 0 6px;font-size:1.05rem;text-transform:uppercase;letter-spacing:.18em;color:var(--acc);text-align:center}',
    '.c-cat h3::before,.c-cat h3::after{content:"";flex:1;height:1px;background:var(--line)}',
    '.c-it{display:flex;gap:12px;align-items:baseline;padding:9px 0;border-bottom:1px dashed var(--line)}.c-it:last-child{border-bottom:0}',
    '.c-it .n{flex:1;font-weight:600}.c-it .d{display:block;font-weight:400;color:var(--mut);font-size:.88rem;margin-top:2px}',
    '.c-it .p{white-space:nowrap;font-family:system-ui,sans-serif;font-weight:700}',
    '.c-vars{display:block;margin-top:6px;font-weight:400}.c-var{display:flex;gap:10px;justify-content:space-between;font-family:system-ui,sans-serif;font-size:.88rem;padding:2px 0 2px 12px;border-left:2px solid var(--line)}',
    '.c-var b{white-space:nowrap}',
    '.c-paq{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:10px 0;margin:14px 0 0;font-family:system-ui,sans-serif}',
    '.c-paq b{font-family:Georgia,serif;font-size:1.05rem;color:var(--acc)}.c-paq .pp{float:right;font-weight:700}.c-paq .d{color:var(--mut);font-size:.88rem;margin-top:2px}',
    '.c-foot{text-align:center;color:var(--mut);font:.8rem system-ui,sans-serif;margin-top:24px}',
    '.c-foot a{color:var(--acc)}',
    '.c-dias{display:block;font-weight:400;font-size:.75rem;opacity:.8}',
    '.c-tabs button.ahora .c-dias::after{content:" · ahora"}',
    '.c-elige{background:var(--card);border:2px solid var(--acc);border-radius:14px;padding:12px 16px;margin:4px 0 12px;font-family:system-ui,sans-serif;text-align:center}',
    '.c-elige p{margin:0 0 10px}.c-elige .ops{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}',
    '.c-elige button{flex:1 1 140px;border:0;border-radius:10px;padding:12px;background:var(--acc);color:var(--bg);font:700 1rem system-ui,sans-serif;cursor:pointer}'
  ].join('\n');

  function cartaBody(cfg, items, opts){
    opts = opts || {};
    var visibles = items.filter(function(i){ return i.disponible !== false && i.enCarta !== false; });
    var actual = menuActual(cfg);
    var menus = cfg.menus || [];
    var h = '';
    // Imagen difuminada de fondo; solo se aceptan imágenes guardadas por el sistema (data:image)
    if (cfg.fondo && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(cfg.fondo.imagen)) {
      h += '<div class="c-fondo" style="background-image:url(\'' + cfg.fondo.imagen + '\');opacity:' + Math.min(0.9, Math.max(0.05, cfg.fondo.visibilidad / 100)) + '"></div>';
    }
    h += '<div class="c-wrap"><div class="c-head"><h1>' + esc(cfg.nombre) + '</h1>';
    var sub = [cfg.direccion, cfg.telefono].filter(Boolean).map(esc).join(' · ');
    if (sub) h += '<p>' + sub + '</p>';
    h += '</div><div class="c-tabs">';
    menus.forEach(function(m){
      h += '<button data-m="' + esc(m.id) + '" data-dias="' + esc((m.dias || []).join(',')) + '" data-desde="' + esc(m.desde || '') + '" data-hasta="' + esc(m.hasta || '') + '" data-corto="' + esc(nombreCorto(m)) + '"' +
        (actual && actual.id === m.id ? ' class="on"' : '') + '>' + esc(m.nombre) + (diasCorto(m) ? '<small class="c-dias">' + esc(diasCorto(m)) + '</small>' : '') + '</button>';
    });
    h += '</div><div class="c-elige" id="cElige" hidden><p>Son las <b class="hora"></b> y estamos sirviendo dos menús. ¿Vienes a…?</p><div class="ops"></div></div>';
    menus.forEach(function(m){
      // Los paquetes van en su categoría (ej. PAQUETES), en el lugar que le
      // toque según el orden de categorías; si no está en ese orden, al final.
      var its = visibles.filter(function(i){ return enMenu(i, m.id); });
      h += '<section class="c-menu' + (actual && actual.id === m.id ? ' on' : '') + '" data-m="' + esc(m.id) + '"><div class="c-hoja"><h2>' + esc(m.nombre) + '</h2><div class="c-hor">' + esc(diasTxt(m)) + '</div>';
      if (!its.some(function(i){ return !i.esPaquete; })) h += '<p class="c-hor">Sin platillos cargados todavía.</p>';
      porCategoria(its, cfg.categorias).forEach(function(g){
        h += '<div class="c-cat"><h3>' + esc(g.categoria) + '</h3>';
        g.items.forEach(function(i){
          if (i.esPaquete) {
            var op = opcionesPaquete(i);
            h += '<div class="c-paq"><span class="pp">+' + precioTxt(i) + '</span><b>' + esc(i.nombre) + '</b><div class="d">' + esc(i.descripcion || '') + (op ? (i.descripcion ? '. ' : '') + 'Elige: ' + esc(op) + '.' : (i.descripcion && !/[.!?]$/.test(i.descripcion.trim()) ? '.' : '')) + ' Aplica en cualquier platillo de este menú.</div></div>';
            return;
          }
          var vs = variantes(i);
          h += '<div class="c-it"><span class="n">' + esc(i.nombre) + (i.descripcion ? '<span class="d">' + esc(i.descripcion) + '</span>' : '') +
            (vs.length ? '<span class="c-vars">' + vs.map(function(v){ return '<span class="c-var"><span>' + esc(v.nombre) + '</span><b>' + money(v.precio) + '</b></span>'; }).join('') + '</span>' : '') +
            '</span><span class="p">' + (vs.length ? '' : money(i.precio)) + '</span></div>';
        });
        h += '</div>';
      });
      h += '</div></section>';
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
    variantes: variantes, paquetesPara: paquetesPara, opcionesPaquete: opcionesPaquete, precioMin: precioMin, precioTxt: precioTxt, enMenu: enMenu, menuActual: menuActual, menusActivos: menusActivos, nombreCorto: nombreCorto, distanciaKm: distanciaKm, entregaCfg: entregaCfg, etaMin: etaMin, etaTxt: etaTxt, trayectoMin: trayectoMin, llegadaAprox: llegadaAprox, rutaCalle: rutaCalle, pinIcono: pinIcono, diasTxt: diasTxt, diasCorto: diasCorto, menuEtiqueta: menuEtiqueta, porCategoria: porCategoria, cmpCat: cmpCat, catDe: catDe,
    CARTA_CSS: CARTA_CSS, CARTA_JS: CARTA_JS, cartaBody: cartaBody, cartaEstatica: cartaEstatica
  };
})();
