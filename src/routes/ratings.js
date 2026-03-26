const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middlewares/authenticate');
const { AppError } = require('../utils/AppError');

const prisma = new PrismaClient();

// POST /api/ratings — Cliente califica al técnico (y viceversa)
router.post('/', authenticate, [
  body('solicitudId').notEmpty(),
  body('estrellas').isInt({ min: 1, max: 5 }),
  body('comentario').optional().trim(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { solicitudId, estrellas, comentario } = req.body;
    const { id, rol } = req.user;

    const solicitud = await prisma.solicitud.findUnique({
      where: { id: solicitudId },
      include: { rating: true },
    });
    if (!solicitud) throw new AppError('Solicitud no encontrada', 404);
    if (solicitud.estado !== 'COMPLETADO') throw new AppError('El trabajo debe estar completado para calificar', 409);

    let rating;
    if (rol === 'usuario') {
      if (solicitud.usuarioId !== id) throw new AppError('Sin acceso', 403);
      rating = await prisma.rating.upsert({
        where: { solicitudId },
        update: { estrellasTecnico: estrellas, comentarioTecnico: comentario },
        create: {
          solicitudId,
          clienteId: id,
          tecnicoId: solicitud.tecnicoId,
          estrellasTecnico: estrellas,
          comentarioTecnico: comentario,
        },
      });
      // Recalcular promedio del técnico
      await recalcularRating(solicitud.tecnicoId);
    } else {
      if (solicitud.tecnicoId !== id) throw new AppError('Sin acceso', 403);
      rating = await prisma.rating.upsert({
        where: { solicitudId },
        update: { estrellasCliente: estrellas, comentarioCliente: comentario },
        create: {
          solicitudId,
          clienteId: solicitud.usuarioId,
          tecnicoId: id,
          estrellasCliente: estrellas,
          comentarioCliente: comentario,
        },
      });
    }

    res.json({ message: 'Calificación guardada', rating });
  } catch (err) { next(err); }
});

// GET /api/ratings/tecnico/:id — Ratings de un técnico
router.get('/tecnico/:id', async (req, res, next) => {
  try {
    const ratings = await prisma.rating.findMany({
      where: { tecnicoId: req.params.id, estrellasTecnico: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        cliente: { select: { nombre: true, avatarUrl: true } },
        solicitud: { select: { trabajo: true, createdAt: true } },
      },
    });

    const tecnico = await prisma.tecnico.findUnique({
      where: { id: req.params.id },
      select: { ratingPromedio: true, totalRatings: true },
    });

    res.json({ ratings, ratingPromedio: tecnico?.ratingPromedio, totalRatings: tecnico?.totalRatings });
  } catch (err) { next(err); }
});

async function recalcularRating(tecnicoId) {
  const ratings = await prisma.rating.findMany({
    where: { tecnicoId, estrellasTecnico: { not: null } },
    select: { estrellasTecnico: true },
  });
  if (ratings.length === 0) return;
  const promedio = ratings.reduce((s, r) => s + r.estrellasTecnico, 0) / ratings.length;
  await prisma.tecnico.update({
    where: { id: tecnicoId },
    data: { ratingPromedio: parseFloat(promedio.toFixed(2)), totalRatings: ratings.length },
  });
}

module.exports = router;
