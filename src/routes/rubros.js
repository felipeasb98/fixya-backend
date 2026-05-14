// src/routes/rubros.js
// Endpoint público: lista de rubros disponibles (no requiere autenticación)
const express = require('express');
const router  = express.Router();
const prisma  = require('../lib/prisma');

// GET /api/rubros → [{ id, nombre, emoji }]
router.get('/', async (_req, res, next) => {
  try {
    const rubros = await prisma.rubro.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, emoji: true },
      orderBy: { nombre: 'asc' },
    });
    res.json(rubros);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
