const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { authenticate } = require('../middlewares/authenticate');

const emailVal = body('email').isEmail().normalizeEmail().withMessage('Email invalido');
const passVal = body('password').isLength({ min: 8 }).withMessage('Minimo 8 caracteres');

router.post('/registro/usuario', [
  body('nombre').trim().notEmpty().withMessage('Nombre requerido'),
  emailVal,
  passVal,
  body('telefono').trim().notEmpty().withMessage('Telefono requerido'),
], authController.registroUsuario);

router.post('/registro/tecnico', [
  body('nombre').trim().notEmpty(),
  emailVal,
  passVal,
  body('telefono').trim().notEmpty(),
  body('rut').trim().notEmpty().withMessage('RUT requerido'),
  body('rubros').isArray({ min: 1 }).withMessage('Selecciona al menos un rubro'),
  body('banco').trim().notEmpty().withMessage('Banco requerido'),
  body('numeroCuenta').trim().notEmpty().withMessage('Numero de cuenta requerido'),
  body('tipoCuenta').trim().notEmpty(),
], authController.registroTecnico);

router.post('/login', [
  emailVal,
  body('password').notEmpty().withMessage('Contrasena requerida'),
  body('rol').isIn(['usuario', 'tecnico']).withMessage('Rol invalido'),
], authController.login);

router.post('/refresh', authController.refresh);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);

module.exports = router;
