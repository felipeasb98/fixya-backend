const { verifyAccessToken } = require('../utils/jwt');

const connectedUsers = new Map();
const connectedTecnicos = new Map();
let _io;

function initSocket(io) {
  _io = io;

  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token
      ? socket.handshake.auth.token
      : socket.handshake.query && socket.handshake.query.token;
    if (!token) return next(new Error('Token requerido'));
    try {
      const payload = verifyAccessToken(token);
      socket.userId = payload.id;
      socket.userRol = payload.rol;
      next();
    } catch (e) {
      next(new Error('Token invalido'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    const userRol = socket.userRol;

    const map = userRol === 'tecnico' ? connectedTecnicos : connectedUsers;
    if (!map.has(userId)) map.set(userId, new Set());
    map.get(userId).add(socket.id);
    socket.join(userRol + ':' + userId);

    socket.on('tecnico:gps', function(data) {
      if (userRol !== 'tecnico') return;
      const lat = data.lat, lng = data.lng, solicitudId = data.solicitudId;
      if (solicitudId) {
        io.to('solicitud:' + solicitudId).emit('tecnico:ubicacion', {
          tecnicoId: userId, lat: lat, lng: lng, timestamp: new Date().toISOString(),
        });
      }
      updateTecnicoGPS(userId, lat, lng);
    });

    socket.on('solicitud:join', function(solicitudId) {
      socket.join('solicitud:' + solicitudId);
    });

    socket.on('solicitud:leave', function(solicitudId) {
      socket.leave('solicitud:' + solicitudId);
    });

    socket.on('tecnico:disponible', function(disponible) {
      if (userRol !== 'tecnico') return;
      updateTecnicoDisponible(userId, disponible);
      socket.emit('tecnico:disponible:ok', { disponible: disponible });
    });

    socket.on('disconnect', function() {
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

function emitirATecnico(tecnicoId, evento, data) {
  if (_io) _io.to('tecnico:' + tecnicoId).emit(evento, data);
}

function emitirAUsuario(usuarioId, evento, data) {
  if (_io) _io.to('usuario:' + usuarioId).emit(evento, data);
}

function emitirATecnicosDisponibles(tecnicoIds, evento, data) {
  if (!_io) return;
  tecnicoIds.forEach(function(id) {
    if (connectedTecnicos.has(id)) _io.to('tecnico:' + id).emit(evento, data);
  });
}

function emitirASolicitud(solicitudId, evento, data) {
  if (_io) _io.to('solicitud:' + solicitudId).emit(evento, data);
}

function updateTecnicoGPS(tecnicoId, lat, lng) {
  try {
    const prisma = new (require('@prisma/client').PrismaClient)();
    prisma.tecnico.update({
      where: { id: tecnicoId },
      data: { latitud: lat, longitud: lng, ubicacionAt: new Date() },
    }).then(function() { prisma.$disconnect(); }).catch(function() { prisma.$disconnect(); });
  } catch(e) {}
}

function updateTecnicoDisponible(tecnicoId, disponible) {
  try {
    const prisma = new (require('@prisma/client').PrismaClient)();
    prisma.tecnico.update({
      where: { id: tecnicoId },
      data: { disponible: disponible },
    }).then(function() { prisma.$disconnect(); }).catch(function() { prisma.$disconnect(); });
  } catch(e) {}
}

module.exports = {
  initSocket: initSocket,
  emitirATecnico: emitirATecnico,
  emitirAUsuario: emitirAUsuario,
  emitirATecnicosDisponibles: emitirATecnicosDisponibles,
  emitirASolicitud: emitirASolicitud,
  connectedTecnicos: connectedTecnicos,
  connectedUsers: connectedUsers,
};
