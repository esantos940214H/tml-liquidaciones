// ══════════════════════════════════════════════════════════════════════════
// shared/proveedores.js
//
// Catálogo de proveedores para Cuentas por Pagar — un documento por
// proveedor en la colección "proveedores" (mismo patrón que
// shared/operadores.js con "operadores"/"unidades": nunca un blob JSON
// gigante en un solo documento). El id del documento es el RFC en
// mayúsculas: da unicidad gratis (no se puede dar de alta el mismo RFC dos
// veces) y hace inmediato buscar al proveedor de una factura por el RFC del
// emisor del CFDI.
//
// CÓMO USAR
// Cargar, en este orden, ANTES de este archivo:
//   <script src=".../firebase-app-compat.js"></script>
//   <script src=".../firebase-firestore-compat.js"></script>
//   <script src="shared/proveedores.js"></script>
// Y luego:
//   let PROVEEDORES=[];
//   window.onFBReady(async function(){ PROVEEDORES=await window.cargarProveedores(); ... });
//
// A diferencia de cargarOperadores() (que solo regresa a los que pueden
// recibir movimientos NUEVOS hoy), cargarProveedores() regresa TODOS
// (activos e inactivos) — este archivo es usado por el propio módulo
// Proveedores para administrarlos (dar de alta, editar, dar de baja), no
// solo para llenar un <select>. Quien solo quiera proveedores activos para
// un selector debe filtrar con `.filter(p=>p.activo)`.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  function db() {
    if (!window.firebase || !firebase.firestore) {
      console.error('shared/proveedores.js: falta cargar firebase-firestore-compat.js antes de este archivo.');
      return null;
    }
    return firebase.firestore();
  }

  function normRfc(rfc) {
    return (rfc || '').toString().trim().toUpperCase();
  }
  window.normRfc = normRfc;

  var _cachePromise = null;

  // cargarProveedores(forzar): regresa (con caché) TODOS los proveedores,
  // ordenados por razón social. Pasar forzar=true para saltarse el caché
  // (ej. justo después de dar de alta/editar uno).
  window.cargarProveedores = function (forzar) {
    if (_cachePromise && !forzar) return _cachePromise;
    _cachePromise = (async function () {
      var _db = db();
      if (!_db) return [];
      var lista = [];
      try {
        var snap = await _db.collection('proveedores').get();
        snap.forEach(function (d) {
          var p = d.data();
          lista.push({
            id: d.id, rfc: d.id,
            razonSocial: p.razonSocial || '', nombreComercial: p.nombreComercial || '',
            regimenFiscal: p.regimenFiscal || '', diasCredito: p.diasCredito != null ? p.diasCredito : 15,
            banco: p.banco || '', clabe: p.clabe || '', cuenta: p.cuenta || '',
            moneda: p.moneda || 'MXN', activo: p.activo !== false,
            fechaAlta: p.fechaAlta || '', fechaBaja: p.fechaBaja || null,
            notas: p.notas || ''
          });
        });
      } catch (e) { console.error('shared/proveedores.js: no se pudo cargar proveedores:', e); }
      lista.sort(function (a, b) { return (a.razonSocial || '').localeCompare(b.razonSocial || ''); });
      return lista;
    })();
    return _cachePromise;
  };

  // buscarProveedorPorRfc(lista, rfc): comparación normalizada (mayúsculas,
  // sin espacios) — el RFC del emisor en un XML puede venir en minúsculas.
  window.buscarProveedorPorRfc = function (lista, rfc) {
    var r = normRfc(rfc);
    if (!r || !Array.isArray(lista)) return null;
    return lista.find(function (p) { return p.rfc === r; }) || null;
  };

  // guardarProveedor(datos): alta o edición — datos.rfc es obligatorio y es
  // el id del documento. Nunca se sobrescribe en bloque: se hace merge para
  // no pisar campos que no vienen en `datos` (por ejemplo si se llama solo
  // para reactivar/dar de baja).
  window.guardarProveedor = async function (datos) {
    var _db = db();
    if (!_db) throw new Error('Sin conexión a Firestore.');
    var rfc = normRfc(datos.rfc);
    if (!rfc) throw new Error('Falta el RFC del proveedor.');
    var ref = _db.collection('proveedores').doc(rfc);
    var campos = {};
    if (datos.razonSocial != null) campos.razonSocial = datos.razonSocial;
    if (datos.nombreComercial != null) campos.nombreComercial = datos.nombreComercial;
    if (datos.regimenFiscal != null) campos.regimenFiscal = datos.regimenFiscal;
    if (datos.diasCredito != null) campos.diasCredito = parseInt(datos.diasCredito) || 15;
    if (datos.banco != null) campos.banco = datos.banco;
    if (datos.clabe != null) campos.clabe = datos.clabe;
    if (datos.cuenta != null) campos.cuenta = datos.cuenta;
    if (datos.moneda != null) campos.moneda = datos.moneda;
    if (datos.notas != null) campos.notas = datos.notas;
    if (datos.activo != null) campos.activo = !!datos.activo;
    var snapExistente = await ref.get();
    if (!snapExistente.exists) {
      campos.activo = campos.activo != null ? campos.activo : true;
      campos.fechaAlta = new Date().toISOString().slice(0, 10);
      campos.fechaBaja = null;
    }
    await ref.set(campos, { merge: true });
    return rfc;
  };

  // darDeBajaProveedor(rfc) / reactivarProveedor(rfc): baja lógica, nunca se
  // borra el documento (se conserva el historial de facturas ligadas a él).
  window.darDeBajaProveedor = function (rfc) {
    var _db = db();
    if (!_db) return Promise.reject(new Error('Sin conexión a Firestore.'));
    return _db.collection('proveedores').doc(normRfc(rfc)).set(
      { activo: false, fechaBaja: new Date().toISOString().slice(0, 10) }, { merge: true }
    );
  };
  window.reactivarProveedor = function (rfc) {
    var _db = db();
    if (!_db) return Promise.reject(new Error('Sin conexión a Firestore.'));
    return _db.collection('proveedores').doc(normRfc(rfc)).set(
      { activo: true, fechaBaja: null }, { merge: true }
    );
  };
})();
