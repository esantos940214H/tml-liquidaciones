// ══════════════════════════════════════════════════════════════════════════
// shared/comprobantes.js
//
// Utilidades comunes para (1) conservar el XML original de cada CFDI que se
// procesa en el sistema (antes se leía solo para extraer datos y se
// descartaba) y (2) generar una representación en PDF a partir de los datos
// YA EXTRAÍDOS del XML — sin necesidad de guardar también un archivo PDF
// aparte, porque el CFDI XML ya trae todo lo necesario para reconstruirlo.
//
// CÓMO USAR ESTE ARCHIVO
// Cargar, en este orden, ANTES de este archivo:
//   <script src=".../firebase-app-compat.js"></script>
//   <script src=".../firebase-storage-compat.js"></script>
//   <script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"></script>
//   <script src="shared/comprobantes.js"></script>
// ══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  function storage() {
    if (!window.firebase || !firebase.storage) {
      console.error('shared/comprobantes.js: falta cargar firebase-storage-compat.js antes de este archivo.');
      return null;
    }
    return firebase.storage();
  }

  // subirXML(path, text): guarda el XML tal cual (texto plano) en Firebase
  // Storage y regresa la URL de descarga. "path" debe ser único — se arma
  // normalmente con el UUID del CFDI para que dos comprobantes nunca se
  // pisen entre sí.
  async function subirXML(path, text) {
    var st = storage();
    if (!st) throw new Error('Firebase Storage no disponible.');
    var ref = st.ref().child(path);
    await ref.putString(text, 'raw', { contentType: 'application/xml' });
    return await ref.getDownloadURL();
  }

  // subirArchivo(path, file): guarda un archivo real (File/Blob — ej. un PDF
  // que el usuario subió directamente, sin XML detrás del cual generarlo) en
  // Firebase Storage y regresa la URL de descarga.
  async function subirArchivo(path, file) {
    var st = storage();
    if (!st) throw new Error('Firebase Storage no disponible.');
    var ref = st.ref().child(path);
    await ref.put(file);
    return await ref.getDownloadURL();
  }

  function fmtMoneda(n) {
    if (n == null || n === '') return '';
    return '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // generarPDF(datos): arma un PDF sencillo y legible con los datos YA
  // EXTRAÍDOS del XML (no vuelve a leer el archivo original) y dispara su
  // descarga en el navegador. No es la representación impresa oficial del
  // SAT (para eso existe el XML original, descargable aparte) — es solo un
  // resumen legible para consulta rápida, generado al momento, sin guardar
  // ningún PDF en Storage.
  //
  // datos: {
  //   titulo, folio, fecha, emisorNombre, emisorRFC, receptorRFC,
  //   conceptos: [string], subtotal, iva, total, uuid,
  //   extra: [[label, valor], ...]   (líneas adicionales opcionales)
  // }
  function generarPDF(datos) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('No se pudo cargar el generador de PDF. Revisa tu conexión e intenta de nuevo.');
      return;
    }
    var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'letter' });
    var y = 20;
    doc.setFontSize(14); doc.setFont(undefined, 'bold');
    doc.text(datos.titulo || 'Comprobante', 15, y); y += 9;
    doc.setFontSize(10);
    function linea(label, valor) {
      if (valor == null || valor === '') return;
      doc.setFont(undefined, 'bold'); doc.text(label + ':', 15, y);
      doc.setFont(undefined, 'normal'); doc.text(String(valor), 55, y);
      y += 6;
    }
    linea('Folio', datos.folio);
    linea('Fecha', datos.fecha);
    linea('Emisor', datos.emisorNombre);
    linea('RFC emisor', datos.emisorRFC);
    linea('RFC receptor', datos.receptorRFC);
    (datos.extra || []).forEach(function (par) { linea(par[0], par[1]); });
    y += 2;
    if (datos.conceptos && datos.conceptos.length) {
      doc.setFont(undefined, 'bold'); doc.text('Conceptos:', 15, y); y += 6;
      doc.setFont(undefined, 'normal');
      datos.conceptos.forEach(function (c) {
        doc.splitTextToSize(String(c), 180).forEach(function (l) { doc.text(l, 18, y); y += 5; });
      });
      y += 2;
    }
    doc.setDrawColor(200); doc.line(15, y, 195, y); y += 7;
    doc.setFontSize(11);
    linea('Subtotal', fmtMoneda(datos.subtotal));
    linea('IVA', fmtMoneda(datos.iva));
    doc.setFont(undefined, 'bold');
    linea('Total', fmtMoneda(datos.total));
    if (datos.uuid) {
      y += 4; doc.setFontSize(8); doc.setFont(undefined, 'normal');
      doc.text('UUID: ' + datos.uuid, 15, y);
    }
    y += 10; doc.setFontSize(7); doc.setTextColor(150);
    doc.text('Generado por el sistema de Mudanzas TML a partir de los datos del CFDI. No es una representación impresa oficial del SAT — para eso, descarga el XML original.', 15, y, { maxWidth: 180 });
    doc.save((datos.folio || 'comprobante').replace(/[^a-zA-Z0-9._-]/g, '_') + '.pdf');
  }

  window.TMLComprobantes = { subirXML: subirXML, subirArchivo: subirArchivo, generarPDF: generarPDF };
})();
