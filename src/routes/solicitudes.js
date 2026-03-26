const router = require('express').Router();
const { body, query: qv } = require('express-validator');
const { authMiddleware, soloCliente, soloTecnico } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  crearSolicitud, obtenerSolicitud,
  listarSolicitudes, cambiarEstado,
  solicitudesDisponibles
} = require('../controllers/solicitudController');

const rubrosValidos = ['gasfiteria', 'electricidad', 'cerrajeria', 'handyman', 'pintura'];

// POST /solicitudes — cliente crea solicitud
router.post('/', authMiddleware, soloCliente, [
  body('rubro').isIn(rubrosValidos).withMessage('Rubro no válido'),
  body('trabajoNombre').notEmpty().withMessage('El nombre del trabajo es requerido'),
  body('urgencia').isIn(['ahora', 'hoy', 'programar']).withMessage('Urgencia no válida'),
  body('latitud').isFloat({ min: -90, max: 90 }).withMessage('Latitud inválida'),
  body('longitud').isFloat({ min: -180, max: 180 }).withMessage('Longitud inválida'),
  body('direccion').notEmpty().withMessage('La dirección es requerida'),
], validate, crearSolicitud);

// GET /solicitudes/disponibles — técnico ve trabajos cercanos
router.get('/disponibles', authMiddleware, soloTecnico, [
  qv('latitud').optional().isFloat(),
  qv('longitud').optional().isFloat(),
  qv('radio').optional().isFloat({ min: 1, max: 50 }),
], validate, solicitudesDisponibles);

// GET /solicitudes — historial
router.get('/', authMiddleware, listarSolicitudes);

// GET /solicitudes/:id
router.get('/:id', authMiddleware, obtenerSolicitud);

// PATCH /solicitudes/:id/estado
router.patch('/:id/estado', authMiddleware, [
  body('estado').isIn(['en_camino', 'en_trabajo', 'completado', 'cancelado']).withMessage('Estado no válido'),
], validate, cambiarEstado);

module.exports = router;
