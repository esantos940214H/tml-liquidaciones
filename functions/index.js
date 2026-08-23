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
const { defineSecret } = require('firebase-functions/params');

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

const PROMPT_INSTRUCCIONES =
  'Eres un asistente que extrae datos de correos de autorización de maniobras de una empresa de mudanzas (cliente: Centros de ' +
  'Distribución, de Grupo Comercial Control). El correo trae una o varias TABLAS (a veces varias tablas mezcladas con párrafos ' +
  'repetidas de cortesía entre ellas — ignora esos párrafos) con columnas como: Folio (a veces con encabezado "#"), Fecha ' +
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
  'Responde SOLO un arreglo JSON (sin texto explicativo, sin backticks, sin markdown) con un objeto por cada renglón de ' +
  'maniobra que encuentres en TODAS las tablas del correo. Si no hay ninguna tabla/renglón reconocible, responde [].';

// v2 — forzar redeploy para tomar la versión nueva del secret ANTHROPIC_API_KEY
// (Firebase no recoge un secret actualizado si no detecta cambios en el código).
exports.extraerManiobras = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true, region: 'us-central1' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método no permitido, usa POST.' });
      return;
    }
    const texto = ((req.body && req.body.texto) || '').toString().trim();
    if (!texto) {
      res.status(400).json({ error: 'Falta el texto del correo (campo "texto").' });
      return;
    }
    if (texto.length > 20000) {
      res.status(400).json({ error: 'El texto es demasiado largo (máximo 20,000 caracteres).' });
      return;
    }
    try {
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
          messages: [{ role: 'user', content: PROMPT_INSTRUCCIONES + '\n\n--- CORREO ---\n' + texto }]
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
