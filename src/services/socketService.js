const { verifyAccessToken } = require('../utils/jwt');
const prisma = require('../lib/prisma');

const connectedUsers   = new Map();
const connectedTecnicos = new Map();
let _io;

function initSocket(io) {
  _io = io;

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Token requerido'));
    try {
      const payload = verifyAccessToken(token);
      socket.userId  = payload.id;
      socket.userRol = payload.rol;
      next();
    } catch {
      next(new Error('Token invalido'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, userRol } = socket;

    const map = userRol === 'tecnico' ? connectedTecnicos : connectedUsers;
    if (!map.has(userId)) map.set(userId, new Set());
    map.get(userId).add(socket.id);
    socket.join(userRol + ':' + userId);

    // GPS del técnico
    socket.on('tecnico:gps', ({ lat, lng, solicitudId } = {}) => {
      if (userRol !== 'tecnico') return;
      if (solicitudId) {
        io.to('solicitud:' + solicitudId).emit('tecnico:ubicacion', {
          tecnicoId: userId, lat, lng, timestamp: new Date().toISOString(),
        });
      }
      updateTecnicoGPS(userId, lat, lng);
    });

    // Unirse a sala de solicitud (con validación de acceso)
    socket.on('solicitud:join', async (solicitudId) => {
      try {
        const solicitud = await prisma.solicitud.findUnique({
          where: { id: solicitudId },
          select: {
            usuarioId: true,
            tecnicoId: true,
            postulaciones: { select: { tecnicoId: true } },
          },
        });
        if (!solicitud) return;

        const esCliente    = userRol === 'usuario' && solicitud.usuarioId === userId;
        const esTecnico    = userRol === 'tecnico' && solicitud.tecnicoId === userId;
        const esPostulante = userRol === 'tecnico' &&
          solicitud.postulaciones.some(p => p.tecnicoId === userId);

        if (esCliente || esTecnico || esPostulante) {
          socket.join('solicitud:' + solicitudId);
        }
      } catch { /* ignorar errores de BD */ }
    });

    socket.on('solicitud:leave', (solicitudId) => {
      socket.leave('solicitud:' + solicitudId);
    });

    // Toggle disponibilidad técnico
    socket.on('tecnico:disponible', (disponible) => {
      if (userRol !== 'tecnico') return;
      updateTecnicoDisponible(userId, disponible);
      socket.emit('tecnico:disponible:ok', { disponible });
    });

    socket.on('disconnect', () => {
      const m = userRol === 'tecnico' ? connectedTecnicos : connectedUsers;
      if (m.has(userId)) {
        m.get(userId).delete(socket.id);
        if (m.get(userId).size === 0) {
          m.delete(userId);
          if (userRol === 'tecnico') updateTecnicoDisponible(userId, false);
        }
      }
    });
  });
}

// Helpers internos — usan el singleton, sin disconnect
function updateTecnicoGPS(tecnicoId, lat, lng) {
  prisma.tecnico.update({
    where: { id: tecnicoId },
    data: { latitud: lat, longitud: lng, ubicacionAt: new Date() },
  }).catch(() => {});
}

function updateTecnicoDisponible(tecnicoId, disponible) {
  prisma.tecnico.update({
    where: { id: tecnicoId },
    data: { disponible },
  }).catch(() => {});
}

// Emitters
function emitirATecnico(tecnicoId, evento, data) {
  if (_io) _io.to('tecnico:' + tecnicoId).emit(evento, data);
}

function emitirAUsuario(usuarioId, evento, data) {
  if (_io) _io.to('usuario:' + usuarioId).emit(evento, data);
}

function emitirATecnicosDisponibles(tecnicoIds, evento, data) {
  if (!_io) return;
  tecnicoIds.forEach(id => {
    if (connectedTecnicos.has(id)) _io.to('tecnico:' + id).emit(evento, data);
  });
}

function emitirASolicitud(solicitudId, evento, data) {
  if (_io) _io.to('solicitud:' + solicitudId).emit(evento, data);
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
