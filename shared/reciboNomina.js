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

  // construirHTML(n, opNombre): arma el bloque imprimible de UN recibo (un
  // tanto). Quien lo llame decide si lo repite dos veces para los dos
  // tantos (operador + liquidación) — así el QR solo se genera una vez y se
  // reutiliza en ambas copias, en vez de pedirlo dos veces al CDN.
  async function construirHTML(n, opNombre) {
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
      : '<div style="font-size:11px;color:#aaa;margin-top:6px">⚠️ XML no disponible — este recibo se registró antes de guardar los datos completos del timbre.</div>';
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
      + '<div><span>Percepciones:</span> <strong>' + fmtMoneda(n.totalPercepciones || 0) + '</strong></div>'
      + '<div><span>Deducciones:</span> <strong>' + fmtMoneda(n.totalDeducciones || 0) + '</strong></div>'
      + '</div>'
      + '</div>'
      + qrHTML
      + '</div>'
      + uuidHTML
      + '<div class="firma-campos">'
      + '<div><div class="firma-linea"></div><div class="firma-label">Firma del operador — ' + opNombre + '</div></div>'
      + '<div><div class="firma-linea"></div><div class="firma-label">Fecha</div></div>'
      + '</div>'
      + '</div>';
  }

  window.TMLReciboNomina = { cadenaOriginal: cadenaOriginal, urlVerificacion: urlVerificacion, construirHTML: construirHTML };
})();
