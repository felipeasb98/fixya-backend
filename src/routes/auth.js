const router = require('express').Router();
const { body } = require('express-validator');
const { authLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
const { authMiddleware } = require('../middleware/auth');
const {
  registroCliente, registroTecnico,
  login, refreshToken, perfil
} = require('../controllers/authController');

// Validaciones reutilizables
const validarPassword = body('password')
  .isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres');

const validarEmail = body('email')
  .isEmail().withMessage('Email inválido')
  .normalizeEmail();

const validarTelefono = body('telefono')
  .matches(/^\+?56\s?9\s?\d{4}\s?\d{4}$/).withMessage('Teléfono chileno inválido (+56 9 XXXX XXXX)');

// POST /auth/registro/cliente
router.post('/registro/cliente', authLimiter, [
  body('nombre').notEmpty().trim().withMessage('El nombre es requerido'),
  validarEmail,
  validarTelefono,
  validarPassword,
], validate, registroCliente);

// POST /auth/registro/tecnico
router.post('/registro/tecnico', authLimiter, [
  body('nombre').notEmpty().trim().withMessage('El nombre es requerido'),
  validarEmail,
  validarTelefono,
  validarPassword,
  body('rubros').isArray({ min: 1 }).withMessage('Selecciona al menos un rubro'),
  body('rut').notEmpty().withMessage('El RUT es requerido'),
  body('banco').notEmpty().withMessage('El banco es requerido'),
  body('numeroCuenta').notEmpty().withMessage('El número de cuenta es requerido'),
], validate, registroTecnico);

// POST /auth/login
router.post('/login', authLimiter, [
  validarEmail,
  body('password').notEmpty().withMessage('La contraseña es requerida'),
], validate, login);

// POST /auth/refresh
router.post('/refresh', [
  body('refreshToken').notEmpty().withMessage('Refresh token requerido'),
], validate, refreshToken);

// GET /auth/me
router.get('/me', authMiddleware, perfil);

module.exports = router;
