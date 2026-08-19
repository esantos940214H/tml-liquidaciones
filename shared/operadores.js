// ══════════════════════════════════════════════════════════════════════════
// shared/operadores.js
//
// Carga la lista de operadores desde Firestore (colección "operadores") en
// vez de la lista OPERADORES=[...] que antes estaba escrita a mano y
// repetida en cada módulo (ant.html, ing.html, liq.html, hist.html,
// nomina.html, incidentes.html, autorizaciones.html, precarga.html) — dar
// de alta/baja un operador o reasignarlo de unidad ya no requiere tocar
// código ni volver a desplegar, se hace desde flota.html.
//
// CÓMO USAR
// Cargar, en este orden, ANTES de este archivo:
//   <script src=".../firebase-app-compat.js"></script>
//   <script src=".../firebase-firestore-compat.js"></script>
//   <script src="shared/operadores.js"></script>
// Y en vez de `const OPERADORES=[...]` (hardcodeado), usar:
//   let OPERADORES=[];
//   window.onFBReady(async function(){ OPERADORES=await window.cargarOperadores(); ... });
//
// MIGRACIÓN AUTOMÁTICA (una sola vez)
// La primera vez que se llama a cargarOperadores() y la colección
// "operadores" está vacía, se siembra sola con la lista que ya estaba
// hardcodeada en el sistema — así ningún operador existente se pierde al
// pasar a este esquema. Después de esa siembra, flota.html es la única
// fuente de verdad.
//
// FORMA DEL RESULTADO (compatible con el código ya existente)
// cargarOperadores() regresa [{unidad, operadorId, nombre, comision,
// clave}, ...] — mismo shape {unidad,nombre,...} que ya usaba todo el
// código (OPERADORES.find(o=>o.unidad===...)), así que no hace falta tocar
// cada sitio que ya busca por "unidad". "unidad" aquí es la unidad ACTUAL
// del operador (unidadActual en Firestore) — un operador sin unidad
// asignada todavía no aparece en el resto del sistema (no puede recibir
// anticipos/ingresos sin una unidad, igual que antes).
// ══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // Semilla — SOLO se usa una vez, si la colección "operadores" está vacía,
  // para no perder a nadie al migrar del arreglo hardcodeado a Firestore.
  var SEMILLA_OPERADORES = [
    { operadorId: 4521, nombre: 'ALEJANDRO RODRIGUEZ GONZALEZ', comision: 12, clave: 'OPE-001', unidadActual: 4521 },
    { operadorId: 4522, nombre: 'ANDRÉS MARÍA RAMOS', comision: 12, clave: 'OPE-002', unidadActual: 4522 },
    { operadorId: 4523, nombre: 'ANDRÉS NAVARRO RAMÍREZ', comision: 12, clave: 'OPE-003', unidadActual: 4523 },
    { operadorId: 4524, nombre: 'RAFAEL TAPIA CARREÑO', comision: 12, clave: 'OPE-004', unidadActual: 4524 },
    { operadorId: 4526, nombre: 'EDUARDO HERNÁNDEZ ACEVES', comision: 12, clave: 'OPE-005', unidadActual: 4526 },
    { operadorId: 529, nombre: 'OSCAR ISRAEL RAMOS', comision: 12, clave: 'OPE-006', unidadActual: 529 },
    { operadorId: 531, nombre: 'MARTÍN FLORES LUGO', comision: 12, clave: 'OPE-007', unidadActual: 531 },
    { operadorId: 532, nombre: 'JOSÉ ROLANDO DOMINGUEZ LOPEZ', comision: 12, clave: 'OPE-008', unidadActual: 532 },
    { operadorId: 533, nombre: 'FRANCISCO ARTEMIO PEÑA VAZQUEZ', comision: 12, clave: 'OPE-009', unidadActual: 533 },
    { operadorId: 534, nombre: 'MIGUEL ALONSO CALDERON', comision: 12, clave: 'OPE-010', unidadActual: 534 },
    { operadorId: 535, nombre: 'ISMAEL CONSTANTINO CABRERA', comision: 12, clave: 'OPE-011', unidadActual: 535 }
  ];

  function db() {
    if (!window.firebase || !firebase.firestore) {
      console.error('shared/operadores.js: falta cargar firebase-firestore-compat.js antes de este archivo.');
      return null;
    }
    return firebase.firestore();
  }

  async function sembrarSiHaceFalta(_db) {
    var snapOp = await _db.collection('operadores').limit(1).get();
    var snapUn = await _db.collection('unidades').limit(1).get();
    if (!snapOp.empty && !snapUn.empty) return;
    var batch = _db.batch();
    if (snapOp.empty) {
      SEMILLA_OPERADORES.forEach(function (o) {
        var ref = _db.collection('operadores').doc(String(o.operadorId));
        batch.set(ref, {
          nombre: o.nombre, comision: o.comision, clave: o.clave,
          unidadActual: o.unidadActual, activo: true,
          fechaAlta: '2026-01-01', fechaBaja: null
        });
      });
    }
    if (snapUn.empty) {
      SEMILLA_OPERADORES.forEach(function (o) {
        var ref = _db.collection('unidades').doc(String(o.unidadActual));
        batch.set(ref, {
          numero: o.unidadActual, activa: true, placas: '',
          tanques: [], operadorActual: o.operadorId
        });
      });
    }
    await batch.commit();
  }

  var _cachePromise = null;

  // cargarOperadores(forzar): regresa (con caché) el arreglo de operadores
  // ACTIVOS con unidad asignada. Pasar forzar=true para saltarse el caché
  // (ej. justo después de dar de alta/reasignar a alguien en flota.html).
  window.cargarOperadores = function (forzar) {
    if (_cachePromise && !forzar) return _cachePromise;
    _cachePromise = (async function () {
      var _db = db();
      if (!_db) return [];
      try { await sembrarSiHaceFalta(_db); } catch (e) { console.error('shared/operadores.js: no se pudo sembrar:', e); }
      var snap = await _db.collection('operadores').where('activo', '==', true).get();
      var lista = [];
      snap.forEach(function (d) {
        var o = d.data();
        if (o.unidadActual == null) return; // sin unidad: aún no aparece en el resto del sistema
        lista.push({
          unidad: o.unidadActual,
          operadorId: parseInt(d.id),
          nombre: o.nombre || '',
          comision: o.comision != null ? o.comision : 12,
          clave: o.clave || ''
        });
      });
      lista.sort(function (a, b) { return (a.unidad || 0) - (b.unidad || 0); });
      return lista;
    })();
    return _cachePromise;
  };

  var _cacheNombresPromise = null;

  // cargarNombresOperadores(forzar): mapa {operadorId: nombre} de TODOS los
  // operadores, activos o no, con unidad asignada o no — a diferencia de
  // cargarOperadores() (que solo trae a quien puede recibir anticipos/
  // ingresos NUEVOS hoy), este mapa es solo para poder seguir mostrando el
  // nombre correcto en registros históricos de alguien que después fue
  // dado de baja o se quedó sin unidad asignada (si no, esos registros se
  // ven con el nombre en blanco o "?" aunque el dato siga bien ligado a
  // esa persona). Úsalo como respaldo del find() normal:
  //   var nombre = (OPERADORES.find(o=>o.operadorId===v.unidad)||{}).nombre
  //     || nombresOperadores[v.unidad] || '?';
  window.cargarNombresOperadores = function (forzar) {
    if (_cacheNombresPromise && !forzar) return _cacheNombresPromise;
    _cacheNombresPromise = (async function () {
      var _db = db();
      if (!_db) return {};
      var mapa = {};
      try {
        var snap = await _db.collection('operadores').get();
        snap.forEach(function (d) {
          var o = d.data();
          mapa[parseInt(d.id)] = o.nombre || '';
        });
      } catch (e) { console.error('shared/operadores.js: no se pudo cargar nombresOperadores:', e); }
      return mapa;
    })();
    return _cacheNombresPromise;
  };
})();
