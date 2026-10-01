const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');

const { generateTokens } = require('../utils/jwt');
const { AppError } = require('../utils/AppError');
const { aplicarDecisionTarifa, aplicarResolucionDisputa } = require('./solicitudesController');

// ─────────────────────────────────────────────
// Bootstrap — crea la primera cuenta admin (chicken/egg:
// no hay self-registro y crearCuenta ya requiere un admin
// existente). Protegido con la misma ADMIN_KEY compartida
// que revisarModTarifa. Uso manual único vía curl/Railway.
// ─────────────────────────────────────────────
exports.bootstrapAdmin = async (req, res, next) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || !process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
      throw new AppError('No autorizado', 403);
    }

    const { nombre, email, password } = req.body;
    if (!nombre || !email || !password) throw new AppError('nombre, email y password son requeridos', 422);

    const existe = await prisma.soporte.findUnique({ where: { email } });
    if (existe) throw new AppError('Este email ya está registrado', 409);

    const passwordHash = await bcrypt.hash(password, 12);
    const cuenta = await prisma.soporte.create({
      data: { nombre, email, passwordHash, esAdmin: true },
      select: { id: true, nombre: true, email: true, esAdmin: true, activo: true, createdAt: true },
    });

    res.status(201).json({ message: 'Cuenta admin creada', cuenta });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────
// Login de soporte
// ─────────────────────────────────────────────
exports.login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { email, password } = req.body;
    const cuenta = await prisma.soporte.findUnique({ where: { email } });
    if (!cuenta || !cuenta.activo) throw new AppError('Credenciales incorrectas', 401);

    const passwordOk = await bcrypt.compare(password, cuenta.passwordHash);
    if (!passwordOk) throw new AppError('Credenciales incorrectas', 401);

    const tokens = generateTokens({ id: cuenta.id, rol: 'soporte', esAdmin: cuenta.esAdmin, nombre: cuenta.nombre });
    res.json({
      message: 'Login exitoso',
      perfil: { id: cuenta.id, nombre: cuenta.nombre, email: cuenta.email, esAdmin: cuenta.esAdmin },
      ...tokens,
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────
// Cuentas de soporte (solo admin)
// ─────────────────────────────────────────────
exports.crearCuenta = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { nombre, email, password, esAdmin } = req.body;
    const existe = await prisma.soporte.findUnique({ where: { email } });
    if (existe) throw new AppError('Este email ya está registrado', 409);

    const passwordHash = await bcrypt.hash(password, 12);
    const cuenta = await prisma.soporte.create({
      data: { nombre, email, passwordHash, esAdmin: !!esAdmin },
      select: { id: true, nombre: true, email: true, esAdmin: true, activo: true, createdAt: true },
    });

    res.status(201).json({ message: 'Cuenta creada', cuenta });
  } catch (err) { next(err); }
};

exports.listarCuentas = async (_req, res, next) => {
  try {
    const cuentas = await prisma.soporte.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, nombre: true, email: true, esAdmin: true, activo: true, createdAt: true },
    });
    res.json({ cuentas });
  } catch (err) { next(err); }
};

exports.actualizarCuenta = async (req, res, next) => {
  try {
    const { activo, esAdmin } = req.body;
    if (req.params.id === req.user.id) {
      throw new AppError('No puedes modificar tu propia cuenta desde aquí', 409);
    }
    const data = {};
    if (typeof activo === 'boolean') data.activo = activo;
    if (typeof esAdmin === 'boolean') data.esAdmin = esAdmin;

    const cuenta = await prisma.soporte.update({
      where: { id: req.params.id },
      data,
      select: { id: true, nombre: true, email: true, esAdmin: true, activo: true },
    });
    res.json({ message: 'Cuenta actualizada', cuenta });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────
// Ajustes de tarifa — cola pendiente + resueltos
// ─────────────────────────────────────────────
exports.listarTarifas = async (req, res, next) => {
  try {
    const { estado } = req.query; // 'pendiente_revision' | 'resueltos' | undefined (todos)
    const where = {};
    if (estado === 'pendiente_revision') {
      where.modTarifaEstado = 'pendiente_revision';
      // Un agente (no admin) solo ve los casos asignados a él.
      if (!req.user.esAdmin) where.asignadoAId = req.user.id;
    } else if (estado === 'resueltos') {
      where.modTarifaEstado = { in: ['pendiente', 'rechazada'] };
      where.tarifaDecididoAt = { not: null };
      // Un agente (no admin) solo ve las que él mismo decidió.
      if (!req.user.esAdmin) where.tarifaDecididoPorId = req.user.id;
    }

    const solicitudes = await prisma.solicitud.findMany({
      where: { ...where, motivoModTarifa: { not: null } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        usuario: { select: { nombre: true } },
        tecnico: { select: { nombre: true, comisionPct: true } },
        rubro: { select: { nombre: true, emoji: true } },
      },
    });

    res.json({ solicitudes });
  } catch (err) { next(err); }
};

exports.decidirTarifa = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    if (!req.user.esAdmin) {
      const solicitud = await prisma.solicitud.findUnique({ where: { id: req.params.id }, select: { asignadoAId: true } });
      if (!solicitud) throw new AppError('Solicitud no encontrada', 404);
      if (solicitud.asignadoAId !== req.user.id) throw new AppError('Este caso está asignado a otro agente', 403);
    }

    const resultado = await aplicarDecisionTarifa(
      req.io,
      req.params.id,
      req.body.decision,
      { id: req.user.id, nombre: req.user.nombre },
    );
    res.json(resultado);
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────
// Disputas (trabajo mal ejecutado) — cola abierta + resueltas
// ─────────────────────────────────────────────
exports.listarDisputas = async (req, res, next) => {
  try {
    const { estado } = req.query; // 'abierta' | 'resueltas' | undefined (todas)
    const where = {};
    if (estado === 'abierta') {
      where.disputaEstado = 'abierta';
      if (!req.user.esAdmin) where.disputaAsignadoAId = req.user.id;
    } else if (estado === 'resueltas') {
      where.disputaEstado = 'resuelta';
      if (!req.user.esAdmin) where.disputaDecididoPorId = req.user.id;
    }

    const solicitudes = await prisma.solicitud.findMany({
      where: { ...where, disputaMotivo: { not: null } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        usuario: { select: { nombre: true } },
        tecnico: { select: { nombre: true, comisionPct: true } },
        rubro: { select: { nombre: true, emoji: true } },
        pagos: true,
      },
    });

    res.json({ solicitudes });
  } catch (err) { next(err); }
};

exports.resolverDisputa = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    if (!req.user.esAdmin) {
      const solicitud = await prisma.solicitud.findUnique({ where: { id: req.params.id }, select: { disputaAsignadoAId: true } });
      if (!solicitud) throw new AppError('Solicitud no encontrada', 404);
      if (solicitud.disputaAsignadoAId !== req.user.id) throw new AppError('Este caso está asignado a otro agente', 403);
    }

    const resultado = await aplicarResolucionDisputa(
      req.io,
      req.params.id,
      req.body.resolucion,
      req.body.montoReembolso ? parseFloat(req.body.montoReembolso) : null,
      { id: req.user.id, nombre: req.user.nombre },
    );
    res.json(resultado);
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────
// Vista general de solicitudes (lectura)
// ─────────────────────────────────────────────
exports.listarSolicitudes = async (req, res, next) => {
  try {
    const { estado, rubro, limit } = req.query;
    const where = {};
    if (estado) where.estado = estado;
    if (rubro) where.rubro = { nombre: rubro };

    const solicitudes = await prisma.solicitud.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit) || 50, 200),
      include: {
        usuario: { select: { nombre: true, telefono: true } },
        tecnico: { select: { nombre: true, telefono: true } },
        rubro: { select: { nombre: true, emoji: true } },
      },
    });
    res.json({ solicitudes });
  } catch (err) { next(err); }
};

exports.obtenerSolicitud = async (req, res, next) => {
  try {
    const solicitud = await prisma.solicitud.findUnique({
      where: { id: req.params.id },
      include: {
        usuario: { select: { nombre: true, email: true, telefono: true } },
        tecnico: { select: { nombre: true, email: true, telefono: true, comisionPct: true } },
        rubro: true,
        postulaciones: { include: { tecnico: { select: { nombre: true } } } },
        pagos: true,
        rating: true,
      },
    });
    if (!solicitud) throw new AppError('Solicitud no encontrada', 404);
    res.json({ solicitud });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────
// Vista general de técnicos y usuarios (lectura)
// ─────────────────────────────────────────────
exports.listarTecnicos = async (_req, res, next) => {
  try {
    const tecnicos = await prisma.tecnico.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, nombre: true, email: true, telefono: true, rut: true,
        activo: true, disponible: true, comisionPct: true, plan: true,
        ratingPromedio: true, totalRatings: true, trabajosCompletados: true,
        secCertificado: true, secVerificado: true, createdAt: true,
        rubros: { include: { rubro: { select: { nombre: true, emoji: true } } } },
      },
    });
    res.json({ tecnicos });
  } catch (err) { next(err); }
};

exports.listarUsuarios = async (_req, res, next) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, nombre: true, email: true, telefono: true,
        emailVerificado: true, telefonoVerif: true, createdAt: true,
        _count: { select: { solicitudes: true } },
      },
    });
    res.json({ usuarios });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────
// Dashboard — números rápidos
// ─────────────────────────────────────────────
exports.dashboard = async (_req, res, next) => {
  try {
    const [
      solicitudesActivas, tecnicosActivos, usuariosTotal,
      tarifasPendientes, disputasPendientes, pagosEnEscrow,
    ] = await Promise.all([
      prisma.solicitud.count({ where: { estado: { notIn: ['COMPLETADO', 'CANCELADO'] } } }),
      prisma.tecnico.count({ where: { activo: true } }),
      prisma.usuario.count(),
      prisma.solicitud.count({ where: { modTarifaEstado: 'pendiente_revision' } }),
      prisma.solicitud.count({ where: { disputaEstado: 'abierta' } }),
      prisma.pago.count({ where: { estado: 'EN_ESCROW' } }),
    ]);

    res.json({ solicitudesActivas, tecnicosActivos, usuariosTotal, tarifasPendientes, disputasPendientes, pagosEnEscrow });
  } catch (err) { next(err); }
};
