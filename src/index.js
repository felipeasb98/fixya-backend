require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { initSocket } = require('./services/socketService');
const { errorHandler } = require('./middlewares/errorHandler');
const { rateLimiter } = require('./middlewares/rateLimiter');

const authRoutes = require('./routes/auth');
const usuariosRoutes = require('./routes/usuarios');
const tecnicosRoutes = require('./routes/tecnicos');
const solicitudesRoutes = require('./routes/solicitudes');
const postulacionesRoutes = require('./routes/postulaciones');
const pagosRoutes = require('./routes/pagos');
const ratingsRoutes = require('./routes/ratings');
const notificacionesRoutes = require('./routes/notificaciones');
const uploadRoutes = require('./routes/upload');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || '*', methods: ['GET', 'POST'], credentials: true },
});
initSocket(io);

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, _res, next) => { req.io = io; next(); });

app.use('/api/auth', rateLimiter({ max: 10, windowMs: 15 * 60 * 1000 }));
app.use('/api', rateLimiter({ max: 200, windowMs: 15 * 60 * 1000 }));

app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/tecnicos', tecnicosRoutes);
app.use('/api/solicitudes', solicitudesRoutes);
app.use('/api/postulaciones', postulacionesRoutes);
app.use('/api/pagos', pagosRoutes);
app.use('/api/ratings', ratingsRoutes);
app.use('/api/notificaciones', notificacionesRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', env: process.env.NODE_ENV, timestamp: new Date().toISOString() });
});

app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🔧 FixYa Backend corriendo en puerto ${PORT}`);
  console.log(`📡 Entorno: ${process.env.NODE_ENV}`);
  console.log(`🔗 Health: http://localhost:${PORT}/health\n`);
});

module.exports = { app, server, io };