const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const soporteController = require('../controllers/soporteController');
const { authenticate } = require('../middlewares/authenticate');
const { soloRol } = require('../middlewares/soloRol');
const { AppError } = require('../utils/AppError');

function soloAdmin(req, _res, next) {
  if (!req.user?.esAdmin) return next(new AppError('Solo accesible para administradores', 403));
  next();
}

const emailVal = body('email').isEmail().normalizeEmail({ gmail_remove_dots: false }).withMessage('Email invalido');
const passVal = body('password').isLength({ min: 8 }).withMessage('Minimo 8 caracteres');

router.post('/login', [
  emailVal,
  body('password').notEmpty().withMessage('Contrasena requerida'),
], soporteController.login);

router.post('/_bootstrap_admin', soporteController.bootstrapAdmin);

router.use(authenticate, soloRol('soporte'));

router.get('/dashboard', soporteController.dashboard);

router.get('/tarifas', soporteController.listarTarifas);
router.patch('/tarifas/:id/decidir', [
  body('decision').isIn(['aprobar', 'rechazar']).withMessage('decision debe ser aprobar o rechazar'),
], soporteController.decidirTarifa);

router.get('/disputas', soporteController.listarDisputas);
router.patch('/disputas/:id/resolver', [
  body('resolucion').isIn(['liberar', 'reembolso_total', 'reembolso_parcial']).withMessage('resolución inválida'),
  body('montoReembolso').optional().isFloat({ min: 1 }),
], soporteController.resolverDisputa);

router.get('/solicitudes', soporteController.listarSolicitudes);
router.get('/solicitudes/:id', soporteController.obtenerSolicitud);

router.get('/tecnicos', soporteController.listarTecnicos);
router.get('/usuarios', soporteController.listarUsuarios);

router.get('/cuentas', soloAdmin, soporteController.listarCuentas);
router.post('/cuentas', soloAdmin, [
  body('nombre').trim().notEmpty().withMessage('Nombre requerido'),
  emailVal,
  passVal,
], soporteController.crearCuenta);
router.patch('/cuentas/:id', soloAdmin, soporteController.actualizarCuenta);

module.exports = router;
