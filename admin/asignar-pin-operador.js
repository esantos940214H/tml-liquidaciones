// ══════════════════════════════════════════════════════════════════════════
// admin/asignar-pin-operador.js
//
// Script de mantenimiento para dar de alta o cambiar el teléfono+PIN de
// acceso de un operador al módulo operador.html (login propio por
// teléfono+PIN, ver exports.loginOperador en functions/index.js — SEPARADO
// del login de oficina de admin/crear-usuarios.js).
//
// IMPORTANTE: este script se corre LOCAL, con Node.js — NUNCA se despliega
// ni se sube al navegador (necesita la clave de service account). build.sh
// no lo copia a dist/, así que no llega a Firebase Hosting aunque quede
// commiteado en el repo.
//
// ── CÓMO OBTENER LA SERVICE ACCOUNT KEY ─────────────────────────────────────
// Igual que admin/crear-usuarios.js — ver las instrucciones al inicio de
// ese archivo si no tienes ya serviceAccountKey.json en la raíz del repo.
//
// ── CÓMO CORRERLO ───────────────────────────────────────────────────────────
// node admin/asignar-pin-operador.js <operadorId> <telefono10digitos> <pin4digitos>
//
// Ejemplo (Raúl, usando su operadorId real de la colección "operadores",
// para la demo del módulo antes de dar de alta operadores reales):
//   node admin/asignar-pin-operador.js 4526 5512345678 1234
//
// Se puede volver a correr con el mismo operadorId para CAMBIAR su
// teléfono o PIN (reemplaza el registro anterior por completo — no hay
// "recuperar PIN olvidado" más que volver a correr esto).
// ══════════════════════════════════════════════════════════════════════════

const admin = require('firebase-admin');
const crypto = require('crypto');
const path = require('path');

const RUTA_SERVICE_ACCOUNT = path.join(__dirname, '..', 'serviceAccountKey.json');

admin.initializeApp({
  credential: admin.cert(require(RUTA_SERVICE_ACCOUNT))
});
const db = admin.firestore();

// IMPORTANTE: este hash debe coincidir EXACTO con _hashPin() en
// functions/index.js (exports.loginOperador) — si cambias uno, cambia el
// otro, o los operadores ya dados de alta dejarán de poder entrar.
function hashPin(pin, saltHex) {
  return crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 64).toString('hex');
}

const [, , operadorIdArg, telefonoArg, pinArg] = process.argv;

(async function main() {
  if (!operadorIdArg || !telefonoArg || !pinArg) {
    console.error('Uso: node admin/asignar-pin-operador.js <operadorId> <telefono10digitos> <pin4digitos>');
    process.exit(1);
  }

  const operadorId = String(parseInt(operadorIdArg, 10));
  const telefono = telefonoArg.replace(/\D/g, '').slice(-10);
  const pin = String(pinArg).trim();

  if (!operadorId || operadorId === 'NaN') {
    console.error('❌ operadorId inválido: ' + operadorIdArg);
    process.exit(1);
  }
  if (telefono.length !== 10) {
    console.error('❌ El teléfono debe tener 10 dígitos (recibido: "' + telefonoArg + '").');
    process.exit(1);
  }
  if (!/^\d{4}$/.test(pin)) {
    console.error('❌ El PIN debe ser de 4 dígitos (recibido: "' + pinArg + '").');
    process.exit(1);
  }

  const opDoc = await db.collection('operadores').doc(operadorId).get();
  if (!opDoc.exists) {
    console.error('❌ No existe el operador con id ' + operadorId + ' en la colección "operadores".');
    process.exit(1);
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPin(pin, salt);

  await db.collection('operadoresAuth').doc(operadorId).set({
    telefono: telefono,
    salt: salt,
    hash: hash,
    intentosFallidos: 0,
    bloqueadoHasta: null,
    actualizadoEn: new Date().toISOString()
  });

  console.log('✅ Teléfono+PIN asignado a ' + (opDoc.data().nombre || '(sin nombre)') + ' (operadorId ' + operadorId + ', teléfono ' + telefono + ', PIN ' + pin + ').');
  console.log('   El operador ya puede entrar a operador.html con ese teléfono y PIN.');
  process.exit(0);
})().catch(function (err) {
  console.error('❌ Error:', err);
  process.exit(1);
});
