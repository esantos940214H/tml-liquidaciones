// ══════════════════════════════════════════════════════════════════════════
// admin/crear-usuarios.js
//
// Script de un solo uso (o de mantenimiento) para crear/actualizar usuarios
// de Firebase Authentication y asignarles custom claims de rol y permisos.
//
// IMPORTANTE: este script se corre LOCAL, con Node.js — NUNCA se despliega
// ni se sube al navegador (necesita la clave de service account, que da
// acceso total al proyecto de Firebase). build.sh no lo copia a dist/, así
// que no llega a Firebase Hosting aunque quede commiteado en el repo.
//
// ── CÓMO OBTENER LA SERVICE ACCOUNT KEY ─────────────────────────────────────
// 1. Entra a la consola de Firebase → https://console.firebase.google.com
// 2. Selecciona el proyecto "tml-liquidaciones".
// 3. Ícono de engrane (⚙️) → "Configuración del proyecto".
// 4. Pestaña "Cuentas de servicio" (Service accounts).
// 5. Botón "Generar nueva clave privada" (Generate new private key).
// 6. Se descarga un archivo .json — guárdalo como
//    serviceAccountKey.json en la RAÍZ del repo (ya está en .gitignore,
//    así que no se sube a git aunque quede ahí). Si ya tienes uno de antes
//    en la raíz del repo, puedes reutilizarlo.
//
// ── CÓMO CORRERLO ───────────────────────────────────────────────────────────
// 1. npm install firebase-admin   (una sola vez, en la raíz del repo o donde
//    prefieras — este script no depende de nada más del proyecto)
// 2. Abre este archivo y llena las CONTRASEÑAS TEMPORALES marcadas más abajo
//    con "// ← LLENAR AQUÍ" (los emails ya están puestos según la lista que
//    diste — Firebase Auth NO necesita que el correo reciba nada para poder
//    iniciar sesión con email+contraseña, así que no hay problema en crear
//    ya la cuenta de Firebase aunque el buzón real de "tesoreria@..." o
//    "liquidaciones@..." todavía no exista).
// 3. node admin/crear-usuarios.js
// 4. Revisa la salida en consola: confirma "creado"/"actualizado" y los
//    claims asignados para cada usuario.
// 5. Dile a cada persona su email y contraseña temporal para que inicie
//    sesión, y qué tan pronto conviene que la cambie (este script no fuerza
//    el cambio de contraseña — eso se puede agregar después si se quiere).
//
// Se puede volver a correr después para actualizar claims o agregar gente
// nueva: si el email ya existe, se actualiza en vez de fallar.
// ══════════════════════════════════════════════════════════════════════════

const admin = require('firebase-admin');
const path = require('path');

// Ruta a la service account key (ver instrucciones arriba). Si la guardaste
// en otro lugar, ajusta esta ruta.
const RUTA_SERVICE_ACCOUNT = path.join(__dirname, '..', 'serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(require(RUTA_SERVICE_ACCOUNT))
});

// ── DEFINICIÓN DE USUARIOS A CREAR/ACTUALIZAR ───────────────────────────────
// rol: 'admin' | 'cobranza' | 'operaciones' | 'consulta' | 'nomina'
//   (informativo — el admin siempre pasa todo en tienePermiso(), sin
//   necesidad de listar cada permiso individual)
//
// permisos: dos tipos de banderas en el mismo objeto —
//   1) VER un módulo (mismo criterio que ya usaba el login viejo en
//      Firestore/usuarios.permisos): ant, ing, liq, nom, inc, hist,
//      autoriz, precarga.
//   2) Candados de ACCIÓN dentro de un módulo (reemplazan las contraseñas
//      fijas del código): anticipos_editar (antes KM2026 en ant.html),
//      ingresos_editar (antes RM2026 en ing.html), incidentes_editar
//      (antes INC2026), casetas_editar (el CAS2026 que vivía dentro de
//      liq.html ya se quitó del todo en una fase anterior, se deja aquí
//      solo por si se necesita un candado de acción ahí en el futuro).
//
// Lista según la tabla de personal (roles vigentes al día de hoy):
const USUARIOS = [
  {
    email: 'emilio@mudandote.mx',
    passwordTemporal: 'saee94$26', // ← LLENAR AQUÍ
    nombre: 'Emilio Santos Avila',
    rol: 'admin',
    permisos: {
      ant: true, ing: true, liq: true, nom: true, inc: true, hist: true, autoriz: true, precarga: true,
      anticipos_editar: true, ingresos_editar: true, incidentes_editar: true, casetas_editar: true
    }
  },
  {
    email: 'liquidaciones@mudandote.mx',
    passwordTemporal: 'M.Cordova$26', // ← LLENAR AQUÍ
    nombre: 'Margarita Cordova',
    rol: 'operaciones',
    permisos: {
      ant: false, ing: false, liq: true, nom: false, inc: false, hist: true, autoriz: false, precarga: false,
      anticipos_editar: false, ingresos_editar: false, incidentes_editar: false, casetas_editar: false
    }
  },
  {
    email: 'tesoreria@mudandote.mx',
    passwordTemporal: 'k.m2026$', // ← LLENAR AQUÍ
    nombre: 'Karla Morales Sanchez',
    rol: 'cobranza',
    permisos: {
      ant: true, ing: false, liq: false, nom: false, inc: false, hist: false, autoriz: false, precarga: false,
      anticipos_editar: true, ingresos_editar: false, incidentes_editar: false, casetas_editar: false
    }
  },
  {
    email: 'raul@mudandote.mx',
    passwordTemporal: 'R.m2026&', // ← LLENAR AQUÍ
    nombre: 'Raúl Marcial González',
    rol: 'cobranza',
    permisos: {
      ant: false, ing: true, liq: false, nom: false, inc: false, hist: false, autoriz: false, precarga: false,
      anticipos_editar: false, ingresos_editar: true, incidentes_editar: false, casetas_editar: false
    }
  },
  {
    email: 'contabilidad@mudandote.mx',
    passwordTemporal: 'R.d/2026', // ← LLENAR AQUÍ
    nombre: 'Ricardo Dominguez',
    rol: 'nomina',
    permisos: {
      ant: false, ing: false, liq: false, nom: true, inc: false, hist: false, autoriz: false, precarga: false,
      anticipos_editar: false, ingresos_editar: false, incidentes_editar: false, casetas_editar: false
    }
  }
];

async function crearOActualizarUsuario(def) {
  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(def.email);
    await admin.auth().updateUser(userRecord.uid, {
      password: def.passwordTemporal,
      displayName: def.nombre
    });
    console.log('🔄 Actualizado: ' + def.email + ' (uid ' + userRecord.uid + ')');
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      userRecord = await admin.auth().createUser({
        email: def.email,
        password: def.passwordTemporal,
        displayName: def.nombre
      });
      console.log('✅ Creado: ' + def.email + ' (uid ' + userRecord.uid + ')');
    } else {
      throw err;
    }
  }

  const claims = { rol: def.rol, permisos: def.permisos };
  await admin.auth().setCustomUserClaims(userRecord.uid, claims);
  console.log('   Claims asignados: ' + JSON.stringify(claims));
}

(async function main() {
  console.log('Creando/actualizando usuarios en Firebase Authentication...\n');
  for (const def of USUARIOS) {
    if (def.passwordTemporal.includes('CONTRASEÑA_TEMPORAL')) {
      console.warn('⚠️  Saltando "' + def.nombre + '": falta llenar su contraseña temporal en este archivo (busca "← LLENAR AQUÍ").');
      continue;
    }
    await crearOActualizarUsuario(def);
  }
  console.log('\nListo. Recuerda: el usuario debe cerrar sesión y volver a iniciar (o esperar a que su token se refresque solo) para que los custom claims nuevos surtan efecto en el navegador.');
  process.exit(0);
})().catch(function (err) {
  console.error('❌ Error:', err);
  process.exit(1);
});
