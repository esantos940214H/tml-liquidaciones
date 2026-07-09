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
// 2. Abre este archivo y llena los EMAILS y CONTRASEÑAS TEMPORALES marcados
//    más abajo con "// ← LLENAR AQUÍ" (no dejes las contraseñas de ejemplo).
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
// rol: 'admin' | 'cobranza' | 'operaciones' | 'consulta'
// permisos (candados de ACCIÓN, no de ver módulos — ver shared/sesion.js):
//   anticipos_editar, ingresos_editar, incidentes_editar, casetas_editar
// El admin recibe TODOS los permisos true, independientemente de rol==='admin'
// (que ya de por sí lo deja pasar todo en tienePermiso() — se listan explícitos
// aquí solo para que quede claro/documentado en los claims).
const USUARIOS = [
  {
    email: 'EMILIO_EMAIL_AQUI@mudanzastml.mx', // ← LLENAR AQUÍ
    passwordTemporal: 'CONTRASEÑA_TEMPORAL_EMILIO', // ← LLENAR AQUÍ (cámbiala después de correr el script)
    nombre: 'Emilio Santos',
    rol: 'admin',
    permisos: {
      anticipos_editar: true,
      ingresos_editar: true,
      incidentes_editar: true,
      casetas_editar: true
    }
  },
  {
    email: 'KARLA_EMAIL_AQUI@mudanzastml.mx', // ← LLENAR AQUÍ
    passwordTemporal: 'CONTRASEÑA_TEMPORAL_KARLA', // ← LLENAR AQUÍ
    nombre: 'Karla',
    rol: 'cobranza',
    permisos: {
      anticipos_editar: true,
      ingresos_editar: false,
      incidentes_editar: false,
      casetas_editar: false
    }
  },
  {
    email: 'RAUL_EMAIL_AQUI@mudanzastml.mx', // ← LLENAR AQUÍ
    passwordTemporal: 'CONTRASEÑA_TEMPORAL_RAUL', // ← LLENAR AQUÍ
    nombre: 'Raúl',
    rol: 'operaciones',
    permisos: {
      anticipos_editar: false,
      ingresos_editar: true,
      incidentes_editar: false,
      casetas_editar: false
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
    if (def.email.includes('_EMAIL_AQUI')) {
      console.warn('⚠️  Saltando "' + def.nombre + '": falta llenar su email/contraseña en este archivo (busca "← LLENAR AQUÍ").');
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
