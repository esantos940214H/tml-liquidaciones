# Cómo publicar una receta en encino.app

Las recetas viven en la carpeta **`encino/recetas/`** y sus fotos en **`encino/recetas/fotos/`**.
No hay que tocar código: solo se agregan archivos.

## Pasos

1. **Redacta la receta** con Claude y pídele el archivo `.md` en el formato del recetario
   (puedes enseñarle `encino/recetas/_plantilla.md` o `encino/recetas/mole-coloradito.md` como ejemplo).
2. **Copia el archivo** a `encino/recetas/`. Debe llamarse igual que su `slug`
   (ejemplo: `slug: "pan-de-muerto"` → `pan-de-muerto.md`).
3. **Copia la foto** a `encino/recetas/fotos/` con el nombre que dice el campo `foto`
   (ejemplo: `fotos/pan-de-muerto.jpg`). De preferencia horizontal y de al menos 1200 px de ancho.
   El sitio la achica y la convierte solo.
4. **Haz commit y push a `main`** (desde GitHub también puedes usar "Add file → Upload files" en esa carpeta).

Listo. Si la fecha (`fecha_publicacion`) ya llegó, la receta aparece en 1-2 minutos.
Si es una fecha futura, **se publica sola ese día a las 6:00 de la mañana** (hora de Oaxaca).
Antes de esa fecha la receta no existe en el sitio: ni su página, ni en la lista, ni en Google.

## Cosas útiles

- **Borrador:** si la receta tiene la línea `borrador: true`, nunca se publica, aunque llegue su fecha.
  Bórrala cuando esté lista. (La receta de ejemplo del mole está así: falta su foto real.)
- **Si algo está mal escrito**, el sitio no se actualiza y GitHub te avisa en la pestaña *Actions*
  (ícono rojo ❌). Abre el detalle: dice en español qué archivo y qué campo corregir.
  Mientras tanto, el sitio sigue como estaba.
- **Datos del restaurante** (teléfono, horario, dirección, enlace de Google Maps): se cambian en un solo
  lugar, `encino/sitio.config.json`, y se actualizan en todas las páginas.
- **Platillos de la casa** (barbacoa, pancita, mixiote): sus recetas no se publican; el sistema las rechaza.

## Comandos (solo si tienes Node.js instalado en tu computadora)

Dentro de la carpeta `encino/`, la primera vez corre `npm install`. Después:

| Comando | Para qué |
|---|---|
| `npm run validar-recetas` | Revisa que todas las recetas estén bien escritas |
| `npm run calendario` | Muestra qué recetas ya están publicadas y cuáles salen y cuándo |
| `npm run preview -- --futuras` | Abre el sitio en http://localhost:8080 con **todas** las recetas, incluidas las futuras y los borradores |
| `npm run preview` | Igual, pero tal como se ve hoy en internet |

## Temporadas

`muertos`, `navidad`, `candelaria`, `cuaresma`, `lluvias`, `patrias`, `todo-el-año`.
Cada una tiene su página: `encino.app/recetas/temporada/muertos/`, etc. (la de todo el año es `todo-el-ano`).
