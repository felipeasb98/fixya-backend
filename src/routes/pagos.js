const express = require('express');
const router  = express.Router();
const { body } = require('express-validator');
const { validationResult } = require('express-validator');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middlewares/authenticate');
const { soloRol } = require('../middlewares/soloRol');
const { AppError } = require('../utils/AppError');
const { calcularComision } = require('../utils/helpers');
const { notificarTecnico } = require('../services/notificacionService');
const { crearPago, confirmarPago } = require('../services/flowService');

// ─────────────────────────────────────────────────────────────
// POST /api/pagos/iniciar
// Cliente inicia el pago vía Flow
// ─────────────────────────────────────────────────────────────
router.post('/iniciar', authenticate, soloRol('usuario'), [
  body('solicitudId').notEmpty(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { solicitudId } = req.body;

    const solicitud = await prisma.solicitud.findUnique({
      where: { id: solicitudId },
      include: { tecnico: true, usuario: true },
    });
    if (!solicitud) throw new AppError('Solicitud no encontrada', 404);
    if (solicitud.usuarioId !== req.user.id) throw new AppError('Sin acceso', 403);
    if (!['CONFIRMADO', 'EN_CAMINO', 'EN_TRABAJO'].includes(solicitud.estado)) {
      throw new AppError('La solicitud no está lista para pagar', 409);
    }

    // Verificar si ya hay un pago iniciado
    const pagoExistente = await prisma.pago.findUnique({ where: { solicitudId } });
    if (pagoExistente && pagoExistente.estado === 'EN_ESCROW') {
      throw new AppError('Esta solicitud ya fue pagada', 409);
    }

    const monto       = solicitud.totalFinal || solicitud.totalEstimado;
    const comisionPct = solicitud.tecnico?.comisionPct || 18;
    const comisionMonto = calcularComision(monto, comisionPct);
    const montoTecnico  = monto - comisionMonto;

    // Crear o actualizar registro de pago
    const pago = pagoExistente
      ? await prisma.pago.update({
          where: { solicitudId },
          data: { monto, comisionPct, comisionMonto, montoTecnico, metodo: 'flow', estado: 'PENDIENTE' },
        })
      : await prisma.pago.create({
          data: {
            solicitudId,
            tecnicoId:    solicitud.tecnicoId,
            monto,
            comisionPct,
            comisionMonto,
            montoTecnico,
            metodo: 'flow',
            estado: 'PENDIENTE',
          },
        });

    // Crear pago en Flow
    const baseUrl = process.env.BACKEND_URL || 'https://fixya-backend-production.up.railway.app';
    const { token, urlPago } = await crearPago({
      commerceOrder:   pago.id,
      amount:          monto,
      subject:         `FixYa · ${solicitud.trabajo} · ${solicitud.codigo}`,
      email:           solicitud.usuario.email,
      urlConfirmacion: `${baseUrl}/api/pagos/webhook/flow`,
      urlRetorno:      `${process.env.FRONTEND_URL || 'https://fixya.netlify.app'}/app.html?pago=ok`,
    });

    // Guardar token de Flow
    await prisma.pago.update({
      where: { id: pago.id },
      data:  { proveedorId: token },
    });

    res.json({
      message: 'Pago iniciado',
      pagoId: pago.id,
      urlPago,
      monto,
      desglose: {
        manoDeObra:  solicitud.moBase,
        materiales:  solicitud.matEstimado || 0,
        comision:    comisionMonto,
        total:       monto,
        alTecnico:   montoTecnico,
      },
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────
// POST /api/pagos/webhook/flow
// Flow llama aquí cuando el pago se confirma
// ─────────────────────────────────────────────────────────────
router.post('/webhook/flow', async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token requerido' });

    // Consultar estado real del pago en Flow
    const resultado = await confirmarPago(token);

    const pago = await prisma.pago.findFirst({
      where: { proveedorId: token },
      include: { solicitud: true },
    });

    if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });

    if (resultado.ok) {
      // Pago confirmado → pasar a EN_ESCROW
      await prisma.pago.update({
        where: { id: pago.id },
        data: {
          estado:       'EN_ESCROW',
          escrowAt:     new Date(),
          proveedorData: resultado,
        },
      });

      // Notificar al técnico que el pago fue recibido
      if (pago.solicitud.tecnicoId) {
        await notificarTecnico(req.io, pago.solicitud.tecnicoId, {
          tipo:        'pago_recibido',
          titulo:      '💰 Pago recibido',
          cuerpo:      `El cliente pagó $${Math.round(pago.monto).toLocaleString('es-CL')}. El dinero se liberará al confirmar el trabajo.`,
          solicitudId: pago.solicitudId,
        });
      }
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────
// GET /api/pagos/retorno
// URL de retorno después del pago (Flow redirige aquí)
// ─────────────────────────────────────────────────────────────
router.get('/retorno', async (req, res) => {
  const { token } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'https://fixya.netlify.app';

  if (!token) return res.redirect(`${frontendUrl}/app.html?pago=error`);

  try {
    const resultado = await confirmarPago(token);
    if (resultado.ok) {
      res.redirect(`${frontendUrl}/app.html?pago=ok`);
    } else {
      res.redirect(`${frontendUrl}/app.html?pago=fallido`);
    }
  } catch {
    res.redirect(`${frontendUrl}/app.html?pago=error`);
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/pagos/:id/liberar
// Cliente confirma trabajo → se libera el pago al técnico
// ─────────────────────────────────────────────────────────────
router.post('/:id/liberar', authenticate, soloRol('usuario'), async (req, res, next) => {
  try {
    const pago = await prisma.pago.findUnique({
      where: { id: req.params.id },
      include: { solicitud: true },
    });
    if (!pago) throw new AppError('Pago no encontrado', 404);
    if (pago.solicitud.usuarioId !== req.user.id) throw new AppError('Sin acceso', 403);
    if (pago.estado !== 'EN_ESCROW') throw new AppError('El pago no está en escrow', 409);

    await prisma.pago.update({
      where: { id: pago.id },
      data: { estado: 'LIBERADO', liberadoAt: new Date() },
    });

    await prisma.tecnico.update({
      where: { id: pago.tecnicoId },
      data:  { trabajosCompletados: { increment: 1 } },
    });

    await notificarTecnico(req.io, pago.tecnicoId, {
      tipo:        'pago_liberado',
      titulo:      '💰 ¡Pago liberado!',
      cuerpo:      `Se transfirieron $${Math.round(pago.montoTecnico).toLocaleString('es-CL')} a tu cuenta. ¡Buen trabajo!`,
      solicitudId: pago.solicitudId,
    });

    res.json({ message: 'Pago liberado al técnico', montoLiberado: pago.montoTecnico });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────
// GET /api/pagos/historial
// ─────────────────────────────────────────────────────────────
router.get('/historial', authenticate, async (req, res, next) => {
  try {
    const { rol, id } = req.user;
    const where = rol === 'usuario'
      ? { solicitud: { usuarioId: id } }
      : { tecnicoId: id };

    const pagos = await prisma.pago.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        solicitud: { select: { codigo: true, trabajo: true, createdAt: true } },
      },
    });

    const liberados = pagos.filter(p => p.estado === 'LIBERADO');
    const resumen = {
      totalGanado:    liberados.reduce((s, p) => s + (rol === 'tecnico' ? p.montoTecnico : p.monto), 0),
      totalPendiente: pagos.filter(p => p.estado === 'EN_ESCROW').reduce((s, p) => s + p.monto, 0),
    };

    res.json({ pagos, resumen });
  } catch (err) { next(err); }
});

module.exports = router;
