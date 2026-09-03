// ══════════════════════════════════════════════════════════════════════════
// shared/fletes.js
//
// "Pedidos de flete" — el cliente manda por correo (buzón dedicado, ver
// functions/index.js → revisarBuzonPedidos) el pedido de un embarque ANTES
// de que exista la factura real: trae la orden de embarque, el pedido de
// flete, tienda/destino y fecha. Se registra aquí en estado
// 'pendiente_factura' y, cuando Raúl sube su XML+Excel de factura
// consolidada de maniobras (ing.html → procesarFacturaManiobrasExcel), cada
// renglón que coincida por orden de embarque se marca 'facturado' con los
// datos de esa factura — mismo patrón de sustitución que ya existe ahí.
//
// Colección real (un documento por pedido de flete, nunca un blob) — mismo
// criterio que shared/operadores.js y shared/proveedores.js.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  function db() {
    if (!window.firebase || !firebase.firestore) {
      console.error('shared/fletes.js: falta cargar firebase-firestore-compat.js antes de este archivo.');
      return null;
    }
    return firebase.firestore();
  }

  // normalizarOrdenEmbarque(valor): mismo criterio en TODAS las fuentes
  // (correo del buzón, captura manual, Excel de la factura consolidada) —
  // sin esto, "OE-00123" vs "oe123" nunca emparejan por un error de formato,
  // no por un caso real.
  function normalizarOrdenEmbarque(valor) {
    return (valor == null ? '' : String(valor))
      .trim().toUpperCase().replace(/\s+/g, '')
      .replace(/^0+(?=\d)/, '');
  }
  window.normalizarOrdenEmbarque = normalizarOrdenEmbarque;

  // cargarFletes(forzar): todos los pedidos de flete (para filtrarlos en la
  // UI por estado) — sin caché agresivo porque esta lista cambia seguido
  // (buzón + sustituciones), se recarga con forzar=true después de cada
  // acción.
  var _cachePromise = null;
  window.cargarFletes = function (forzar) {
    if (_cachePromise && !forzar) return _cachePromise;
    _cachePromise = (async function () {
      var _db = db();
      if (!_db) return [];
      var lista = [];
      try {
        var snap = await _db.collection('fletesDB').get();
        snap.forEach(function (d) { lista.push(Object.assign({ id: d.id }, d.data())); });
      } catch (e) { console.error('shared/fletes.js: no se pudo cargar fletesDB:', e); }
      lista.sort(function (a, b) { return (b.fechaAlta || '').localeCompare(a.fechaAlta || ''); });
      return lista;
    })();
    return _cachePromise;
  };

  // buscarFletePendientePorOrden(lista, ordenEmbarqueCruda): busca, entre los
  // que siguen 'pendiente_factura', uno cuyo T.U.'s 1 (ordenEmbarque) o
  // T.U.'s 2 normalizado coincida — mismo criterio que Maniobras (un pedido
  // puede traer dos T.U.'s asociados, ej. "6500360289" y "6500360290" para
  // el mismo embarque).
  window.buscarFletePendientePorOrden = function (lista, ordenEmbarqueCruda) {
    var norm = normalizarOrdenEmbarque(ordenEmbarqueCruda);
    if (!norm || !Array.isArray(lista)) return null;
    return lista.find(function (f) {
      if (f.estado !== 'pendiente_factura') return false;
      if (f.ordenEmbarque === norm || f.tu2 === norm) return true;
      return Array.isArray(f.tus) && f.tus.indexOf(norm) !== -1; // respaldo para registros viejos
    }) || null;
  };

  // registrarFlete(datos): alta manual o desde el buzón — dedupe por
  // ordenEmbarque normalizada (id del documento), igual que cxpFacturas usa
  // el UUID: da unicidad gratis y hace inmediato buscarlo después. Si
  // datos.ordenEmbarque trae dos T.U.'s juntos separados por "/" (mismo
  // pedido con dos T.U.'s asociados, como los manda el cliente), se separan
  // en T.U.'s 1 (ordenEmbarque, id del documento) y T.U.'s 2 — mismo
  // criterio que ya usa Maniobras.
  window.registrarFlete = async function (datos) {
    var _db = db();
    if (!_db) throw new Error('Sin conexión a Firestore.');
    var partes = String(datos.ordenEmbarque || '').split(/[\/,;]+/)
      .map(normalizarOrdenEmbarque).filter(function (p) { return p; });
    var tu2Extra = normalizarOrdenEmbarque(datos.tu2 || '');
    if (tu2Extra && partes.indexOf(tu2Extra) === -1) partes.push(tu2Extra);
    if (!partes.length) throw new Error('Falta la orden de embarque.');
    var ordenNorm = partes[0];
    var ref = _db.collection('fletesDB').doc(ordenNorm);
    var existente = await ref.get();
    if (existente.exists) throw new Error('Ya existe un pedido de flete con la orden de embarque ' + ordenNorm + '.');
    await ref.set({
      ordenEmbarque: ordenNorm, tu2: partes[1] || null, pedidoFlete: (datos.pedidoFlete || '').trim() || null,
      destino: (datos.destino || '').trim(), tienda: (datos.tienda || '').trim(),
      fecha: datos.fecha || new Date().toISOString().slice(0, 10),
      economico: datos.economico ? parseInt(String(datos.economico).replace(/[^0-9]/g, '') || 0) || null : null,
      montoFlete: datos.montoFlete != null && datos.montoFlete !== '' ? parseFloat(datos.montoFlete) || null : null,
      estado: 'pendiente_factura', facturaUUID: null, facturaFolio: null, montoFactura: null,
      capturadoPor: datos.capturadoPor || '', fechaAlta: new Date().toISOString()
    });
    return ordenNorm;
  };

  // marcarFleteFacturado(ordenEmbarque, datosFactura): la factura PROPIA del
  // FLETE (carta porte) — se llama desde intentarSustituirFletePorXML en
  // ing.html cuando llega el XML normal del embarque y su T.U./pedido
  // coincide con un pedido de flete pendiente. NO usar esto para la factura
  // de maniobras (ver marcarManiobraFacturada, campos aparte) — nunca se
  // sobrescribe en bloque, solo se fusionan los campos de la factura.
  window.marcarFleteFacturado = function (ordenEmbarque, datosFactura) {
    var _db = db();
    if (!_db) return Promise.reject(new Error('Sin conexión a Firestore.'));
    return _db.collection('fletesDB').doc(normalizarOrdenEmbarque(ordenEmbarque)).set({
      estado: 'facturado', facturaUUID: datosFactura.uuid || null,
      facturaFolio: datosFactura.folio || null, montoFactura: datosFactura.monto != null ? datosFactura.monto : null,
      facturadoEn: new Date().toISOString()
    }, { merge: true });
  };

  // marcarManiobraFacturada(ordenEmbarque, datosFactura): APARTE de
  // marcarFleteFacturado — esa es la factura propia del FLETE (carta porte,
  // la marca intentarSustituirFletePorXML en ing.html cuando llega el XML
  // normal del embarque); esta es la factura GLOBAL de MANIOBRAS (Raúl,
  // procesarFacturaManiobrasExcel). Antes ambas escribían los MISMOS campos
  // (estado/facturaFolio/facturaUUID/montoFactura) — subir la carta porte
  // del flete marcaba también la maniobra como facturada de pilón, aunque
  // la factura real de Raúl todavía no llegara (caso real: Eduardo
  // Hernández Aceves, T.U. 6500360831/6500360832, folio A2588). Con campos
  // separados, una no puede pisar a la otra.
  window.marcarManiobraFacturada = function (ordenEmbarque, datosFactura) {
    var _db = db();
    if (!_db) return Promise.reject(new Error('Sin conexión a Firestore.'));
    return _db.collection('fletesDB').doc(normalizarOrdenEmbarque(ordenEmbarque)).set({
      maniobraFacturada: true, facturaManiobraUUID: datosFactura.uuid || null,
      facturaManiobraFolio: datosFactura.folio || null, montoFacturaManiobra: datosFactura.monto != null ? datosFactura.monto : null,
      maniobraFacturadaEn: new Date().toISOString()
    }, { merge: true });
  };

  // actualizarEvidenciaManiobra(ordenEmbarque, campos): fusiona evidencia de
  // maniobra (bultos leídos de la orden de embarque sellada, URLs de las
  // fotos, monto del recibo) en un pedido de flete YA existente — nunca
  // reemplaza el documento completo, solo los campos que trae (mismo
  // criterio que marcarFleteFacturado).
  window.actualizarEvidenciaManiobra = function (ordenEmbarque, campos) {
    var _db = db();
    if (!_db) return Promise.reject(new Error('Sin conexión a Firestore.'));
    return _db.collection('fletesDB').doc(normalizarOrdenEmbarque(ordenEmbarque)).set(campos, { merge: true });
  };

  window.eliminarFlete = function (ordenEmbarque) {
    var _db = db();
    if (!_db) return Promise.reject(new Error('Sin conexión a Firestore.'));
    return _db.collection('fletesDB').doc(normalizarOrdenEmbarque(ordenEmbarque)).delete();
  };
})();
