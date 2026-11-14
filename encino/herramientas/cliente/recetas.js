// Interactividad de la página de receta: porciones, casillas, cronómetros,
// modo cocina, compartir e imprimir. La página ya trae todo el contenido en
// el HTML; si este script falla, la receta se sigue leyendo completa.
// (El build antepone escala.js, que define window.EncinoEscala.)
(function () {
  'use strict';
  var art = document.querySelector('.receta');
  if (!art) return;
  var Esc = window.EncinoEscala;
  var slug = art.getAttribute('data-slug');
  var base = Number(art.getAttribute('data-porciones')) || 1;
  var $ = function (id) { return document.getElementById(id); };
  var qsa = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  // ── Guardado local (opcional: si el navegador no deja, todo sigue funcionando)
  var CLAVE = 'encino-receta:' + slug, CLAVE_CR = 'encino-cronos:' + slug;
  function lee(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function guarda(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }
  var estado = lee(CLAVE) || {};

  function aviso(txt, ms) {
    var el = $('aviso'); if (!el) return;
    el.textContent = txt; el.hidden = false;
    clearTimeout(aviso.t); aviso.t = setTimeout(function () { el.hidden = true; }, ms || 2500);
  }

  // ── Porciones ───────────────────────────────────────────────────────────
  var porciones = Number(estado.porciones) || base;
  function pintaPorciones() {
    var f = porciones / base;
    qsa('.porc-num').forEach(function (el) { el.textContent = porciones; });
    qsa('.ings .q').forEach(function (el) {
      var c = el.getAttribute('data-cant');
      if (c !== '') el.textContent = Esc.cantidadTxt(Number(c), el.getAttribute('data-uni') || null, f);
    });
    qsa('.paso-txt .ing').forEach(function (el) {
      var c = el.getAttribute('data-cant');
      el.textContent = Esc.ingredienteTxt({ cantidad: c === '' ? null : Number(c), unidad: el.getAttribute('data-uni') || null, nombre: el.getAttribute('data-nombre') }, f);
    });
    var menos = document.querySelector('.porciones .menos');
    if (menos) menos.disabled = porciones <= 1;
    if (!cocina.hidden) pintaCocina();
  }
  function cambia(d) {
    porciones = Math.max(1, Math.min(60, porciones + d));
    estado.porciones = porciones; guarda(CLAVE, estado);
    pintaPorciones();
  }
  var bMenos = document.querySelector('.porciones .menos'), bMas = document.querySelector('.porciones .mas');
  if (bMenos) bMenos.addEventListener('click', function () { cambia(-1); });
  if (bMas) bMas.addEventListener('click', function () { cambia(1); });

  // ── Casillas de ingredientes ────────────────────────────────────────────
  var marcados = Array.isArray(estado.marcados) ? estado.marcados : [];
  qsa('.ings input[type=checkbox]').forEach(function (cb) {
    var id = cb.getAttribute('data-id');
    cb.checked = marcados.indexOf(id) >= 0;
    cb.addEventListener('change', function () {
      marcados = qsa('.ings input:checked').map(function (x) { return x.getAttribute('data-id'); });
      estado.marcados = marcados; guarda(CLAVE, estado);
    });
  });

  // ── Cronómetros ─────────────────────────────────────────────────────────
  // Cada cronómetro guarda la HORA DE FIN, no un contador: así sigue bien
  // aunque el celular bloquee la pantalla o se cambie de app.
  var cronos = (lee(CLAVE_CR) || []).filter(function (c) { return c && c.id && c.dur; });
  var barra = $('cronos');
  var audio = null;
  function reloj(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  }
  function restante(c) { return c.fin ? c.fin - Date.now() : c.resta; }
  function guardaCronos() { guarda(CLAVE_CR, cronos); }
  function desbloqueaAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) { audio = null; }
  }
  function suena() {
    try {
      if (!audio) return;
      var t = audio.currentTime;
      for (var i = 0; i < 6; i++) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine'; o.frequency.value = i % 2 ? 660 : 880;
        g.gain.setValueAtTime(0.0001, t + i * 0.35);
        g.gain.exponentialRampToValueAtTime(0.5, t + i * 0.35 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.35 + 0.3);
        o.connect(g); g.connect(audio.destination);
        o.start(t + i * 0.35); o.stop(t + i * 0.35 + 0.32);
      }
    } catch (e) { /* sin sonido */ }
  }
  function termina(c) {
    c.avisado = true; guardaCronos();
    suena();
    try { if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]); } catch (e) { }
    aviso('⏰ ¡Listo! ' + c.nombre, 6000);
  }
  function iniciar(nombre, seg) {
    desbloqueaAudio();
    var existe = cronos.filter(function (c) { return c.nombre === nombre && c.dur === seg * 1000; })[0];
    if (existe) { existe.fin = Date.now() + existe.dur; existe.resta = null; existe.avisado = false; }
    else cronos.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), nombre: nombre, dur: seg * 1000, fin: Date.now() + seg * 1000, resta: null, avisado: false });
    guardaCronos(); pintaCronos();
  }
  function accion(id, que) {
    desbloqueaAudio();
    var c = cronos.filter(function (x) { return x.id === id; })[0]; if (!c) return;
    if (que === 'pausa' && c.fin) { c.resta = Math.max(0, c.fin - Date.now()); c.fin = null; }
    else if (que === 'sigue' && !c.fin) { c.fin = Date.now() + c.resta; c.resta = null; }
    else if (que === 'reinicia') { c.fin = Date.now() + c.dur; c.resta = null; c.avisado = false; }
    else if (que === 'quita') cronos = cronos.filter(function (x) { return x.id !== id; });
    guardaCronos(); pintaCronos();
  }
  function pintaCronos() {
    if (!barra) return;
    barra.hidden = !cronos.length;
    document.body.classList.toggle('con-cronos', !!cronos.length);
    barra.innerHTML = cronos.map(function (c) {
      var r = restante(c), fin = r <= 0, pausa = !c.fin;
      return '<div class="cr' + (fin ? ' fin' : pausa ? ' pausa' : '') + '" data-id="' + c.id + '">' +
        '<span class="cr-n"></span><span class="cr-t">' + (fin ? '¡Listo!' : reloj(r)) + '</span>' +
        (fin ? '' : '<button type="button" data-a="' + (pausa ? 'sigue' : 'pausa') + '" aria-label="' + (pausa ? 'Reanudar' : 'Pausar') + '">' + (pausa ? '▶' : '❚❚') + '</button>') +
        '<button type="button" data-a="reinicia" aria-label="Reiniciar">↺</button><button type="button" data-a="quita" aria-label="Quitar">✕</button></div>';
    }).join('');
    qsa('.cr', barra).forEach(function (el, i) { el.querySelector('.cr-n').textContent = cronos[i].nombre; });
    document.documentElement.style.setProperty('--alto-cronos', barra.offsetHeight + 'px');
  }
  function tic() {
    var cambio = false;
    cronos.forEach(function (c) {
      if (c.fin && c.fin - Date.now() <= 0 && !c.avisado) { termina(c); cambio = true; }
    });
    if (!barra || !cronos.length) return;
    if (cambio) return pintaCronos();
    qsa('.cr', barra).forEach(function (el, i) {
      var c = cronos[i]; if (!c) return;
      var r = restante(c);
      if (r <= 0 && !el.classList.contains('fin')) return pintaCronos();
      if (r > 0) el.querySelector('.cr-t').textContent = reloj(r);
    });
    var vencidos = cronos.filter(function (c) { return c.fin && restante(c) <= 0; }).length;
    document.title = vencidos ? '⏰ ¡Listo! · ' + titulo : titulo;
  }
  var titulo = document.title;
  if (barra) barra.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-a]'); if (!b) return;
    accion(b.closest('.cr').getAttribute('data-id'), b.getAttribute('data-a'));
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.crono'); if (!b) return;
    iniciar(b.getAttribute('data-nombre'), Number(b.getAttribute('data-seg')));
    aviso('⏱ Cronómetro iniciado: ' + b.getAttribute('data-nombre'));
  });
  // Al volver a la página (pantalla desbloqueada / regreso de otra app)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    desbloqueaAudio(); tic(); pidePantalla();
  });
  setInterval(tic, 250);
  pintaCronos();

  // ── Modo cocina ─────────────────────────────────────────────────────────
  var cocina = $('cocina'), pasos = qsa('.pasos .paso'), actual = 0, bloqueo = null;
  function pidePantalla() {
    if (cocina.hidden || bloqueo || !('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (l) {
      bloqueo = l; l.addEventListener('release', function () { bloqueo = null; });
    }).catch(function () { /* el navegador no lo permitió */ });
  }
  function pintaCocina() {
    var p = pasos[actual]; if (!p) return;
    $('cocinaN').textContent = 'Paso ' + (actual + 1) + ' de ' + pasos.length;
    $('cocinaTit').textContent = p.querySelector('.paso-tit').textContent;
    $('cocinaTxt').innerHTML = p.querySelector('.paso-txt').innerHTML;
    var cr = p.querySelector('.crono');
    $('cocinaCrono').innerHTML = cr ? cr.outerHTML : '';
    $('cocinaAnt').disabled = actual === 0;
    $('cocinaSig').textContent = actual === pasos.length - 1 ? 'Terminar ✓' : 'Siguiente →';
  }
  function abreCocina() {
    if (!pasos.length) return;
    desbloqueaAudio();
    cocina.hidden = false; document.body.style.overflow = 'hidden';
    pintaCocina(); pidePantalla();
    $('cocinaSig').focus();
  }
  function cierraCocina() {
    cocina.hidden = true; document.body.style.overflow = '';
    if (bloqueo) { bloqueo.release().catch(function () { }); bloqueo = null; }
    var p = pasos[actual]; if (p) p.scrollIntoView({ block: 'center' });
    $('modoCocina').focus();
  }
  $('modoCocina').addEventListener('click', abreCocina);
  $('cocinaCerrar').addEventListener('click', cierraCocina);
  $('cocinaAnt').addEventListener('click', function () { if (actual > 0) { actual--; pintaCocina(); } });
  $('cocinaSig').addEventListener('click', function () { if (actual < pasos.length - 1) { actual++; pintaCocina(); } else cierraCocina(); });
  document.addEventListener('keydown', function (e) {
    if (cocina.hidden) return;
    if (e.key === 'Escape') cierraCocina();
    else if (e.key === 'ArrowRight') $('cocinaSig').click();
    else if (e.key === 'ArrowLeft' && actual > 0) $('cocinaAnt').click();
  });
  // Deslizar a los lados para cambiar de paso
  var x0 = null;
  cocina.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  cocina.addEventListener('touchend', function (e) {
    if (x0 == null) return;
    var dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) < 60) return;
    if (dx < 0 && actual < pasos.length - 1) { actual++; pintaCocina(); }
    else if (dx > 0 && actual > 0) { actual--; pintaCocina(); }
  }, { passive: true });

  // ── Compartir e imprimir ───────────────────────────────────────────────
  var canon = (document.querySelector('link[rel=canonical]') || {}).href || location.href;
  $('compartir').addEventListener('click', function () {
    var datos = { title: document.querySelector('h1').textContent, text: (document.querySelector('meta[name=description]') || {}).content || '', url: canon };
    if (navigator.share) { navigator.share(datos).catch(function () { }); return; }
    copia(canon);
  });
  function copia(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { aviso('Enlace copiado'); }, function () { window.prompt('Copia el enlace:', txt); });
    } else window.prompt('Copia el enlace:', txt);
  }
  $('imprimir').addEventListener('click', function () { window.print(); });

  pintaPorciones();
})();
