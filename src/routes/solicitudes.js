const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');
const ctrl = require('../controllers/solicitudesController');
const { authenticate } = require('../middlewares/authenticate');
const { soloRol } = require('../middlewares/soloRol');

router.post('/', authenticate, soloRol('usuario'), [
  body('trabajo').trim().notEmpty().withMessage('Tipo de trabajo requerido'),
  body('rubroId').notEmpty().withMessage('Rubro requerido'),
  body('moBase').isFloat({ min: 0 }),
  body('totalEstimado').isFloat({ min: 0 }),
], ctrl.crear);

router.get('/mis-solicitudes', authenticate, soloRol('usuario'), ctrl.misSolicitudes);
router.get('/disponibles', authenticate, soloRol('tecnico'), ctrl.disponibles);
router.get('/:id', authenticate, ctrl.obtener);

router.post('/:id/elegir-tecnico', authenticate, soloRol('usuario'), [
  body('tecnicoId').notEmpty(),
], ctrl.elegirTecnico);

router.patch('/:id/en-camino', authenticate, soloRol('tecnico'), ctrl.enCamino);
router.patch('/:id/inicio-trabajo', authenticate, soloRol('tecnico'), ctrl.inicioTrabajo);
router.patch('/:id/trabajo-terminado', authenticate, soloRol('tecnico'), ctrl.trabajoTerminado);
router.patch('/:id/confirmar', authenticate, soloRol('usuario'), ctrl.confirmarTrabajo);

router.post('/:id/mod-tarifa', authenticate, soloRol('tecnico'), [
  body('moModificada').isFloat({ min: 0 }),
  body('motivoModTarifa').trim().notEmpty(),
], ctrl.solicitarModTarifa);

router.patch('/:id/resp-tarifa', authenticate, soloRol('usuario'), [
  body('decision').isIn(['aceptar', 'rechazar']),
], ctrl.responderModTarifa);

router.patch('/:id/cancelar', authenticate, [
  body('motivo').trim().notEmpty(),
], ctrl.cancelar);

module.exports = router;
