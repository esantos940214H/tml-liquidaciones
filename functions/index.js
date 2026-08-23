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
  'Eres un asistente que extrae datos de un correo de autorización de maniobras de una empresa de mudanzas. ' +
  'Del texto que te paso, identifica CADA renglón/maniobra que traiga (puede haber varios, uno por operador o viaje). ' +
  'Responde SOLO un arreglo JSON (sin texto explicativo, sin backticks, sin markdown), donde cada elemento tenga ' +
  'exactamente estas llaves: {"operador":"nombre de la persona tal cual aparece en el correo","monto":numero_sin_signos_de_pesos_ni_comas,' +
  '"fecha":"YYYY-MM-DD o null si no aparece","pedido":"número de pedido/PO/referencia tal cual, o null","destino":"ciudad o lugar destino, o null"}. ' +
  'Si el correo no trae ninguna maniobra reconocible, responde con un arreglo vacío []. No inventes datos que no estén en el texto.';

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
          max_tokens: 2000,
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
