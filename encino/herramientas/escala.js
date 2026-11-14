// Escalado de ingredientes con fracciones amigables (½, ¼, 1½…).
// Lo usan el build (Node, para el HTML estático a porciones base) y la
// página de la receta en el navegador (selector de porciones), así los dos
// muestran exactamente el mismo texto.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.EncinoEscala = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // unidad del archivo → [singular, plural] en español
  var UNIDADES = {
    g: ['g', 'g'], kg: ['kg', 'kg'], ml: ['ml', 'ml'], l: ['l', 'l'],
    tsp: ['cdta', 'cdtas'], tbsp: ['cda', 'cdas'], taza: ['taza', 'tazas'],
    pza: ['pza', 'pzas'], diente: ['diente', 'dientes'], manojo: ['manojo', 'manojos'], pizca: ['pizca', 'pizcas']
  };
  var FRACCIONES = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾'], [1, '']];

  // Redondea a una cantidad que se pueda medir en la cocina.
  function redondea(q, unidad) {
    if (unidad === 'g' || unidad === 'ml') {
      if (q >= 100) return Math.round(q / 5) * 5;
      if (q >= 10) return Math.round(q);
    }
    if (q >= 20) return Math.round(q);
    return q;
  }

  // 1.5 → "1½", 0.25 → "¼", 7 → "7", 0.1 → "⅛"
  function fraccion(q) {
    var ent = Math.floor(q), resto = q - ent, mejor = FRACCIONES[0], dif = Infinity;
    FRACCIONES.forEach(function (f) {
      if (f[0] === 1 / 8 && ent > 0) return; // ⅛ solo para cantidades menores a 1
      var d = Math.abs(resto - f[0]);
      if (d < dif - 1e-9) { dif = d; mejor = f; }
    });
    if (mejor[0] === 1) { ent += 1; mejor = FRACCIONES[0]; }
    if (ent === 0 && !mejor[1]) return '⅛'; // nunca mostrar "0" para algo que sí lleva
    return (ent ? String(ent) : '') + mejor[1];
  }

  function cantidadTxt(cantidad, unidad, factor) {
    if (cantidad == null || cantidad === '') return '';
    var q = redondea(Number(cantidad) * (factor || 1), unidad);
    var txt = Number.isInteger(q) ? String(q) : fraccion(q);
    var u = UNIDADES[unidad];
    if (!u) return txt;
    var plural = q > 1 + 1e-9;
    return txt + ' ' + u[plural ? 1 : 0];
  }

  // Texto completo para insertar en un paso: "1½ kg de pollo en piezas"
  function ingredienteTxt(ing, factor) {
    var c = cantidadTxt(ing.cantidad, ing.unidad, factor);
    if (!c) return ing.nombre;
    return c + (ing.unidad ? ' de ' : ' ') + ing.nombre;
  }

  return { UNIDADES: UNIDADES, cantidadTxt: cantidadTxt, ingredienteTxt: ingredienteTxt, fraccion: fraccion };
});
