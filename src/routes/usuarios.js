const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middlewares/authenticate');
const { soloRol } = require('../middlewares/soloRol');
const { AppError } = require('../utils/AppError');
const multer = require('multer');

const prisma = new PrismaClient();

// ── USUARIOS ──────────────────────────────────────────────────

// GET /api/usuarios/perfil
router.get('/perfil', authenticate, soloRol('usuario'), async (req, res, next) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, nombre: true, email: true, telefono: true,
        avatarUrl: true, emailVerificado: true, createdAt: true,
      },
    });
    if (!usuario) throw new AppError('Usuario no encontrado', 404);
    res.json({ usuario });
  } catch (err) { next(err); }
});

// PATCH /api/usuarios/perfil
router.patch('/perfil', authenticate, soloRol('usuario'), [
  body('nombre').optional().trim().notEmpty(),
  body('telefono').optional().trim().notEmpty(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { nombre, telefono, fcmToken } = req.body;
    const data = {};
    if (nombre) data.nombre = nombre;
    if (telefono) data.telefono = telefono;
    if (fcmToken) data.fcmToken = fcmToken;

    const usuario = await prisma.usuario.update({
      where: { id: req.user.id },
      data,
      select: { id: true, nombre: true, email: true, telefono: true, avatarUrl: true },
    });

    res.json({ usuario });
  } catch (err) { next(err); }
});

module.exports = router;
