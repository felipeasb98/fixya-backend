const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

let io;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || '*',
      methods: ['GET', 'POST']
    }
  });

  // Middleware: verificar JWT en cada conexión de socket
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Token requerido'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const result = await query(
        'SELECT id, rol FROM usuarios WHERE id = $1 AND activo = true',
        [decoded.id]
      );
      if (result.rows.length === 0) return next(new Error('Usuario no válido'));

      socket.userId = result.rows[0].id;
      socket.userRol = result.rows[0].rol;
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Socket conectado: ${socket.userId} (${socket.userRol})`);

    // Unirse al canal personal del usuario
    socket.join(`usuario:${socket.userId}`);

    // ─── Técnico: unirse a canales de rubros activos ───
    socket.on('suscribir_rubros', async (rubros) => {
      if (socket.userRol !== 'tecnico') return;
      if (!Array.isArray(rubros)) return;

      rubros.forEach(rubro => {
        socket.join(`zona:${rubro}`);
        console.log(`  📡 Técnico ${socket.userId} suscrito a zona:${rubro}`);
      });
    });

    // ─── Unirse al room de una solicitud específica ────
    socket.on('unirse_solicitud', async (solicitudId) => {
      // Verificar que el usuario tiene acceso a esta solicitud
      const result = await query(
        'SELECT cliente_id, tecnico_id FROM solicitudes WHERE id = $1',
        [solicitudId]
      );
      if (result.rows.length === 0) return;

      const sol = result.rows[0];
      if (sol.cliente_id === socket.userId || sol.tecnico_id === socket.userId) {
        socket.join(`solicitud:${solicitudId}`);
        console.log(`  📍 Usuario ${socket.userId} unido a solicitud:${solicitudId}`);
      }
    });

    // ─── GPS: técnico envía su ubicación en tiempo real ─
    socket.on('ubicacion_tecnico', async ({ solicitudId, latitud, longitud }) => {
      if (socket.userRol !== 'tecnico') return;

      // Actualizar ubicación en DB
      await query(
        `UPDATE tecnicos SET ultima_lat = $1, ultima_lng = $2, ultima_ubicacion_en = NOW()
         WHERE usuario_id = $3`,
        [latitud, longitud, socket.userId]
      );

      // Enviar al cliente de esa solicitud
      socket.to(`solicitud:${solicitudId}`).emit('ubicacion_tecnico', {
        solicitudId, latitud, longitud, timestamp: new Date()
      });
    });

    // ─── Mensaje de chat dentro de una solicitud ───────
    socket.on('mensaje_solicitud', async ({ solicitudId, texto }) => {
      const msg = {
        de: socket.userId,
        rol: socket.userRol,
        texto,
        timestamp: new Date()
      };
      io.to(`solicitud:${solicitudId}`).emit('mensaje_solicitud', msg);
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Socket desconectado: ${socket.userId}`);
    });
  });

  return io;
};

const getIo = () => {
  if (!io) throw new Error('Socket.io no inicializado');
  return io;
};

module.exports = { initSocket, getIo };
