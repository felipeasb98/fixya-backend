/**
 * Valida un RUT chileno
 * Acepta formatos: 12345678-9 | 12.345.678-9 | 123456789
 */
function validarRut(rut) {
  if (!rut || typeof rut !== 'string') return false;

  // Limpiar puntos y guión
  const clean = rut.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
  if (clean.length < 2) return false;

  const body = clean.slice(0, -1);
  const dv   = clean.slice(-1);

  if (!/^\d+$/.test(body)) return false;

  // Calcular dígito verificador
  let sum = 0;
  let mult = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const remainder = sum % 11;
  const dvCalc = remainder === 0 ? '0' : remainder === 1 ? 'K' : String(11 - remainder);

  return dv === dvCalc;
}

/**
 * Formatea RUT: 12345678-9 -> 12.345.678-9
 */
function formatearRut(rut) {
  const clean = rut.replace(/\./g, '').replace(/-/g, '').trim();
  const body  = clean.slice(0, -1);
  const dv    = clean.slice(-1);
  return body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
}

module.exports = { validarRut, formatearRut };
