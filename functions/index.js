// ══════════════════════════════════════════════════════════════════════════
// functions/index.js
//
// Único propósito: recibir el texto de un correo de autorización de
// maniobras (pegado tal cual desde el correo) y usar la API de Anthropic
// para extraer los renglones (operador, monto, fecha, pedido, destino) como
// JSON estructurado — ver el botón "Extraer con IA" en maniobras.html.
//
// POR QUÉ EXISTE ESTA FUNCIÓN (y no llamar a la API directo desde el
// navegador): la API de Anthropic necesita una llave secreta. Si esa llave
// se pusiera directo en el HTML/JS de maniobras.html, cualquiera que abra
// "Ver código fuente" de la página podría copiarla y usarla a costa de
// Mudanzas TML. Aquí la llave vive SOLO en el servidor (como "secret" de
// Firebase, ver abajo), nunca llega al navegador — la página nada más le
// pide el resultado a esta función.
//
// ── CÓMO DESPLEGAR (una sola vez, y cada vez que se edite este archivo) ────
// 1. Activar el plan de pago "Blaze" del proyecto en la consola de Firebase
//    (Cloud Functions lo requiere; se paga solo por lo que se use — para
//    este volumen es centavos al mes). Configuración del proyecto → Uso y
//    facturación → Modificar plan.
// 2. Instalar Firebase CLI si no la tienes: npm install -g firebase-tools
// 3. firebase login   (una vez, abre el navegador para autenticarte)
// 4. Sacar una llave de la API de Anthropic en https://console.anthropic.com
//    (Settings → API Keys → Create Key).
// 5. Desde la raíz del repo: firebase functions:secrets:set ANTHROPIC_API_KEY
//    (pega la llave cuando la pida — queda guardada de forma segura en
//    Google Secret Manager, nunca en este archivo ni en el repo).
// 6. cd functions && npm install
// 7. Desde la raíz del repo: firebase deploy --only functions
// 8. Al terminar, la terminal muestra la URL de la función desplegada (algo
//    como https://extraermaniobras-xxxxxxxxxx-uc.a.run.app). Copia esa URL
//    y pégala en la constante FUNCTION_URL_EXTRAER_MANIOBRAS al inicio del
//    <script> de maniobras.html.
// ══════════════════════════════════════════════════════════════════════════

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const MANIOBRAS_EMAIL_USER = defineSecret('MANIOBRAS_EMAIL_USER');
const MANIOBRAS_EMAIL_PASS = defineSecret('MANIOBRAS_EMAIL_PASS');
const COMPRAS_EMAIL_USER = defineSecret('COMPRAS_EMAIL_USER');
const COMPRAS_EMAIL_PASS = defineSecret('COMPRAS_EMAIL_PASS');
const FLETES_EMAIL_USER = defineSecret('FLETES_EMAIL_USER');
const FLETES_EMAIL_PASS = defineSecret('FLETES_EMAIL_PASS');
// RFC de Mudanzas TML confirmado contra su Constancia de Situación Fiscal
// (agosto 2026) — el receptor del CFDI de proveedor debe ser este RFC.
const TML_RFC = 'MTM171214PI4';

// ══════════════════════════════════════════════════════════════════════════
// Envío de correos a proveedores (Cuentas por Pagar) — se manda desde la
// misma cuenta/contraseña que ya se usa para LEER el buzón de compras por
// IMAP (COMPRAS_EMAIL_USER/PASS), vía SMTP de IONOS. No hace falta ningún
// secret nuevo para esto.
// ══════════════════════════════════════════════════════════════════════════
function _fmtMonedaServer(n) {
  return '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Como el correo se manda directo por SMTP (sin pasar por ningún cliente de
// correo tipo Outlook/webmail), IONOS nunca guarda una copia en "Enviados"
// de compras@ — eso lo hacen los clientes de correo al mandarlo, no el
// protocolo SMTP por sí solo. Para poder confirmar que sí se mandó (o ver
// por qué falló) sin depender de revisar logs de Cloud Functions, cada
// intento queda registrado en la colección real correosEnviadosCxP.
async function _enviarCorreoCompras(user, pass, to, subject, html, attachments) {
  if (!to) return;
  let ok = true, error = null;
  try {
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({ host: 'smtp.ionos.mx', port: 587, secure: false, auth: { user: user, pass: pass } });
    const mail = { from: user, to: to, subject: subject, html: html };
    if (attachments && attachments.length) mail.attachments = attachments;
    await transport.sendMail(mail);
  } catch (e) {
    ok = false; error = e.message || String(e);
    throw e;
  } finally {
    try {
      await db.collection('correosEnviadosCxP').add({ to: to, subject: subject, html: html, ok: ok, error: error, fechaEnvio: new Date().toISOString() });
    } catch (e2) { console.error('_enviarCorreoCompras: no se pudo registrar el log del correo:', e2); }
  }
}
// _plantillaCorreoCxP(titulo, acento, cuerpoHtml): envoltorio visual compartido
// por todos los correos de Cuentas por Pagar — header con la marca de
// Mudanzas TML y una franja de color que indica el tipo de aviso (info,
// recordatorio, bloqueo), para que no se vean como texto plano. `cuerpoHtml`
// es el contenido específico de cada correo (ya se pasaba así antes, esta
// función solo lo envuelve).
function _plantillaCorreoCxP(titulo, acento, cuerpoHtml) {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f2f2f7;font-family:Segoe UI,Arial,sans-serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f7;padding:24px 0;">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">' +
    '<tr><td style="background:#1a1a2e;padding:20px 28px;">' +
    '<span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.3px;">MUDANZAS TML</span>' +
    '<div style="color:#9fa3c9;font-size:12px;margin-top:2px;">Cuentas por pagar</div>' +
    '</td></tr>' +
    '<tr><td style="height:5px;background:' + acento + ';font-size:0;line-height:0;">&nbsp;</td></tr>' +
    '<tr><td style="padding:28px 28px 8px;">' +
    '<h2 style="margin:0 0 16px;color:#1a1a2e;font-size:17px;">' + titulo + '</h2>' +
    '<div style="color:#333;font-size:14px;line-height:1.6;">' + cuerpoHtml + '</div>' +
    '</td></tr>' +
    '<tr><td style="padding:20px 28px 24px;">' +
    '<div style="border-top:1px solid #eee;padding-top:14px;color:#999;font-size:11px;">' +
    'Mudanzas TML, S.A. de C.V. — Este es un correo automático, por favor no respondas directamente a esta dirección.' +
    '</div></td></tr>' +
    '</table></td></tr></table></body></html>';
}
// calcularFechaLimiteRepServer(fechaPagoISO): por ley, el complemento de pago
// (REP) de un CFDI PPD se debe emitir a más tardar el día 8 del mes
// SIGUIENTE al del pago — sin importar el día exacto dentro del mes en que
// se pagó (ej. pagado el 30 de agosto o el 1 de septiembre, si ambos caen en
// agosto/septiembre respectivamente, el límite cae en el mes siguiente a
// cada uno).
function _calcularFechaLimiteRepServer(fechaPagoISO) {
  const d = new Date((fechaPagoISO || new Date().toISOString().slice(0, 10)) + 'T12:00:00');
  let mes = d.getMonth() + 2; // getMonth() es 0-indexado; +2 = mes siguiente, 1-indexado
  let anio = d.getFullYear();
  if (mes > 12) { mes -= 12; anio++; }
  return anio + '-' + String(mes).padStart(2, '0') + '-08';
}
// _enviarCorreoFacturaRecibida: usado tanto por el Buzón de Compras (registro
// automático) como por el registro manual (exports.enviarConfirmacionFacturaRecibida,
// ver abajo) para no duplicar el texto del correo en dos lugares.
async function _enviarCorreoFacturaRecibida(user, pass, proveedor, data, diasCredito, fechaVencimiento) {
  if (!proveedor || !proveedor.email) return false;
  await _enviarCorreoCompras(user, pass, proveedor.email,
    'Factura ' + (data.serie ? data.serie + '-' : '') + data.folio + ' recibida',
    _plantillaCorreoCxP(
      '✅ Factura recibida',
      '#2a9d8f',
      '<p>Hola <strong>' + (proveedor.razonSocial || '') + '</strong>,</p>' +
      '<p>Recibimos y registramos tu factura <strong>' + (data.serie ? data.serie + '-' : '') + data.folio + '</strong> por ' +
      '<strong style="color:#1a1a2e;">' + _fmtMonedaServer(data.total) + '</strong>.</p>' +
      '<p style="background:#f2f9f8;border-left:3px solid #2a9d8f;padding:10px 14px;border-radius:4px;">' +
      'Fecha estimada de pago: <strong>' + fechaVencimiento + '</strong>' + (diasCredito === 0 ? ' (mismo día, sin días de crédito).' : '.') + '</p>' +
      '<p>Gracias.</p>'
    )
  );
  return true;
}
// _adjuntoComprobante(url): nodemailer acepta una URL http(s) directo como
// "path" de un adjunto y él mismo la descarga — no hace falta bajarla a mano
// aquí. Sin extensión reconocible se usa .jpg como respaldo (el comprobante
// casi siempre es foto o PDF).
function _adjuntoComprobante(comprobanteURL) {
  if (!comprobanteURL) return null;
  const sinQuery = comprobanteURL.split('?')[0];
  const ext = (sinQuery.split('.').pop() || 'jpg').toLowerCase().slice(0, 4);
  return [{ filename: 'comprobante-pago.' + ext, path: comprobanteURL }];
}
// _enviarCorreoPagoConfirmado: para facturas PUE — ahí el proceso termina en
// el pago mismo (no hay complemento de pago que solicitar), pero el
// proveedor de cualquier forma debe enterarse de que ya se le pagó. Antes
// las PUE no mandaban ningún correo al registrar el pago; las PPD sí lo
// traen implícito en el correo de solicitud de REP ("ya se realizó el
// pago..."), así que este solo se manda para PUE.
async function _enviarCorreoPagoConfirmado(user, pass, proveedor, fac, fechaPago, comprobanteURL) {
  if (!proveedor || !proveedor.email) return false;
  await _enviarCorreoCompras(user, pass, proveedor.email,
    'Pago realizado — factura ' + (fac.serie ? fac.serie + '-' : '') + fac.folio,
    _plantillaCorreoCxP(
      '✅ Tu factura ya fue pagada',
      '#2a9d8f',
      '<p>Hola <strong>' + (proveedor.razonSocial || fac.proveedorNombre || '') + '</strong>,</p>' +
      '<p>Te confirmamos que ya se realizó el pago de tu factura <strong>' + (fac.serie ? fac.serie + '-' : '') + fac.folio + '</strong> por ' +
      '<strong style="color:#1a1a2e;">' + _fmtMonedaServer(fac.total) + '</strong>, con fecha <strong>' + fechaPago + '</strong>.</p>' +
      (comprobanteURL ? '<p>Adjuntamos el comprobante del pago.</p>' : '') +
      '<p>Gracias.</p>'
    ),
    _adjuntoComprobante(comprobanteURL)
  );
  return true;
}

const PROMPT_INSTRUCCIONES =
  'Eres un asistente que extrae datos de correos de autorización de maniobras de una empresa de mudanzas (cliente fiscal: ' +
  'GRUPO COMERCIAL DSW, área operativa "Centros de Distribución"). El correo trae una o varias TABLAS (a veces varias tablas ' +
  'mezcladas con párrafos repetidos de cortesía entre ellas — ignora esos párrafos) con columnas como: Folio (a veces con encabezado "#"), Fecha ' +
  '(formato DD/MM/AAAA), Tienda (un CÓDIGO alfanumérico de la sucursal, ej. "1149" o "CC13" — NO es un nombre), Destino, ' +
  'Estado, Tipo de Unidad, T.U.\'s(1), T.U.\'s(2), Línea de Transporte (el nombre de la TRANSPORTISTA subcontratada de esa ' +
  'fila — MUY IMPORTANTE: extráela tal cual, NO la ignores — el correo a veces se manda con visibilidad compartida a VARIAS ' +
  'transportistas a la vez, así que puede traer filas de otras empresas mezcladas con las nuestras), Eco. (número económico ' +
  'del camión, a veces con sufijo de letras como "SV" — quédate solo con el número), Operador, Placas (ignora esta columna), ' +
  'y Autorizado (el monto). ' +
  'El correo casi nunca trae todas las columnas llenas — a veces falta el folio, a veces solo viene T.U.\'s(1), a veces ' +
  'los dos T.U.\'s, a veces ninguno — extrae TODO lo que sí aparezca en cada renglón, sin inventar lo que falte (usa null). ' +
  'Por cada renglón de la tabla (una fila = una maniobra) arma un objeto con estas llaves exactas: ' +
  '{"operador":"nombre tal cual aparece (puede tener errores de dedo, cópialo tal cual, no lo corrijas)",' +
  '"lineaTransporte":"el nombre de la transportista de esa fila (columna Línea de Transporte), tal cual aparece, o null si no aparece",' +
  '"eco":"solo el número económico, sin la letra SV ni espacios, o null si no aparece",' +
  '"monto": ver regla de abajo,' +
  '"fecha":"YYYY-MM-DD convertido desde DD/MM/AAAA, o null",' +
  '"folio":"el folio o # de esa fila, o null",' +
  '"tu1":"el valor de T.U.\'s(1) de esa fila, o null",' +
  '"tu2":"el valor de T.U.\'s(2) de esa fila, o null",' +
  '"tienda":"el código de tienda de esa fila, o null",' +
  '"destino":"Destino + \', \' + Estado de esa fila (ej. \'Salamanca Hidalgo, Guanajuato\'), o null"}. ' +
  'REGLA del campo "monto": si la columna Autorizado trae un número (con o sin "$"/comas), pon ese número. ' +
  'Si dice literalmente "NO PAGA" o solo "-" (sin ningún número), pon el texto "NO_PAGA" (esa maniobra no se paga, no es ' +
  'un dato faltante). Si dice literalmente "PENDIENTE" (el monto se va a confirmar después en otro correo), pon el texto ' +
  '"PENDIENTE". Si la celda está vacía o no se puede determinar, pon null. ' +
  'Extrae TODOS los renglones de TODAS las tablas del correo, sean de la transportista que sean — NO filtres tú por Línea de ' +
  'Transporte, eso lo hace el sistema después con el campo "lineaTransporte" que le des. ' +
  'CORRECCIONES DENTRO DEL MISMO CORREO: el texto que recibes a veces es un hilo completo con varias respuestas encimadas ' +
  '(correo reenviado o respondido varias veces, con el historial de mensajes anteriores pegado abajo) — en ese caso el MISMO ' +
  'folio puede aparecer más de una vez, con montos distintos, porque el monto se corrigió después de la autorización ' +
  'original. Reconoce una corrección cuando, en cualquier parte del texto, aparezca una frase como "envío corrección de ' +
  'maniobra(s)", "maniobras actualizadas", "maniobras corregidas", "monto actualizado", "comparto monto actualizado" (o muy ' +
  'similar) cerca de una tabla o de un folio — en ese caso, para ese folio, quédate SOLO con el monto de la versión más ' +
  'reciente/corregida (normalmente la que acompaña esa frase) y NO regreses también la versión vieja/original: son la MISMA ' +
  'maniobra, no dos. Si el mismo folio se repite con montos distintos y NO hay ninguna frase de corrección/actualización ' +
  'cerca, regresa ambas apariciones tal cual (dos renglones), para que el sistema se los muestre al humano y decida. ' +
  'Responde SOLO un arreglo JSON (sin texto explicativo, sin backticks, sin markdown) con un objeto por cada renglón de ' +
  'maniobra que encuentres en TODAS las tablas del correo (después de aplicar la regla de corrección de arriba). Si no hay ' +
  'ninguna tabla/renglón reconocible, responde [].';

// Llama a la API de Anthropic con el prompt de maniobras (PROMPT_INSTRUCCIONES)
// y regresa el arreglo de renglones ya parseado. Compartido entre el
// endpoint manual (extraerManiobras, ver botón "Extraer con IA") y el
// revisor automático del buzón (revisarBuzonManiobras, más abajo) para no
// duplicar la llamada a la IA en dos lugares.
async function extraerRenglonesConIA(content, apiKey) {
  const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: content }]
    })
  });
  const datos = await respuesta.json();
  if (datos.error) {
    throw new Error('Error de la API de Anthropic: ' + (datos.error.message || JSON.stringify(datos.error)));
  }
  const textoRespuesta = (datos.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('');
  const limpio = textoRespuesta.replace(/```json|```/g, '').trim();
  let renglones;
  try {
    renglones = JSON.parse(limpio);
  } catch (e) {
    throw new Error('La IA no regresó un JSON válido. Respuesta cruda: ' + textoRespuesta.slice(0, 500));
  }
  if (!Array.isArray(renglones)) renglones = [renglones];
  return renglones;
}

// ══════════════════════════════════════════════════════════════════════════
// extraerEstimado — para registrar en Ingresos un "Estimado de
// Transportación" (la cotización que Mudanzas TML le da al cliente ANTES
// de tener la factura real) sin captura manual, solo el administrador (ver
// botón "🤖 Registrar sin factura" en ing.html). A diferencia de la Carta
// Porte, este documento NO trae operador ni económico — eso lo sigue
// eligiendo el administrador a mano; la IA solo saca el resto.
// ══════════════════════════════════════════════════════════════════════════
const PROMPT_ESTIMADO =
  'Eres un asistente que extrae datos de un "Estimado de Transportación" (cotización que Mudanzas TML le da a un cliente ' +
  'antes de facturar, formato tipo formulario con Origen/Destino/Usuario/conceptos). Del texto que recibes, extrae un solo ' +
  'objeto JSON con estas llaves exactas: ' +
  '{"folio":"el número de cotización, normalmente con prefijo CTZ- (campo \'No. Cotz.\'), o null",' +
  '"fecha":"YYYY-MM-DD (convierte desde el formato que traiga, ej. 8/19/2026 o DD/MM/AAAA), o null",' +
  '"cliente":"el nombre del cliente/usuario final (campo \'USUARIO\'), o null",' +
  '"origen":"la dirección u origen del viaje (campo ORIGEN), o null",' +
  '"destino":"la dirección o destino del viaje (campo DESTINO), o null",' +
  '"flete":"suma de los conceptos de FLETE (busca la palabra Flete en la descripción del concepto), como número sin signos, o 0 si no hay",' +
  '"maniobras":"suma de los conceptos de MANIOBRA (Maniobra de Carga, Maniobra Descarga, Maniobras Especiales/Volados, etc.), como número, o 0 si no hay",' +
  '"otros":"suma de cualquier otro concepto que no sea flete ni maniobra (empaque, desempaque, guardamuebles, etc.), como número, o 0 si no hay",' +
  '"subtotal":"el SUBTOTAL del documento, como número",' +
  '"iva":"el I.V.A. del documento, como número (0 si viene vacío o en blanco)",' +
  '"retIva":"la RET I.V.A. del documento, como número (0 si viene vacío o en blanco)",' +
  '"total":"el TOTAL del documento, como número"}. ' +
  'Si algún campo no aparece o no se puede determinar, usa null (los numéricos usa 0). No inventes datos que no estén en el ' +
  'texto. Responde SOLO el objeto JSON (sin texto explicativo, sin backticks, sin markdown).';

// v2 — forzar redeploy para tomar la versión nueva del secret ANTHROPIC_API_KEY
// (Firebase no recoge un secret actualizado si no detecta cambios en el código).
exports.extraerEstimado = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true, region: 'us-central1' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método no permitido, usa POST.' });
      return;
    }
    const texto = ((req.body && req.body.texto) || '').toString().trim();
    const pdfBase64 = ((req.body && req.body.pdfBase64) || '').toString().trim();
    if (!texto && !pdfBase64) {
      res.status(400).json({ error: 'Falta el texto o el PDF del estimado (campo "texto" o "pdfBase64").' });
      return;
    }
    if (texto.length > 20000) {
      res.status(400).json({ error: 'El texto es demasiado largo (máximo 20,000 caracteres).' });
      return;
    }
    if (pdfBase64.length > 15000000) {
      res.status(400).json({ error: 'El PDF es demasiado grande (máximo ~10 MB).' });
      return;
    }
    try {
      // Si viene el PDF, se manda tal cual como documento — la IA lo lee
      // directo (conserva tablas/formato mejor que convertirlo a texto a
      // mano en el navegador). Si no, se manda el texto pegado, como antes.
      const content = pdfBase64
        ? [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: PROMPT_ESTIMADO }
          ]
        : PROMPT_ESTIMADO + '\n\n--- ESTIMADO ---\n' + texto;
      const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY.value(),
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1500,
          messages: [{ role: 'user', content: content }]
        })
      });
      const datos = await respuesta.json();
      if (datos.error) {
        res.status(502).json({ error: 'Error de la API de Anthropic: ' + (datos.error.message || JSON.stringify(datos.error)) });
        return;
      }
      const textoRespuesta = (datos.content || [])
        .filter(function (b) { return b.type === 'text'; })
        .map(function (b) { return b.text; })
        .join('');
      const limpio = textoRespuesta.replace(/```json|```/g, '').trim();
      let resultado;
      try {
        resultado = JSON.parse(limpio);
      } catch (e) {
        res.status(502).json({ error: 'La IA no regresó un JSON válido. Respuesta cruda: ' + textoRespuesta.slice(0, 500) });
        return;
      }
      res.json({ estimado: resultado });
    } catch (e) {
      console.error('extraerEstimado:', e);
      res.status(500).json({ error: e.message || 'Error interno del servidor.' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════
// revisarBuzonManiobras — revisa el buzón dedicado maniobras@mudandote.mx
// (IMAP, IONOS) por correos NUEVOS, le pasa cada uno a la misma IA de
// extraerManiobras, y guarda los renglones encontrados en
// estado/correosManiobrasPendientes para que Raúl los revise y registre
// desde maniobras.html (botón "📥 Revisar buzón ahora") — NUNCA se registran
// solos: la IA puede equivocarse, así que sigue pasando por la misma
// revisión manual de siempre antes de guardarse como autorización real.
//
// Por qué un buzón dedicado y no el correo personal de nadie: las
// credenciales de este buzón quedan guardadas como secret de Firebase para
// que la función pueda leerlas — si solo tuviera correos de maniobras
// reenviados/en copia, lo peor que se expone ahí es eso, nunca contraseñas
// ni correspondencia personal de alguien.
//
// ── CÓMO ACTIVARLO (una sola vez) ──────────────────────────────────────
// 1. firebase functions:secrets:set MANIOBRAS_EMAIL_USER
//    (pega: maniobras@mudandote.mx)
// 2. firebase functions:secrets:set MANIOBRAS_EMAIL_PASS
//    (pega la contraseña de ESE buzón, la que se configuró en IONOS)
// 3. cd functions && npm install   (jala imapflow y mailparser, nuevos aquí)
// 4. Desde la raíz del repo: firebase deploy --only functions
// 5. Copia la URL de "revisarBuzonManiobras" que muestra la terminal al
//    terminar y pégala en FUNCTION_URL_REVISAR_BUZON en maniobras.html.
// El revisor también corre solo 3 veces al día, a las 7:00, 14:00 y 22:00
// hrs (hora CDMX) — onSchedule, abajo. El botón en la página es nada más
// para no tener que esperar al probar.
// ══════════════════════════════════════════════════════════════════════════
// Descarga (con mailparser) y procesa con la IA un solo mensaje ya leído
// del buzón — separado para no repetir el try/catch por mensaje.
async function _procesarMensajeImap(rawBuffer, apiKey) {
  const { simpleParser } = require('mailparser');
  const parsed = await simpleParser(rawBuffer);
  const pdfAdjunto = (parsed.attachments || []).find(function (a) {
    return (a.contentType || '').indexOf('pdf') !== -1;
  });
  const content = pdfAdjunto
    ? [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfAdjunto.content.toString('base64') } },
        { type: 'text', text: PROMPT_INSTRUCCIONES }
      ]
    : PROMPT_INSTRUCCIONES + '\n\n--- CORREO ---\n' + (parsed.text || parsed.html || '').slice(0, 20000);
  return {
    renglones: await extraerRenglonesConIA(content, apiKey),
    asunto: parsed.subject || '(sin asunto)',
    de: (parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address) || '',
    fecha: parsed.date ? parsed.date.toISOString().slice(0, 10) : ''
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Registro automático de renglones "limpios" del buzón — versión en el
// servidor de la misma lógica que ya usa maniobras.html (filtro SILVIA/
// NO_PAGA, emparejar operador por económico/nombre, detectar folios
// repetidos como posible corrección, y las mismas reglas de duplicado/
// choque de _crearAutorizacionEnMemoria). Un renglón solo se registra SOLO
// si no trae ninguna señal de alerta — si algo no cuadra, se deja pendiente
// para revisión manual en Maniobras, exactamente como antes.
// ══════════════════════════════════════════════════════════════════════════
function _normTxtServer(s) { return (s || '').toString().trim().toUpperCase().replace(/\s+/g, ' '); }
// _idsDeObservacionesServer: mismo criterio que _idsDeObservaciones en
// maniobras.html — parte "FOLIO:2763 | TU1:6500360352 | TU2:6500360353" en
// sus identificadores exactos, en vez de comparar por "contiene" sobre el
// string completo (un folio corto como "603" hacía falso positivo con
// cualquier T.U. de 10 dígitos que lo trajera en medio, ej. "6500360352").
function _idsDeObservacionesServer(observaciones) {
  return (observaciones || '').split('|').map(function (s) { return _normTxtServer(s.replace(/^\s*[A-Z0-9]+:/, '')); }).filter(function (s) { return s; });
}

async function _cargarOperadoresServer() {
  const snap = await db.collection('operadores').where('activo', '==', true).get();
  const lista = [];
  snap.forEach(function (d) {
    const o = d.data();
    if (o.unidadActual == null) return;
    lista.push({ unidad: o.unidadActual, operadorId: parseInt(d.id), nombre: o.nombre || '' });
  });
  return lista;
}

// Mismo criterio que _matchOperadorPorNombre en maniobras.html: el económico
// solo se usa si el nombre concuerda con él (o no vino nombre), y también se
// intenta con un "4" antepuesto (521 -> 4521) si el número tal cual no
// coincide con nadie.
function _matchOperadorServer(operadores, nombre, eco) {
  const norm = function (s) { return (s || '').toString().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); };
  const palabras = norm(nombre).split(' ').filter(function (w) { return w.length > 2; });
  function scoreDe(op) {
    const opPalabras = norm(op.nombre).split(' ').filter(function (w) { return w.length > 2; });
    const coincidencias = palabras.filter(function (w) { return opPalabras.indexOf(w) !== -1; }).length;
    return coincidencias / Math.max(palabras.length, opPalabras.length, 1);
  }
  let porEco = null;
  if (eco) {
    const ecoNum = parseInt(String(eco).replace(/[^0-9]/g, '') || 0);
    if (ecoNum) porEco = operadores.find(function (o) { return o.unidad === ecoNum; }) || null;
    if (!porEco && ecoNum && ecoNum < 1000) {
      const ecoConPrefijo = parseInt('4' + ecoNum);
      porEco = operadores.find(function (o) { return o.unidad === ecoConPrefijo; }) || null;
    }
  }
  if (porEco && (!palabras.length || scoreDe(porEco) >= 0.3)) return porEco;
  if (!palabras.length) return null;
  let mejor = null, mejorScore = 0;
  operadores.forEach(function (op) {
    const score = scoreDe(op);
    if (score > mejorScore) { mejorScore = score; mejor = op; }
  });
  return mejorScore >= 0.4 ? mejor : null;
}

function _sumarDiasHabilesServer(fechaISO, n) {
  const d = new Date((fechaISO || new Date().toISOString().slice(0, 10)) + 'T12:00:00');
  let agregados = 0;
  while (agregados < n) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) agregados++;
  }
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function _buscarDuplicadoServer(ingresosDB, datos) {
  const unidad = parseInt(datos.unidad || 0);
  const monto = parseFloat(datos.monto || 0);
  const fecha = datos.fecha || '';
  const ids = [datos.folio, datos.pedido, datos.tu1, datos.tu2].map(_normTxtServer).filter(function (s) { return s; });
  if (!ids.length) return null;
  return ingresosDB.find(function (v) {
    if (!v.esAutorizacionCliente) return false;
    if (v.unidad !== unidad) return false;
    if (Math.abs((v.subtotal || 0) - monto) >= 0.01) return false;
    if ((v.fecha || '') !== fecha) return false;
    const vIds = _idsDeObservacionesServer(v.observaciones);
    return ids.some(function (id) { return vIds.indexOf(id) !== -1; });
  });
}

// Mismo núcleo que _crearAutorizacionEnMemoria en maniobras.html (candados
// de duplicado/choque/corrección/pendiente-actualizado idénticos) — muta
// ingresosDB en memoria y regresa {ok:true} o {ok:false,error}.
function _crearAutorizacionServer(ingresosDB, datos) {
  const unidad = parseInt(datos.unidad || 0);
  if (!unidad) return { ok: false, error: 'Falta el operador.' };
  const pendiente = !!datos.montoPendiente;
  const monto = parseFloat(datos.monto || 0);
  if (!pendiente && !monto) return { ok: false, error: 'Falta el monto.' };
  const folio = (datos.folio || '').trim();
  const pedido = (datos.pedido || '').trim();
  const tu1 = (datos.tu1 || '').trim();
  const tu2 = (datos.tu2 || '').trim();
  if (!folio && !pedido && !tu1 && !tu2) return { ok: false, error: 'Falta al menos un identificador (folio, pedido o T.U.\'s).' };
  const idsNuevos = [folio, pedido, tu1, tu2].map(_normTxtServer).filter(function (s) { return s; });

  if (!pendiente && monto) {
    const existentePendiente = ingresosDB.find(function (v) {
      if (!v.esAutorizacionCliente || !v.montoPendiente || v.sustituidoPorXML) return false;
      if (v.unidad !== unidad) return false;
      const vIds = _idsDeObservacionesServer(v.observaciones);
      return idsNuevos.some(function (id) { return vIds.indexOf(id) !== -1; });
    });
    if (existentePendiente) {
      const ivaExist = Math.round(monto * 0.16 * 100) / 100;
      existentePendiente.subtotal = monto; existentePendiente.subtManiobras = monto;
      existentePendiente.iva = ivaExist; existentePendiente.total = monto + ivaExist;
      existentePendiente.montoPendiente = false;
      return { ok: true, actualizado: true };
    }
  }

  const idsCorreccion = [folio, pedido].map(_normTxtServer).filter(function (s) { return s; });
  const existenteCorregible = (!pendiente && monto && idsCorreccion.length) ? ingresosDB.find(function (v) {
    if (!v.esAutorizacionCliente || v.montoPendiente || v.sustituidoPorXML) return false;
    if (v.unidad !== unidad) return false;
    const vIds = _idsDeObservacionesServer(v.observaciones);
    if (!idsCorreccion.some(function (id) { return vIds.indexOf(id) !== -1; })) return false;
    return Math.abs((v.subtotal || 0) - monto) >= 0.01;
  }) : null;
  if (existenteCorregible) {
    const ivaCorr = Math.round(monto * 0.16 * 100) / 100;
    existenteCorregible.subtotal = monto; existenteCorregible.subtManiobras = monto;
    existenteCorregible.iva = ivaCorr; existenteCorregible.total = monto + ivaCorr;
    return { ok: true, corregido: true };
  }

  const dup = _buscarDuplicadoServer(ingresosDB, datos);
  if (dup) return { ok: false, error: 'Ya existe una autorización igual (mismo operador, monto, fecha e identificador).' };

  const idsChoque = [folio, pedido].map(_normTxtServer).filter(function (s) { return s; });
  const choqueId = idsChoque.length ? ingresosDB.find(function (v) {
    if (!v.sinFacturaJustificar || v.sustituidoPorXML) return false;
    const vIds = _idsDeObservacionesServer(v.observaciones);
    return idsChoque.some(function (id) { return vIds.indexOf(id) !== -1; });
  }) : null;
  if (choqueId) return { ok: false, error: 'Alguno de esos identificadores ya está en uso por otro ingreso sin factura pendiente.' };

  const tuIds = [tu1, tu2].map(_normTxtServer).filter(function (s) { return s; });
  if (tuIds.length) {
    const yaConEsteTU = ingresosDB.filter(function (v) {
      if (!v.esAutorizacionCliente) return false;
      const vIds = _idsDeObservacionesServer(v.observaciones);
      return tuIds.some(function (id) { return vIds.indexOf(id) !== -1; });
    });
    if (yaConEsteTU.length >= 2) return { ok: false, error: 'Este T.U. ya tiene 2 autorizaciones registradas.' };
  }

  const idParts = [];
  if (folio) idParts.push('FOLIO:' + folio);
  if (pedido) idParts.push('PED:' + pedido);
  if (tu1) idParts.push('TU1:' + tu1);
  if (tu2) idParts.push('TU2:' + tu2);
  const idCombinado = idParts.join(' | ');
  const fecha = datos.fecha || new Date().toISOString().slice(0, 10);
  const cliente = (datos.cliente || '').trim() || 'GRUPO COMERCIAL DSW';
  const destino = (datos.destino || '').trim();
  const tienda = (datos.tienda || '').trim();
  const fechaLimite = _sumarDiasHabilesServer(fecha, 15) + 'T23:59:59';
  const montoGuardar = pendiente ? 0 : monto;
  const ivaGuardar = pendiente ? 0 : Math.round(monto * 0.16 * 100) / 100;
  ingresosDB.push({
    id: 'buz-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    unidad: unidad, folio: 'MANIOBRAS', fecha: fecha, cliente: cliente, tipo: 'maniobra',
    subtotal: montoGuardar, subtFlete: 0, subtManiobras: montoGuardar, subtOtros: 0,
    iva: ivaGuardar, ret: 0, total: montoGuardar + ivaGuardar, estado: 'sin_liquidar', liqNum: null,
    origen: 'autorizacion_cliente', ruta: destino ? [{ origen: '', destino: destino, kms: '' }] : [],
    tienda: tienda, observaciones: idCombinado, sinFacturaJustificar: true,
    fechaLimiteJustificacion: fechaLimite, montoPendiente: pendiente,
    capturadoPor: { usuario: 'buzón automático', nombre: 'Buzón automático' },
    creadoEn: new Date().toISOString(), depositoConfirmado: false,
    sustituidoPorXML: false, pdfURL: null, esAutorizacionCliente: true
  });
  return { ok: true };
}

// _crearProvisionalFleteServer: cuando un pedido de flete llega por correo Y
// trae el económico, se registra de inmediato como ingreso PROVISIONAL en
// ingresosDB (mismo criterio que las autorizaciones de maniobra) — así
// aparece en "Viajes registrados" aunque la factura real de Raúl todavía no
// exista. Se marca sinFacturaJustificar:true + origenFlete:true, y se
// sustituye solo cuando llega el XML real (ver parseXML/
// buscarIngresoFleteProvisional en ing.html). Sin económico no se puede
// atribuir a ningún operador, así que no se crea nada aquí — el pedido
// se queda solo en fletesDB hasta que se pueda cruzar.
// Las unidades 45xx a veces llegan del cliente/pedido de flete como "521"
// (sin el prefijo "4") — mismo mapeo que normUnidad() en liq.html para
// PASE/IAVE, necesario aquí también para no perder el cruce automático
// (caso real: unidad 4521 llegó como "521" y no se encontró en Flota).
const ECO_MAP_45XX = {521:4521,522:4522,523:4523,524:4524,526:4526};
function _normEconomico(eco) {
  const n = parseInt(String(eco || '').replace(/[^0-9]/g, '') || 0, 10) || 0;
  return ECO_MAP_45XX[n] || n;
}
function _crearProvisionalFleteServer(ingresosDB, operadores, datos) {
  const ecoNum = datos.economico ? _normEconomico(datos.economico) : 0;
  if (!ecoNum) return { ok: false, error: 'sin económico' };
  const op = operadores.find(function (o) { return o.unidad === ecoNum; });
  if (!op) return { ok: false, error: 'económico no encontrado en Flota' };
  const idParts = [];
  if (datos.ordenEmbarque) idParts.push('TU1:' + datos.ordenEmbarque);
  if (datos.tu2) idParts.push('TU2:' + datos.tu2);
  if (datos.pedidoFlete) idParts.push('PED:' + datos.pedidoFlete);
  if (!idParts.length) return { ok: false, error: 'sin identificador' };
  const idCombinado = idParts.join(' | ');
  const yaExiste = ingresosDB.some(function (v) { return v.origenFlete && v.observaciones === idCombinado; });
  if (yaExiste) return { ok: false, error: 'ya existe' };
  const monto = datos.montoFlete != null ? parseFloat(datos.montoFlete) || 0 : 0;
  const pendiente = !monto;
  const iva = pendiente ? 0 : Math.round(monto * 0.16 * 100) / 100;
  const fecha = datos.fecha || new Date().toISOString().slice(0, 10);
  const destino = (datos.destino || '').trim();
  ingresosDB.push({
    id: 'flete-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    unidad: op.operadorId, folio: 'FLETE', fecha: fecha, cliente: (datos.cliente || '').trim() || 'GRUPO COMERCIAL DSW',
    tipo: 'flete_for', subtotal: monto, subtFlete: monto, subtManiobras: 0, subtOtros: 0,
    iva: iva, ret: 0, total: monto + iva, estado: 'sin_liquidar', liqNum: null,
    origen: 'pedido_flete', origenFlete: true,
    ruta: destino ? [{ origen: '', destino: destino, kms: '' }] : [],
    tienda: (datos.tienda || '').trim(), observaciones: idCombinado, sinFacturaJustificar: true,
    fechaLimiteJustificacion: _sumarDiasHabilesServer(fecha, 15) + 'T23:59:59', montoPendiente: pendiente,
    capturadoPor: { usuario: 'buzón automático', nombre: 'Buzón automático (fletes@mudandote.mx)' },
    creadoEn: new Date().toISOString(),
    sustituidoPorXML: false, pdfURL: null, esAutorizacionCliente: false
  });
  return { ok: true };
}

// Filtra SILVIA/NO_PAGA (igual que _procesarRenglonesExtraidos), detecta
// posible corrección (folio repetido con monto real distinto DENTRO del
// mismo correo), y por cada renglón que quede: si el operador se encontró
// con seguridad y no hay corrección ambigua, intenta registrarlo directo
// (ingresosDB en memoria); si algo bloquea el registro o hay cualquier
// señal de alerta, ese renglón CRUDO se regresa para la lista de pendientes
// — nunca se inventa ni se fuerza nada, solo se salta el paso manual cuando
// de verdad no hace falta revisión.
function _clasificarYRegistrar(renglonesCrudos, ingresosDB, operadores) {
  const normLinea = function (s) { return (s || '').toString().trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
  const silvia = renglonesCrudos.filter(function (x) {
    const linea = normLinea(x.lineaTransporte);
    return !linea || linea === 'SILVIA';
  });
  const utiles = silvia.filter(function (x) {
    const m = (x.monto == null) ? '' : String(x.monto).trim().toUpperCase();
    return m !== 'NO_PAGA' && m !== 'NO PAGA' && m !== '-';
  });
  // Folios repetidos con monto real distinto (mismo criterio que
  // maniobras.html: se ignoran las filas PENDIENTE en esta comparación).
  const porFolio = {};
  utiles.forEach(function (x) {
    if (!x.folio) return;
    (porFolio[x.folio] = porFolio[x.folio] || []).push(x);
  });
  const folioConCorreccion = {};
  Object.keys(porFolio).forEach(function (folio) {
    const grupo = porFolio[folio].filter(function (x) { return String(x.monto || '').trim().toUpperCase() !== 'PENDIENTE'; });
    const montos = Array.from(new Set(grupo.map(function (x) { return String(x.monto || '').trim(); })));
    if (grupo.length > 1 && montos.length > 1) folioConCorreccion[folio] = true;
  });

  let registrados = 0;
  const pendientes = [];
  utiles.forEach(function (x) {
    if (x.folio && folioConCorreccion[x.folio]) { pendientes.push(x); return; }
    const match = _matchOperadorServer(operadores, x.operador, x.eco);
    if (!match) { pendientes.push(x); return; }
    const mRaw = (x.monto == null) ? '' : String(x.monto).trim().toUpperCase();
    const montoPendiente = (mRaw === 'PENDIENTE');
    const r = _crearAutorizacionServer(ingresosDB, {
      unidad: match.operadorId, monto: montoPendiente ? '' : (x.monto || ''), montoPendiente: montoPendiente,
      fecha: x.fecha, folio: x.folio, pedido: x.pedido, tu1: x.tu1, tu2: x.tu2,
      tienda: x.tienda, destino: x.destino
    });
    if (r.ok) registrados++; else pendientes.push(x);
  });
  return { pendientes: pendientes, registrados: registrados };
}

// node-imap (librería distinta a imapflow — más antigua y probada; imapflow
// se quedaba pegada al conectar en este entorno de Cloud Functions aunque el
// login IMAP crudo, sin librería, respondía en menos de 1 segundo — ver
// pingImapLogin, era algo específico de esa librería, no de la red).
function _revisarBuzonCore(apiKey, user, pass) {
  const Imap = require('imap');
  return new Promise(function (resolveTodo, rejectTodo) {
    const imap = new Imap({ user: user, password: pass, host: 'imap.ionos.mx', port: 993, tls: true, connTimeout: 20000, authTimeout: 20000 });
    const encontrados = [];
    // El cierre de la conexión (LOGOUT/TLS) se puede quedar colgado en este
    // entorno (mismo tipo de problema que tuvimos con imapflow al conectar).
    // Por eso resolvemos en cuanto terminamos de procesar los correos —
    // imap.end() solo se usa para cerrar limpio, sin esperar su evento 'end'.
    let resuelto = false;
    function terminar(encontrados) {
      if (resuelto) return;
      resuelto = true;
      resolveTodo(encontrados);
    }
    imap.once('error', function (err) { console.error('revisarBuzonManiobras: imap error:', err); rejectTodo(err); });
    imap.once('ready', function () {
      console.log('revisarBuzonManiobras: conectado, abriendo INBOX...');
      imap.openBox('INBOX', false, function (err, box) {
        if (err) { console.error('revisarBuzonManiobras: error abriendo INBOX:', err); imap.end(); rejectTodo(err); return; }
        console.log('revisarBuzonManiobras: INBOX abierto, buscando UNSEEN...');
        imap.search(['UNSEEN'], function (err, uids) {
          if (err) { console.error('revisarBuzonManiobras: error en search:', err); imap.end(); rejectTodo(err); return; }
          console.log('revisarBuzonManiobras: search encontró', uids ? uids.length : 0, 'correo(s):', JSON.stringify(uids));
          if (!uids || !uids.length) { imap.end(); terminar(encontrados); return; }
          const f = imap.fetch(uids, { bodies: '', markSeen: true });
          const pendientes = [];
          f.on('message', function (msg, seqno) {
            console.log('revisarBuzonManiobras: mensaje #' + seqno + ' — empezando a recibir cuerpo...');
            const partes = [];
            msg.on('body', function (stream) {
              stream.on('data', function (chunk) { partes.push(chunk); });
            });
            msg.once('end', function () {
              const raw = Buffer.concat(partes);
              console.log('revisarBuzonManiobras: mensaje #' + seqno + ' descargado (' + raw.length + ' bytes), procesando con IA...');
              pendientes.push(
                _procesarMensajeImap(raw, apiKey)
                  .then(function (r) {
                    console.log('revisarBuzonManiobras: mensaje #' + seqno + ' procesado, ' + (r.renglones || []).length + ' renglón(es).');
                    encontrados.push(Object.assign({ error: null, revisadoEn: new Date().toISOString() }, r));
                  })
                  .catch(function (e) {
                    console.error('revisarBuzonManiobras: error procesando mensaje #' + seqno + ':', e);
                    encontrados.push({ error: e.message || String(e), renglones: [], asunto: '(error al procesar)', de: '', fecha: '', revisadoEn: new Date().toISOString() });
                  })
              );
            });
          });
          f.once('error', function (err) { console.error('revisarBuzonManiobras: error en fetch:', err); imap.end(); rejectTodo(err); });
          f.once('end', function () {
            console.log('revisarBuzonManiobras: fetch terminado, esperando a que terminen de procesarse los ' + pendientes.length + ' mensaje(s)...');
            Promise.all(pendientes).then(function () {
              console.log('revisarBuzonManiobras: todos procesados, encontrados.length=' + encontrados.length + ', cerrando conexión.');
              imap.end();
              terminar(encontrados);
            }).catch(function (e) {
              console.error('revisarBuzonManiobras: error inesperado esperando pendientes:', e);
              imap.end();
              rejectTodo(e);
            });
          });
        });
      });
    });
    imap.once('end', function () { terminar(encontrados); });
    imap.connect();
  }).then(async function (encontrados) {
    if (encontrados.length) {
      try {
        // Clasifica y registra directo lo "limpio" (sin ninguna señal de
        // alerta) — lo demás se queda para revisión manual, igual que
        // antes. Se lee ingresosDB UNA vez aquí (justo antes de mutarlo en
        // memoria) y se escribe UNA vez al final, mismo criterio de
        // "releer justo antes de escribir" que ya usa el resto del sistema.
        const operadores = await _cargarOperadoresServer();
        const refIngresos = db.collection('estado').doc('ingresosDB');
        const snapIngresos = await refIngresos.get();
        const ingresosDB = (snapIngresos.exists && snapIngresos.data().data) ? JSON.parse(snapIngresos.data().data) : [];
        let totalRegistrados = 0;
        encontrados.forEach(function (c) {
          if (c.error || !c.renglones || !c.renglones.length) return;
          const r = _clasificarYRegistrar(c.renglones, ingresosDB, operadores);
          totalRegistrados += r.registrados;
          c.renglones = r.pendientes;
        });
        if (totalRegistrados) {
          console.log('revisarBuzonManiobras: ' + totalRegistrados + ' renglón(es) registrado(s) automático (sin alertas).');
          await refIngresos.set({ data: JSON.stringify(ingresosDB) });
        }
        encontrados._totalRegistrados = totalRegistrados;
      } catch (e) {
        console.error('revisarBuzonManiobras: error clasificando/registrando renglones limpios (se deja todo pendiente de revisión manual):', e);
      }
      // Solo se guardan como pendientes los correos que SÍ traen algo por
      // revisar (con error de lectura, o con renglones que no se pudieron
      // registrar solos) — un correo que quedó 100% registrado ya no
      // aparece en la lista de pendientes.
      const conAlgoPendiente = encontrados.filter(function (c) { return c.error || (c.renglones && c.renglones.length); });
      if (conAlgoPendiente.length) {
        // Nunca sobrescribir: leer lo que ya había pendiente de revisar y
        // agregar los nuevos correos al final (mismo principio que
        // ingresosDB/anticiposDB — fusionar, no reemplazar en bloque).
        try {
          console.log('revisarBuzonManiobras: guardando ' + conAlgoPendiente.length + ' correo(s) pendiente(s) de revisión en Firestore...');
          const ref = db.collection('estado').doc('correosManiobrasPendientes');
          const snap = await ref.get();
          const previos = (snap.exists && snap.data().data) ? JSON.parse(snap.data().data) : [];
          await ref.set({ data: JSON.stringify(previos.concat(conAlgoPendiente)) });
          console.log('revisarBuzonManiobras: guardado en Firestore exitoso.');
        } catch (e) {
          console.error('revisarBuzonManiobras: error guardando en Firestore:', e);
          throw e;
        }
      }
    }
    return encontrados;
  });
}

// Diagnóstico temporal: solo prueba si Cloud Functions puede abrir un socket
// TLS hacia imap.ionos.mx:993 (con límite de 10s, no 5 minutos como el
// revisor completo) — para confirmar rápido si el problema es de red/bloqueo
// antes de meterle más tiempo a IMAP/mailparser. Se puede borrar en cuanto
// se resuelva la conexión.
exports.pingImap = onRequest({ cors: true, region: 'us-central1', timeoutSeconds: 20 }, async (req, res) => {
  const tls = require('tls');
  const inicio = Date.now();
  try {
    const resultado = await new Promise((resolve, reject) => {
      const socket = tls.connect({ host: 'imap.ionos.mx', port: 993, timeout: 10000 }, () => {
        resolve('conectado en ' + (Date.now() - inicio) + 'ms');
        socket.end();
      });
      socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout tras ' + (Date.now() - inicio) + 'ms')); });
      socket.on('error', (e) => reject(e));
    });
    res.json({ ok: true, resultado: resultado });
  } catch (e) {
    res.json({ ok: false, error: e.message, ms: Date.now() - inicio });
  }
});

// Diagnóstico 2: hace el LOGIN de IMAP a mano (sin imapflow) para ver si el
// bloqueo está en la librería o en el protocolo/credenciales en sí — lee la
// respuesta cruda del servidor a cada paso.
exports.pingImapLogin = onRequest(
  { secrets: [MANIOBRAS_EMAIL_USER, MANIOBRAS_EMAIL_PASS], cors: true, region: 'us-central1', timeoutSeconds: 20 },
  async (req, res) => {
    const tls = require('tls');
    const inicio = Date.now();
    const pasos = [];
    try {
      const resultado = await new Promise((resolve, reject) => {
        const socket = tls.connect({ host: 'imap.ionos.mx', port: 993, timeout: 15000 });
        let buffer = '';
        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          pasos.push({ ms: Date.now() - inicio, recibido: chunk.toString('utf8').slice(0, 300) });
          if (buffer.indexOf('* OK') !== -1 && !socket._enviadoLogin) {
            socket._enviadoLogin = true;
            const user = MANIOBRAS_EMAIL_USER.value();
            const pass = MANIOBRAS_EMAIL_PASS.value();
            socket.write('a1 LOGIN "' + user + '" "' + pass + '"\r\n');
          } else if (/^a1 (OK|NO|BAD)/m.test(buffer)) {
            resolve('login respondió: ' + buffer.split('\n').find(function (l) { return l.indexOf('a1 ') === 0; }));
            socket.end();
          }
        });
        socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout tras ' + (Date.now() - inicio) + 'ms')); });
        socket.on('error', (e) => reject(e));
      });
      res.json({ ok: true, resultado: resultado, pasos: pasos });
    } catch (e) {
      res.json({ ok: false, error: e.message, ms: Date.now() - inicio, pasos: pasos });
    }
  }
);

exports.revisarBuzonManiobras = onRequest(
  { secrets: [ANTHROPIC_API_KEY, MANIOBRAS_EMAIL_USER, MANIOBRAS_EMAIL_PASS], cors: true, region: 'us-central1', timeoutSeconds: 300 },
  async (req, res) => {
    try {
      const encontrados = await _revisarBuzonCore(ANTHROPIC_API_KEY.value(), MANIOBRAS_EMAIL_USER.value(), MANIOBRAS_EMAIL_PASS.value());
      res.json({ ok: true, correosNuevos: encontrados.length, renglonesRegistrados: encontrados._totalRegistrados || 0 });
    } catch (e) {
      console.error('revisarBuzonManiobras:', e);
      res.status(500).json({ error: e.message || 'Error interno del servidor.' });
    }
  }
);

// Corre 3 veces al día (7:00, 14:00, 22:00 hrs CDMX) — así aunque nadie
// entre a la página, los correos nuevos se van juntando en
// estado/correosManiobrasPendientes para cuando alguien entre a revisarlos.
// Guarda SIEMPRE (éxito o error) un registro en
// estado/buzonManiobrasEstado — antes, si algo fallaba aquí, el único rastro
// quedaba en los logs de Cloud Functions (solo visibles desde Cloud Shell);
// ahora se puede consultar directo desde Firestore.
exports.revisarBuzonManiobrasProgramado = onSchedule(
  { schedule: '0 * * * *', timeZone: 'America/Mexico_City', secrets: [ANTHROPIC_API_KEY, MANIOBRAS_EMAIL_USER, MANIOBRAS_EMAIL_PASS], region: 'us-central1', timeoutSeconds: 300 },
  async () => {
    const inicio = new Date().toISOString();
    try {
      const encontrados = await _revisarBuzonCore(ANTHROPIC_API_KEY.value(), MANIOBRAS_EMAIL_USER.value(), MANIOBRAS_EMAIL_PASS.value());
      await db.collection('estado').doc('buzonManiobrasEstado').set({
        ultimaEjecucion: inicio, ok: true, correosNuevos: encontrados.length, renglonesRegistrados: encontrados._totalRegistrados || 0, error: null
      });
    } catch (e) {
      console.error('revisarBuzonManiobrasProgramado:', e);
      try {
        await db.collection('estado').doc('buzonManiobrasEstado').set({
          ultimaEjecucion: inicio, ok: false, correosNuevos: 0, error: e.message || String(e)
        });
      } catch (e2) {
        console.error('revisarBuzonManiobrasProgramado: no se pudo guardar el estado del error:', e2);
      }
    }
  }
);

exports.extraerManiobras = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true, region: 'us-central1' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método no permitido, usa POST.' });
      return;
    }
    const texto = ((req.body && req.body.texto) || '').toString().trim();
    const pdfBase64 = ((req.body && req.body.pdfBase64) || '').toString().trim();
    if (!texto && !pdfBase64) {
      res.status(400).json({ error: 'Falta el texto o el PDF del correo (campo "texto" o "pdfBase64").' });
      return;
    }
    if (texto.length > 20000) {
      res.status(400).json({ error: 'El texto es demasiado largo (máximo 20,000 caracteres).' });
      return;
    }
    if (pdfBase64.length > 15000000) {
      res.status(400).json({ error: 'El PDF es demasiado grande (máximo ~10 MB).' });
      return;
    }
    try {
      // Si viene el PDF (correo exportado/impreso a PDF), se manda tal cual
      // como documento — la IA lo lee directo, igual que extraerEstimado.
      const content = pdfBase64
        ? [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: PROMPT_INSTRUCCIONES }
          ]
        : PROMPT_INSTRUCCIONES + '\n\n--- CORREO ---\n' + texto;
      const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY.value(),
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 4000,
          messages: [{ role: 'user', content: content }]
        })
      });
      const datos = await respuesta.json();
      if (datos.error) {
        res.status(502).json({ error: 'Error de la API de Anthropic: ' + (datos.error.message || JSON.stringify(datos.error)) });
        return;
      }
      const textoRespuesta = (datos.content || [])
        .filter(function (b) { return b.type === 'text'; })
        .map(function (b) { return b.text; })
        .join('');
      const limpio = textoRespuesta.replace(/```json|```/g, '').trim();
      let renglones;
      try {
        renglones = JSON.parse(limpio);
      } catch (e) {
        res.status(502).json({ error: 'La IA no regresó un JSON válido. Respuesta cruda: ' + textoRespuesta.slice(0, 500) });
        return;
      }
      if (!Array.isArray(renglones)) renglones = [renglones];
      res.json({ renglones: renglones });
    } catch (e) {
      console.error('extraerManiobras:', e);
      res.status(500).json({ error: e.message || 'Error interno del servidor.' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════
// extraerJustificacionCxP — Cuentas por Pagar (proveedores.html): algunos
// proveedores mandan, junto con su factura, un documento de justificación
// (ej. reporte de monitoreo GPS, desglose de viajes) detallando qué unidad
// se atendió cada vez. Esta función solo EXTRAE los renglones (unidad,
// fecha, descripción) — el prorrateo proporcional entre unidades y el
// emparejamiento con el operador real se hace en el navegador
// (proveedores.html), y SIEMPRE se le muestra al administrador para
// revisar/ajustar antes de guardar, nunca se aplica solo.
// ══════════════════════════════════════════════════════════════════════════
const PROMPT_JUSTIFICACION_CXP =
  'Eres un asistente que extrae datos de un documento de JUSTIFICACIÓN que un proveedor envía junto con su factura, ' +
  'detallando los servicios que prestó por unidad/camión (ej. un reporte de monitoreo GPS, un desglose de viajes, un ' +
  'listado de servicios por unidad/económico). El documento puede venir como tabla o como texto libre. ' +
  'IMPORTANTE — revisa primero si el documento trae, en algún lado (normalmente al principio, al final, o en una página ' +
  'aparte), un RESUMEN o CONCENTRADO ya agrupado por unidad/económico (ej. una tabla con columnas como "Unidad" y ' +
  '"Cantidad de viajes/servicios", o un renglón tipo "Unidad 4522: 50 viajes"). Ese resumen es la fuente de verdad — si ' +
  'existe, úsalo en vez de contar tú mismo las filas de un listado detallado línea por línea (reportes de monitoreo GPS ' +
  'largos con muchas filas por unidad son fáciles de contar mal a mano; el resumen ya viene calculado por el proveedor y ' +
  'es más confiable). Si el resumen indica, por ejemplo, "Unidad 4522: 50 viajes", regresa 50 renglones con ' +
  '"unidad":"4522" (uno por cada viaje que indique el resumen), no solo uno. Si el documento NO trae ningún resumen así ' +
  'y solo viene el listado detallado, entonces sí cuenta cada línea reconocible del listado como un renglón (como antes). ' +
  'En cualquiera de los dos casos, cada renglón lleva estas llaves exactas: ' +
  '{"unidad":"el número económico o identificador de la unidad tal cual aparece, o null si no se puede determinar",' +
  '"fecha":"YYYY-MM-DD si se puede convertir desde el formato que traiga, o null","descripcion":"una descripción breve ' +
  '(tipo de servicio, ruta, concepto), o null"}. ' +
  'No inventes datos que no estén en el documento. Responde SOLO un arreglo JSON (sin texto explicativo, sin ' +
  'backticks, sin markdown) con un objeto por cada renglón. Si no hay ningún renglón reconocible, responde [].';

exports.extraerJustificacionCxP = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true, region: 'us-central1' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método no permitido, usa POST.' });
      return;
    }
    const texto = ((req.body && req.body.texto) || '').toString().trim();
    const pdfBase64 = ((req.body && req.body.pdfBase64) || '').toString().trim();
    if (!texto && !pdfBase64) {
      res.status(400).json({ error: 'Falta el texto o el PDF de la justificación (campo "texto" o "pdfBase64").' });
      return;
    }
    if (texto.length > 20000) {
      res.status(400).json({ error: 'El texto es demasiado largo (máximo 20,000 caracteres).' });
      return;
    }
    if (pdfBase64.length > 15000000) {
      res.status(400).json({ error: 'El PDF es demasiado grande (máximo ~10 MB).' });
      return;
    }
    try {
      const content = pdfBase64
        ? [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: PROMPT_JUSTIFICACION_CXP }
          ]
        : PROMPT_JUSTIFICACION_CXP + '\n\n--- DOCUMENTO ---\n' + texto;
      const renglones = await extraerRenglonesConIA(content, ANTHROPIC_API_KEY.value());
      res.json({ renglones: renglones });
    } catch (e) {
      console.error('extraerJustificacionCxP:', e);
      res.status(500).json({ error: e.message || 'Error interno del servidor.' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════
// BUZÓN DE COMPRAS (compras@mudandote.mx) — Cuentas por Pagar, Fase 2.
// Igual que el buzón de Maniobras: lee por IMAP los correos no leídos donde
// los proveedores mandan su CFDI de factura por pagar. Si el proveedor ya
// está dado de alta y activo en Proveedores, y el CFDI pasa los mismos
// candados de Fase 1 (UUID único, tipo I/E, receptor=Mudanzas TML,
// aritmética), la factura se registra SOLA — pero SIN prorratear todavía
// (eso sigue siendo decisión humana: a qué unidad/operador corresponde el
// gasto), queda con estadoProrrateo:'pendiente_prorrateo' para que se
// prorratee después desde Proveedores. Si algo no cuadra (proveedor no
// encontrado/inactivo, RFC receptor distinto, aritmética no cuadra,
// duplicado), el correo se deja pendiente de revisión manual — nunca se
// fuerza nada.
// ══════════════════════════════════════════════════════════════════════════

// parseCfdiProveedorServer(xmlText): mismo criterio que parseCfdiProveedor en
// proveedores.html, pero con una librería real de XML (fast-xml-parser) en
// vez de DOMParser (que no existe en Node) — removeNSPrefix hace que
// cfdi:Comprobante/tfd:TimbreFiscalDigital/etc. lleguen sin el prefijo, y al
// venir como árbol de objetos (no texto plano) "Comprobante.Impuestos" NUNCA
// se puede confundir con el Impuestos de dentro de un Concepto (child
// distinto en el árbol), a diferencia de un parseo por regex.
function _parseCfdiProveedorServer(xmlText) {
  const { XMLParser } = require('fast-xml-parser');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true });
  let obj;
  try { obj = parser.parse(xmlText); } catch (e) { return { ok: false, error: 'No se pudo leer el XML: ' + e.message }; }
  const comp = obj && obj.Comprobante;
  if (!comp) return { ok: false, error: 'No es un CFDI válido (no se encontró el nodo Comprobante).' };
  const emisor = comp.Emisor;
  const receptor = comp.Receptor;
  const tfd = comp.Complemento && comp.Complemento.TimbreFiscalDigital;
  if (!emisor || !receptor || !tfd) return { ok: false, error: 'El XML no trae Emisor, Receptor o Timbre Fiscal Digital — no es un CFDI timbrado válido.' };
  const subtotal = parseFloat(comp['@_SubTotal'] || 0);
  const total = parseFloat(comp['@_Total'] || 0);
  const impResumen = comp.Impuestos || {};
  const traslados = parseFloat(impResumen['@_TotalImpuestosTrasladados'] || 0);
  const retenciones = parseFloat(impResumen['@_TotalImpuestosRetenidos'] || 0);
  return {
    ok: true,
    data: {
      uuid: (tfd['@_UUID'] || '').toUpperCase(),
      serie: comp['@_Serie'] || '', folio: comp['@_Folio'] || '',
      tipoComprobante: comp['@_TipoDeComprobante'] || '',
      metodoPago: comp['@_MetodoPago'] || '', formaPago: comp['@_FormaPago'] || '',
      fechaEmision: (comp['@_Fecha'] || '').slice(0, 10),
      subtotal: subtotal, traslados: traslados, retenciones: retenciones, total: total,
      rfcEmisor: (emisor['@_Rfc'] || '').toUpperCase(), nombreEmisor: emisor['@_Nombre'] || '',
      rfcReceptor: (receptor['@_Rfc'] || '').toUpperCase()
    }
  };
}

// Mismos candados de Fase 1 que evaluarCandados() en proveedores.html.
// "Proveedor registrado y activo" YA NO bloquea el registro (bloqueante:
// false) — una factura de un proveedor que todavía no se da de alta se
// registra igual para pago, solo que sin días de crédito (se trata como
// vencimiento inmediato) hasta que se dé de alta con sus datos reales; los
// demás candados (fiscales/de integridad del CFDI) siguen bloqueando.
async function _evaluarCandadosCxPServer(data) {
  const candados = [];
  const yaExiste = (await db.collection('cxpFacturas').doc(data.uuid).get()).exists;
  candados.push({ label: 'UUID único', ok: !yaExiste, bloqueante: true });
  candados.push({ label: 'Tipo de comprobante I/E', ok: data.tipoComprobante === 'I' || data.tipoComprobante === 'E', bloqueante: true });
  candados.push({ label: 'Receptor = Mudanzas TML', ok: data.rfcReceptor === TML_RFC, bloqueante: true });
  const aritmetica = Math.abs((data.subtotal + data.traslados - data.retenciones) - data.total) < 0.02;
  candados.push({ label: 'Aritmética del CFDI', ok: aritmetica, bloqueante: true });
  const provSnap = await db.collection('proveedores').doc(data.rfcEmisor).get();
  const proveedor = provSnap.exists ? Object.assign({ rfc: data.rfcEmisor }, provSnap.data()) : null;
  const proveedorOk = !!proveedor && proveedor.activo !== false;
  candados.push({ label: 'Proveedor registrado y activo', ok: proveedorOk, bloqueante: false });
  // Si el proveedor no mandó a tiempo el complemento de pago (REP) de una
  // factura ya pagada, se bloquea (ver revisarComplementosPagoProgramado) —
  // sus facturas nuevas quedan pendientes de revisión manual en vez de
  // registrarse solas hasta que se resuelva. Si el proveedor ni siquiera
  // está registrado, este candado sale ok trivialmente (nunca puede estar
  // bloqueado por REP algo que no existe) — el candado de arriba ya avisa.
  candados.push({ label: 'Proveedor no bloqueado por complemento de pago pendiente', ok: !(proveedor && proveedor.bloqueadoPorRep), bloqueante: true });
  const todosOk = candados.every(function (c) { return c.bloqueante === false || c.ok; });
  return { candados: candados, proveedor: proveedor, todosOk: todosOk };
}

// Además del XML, algunos proveedores mandan en el MISMO correo un PDF con
// el desglose por unidad (ej. reporte de monitoreo GPS, listado de viajes)
// que justifica el total cobrado — se lee con la misma IA/prompt que ya usa
// extraerJustificacionCxP (ver PROMPT_JUSTIFICACION_CXP) para poder armar la
// sugerencia de prorrateo sin que Esa tenga que volver a subir el PDF a mano.
// parseComplementoPagoServer(xmlText): el proveedor contesta al correo de
// "solicitud de complemento de pago" (ver enviarSolicitudComplementoPago)
// con el XML del REP (Pagos20) — aquí solo se extrae el UUID del propio
// complemento y, de cada <Pago><DoctoRelacionado>, el UUID de la factura que
// relaciona y el monto que le aplica. El emparejamiento real con la factura
// en cxpFacturas se hace en _revisarBuzonComprasCore.
function _parseComplementoPagoServer(xmlText) {
  const { XMLParser } = require('fast-xml-parser');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true });
  let obj;
  try { obj = parser.parse(xmlText); } catch (e) { return { ok: false, error: 'No se pudo leer el XML: ' + e.message }; }
  const comp = obj && obj.Comprobante;
  if (!comp) return { ok: false, error: 'No es un CFDI válido (no se encontró el nodo Comprobante).' };
  const tfd = comp.Complemento && comp.Complemento.TimbreFiscalDigital;
  const pagosNodo = comp.Complemento && comp.Complemento.Pagos;
  if (!tfd || !pagosNodo) return { ok: false, error: 'El XML no trae Timbre Fiscal Digital o el complemento de Pagos (Pagos20) — ¿seguro que es un complemento de pago (REP)?' };
  let pagos = pagosNodo.Pago || [];
  if (!Array.isArray(pagos)) pagos = [pagos];
  const doctos = [];
  pagos.forEach(function (pago) {
    let rel = pago.DoctoRelacionado || [];
    if (!Array.isArray(rel)) rel = [rel];
    rel.forEach(function (d) {
      doctos.push({ uuid: (d['@_IdDocumento'] || '').toUpperCase(), impPagado: parseFloat(d['@_ImpPagado'] || 0) });
    });
  });
  return { ok: true, data: { uuid: (tfd['@_UUID'] || '').toUpperCase(), doctos: doctos } };
}

async function _procesarMensajeCompras(rawBuffer, apiKey) {
  const { simpleParser } = require('mailparser');
  const parsed = await simpleParser(rawBuffer);
  const xmlAdjunto = (parsed.attachments || []).find(function (a) {
    return (a.filename || '').toLowerCase().endsWith('.xml') || (a.contentType || '').toLowerCase().indexOf('xml') !== -1;
  });
  const base = {
    asunto: parsed.subject || '(sin asunto)',
    de: (parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address) || '',
    fecha: parsed.date ? parsed.date.toISOString().slice(0, 10) : ''
  };
  if (!xmlAdjunto) return Object.assign({ error: 'El correo no trae ningún XML adjunto.' }, base);
  const xmlText = xmlAdjunto.content.toString('utf8');
  // El proveedor puede mandar una factura nueva (Tipo I/E) o la respuesta con
  // el complemento de pago de una factura ya pagada (Tipo P) — se revisa el
  // TipoDeComprobante del propio XML antes de decidir qué camino seguir.
  let tipoDetectado = '';
  try {
    const { XMLParser } = require('fast-xml-parser');
    const objTipo = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true }).parse(xmlText);
    tipoDetectado = (objTipo && objTipo.Comprobante && objTipo.Comprobante['@_TipoDeComprobante']) || '';
  } catch (e) { /* se deja vacío — el parseo específico de abajo dará su propio error si el XML está mal formado */ }
  if (tipoDetectado === 'P') {
    const rp = _parseComplementoPagoServer(xmlText);
    if (!rp.ok) return Object.assign({ error: rp.error }, base);
    return Object.assign({ error: null, complementoPago: rp.data, xmlTexto: xmlText }, base);
  }
  const r = _parseCfdiProveedorServer(xmlText);
  if (!r.ok) return Object.assign({ error: r.error }, base);
  // Si el correo trae varios PDF (ej. la representación impresa de la
  // factura Y el desglose de monitoreo), NO se juntan los renglones de
  // todos — eso mezclaría/duplicaría datos si el PDF de la factura también
  // llegara a mencionar alguna unidad en sus conceptos. En vez de eso, cada
  // PDF se lee por separado y se usa SOLO el que trajo más renglones con una
  // unidad reconocible (la representación impresa normalmente no trae un
  // desglose renglón-por-renglón como el reporte de monitoreo, así que en la
  // práctica solo "gana" el PDF que de verdad es el desglose).
  const pdfsAdjuntos = (parsed.attachments || []).filter(function (a) {
    return (a.filename || '').toLowerCase().endsWith('.pdf') || (a.contentType || '').toLowerCase().indexOf('pdf') !== -1;
  });
  let renglonesJustificacion = [];
  for (const pdf of pdfsAdjuntos) {
    try {
      const content = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.content.toString('base64') } },
        { type: 'text', text: PROMPT_JUSTIFICACION_CXP }
      ];
      const renglones = (await extraerRenglonesConIA(content, apiKey)).filter(function (r2) { return (r2.unidad || '').toString().trim(); });
      if (renglones.length > renglonesJustificacion.length) renglonesJustificacion = renglones;
    } catch (e) { console.error('_procesarMensajeCompras: no se pudo leer un PDF de desglose:', e); }
  }
  return Object.assign({ error: null, cfdi: r.data, xmlTexto: xmlText, renglonesJustificacion: renglonesJustificacion }, base);
}

// Mismo criterio que aplicarSugerenciaProrrateo en proveedores.html: agrupa
// los renglones por unidad (contando cuántas veces aparece cada una) y
// reparte el total de la factura proporcional a ese conteo (ej. 50 de 100
// monitoreos → 50% del total), ajustando el redondeo en la primera fila para
// que la suma cuadre exacto. Solo se considera "ok" (para prorratear SOLO,
// sin que Esa lo revise) si TODAS las unidades se identificaron con un
// operador real y la suma final cuadra con el total de la factura — si el
// proveedor justifica mal (no cuadra) o alguna unidad no se reconoce, se dejan
// las filas calculadas de todos modos (como sugerencia) pero ok:false, para
// que la factura quede pendiente de revisar a mano en vez de prorratearse
// sola con un dato que no cuadra.
function _calcularProrrateoDesdeRenglonesServer(renglones, total, operadores) {
  const conteos = {};
  (renglones || []).forEach(function (r) {
    const u = (r.unidad || '').toString().trim();
    if (!u) return;
    conteos[u] = (conteos[u] || 0) + 1;
  });
  const claves = Object.keys(conteos);
  if (!claves.length) return { ok: false, filas: [] };
  const totalConteo = claves.reduce(function (s, k) { return s + conteos[k]; }, 0);
  let algunoSinMatch = false;
  const filas = claves.map(function (k) {
    const op = _matchOperadorServer(operadores, '', k);
    if (!op) algunoSinMatch = true;
    const monto = Math.round(total * conteos[k] / totalConteo * 100) / 100;
    return { unidad: op ? op.unidad : null, monto: monto };
  });
  const sumaFilas = filas.reduce(function (s, f) { return s + f.monto; }, 0);
  const diff = Math.round((total - sumaFilas) * 100) / 100;
  if (filas.length && Math.abs(diff) >= 0.01) filas[0].monto = Math.round((filas[0].monto + diff) * 100) / 100;
  const cuadra = Math.abs(filas.reduce(function (s, f) { return s + f.monto; }, 0) - total) < 0.02;
  return { ok: !algunoSinMatch && cuadra, filas: filas };
}

function _revisarBuzonComprasCore(user, pass, apiKey) {
  const Imap = require('imap');
  return new Promise(function (resolveTodo, rejectTodo) {
    const imap = new Imap({ user: user, password: pass, host: 'imap.ionos.mx', port: 993, tls: true, connTimeout: 20000, authTimeout: 20000 });
    const encontrados = [];
    let resuelto = false;
    function terminar(v) { if (resuelto) return; resuelto = true; resolveTodo(v); }
    imap.once('error', function (err) { console.error('revisarBuzonCompras: imap error:', err); rejectTodo(err); });
    imap.once('ready', function () {
      imap.openBox('INBOX', false, function (err) {
        if (err) { console.error('revisarBuzonCompras: error abriendo INBOX:', err); imap.end(); rejectTodo(err); return; }
        imap.search(['UNSEEN'], function (err, uids) {
          if (err) { console.error('revisarBuzonCompras: error en search:', err); imap.end(); rejectTodo(err); return; }
          console.log('revisarBuzonCompras: search encontró', uids ? uids.length : 0, 'correo(s).');
          if (!uids || !uids.length) { imap.end(); terminar(encontrados); return; }
          const f = imap.fetch(uids, { bodies: '', markSeen: true });
          const pendientes = [];
          f.on('message', function (msg, seqno) {
            const partes = [];
            msg.on('body', function (stream) { stream.on('data', function (chunk) { partes.push(chunk); }); });
            msg.once('end', function () {
              const raw = Buffer.concat(partes);
              pendientes.push(
                _procesarMensajeCompras(raw, apiKey)
                  .then(function (r) { encontrados.push(Object.assign({ revisadoEn: new Date().toISOString() }, r)); })
                  .catch(function (e) {
                    console.error('revisarBuzonCompras: error procesando mensaje #' + seqno + ':', e);
                    encontrados.push({ error: e.message || String(e), asunto: '(error al procesar)', de: '', fecha: '', revisadoEn: new Date().toISOString() });
                  })
              );
            });
          });
          f.once('error', function (err) { console.error('revisarBuzonCompras: error en fetch:', err); imap.end(); rejectTodo(err); });
          f.once('end', function () {
            Promise.all(pendientes).then(function () { imap.end(); terminar(encontrados); })
              .catch(function (e) { console.error('revisarBuzonCompras: error inesperado esperando pendientes:', e); imap.end(); rejectTodo(e); });
          });
        });
      });
    });
    imap.once('end', function () { terminar(encontrados); });
    imap.connect();
  }).then(async function (encontrados) {
    const conAlgoPendiente = [];
    let totalRegistradas = 0;
    let totalReps = 0;
    let operadoresCache = null;
    for (const c of encontrados) {
      if (c.error) { conAlgoPendiente.push(c); continue; }
      if (c.complementoPago) {
        try {
          const resultado = await _procesarComplementoPagoEncontrado(c);
          if (resultado.ok) totalReps++;
          else conAlgoPendiente.push(Object.assign({}, c, { errorRelacion: resultado.error }));
        } catch (e) {
          console.error('revisarBuzonCompras: error relacionando complemento de pago:', e);
          conAlgoPendiente.push(c);
        }
        continue;
      }
      if (!c.cfdi) { conAlgoPendiente.push(c); continue; }
      try {
        const ev = await _evaluarCandadosCxPServer(c.cfdi);
        if (!ev.todosOk) {
          conAlgoPendiente.push(Object.assign({}, c, { candados: ev.candados }));
          continue;
        }
        const data = c.cfdi;
        // Sin proveedor registrado no hay días de crédito que aplicar — se
        // trata como vencimiento inmediato (0 días) hasta que se dé de alta
        // con sus datos reales (ver nota en _evaluarCandadosCxPServer).
        const diasCredito = ev.proveedor ? (ev.proveedor.diasCredito != null ? ev.proveedor.diasCredito : 15) : 0;
        // Los días de crédito corren desde que se REGISTRA la factura (hoy),
        // no desde la fecha de timbrado del CFDI — el proveedor a veces
        // timbra días antes de mandarla, y no hay forma de "regresar el
        // tiempo" para pagarla en una fecha ya pasada.
        const fechaRegistro = new Date().toISOString().slice(0, 10);
        const fechaVencimiento = _sumarDiasHabilesServer(fechaRegistro, diasCredito);
        const estadoPago = data.metodoPago === 'PUE' ? 'pendiente_pago' : 'vigente_por_pagar';
        // Si el correo trajo un PDF de desglose (ver _procesarMensajeCompras),
        // se intenta prorratear solo — pero SOLO si todas las unidades se
        // reconocen y la suma cuadra exacto con el total; si no, la factura
        // se registra igual (ya pasó los candados fiscales) y la sugerencia
        // calculada se guarda para que Esa la revise desde "⚖️ Prorratear".
        let estadoProrrateo = 'pendiente_prorrateo';
        let prorrateoFinal = [];
        let justificacionSugerida = null;
        if (c.renglonesJustificacion && c.renglonesJustificacion.length) {
          if (!operadoresCache) operadoresCache = await _cargarOperadoresServer();
          const calc = _calcularProrrateoDesdeRenglonesServer(c.renglonesJustificacion, data.total, operadoresCache);
          if (calc.ok) {
            estadoProrrateo = 'completo';
            prorrateoFinal = calc.filas.map(function (f) { return { unidad: f.unidad, monto: f.monto, aplicado: false, liqNum: null }; });
          } else {
            justificacionSugerida = c.renglonesJustificacion;
          }
        }
        await db.collection('cxpFacturas').doc(data.uuid).set({
          proveedorId: ev.proveedor ? ev.proveedor.rfc : data.rfcEmisor,
          proveedorNombre: ev.proveedor ? (ev.proveedor.razonSocial || ev.proveedor.rfc) : (data.nombreEmisor || data.rfcEmisor),
          proveedorRegistrado: !!ev.proveedor,
          serie: data.serie, folio: data.folio, tipoComprobante: data.tipoComprobante,
          metodoPago: data.metodoPago, formaPago: data.formaPago,
          subtotal: data.subtotal, totalImpuestos: data.traslados - data.retenciones, total: data.total,
          fechaEmision: data.fechaEmision, diasCredito: diasCredito, fechaVencimiento: fechaVencimiento,
          estadoPago: estadoPago, estadoProrrateo: estadoProrrateo, prorrateo: prorrateoFinal,
          justificacionSugerida: justificacionSugerida,
          xmlURL: null, capturadoPor: 'Buzón automático (compras@mudandote.mx)', fechaAlta: new Date().toISOString()
        });
        try {
          const url = await _subirXMLStorage('comprobantes/proveedores/' + data.uuid + '.xml', c.xmlTexto);
          await db.collection('cxpFacturas').doc(data.uuid).set({ xmlURL: url }, { merge: true });
        } catch (e) { console.error('revisarBuzonCompras: no se pudo subir el XML a Storage:', e); }
        try {
          await _enviarCorreoFacturaRecibida(user, pass, ev.proveedor, data, diasCredito, fechaVencimiento);
        } catch (e) { console.error('revisarBuzonCompras: no se pudo enviar el correo de factura recibida:', e); }
        totalRegistradas++;
      } catch (e) {
        console.error('revisarBuzonCompras: error evaluando/registrando factura:', e);
        conAlgoPendiente.push(c);
      }
    }
    if (conAlgoPendiente.length) {
      const ref = db.collection('estado').doc('correosComprasPendientes');
      const snap = await ref.get();
      const previos = (snap.exists && snap.data().data) ? JSON.parse(snap.data().data) : [];
      await ref.set({ data: JSON.stringify(previos.concat(conAlgoPendiente)) });
    }
    encontrados._totalRegistradas = totalRegistradas;
    encontrados._totalPendientes = conAlgoPendiente.length;
    encontrados._totalReps = totalReps;
    return encontrados;
  });
}

// Relaciona un complemento de pago (REP) encontrado en el buzón con la(s)
// factura(s) que trae en sus DoctoRelacionado — si la factura existe y
// todavía no tenía REP, se marca repRecibido y se sube el XML a Storage. Si
// el proveedor estaba bloqueado por REP pendiente y ya no le queda ninguna
// otra factura pagada sin complemento, se desbloquea solo.
async function _procesarComplementoPagoEncontrado(c) {
  const doctos = (c.complementoPago && c.complementoPago.doctos) || [];
  if (!doctos.length) return { ok: false, error: 'El complemento no trae ningún DoctoRelacionado.' };
  let algunoRelacionado = false;
  for (const docto of doctos) {
    const facSnap = await db.collection('cxpFacturas').doc(docto.uuid).get();
    if (!facSnap.exists) continue;
    const fac = facSnap.data();
    if (fac.repRecibido) continue;
    let repUrl = null;
    try { repUrl = await _subirXMLStorage('comprobantes/proveedores/pagos/rep-' + c.complementoPago.uuid + '.xml', c.xmlTexto); }
    catch (e) { console.error('_procesarComplementoPagoEncontrado: no se pudo subir el XML del REP:', e); }
    await db.collection('cxpFacturas').doc(docto.uuid).set(
      { repRecibido: true, repXmlURL: repUrl, repRecibidoEn: new Date().toISOString() }, { merge: true }
    );
    algunoRelacionado = true;
    if (fac.proveedorId) {
      const provSnap = await db.collection('proveedores').doc(fac.proveedorId).get();
      if (provSnap.exists && provSnap.data().bloqueadoPorRep) {
        const otras = await db.collection('cxpFacturas').where('proveedorId', '==', fac.proveedorId).where('estadoPago', '==', 'pagada').get();
        const siguenPendientes = otras.docs.some(function (d) { return d.id !== docto.uuid && !d.data().repRecibido; });
        if (!siguenPendientes) await db.collection('proveedores').doc(fac.proveedorId).set({ bloqueadoPorRep: false }, { merge: true });
      }
    }
  }
  return algunoRelacionado ? { ok: true } : { ok: false, error: 'No se encontró ninguna factura registrada que coincida con los UUID del complemento (o ya estaban relacionadas).' };
}

// Sube el XML tal cual a Firebase Storage (mismo patrón que
// shared/comprobantes.js del lado del navegador) — se usa aquí porque el
// buzón corre en el servidor, sin acceso a ese archivo compartido.
async function _subirXMLStorage(path, text) {
  const bucket = admin.storage().bucket('tml-liquidaciones.firebasestorage.app');
  const file = bucket.file(path);
  await file.save(Buffer.from(text, 'utf8'), { contentType: 'application/xml' });
  await file.makePublic();
  return 'https://storage.googleapis.com/' + bucket.name + '/' + path;
}

exports.revisarBuzonCompras = onRequest(
  { secrets: [COMPRAS_EMAIL_USER, COMPRAS_EMAIL_PASS, ANTHROPIC_API_KEY], cors: true, region: 'us-central1', timeoutSeconds: 300 },
  async (req, res) => {
    try {
      const encontrados = await _revisarBuzonComprasCore(COMPRAS_EMAIL_USER.value(), COMPRAS_EMAIL_PASS.value(), ANTHROPIC_API_KEY.value());
      res.json({ ok: true, correosNuevos: encontrados.length, facturasRegistradas: encontrados._totalRegistradas || 0, pendientesRevision: encontrados._totalPendientes || 0, complementosRelacionados: encontrados._totalReps || 0 });
    } catch (e) {
      console.error('revisarBuzonCompras:', e);
      res.status(500).json({ error: e.message || 'Error interno del servidor.' });
    }
  }
);

exports.revisarBuzonComprasProgramado = onSchedule(
  { schedule: '0 * * * *', timeZone: 'America/Mexico_City', secrets: [COMPRAS_EMAIL_USER, COMPRAS_EMAIL_PASS, ANTHROPIC_API_KEY], region: 'us-central1', timeoutSeconds: 300 },
  async () => {
    const inicio = new Date().toISOString();
    try {
      const encontrados = await _revisarBuzonComprasCore(COMPRAS_EMAIL_USER.value(), COMPRAS_EMAIL_PASS.value(), ANTHROPIC_API_KEY.value());
      await db.collection('estado').doc('buzonComprasEstado').set({
        ultimaEjecucion: inicio, ok: true, correosNuevos: encontrados.length,
        facturasRegistradas: encontrados._totalRegistradas || 0, pendientesRevision: encontrados._totalPendientes || 0,
        complementosRelacionados: encontrados._totalReps || 0, error: null
      });
    } catch (e) {
      console.error('revisarBuzonComprasProgramado:', e);
      try {
        await db.collection('estado').doc('buzonComprasEstado').set({ ultimaEjecucion: inicio, ok: false, error: e.message || String(e) });
      } catch (e2) { console.error('revisarBuzonComprasProgramado: no se pudo guardar el estado del error:', e2); }
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════
// enviarSolicitudComplementoPago — se llama desde proveedores.html justo
// después de marcar una factura como pagada (botón "➕ Pago"): le manda un
// correo al proveedor pidiéndole el complemento de pago (REP) y guarda en la
// factura la fecha de pago y la fecha límite legal para recibirlo (día 8 del
// mes siguiente al pago), para que revisarComplementosPagoProgramado pueda
// avisar/bloquear si no llega a tiempo.
// ══════════════════════════════════════════════════════════════════════════
exports.enviarSolicitudComplementoPago = onRequest(
  { secrets: [COMPRAS_EMAIL_USER, COMPRAS_EMAIL_PASS], cors: true, region: 'us-central1' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido, usa POST.' }); return; }
    const uuid = ((req.body && req.body.uuid) || '').toString().trim().toUpperCase();
    const fechaPago = ((req.body && req.body.fechaPago) || '').toString().trim() || new Date().toISOString().slice(0, 10);
    const comprobanteURL = ((req.body && req.body.comprobanteURL) || '').toString().trim();
    if (!uuid) { res.status(400).json({ error: 'Falta el UUID de la factura.' }); return; }
    try {
      const facSnap = await db.collection('cxpFacturas').doc(uuid).get();
      if (!facSnap.exists) { res.status(404).json({ error: 'No se encontró esa factura.' }); return; }
      const fac = facSnap.data();
      // El complemento de pago (REP) solo aplica a facturas PPD (pago en
      // parcialidades/diferido, con crédito) — en PUE el proceso termina en
      // el pago mismo, no hay nada más que solicitar ni dar seguimiento.
      if (fac.metodoPago !== 'PPD') { res.json({ ok: true, aplica: false, correoEnviado: false }); return; }
      const fechaLimiteRep = _calcularFechaLimiteRepServer(fechaPago);
      await db.collection('cxpFacturas').doc(uuid).set(
        { fechaPago: fechaPago, repFechaLimite: fechaLimiteRep, repRecibido: false }, { merge: true }
      );
      const provSnap = fac.proveedorId ? await db.collection('proveedores').doc(fac.proveedorId).get() : null;
      const proveedor = provSnap && provSnap.exists ? provSnap.data() : null;
      let correoEnviado = false;
      if (proveedor && proveedor.email) {
        await _enviarCorreoCompras(COMPRAS_EMAIL_USER.value(), COMPRAS_EMAIL_PASS.value(), proveedor.email,
          'Solicitud de complemento de pago — factura ' + (fac.serie ? fac.serie + '-' : '') + fac.folio,
          _plantillaCorreoCxP(
            '💳 Pago confirmado — falta tu complemento de pago',
            '#457b9d',
            '<p>Hola <strong>' + (proveedor.razonSocial || fac.proveedorNombre || '') + '</strong>,</p>' +
            '<p>Te confirmamos que ya se realizó el pago de tu factura <strong>' + (fac.serie ? fac.serie + '-' : '') + fac.folio + '</strong> por ' +
            '<strong style="color:#1a1a2e;">' + _fmtMonedaServer(fac.total) + '</strong>, con fecha ' + fechaPago + '.</p>' +
            '<p style="background:#eef4f8;border-left:3px solid #457b9d;padding:10px 14px;border-radius:4px;">' +
            'Por favor envíanos el <strong>complemento de pago (REP)</strong> correspondiente antes del <strong>' + fechaLimiteRep + '</strong> ' +
            '(límite legal: día 8 del mes siguiente al pago).</p>' +
            (comprobanteURL ? '<p>Adjuntamos el comprobante del pago.</p>' : '') +
            '<p>Gracias.</p>'
          ),
          _adjuntoComprobante(comprobanteURL)
        );
        correoEnviado = true;
      }
      res.json({ ok: true, aplica: true, fechaLimiteRep: fechaLimiteRep, correoEnviado: correoEnviado });
    } catch (e) {
      console.error('enviarSolicitudComplementoPago:', e);
      res.status(500).json({ error: e.message || 'Error interno del servidor.' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════
// enviarConfirmacionFacturaRecibida — mismo correo de "factura recibida, fecha
// estimada de pago" que ya manda el Buzón de Compras cuando registra una
// factura solo, pero para cuando la factura se registra a MANO (subiendo el
// XML tú misma en Proveedores) — antes solo se mandaba si llegaba por el
// buzón automático.
// ══════════════════════════════════════════════════════════════════════════
exports.enviarConfirmacionFacturaRecibida = onRequest(
  { secrets: [COMPRAS_EMAIL_USER, COMPRAS_EMAIL_PASS], cors: true, region: 'us-central1' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido, usa POST.' }); return; }
    const uuid = ((req.body && req.body.uuid) || '').toString().trim().toUpperCase();
    if (!uuid) { res.status(400).json({ error: 'Falta el UUID de la factura.' }); return; }
    try {
      const facSnap = await db.collection('cxpFacturas').doc(uuid).get();
      if (!facSnap.exists) { res.status(404).json({ error: 'No se encontró esa factura.' }); return; }
      const fac = facSnap.data();
      const provSnap = fac.proveedorId ? await db.collection('proveedores').doc(fac.proveedorId).get() : null;
      const proveedor = provSnap && provSnap.exists ? provSnap.data() : null;
      const correoEnviado = await _enviarCorreoFacturaRecibida(
        COMPRAS_EMAIL_USER.value(), COMPRAS_EMAIL_PASS.value(), proveedor, fac, fac.diasCredito, fac.fechaVencimiento
      );
      res.json({ ok: true, correoEnviado: correoEnviado });
    } catch (e) {
      console.error('enviarConfirmacionFacturaRecibida:', e);
      res.status(500).json({ error: e.message || 'Error interno del servidor.' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════
// enviarConfirmacionPago — se llama desde proveedores.html justo después de
// registrar el pago de una factura PUE: le avisa al proveedor que ya se le
// pagó. Las PPD no usan este endpoint porque ya reciben ese mismo aviso
// dentro del correo de solicitud de complemento de pago (enviarSolicitudComplementoPago).
// ══════════════════════════════════════════════════════════════════════════
exports.enviarConfirmacionPago = onRequest(
  { secrets: [COMPRAS_EMAIL_USER, COMPRAS_EMAIL_PASS], cors: true, region: 'us-central1' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido, usa POST.' }); return; }
    const uuid = ((req.body && req.body.uuid) || '').toString().trim().toUpperCase();
    const fechaPago = ((req.body && req.body.fechaPago) || '').toString().trim() || new Date().toISOString().slice(0, 10);
    const comprobanteURL = ((req.body && req.body.comprobanteURL) || '').toString().trim();
    if (!uuid) { res.status(400).json({ error: 'Falta el UUID de la factura.' }); return; }
    try {
      const facSnap = await db.collection('cxpFacturas').doc(uuid).get();
      if (!facSnap.exists) { res.status(404).json({ error: 'No se encontró esa factura.' }); return; }
      const fac = facSnap.data();
      if (fac.metodoPago === 'PPD') { res.json({ ok: true, aplica: false, correoEnviado: false }); return; }
      const provSnap = fac.proveedorId ? await db.collection('proveedores').doc(fac.proveedorId).get() : null;
      const proveedor = provSnap && provSnap.exists ? provSnap.data() : null;
      const correoEnviado = await _enviarCorreoPagoConfirmado(
        COMPRAS_EMAIL_USER.value(), COMPRAS_EMAIL_PASS.value(), proveedor, fac, fechaPago, comprobanteURL
      );
      res.json({ ok: true, aplica: true, correoEnviado: correoEnviado });
    } catch (e) {
      console.error('enviarConfirmacionPago:', e);
      res.status(500).json({ error: e.message || 'Error interno del servidor.' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════
// revisarComplementosPagoProgramado — corre los días 1, 3 y 5 de cada mes
// (9:00 hrs CDMX): busca facturas pagadas sin complemento de pago (REP) y les
// manda a su proveedor un recordatorio (días 1 y 3) o, si para el día 5
// sigue sin llegar, un aviso de que su RFC queda bloqueado para el registro
// automático de facturas nuevas hasta que lo envíe (ver el candado nuevo en
// _evaluarCandadosCxPServer). El bloqueo se quita solo en cuanto se relaciona
// el REP correspondiente (ver _procesarComplementoPagoEncontrado), o a mano
// desde Proveedores.
// ══════════════════════════════════════════════════════════════════════════
async function _revisarComplementosPagoCore(user, pass) {
  const diaHoy = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', day: 'numeric' }).format(new Date()));
  const snap = await db.collection('cxpFacturas').where('estadoPago', '==', 'pagada').get();
  const porProveedor = {};
  snap.forEach(function (d) {
    const f = d.data();
    if (f.repRecibido || !f.repFechaLimite || !f.proveedorId) return;
    (porProveedor[f.proveedorId] = porProveedor[f.proveedorId] || []).push(Object.assign({ id: d.id }, f));
  });
  let avisosMandados = 0, bloqueados = 0;
  for (const rfc of Object.keys(porProveedor)) {
    const facturas = porProveedor[rfc];
    const provSnap = await db.collection('proveedores').doc(rfc).get();
    if (!provSnap.exists) continue;
    const proveedor = provSnap.data();
    if (!proveedor.email) continue;
    const listaHtml = facturas.map(function (f) {
      return '<li>' + (f.serie ? f.serie + '-' : '') + f.folio + ' — pagada el ' + f.fechaPago + ', límite ' + f.repFechaLimite + '</li>';
    }).join('');
    if (diaHoy === 1 || diaHoy === 3) {
      await _enviarCorreoCompras(user, pass, proveedor.email,
        'Recordatorio: complemento de pago pendiente',
        _plantillaCorreoCxP(
          '⏰ Recordatorio — complemento de pago pendiente',
          '#e9a23b',
          '<p>Hola <strong>' + (proveedor.razonSocial || '') + '</strong>,</p>' +
          '<p>Nos falta recibir el complemento de pago (REP) de las siguientes facturas ya pagadas:</p>' +
          '<ul style="background:#fdf6ea;border-left:3px solid #e9a23b;padding:10px 14px 10px 28px;border-radius:4px;margin:0 0 14px;">' + listaHtml + '</ul>' +
          '<p>Por favor envíalo antes de la fecha límite indicada.</p>'
        )
      );
      avisosMandados++;
    } else if (diaHoy === 5) {
      await _enviarCorreoCompras(user, pass, proveedor.email,
        'Tu RFC ha sido bloqueado — complemento de pago pendiente',
        _plantillaCorreoCxP(
          '🚫 RFC bloqueado — complemento de pago pendiente',
          '#e63946',
          '<p>Hola <strong>' + (proveedor.razonSocial || '') + '</strong>,</p>' +
          '<p>No hemos recibido el complemento de pago (REP) de las siguientes facturas ya pagadas:</p>' +
          '<ul style="background:#fdeced;border-left:3px solid #e63946;padding:10px 14px 10px 28px;border-radius:4px;margin:0 0 14px;">' + listaHtml + '</ul>' +
          '<p>Por ley, el límite para emitirlo es el día 8 del mes siguiente al del pago. Mientras no lo recibamos, tu RFC queda ' +
          '<strong>bloqueado</strong> para el registro automático de facturas nuevas. Envíalo lo antes posible para reactivarlo.</p>'
        )
      );
      await db.collection('proveedores').doc(rfc).set({ bloqueadoPorRep: true }, { merge: true });
      bloqueados++;
    }
  }
  return { avisosMandados: avisosMandados, bloqueados: bloqueados };
}

exports.revisarComplementosPagoProgramado = onSchedule(
  { schedule: '0 9 1,3,5 * *', timeZone: 'America/Mexico_City', secrets: [COMPRAS_EMAIL_USER, COMPRAS_EMAIL_PASS], region: 'us-central1', timeoutSeconds: 300 },
  async () => {
    const inicio = new Date().toISOString();
    try {
      const resultado = await _revisarComplementosPagoCore(COMPRAS_EMAIL_USER.value(), COMPRAS_EMAIL_PASS.value());
      await db.collection('estado').doc('complementosPagoEstado').set({
        ultimaEjecucion: inicio, ok: true, avisosMandados: resultado.avisosMandados, bloqueados: resultado.bloqueados, error: null
      });
    } catch (e) {
      console.error('revisarComplementosPagoProgramado:', e);
      try {
        await db.collection('estado').doc('complementosPagoEstado').set({ ultimaEjecucion: inicio, ok: false, error: e.message || String(e) });
      } catch (e2) { console.error('revisarComplementosPagoProgramado: no se pudo guardar el estado del error:', e2); }
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════
// extraerComprobantePagoCxP — Cuentas por Pagar (proveedores.html), botón "+"
// en cada renglón de factura: cuando se sube el comprobante de pago (foto o
// PDF de una transferencia/depósito), esta función SOLO EXTRAE lo que trae
// anotado el comprobante (folio de factura, número económico si el gasto es
// de un camión, fecha y monto) — el emparejamiento con la factura real, la
// decisión de marcarla pagada, y el prorrateo a la unidad se hacen en el
// navegador y SIEMPRE se le muestran al administrador antes de guardar
// (mismo criterio que el resto del sistema: la IA sugiere, nunca aplica sola).
// ══════════════════════════════════════════════════════════════════════════
const PROMPT_COMPROBANTE_PAGO_CXP =
  'Eres un asistente que lee un COMPROBANTE DE PAGO (ficha de depósito, comprobante de transferencia bancaria, captura de ' +
  'banca en línea) que una empresa de mudanzas genera al pagarle a un proveedor. En el concepto, referencia o descripción ' +
  'del comprobante normalmente se anota el número de factura que se está pagando y, cuando el gasto corresponde al ' +
  'camión/unidad de un operador, también el número económico de esa unidad. Extrae un solo objeto JSON con estas llaves ' +
  'exactas: {"folioFactura":"el número de folio de factura mencionado, SOLO el número sin la serie ni prefijos (ej. de ' +
  '\\"F-2575\\" o \\"factura 2575\\" extrae \\"2575\\"), o null si no se menciona ningún folio","economico":"el número ' +
  'económico o identificador de la unidad/camión mencionado en el concepto, o null si no se menciona ninguno",' +
  '"fechaPago":"YYYY-MM-DD si se puede determinar la fecha del comprobante (convierte desde el formato que traiga), o ' +
  'null","monto":"el monto pagado que muestra el comprobante, como número, o 0 si no se puede determinar"}. No inventes ' +
  'datos que no estén en el comprobante. Responde SOLO el objeto JSON (sin texto explicativo, sin backticks, sin markdown).';

exports.extraerComprobantePagoCxP = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true, region: 'us-central1' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método no permitido, usa POST.' });
      return;
    }
    const archivoBase64 = ((req.body && req.body.archivoBase64) || '').toString().trim();
    const mimeType = ((req.body && req.body.mimeType) || '').toString().trim();
    if (!archivoBase64) {
      res.status(400).json({ error: 'Falta el archivo del comprobante (campo "archivoBase64").' });
      return;
    }
    if (archivoBase64.length > 15000000) {
      res.status(400).json({ error: 'El archivo es demasiado grande (máximo ~10 MB).' });
      return;
    }
    const esPdf = mimeType === 'application/pdf';
    const esImagen = /^image\/(jpeg|jpg|png|webp|gif)$/.test(mimeType);
    if (!esPdf && !esImagen) {
      res.status(400).json({ error: 'El comprobante debe ser una imagen (JPG/PNG/WEBP) o un PDF.' });
      return;
    }
    try {
      const content = [
        esPdf
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: archivoBase64 } }
          : { type: 'image', source: { type: 'base64', media_type: mimeType, data: archivoBase64 } },
        { type: 'text', text: PROMPT_COMPROBANTE_PAGO_CXP }
      ];
      const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY.value(),
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1000,
          messages: [{ role: 'user', content: content }]
        })
      });
      const datos = await respuesta.json();
      if (datos.error) {
        res.status(502).json({ error: 'Error de la API de Anthropic: ' + (datos.error.message || JSON.stringify(datos.error)) });
        return;
      }
      const textoRespuesta = (datos.content || [])
        .filter(function (b) { return b.type === 'text'; })
        .map(function (b) { return b.text; })
        .join('');
      const limpio = textoRespuesta.replace(/```json|```/g, '').trim();
      let resultado;
      try {
        resultado = JSON.parse(limpio);
      } catch (e) {
        res.status(502).json({ error: 'La IA no regresó un JSON válido. Respuesta cruda: ' + textoRespuesta.slice(0, 500) });
        return;
      }
      res.json({ comprobante: resultado });
    } catch (e) {
      console.error('extraerComprobantePagoCxP:', e);
      res.status(500).json({ error: e.message || 'Error interno del servidor.' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════
// extraerOrdenEmbarqueSellada / extraerReciboManiobra — ing.html, pestaña
// "Buzón de pedidos y archivo maestro": para cobrar las maniobras al cliente
// (Raúl) se necesita evidencia de dos documentos por embarque — la orden de
// embarque que la TIENDA sella al recibir la mercancía (trae el número de
// bultos entregados) y el recibo de maniobra (comprobante de lo pagado por
// la maniobra). Igual que el resto de funciones de IA de este archivo: SOLO
// extraen lo que trae el documento, el emparejamiento con el T.U./fila del
// Archivo Maestro y la decisión de guardar se hacen en el navegador
// (ing.html), nunca aquí.
// ══════════════════════════════════════════════════════════════════════════
// _TEXTO_CALIDAD_ESCANEO: fragmento común de ambos prompts — pide a la IA
// que además juzgue la CALIDAD del escaneo/foto (legible, derecho, con luz
// suficiente) y regrese un rechazo explícito si no se puede confiar en lo
// que extrajo. Importante para operador.html (Fase 2 del módulo de
// operadores): un operador puede escanear con poca luz, movido o chueco —
// sin este chequeo, el sistema guardaría datos leídos a medias como si
// fueran buenos. En ing.html (Raúl/oficina) el mismo chequeo también
// aplica, sin distinción — una foto mala es una foto mala sin importar
// quién la suba.
const _TEXTO_CALIDAD_ESCANEO =
  ',"calidad":{"legible":true si el documento se alcanza a leer con confianza (no está borroso, no le falta luz, no está ' +
  'tan inclinado/chueco que se corten datos, no está cortado o tapado en la parte que importa) o false si el escaneo/foto ' +
  'tiene cualquiera de esos problemas y por eso NO se puede confiar en los datos leídos,"motivo":"si legible es false, ' +
  'breve explicación en español de cuál es el problema (ej. \\"la foto está borrosa\\", \\"está muy inclinada/chueca\\", ' +
  '\\"falta luz, no se distingue el texto\\", \\"está cortada, no se ve completa\\"), o null si legible es true"}';

const PROMPT_ORDEN_EMBARQUE_SELLADA =
  'Eres un asistente que lee la ORDEN DE EMBARQUE de una empresa de mudanzas — un documento que la TIENDA/destino sella y ' +
  'firma al recibir la mercancía. Trae impreso un número de T.U./orden de embarque (a veces dos números juntos separados ' +
  'por "/", ej. "6500360289/6500360290" — en ese caso son DOS T.U.\'s del mismo embarque), y en algún lugar del documento ' +
  '(tabla, sello o anotación a mano) se anota el NÚMERO DE BULTOS entregados/recibidos. Extrae un solo objeto JSON con ' +
  'estas llaves exactas: {"tu1":"el primer/único número de T.U. u orden de embarque, tal cual viene, o null si no se ' +
  'distingue","tu2":"el segundo número de T.U. si vienen dos juntos separados por \\"/\\", o null","bultos":el número de ' +
  'bultos como entero, o null si no se puede determinar' + _TEXTO_CALIDAD_ESCANEO + '}. No inventes datos que no estén en ' +
  'el documento. Responde SOLO el objeto JSON (sin texto explicativo, sin backticks, sin markdown).';

const PROMPT_RECIBO_MANIOBRA =
  'Eres un asistente que lee un RECIBO DE MANIOBRA de una empresa de mudanzas — el comprobante que firma quien realizó la ' +
  'maniobra de carga/descarga de un embarque, indicando el monto pagado por ese servicio. También necesitas ubicar el ' +
  'RECTÁNGULO que contiene SOLO el papel del recibo, para recortar la foto y que no se vean manos, dedos, mesa ni otro ' +
  'fondo — el recorte debe ser lo más ajustado posible a las orillas del papel, pero sin cortar ninguna esquina del ' +
  'texto/papel. Extrae un solo objeto JSON con estas llaves exactas: {"monto":el monto pagado que muestra el recibo, ' +
  'como número, o 0 si no se puede determinar,"fecha":"YYYY-MM-DD si se puede determinar la fecha del recibo (convierte ' +
  'desde el formato que traiga), o null","recorte":{"x0":porcentaje (0-100) de la orilla IZQUIERDA del papel respecto al ' +
  'ancho total de la imagen,"y0":porcentaje (0-100) de la orilla SUPERIOR del papel respecto al alto total,"x1":' +
  'porcentaje (0-100) de la orilla DERECHA del papel,"y1":porcentaje (0-100) de la orilla INFERIOR del papel} — o null ' +
  'si no logras distinguir claramente las orillas del papel (ej. está borroso o tapado)' + _TEXTO_CALIDAD_ESCANEO + '}. No ' +
  'inventes datos que no estén en el recibo. Responde SOLO el objeto JSON (sin texto explicativo, sin backticks, sin ' +
  'markdown).';

function _extraerImagenDocumento(prompt) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método no permitido, usa POST.' });
      return;
    }
    const archivoBase64 = ((req.body && req.body.archivoBase64) || '').toString().trim();
    const mimeType = ((req.body && req.body.mimeType) || '').toString().trim();
    if (!archivoBase64) {
      res.status(400).json({ error: 'Falta la imagen (campo "archivoBase64").' });
      return;
    }
    if (archivoBase64.length > 15000000) {
      res.status(400).json({ error: 'El archivo es demasiado grande (máximo ~10 MB).' });
      return;
    }
    const esPdf = mimeType === 'application/pdf';
    const esImagen = /^image\/(jpeg|jpg|png|webp|gif)$/.test(mimeType);
    if (!esPdf && !esImagen) {
      res.status(400).json({ error: 'El archivo debe ser una foto (JPG/PNG/WEBP) o un PDF.' });
      return;
    }
    try {
      const content = [
        esPdf
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: archivoBase64 } }
          : { type: 'image', source: { type: 'base64', media_type: mimeType, data: archivoBase64 } },
        { type: 'text', text: prompt }
      ];
      const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY.value(),
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 500,
          messages: [{ role: 'user', content: content }]
        })
      });
      const datos = await respuesta.json();
      if (datos.error) {
        res.status(502).json({ error: 'Error de la API de Anthropic: ' + (datos.error.message || JSON.stringify(datos.error)) });
        return;
      }
      const textoRespuesta = (datos.content || [])
        .filter(function (b) { return b.type === 'text'; })
        .map(function (b) { return b.text; })
        .join('');
      const limpio = textoRespuesta.replace(/```json|```/g, '').trim();
      let resultado;
      try {
        resultado = JSON.parse(limpio);
      } catch (e) {
        res.status(502).json({ error: 'La IA no regresó un JSON válido. Respuesta cruda: ' + textoRespuesta.slice(0, 500) });
        return;
      }
      if (resultado.calidad && resultado.calidad.legible === false) {
        res.status(422).json({
          error: 'La foto no se puede leer con confianza: ' + (resultado.calidad.motivo || 'calidad insuficiente') + '. Vuelve a escanear/tomar la foto.',
          rechazoPorCalidad: true
        });
        return;
      }
      res.json({ resultado: resultado });
    } catch (e) {
      console.error('_extraerImagenDocumento:', e);
      res.status(500).json({ error: e.message || 'Error interno del servidor.' });
    }
  };
}

exports.extraerOrdenEmbarqueSellada = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true, region: 'us-central1' },
  _extraerImagenDocumento(PROMPT_ORDEN_EMBARQUE_SELLADA)
);

exports.extraerReciboManiobra = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true, region: 'us-central1' },
  _extraerImagenDocumento(PROMPT_RECIBO_MANIOBRA)
);

// ══════════════════════════════════════════════════════════════════════════
// BUZÓN DE PEDIDOS DE FLETE (fletes@mudandote.mx) — el cliente manda el
// pedido de un embarque (orden de embarque, pedido de flete, tienda/destino,
// fecha) ANTES de que exista la factura. Se registra en la colección real
// fletesDB (ver shared/fletes.js) en estado 'pendiente_factura'; cuando
// Raúl sube su XML+Excel de factura consolidada de maniobras (ing.html →
// procesarFacturaManiobrasExcel), cada renglón que coincida por orden de
// embarque se marca 'facturado' — mismo espíritu que los otros dos buzones:
// solo se auto-registra lo que trae una orden de embarque reconocible; si no
// se puede identificar, se deja pendiente de revisión manual.
// ══════════════════════════════════════════════════════════════════════════
const PROMPT_PEDIDO_FLETE =
  'Eres un asistente que extrae datos de un correo donde un cliente (empresa que contrata servicios de mudanza/transportación) ' +
  'manda un PEDIDO DE FLETE u orden de embarque, antes de que exista la factura. El correo suele venir en una TABLA con ' +
  'columnas como FECHA, PEDIDO, TU (o "T.U.", "orden de embarque", "traffic unit"), ECO. (el número económico/unidad), ' +
  'TIENDA o TIENDA PREVIAS, DESTINO y FLETE (el importe). IMPORTANTE — la columna TU/orden de embarque puede traer DOS (o ' +
  'más) números juntos separados por "/", por ejemplo "6500360289/6500360290": eso es UN SOLO renglón/embarque con dos T.U.\'s ' +
  'asociados, NO dos renglones distintos — extráelo TAL CUAL viene, con la "/" incluida, en un solo objeto (no dupliques el ' +
  'renglón por cada T.U.). También ten cuidado de no confundir la columna ECO. (el número económico de la unidad/camión, un ' +
  'número corto tipo "532") con otras columnas cercanas que sean texto (como un nombre de persona o un tipo de unidad/flota) — ' +
  'el económico es específicamente ese número. Extrae UN renglón por cada embarque/viaje (fila de la tabla) que encuentres, ' +
  'con estas llaves exactas: {"ordenEmbarque":"el folio de la orden de embarque/TU tal cual aparece (con la \\"/\\" si trae ' +
  'más de uno), o null si no se puede determinar","pedidoFlete":"el número de pedido/PO del flete, o null","tienda":"la ' +
  'tienda o sucursal, o null","destino":"el destino del embarque, o null","fecha":"YYYY-MM-DD si se puede convertir desde el ' +
  'formato que traiga, o null","economico":"el número económico de la unidad/camión (columna ECO. o similar) tal cual ' +
  'aparece, o null si no se menciona","monto":"el importe/monto del flete, como número (sin signos de moneda ni comas), o ' +
  'null si no se menciona"}. No inventes datos que no estén en el ' +
  'correo. Responde SOLO un arreglo JSON (sin texto explicativo, sin backticks, sin markdown) con un objeto por cada renglón ' +
  'que encuentres. Si no hay ningún renglón reconocible, responde [].';

function _normalizarOrdenEmbarqueServer(valor) {
  return (valor == null ? '' : String(valor)).trim().toUpperCase().replace(/\s+/g, '').replace(/^0+(?=\d)/, '');
}

async function _procesarMensajePedidos(rawBuffer, apiKey) {
  const { simpleParser } = require('mailparser');
  const parsed = await simpleParser(rawBuffer);
  const pdfAdjunto = (parsed.attachments || []).find(function (a) {
    return (a.contentType || '').toLowerCase().indexOf('pdf') !== -1 || (a.filename || '').toLowerCase().endsWith('.pdf');
  });
  const content = pdfAdjunto
    ? [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfAdjunto.content.toString('base64') } },
        { type: 'text', text: PROMPT_PEDIDO_FLETE }
      ]
    : PROMPT_PEDIDO_FLETE + '\n\n--- CORREO ---\n' + (parsed.text || parsed.html || '').slice(0, 20000);
  return {
    renglones: await extraerRenglonesConIA(content, apiKey),
    asunto: parsed.subject || '(sin asunto)',
    de: (parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address) || '',
    fecha: parsed.date ? parsed.date.toISOString().slice(0, 10) : ''
  };
}

function _revisarBuzonPedidosCore(user, pass, apiKey) {
  const Imap = require('imap');
  return new Promise(function (resolveTodo, rejectTodo) {
    const imap = new Imap({ user: user, password: pass, host: 'imap.ionos.mx', port: 993, tls: true, connTimeout: 20000, authTimeout: 20000 });
    const encontrados = [];
    let resuelto = false;
    function terminar(v) { if (resuelto) return; resuelto = true; resolveTodo(v); }
    imap.once('error', function (err) { console.error('revisarBuzonPedidos: imap error:', err); rejectTodo(err); });
    imap.once('ready', function () {
      imap.openBox('INBOX', false, function (err) {
        if (err) { console.error('revisarBuzonPedidos: error abriendo INBOX:', err); imap.end(); rejectTodo(err); return; }
        imap.search(['UNSEEN'], function (err, uids) {
          if (err) { console.error('revisarBuzonPedidos: error en search:', err); imap.end(); rejectTodo(err); return; }
          if (!uids || !uids.length) { imap.end(); terminar(encontrados); return; }
          const f = imap.fetch(uids, { bodies: '', markSeen: true });
          const pendientes = [];
          f.on('message', function (msg, seqno) {
            const partes = [];
            msg.on('body', function (stream) { stream.on('data', function (chunk) { partes.push(chunk); }); });
            msg.once('end', function () {
              const raw = Buffer.concat(partes);
              pendientes.push(
                _procesarMensajePedidos(raw, apiKey)
                  .then(function (r) { encontrados.push(Object.assign({ error: null, revisadoEn: new Date().toISOString() }, r)); })
                  .catch(function (e) {
                    console.error('revisarBuzonPedidos: error procesando mensaje #' + seqno + ':', e);
                    encontrados.push({ error: e.message || String(e), renglones: [], asunto: '(error al procesar)', de: '', fecha: '', revisadoEn: new Date().toISOString() });
                  })
              );
            });
          });
          f.once('error', function (err) { console.error('revisarBuzonPedidos: error en fetch:', err); imap.end(); rejectTodo(err); });
          f.once('end', function () {
            Promise.all(pendientes).then(function () { imap.end(); terminar(encontrados); })
              .catch(function (e) { console.error('revisarBuzonPedidos: error inesperado esperando pendientes:', e); imap.end(); rejectTodo(e); });
          });
        });
      });
    });
    imap.once('end', function () { terminar(encontrados); });
    imap.connect();
  }).then(async function (encontrados) {
    const conAlgoPendiente = [];
    let totalRegistrados = 0;
    // ingresosDB se lee UNA vez aquí (justo antes de mutarlo en memoria por
    // cada renglón con económico) y se escribe UNA vez al final — mismo
    // criterio de "releer justo antes de escribir" que ya usa el resto del
    // sistema (ver revisarBuzonManiobras).
    const operadoresProv = await _cargarOperadoresServer();
    const refIngresosProv = db.collection('estado').doc('ingresosDB');
    const snapIngresosProv = await refIngresosProv.get();
    const ingresosDBProv = (snapIngresosProv.exists && snapIngresosProv.data().data) ? JSON.parse(snapIngresosProv.data().data) : [];
    let provisionalesCreados = 0;
    for (const c of encontrados) {
      if (c.error) { conAlgoPendiente.push(c); continue; }
      const renglonesSinOrden = [];
      for (const r of (c.renglones || [])) {
        // La columna TU/orden de embarque puede traer dos números juntos
        // separados por "/" (un solo embarque con dos T.U.'s asociados, ej.
        // "6500360289/6500360290") — se separan aquí en T.U.'s 1 y T.U.'s 2,
        // mismo criterio que ya usa Maniobras (nunca deberían llegar ya
        // divididos en renglones distintos, pero por si acaso, esto es lo
        // que evita registrar el mismo pedido dos veces como si fueran dos).
        // El T.U.'s 1 se usa como id del documento/orden de embarque principal.
        const partes = String(r.ordenEmbarque || '').split(/[\/,;]+/)
          .map(function (p) { return _normalizarOrdenEmbarqueServer(p); })
          .filter(function (p) { return p; });
        if (!partes.length) { renglonesSinOrden.push(r); continue; }
        const tu1 = partes[0], tu2 = partes[1] || null;
        try {
          const ref = db.collection('fletesDB').doc(tu1);
          const yaExiste = (await ref.get()).exists;
          if (yaExiste) continue; // ya registrado antes (correo repetido/reenviado) — no es un error, se ignora
          await ref.set({
            ordenEmbarque: tu1, tu2: tu2, pedidoFlete: r.pedidoFlete || null,
            destino: r.destino || '', tienda: r.tienda || '', fecha: r.fecha || c.fecha || new Date().toISOString().slice(0, 10),
            economico: r.economico ? parseInt(String(r.economico).replace(/[^0-9]/g, '') || 0) || null : null,
            montoFlete: r.monto != null ? parseFloat(r.monto) || null : null,
            estado: 'pendiente_factura', facturaUUID: null, facturaFolio: null, montoFactura: null,
            capturadoPor: 'Buzón automático (fletes@mudandote.mx)', fechaAlta: new Date().toISOString()
          });
          totalRegistrados++;
          const rProv = _crearProvisionalFleteServer(ingresosDBProv, operadoresProv, {
            ordenEmbarque: tu1, tu2: tu2, pedidoFlete: r.pedidoFlete, destino: r.destino, tienda: r.tienda,
            fecha: r.fecha || c.fecha, economico: r.economico, montoFlete: r.monto
          });
          if (rProv.ok) provisionalesCreados++;
        } catch (e) {
          console.error('revisarBuzonPedidos: error registrando renglón:', e);
          renglonesSinOrden.push(r);
        }
      }
      if (renglonesSinOrden.length) conAlgoPendiente.push(Object.assign({}, c, { renglones: renglonesSinOrden }));
    }
    if (provisionalesCreados) {
      await refIngresosProv.set({ data: JSON.stringify(ingresosDBProv) });
    }
    if (conAlgoPendiente.length) {
      const ref = db.collection('estado').doc('correosPedidosPendientes');
      const snap = await ref.get();
      const previos = (snap.exists && snap.data().data) ? JSON.parse(snap.data().data) : [];
      await ref.set({ data: JSON.stringify(previos.concat(conAlgoPendiente)) });
    }
    encontrados._totalRegistrados = totalRegistrados;
    encontrados._totalPendientes = conAlgoPendiente.length;
    encontrados._totalProvisionales = provisionalesCreados;
    return encontrados;
  });
}

exports.revisarBuzonPedidos = onRequest(
  { secrets: [FLETES_EMAIL_USER, FLETES_EMAIL_PASS, ANTHROPIC_API_KEY], cors: true, region: 'us-central1', timeoutSeconds: 300 },
  async (req, res) => {
    try {
      const encontrados = await _revisarBuzonPedidosCore(FLETES_EMAIL_USER.value(), FLETES_EMAIL_PASS.value(), ANTHROPIC_API_KEY.value());
      res.json({ ok: true, correosNuevos: encontrados.length, pedidosRegistrados: encontrados._totalRegistrados || 0, pendientesRevision: encontrados._totalPendientes || 0, ingresosProvisionales: encontrados._totalProvisionales || 0 });
    } catch (e) {
      console.error('revisarBuzonPedidos:', e);
      res.status(500).json({ error: e.message || 'Error interno del servidor.' });
    }
  }
);

exports.revisarBuzonPedidosProgramado = onSchedule(
  { schedule: '0 * * * *', timeZone: 'America/Mexico_City', secrets: [FLETES_EMAIL_USER, FLETES_EMAIL_PASS, ANTHROPIC_API_KEY], region: 'us-central1', timeoutSeconds: 300 },
  async () => {
    const inicio = new Date().toISOString();
    try {
      const encontrados = await _revisarBuzonPedidosCore(FLETES_EMAIL_USER.value(), FLETES_EMAIL_PASS.value(), ANTHROPIC_API_KEY.value());
      await db.collection('estado').doc('buzonPedidosEstado').set({
        ultimaEjecucion: inicio, ok: true, correosNuevos: encontrados.length,
        pedidosRegistrados: encontrados._totalRegistrados || 0, pendientesRevision: encontrados._totalPendientes || 0, error: null
      });
    } catch (e) {
      console.error('revisarBuzonPedidosProgramado:', e);
      try {
        await db.collection('estado').doc('buzonPedidosEstado').set({ ultimaEjecucion: inicio, ok: false, error: e.message || String(e) });
      } catch (e2) { console.error('revisarBuzonPedidosProgramado: no se pudo guardar el estado del error:', e2); }
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════
// LOGIN DE OPERADORES (módulo operador.html) — autenticación propia por
// teléfono + PIN de 4 dígitos, SEPARADA del login de oficina (Firebase Auth
// con correo/contraseña + custom claims, ver shared/sesion.js y
// admin/crear-usuarios.js). El operador no tiene cuenta de correo; en su
// lugar, esta función valida teléfono+PIN contra la colección
// operadoresAuth (nunca expuesta al cliente — solo el SDK de administrador,
// aquí y en admin/asignar-pin-operador.js, la lee/escribe) y, si es
// correcto, deja al operador con los MISMOS custom claims que usa el resto
// del sistema ({rol:'operador', operadorId}), para poder reutilizar el
// patrón de permisos ya existente en las reglas de Firestore y en otras
// Cloud Functions.
//
// El PIN de cada operador se da de alta con
// admin/asignar-pin-operador.js (script local, requiere
// serviceAccountKey.json — igual que admin/crear-usuarios.js). El hash
// usado aquí (scrypt) debe coincidir EXACTO con el de ese script: si se
// cambia uno, hay que cambiar el otro.
// ══════════════════════════════════════════════════════════════════════════
const crypto = require('crypto');

function _hashPin(pin, saltHex) {
  return crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 64).toString('hex');
}

function _normalizarTelefonoOperador(v) {
  return String(v || '').replace(/\D/g, '').slice(-10);
}

const _LOGIN_OPERADOR_INTENTOS_MAX = 5;
const _LOGIN_OPERADOR_BLOQUEO_MINUTOS = 15;

exports.loginOperador = onRequest({ cors: true, region: 'us-central1' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido, usa POST.' });
    return;
  }
  const telefono = _normalizarTelefonoOperador(req.body && req.body.telefono);
  const pin = String((req.body && req.body.pin) || '').trim();
  if (telefono.length !== 10) {
    res.status(400).json({ error: 'El teléfono debe tener 10 dígitos.' });
    return;
  }
  if (!/^\d{4}$/.test(pin)) {
    res.status(400).json({ error: 'El PIN debe ser de 4 dígitos.' });
    return;
  }
  try {
    const snap = await db.collection('operadoresAuth').where('telefono', '==', telefono).limit(1).get();
    if (snap.empty) {
      res.status(401).json({ error: 'Teléfono o PIN incorrecto.' });
      return;
    }
    const docRef = snap.docs[0].ref;
    const datos = snap.docs[0].data();
    const operadorId = snap.docs[0].id;

    if (datos.bloqueadoHasta && datos.bloqueadoHasta > new Date().toISOString()) {
      res.status(429).json({ error: 'Cuenta bloqueada temporalmente por varios intentos fallidos. Intenta de nuevo más tarde.' });
      return;
    }

    const hashCalculado = _hashPin(pin, datos.salt);
    if (hashCalculado !== datos.hash) {
      const intentos = (datos.intentosFallidos || 0) + 1;
      const actualizacion = { intentosFallidos: intentos };
      if (intentos >= _LOGIN_OPERADOR_INTENTOS_MAX) {
        actualizacion.bloqueadoHasta = new Date(Date.now() + _LOGIN_OPERADOR_BLOQUEO_MINUTOS * 60000).toISOString();
        actualizacion.intentosFallidos = 0;
      }
      await docRef.set(actualizacion, { merge: true });
      res.status(401).json({ error: 'Teléfono o PIN incorrecto.' });
      return;
    }

    await docRef.set({ intentosFallidos: 0, bloqueadoHasta: null, ultimoLogin: new Date().toISOString() }, { merge: true });

    // "maestro" (id fijo, dado de alta con `node admin/asignar-pin-operador.js
    // maestro ...`) es una cuenta de PRUEBA/administración: NO está ligada a
    // un operadorId, así que puede subir evidencias de CUALQUIER operador
    // (útil para la demo con Raúl antes de dar de alta a los operadores
    // reales, y después para que la oficina capture evidencia por un
    // operador que aún no tenga o no use su propia cuenta). El resto del
    // flujo (candado de dinero) queda bloqueado para esta cuenta porque no
    // tiene operadorId — "solicitar dinero" no aplica a un usuario maestro.
    const esMaestro = operadorId === 'maestro';
    let nombre = datos.nombre || '';
    if (!esMaestro) {
      const opDoc = await db.collection('operadores').doc(operadorId).get();
      nombre = opDoc.exists ? (opDoc.data().nombre || '') : nombre;
    }

    const uid = esMaestro ? 'operador_maestro' : ('operador_' + operadorId);
    try {
      await admin.auth().getUser(uid);
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        await admin.auth().createUser({ uid: uid, displayName: nombre });
      } else {
        throw e;
      }
    }
    const claims = esMaestro
      ? { rol: 'operador', maestro: true, operadorId: null }
      : { rol: 'operador', operadorId: parseInt(operadorId) };
    await admin.auth().setCustomUserClaims(uid, claims);
    const token = await admin.auth().createCustomToken(uid);

    res.json({ token: token, operadorId: esMaestro ? null : parseInt(operadorId), maestro: esMaestro, nombre: nombre });
  } catch (e) {
    console.error('loginOperador:', e);
    res.status(500).json({ error: e.message || 'Error interno del servidor.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// SOLICITAR DINERO (módulo operador.html, Fase 3) — cada solicitud va ligada
// a UN VIAJE (un pedido de flete/fletesDB) — un operador nunca pide "porque
// se le antoja", sino contra un viaje concreto. Reglas para un operador
// normal (rol:'operador', SIN maestro:true):
//   1) Ese viaje debe tener evidencia completa subida (orden de embarque
//      sellada + recibo de maniobra) — si no, se bloquea.
//   2) El monto no puede pasar de 50% de SU comisión sobre ese viaje
//      (montoFlete * comisión% * 50%) — nunca más.
//   3) Una vez solicitado dinero para ese viaje, NO se puede volver a pedir
//      para el mismo viaje (fletesDB.anticipoOperadorSolicitado).
//
// La cuenta MAESTRO es la excepción a propósito: el dueño del negocio puede
// autorizar manualmente un monto distinto para cualquier operador/viaje
// ("si me llaman y considero que puedo prestarles una cantidad diferente,
// se las subo, sin limitantes") — para maestro se SALTAN los 3 candados de
// arriba (evidencia, tope del 50%, un solo request por viaje), pero la
// solicitud igual se registra ligada al viaje elegido, para que quede
// trazabilidad de a cuál operador/viaje corresponde.
// ══════════════════════════════════════════════════════════════════════════
async function _verificarOperador(req) {
  const encabezado = (req.get('Authorization') || '');
  const m = encabezado.match(/^Bearer (.+)$/);
  if (!m) throw new Error('Falta la sesión (token). Vuelve a entrar.');
  const decoded = await admin.auth().verifyIdToken(m[1]);
  if (decoded.rol !== 'operador') throw new Error('Esta cuenta no tiene acceso de operador.');
  return decoded;
}

// Duplicados a propósito (no requeridos por Firestore, funciones puras) —
// deben coincidir EXACTO con normalizarOrdenEmbarque (shared/fletes.js) y
// normEconomico (ing.html) para que un mismo viaje siempre resuelva al mismo
// documento de fletesDB/al mismo económico sin importar desde dónde se llame.
function _normalizarOrdenEmbarqueServer(valor) {
  return (valor == null ? '' : String(valor)).trim().toUpperCase().replace(/\s+/g, '').replace(/^0+(?=\d)/, '');
}
const _ECO_MAP_45XX = { 521: 4521, 522: 4522, 523: 4523, 524: 4524, 526: 4526 };
function _normEconomicoServer(eco) {
  const n = parseInt(String(eco || '').replace(/[^0-9]/g, '') || 0, 10) || 0;
  return _ECO_MAP_45XX[n] || n;
}

exports.solicitarAnticipoOperador = onRequest({ cors: true, region: 'us-central1' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido, usa POST.' });
    return;
  }
  try {
    const claims = await _verificarOperador(req);
    const ordenEmbarque = _normalizarOrdenEmbarqueServer(req.body && req.body.ordenEmbarque);
    const importe = parseFloat(req.body && req.body.importe);
    if (!ordenEmbarque) { res.status(400).json({ error: 'Falta indicar el viaje.' }); return; }
    if (!importe || importe <= 0) { res.status(400).json({ error: 'El monto debe ser mayor a 0.' }); return; }

    const fleteRef = db.collection('fletesDB').doc(ordenEmbarque);
    const fleteSnap = await fleteRef.get();
    if (!fleteSnap.exists) { res.status(404).json({ error: 'No se encontró ese viaje en el Archivo Maestro.' }); return; }
    const flete = fleteSnap.data();

    // Identificar al operador dueño del viaje por el económico del flete —
    // para un operador normal, además confirma que el viaje SÍ es suyo (no
    // puede pedir dinero de un viaje de otra unidad).
    let operadorId;
    if (claims.maestro) {
      if (!flete.economico) { res.status(400).json({ error: 'Ese viaje no tiene económico registrado — no se puede identificar a qué operador corresponde.' }); return; }
      const opQuery = await db.collection('operadores').where('unidadActual', '==', _normEconomicoServer(flete.economico)).limit(1).get();
      if (opQuery.empty) { res.status(404).json({ error: 'No se encontró un operador con esa unidad.' }); return; }
      operadorId = parseInt(opQuery.docs[0].id);
    } else {
      operadorId = claims.operadorId;
      const opDoc = await db.collection('operadores').doc(String(operadorId)).get();
      const miUnidad = opDoc.exists ? opDoc.data().unidadActual : null;
      if (!miUnidad || _normEconomicoServer(flete.economico) !== miUnidad) {
        res.status(403).json({ error: 'Ese viaje no está asignado a tu unidad.' });
        return;
      }
    }

    if (!claims.maestro) {
      if (!(flete.ordenEmbarqueImgURL && flete.reciboManiobraImgURL)) {
        res.status(403).json({ error: 'Este viaje todavía no tiene evidencia completa (orden de embarque sellada + recibo de maniobra). Súbela antes de solicitar dinero.' });
        return;
      }
      if (flete.anticipoOperadorSolicitado) {
        res.status(403).json({ error: 'Ya se solicitó dinero para este viaje — no se puede volver a pedir.' });
        return;
      }
      if (flete.fechaAlta && (Date.now() > new Date(flete.fechaAlta).getTime() + 36 * 60 * 60 * 1000)) {
        res.status(403).json({ error: 'Ya pasaron más de 36 horas desde que este viaje se asignó — se venció la ventana para solicitar dinero de él.' });
        return;
      }
      if (!flete.montoFlete) {
        res.status(400).json({ error: 'Este viaje no tiene monto de flete registrado — no se puede calcular el tope permitido.' });
        return;
      }
      const opDocComision = await db.collection('operadores').doc(String(operadorId)).get();
      const comision = (opDocComision.exists && opDocComision.data().comision != null) ? opDocComision.data().comision : 12;
      const tope = flete.montoFlete * (comision / 100) * 0.5;
      if (importe > tope + 0.01) {
        res.status(403).json({ error: 'El monto máximo permitido para este viaje es $' + tope.toFixed(2) + ' (50% de tu comisión sobre este viaje).' });
        return;
      }
    }

    await db.runTransaction(async (tx) => {
      if (!claims.maestro) {
        const freshFlete = await tx.get(fleteRef);
        if (!freshFlete.exists || freshFlete.data().anticipoOperadorSolicitado) {
          throw new Error('Ya se solicitó dinero para este viaje — no se puede volver a pedir.');
        }
      }
      const ref = db.collection('estado').doc('anticiposDB');
      const snap = await tx.get(ref);
      let anticiposDB = (snap.exists && snap.data().data) ? JSON.parse(snap.data().data) : {};
      if (Array.isArray(anticiposDB)) anticiposDB = {}; // mismo guard que el resto del sistema — nunca tratar como arreglo
      const key = String(operadorId);
      if (!Array.isArray(anticiposDB[key])) anticiposDB[key] = [];
      anticiposDB[key].push({
        id: 'op-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        fecha: new Date().toISOString().slice(0, 10),
        importe: importe,
        concepto: 'Solicitud desde app de operador — viaje ' + ordenEmbarque + (claims.maestro ? ' (autorizado manualmente por usuario maestro)' : ''),
        estado: 'pendiente',
        liqNum: null,
        origen: 'app_operador',
        ordenEmbarque: ordenEmbarque,
        unidadAlCapturar: flete.economico || null,
        capturadoEn: new Date().toISOString()
      });
      tx.set(ref, { data: JSON.stringify(anticiposDB) }, { merge: true });
      if (!claims.maestro) {
        tx.set(fleteRef, { anticipoOperadorSolicitado: true, anticipoOperadorMonto: importe, anticipoOperadorEn: new Date().toISOString() }, { merge: true });
      }
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('solicitarAnticipoOperador:', e);
    res.status(500).json({ error: e.message || 'Error interno del servidor.' });
  }
});
