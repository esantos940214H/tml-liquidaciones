// ══════════════════════════════════════════════════════════════════════════
// shared/autoActualizar.js
//
// Avisa cuando hay una versión más nueva del sitio desplegada, para que una
// pestaña que lleva mucho tiempo abierta (horas, días, semanas) no se quede
// corriendo código viejo sin que nadie se dé cuenta. Un caso real: una
// pestaña de Liquidaciones abierta más de una semana siguió "guardando"
// datos viejos de una liquidación que ya se había cerrado/corregido en otro
// lado, porque no tenía forma de saber que el sitio había cambiado —
// terminó resucitando una liquidación ya cerrada con datos incorrectos.
//
// CÓMO FUNCIONA
// build.sh genera un archivo version.json (con un identificador nuevo en
// cada despliegue) junto al index.html de cada sitio. Esta pestaña guarda
// qué versión traía al cargar, y cada cierto tiempo vuelve a leer
// version.json (sin caché) para comparar. Si cambió, muestra un aviso fijo
// para que la persona actualice cuando le convenga — NO recarga solo de
// golpe, para no perder algo que esté escribiendo a media captura.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var INTERVALO_MS = 10 * 60 * 1000; // revisar cada 10 minutos
  var _versionInicial = null;

  function leerVersion(cb) {
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { cb(d && d.v ? d.v : null); })
      .catch(function () { cb(null); });
  }

  function mostrarAviso() {
    if (document.getElementById('tmlAvisoActualizar')) return;
    var css = document.createElement('style');
    css.textContent =
      '#tmlAvisoActualizar{position:fixed;bottom:16px;right:16px;background:#1a1a2e;color:#fff;padding:12px 16px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);z-index:999998;font-size:13px;display:flex;align-items:center;gap:10px;font-family:inherit;max-width:320px}' +
      '#tmlAvisoActualizar button{background:#e63946;color:#fff;border:none;border-radius:6px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}' +
      '#tmlAvisoActualizar button:hover{background:#c1121f}';
    document.head.appendChild(css);
    var div = document.createElement('div');
    div.id = 'tmlAvisoActualizar';
    div.innerHTML = '<span>🔄 Hay una versión nueva del sistema. Guarda lo que estés haciendo y actualiza.</span><button id="tmlBtnActualizar">Actualizar</button>';
    document.body.appendChild(div);
    document.getElementById('tmlBtnActualizar').onclick = function () { location.reload(); };
  }

  leerVersion(function (v) {
    _versionInicial = v;
    if (!_versionInicial) return; // sin version.json en este sitio — no se revisa
    setInterval(function () {
      leerVersion(function (vNueva) {
        if (vNueva && _versionInicial && vNueva !== _versionInicial) mostrarAviso();
      });
    }, INTERVALO_MS);
  });
})();
