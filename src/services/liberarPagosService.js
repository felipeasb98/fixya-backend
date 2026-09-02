const prisma = require('../lib/prisma');
const { notificarTecnico } = require('./notificacionService');

// M.O. se libera al técnico 48 hrs después de que el cliente confirma el trabajo
const PLAZO_LIBERACION_HORAS = 48;

// ─────────────────────────────────────────────
// Libera automáticamente los pagos en escrow cuyo
// plazo de confirmación ya venció. Se llama por
// intervalo desde index.js — no requiere cron externo
// porque el backend es un proceso Node persistente.
// ─────────────────────────────────────────────
async function liberarPagosVencidos(io) {
  try {
    const limite = new Date(Date.now() - PLAZO_LIBERACION_HORAS * 60 * 60 * 1000);

    const pagos = await prisma.pago.findMany({
      where: {
        estado: 'EN_ESCROW',
        solicitud: {
          clienteConfirmoAt: { lte: limite },
          estado: { not: 'DISPUTADO' },
        },
      },
      include: { solicitud: true },
    });

    for (const pago of pagos) {
      await prisma.pago.update({
        where: { id: pago.id },
        data: { estado: 'LIBERADO', liberadoAt: new Date() },
      });

      // trabajosCompletados solo cuenta una vez por solicitud —
      // no incrementar de nuevo si además hay un pago 'adicional'
      if (pago.tipo === 'inicial') {
        await prisma.tecnico.update({
          where: { id: pago.tecnicoId },
          data: { trabajosCompletados: { increment: 1 } },
        });
      }

      await notificarTecnico(io, pago.tecnicoId, {
        tipo: 'pago_liberado',
        titulo: '💰 ¡Pago liberado!',
        cuerpo: `Se transfirieron $${Math.round(pago.montoTecnico).toLocaleString('es-CL')} a tu cuenta. ¡Buen trabajo!`,
        solicitudId: pago.solicitudId,
      });
    }

    if (pagos.length > 0) {
      console.log(`[liberarPagosVencidos] ${pagos.length} pago(s) liberado(s) automáticamente`);
    }
  } catch (err) {
    console.error('[liberarPagosVencidos] Error:', err.message);
  }
}

module.exports = { liberarPagosVencidos, PLAZO_LIBERACION_HORAS };
