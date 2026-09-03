// ─────────────────────────────────────────────────────────────
// Adaptador de mesa de ayuda externa (hoy: Freshdesk).
//
// ESTE es el único archivo de todo el backend que sabe que existe
// Freshdesk. Nada más — ni el controller, ni las rutas — le habla
// directo a su API. Si el día de mañana se cambia de proveedor, o
// se reemplaza por un panel propio, solo se reescribe este archivo:
// las dos funciones de abajo (crear ticket, y el estado
// `habilitado`) son el único contrato que el resto del backend
// conoce.
// ─────────────────────────────────────────────────────────────

const FRESHDESK_DOMAIN  = process.env.FRESHDESK_DOMAIN;
const FRESHDESK_API_KEY = process.env.FRESHDESK_API_KEY;

const habilitado = !!(FRESHDESK_DOMAIN && FRESHDESK_API_KEY);

if (!habilitado) {
  console.warn('[ticketingProvider] FRESHDESK_DOMAIN/FRESHDESK_API_KEY no configurados — los ajustes que requieran revisión quedarán pendientes sin crear ticket (revisar manualmente vía Railway).');
}

// ── Crea el ticket cuando un ajuste de tarifa supera el 30% ──
async function crearTicketAjusteTarifa({ solicitud, tecnico, aumentoPct }) {
  if (!habilitado) return null;

  const original = Math.round((solicitud.moBase || 0) + (solicitud.matEstimado || 0));
  const propuesto = Math.round(solicitud.moModificada || 0);
  const fmt = (n) => '$' + n.toLocaleString('es-CL');

  const auth = Buffer.from(`${FRESHDESK_API_KEY}:X`).toString('base64');
  const body = {
    subject: `Ajuste de tarifa +${aumentoPct.toFixed(1)}% — ${solicitud.trabajo} (${solicitud.codigo})`,
    description: [
      `<b>Técnico:</b> ${tecnico.nombre}`,
      `<b>Trabajo:</b> ${solicitud.trabajo} (${solicitud.codigo})`,
      `<b>Tarifa original (M.O.+materiales):</b> ${fmt(original)}`,
      `<b>Nueva tarifa propuesta:</b> ${fmt(propuesto)}`,
      `<b>Aumento:</b> +${aumentoPct.toFixed(1)}%`,
      `<b>Motivo del técnico:</b> ${solicitud.motivoModTarifa || '—'}`,
      `<b>Solicitud ID (usar para aprobar/rechazar):</b> ${solicitud.id}`,
    ].join('<br>'),
    email: process.env.FRESHDESK_REQUESTER_EMAIL || 'sistema@fixya.cl',
    priority: 2, // alta
    status: 2,   // abierto
    tags: ['ajuste-tarifa', 'fixya-automatico'],
  };

  try {
    const res = await fetch(`https://${FRESHDESK_DOMAIN}.freshdesk.com/api/v2/tickets`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[ticketingProvider] Freshdesk rechazó la creación del ticket:', data);
      return null;
    }
    return String(data.id);
  } catch (err) {
    console.error('[ticketingProvider] Error de red creando ticket en Freshdesk:', err.message);
    return null;
  }
}

module.exports = { crearTicketAjusteTarifa, habilitado };
