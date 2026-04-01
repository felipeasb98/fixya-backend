const crypto = require('crypto');

const FLOW_API_URL = process.env.FLOW_ENV === 'production'
  ? 'https://www.flow.cl/api'
  : 'https://sandbox.flow.cl/api';

const API_KEY    = process.env.FLOW_API_KEY;
const SECRET_KEY = process.env.FLOW_SECRET_KEY;

// ── Firmar parámetros con HMAC-SHA256 (requerido por Flow) ────
function firmar(params) {
  const keys = Object.keys(params).sort();
  const cadena = keys.map(k => `${k}${params[k]}`).join('');
  return crypto.createHmac('sha256', SECRET_KEY).update(cadena).digest('hex');
}

// ── Crear pago en Flow ────────────────────────────────────────
async function crearPago({ commerceOrder, amount, subject, email, urlConfirmacion, urlRetorno }) {
  const params = {
    apiKey:          API_KEY,
    commerceOrder:   String(commerceOrder),
    subject:         subject.substring(0, 255),
    amount:          Math.round(amount),
    email:           email || '',
    urlConfirmation: urlConfirmacion,
    urlReturn:       urlRetorno,
    currency:        'CLP',
    paymentMethod:   9, // 1=webpay, 2=servipag, 3=multicaja, 9=todos
  };

  params.s = firmar(params);

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

  // URL donde el usuario paga
  return {
    token:  data.token,
    urlPago: `${data.url}?token=${data.token}`,
  };
}

// ── Confirmar pago (webhook de Flow) ─────────────────────────
async function confirmarPago(token) {
  const params = { apiKey: API_KEY, token };
  params.s = firmar(params);

  const url = `${FLOW_API_URL}/payment/getStatus?${new URLSearchParams(params)}`;
  const res = await fetch(url);
  const data = await res.json();

  // status 2 = pagado, 3 = rechazado, 4 = anulado
  return {
    ok:             data.status === 2,
    status:         data.status,
    commerceOrder:  data.commerceOrder,
    amount:         data.amount,
    fecha:          data.paymentData?.date,
    medio:          data.paymentData?.mediaType,
  };
}

// ── Reembolso (si necesitas devolver dinero) ──────────────────
async function reembolsar({ token, amount, reason }) {
  const params = {
    apiKey:  API_KEY,
    token,
    amount:  Math.round(amount),
    reason:  reason || 'Reembolso FixYa',
  };
  params.s = firmar(params);

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
