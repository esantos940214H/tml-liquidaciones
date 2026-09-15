# CLAUDE.md — tml-liquidaciones

Contexto para Claude Code al trabajar en este repositorio. Léelo antes de modificar cualquier archivo.

## Qué es este proyecto

Sistema web de liquidación de operadores de transporte para **Mudanzas TML, S.A. de C.V.**
No usa framework: son archivos HTML puros con JavaScript embebido. Sí hay un paso de "build" muy simple (ver abajo) para acomodar cada archivo en su subdominio — no hay bundler, transpilador, ni `npm install` para el código de la app.

- Repo: `esantos940214H/tml-liquidaciones`
- Persistencia: **Firebase Firestore** (no hay backend propio) + **Firebase Storage** (XMLs/PDFs/fotos) + **Firebase Cloud Functions** (`functions/index.js`, buzones automáticos e integraciones con IA)
- Autenticación: **Firebase Auth** (email/contraseña) — ver "Login y sesión" abajo, tiene una limitación importante entre subdominios.

## Arquitectura: multi-sitio de Firebase Hosting, un módulo por subdominio

Cada módulo es su propio documento HTML autocontenido (su propio `<script>`, su propio DOM, su propia barra de navegación con links absolutos a los demás módulos) — **no asumas que los módulos comparten estado en memoria; todo el estado compartido pasa por Firebase.**

`firebase.json` define un "site" de Firebase Hosting por módulo, y cada uno se sirve en su propio subdominio de `mudanzastml.mx`:

| Archivo fuente | Subdominio | Función |
|---|---|---|
| `index.html` | `mudanzastml.mx` (portal) | Router — redirige al módulo correcto según sesión/permiso |
| `ant.html` | `anticipos.mudanzastml.mx` | Anticipos — CSV/TXT de BBVA, captura manual |
| `ing.html` | `cxc.mudanzastml.mx` | Ingresos — XML/PDF, captura manual |
| `maniobras.html` | `cxc.mudanzastml.mx/maniobras.html` | Autorizaciones de maniobra (correo del cliente + IA) |
| `liq.html` | `liquidaciones.mudanzastml.mx` | Liquidaciones — cálculo y cierre |
| `hist.html` | `historial.mudanzastml.mx` | Historial de liquidaciones cerradas |
| `nomina.html` | `nomina.mudanzastml.mx` | Nómina — recibos XML |
| `incidentes.html` | `incidentes.mudanzastml.mx` | Incidentes de vialidad |
| `autorizaciones.html` | `autorizaciones.mudanzastml.mx` | Autorización de gastos/casetas por supervisor |
| `precarga.html` | `precarga.mudanzastml.mx` | Pre-carga de comprobantes/reasignaciones |
| `usuarios.html` | `usuarios.mudanzastml.mx` | Alta/baja de usuarios y permisos |
| `flota.html` | `usuarios.mudanzastml.mx/flota.html` | Flota — mantenimiento (MOP), ciclos, Wialon |
| `proveedores.html` | `proveedores.mudanzastml.mx` | Cuentas por pagar — facturas de proveedor, pagos, REP |
| `operador.html` | `operador.mudanzastml.mx` | PWA para operadores (celular) — evidencias, anticipos |

`shared/*.js` son utilidades comunes cargadas con `<script src="shared/...">` (sesión, comprobantes, fletes, operadores, etc.) — un bug ahí afecta a TODOS los módulos que lo cargan.

## Cómo se despliega cada tipo de cambio

- **HTML/JS de cualquier módulo, o `shared/*.js`:** automático. Al hacer push a `main`, `.github/workflows/deploy.yml` corre `build.sh` (copia cada archivo fuente a `dist/<site>/index.html` según el mapeo de arriba — ver ese script para el detalle exacto) y despliega con `firebase deploy --only hosting` a los 13 sites. Tarda 1-2 minutos. No hay ambiente de staging — todo push a `main` es producción.
- **`functions/index.js`:** NO se despliega solo. El dueño del proyecto (E) tiene que correr manualmente desde Firebase Cloud Shell, después de hacer `cd` a la carpeta del repo clonado:
  ```
  cd tml-liquidaciones
  firebase deploy --only functions:nombreDeLaFuncion1,functions:nombreDeLaFuncion2
  ```
  Avísale siempre qué funciones exactas desplegar cuando toques ese archivo.

## Login y sesión (Firebase Auth + cookie puente — limitación importante)

- El login real es **Firebase Auth** (email/contraseña), migrado módulo por módulo.
- Firebase Auth guarda su sesión por **origen exacto** (protocolo+host) en el navegador — `anticipos.mudanzastml.mx`, `proveedores.mudanzastml.mx`, etc. son orígenes DISTINTOS, así que Firebase Auth por sí solo NO comparte la sesión entre subdominios.
- Para que la app se sienta como una sola sesión, al iniciar sesión se escribe además una cookie **`tml_user`** con `domain=.mudanzastml.mx` (sí viaja entre subdominios) — por eso el header puede decir "✅ Conectado" en un módulo aunque la sesión REAL de Firebase Auth en ESE subdominio no exista.
- **Síntoma típico de esto:** una función que necesita `firebase.auth().currentUser.getIdToken()` (para llamar una Cloud Function) truena con `Cannot read properties of null (reading 'getIdToken')` aunque el usuario se vea "conectado". Solución: cerrar sesión y volver a iniciar sesión **en ese mismo subdominio**. Ver `shared/sesion.js` para el detalle completo de este diseño (documentado ahí como "Fase 1" de una migración).
- Los candados viejos por código (`KM2026` para escrituras en Anticipos, `RM2026` para Ingresos) **ya NO están activos** — quedaron como funciones no-op (`lockRequest` solo ejecuta el callback directo). Fueron reemplazados por permisos ligados al usuario logueado (ej. `PUEDE_EDITAR_ANT`, custom claims de Firebase Auth). Si ves código o documentación vieja que menciona esos candados como si bloquearan algo, está desactualizada.

## Reglas de negocio y seguridad

- **Nunca elimines ni sobrescribas datos existentes en Firestore sin confirmar antes.** Ya hubo bugs graves (más de uno) donde un `.set()` sin `{merge:true}`, o una función que guarda una copia en memoria desactualizada, borró datos reales ya registrados. Cualquier función que escriba a Firestore debe leer y fusionar el estado existente, no reemplazarlo en bloque — y si es un `.set()` parcial sobre un documento que tiene más campos, SIEMPRE pasar `{merge:true}`.
- **Documentos "blob" compartidos** (`estado/anticiposDB`, `estado/ingresosDB`, `estado/incidentesDB`, `estado/cargosFlotaDB`, `estado/nominaDB` — cada uno es UN documento con un solo campo `data` que trae un JSON gigante) tienen un riesgo particular: si dos escritores (una Cloud Function programada, un listener en vivo de otra pestaña, otra función) leen-modifican-escriben SIN transacción, el que guarda al último pisa lo que el otro acababa de agregar. Antes de escribir uno de estos documentos tras cualquier operación que tarde (llamadas a IA, validaciones contra el SAT, esperar confirmación del usuario), releer fresco justo antes de escribir — o mejor, usar `db.runTransaction(...)`.
- `anticiposDB` (y los otros blobs por-operador de la lista de arriba) deben tratarse siempre como objeto (`{}`), no arreglo. Si llegan como `[]` desde Firebase, normalizarlos con un guard `Array.isArray()` antes de usarlos.
- Un monto real puede ser **$0.00 legítimo** (ej. una maniobra que el cliente autorizó en firme sin costo). No uses `if(!monto)` para decidir si "falta" un valor — un 0 real es distinto de un campo vacío/nulo. Distingue explícitamente `monto==null||monto===''` de "el número da 0".
- Al comparar registros para detectar duplicados (ej. "¿esta autorización ya se registró?"), preferir identificadores estables (folio, pedido, T.U., UUID) sobre campos que pueden variar entre dos menciones del mismo hecho (fecha, redacción exacta) — exigir coincidencia exacta de un campo secundario como la fecha es frágil y genera falsos negativos (no detecta el duplicado real) más que protección real.
- Los 3 buzones automáticos de `functions/index.js` (maniobras, compras, pedidos) leen correo por IMAP y procesan con IA — nunca marques un correo como leído (`\Seen`) antes de que su resultado ya haya quedado guardado en Firestore. Si la función se queda sin tiempo a la mitad, un correo marcado-pero-no-guardado se pierde para siempre (IMAP nunca lo vuelve a devolver como no leído).

## Bugs recurrentes a los que hay que poner atención

- **Timing de Firebase:** el patrón correcto es `window.onFBReady()` — si Firebase ya está listo, ejecuta de inmediato; si no, encola la función hasta que lo esté. No asumas que `fbReady` ya es `true` al cargar el script, y no marques `fbReady=true` ANTES de que termine de cargar el dato real que depende de Firebase (esto causó un bug real: una carga de datos podía guardar sobre una base todavía vacía).
- **Elementos DOM nulos:** varios crashes pasados fueron por hacer `addEventListener` sobre elementos que no existen en ese módulo (ej. zonas de drag-and-drop). Verificar que el elemento exista antes de engancharle eventos, o el resto del script no correrá.
- **IDs de panel:** confirma los IDs reales en el HTML antes de referenciarlos en JS (hubo bugs por referenciar `panel6Content` cuando el ID real era `panel4Content`).
- **Caché del navegador:** el despliegue tarda 1-2 minutos y además el navegador cachea agresivo. Si un cambio no se refleja, no asumas que el deploy falló — probable que sea caché (recomendar Ctrl+Shift+R al usuario) o que falte esperar el minuto del deploy.

## Estilo de comunicación

El dueño del proyecto (E) no es programador de formación — prefiere explicaciones directas y en español, sin jerga innecesaria. Al terminar una tarea, resume en 2-3 líneas qué se cambió y qué debe verificar él mismo (por ejemplo, "prueba subir un anticipo y confirma que el saldo anterior sigue ahí").
