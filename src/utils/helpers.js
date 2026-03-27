// ── Generar código único tipo "FY-1711234567-429" ─────────────
// Usa timestamp + random para garantizar unicidad entre deploys
function generarCodigo() {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  return `FY-${ts}-${rnd}`;
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
