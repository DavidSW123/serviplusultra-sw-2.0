const { db } = require('../config/db');

/**
 * GET /api/gastos
 * Devuelve todos los gastos de socios, más recientes primero.
 * Requiere rol admin o director (guard en ruta).
 */
async function getAll(req, res) {
    try {
        const result = await db.execute(
            `SELECT * FROM gastos_socios ORDER BY id DESC`
        );
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * POST /api/gastos
 * Body: { pagador, concepto, importe, implicados[] }
 * Requiere rol admin o director (guard en ruta).
 */
async function crear(req, res) {
    const { pagador, concepto, importe, implicados } = req.body;
    const fecha  = new Date().toLocaleString('es-ES');
    const impStr = Array.isArray(implicados)
        ? implicados.join(',')
        : 'Giancarlo,David,Kevin';

    try {
        await db.execute({
            sql:  `INSERT INTO gastos_socios (pagador, concepto, importe, fecha, implicados)
                   VALUES (?, ?, ?, ?, ?)`,
            args: [pagador, concepto, parseFloat(importe), fecha, impStr]
        });
        res.json({ mensaje: 'Gasto registrado correctamente.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * DELETE /api/gastos/:id
 * Requiere rol admin o director (guard en ruta).
 */
async function eliminar(req, res) {
    try {
        await db.execute({
            sql:  `DELETE FROM gastos_socios WHERE id = ?`,
            args: [req.params.id]
        });
        res.json({ mensaje: 'Gasto eliminado.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

module.exports = { getAll, crear, eliminar };
