/*
 * Cloudflare Worker — Proxy de validación de estado de CFDI ante el SAT
 * ═══════════════════════════════════════════════════════════════════
 * Este archivo NO se sirve desde GitHub Pages ni forma parte de la app.
 * Es el código fuente de un Worker que se despliega por separado en
 * Cloudflare (gratis) para poder consultar el servicio del SAT sin que
 * el navegador lo bloquee por CORS.
 *
 * QUÉ HACE:
 *   Recibe {uuid, rfcEmisor, rfcReceptor, total} desde liq.html/ing.html,
 *   arma la petición SOAP que pide el SAT, la manda servidor-a-servidor
 *   (sin problema de CORS porque no es un navegador quien llama), y
 *   regresa un JSON simple: {estado, cancelado, ...}.
 *
 * CÓMO DESPLEGARLO (una sola vez, ~5 minutos):
 *   1. Crea una cuenta gratis en https://dash.cloudflare.com/sign-up
 *   2. En el dashboard: Workers & Pages → Create → Create Worker.
 *   3. Ponle un nombre, ej. "sat-cfdi-proxy" → Deploy.
 *   4. Abre "Edit code", borra el contenido de ejemplo, pega TODO este
 *      archivo, y dale "Deploy" de nuevo.
 *   5. Cambia ALLOWED_ORIGIN abajo si tu sitio no es exactamente
 *      https://esantos940214h.github.io (déjalo así si sí lo es).
 *   6. Copia la URL que te da Cloudflare (algo como
 *      https://sat-cfdi-proxy.<tu-usuario>.workers.dev) y pégala como
 *      valor de SAT_PROXY_URL en liq.html e ing.html.
 *
 * Alternativa con línea de comandos (si tienes Node/npm):
 *   npm install -g wrangler
 *   wrangler login
 *   wrangler deploy sat-cfdi-worker.js --name sat-cfdi-proxy
 */

const ALLOWED_ORIGIN = 'https://esantos940214h.github.io';
const SAT_URL = 'https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc';

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Método no permitido. Usa POST.' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'JSON inválido en el cuerpo de la petición.' }, 400);
    }

    const { uuid, rfcEmisor, rfcReceptor, total } = body || {};
    if (!uuid || !rfcEmisor || !rfcReceptor || total == null) {
      return json({ error: 'Faltan datos: se requieren uuid, rfcEmisor, rfcReceptor y total.' }, 400);
    }

    const totalStr = Number(total).toFixed(6);
    const expresionImpresa = `?re=${encodeXmlText(rfcEmisor)}&rr=${encodeXmlText(rfcReceptor)}&tt=${totalStr}&id=${encodeXmlText(uuid)}`;

    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soapenv:Header/>
  <soapenv:Body>
    <tem:Consulta>
      <tem:expresionImpresa>${escapeXml(expresionImpresa)}</tem:expresionImpresa>
    </tem:Consulta>
  </soapenv:Body>
</soapenv:Envelope>`;

    try {
      const satRes = await fetch(SAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': 'http://tempuri.org/IConsultaCFDIService/Consulta'
        },
        body: soapBody
      });

      if (!satRes.ok) {
        return json({ error: 'El SAT respondió con error HTTP ' + satRes.status, estado: 'No verificado', cancelado: false }, 502);
      }

      const text = await satRes.text();
      const estado = extractField(text, 'Estado');
      const esCancelable = extractField(text, 'EsCancelable');
      const estatusCancelacion = extractField(text, 'EstatusCancelacion');
      const codigoEstatus = extractField(text, 'CodigoEstatus');
      const validacionEFOS = extractField(text, 'ValidacionEFOS');

      return json({
        uuid,
        estado: estado || 'No encontrado',
        cancelado: /CANCELADO/i.test(estado || ''),
        esCancelable,
        estatusCancelacion,
        codigoEstatus,
        validacionEFOS
      });
    } catch (e) {
      return json({ error: 'No se pudo consultar el SAT: ' + e.message, estado: 'No verificado', cancelado: false }, 502);
    }
  }
};

// Extrae el valor de una etiqueta tipo <a:Estado>Vigente</a:Estado> o <Estado>Vigente</Estado>
function extractField(xml, tag) {
  const re = new RegExp('<(?:\\w+:)?' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?' + tag + '>');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}
function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function encodeXmlText(s) {
  return String(s).trim();
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() }
  });
}
