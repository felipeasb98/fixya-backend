const prisma = require('../lib/prisma');
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validationResult } = require('express-validator');

const { authenticate } = require('../middlewares/authenticate');
const { soloRol } = require('../middlewares/soloRol');
const { AppError } = require('../utils/AppError');
const { notificarUsuario } = require('../services/notificacionService');



// POST /api/postulaciones — Técnico se postula
router.post('/', authenticate, soloRol('tecnico'), [
  body('solicitudId').notEmpty(),
  body('tiempoEta').optional().isInt({ min: 1, max: 120 }),
  body('mensaje').optional().trim(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { solicitudId, tiempoEta, mensaje } = req.body;
    const tecnicoId = req.user.id;

    const solicitud = await prisma.solicitud.findUnique({ where: { id: solicitudId } });
    if (!solicitud) throw new AppError('Solicitud no encontrada', 404);
    if (!['PENDIENTE', 'CON_POSTULANTES'].includes(solicitud.estado)) {
      throw new AppError('Esta solicitud ya no acepta postulaciones', 409);
    }

    const tieneRubro = await prisma.tecnicoRubro.findFirst({
      where: { tecnicoId, rubroId: solicitud.rubroId },
    });
    if (!tieneRubro) throw new AppError('No tienes el rubro requerido', 403);

    const postulacion = await prisma.postulacion.upsert({
      where: { solicitudId_tecnicoId: { solicitudId, tecnicoId } },
      update: { tiempoEta, mensaje },
      create: { solicitudId, tecnicoId, tiempoEta, mensaje },
      include: {
        tecnico: {
          select: {
            id: true, nombre: true, avatarUrl: true,
            ratingPromedio: true, totalRatings: true,
            trabajosCompletados: true, secVerificado: true, plan: true,
          },
        },
      },
    });

    await prisma.solicitud.update({
      where: { id: solicitudId },
      data: { estado: 'CON_POSTULANTES' },
    });

    await notificarUsuario(req.io, solicitud.usuarioId, {
      tipo: 'nuevo_postulante',
      titulo: 'Técnico disponible 👷',
      cuerpo: `${postulacion.tecnico.nombre} se postuló para "${solicitud.trabajo}"`,
      solicitudId,
    });

    res.status(201).json({ message: 'Postulación enviada', postulacion });
  } catch (err) { next(err); }
});

// GET /api/postulaciones/solicitud/:solicitudId — Ver postulantes (cliente)
router.get('/solicitud/:solicitudId', authenticate, soloRol('usuario'), async (req, res, next) => {
  try {
    const solicitud = await prisma.solicitud.findUnique({ where: { id: req.params.solicitudId } });
    if (!solicitud) throw new AppError('No encontrada', 404);
    if (solicitud.usuarioId !== req.user.id) throw new AppError('Sin acceso', 403);

    const postulaciones = await prisma.postulacion.findMany({
      where: { solicitudId: req.params.solicitudId },
      include: {
        tecnico: {
          select: {
            id: true, nombre: true, avatarUrl: true, telefono: true,
            ratingPromedio: true, totalRatings: true, trabajosCompletados: true,
            secVerificado: true, plan: true, latitud: true, longitud: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ postulaciones });
  } catch (err) { next(err); }
});

// DELETE /api/postulaciones/:solicitudId — Técnico cancela su postulación
router.delete('/:solicitudId', authenticate, soloRol('tecnico'), async (req, res, next) => {
  try {
    const deleted = await prisma.postulacion.deleteMany({
      where: { solicitudId: req.params.solicitudId, tecnicoId: req.user.id },
    });
    if (deleted.count === 0) throw new AppError('Postulación no encontrada', 404);
    res.json({ message: 'Postulación cancelada' });
  } catch (err) { next(err); }
});

module.exports = router;
