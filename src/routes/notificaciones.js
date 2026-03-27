const prisma = require('../lib/prisma');
const express = require('express');
const router = express.Router();

const { authenticate } = require('../middlewares/authenticate');
const { AppError } = require('../utils/AppError');



// GET /api/notificaciones — Mis notificaciones
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const notificaciones = await prisma.notificacion.findMany({
      where: { destinoId: req.user.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit),
    });

    const noLeidas = await prisma.notificacion.count({
      where: { destinoId: req.user.id, leida: false },
    });

    res.json({ notificaciones, noLeidas });
  } catch (err) { next(err); }
});

// PATCH /api/notificaciones/:id/leer
router.patch('/:id/leer', authenticate, async (req, res, next) => {
  try {
    await prisma.notificacion.updateMany({
      where: { id: req.params.id, destinoId: req.user.id },
      data: { leida: true },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/notificaciones/leer-todas
router.patch('/leer-todas', authenticate, async (req, res, next) => {
  try {
    await prisma.notificacion.updateMany({
      where: { destinoId: req.user.id, leida: false },
      data: { leida: true },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
