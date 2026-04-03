const { db } = require('../config/db');

/**
 * GET /api/clientes
 * Devuelve todos los clientes ordenados por nombre.
 */
async function getAll(req, res) {
    try {
        const result = await db.execute(`SELECT * FROM clientes ORDER BY nombre ASC`);
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * POST /api/clientes
 * Body: { nombre, nif, direccion, email, telefono, logo }
 *
 * Lógica de aprobación:
 *   - admin    → el cliente entra directamente como APROBADO
 *   - director → entra como PENDIENTE (Giancarlo/David deben aprobar)
 */
async function crear(req, res) {
    const { nombre, nif, direccion, email, telefono, logo } = req.body;
    const estado = req.usuario.rol === 'admin' ? 'APROBADO' : 'PENDIENTE';

    try {
        await db.execute({
            sql:  `INSERT INTO clientes (nombre, nif, direccion, email, telefono, logo, estado)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: [nombre, nif, direccion, email, telefono, logo || '', estado]
        });

        const mensaje = estado === 'APROBADO'
            ? 'Cliente añadido a la BBDD'
            : 'Petición enviada a Giancarlo';

        res.json({ mensaje });
    } catch (e) {
        res.status(500).json({ error: 'Error al crear cliente' });
    }
}

/**
 * PUT /api/clientes/:id/estado
 * Body: { estado }   ('APROBADO' | 'RECHAZADO')
 * Solo admin (guard aplicado en la ruta).
 */
async function cambiarEstado(req, res) {
    try {
        await db.execute({
            sql:  `UPDATE clientes SET estado = ? WHERE id = ?`,
            args: [req.body.estado, req.params.id]
        });
        res.json({ mensaje: `Cliente ${req.body.estado}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * PUT /api/clientes/:id
 * Body: { nombre, nif, direccion, email, telefono, logo }
 * Solo admin (guard aplicado en la ruta).
 */
async function editar(req, res) {
    const { nombre, nif, direccion, email, telefono, logo } = req.body;
    try {
        await db.execute({
            sql:  `UPDATE clientes SET nombre = ?, nif = ?, direccion = ?, email = ?, telefono = ?, logo = ?
                   WHERE id = ?`,
            args: [nombre, nif, direccion, email, telefono, logo || '', req.params.id]
        });
        res.json({ mensaje: '✅ Cliente actualizado correctamente.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

module.exports = { getAll, crear, cambiarEstado, editar };
