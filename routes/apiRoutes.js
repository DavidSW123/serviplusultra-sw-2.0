const express = require('express');
const router  = express.Router();

const { autenticado, soloAdmin, adminODirector } = require('../middlewares/authMiddleware');

// --- Controllers (se irán incorporando en la Fase 2) ---
const usuariosController = require('../controllers/usuariosController');
const otController        = require('../controllers/otController');
const clientesController  = require('../controllers/clientesController');
const stockController     = require('../controllers/stockController');
const facturaController   = require('../controllers/facturaController');
const gastosController    = require('../controllers/gastosController');
const iaController        = require('../controllers/iaController');
const logController       = require('../controllers/logController');

// ============================================================
// USUARIOS
// ============================================================
router.post  ('/login',               usuariosController.login);
router.put   ('/usuarios/foto',       autenticado, usuariosController.actualizarFoto);
router.put   ('/usuarios/password',   autenticado, usuariosController.cambiarPassword);
router.post  ('/usuarios/tecnico',    adminODirector, usuariosController.crearTecnico);
router.get   ('/usuarios/nombres',    autenticado, usuariosController.getNombres);

// ============================================================
// CLIENTES
// ============================================================
router.get   ('/clientes',            autenticado,    clientesController.getAll);
router.post  ('/clientes',            autenticado,    clientesController.crear);
router.put   ('/clientes/:id/estado', soloAdmin,      clientesController.cambiarEstado);
router.put   ('/clientes/:id',        soloAdmin,      clientesController.editar);

// ============================================================
// ÓRDENES DE TRABAJO
// ============================================================
router.get   ('/ot',                       autenticado,    otController.getAll);
router.post  ('/ot',                       autenticado,    otController.crear);
router.put   ('/ot/:id',                   soloAdmin,      otController.editar);
router.put   ('/ot/:id/estado',            autenticado,    otController.cambiarEstado);
router.delete('/ot/:id',                   autenticado,    otController.eliminar);

// Adjuntos / Tickets de materiales
router.get   ('/ot/:id/adjuntos',          autenticado,    otController.getAdjuntos);
router.post  ('/ot/:id/adjuntos',          autenticado,    otController.addAdjunto);
router.post  ('/ot/:id/lineas_materiales', autenticado,    otController.addLineasMateriales);
router.delete('/ot/adjuntos/:id',          soloAdmin,      otController.deleteAdjunto);

// ============================================================
// FACTURAS
// ============================================================
router.post  ('/factura',             autenticado, facturaController.emitir);
router.post  ('/enviar-factura',      autenticado, facturaController.enviarEmail);
router.post  ('/test-email',          autenticado, facturaController.testEmail);

// ============================================================
// GASTOS SOCIOS (Splitwise)
// ============================================================
router.get   ('/gastos',     adminODirector, gastosController.getAll);
router.post  ('/gastos',     adminODirector, gastosController.crear);
router.delete('/gastos/:id', adminODirector, gastosController.eliminar);

// ============================================================
// STOCK DE MATERIALES
// ============================================================
router.get   ('/stock',  autenticado, stockController.getAll);
router.post  ('/stock',  autenticado, stockController.crear);

// ============================================================
// ESCÁNER IA
// ============================================================
router.post  ('/ia/escanear-ticket', autenticado, iaController.escanearTicket);

// ============================================================
// LOGS / AUDITORÍA
// ============================================================
router.get   ('/logs',            soloAdmin,   logController.getAll);
router.put   ('/logs/:id',        autenticado, logController.editar);
router.put   ('/logs/:id/resolver', soloAdmin, logController.resolver);

module.exports = router;
