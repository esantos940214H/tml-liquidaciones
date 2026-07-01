# CLAUDE.md — tml-liquidaciones

Contexto para Claude Code al trabajar en este repositorio. Léelo antes de modificar cualquier archivo.

## Qué es este proyecto

Sistema web de liquidación de operadores de transporte para **Mudanzas TML, S.A. de C.V.**
No usa framework ni build step: son archivos HTML puros con JavaScript embebido, desplegados directo en **GitHub Pages**.

- Repo: `esantos940214H/tml-liquidaciones`
- Sitio en vivo: `https://esantos940214h.github.io/tml-liquidaciones/`
- Persistencia: **Firebase Firestore** (no hay backend propio)
- Sin build tools: no hay `npm install`, `webpack`, ni bundlers. Editar el HTML/JS directamente.

## Arquitectura

La app se dividió en módulos separados (archivos HTML independientes) después de que un enfoque de un solo archivo causó conflictos de DOM (IDs duplicados entre módulos). Cada módulo es su propio documento HTML completo, cargado vía iframe desde el router.

| Archivo | Función |
|---|---|
| `tml_v3.html` | Router principal — decide qué módulo mostrar |
| `ant.html` | Anticipos — carga CSV/TXT de BBVA, captura manual |
| `ing.html` | Ingresos — carga XML/PDF, captura manual |
| `liq.html` | Liquidaciones — cálculo y generación de reportes |
| `hist.html` | Historial |

**Importante:** cada archivo es un documento HTML autocontenido (su propio `<script>`, su propio DOM). No asumas que los módulos comparten estado en memoria — todo el estado compartido pasa por Firebase.

## Reglas de negocio y seguridad

- No hay login de sesión persistente. En su lugar, hay **candados por acción**:
  - `KM2026` gatea las escrituras en `ant.html` (subir CSV/TXT, captura manual)
  - `RM2026` gatea las escrituras en `ing.html` (subir XML/PDF, captura manual)
  - Estos candados son modales sin persistencia de sesión — cada acción de escritura pide el código de nuevo, no solo al entrar al módulo.
- **Nunca elimines ni sobrescribas datos existentes en Firestore sin confirmar antes.** Ya hubo bugs graves donde `guardarEstado()` sobrescribía `anticiposDB` e `ingresosDB` completos con valores vacíos al guardar una liquidación. Cualquier función que escriba a Firestore debe leer y fusionar el estado existente, no reemplazarlo en bloque.
- `anticiposDB` debe tratarse siempre como objeto (`{}`), no arreglo. Si llega como `[]` desde Firebase, normalizarlo con un guard `Array.isArray()` antes de usarlo.

## Bugs recurrentes a los que hay que poner atención

- **Timing de Firebase:** el patrón correcto es `window.onFBReady()` — si Firebase ya está listo, ejecuta de inmediato; si no, encola la función hasta que lo esté. No asumas que `fbReady` ya es `true` al cargar el script.
- **Elementos DOM nulos:** varios crashes pasados fueron por hacer `addEventListener` sobre elementos que no existen en ese módulo (ej. zonas de drag-and-drop). Verificar que el elemento exista antes de engancharle eventos, o el resto del script no correrá.
- **IDs de panel:** confirma los IDs reales en el HTML antes de referenciarlos en JS (hubo bugs por referenciar `panel6Content` cuando el ID real era `panel4Content`).
- **Caché del navegador:** GitHub Pages cachea agresivo. Si un cambio no se refleja, no asumas que el deploy falló — probable que sea caché (recomendar Ctrl+Shift+R al usuario).

## Cómo desplegar cambios

No hay CI/CD. Los cambios se suben directo al repo (commit a la rama principal) y GitHub Pages los sirve automáticamente en 1–2 minutos. No hay ambiente de staging — todo cambio en `main` es producción.

## Estilo de comunicación

El dueño del proyecto (E) no es programador de formación — prefiere explicaciones directas y en español, sin jerga innecesaria. Al terminar una tarea, resume en 2-3 líneas qué se cambió y qué debe verificar él mismo (por ejemplo, "prueba subir un anticipo y confirma que el saldo anterior sigue ahí").
