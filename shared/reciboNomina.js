// ══════════════════════════════════════════════════════════════════════════
// shared/reciboNomina.js
//
// Representación imprimible de un recibo de nómina (CFDI tipo N) con QR de
// verificación del SAT y la Cadena Original del Complemento de Certificación
// Digital del SAT — para entregarle al operador un recibo con los mismos
// datos de validez fiscal que trae cualquier representación impresa oficial
// de un CFDI, no solo un resumen de percepciones/deducciones.
//
// La Cadena Original del Complemento de Certificación Digital (TFD 1.1) es
// una concatenación FIJA de 5 campos — documentada por el SAT en el Anexo 20
// — y es justo lo que el PAC firma para producir el SelloSAT. A diferencia
// de la cadena original del Comprobante completo (que sí requiere aplicar
// una hoja XSLT), esta se puede reconstruir aquí tal cual con los datos que
// ya se guardan al parsear el XML en nomina.html:
//   ||1.1|UUID|FechaTimbrado|RfcProvCertif|SelloCFD|NoCertificadoSAT||
//
// El QR usa la misma URL de verificación que trae cualquier representación
// impresa oficial de un CFDI:
//   https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?...
//
// CÓMO USAR
// Cargar este archivo (no depende de Firebase, solo del CDN de QR que carga
// solo bajo demanda, la primera vez que se arma un recibo):
//   <script src="shared/reciboNomina.js"></script>
// y luego:
//   const html = await window.TMLReciboNomina.construirHTML(n, opNombre);
// "n" es el objeto de nómina guardado (con uuid, fechaTimbrado, selloSAT,
// noCertificadoSAT, rfcProvCertif, selloCFD, total, emisorRfc, receptorRfc,
// etc. — ver parseNominaXML en nomina.html). Recibos capturados ANTES de
// que se guardaran estos campos se muestran igual, solo sin QR/cadena.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  function cadenaOriginal(n) {
    if (!n || !n.uuid || !n.fechaTimbrado || !n.selloCFD || !n.noCertificadoSAT) return '';
    return '||1.1|' + n.uuid + '|' + n.fechaTimbrado + '|' + (n.rfcProvCertif || '') + '|' + n.selloCFD + '|' + n.noCertificadoSAT + '||';
  }

  function urlVerificacion(n) {
    if (!n || !n.uuid || !n.selloCFD) return '';
    var fe = (n.selloCFD || '').slice(-8);
    var total = n.total != null ? Number(n.total).toFixed(6) : '';
    return 'https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=' + encodeURIComponent(n.uuid)
      + '&re=' + encodeURIComponent(n.emisorRfc || '')
      + '&rr=' + encodeURIComponent(n.receptorRfc || '')
      + '&tt=' + encodeURIComponent(total)
      + '&fe=' + encodeURIComponent(fe);
  }

  var _qrLibPromise = null;
  function cargarQRLib() {
    if (window.QRCode) return Promise.resolve();
    if (_qrLibPromise) return _qrLibPromise;
    _qrLibPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
      s.onload = resolve;
      s.onerror = function () { reject(new Error('No se pudo cargar el generador de QR.')); };
      document.head.appendChild(s);
    });
    return _qrLibPromise;
  }

  async function qrDataURL(texto) {
    if (!texto) return null;
    try {
      await cargarQRLib();
      return await new Promise(function (resolve) {
        window.QRCode.toDataURL(texto, { margin: 1, width: 140 }, function (err, url) {
          resolve(err ? null : url);
        });
      });
    } catch (e) { console.error('shared/reciboNomina.js: QR no disponible:', e); return null; }
  }

  function fmtMoneda(v) {
    return '$' + Number(v || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // CSS del desglose de percepciones/deducciones — se inyecta una sola vez,
  // aquí mismo, para no tener que duplicar estas reglas en el <style> de
  // cada módulo que use este archivo (liq.html, hist.html).
  var _cssListo = false;
  function asegurarCSS() {
    if (_cssListo) return;
    _cssListo = true;
    var css = document.createElement('style');
    css.textContent =
      '.recibo-desglose{display:flex;gap:14px;margin-top:8px}' +
      '.recibo-desglose-col{flex:1;min-width:0}' +
      '.recibo-desglose-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#666;margin-bottom:3px;border-bottom:1px solid #ddd;padding-bottom:2px}' +
      '.recibo-desglose-table{width:100%;border-collapse:collapse;font-size:10px}' +
      '.recibo-desglose-table td{padding:2px 0}' +
      '.recibo-desglose-table td.imp{text-align:right;font-family:monospace;white-space:nowrap}' +
      '.recibo-desglose-table tr.tot td{border-top:1px solid #ccc;font-weight:700;padding-top:3px}';
    document.head.appendChild(css);
  }

  // tablaDesglose(titulo, renglones, total): arma la columna de Percepciones
  // o Deducciones. Si el XML no traía el desglose por renglón (recibos
  // capturados antes de que se guardara, o CFDIs que no lo incluyen), cae de
  // respaldo a un solo renglón "Total" con el monto guardado, para no dejar
  // la columna vacía.
  function tablaDesglose(titulo, renglones, total) {
    var filas = (renglones && renglones.length)
      ? renglones.map(function (r) { return '<tr><td>' + (r.concepto || r.clave || '—') + '</td><td class="imp">' + fmtMoneda(r.importe) + '</td></tr>'; }).join('')
      : '<tr><td>Total</td><td class="imp">' + fmtMoneda(total) + '</td></tr>';
    return '<div class="recibo-desglose-col">'
      + '<div class="recibo-desglose-title">' + titulo + '</div>'
      + '<table class="recibo-desglose-table">' + filas
      + '<tr class="tot"><td>Total</td><td class="imp">' + fmtMoneda(total) + '</td></tr>'
      + '</table></div>';
  }

  // construirHTML(n, opNombre): arma el bloque imprimible de UN recibo (un
  // tanto). Quien lo llame decide si lo repite dos veces para los dos
  // tantos (operador + liquidación) — así el QR solo se genera una vez y se
  // reutiliza en ambas copias, en vez de pedirlo dos veces al CDN.
  async function construirHTML(n, opNombre) {
    asegurarCSS();
    var neto = (n.totalPercepciones || 0) - (n.totalDeducciones || 0);
    var cadena = cadenaOriginal(n);
    var urlVerif = urlVerificacion(n);
    var qrImg = await qrDataURL(urlVerif);
    var uuidHTML = n.uuid
      ? '<div class="recibo-uuid">'
        + 'Folio fiscal (UUID): ' + n.uuid
        + (n.fechaTimbrado ? '<br>Fecha de timbrado: ' + n.fechaTimbrado.replace('T', ' ') : '')
        + (n.noCertificadoSAT ? '<br>No. Certificado SAT: ' + n.noCertificadoSAT : '')
        + (n.selloSAT ? '<br>Sello SAT: ' + n.selloSAT.slice(0, 20) + '...' + n.selloSAT.slice(-20) : '')
        + (n.selloCFD ? '<br>Sello CFDI: ' + n.selloCFD.slice(0, 20) + '...' + n.selloCFD.slice(-20) : '')
        + (n.rfcProvCertif ? '<br>RFC Prov. Certif.: ' + n.rfcProvCertif : '')
        + '</div>'
        + (cadena ? '<div class="recibo-cadena"><strong>Cadena original del complemento de certificación digital del SAT:</strong><br>' + cadena + '</div>' : '')
      : '<div style="font-size:11px;color:#aaa;margin-top:6px">⚠️ Este recibo se registró antes de guardar los datos completos del timbre — vuelve a subir el mismo XML en Nómina para completarlo (QR/cadena/desglose).</div>';
    var qrHTML = qrImg ? '<div class="recibo-qr"><img src="' + qrImg + '" width="110" height="110" alt="QR de verificación SAT"><div style="font-size:8px;color:#999;margin-top:3px;max-width:110px">Verificar en el SAT</div></div>' : '';
    return '<div class="recibo-box">'
      + '<div class="recibo-top">'
      + '<div class="recibo-datos">'
      + '<h4>RECIBO DE NÓMINA — ' + (n.emisorNombre || 'MUDANZAS TML, S.A. DE C.V.') + '</h4>'
      + '<div class="recibo-grid">'
      + '<div><span>Operador:</span> <strong>' + opNombre + '</strong></div>'
      + '<div><span>RFC operador:</span> <strong>' + (n.receptorRfc || '—') + '</strong></div>'
      + '<div><span>Periodo:</span> <strong>' + (n.periodoIni || '?') + ' al ' + (n.periodoFin || '?') + '</strong></div>'
      + '<div><span>Fecha de pago:</span> <strong>' + (n.fecha || '—') + '</strong></div>'
      + '<div><span>Folio:</span> <strong>' + (n.folio || '—') + '</strong></div>'
      + '<div><span>Neto pagado:</span> <strong>' + fmtMoneda(neto) + '</strong></div>'
      + '</div>'
      + '</div>'
      + qrHTML
      + '</div>'
      + '<div class="recibo-desglose">'
      + tablaDesglose('Percepciones', n.percepciones, n.totalPercepciones || 0)
      + tablaDesglose('Deducciones', n.deducciones, n.totalDeducciones || 0)
      + '</div>'
      + uuidHTML
      + '<div class="firma-campos">'
      + '<div><div class="firma-linea"></div><div class="firma-label">Firma del operador — ' + opNombre + '</div></div>'
      + '<div><div class="firma-linea"></div><div class="firma-label">Fecha</div></div>'
      + '</div>'
      + '</div>';
  }

  // Hoja de estilos completa y AUTOCONTENIDA para el visor (abrirVisor) — a
  // diferencia de asegurarCSS() (que solo cubre el desglose y se apoya en
  // el <style> que ya trae cada módulo para .recibo-box/.firma-*/etc.),
  // esta cubre TODO lo que usa construirHTML(), porque el visor abre un
  // documento nuevo en blanco que no hereda ningún CSS de la página que lo
  // llamó — necesaria, por ejemplo, para poder ver el recibo desde
  // nomina.html, que no tiene ninguna de estas clases definidas.
  var CSS_VISOR =
    'body{font-family:Arial,sans-serif;background:#eee;color:#1a1a2e;margin:0;padding:24px 0}' +
    '.recibo-nomina-par{max-width:800px;margin:0 auto 24px;background:#fff;display:flex;flex-direction:column;height:11in;box-sizing:border-box;box-shadow:0 2px 12px rgba(0,0,0,.15)}' +
    '.recibo-box{border:1px solid #ccc;padding:16px;flex:1 1 0;box-sizing:border-box;overflow:hidden;font-size:12px}' +
    '.recibo-box h4{font-size:13px;margin:0 0 8px;color:#1a1a2e}' +
    '.recibo-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;font-size:12px;margin-bottom:8px}' +
    '.recibo-grid div span{color:#888}' +
    '.recibo-uuid{font-size:10px;color:#666;word-break:break-all;background:#f7f7f9;border-radius:4px;padding:6px 8px;margin-top:4px}' +
    '.recibo-cadena{font-size:9px;color:#666;word-break:break-all;font-family:monospace;background:#f7f7f9;border-radius:4px;padding:6px 8px;margin-top:6px}' +
    '.recibo-top{display:flex;gap:12px;align-items:flex-start;justify-content:space-between}' +
    '.recibo-datos{flex:1;min-width:0}' +
    '.recibo-qr{flex-shrink:0;text-align:center}' +
    '.recibo-qr img{border:1px solid #eee;border-radius:4px;width:100px;height:100px}' +
    '.recibo-corte{flex:0 0 auto;border-top:1px dashed #999;text-align:center;font-size:10px;color:#999;margin:0;padding:4px 0}' +
    '.firma-campos{display:grid;grid-template-columns:2fr 1fr;gap:48px;margin-top:18px}' +
    '.firma-linea{border-top:1.5px solid #1a1a2e;margin-bottom:6px;margin-top:30px}' +
    '.firma-label{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.7px;text-align:center}' +
    '.recibo-desglose{display:flex;gap:14px;margin-top:8px}' +
    '.recibo-desglose-col{flex:1;min-width:0}' +
    '.recibo-desglose-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#666;margin-bottom:3px;border-bottom:1px solid #ddd;padding-bottom:2px}' +
    '.recibo-desglose-table{width:100%;border-collapse:collapse;font-size:10px}' +
    '.recibo-desglose-table td{padding:2px 0}' +
    '.recibo-desglose-table td.imp{text-align:right;font-family:monospace;white-space:nowrap}' +
    '.recibo-desglose-table tr.tot td{border-top:1px solid #ccc;font-weight:700;padding-top:3px}' +
    '@media print{body{background:#fff;padding:0}.recibo-nomina-par{box-shadow:none;margin:0 auto}.no-print{display:none!important}}';

  // abrirVisor(n, opNombre): abre en una pestaña nueva una vista previa de
  // cómo va a quedar el recibo impreso (original+copia en media carta,
  // igual que en Historial/Liquidaciones) — para poder revisarlo justo
  // después de subir el XML en Nómina, sin tener que esperar a la
  // liquidación. Desde ahí, "Imprimir / Guardar como PDF" usa el diálogo de
  // impresión del navegador (misma vía que ya se usa en todo el sistema
  // para "descargar como PDF" — Guardar como PDF en ese diálogo).
  async function abrirVisor(n, opNombre) {
    // La pestaña se abre YA (en blanco) antes de esperar nada async — si se
    // abriera después del await del QR, el navegador puede bloquearla por
    // ya no considerarla "en respuesta directa" al clic del usuario.
    var ventana = window.open('', '_blank');
    if (ventana) ventana.document.write('<!doctype html><title>Generando recibo…</title><body style="font-family:Arial;padding:40px;text-align:center;color:#888">Generando vista previa del recibo…</body>');
    var box = await construirHTML(n, opNombre);
    var doc = '<!doctype html><html><head><meta charset="utf-8">'
      + '<title>Recibo de nómina — ' + (opNombre || '') + '</title>'
      + '<style>' + CSS_VISOR + '</style></head><body>'
      + '<div class="recibo-nomina-par">' + box
      + '<div class="recibo-corte">✂ — — — — — recorte aquí · original arriba (operador) · copia abajo (liquidación) — — — — — ✂</div>'
      + box + '</div>'
      + '<div class="no-print" style="max-width:800px;margin:0 auto 30px;text-align:center">'
      + '<button onclick="window.print()" style="padding:10px 22px;font-size:14px;font-weight:700;background:#e63946;color:#fff;border:none;border-radius:6px;cursor:pointer">🖨️ Imprimir / Guardar como PDF</button>'
      + '</div>'
      + '</body></html>';
    var blob = new Blob([doc], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    if (ventana && !ventana.closed) {
      ventana.location.href = url;
    } else {
      window.open(url, '_blank');
    }
  }

  window.TMLReciboNomina = { cadenaOriginal: cadenaOriginal, urlVerificacion: urlVerificacion, construirHTML: construirHTML, abrirVisor: abrirVisor };
})();
