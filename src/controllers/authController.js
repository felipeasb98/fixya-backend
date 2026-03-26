const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { generateTokens, verifyRefreshToken } = require('../utils/jwt');
const { validarRut } = require('../utils/rut');
const { AppError } = require('../utils/AppError');

const prisma = new PrismaClient();

exports.registroUsuario = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { nombre, email, password, telefono, rut } = req.body;
    const existe = await prisma.usuario.findUnique({ where: { email } });
    if (existe) throw new AppError('Este email ya esta registrado', 409);
    if (rut && !validarRut(rut)) throw new AppError('RUT invalido', 422);

    const passwordHash = await bcrypt.hash(password, 12);
    const usuario = await prisma.usuario.create({
      data: { nombre, email, telefono, passwordHash, rut: rut || null },
      select: { id: true, nombre: true, email: true, telefono: true, createdAt: true },
    });

    const tokens = generateTokens({ id: usuario.id, rol: 'usuario' });
    res.status(201).json({ message: 'Cuenta creada', usuario, ...tokens });
  } catch (err) { next(err); }
};

exports.registroTecnico = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { nombre, email, password, telefono, rut, rubros, banco, tipoCuenta, numeroCuenta, emailBanco, descripcion } = req.body;

    const existeEmail = await prisma.tecnico.findUnique({ where: { email } });
    if (existeEmail) throw new AppError('Este email ya esta registrado', 409);
    const existeRut = await prisma.tecnico.findUnique({ where: { rut } });
    if (existeRut) throw new AppError('Este RUT ya esta registrado', 409);
    if (!validarRut(rut)) throw new AppError('RUT invalido', 422);

    const rubrosDB = await prisma.rubro.findMany({ where: { nombre: { in: rubros }, activo: true } });
    if (rubrosDB.length !== rubros.length) throw new AppError('Uno o mas rubros no son validos', 422);

    const passwordHash = await bcrypt.hash(password, 12);
    const tecnico = await prisma.tecnico.create({
      data: {
        nombre, email, telefono, passwordHash, rut,
        banco, tipoCuenta, numeroCuenta, emailBanco, descripcion,
        activo: false,
        rubros: { create: rubrosDB.map(r => ({ rubroId: r.id })) },
      },
      select: { id: true, nombre: true, email: true, activo: true, createdAt: true },
    });

    res.status(201).json({ message: 'Solicitud enviada. FixYa verificara tus datos en 24-48 horas.', tecnico });
  } catch (err) { next(err); }
};

exports.login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { email, password, rol, fcmToken } = req.body;
    let entidad;

    if (rol === 'usuario') {
      entidad = await prisma.usuario.findUnique({ where: { email } });
    } else {
      entidad = await prisma.tecnico.findUnique({ where: { email } });
      if (entidad && !entidad.activo) throw new AppError('Tu cuenta esta pendiente de verificacion.', 403);
    }

    if (!entidad) throw new AppError('Credenciales incorrectas', 401);
    const passwordOk = await bcrypt.compare(password, entidad.passwordHash);
    if (!passwordOk) throw new AppError('Credenciales incorrectas', 401);

    if (fcmToken) {
      const model = rol === 'usuario' ? prisma.usuario : prisma.tecnico;
      await model.update({ where: { id: entidad.id }, data: { fcmToken } });
    }

    const tokens = generateTokens({ id: entidad.id, rol });
    const { passwordHash, ...perfil } = entidad;
    res.json({ message: 'Login exitoso', rol, perfil, ...tokens });
  } catch (err) { next(err); }
};

exports.refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new AppError('Refresh token requerido', 400);
    const payload = verifyRefreshToken(refreshToken);
    const tokens = generateTokens({ id: payload.id, rol: payload.rol });
    res.json(tokens);
  } catch (err) { next(new AppError('Refresh token invalido o expirado', 401)); }
};

exports.logout = async (req, res, next) => {
  try {
    const model = req.user.rol === 'usuario' ? prisma.usuario : prisma.tecnico;
    await model.update({ where: { id: req.user.id }, data: { fcmToken: null } });
    res.json({ message: 'Sesion cerrada' });
  } catch (err) { next(err); }
};

exports.me = async (req, res, next) => {
  try {
    const { id, rol } = req.user;
    let perfil;
    if (rol === 'usuario') {
      perfil = await prisma.usuario.findUnique({
        where: { id },
        select: { id: true, nombre: true, email: true, telefono: true, avatarUrl: true, emailVerificado: true, createdAt: true },
      });
    } else {
      perfil = await prisma.tecnico.findUnique({
        where: { id },
        select: {
          id: true, nombre: true, email: true, telefono: true, avatarUrl: true,
          activo: true, disponible: true, ratingPromedio: true, totalRatings: true,
          trabajosCompletados: true, comisionPct: true, plan: true,
          secCertificado: true, secVerificado: true,
          rubros: { include: { rubro: true } }, createdAt: true,
        },
      });
    }
    if (!perfil) throw new AppError('Usuario no encontrado', 404);
    res.json({ rol, perfil });
  } catch (err) { next(err); }
};
