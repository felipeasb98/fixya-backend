const { validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { AppError } = require('../utils/AppError');
const { generarCodigo } = require('../utils/helpers');
const { notificarTecnicos, notificarUsuario, notificarTecnico } = require('../services/notificacionService');
const { calcularDistanciaKm } = require('../utils/geo');

const prisma = new PrismaClient();

// ─────────────────────────────────────────────
// Crear solicitud (cliente)
// ─────────────────────────────────────────────
exports.crear = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const {
      trabajo, rubroId, descripcion, urgencia,
      moBase, matEstimado, totalEstimado,
      latitud, longitud, direccion, comuna,
      agendado, fechaAgendada, bloqueHorario,
      fotosProblema,
    } = req.body;

    // Verificar rubro
    const rubro = await prisma.rubro.findUnique({ where: { id: rubroId } });
    if (!rubro) throw new AppError('Rubro no encontrado', 404);

    // Crear la solicitud
    const solicitud = await prisma.solicitud.create({
      data: {
        codigo: generarCodigo(),
        usuarioId: req.user.id,
        rubroId,
        trabajo,
        descripcion,
        urgencia: urgencia || 'normal',
        moBase,
        matEstimado: matEstimado || 0,
        totalEstimado,
        latitud: latitud ? parseFloat(latitud) : null,
        longitud: longitud ? parseFloat(longitud) : null,
        direccion,
        comuna,
        agendado: agendado || false,
        fechaAgendada: fechaAgendada ? new Date(fechaAgendada) : null,
        bloqueHorario,
        fotosProblema: fotosProblema || [],
      },
      include: {
        usuario: { select: { nombre: true, telefono: true } },
        rubro: true,
      },
    });

    // Notificar a técnicos disponibles via Socket.io y push
    await notificarTecnicos(req.io, solicitud);

    res.status(201).json({
      message: 'Solicitud creada. Buscando técnicos en tu zona...',
      solicitud,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// Mis solicitudes (cliente)
// ─────────────────────────────────────────────
exports.misSolicitudes = async (req, res, next) => {
  try {
    const { estado, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { usuarioId: req.user.id };
    if (estado) where.estado = estado;

    const [solicitudes, total] = await Promise.all([
      prisma.solicitud.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          rubro: true,
          tecnico: { select: { nombre: true, avatarUrl: true, ratingPromedio: true } },
          pago: { select: { estado: true, monto: true } },
        },
      }),
      prisma.solicitud.count({ where }),
    ]);

    res.json({ solicitudes, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// Trabajos disponibles (técnico)
// Filtra por rubro del técnico y distancia GPS
// ─────────────────────────────────────────────
exports.disponibles = async (req, res, next) => {
  try {
    const tecnico = await prisma.tecnico.findUnique({
      where: { id: req.user.id },
      include: { rubros: true },
    });
    if (!tecnico) throw new AppError('Técnico no encontrado', 404);

    const rubroIds = tecnico.rubros.map(r => r.rubroId);
    const { lat, lng, radio = 15 } = req.query; // radio en km

    const solicitudes = await prisma.solicitud.findMany({
      where: {
        estado: { in: ['PENDIENTE', 'CON_POSTULANTES'] },
        rubroId: { in: rubroIds },
        // Si el técnico tiene SEC, puede ver todos; si no, excluir trabajos SEC
        ...(!tecnico.secVerificado && {
          trabajo: { notIn: getTrabajosSEC() },
        }),
      },
      orderBy: [
        { urgencia: 'desc' },
        { createdAt: 'asc' },
      ],
      include: {
        rubro: true,
        usuario: { select: { nombre: true } },
        postulaciones: { where: { tecnicoId: req.user.id } },
        _count: { select: { postulaciones: true } },
      },
    });

    // Filtrar por distancia si el técnico tiene GPS
    let resultado = solicitudes;
    if (lat && lng) {
      resultado = solicitudes.filter(s => {
        if (!s.latitud || !s.longitud) return true; // Incluir las sin GPS
        const dist = calcularDistanciaKm(
          parseFloat(lat), parseFloat(lng),
          s.latitud, s.longitud
        );
        return dist <= parseInt(radio);
      }).map(s => ({
        ...s,
        distanciaKm: (lat && lng && s.latitud && s.longitud)
          ? calcularDistanciaKm(parseFloat(lat), parseFloat(lng), s.latitud, s.longitud)
          : null,
        yaPostulado: s.postulaciones.length > 0,
      }));
    }

    res.json({ solicitudes: resultado });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// Obtener una solicitud por ID
// ─────────────────────────────────────────────
exports.obtener = async (req, res, next) => {
  try {
    const solicitud = await prisma.solicitud.findUnique({
      where: { id: req.params.id },
      include: {
        usuario: { select: { nombre: true, telefono: true, avatarUrl: true } },
        tecnico: {
          select: {
            nombre: true, avatarUrl: true, telefono: true,
            ratingPromedio: true, totalRatings: true, trabajosCompletados: true,
            secVerificado: true, plan: true,
          },
        },
        rubro: true,
        postulaciones: {
          include: {
            tecnico: {
              select: {
                id: true, nombre: true, avatarUrl: true,
                ratingPromedio: true, totalRatings: true, trabajosCompletados: true,
                secVerificado: true, plan: true, latitud: true, longitud: true,
              },
            },
          },
        },
        pago: true,
        rating: true,
      },
    });

    if (!solicitud) throw new AppError('Solicitud no encontrada', 404);

    // Verificar que pertenece al usuario/técnico que consulta
    const { id, rol } = req.user;
    const esCliente = rol === 'usuario' && solicitud.usuarioId === id;
    const esTecnico = rol === 'tecnico' && solicitud.tecnicoId === id;
    const esPostulante = rol === 'tecnico' && solicitud.postulaciones.some(p => p.tecnicoId === id);

    if (!esCliente && !esTecnico && !esPostulante) {
      throw new AppError('Sin acceso a esta solicitud', 403);
    }

    res.json({ solicitud });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// Cliente elige técnico
// ─────────────────────────────────────────────
exports.elegirTecnico = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { tecnicoId } = req.body;
    const solicitud = await getSolicitudPropia(req.params.id, req.user.id, 'usuario');

    if (!['PENDIENTE', 'CON_POSTULANTES'].includes(solicitud.estado)) {
      throw new AppError('Esta solicitud ya no acepta cambios', 409);
    }

    // Verificar que el técnico postuló
    const postulacion = await prisma.postulacion.findUnique({
      where: { solicitudId_tecnicoId: { solicitudId: solicitud.id, tecnicoId } },
    });
    if (!postulacion) throw new AppError('Este técnico no se postuló', 400);

    // Actualizar solicitud
    const actualizada = await prisma.solicitud.update({
      where: { id: solicitud.id },
      data: {
        tecnicoId,
        estado: 'CONFIRMADO',
        postulaciones: {
          updateMany: {
            where: { tecnicoId },
            data: { estado: 'aceptada' },
          },
        },
      },
      include: {
        tecnico: { select: { nombre: true, fcmToken: true } },
        usuario: { select: { nombre: true } },
      },
    });

    // Notificar al técnico elegido en tiempo real
    await notificarTecnico(req.io, tecnicoId, {
      tipo: 'trabajo_confirmado',
      titulo: '¡Te eligieron!',
      cuerpo: `${actualizada.usuario.nombre} te seleccionó para "${solicitud.trabajo}"`,
      solicitudId: solicitud.id,
    });

    res.json({ message: 'Técnico asignado', solicitud: actualizada });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// Técnico: en camino
// ─────────────────────────────────────────────
exports.enCamino = async (req, res, next) => {
  try {
    const solicitud = await getSolicitudTecnico(req.params.id, req.user.id);
    if (solicitud.estado !== 'CONFIRMADO') throw new AppError('Estado inválido para esta acción', 409);

    const actualizada = await prisma.solicitud.update({
      where: { id: solicitud.id },
      data: { estado: 'EN_CAMINO', tecnicoEnCaminoAt: new Date() },
      include: { usuario: { select: { nombre: true, fcmToken: true } } },
    });

    await notificarUsuario(req.io, solicitud.usuarioId, {
      tipo: 'tecnico_en_camino',
      titulo: 'Técnico en camino 🚗',
      cuerpo: 'Tu técnico está en camino. Puedes seguir su ubicación en tiempo real.',
      solicitudId: solicitud.id,
    });

    res.json({ message: 'Estado actualizado', solicitud: actualizada });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// Técnico: inicio de trabajo
// ─────────────────────────────────────────────
exports.inicioTrabajo = async (req, res, next) => {
  try {
    const solicitud = await getSolicitudTecnico(req.params.id, req.user.id);
    if (solicitud.estado !== 'EN_CAMINO') throw new AppError('Estado inválido', 409);

    const actualizada = await prisma.solicitud.update({
      where: { id: solicitud.id },
      data: { estado: 'EN_TRABAJO', trabajoInicioAt: new Date() },
    });

    await notificarUsuario(req.io, solicitud.usuarioId, {
      tipo: 'trabajo_iniciado',
      titulo: 'Trabajo iniciado 🔧',
      cuerpo: `El técnico comenzó con "${solicitud.trabajo}"`,
      solicitudId: solicitud.id,
    });

    res.json({ message: 'Trabajo iniciado', solicitud: actualizada });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// Técnico: trabajo terminado (pide confirmación al cliente)
// ─────────────────────────────────────────────
exports.trabajoTerminado = async (req, res, next) => {
  try {
    const solicitud = await getSolicitudTecnico(req.params.id, req.user.id);
    if (solicitud.estado !== 'EN_TRABAJO') throw new AppError('Estado inválido', 409);

    const { fotosCierre } = req.body;

    const actualizada = await prisma.solicitud.update({
      where: { id: solicitud.id },
      data: {
        estado: 'ESPERANDO_CONF',
        trabajoFinAt: new Date(),
        fotosCierre: fotosCierre || [],
      },
    });

    await notificarUsuario(req.io, solicitud.usuarioId, {
      tipo: 'confirmar_trabajo',
      titulo: '¿Quedó bien? ✅',
      cuerpo: 'El técnico dice que terminó. Confirma para liberar el pago.',
      solicitudId: solicitud.id,
    });

    res.json({ message: 'Esperando confirmación del cliente', solicitud: actualizada });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// Cliente: confirmar trabajo completado
// ─────────────────────────────────────────────
exports.confirmarTrabajo = async (req, res, next) => {
  try {
    const solicitud = await getSolicitudPropia(req.params.id, req.user.id, 'usuario');
    if (solicitud.estado !== 'ESPERANDO_CONF') throw new AppError('Estado inválido', 409);

    const actualizada = await prisma.solicitud.update({
      where: { id: solicitud.id },
      data: { estado: 'COMPLETADO', clienteConfirmoAt: new Date() },
    });

    // Liberar el pago (se maneja en pagosController.liberar)
    // Emitir evento para que el controller de pagos lo procese
    req.io.emit(`pago:liberar:${solicitud.id}`);

    await notificarTecnico(req.io, solicitud.tecnicoId, {
      tipo: 'trabajo_completado',
      titulo: 'Trabajo confirmado 🎉',
      cuerpo: 'El cliente confirmó el trabajo. Tu pago será transferido.',
      solicitudId: solicitud.id,
    });

    res.json({ message: 'Trabajo confirmado. Pago en proceso.', solicitud: actualizada });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// Técnico solicita modificación de tarifa
// ─────────────────────────────────────────────
exports.solicitarModTarifa = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { moModificada, motivoModTarifa } = req.body;
    const solicitud = await getSolicitudTecnico(req.params.id, req.user.id);

    if (solicitud.estado !== 'EN_TRABAJO') throw new AppError('Solo puedes modificar tarifa durante el trabajo', 409);

    const tecnico = await prisma.tecnico.findUnique({
      where: { id: req.user.id },
      select: { comisionPct: true },
    });
    const nuevaComision = (moModificada * tecnico.comisionPct) / 100;
    const nuevoTotal = moModificada + (solicitud.matEstimado || 0) + nuevaComision;

    const actualizada = await prisma.solicitud.update({
      where: { id: solicitud.id },
      data: {
        moModificada,
        motivoModTarifa,
        modTarifaEstado: 'pendiente',
        totalFinal: nuevoTotal,
      },
    });

    await notificarUsuario(req.io, solicitud.usuarioId, {
      tipo: 'mod_tarifa',
      titulo: 'Cambio de tarifa solicitado ⚠️',
      cuerpo: `El técnico solicita ajustar la tarifa. Nuevo total estimado: $${Math.round(nuevoTotal).toLocaleString('es-CL')}`,
      solicitudId: solicitud.id,
    });

    res.json({ message: 'Modificación enviada al cliente', solicitud: actualizada });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// Cliente responde modificación de tarifa
// ─────────────────────────────────────────────
exports.responderModTarifa = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { decision } = req.body; // 'aceptar' | 'rechazar'
    const solicitud = await getSolicitudPropia(req.params.id, req.user.id, 'usuario');

    if (solicitud.modTarifaEstado !== 'pendiente') throw new AppError('No hay modificación pendiente', 409);

    const data = { modTarifaEstado: decision === 'aceptar' ? 'aceptada' : 'rechazada' };
    if (decision === 'rechazar') {
      data.moModificada = null;
      data.totalFinal = null;
    }

    const actualizada = await prisma.solicitud.update({
      where: { id: solicitud.id },
      data,
    });

    const msg = decision === 'aceptar'
      ? 'Tarifa aceptada. El técnico fue notificado.'
      : 'Tarifa rechazada. El técnico fue notificado.';

    await notificarTecnico(req.io, solicitud.tecnicoId, {
      tipo: decision === 'aceptar' ? 'tarifa_aceptada' : 'tarifa_rechazada',
      titulo: decision === 'aceptar' ? 'Tarifa aceptada ✅' : 'Tarifa rechazada ❌',
      cuerpo: decision === 'aceptar'
        ? 'El cliente aceptó el nuevo precio. Puedes continuar.'
        : 'El cliente rechazó el ajuste de precio.',
      solicitudId: solicitud.id,
    });

    res.json({ message: msg, solicitud: actualizada });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// Cancelar
// ─────────────────────────────────────────────
exports.cancelar = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { motivo } = req.body;
    const { id, rol } = req.user;

    const solicitud = await prisma.solicitud.findUnique({ where: { id: req.params.id } });
    if (!solicitud) throw new AppError('Solicitud no encontrada', 404);

    const esCliente = rol === 'usuario' && solicitud.usuarioId === id;
    const esTecnico = rol === 'tecnico' && solicitud.tecnicoId === id;
    if (!esCliente && !esTecnico) throw new AppError('Sin acceso', 403);

    const estadosCancelables = ['PENDIENTE', 'CON_POSTULANTES', 'CONFIRMADO', 'EN_CAMINO'];
    if (!estadosCancelables.includes(solicitud.estado)) {
      throw new AppError('No se puede cancelar un trabajo en curso', 409);
    }

    await prisma.solicitud.update({
      where: { id: solicitud.id },
      data: { estado: 'CANCELADO', canceladoAt: new Date(), motivoCancelacion: motivo },
    });

    // Notificar a la otra parte
    if (esCliente && solicitud.tecnicoId) {
      await notificarTecnico(req.io, solicitud.tecnicoId, {
        tipo: 'trabajo_cancelado',
        titulo: 'Trabajo cancelado',
        cuerpo: `El cliente canceló "${solicitud.trabajo}". Sin penalización.`,
        solicitudId: solicitud.id,
      });
    } else if (esTecnico) {
      await notificarUsuario(req.io, solicitud.usuarioId, {
        tipo: 'trabajo_cancelado',
        titulo: 'Técnico canceló el trabajo',
        cuerpo: `Tu técnico canceló. Te encontraremos otro rápido.`,
        solicitudId: solicitud.id,
      });
    }

    res.json({ message: 'Solicitud cancelada' });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// Helpers privados
// ─────────────────────────────────────────────
async function getSolicitudPropia(id, usuarioId, rol) {
  const solicitud = await prisma.solicitud.findUnique({ where: { id } });
  if (!solicitud) throw new AppError('Solicitud no encontrada', 404);
  const campo = rol === 'usuario' ? 'usuarioId' : 'tecnicoId';
  if (solicitud[campo] !== usuarioId) throw new AppError('Sin acceso', 403);
  return solicitud;
}

async function getSolicitudTecnico(id, tecnicoId) {
  const solicitud = await prisma.solicitud.findUnique({ where: { id } });
  if (!solicitud) throw new AppError('Solicitud no encontrada', 404);
  if (solicitud.tecnicoId !== tecnicoId) throw new AppError('Sin acceso', 403);
  return solicitud;
}

function getTrabajosSEC() {
  return [
    'Corte parcial de luz en zona específica',
    'Problema con automático (breaker)',
    'Diagnóstico eléctrico (sin obras)',
    'Instalación calefont', 'Instalación de termostato',
    'Cambio de caldera', 'Instalación de cañería',
  ];
}
