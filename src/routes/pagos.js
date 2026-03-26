const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middlewares/authenticate');
const { soloRol } = require('../middlewares/soloRol');
const { AppError } = require('../utils/AppError');
const { calcularComision } = require('../utils/helpers');
const { notificarTecnico } = require('../services/notificacionService');

const prisma = new PrismaClient();

// POST /api/pagos/iniciar — Cliente inicia el pago
router.post('/iniciar', authenticate, soloRol('usuario'), [
  body('solicitudId').notEmpty(),
  body('metodo').isIn(['khipu', 'webpay']),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { solicitudId, metodo } = req.body;

    const solicitud = await prisma.solicitud.findUnique({
      where: { id: solicitudId },
      include: { tecnico: true },
    });
    if (!solicitud) throw new AppError('Solicitud no encontrada', 404);
    if (solicitud.usuarioId !== req.user.id) throw new AppError('Sin acceso', 403);
    if (solicitud.estado !== 'CONFIRMADO') throw new AppError('La solicitud no está lista para pagar', 409);

    const monto = solicitud.totalFinal || solicitud.totalEstimado;
    const comisionPct = solicitud.tecnico?.comisionPct || 18;
    const comisionMonto = calcularComision(monto, comisionPct);
    const montoTecnico = monto - comisionMonto;

    const pago = await prisma.pago.create({
      data: {
        solicitudId,
        tecnicoId: solicitud.tecnicoId,
        monto,
        comisionPct,
        comisionMonto,
        montoTecnico,
        metodo,
        estado: 'PENDIENTE',
      },
    });

    // En producción: llamar a Khipu o Webpay SDK aquí
    // Por ahora devolvemos URL simulada
    const urlPago = metodo === 'khipu'
      ? `https://khipu.com/payment/info/${pago.id}`
      : `https://webpay3gint.transbank.cl/webpayserver/initTransaction`;

    res.json({
      message: 'Pago iniciado',
      pagoId: pago.id,
      monto,
      urlPago,
      desglose: {
        manoDeObra: solicitud.moBase,
        materiales: solicitud.matEstimado || 0,
        comision: comisionMonto,
        total: monto,
        alTecnico: montoTecnico,
      },
    });
  } catch (err) { next(err); }
});

// POST /api/pagos/:id/liberar — Cliente confirma → libera pago al técnico
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
      data: { trabajosCompletados: { increment: 1 } },
    });

    await notificarTecnico(req.io, pago.tecnicoId, {
      tipo: 'pago_liberado',
      titulo: '💰 Pago liberado',
      cuerpo: `Se transfirieron $${Math.round(pago.montoTecnico).toLocaleString('es-CL')} a tu cuenta.`,
      solicitudId: pago.solicitudId,
    });

    res.json({ message: 'Pago liberado', montoLiberado: pago.montoTecnico });
  } catch (err) { next(err); }
});

// POST /api/pagos/webhook/khipu
router.post('/webhook/khipu', async (req, res, next) => {
  try {
    const { payment_id } = req.body;
    const pago = await prisma.pago.findFirst({ where: { proveedorId: payment_id } });
    if (pago) {
      await prisma.pago.update({
        where: { id: pago.id },
        data: { estado: 'EN_ESCROW', escrowAt: new Date(), proveedorData: req.body },
      });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/pagos/historial
router.get('/historial', authenticate, async (req, res, next) => {
  try {
    const { rol, id } = req.user;
    const where = rol === 'usuario' ? { solicitud: { usuarioId: id } } : { tecnicoId: id };

    const pagos = await prisma.pago.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { solicitud: { select: { codigo: true, trabajo: true, createdAt: true } } },
    });

    const liberados = pagos.filter(p => p.estado === 'LIBERADO');
    const resumen = {
      totalGanado: liberados.reduce((s, p) => s + (rol === 'tecnico' ? p.montoTecnico : p.monto), 0),
      totalPendiente: pagos.filter(p => p.estado === 'EN_ESCROW').reduce((s, p) => s + p.monto, 0),
    };

    res.json({ pagos, resumen });
  } catch (err) { next(err); }
});

module.exports = router;
