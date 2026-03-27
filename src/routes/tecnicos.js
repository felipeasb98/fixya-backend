const prisma = require('../lib/prisma');
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validationResult } = require('express-validator');

const { authenticate } = require('../middlewares/authenticate');
const { soloRol } = require('../middlewares/soloRol');
const { AppError } = require('../utils/AppError');



// GET /api/tecnicos/perfil — Perfil propio del técnico
router.get('/perfil', authenticate, soloRol('tecnico'), async (req, res, next) => {
  try {
    const tecnico = await prisma.tecnico.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, nombre: true, email: true, telefono: true, avatarUrl: true,
        activo: true, disponible: true, ratingPromedio: true, totalRatings: true,
        trabajosCompletados: true, comisionPct: true, plan: true,
        secCertificado: true, secVerificado: true, secVencimiento: true,
        banco: true, tipoCuenta: true, numeroCuenta: true, emailBanco: true,
        rubros: { include: { rubro: true } },
        createdAt: true,
      },
    });
    if (!tecnico) throw new AppError('Técnico no encontrado', 404);
    res.json({ tecnico });
  } catch (err) { next(err); }
});

// PATCH /api/tecnicos/perfil
router.patch('/perfil', authenticate, soloRol('tecnico'), [
  body('nombre').optional().trim().notEmpty(),
  body('telefono').optional().trim(),
  body('descripcion').optional().trim(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { nombre, telefono, descripcion, disponible, fcmToken,
            banco, tipoCuenta, numeroCuenta, emailBanco } = req.body;
    const data = {};
    if (nombre !== undefined) data.nombre = nombre;
    if (telefono !== undefined) data.telefono = telefono;
    if (descripcion !== undefined) data.descripcion = descripcion;
    if (disponible !== undefined) data.disponible = disponible;
    if (fcmToken !== undefined) data.fcmToken = fcmToken;
    if (banco !== undefined) data.banco = banco;
    if (tipoCuenta !== undefined) data.tipoCuenta = tipoCuenta;
    if (numeroCuenta !== undefined) data.numeroCuenta = numeroCuenta;
    if (emailBanco !== undefined) data.emailBanco = emailBanco;

    const tecnico = await prisma.tecnico.update({
      where: { id: req.user.id },
      data,
      select: { id: true, nombre: true, disponible: true, telefono: true },
    });
    res.json({ tecnico });
  } catch (err) { next(err); }
});

// PATCH /api/tecnicos/gps — Actualizar ubicación GPS
router.patch('/gps', authenticate, soloRol('tecnico'), [
  body('latitud').isFloat({ min: -90, max: 90 }),
  body('longitud').isFloat({ min: -180, max: 180 }),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { latitud, longitud, solicitudId } = req.body;

    await prisma.tecnico.update({
      where: { id: req.user.id },
      data: { latitud, longitud, ubicacionAt: new Date() },
    });

    // Emitir GPS en tiempo real al cliente si hay solicitud activa
    if (solicitudId) {
      req.io.to(`solicitud:${solicitudId}`).emit('tecnico:ubicacion', {
        tecnicoId: req.user.id,
        lat: latitud,
        lng: longitud,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/tecnicos/:id — Perfil público de un técnico
router.get('/:id', async (req, res, next) => {
  try {
    const tecnico = await prisma.tecnico.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, nombre: true, avatarUrl: true,
        ratingPromedio: true, totalRatings: true,
        trabajosCompletados: true, secVerificado: true, plan: true,
        descripcion: true, rubros: { include: { rubro: true } },
        createdAt: true,
      },
    });
    if (!tecnico) throw new AppError('Técnico no encontrado', 404);
    res.json({ tecnico });
  } catch (err) { next(err); }
});

module.exports = router;
