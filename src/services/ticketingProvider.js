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
// Si el técnico subió foto de respaldo (fotosTrabajo), va adjunta de
// verdad al ticket — sin eso, quien aprueba no puede ver el problema.
async function crearTicketAjusteTarifa({ solicitud, tecnico, aumentoPct }) {
  if (!habilitado) return null;

  const original = Math.round((solicitud.moBase || 0) + (solicitud.matEstimado || 0));
  const propuesto = Math.round(solicitud.moModificada || 0);
  const fmt = (n) => '$' + n.toLocaleString('es-CL');

  const auth = Buffer.from(`${FRESHDESK_API_KEY}:X`).toString('base64');
  const subject = `Ajuste de tarifa +${aumentoPct.toFixed(1)}% — ${solicitud.trabajo} (${solicitud.codigo})`;
  const description = [
    `<b>Técnico:</b> ${tecnico.nombre}`,
    `<b>Trabajo:</b> ${solicitud.trabajo} (${solicitud.codigo})`,
    `<b>Tarifa original (M.O.+materiales):</b> ${fmt(original)}`,
    `<b>Nueva tarifa propuesta:</b> ${fmt(propuesto)}`,
    `<b>Aumento:</b> +${aumentoPct.toFixed(1)}%`,
    `<b>Motivo del técnico:</b> ${solicitud.motivoModTarifa || '—'}`,
    `<b>Solicitud ID (usar para aprobar/rechazar):</b> ${solicitud.id}`,
  ].join('<br>');
  const email = process.env.FRESHDESK_REQUESTER_EMAIL || 'sistema@fixya.cl';

  // La foto de respaldo llega como data URL base64 en fotosTrabajo
  // (la última subida corresponde a esta solicitud de ajuste).
  const fotoDataUrl = Array.isArray(solicitud.fotosTrabajo) && solicitud.fotosTrabajo.length
    ? solicitud.fotosTrabajo[solicitud.fotosTrabajo.length - 1]
    : null;

  try {
    let res;

    if (fotoDataUrl && fotoDataUrl.startsWith('data:')) {
      const [meta, base64Data] = fotoDataUrl.split(',');
      const mime = (meta.match(/data:(.*);base64/) || [, 'image/jpeg'])[1];
      const ext = mime.split('/')[1] || 'jpg';

      const form = new FormData();
      form.append('subject', subject);
      form.append('description', description);
      form.append('email', email);
      form.append('priority', '2');
      form.append('status', '2');
      form.append('tags[]', 'ajuste-tarifa');
      form.append('tags[]', 'fixya-automatico');
      form.append('attachments[]', new Blob([Buffer.from(base64Data, 'base64')], { type: mime }), `dificultad.${ext}`);

      res = await fetch(`https://${FRESHDESK_DOMAIN}.freshdesk.com/api/v2/tickets`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}` }, // sin Content-Type — fetch pone el boundary del multipart solo
        body: form,
      });
    } else {
      res = await fetch(`https://${FRESHDESK_DOMAIN}.freshdesk.com/api/v2/tickets`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject, description, email,
          priority: 2, status: 2,
          tags: ['ajuste-tarifa', 'fixya-automatico'],
        }),
      });
    }

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
