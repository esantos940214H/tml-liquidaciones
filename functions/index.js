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
// El revisor también corre solo cada 30 minutos (onSchedule, abajo) — el
// botón en la página es nada más para no tener que esperar al probar.
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
    // Nunca sobrescribir: leer lo que ya había pendiente de revisar y
    // agregar los nuevos correos al final (mismo principio que
    // ingresosDB/anticiposDB — fusionar, no reemplazar en bloque).
      try {
        console.log('revisarBuzonManiobras: guardando ' + encontrados.length + ' correo(s) en Firestore...');
        const ref = db.collection('estado').doc('correosManiobrasPendientes');
        const snap = await ref.get();
        const previos = (snap.exists && snap.data().data) ? JSON.parse(snap.data().data) : [];
        await ref.set({ data: JSON.stringify(previos.concat(encontrados)) });
        console.log('revisarBuzonManiobras: guardado en Firestore exitoso.');
      } catch (e) {
        console.error('revisarBuzonManiobras: error guardando en Firestore:', e);
        throw e;
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
      res.json({ ok: true, correosNuevos: encontrados.length });
    } catch (e) {
      console.error('revisarBuzonManiobras:', e);
      res.status(500).json({ error: e.message || 'Error interno del servidor.' });
    }
  }
);

// Corre solo cada 30 minutos — así aunque nadie entre a la página, los
// correos nuevos se van juntando en estado/correosManiobrasPendientes para
// cuando Raúl entre a revisarlos.
exports.revisarBuzonManiobrasProgramado = onSchedule(
  { schedule: 'every 30 minutes', secrets: [ANTHROPIC_API_KEY, MANIOBRAS_EMAIL_USER, MANIOBRAS_EMAIL_PASS], region: 'us-central1', timeoutSeconds: 300 },
  async () => {
    await _revisarBuzonCore(ANTHROPIC_API_KEY.value(), MANIOBRAS_EMAIL_USER.value(), MANIOBRAS_EMAIL_PASS.value());
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
  'listado de servicios por unidad/económico). El documento puede venir como tabla o como texto libre, y normalmente ' +
  'trae, para cada servicio/viaje/registro: el número económico o identificador de la unidad, una fecha, y a veces una ' +
  'descripción breve. Extrae UN renglón por cada servicio/viaje/registro que encuentres, con estas llaves exactas: ' +
  '{"unidad":"el número económico o identificador de la unidad tal cual aparece en ese renglón, o null si no se puede ' +
  'determinar","fecha":"YYYY-MM-DD si se puede convertir desde el formato que traiga, o null","descripcion":"una ' +
  'descripción breve de ese renglón (tipo de servicio, ruta, concepto), o null"}. ' +
  'No inventes datos que no estén en el documento. Responde SOLO un arreglo JSON (sin texto explicativo, sin ' +
  'backticks, sin markdown) con un objeto por cada renglón que encuentres. Si no hay ningún renglón reconocible, ' +
  'responde [].';

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
