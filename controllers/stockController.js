const { db } = require('../config/db');

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
        res.status(500).json({ error: e.message });
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
        res.status(500).json({ error: e.message });
    }
}

module.exports = { getAll, crear };
