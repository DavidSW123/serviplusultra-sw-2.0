const { db } = require('../config/db');

const { errorServidor } = require('../utils/responder');
/**
 * GET /api/stock
 * Devuelve todos los materiales en stock, ordenados por descripción.
 */
async function getAll(req, res) {
    try {
        const result = await db.execute(
            `SELECT * FROM stock_materiales ORDER BY descripcion ASC`
        );
        res.json(result.rows);
    } catch (e) {
        errorServidor(res, e);
    }
}

/**
 * POST /api/stock
 * Body: { descripcion, cantidad, precio_unidad, imagen }
 */
async function crear(req, res) {
    const { descripcion, cantidad, precio_unidad, imagen } = req.body;
    const fecha = new Date().toLocaleString('es-ES');

    try {
        await db.execute({
            sql:  `INSERT INTO stock_materiales (descripcion, cantidad, precio_unidad, imagen, fecha)
                   VALUES (?, ?, ?, ?, ?)`,
            args: [descripcion, parseFloat(cantidad), parseFloat(precio_unidad), imagen || '', fecha]
        });
        res.json({ mensaje: 'Material añadido al stock.' });
    } catch (e) {
        errorServidor(res, e);
    }
}

module.exports = { getAll, crear };
