require('dotenv').config();
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const { generalLimiter } = require('./middleware/rateLimiter');
const { initSocket, getIo } = require('./services/socketService');

// ── Rutas ─────────────────────────────────────────────
const authRoutes        = require('./routes/auth');
const solicitudRoutes   = require('./routes/solicitudes');
const postulacionRoutes = require('./routes/postulaciones');
const pagoRoutes        = require('./routes/pagos');
const ratingRoutes      = require('./routes/ratings');

const app = express();
const server = http.createServer(app);

// ── Inicializar Socket.io ─────────────────────────────
const io = initSocket(server);

// ── Middleware global ─────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(generalLimiter);

// Inyectar io en cada request para que los controllers puedan emitir eventos
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ── Rutas de la API ───────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/solicitudes',   solicitudRoutes);
app.use('/api/postulaciones', postulacionRoutes);
app.use('/api/pagos',         pagoRoutes);
app.use('/api/ratings',       ratingRoutes);

// ── Health check ──────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    entorno: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// ── 404 ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

// ── Error handler global ──────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : err.message
  });
});

// ── Iniciar servidor ──────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║   🔧 FixYa Backend                    ║
║   Puerto: ${PORT}                        ║
║   Entorno: ${(process.env.NODE_ENV || 'development').padEnd(10)}            ║
╚═══════════════════════════════════════╝
  `);
});

module.exports = { app, server };
