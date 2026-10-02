// ══════════════════════════════════════════════════════════════════════════
// shared/calculoNomina.js
//
// Cálculo automático de ISR/IMSS/RCV/INFONAVIT para timbrar nómina vía
// Facturapi (ver nomina.html → "Calcular automático") — funciones puras,
// sin dependencias de Firebase ni del DOM, para que sean fáciles de probar
// y de ajustar cada año sin tocar el resto del código.
//
// NO calcula "otras deducciones" (préstamos, faltantes, etc. — eso sigue
// siendo manual) ni decide si un operador debe o no timbrarse este periodo.
// Solo da el MEJOR CÁLCULO posible con los datos que ya tiene el sistema —
// el dueño siempre revisa antes de timbrar.
//
// PARÁMETROS FISCALES 2026 (verificar cada enero, cuando el SAT/IMSS
// publican los nuevos valores — ver CLAUDE.md):
//   - ISR: tarifa mensual Art. 96 LISR / Anexo 8 RMF (DOF 28-12-2025).
//   - UMA 2026: $117.31 diario (vigente desde el 1-feb-2026).
//   - Subsidio al empleo 2026: $535.65/mes si el ingreso mensual no rebasa
//     $11,492.66 (para enero 2026 el monto es $536.21 — no se modela aquí
//     porque para cuando se use este archivo ya pasó enero 2026).
//   - IMSS obrero (lo que se le DESCUENTA al trabajador, no lo que paga el
//     patrón): 0.25% (en dinero) + 0.375% (gastos médicos de pensionados) +
//     0.625% (invalidez y vida) del SBC diario × días, TODO el periodo;
//     + 0.40% adicional sobre la parte del SBC que rebasa 3 UMA (solo si
//     el SBC del operador supera ese umbral).
//   - RCV (Cesantía y Vejez) obrero: 1.125% del SBC diario × días.
//   - SBC topado a 25 UMA (tope legal de cotización).
// ══════════════════════════════════════════════════════════════════════════
window.CalculoNomina = (function () {
  'use strict';

  var UMA_2026 = 117.31;
  var SBC_TOPE_UMAS = 25;
  var SUBSIDIO_MENSUAL_2026 = 535.65;
  var SUBSIDIO_TOPE_INGRESO_2026 = 11492.66;

  // Tarifa mensual ISR 2026 (Art. 96 LISR / Anexo 8 RMF, DOF 28-12-2025).
  var TABLA_ISR_MENSUAL_2026 = [
    { li: 0.01, ls: 844.59, cuota: 0.00, pct: 0.0192 },
    { li: 844.60, ls: 7168.51, cuota: 16.22, pct: 0.0640 },
    { li: 7168.52, ls: 12598.02, cuota: 420.95, pct: 0.1088 },
    { li: 12598.03, ls: 14644.64, cuota: 1011.68, pct: 0.1600 },
    { li: 14644.65, ls: 17533.64, cuota: 1339.14, pct: 0.1792 },
    { li: 17533.65, ls: 35362.83, cuota: 1856.84, pct: 0.2136 },
    { li: 35362.84, ls: 55736.68, cuota: 5665.16, pct: 0.2352 },
    { li: 55736.69, ls: 106410.50, cuota: 10457.09, pct: 0.3000 },
    { li: 106410.51, ls: 141880.66, cuota: 25659.23, pct: 0.3200 },
    { li: 141880.67, ls: 425641.99, cuota: 37009.69, pct: 0.3400 },
    { li: 425642.00, ls: Infinity, cuota: 133488.54, pct: 0.3500 }
  ];

  function r2(n) { return Math.round((n || 0) * 100) / 100; }

  // diasEnPeriodo: días NATURALES incluyendo ambos extremos (ej. 01-sep a
  // 30-sep = 30 días) — mismo criterio con el que ya se calculan los demás
  // plazos de días hábiles/naturales en el sistema (ver _sumarDiasHabilesServer).
  function diasEnPeriodo(desdeISO, hastaISO) {
    if (!desdeISO || !hastaISO) return 0;
    var d1 = new Date(desdeISO + 'T00:00:00'), d2 = new Date(hastaISO + 'T00:00:00');
    return Math.round((d2 - d1) / 86400000) + 1;
  }

  // factorPeriodo: un periodo de 28 a 31 días (mensual, el caso normal de
  // TML) usa la tarifa mensual TAL CUAL. Cualquier otro largo de periodo
  // (quincenal, semanal, un periodo corto por alta/baja a mitad de mes) se
  // prorratea entre 30.4 (promedio de días por mes) — mismo criterio
  // estándar que usan las tablas de nómina para periodos no mensuales.
  function factorPeriodo(dias) {
    return (dias >= 28 && dias <= 31) ? 1 : (dias / 30.4);
  }

  function calcularISRMensual(baseGravableMensual) {
    var fila = TABLA_ISR_MENSUAL_2026[0];
    for (var i = 0; i < TABLA_ISR_MENSUAL_2026.length; i++) {
      if (baseGravableMensual >= TABLA_ISR_MENSUAL_2026[i].li) fila = TABLA_ISR_MENSUAL_2026[i];
    }
    return fila.cuota + (baseGravableMensual - fila.li) * fila.pct;
  }

  function calcularSubsidioMensual(baseGravableMensual) {
    return baseGravableMensual <= SUBSIDIO_TOPE_INGRESO_2026 ? SUBSIDIO_MENSUAL_2026 : 0;
  }

  // calcular(params): params = {
  //   salarioDiario: número (SD nominal, para la PERCEPCIÓN),
  //   sdiSbc: número (SDI/SBC integrado, base de IMSS/RCV/INFONAVIT — si no
  //     viene, se usa salarioDiario como respaldo, aunque no sea exacto),
  //   dias: número de días naturales del periodo,
  //   infonavit: {tipo:'cuota_fija'|'porcentaje', valor:número} | null
  // }
  // Regresa {percepcion, isrCausado, subsidio, isr, imss, rcv, infonavit, dias}.
  function calcular(params) {
    params = params || {};
    var dias = parseInt(params.dias || 0) || 0;
    var salarioDiario = parseFloat(params.salarioDiario || 0) || 0;
    var sbcDiario = Math.min(parseFloat(params.sdiSbc || salarioDiario) || 0, UMA_2026 * SBC_TOPE_UMAS);
    var factor = factorPeriodo(dias);

    var percepcion = r2(salarioDiario * dias);

    var baseGravableMensualEquiv = factor ? percepcion / factor : 0;
    var isrMensualEquiv = calcularISRMensual(baseGravableMensualEquiv);
    var subsidioMensualEquiv = calcularSubsidioMensual(baseGravableMensualEquiv);
    var isrCausado = r2(isrMensualEquiv * factor);
    var subsidio = r2(subsidioMensualEquiv * factor);
    var isr = Math.max(0, r2(isrCausado - subsidio));

    var tresUma = UMA_2026 * 3;
    var imssBase = sbcDiario * dias * (0.0025 + 0.00375 + 0.00625);
    var excedenteSbc = Math.max(0, sbcDiario - tresUma);
    var imssExcedente = excedenteSbc * dias * 0.004;
    var imss = r2(imssBase + imssExcedente);

    var rcv = r2(sbcDiario * dias * 0.01125);

    var infonavit = 0;
    var inf = params.infonavit;
    if (inf && inf.tipo === 'cuota_fija') {
      // La cuota fija se captura como el monto MENSUAL del aviso de
      // retención del Infonavit — se prorratea igual que el ISR si el
      // periodo no es mensual.
      infonavit = r2((parseFloat(inf.valor) || 0) * factor);
    } else if (inf && inf.tipo === 'porcentaje') {
      infonavit = r2(sbcDiario * dias * ((parseFloat(inf.valor) || 0) / 100));
    }

    return {
      dias: dias, percepcion: percepcion, isrCausado: isrCausado, subsidio: subsidio,
      isr: isr, imss: imss, rcv: rcv, infonavit: infonavit
    };
  }

  return {
    calcular: calcular, diasEnPeriodo: diasEnPeriodo,
    UMA: UMA_2026, SUBSIDIO_MENSUAL: SUBSIDIO_MENSUAL_2026, SUBSIDIO_TOPE_INGRESO: SUBSIDIO_TOPE_INGRESO_2026
  };
})();
