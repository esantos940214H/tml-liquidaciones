// ══════════════════════════════════════════════════════════════════════════
// shared/sesion.js
// Base de autenticación con Firebase Authentication (Email/Contraseña).
//
// FASE 1 de la migración de login: hoy el sistema usa un login propio
// (usuario + contraseña con hash SHA-256 guardado en Firestore, colección
// "usuarios") y comparte la sesión entre subdominios (anticipos, ingresos,
// liquidaciones, historial, incidentes, ...) con una cookie de dominio
// "tml_user" (domain=.mudanzastml.mx). Ese login SHA-256 sigue funcionando
// tal cual en todos esos módulos — este archivo NO lo reemplaza todavía,
// solo agrega la base de Firebase Auth para poder migrar módulo por módulo
// más adelante.
//
// CÓMO USAR ESTE ARCHIVO
// En el <head> o antes del cierre de <body> de la página que lo use, cargar
// PRIMERO el SDK de Firebase (compat) y LUEGO este archivo:
//
//   <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
//   <script src="shared/sesion.js"></script>
//
// Si la misma página también usa Firestore (window.FB, patrón ya existente
// en todo el proyecto), agregar además firebase-firestore-compat.js — este
// archivo no lo requiere para sí mismo, solo para Auth.
//
// PATRÓN onFBReady (mismo criterio que ya usa el proyecto para Firestore):
// este archivo expone window.onAuthReady(cb) — si Firebase Auth ya terminó
// de resolver el estado inicial de sesión, ejecuta cb() de inmediato; si no,
// encola cb() hasta que esperarSesion() resuelva por primera vez. Así, un
// módulo que cargue este script no tiene que adivinar si Auth ya está listo.
//
// CÓMO SE COMPARTE LA SESIÓN ENTRE SUBDOMINIOS (IMPORTANTE)
// Firebase Auth, en el navegador, guarda su sesión en IndexedDB del ORIGEN
// exacto (protocolo + host) donde se inició sesión. anticipos.mudanzastml.mx,
// ingresos.mudanzastml.mx, liquidaciones.mudanzastml.mx, etc. son subdominios
// DISTINTOS — cada uno es un origen distinto — así que Firebase Auth, por sí
// solo, NO comparte la sesión entre ellos (a diferencia de una cookie con
// domain=.mudanzastml.mx, que sí viaja a todos los subdominios).
//
// Mientras dure la migración (Fase 1-N), este archivo resuelve esto con un
// "puente" de compatibilidad: al iniciar sesión con Firebase Auth, además
// de la sesión propia de Firebase (que solo aplica en el subdominio donde se
// inició), se escribe la MISMA cookie "tml_user" de dominio compartido que
// ya usa el sistema (domain=.mudanzastml.mx), para que los módulos que
// TODAVÍA no se migraron a Firebase Auth (todos, en esta Fase 1) sigan
// reconociendo la sesión con su lógica actual sin ningún cambio de código
// de su parte.
//
// Esto significa que, POR AHORA, la cookie "tml_user" SIGUE SIENDO
// NECESARIA como puente entre subdominios — no se puede quitar todavía.
// Cuando en una fase futura CADA módulo migre a leer la sesión de Firebase
// Auth directamente (con Auth multi-dominio real, vía un dominio de auth
// centralizado o Cloud Functions que reemitan un token, o simplemente
// pidiendo iniciar sesión una vez por subdominio), esta cookie-puente podrá
// eliminarse. Documentar esta decisión aquí para no perderla de vista.
//
// PERMISOS (CUSTOM CLAIMS)
// Los custom claims se asignan del lado servidor (ver admin/crear-usuarios.js
// — nunca se pueden asignar desde el navegador). Forma esperada del claim:
//   { rol: 'admin' | 'cobranza' | 'operaciones' | 'consulta',
//     permisos: { anticipos_editar:true, ingresos_editar:false, ... } }
// tienePermiso(permiso) revisa root.claims.permisos[permiso] === true, y
// además rol==='admin' siempre regresa true (el admin tiene todo).
// ══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // Misma configuración de Firebase que ya usan todos los módulos
  // (ant.html, ing.html, liq.html, hist.html, usuarios.html, etc.) — se
  // repite aquí porque este archivo es JS plano sin sistema de módulos/
  // imports, pensado para cargarse con <script src="shared/sesion.js">.
  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDqlhREJFVFLGzz7bVlPcNl1Uba9HI3r8s',
    authDomain: 'tml-liquidaciones.firebaseapp.com',
    projectId: 'tml-liquidaciones',
    storageBucket: 'tml-liquidaciones.firebasestorage.app',
    messagingSenderId: '268455373953',
    appId: '1:268455373953:web:ad359c5dbcba9f53557180'
  };

  // ── Utilidades de cookie de dominio compartido (mismo patrón que ya usa
  // cada módulo para "tml_user" — se repite aquí para no depender de que la
  // página anfitriona ya las tenga definidas). ──────────────────────────────
  function tmlSetCookie(name, value, days) {
    var expires = '';
    if (days) {
      var d = new Date();
      d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
      expires = ';expires=' + d.toUTCString();
    }
    document.cookie = name + '=' + encodeURIComponent(value) + expires + ';domain=.mudanzastml.mx;path=/;SameSite=Lax;Secure';
  }
  function tmlGetCookie(name) {
    var m = document.cookie.match('(^|;\\s*)' + name + '=([^;]*)');
    return m ? decodeURIComponent(m[2]) : null;
  }
  function tmlDeleteCookie(name) {
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;domain=.mudanzastml.mx;path=/;SameSite=Lax;Secure';
  }

  // ── Inicialización de Firebase (app + auth), reutilizando la app si la
  // página anfitriona ya la inicializó (ej. porque también usa Firestore
  // con el patrón window.FB existente). ─────────────────────────────────────
  if (!window.firebase || !window.firebase.auth) {
    console.error('shared/sesion.js: falta cargar firebase-app-compat.js y firebase-auth-compat.js ANTES de este archivo.');
    return;
  }
  if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
  var auth = firebase.auth();

  // ── Patrón onAuthReady (equivalente a onFBReady, pero para Auth) ─────────
  var _authInit = false;
  var _authCallbacks = [];
  window.onAuthReady = function (cb) {
    if (_authInit) cb();
    else _authCallbacks.push(cb);
  };

  var _resolverEsperaInicial = null;
  var _promesaEsperaInicial = new Promise(function (resolve) {
    _resolverEsperaInicial = resolve;
  });

  // onAuthStateChanged dispara una vez con el estado inicial (sesión
  // restaurada o null) y luego cada vez que cambia — aquí solo se usa para
  // saber cuándo quedó resuelto el estado inicial; el resto de la app puede
  // usar usuarioActual() para leer el estado en cualquier momento posterior.
  var _primeraResolucion = true;
  auth.onAuthStateChanged(function (user) {
    if (_primeraResolucion) {
      _primeraResolucion = false;
      _authInit = true;
      _resolverEsperaInicial(user);
      _authCallbacks.forEach(function (cb) {
        try { cb(); } catch (e) { console.error('onAuthReady callback:', e); }
      });
      _authCallbacks = [];
    }
  });

  // ── API pública ───────────────────────────────────────────────────────
  // esperarSesion(): Promise que resuelve con el usuario de Firebase Auth
  // (o null si no hay sesión) en cuanto onAuthStateChanged confirma el
  // estado inicial. Usar esto en vez de leer usuarioActual() de inmediato
  // al cargar la página, porque Firebase tarda un instante en restaurar la
  // sesión desde el almacenamiento local.
  function esperarSesion() {
    return _promesaEsperaInicial;
  }

  // usuarioActual(): lectura síncrona del usuario actual de Firebase Auth
  // (puede ser null si todavía no resuelve, o si no hay sesión). Para
  // asegurarse de que ya resolvió, esperar primero esperarSesion().
  function usuarioActual() {
    return auth.currentUser;
  }

  // iniciarSesion(email, password): inicia sesión con Firebase Auth. Además
  // escribe la cookie-puente "tml_user" (ver comentario grande arriba) para
  // que los módulos aún no migrados reconozcan la sesión. Regresa el
  // usuario de Firebase Auth ya autenticado.
  async function iniciarSesion(email, password) {
    var cred = await auth.signInWithEmailAndPassword(email, password);
    await _escribirCookiePuente(cred.user);
    return cred.user;
  }

  // cerrarSesion(): cierra sesión en Firebase Auth y borra la cookie-puente,
  // para que también se cierre sesión en los módulos que la leen.
  async function cerrarSesion() {
    await auth.signOut();
    tmlDeleteCookie('tml_user');
  }

  // tienePermiso(permiso): true/false según los custom claims del usuario
  // en sesión. Fuerza refrescar el token (true) para no quedarse con
  // permisos viejos si un administrador acaba de cambiar los claims de este
  // usuario — los custom claims solo se actualizan en el cliente al
  // refrescar el ID token, no son instantáneos.
  async function tienePermiso(permiso) {
    var user = auth.currentUser;
    if (!user) return false;
    var resultado = await user.getIdTokenResult(true);
    var claims = resultado.claims || {};
    if (claims.rol === 'admin') return true; // el admin tiene todos los permisos
    return !!(claims.permisos && claims.permisos[permiso]);
  }

  // _escribirCookiePuente: arma la cookie "tml_user" con la MISMA forma que
  // ya usan todos los módulos ({id,usuario,nombre,permisos,esAdmin}), a
  // partir de los custom claims del usuario de Firebase Auth.
  //
  // claims.permisos ya trae, desde admin/crear-usuarios.js, TANTO los
  // permisos de VER un módulo completo (ant, ing, liq, nom, inc, hist,
  // autoriz, precarga — mismas claves que el objeto "permisos" del login
  // viejo en Firestore/usuarios) COMO los candados de ACCIÓN dentro de un
  // módulo (anticipos_editar, ingresos_editar, incidentes_editar,
  // casetas_editar). Aquí solo se copian las 8 claves de "ver módulo" al
  // puente — los candados de acción los revisa cada módulo migrado
  // directamente con tienePermiso(), no a través de esta cookie.
  async function _escribirCookiePuente(user) {
    var resultado = await user.getIdTokenResult();
    var claims = resultado.claims || {};
    var esAdmin = claims.rol === 'admin';
    var permisosClaim = claims.permisos || {};
    var CLAVES_MODULO = ['ant', 'ing', 'liq', 'nom', 'inc', 'hist', 'autoriz', 'precarga'];
    var permisosPuente = {};
    CLAVES_MODULO.forEach(function (clave) {
      permisosPuente[clave] = esAdmin || !!permisosClaim[clave];
    });
    var puente = {
      id: user.uid,
      usuario: user.email,
      nombre: user.displayName || user.email,
      permisos: permisosPuente,
      esAdmin: esAdmin
    };
    tmlSetCookie('tml_user', JSON.stringify(puente));
  }

  // Exponer la API en un namespace propio para no chocar con nombres de
  // función que ya existan en cada módulo (ej. varios módulos ya tienen su
  // propia función local "cerrarSesionTML" para el login viejo).
  window.TMLSesion = {
    iniciarSesion: iniciarSesion,
    cerrarSesion: cerrarSesion,
    usuarioActual: usuarioActual,
    esperarSesion: esperarSesion,
    tienePermiso: tienePermiso,
    // Se exponen por si algún módulo migrado necesita leer/borrar la cookie
    // puente directamente (ej. para depurar o para sincronizar con el login
    // viejo durante la transición).
    _tmlGetCookie: tmlGetCookie,
    _tmlDeleteCookie: tmlDeleteCookie
  };
})();
