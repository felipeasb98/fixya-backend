const { v4: uuidv4 } = require('uuid');

// ── Generar código único tipo "FY-3001" ────────────────────────
let _counter = 3000;
function generarCodigo() {
  _counter++;
  return `FY-${_counter}`;
}

// ── Formatear precio chileno ───────────────────────────────────
function formatPrecio(n) {
  return '$' + Math.round(n).toLocaleString('es-CL');
}

// ── Calcular comisión ──────────────────────────────────────────
function calcularComision(monto, pct) {
  return Math.round((monto * pct) / 100);
}

module.exports = { generarCodigo, formatPrecio, calcularComision };
