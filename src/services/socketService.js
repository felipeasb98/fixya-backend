const { verifyAccessToken } = require('../utils/jwt');

const connectedUsers = new Map();
const connectedTecnicos = new Map();

let _io;

function initSocket(io) {
  _io = io;

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Token requerido'));
    try {
      const payload = verifyAccessToken(token);
      socket.userId = payload.id;
      socket.userRol = payload.rol;
      next();
    } catch {
      next(new Error('Token invalido'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, userRol } = socket;
    console.log(`[Socket] Conectado: ${userRol} ${userId}`);

    const map = userRol === 'tecnico' ? connectedTecnicos : connectedUsers;
    if (!map.has(userId)) map.set(userId, new Set());
    map.get(userId).add(socket.id);

    socket.join(`${userRol}:${userId}`);

    socket.on('tecnico:gps', ({ lat, lng, solicitudId }) => {
      if (userRol !== 'tecnico') return;
      if (solicitudId) {
        io.to(`solicitud:${solicitudId}`).emit('tecnico:ubicacion', {
          tecnicoId: userId, lat, lng, timestamp: new Date().toISOString(),
        });
      }
      updateTecnicoGPS(userId, lat, lng);
    });

    socket.on('solicitud:join', (solicitudId) => {
      socket.join(`solicitud:${solicitudId}`);
    });

    socket.on('solicitud:leave', (solicitudId) => {
      socket.leave(`solicitud:${solicitudId}`);
    });

    socket.on('tecnico:disponible', async (disponible) => {
      if (userRol !== 'tecnico') return;
      await updateTecnicoDisponible(userId, disponible);
      socket.emit('tecnico:disponible:ok', { disponible });
    });

    socket.on('disconnect', () => {
      const map = userRol === 'tecnico' ? connectedTecnicos : connectedUsers;
      if (map.has(userId)) {
        map.get(userId).delete(socket.id);
        if (map.get(userId).size === 0) {
          map.delete(userId);
          if (userRol === 'tecnico') updateTecnicoDisponible(userId, false);
        }
      }
    });
  });
}

function emitirATecnico(tecnicoId, evento, data) {
  if (_io) _io.to(`tecnico:${tecnicoId}`).emit(evento, data);
}

function emitirAUsuario(usuarioId, evento, data) {
  if (_io) _io.to(`usuario:${usuarioId}`).emit(evento, data);
}

function emitirATecnicosDisponibles(tecnicoIds, evento, data) {
  if (!_io) return;
  tecnicoIds.forEach(id => {
    if (connectedTecnicos.has(id)) _io.to(`tecnico:${id}`).emit(evento, data);
  });
}

function emitirASolicitud(solicitudId, evento, data) {
  if (_io) _io.to(`solicitud:${solicitudId}`).emit(evento, data);
}

async function updateTecnicoGPS(tecnicoId, lat, lng) {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.tecnico.update({
      where: { id: tecnicoId },
      data: { latitud: lat, longitud: lng, ubicacionAt: new Date() },
    });
    await prisma.$disconnect();
  } catch {}
}

async function updateTecnicoDisponible(tecnicoId, disponible) {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.tecnico.update({ where: { id: tecnicoId }, data: { disponible } });
    await prisma.$disconnect();
  } catch {}
}

module.exports = {
  initSocket,
  emitirATecnico,
  emitirAUsuario,
  emitirATecnicosDisponibles,
  emitirASolicitud,
  connectedTecnicos,
  connectedUsers,
};