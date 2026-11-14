# Restaurante Encino — sistema de administración

Carpeta independiente: **no forma parte del despliegue de TML** (`build.sh` y
`firebase.json` de la raíz no la tocan). Las páginas son HTML + JavaScript puro;
un build pequeño en Node (`herramientas/build.js`, corre en GitHub Actions)
arma la carpeta `publico/`, que es lo que se sube a Firebase Hosting: agrega las
recetas en HTML estático, pre-renderiza la carta para Google/WhatsApp y genera
`sitemap.xml`, `robots.txt` y `sitio.js`. Se reconstruye en cada push y todos los
días a las 6:00 (hora de Oaxaca). Cómo publicar recetas: ver `RECETAS.md` en la raíz.

| Archivo | Para quién | Qué hace |
|---|---|---|
| `index.html` | Público | Página de inicio (provisional) |
| `admin.html` | Personal | Mesas y órdenes, cobro y ticket, menú, inventario, compras, pedidos en línea, históricos y recomendaciones, configuración |
| `carta.html` | Clientes (QR) | Menú de solo lectura con pestañas: Viernes desayunos / comidas, Sábado y Domingo desayunos / comidas (abre en el que toca por día y hora) |
| `pedidos.html` | Clientes | Ordenar en línea (recoger o domicilio) y ver el estado del pedido |
| `/recetas/` | Público | Recetario (generado desde `recetas/*.md`) con porciones, cronómetros y modo cocina |
| `store.js` / `comun.js` / `config.js` | — | Datos, utilidades y configuración de Firebase |
| `sitio.config.json` | — | Datos del restaurante (dirección, horario, teléfono, Google Maps) para todas las páginas |

## Cómo funciona

- **Menú:** alta manual o importando CSV (`nombre,categoria,tipo,precio,descripcion,menus,variantes`; en `menus` separa con `|`, p. ej. `vie-des|fds-des`; en `variantes` así: `Solos=95|Con pollo=120|Con tasajo=145`). Un platillo puede tener **variantes** con precio distinto (y su propio insumo extra que descuenta del inventario); al capturar la orden o pedir en línea se elige cuál. Un platillo sin menús asignados sale en todos (útil para bebidas).
- **Paquetes:** un platillo marcado como "paquete / complemento" (ej. "Agranda tu paquete +$50: café, pan y jugo o fruta") no se vende solo: aparece como botón "🥐 ＋Paquete" en cada alimento de los mismos menús, en la carta y en pedidos en línea.
- **Órdenes por mesa:** toca la mesa → agrega alimentos y bebidas → "Enviar comanda" (imprime para cocina y barra por separado) → "Cobrar" (descuento, propina, forma de pago, cambio) → imprime el ticket (80 o 58 mm).
- **Inventario:** cada platillo/bebida puede tener una "receta" de insumos. Al cobrar se descuenta del inventario; al cancelar un ticket se regresa. Las compras suman existencias y recalculan costo promedio. "Conteo" registra ajustes físicos (mermas).
- **Históricos:** ventas por día y forma de pago, productos más vendidos, salida de bebidas (ventas vs compras vs ajustes), preparaciones (preparado vs vendido), tickets (reimprimir / cancelar) y **recomendaciones**: qué preparar según el promedio de ese día de la semana (últimas 8 semanas + 10%) y qué comprar para cubrir 7 días.

## Modo local (por defecto)

Abre `admin.html` en el navegador de la caja. Todo se guarda en ese navegador.
Limitaciones: otros dispositivos no ven los datos y los pedidos en línea solo
llegan si se hacen desde el mismo navegador. **Descarga respaldos** seguido
(Configuración → Descargar respaldo).

Para el QR sin Firebase: Configuración → **Descargar carta estática**, sube ese
archivo a cualquier hosting y genera el QR apuntando a él. Vuelve a descargarlo
cada vez que cambien platillos o precios.

## Pasar a modo Firebase (multi-dispositivo + pedidos en línea reales)

1. Crea un proyecto de Firebase **nuevo para el restaurante** (no uses `tml-liquidaciones`).
2. Activa Firestore y Authentication (correo/contraseña); crea un usuario por cada persona del personal.
3. Pega las reglas de `firestore.rules.txt` en Firestore → Reglas.
4. Copia la configuración web del proyecto en `config.js` (`window.ENCINO_FIREBASE_CONFIG = {...}`).
5. Publica el sitio en Firebase Hosting (lo hace `.github/workflows/deploy-encino.yml`, que corre `npm run build` y sube `encino/publico/`) (o cualquier hosting estático) y pon esa dirección en Configuración → "Dirección web pública" para que los QR apunten bien.

Nota: los datos capturados en modo local no se pasan solos a Firebase — usa
Descargar respaldo (antes) y Restaurar respaldo (después, ya con sesión).
