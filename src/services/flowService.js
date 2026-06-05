const crypto = require('crypto');

const FLOW_API_URL = process.env.FLOW_ENV === 'production'
  ? 'https://www.flow.cl/api'
  : 'https://sandbox.flow.cl/api';

// Leer variables dentro de cada función para evitar que queden undefined
// si el módulo se carga antes de que Railway inyecte las variables
function getKeys() {
  const apiKey    = process.env.FLOW_API_KEY;
  const secretKey = process.env.FLOW_SECRET_KEY;
  if (!apiKey)    throw new Error('FLOW_API_KEY no configurada');
  if (!secretKey) throw new Error('FLOW_SECRET_KEY no configurada');
  return { apiKey, secretKey };
}

// ── Firmar parámetros con HMAC-SHA256 (requerido por Flow) ────
function firmar(params, secretKey) {
  const keys = Object.keys(params).sort();
  const cadena = keys.map(k => `${k}${params[k]}`).join('');
  return crypto.createHmac('sha256', secretKey).update(cadena).digest('hex');
}

// ── Crear pago en Flow ────────────────────────────────────────
async function crearPago({ commerceOrder, amount, subject, email, urlConfirmacion, urlRetorno }) {
  const { apiKey, secretKey } = getKeys();

  const params = {
    apiKey,
    commerceOrder:   String(commerceOrder),
    subject:         subject.substring(0, 255),
    amount:          Math.round(amount),
    email:           email || '',
    urlConfirmation: urlConfirmacion,
    urlReturn:       urlRetorno,
    currency:        'CLP',
    paymentMethod:   9,
  };

  params.s = firmar(params, secretKey);

  const body = new URLSearchParams(params);
  const res = await fetch(`${FLOW_API_URL}/payment/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await res.json();
  if (data.code && data.code !== 0) {
    throw new Error(data.message || 'Error al crear pago en Flow');
  }

  return {
    token:   data.token,
    urlPago: `${data.url}?token=${data.token}`,
  };
}

// ── Confirmar pago (webhook de Flow) ─────────────────────────
async function confirmarPago(token) {
  const { apiKey, secretKey } = getKeys();

  const params = { apiKey, token };
  params.s = firmar(params, secretKey);

  const url = `${FLOW_API_URL}/payment/getStatus?${new URLSearchParams(params)}`;
  const res = await fetch(url);
  const data = await res.json();

  return {
    ok:            data.status === 2,
    status:        data.status,
    commerceOrder: data.commerceOrder,
    amount:        data.amount,
    fecha:         data.paymentData?.date,
    medio:         data.paymentData?.mediaType,
  };
}

// ── Reembolso ─────────────────────────────────────────────────
async function reembolsar({ token, amount, reason }) {
  const { apiKey, secretKey } = getKeys();

  const params = {
    apiKey,
    token,
    amount: Math.round(amount),
    reason: reason || 'Reembolso FixYa',
  };
  params.s = firmar(params, secretKey);

  const body = new URLSearchParams(params);
  const res = await fetch(`${FLOW_API_URL}/refund/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await res.json();
  return { ok: data.code === 0, data };
}

module.exports = { crearPago, confirmarPago, reembolsar };
