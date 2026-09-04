// ══════════════════════════════════════════════════════════════════════════
// admin/asignar-pin-operador.js
//
// Script de mantenimiento para dar de alta o cambiar el teléfono+PIN de
// acceso al módulo operador.html (login propio por teléfono+PIN, ver
// exports.loginOperador en functions/index.js — SEPARADO del login de
// oficina de admin/crear-usuarios.js).
//
// Da de alta DOS tipos de cuenta:
//   1) Un OPERADOR real, ligado a un operadorId de la colección
//      "operadores" — solo puede ver/subir SU PROPIA evidencia y
//      solicitar dinero para sí mismo.
//   2) La cuenta "maestro" (id fijo, no ligada a ningún operadorId) — para
//      probar el módulo (con Raúl o quien tú decidas) antes de dar de alta
//      operadores reales, o para que la oficina suba evidencia por un
//      operador que aún no use su propia cuenta. Puede subir evidencia de
//      CUALQUIER operador, pero no puede solicitar dinero (no tiene
//      operadorId).
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
// Operador real:
//   node admin/asignar-pin-operador.js <operadorId> <telefono10digitos> <pin4digitos>
//   Ejemplo: node admin/asignar-pin-operador.js 4526 5512345678 1234
//
// Cuenta maestro (demo/pruebas):
//   node admin/asignar-pin-operador.js maestro <telefono10digitos> <pin4digitos> <nombre a mostrar>
//   Ejemplo: node admin/asignar-pin-operador.js maestro 5519876543 4321 Raul (demo)
//
// Se puede volver a correr con el mismo operadorId (o "maestro") para
// CAMBIAR su teléfono o PIN (reemplaza el registro anterior por completo —
// no hay "recuperar PIN olvidado" más que volver a correr esto).
// ══════════════════════════════════════════════════════════════════════════

const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const crypto = require('crypto');
const path = require('path');

const RUTA_SERVICE_ACCOUNT = path.join(__dirname, '..', 'serviceAccountKey.json');

admin.initializeApp({
  credential: admin.cert(require(RUTA_SERVICE_ACCOUNT))
});
const db = getFirestore();

// IMPORTANTE: este hash debe coincidir EXACTO con _hashPin() en
// functions/index.js (exports.loginOperador) — si cambias uno, cambia el
// otro, o las cuentas ya dadas de alta dejarán de poder entrar.
function hashPin(pin, saltHex) {
  return crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 64).toString('hex');
}

const [, , idArg, telefonoArg, pinArg, ...nombreParts] = process.argv;

(async function main() {
  if (!idArg || !telefonoArg || !pinArg) {
    console.error('Uso (operador real):  node admin/asignar-pin-operador.js <operadorId> <telefono10digitos> <pin4digitos>');
    console.error('Uso (cuenta maestro): node admin/asignar-pin-operador.js maestro <telefono10digitos> <pin4digitos> <nombre a mostrar>');
    process.exit(1);
  }

  const esMaestro = idArg.trim().toLowerCase() === 'maestro';
  const telefono = telefonoArg.replace(/\D/g, '').slice(-10);
  const pin = String(pinArg).trim();

  if (telefono.length !== 10) {
    console.error('❌ El teléfono debe tener 10 dígitos (recibido: "' + telefonoArg + '").');
    process.exit(1);
  }
  if (!/^\d{4}$/.test(pin)) {
    console.error('❌ El PIN debe ser de 4 dígitos (recibido: "' + pinArg + '").');
    process.exit(1);
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPin(pin, salt);

  if (esMaestro) {
    const nombre = nombreParts.join(' ').trim() || 'Usuario maestro';
    await db.collection('operadoresAuth').doc('maestro').set({
      telefono: telefono, salt: salt, hash: hash, nombre: nombre, esMaestro: true,
      intentosFallidos: 0, bloqueadoHasta: null, actualizadoEn: new Date().toISOString()
    });
    console.log('✅ Cuenta maestro creada/actualizada: ' + nombre + ' (teléfono ' + telefono + ', PIN ' + pin + ').');
    console.log('   Puede entrar a operador.html y (cuando esté esa fase) subir evidencia de cualquier operador.');
    process.exit(0);
  }

  const operadorId = String(parseInt(idArg, 10));
  if (!operadorId || operadorId === 'NaN') {
    console.error('❌ operadorId inválido: ' + idArg);
    process.exit(1);
  }

  const opDoc = await db.collection('operadores').doc(operadorId).get();
  if (!opDoc.exists) {
    console.error('❌ No existe el operador con id ' + operadorId + ' en la colección "operadores".');
    process.exit(1);
  }

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
