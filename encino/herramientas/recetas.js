// Lee y valida los archivos de recetas (Markdown con frontmatter YAML).
// Las reglas viven aquí y las usan el build, `npm run validar-recetas` y
// `npm run calendario`, para que los tres digan exactamente lo mismo.
'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const TEMPORADAS = {
  'muertos': { slug: 'muertos', nombre: 'Día de Muertos' },
  'navidad': { slug: 'navidad', nombre: 'Navidad y Año Nuevo' },
  'candelaria': { slug: 'candelaria', nombre: 'Candelaria' },
  'cuaresma': { slug: 'cuaresma', nombre: 'Cuaresma' },
  'lluvias': { slug: 'lluvias', nombre: 'Temporada de lluvias' },
  'patrias': { slug: 'patrias', nombre: 'Fiestas patrias' },
  // En la URL va sin ñ (/recetas/temporada/todo-el-ano/) para que el enlace
  // no se rompa al copiarlo; en el archivo se escribe "todo-el-año".
  'todo-el-año': { slug: 'todo-el-ano', nombre: 'Todo el año' }
};
const DIFICULTADES = ['fácil', 'media', 'difícil'];
const CATEGORIAS = ['entrada', 'sopa', 'plato fuerte', 'postre', 'bebida', 'salsa'];
const UNIDADES = ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'taza', 'pza', 'diente', 'manojo', 'pizca'];
// Platillos estrella de la casa: su receta no se publica (ver especificación).
const NO_PUBLICAR = /barbacoa|pancita|mixiote/i;
const ZONA = 'America/Mexico_City';

// "Hoy" en hora de Oaxaca / Ciudad de México, como AAAA-MM-DD.
function hoyMexico(fecha) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha || new Date());
}

function fechaValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, d] = s.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

function separaFrontmatter(texto) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(texto);
  if (!m) return null;
  return { datos: m[1], cuerpo: m[2] };
}

// Carga todas las recetas de la carpeta. Devuelve { recetas, errores, avisos }.
// Cada error es { archivo, msg }. Los archivos que empiezan con "_" (la
// plantilla) se ignoran.
function cargar(carpeta) {
  const errores = [], avisos = [], recetas = [];
  const err = (archivo, msg) => errores.push({ archivo, msg });
  const aviso = (archivo, msg) => avisos.push({ archivo, msg });
  if (!fs.existsSync(carpeta)) return { recetas, errores, avisos };
  const archivos = fs.readdirSync(carpeta).filter(f => f.endsWith('.md') && !f.startsWith('_')).sort();
  const slugs = {};

  for (const archivo of archivos) {
    const ruta = path.join(carpeta, archivo);
    const partes = separaFrontmatter(fs.readFileSync(ruta, 'utf8'));
    if (!partes) { err(archivo, 'no empieza con el bloque de datos entre líneas "---".'); continue; }
    let r;
    try { r = yaml.load(partes.datos, { schema: yaml.JSON_SCHEMA }); }
    catch (e) { err(archivo, 'el bloque de datos (YAML) tiene un error de formato: ' + e.message.split('\n')[0]); continue; }
    if (!r || typeof r !== 'object') { err(archivo, 'el bloque de datos está vacío.'); continue; }
    const n0 = errores.length;
    const e = msg => err(archivo, msg);

    for (const campo of ['titulo', 'slug', 'fecha_publicacion', 'temporada', 'descripcion_seo', 'foto', 'foto_alt']) {
      if (typeof r[campo] !== 'string' || !r[campo].trim()) e(`falta el campo "${campo}" (texto).`);
    }
    if (typeof r.slug === 'string') {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.slug)) e(`el slug "${r.slug}" solo puede llevar minúsculas sin acentos, números y guiones.`);
      if (archivo !== r.slug + '.md') e(`el archivo debe llamarse "${r.slug}.md" (igual que el slug).`);
      if (slugs[r.slug]) e(`el slug "${r.slug}" ya lo usa ${slugs[r.slug]}.`);
      slugs[r.slug] = slugs[r.slug] || archivo;
    }
    if (r.fecha_publicacion != null && !fechaValida(r.fecha_publicacion)) e(`la fecha_publicacion "${r.fecha_publicacion}" no es una fecha válida (formato AAAA-MM-DD, entre comillas).`);
    if (r.fecha_actualizacion != null && !fechaValida(r.fecha_actualizacion)) e(`la fecha_actualizacion "${r.fecha_actualizacion}" no es una fecha válida (AAAA-MM-DD).`);
    if (typeof r.temporada === 'string' && !TEMPORADAS[r.temporada]) e(`temporada "${r.temporada}" no existe. Usa una de: ${Object.keys(TEMPORADAS).join(', ')}.`);
    if (!DIFICULTADES.includes(r.dificultad)) e(`dificultad debe ser una de: ${DIFICULTADES.join(', ')}.`);
    if (!CATEGORIAS.includes(r.categoria)) e(`categoria debe ser una de: ${CATEGORIAS.join(', ')}.`);
    if (!Number.isInteger(r.porciones_base) || r.porciones_base < 1) e('porciones_base debe ser un número entero mayor que 0.');
    for (const campo of ['tiempo_preparacion_min', 'tiempo_coccion_min']) {
      if (typeof r[campo] !== 'number' || r[campo] < 0) e(`${campo} debe ser un número de minutos (0 o más).`);
    }
    if (typeof r.en_carta !== 'boolean') e('en_carta debe ser true o false.');
    else if (r.en_carta && !(typeof r.disponibilidad_carta === 'string' && r.disponibilidad_carta.trim())) e('con en_carta: true hay que llenar disponibilidad_carta.');
    else if (!r.en_carta && !(typeof r.cta_alterno === 'string' && r.cta_alterno.trim())) e('con en_carta: false hay que llenar cta_alterno.');
    if (r.palabras_clave != null && !(Array.isArray(r.palabras_clave) && r.palabras_clave.every(x => typeof x === 'string'))) e('palabras_clave debe ser una lista de textos, ej. ["mole", "receta"].');
    if (r.borrador != null && typeof r.borrador !== 'boolean') e('borrador debe ser true o false.');
    if (NO_PUBLICAR.test((r.titulo || '') + ' ' + (r.slug || ''))) e('las recetas de barbacoa, pancita y mixiote (platillos estrella de la casa) no se publican.');

    // Ingredientes
    const ids = {};
    if (!Array.isArray(r.ingredientes) || !r.ingredientes.length) e('faltan los ingredientes.');
    else r.ingredientes.forEach((g, gi) => {
      if (!g || !Array.isArray(g.items) || !g.items.length) { e(`el grupo de ingredientes ${gi + 1} no tiene "items".`); return; }
      g.items.forEach((it, ii) => {
        const donde = `ingrediente ${ii + 1} del grupo ${gi + 1}`;
        if (!it || typeof it !== 'object') { e(`${donde} está mal escrito.`); return; }
        if (typeof it.id !== 'string' || !it.id) e(`${donde} no tiene id.`);
        else if (ids[it.id]) e(`el id de ingrediente "${it.id}" está repetido.`);
        else ids[it.id] = true;
        if (typeof it.nombre !== 'string' || !it.nombre.trim()) e(`${donde} (${it.id || 'sin id'}) no tiene nombre.`);
        if (it.cantidad != null && !(typeof it.cantidad === 'number' && it.cantidad > 0)) e(`${donde} (${it.id}): la cantidad debe ser un número mayor que 0, o null.`);
        if (it.unidad != null && !UNIDADES.includes(it.unidad)) e(`${donde} (${it.id}): unidad "${it.unidad}" no permitida. Usa: ${UNIDADES.join(', ')} o null.`);
        if (it.cantidad == null && it.unidad != null) e(`${donde} (${it.id}): tiene unidad pero no cantidad.`);
      });
    });

    // Pasos
    if (!Array.isArray(r.pasos) || !r.pasos.length) e('faltan los pasos.');
    else r.pasos.forEach((p, i) => {
      if (!p || typeof p.texto !== 'string' || !p.texto.trim()) { e(`el paso ${i + 1} no tiene texto.`); return; }
      if (p.titulo != null && typeof p.titulo !== 'string') e(`el título del paso ${i + 1} debe ser texto.`);
      if (p.cronometro_seg != null && !(Number.isInteger(p.cronometro_seg) && p.cronometro_seg > 0)) e(`el paso ${i + 1}: cronometro_seg debe ser un número entero de segundos, o null.`);
      for (const m of p.texto.matchAll(/\{([^{}\s]+)\}/g)) {
        if (!ids[m[1]]) e(`el paso ${i + 1} menciona {${m[1]}} pero no hay ningún ingrediente con ese id.`);
      }
    });

    // Foto
    if (typeof r.foto === 'string' && r.foto.trim()) {
      const foto = path.resolve(carpeta, r.foto);
      if (!fs.existsSync(foto)) e(`no se encontró la foto "${r.foto}" (debe estar en ${path.relative(process.cwd(), path.dirname(foto)) || '.'}).`);
      else if (!/\.(jpe?g|png|webp)$/i.test(foto)) e('la foto debe ser .jpg, .png o .webp.');
    }
    if (typeof r.descripcion_seo === 'string' && r.descripcion_seo.length > 160) aviso(archivo, `descripcion_seo tiene ${r.descripcion_seo.length} caracteres; Google suele cortar después de ~155.`);
    if (!partes.cuerpo.trim()) aviso(archivo, 'no tiene historia (el texto después del bloque de datos).');

    if (errores.length === n0) recetas.push(Object.assign({}, r, { archivo, historia: partes.cuerpo.trim(), fotoRuta: path.resolve(carpeta, r.foto) }));
  }
  return { recetas, errores, avisos };
}

// ¿Se publica hoy? Solo si su fecha ya llegó (hora de México) y no es borrador.
function publicada(r, hoy) { return !r.borrador && r.fecha_publicacion <= hoy; }

function imprimeProblemas({ errores, avisos }) {
  for (const a of avisos) console.warn(`⚠️  ${a.archivo}: ${a.msg}`);
  for (const x of errores) console.error(`❌ ${x.archivo}: ${x.msg}`);
}

module.exports = { cargar, publicada, hoyMexico, fechaValida, imprimeProblemas, TEMPORADAS, DIFICULTADES, CATEGORIAS, UNIDADES, ZONA };
