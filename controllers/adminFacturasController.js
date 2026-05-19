const { db }           = require('../config/db');
const { registrarLog } = require('../utils/registrarLog');

/**
 * GET /api/admin/facturas/pendientes-eliminacion
 * Lista facturas con eliminacion_pendiente = 1.
 */
async function listarPendientes(req, res) {
    try {
        const { rows } = await db.execute(`
            SELECT f.id, f.numero_factura, f.fecha_emision, f.base_imponible, f.iva, f.total,
                   f.emails_enviados, f.aeat_estado, f.es_rectificativa,
                   f.ot_id, f.presupuesto_id,
                   ot.codigo_ot,
                   p.referencia AS presupuesto_ref,
                   c.nombre AS cliente_nombre
            FROM facturas f
            LEFT JOIN ordenes_trabajo ot ON ot.id = f.ot_id
            LEFT JOIN presupuestos    p  ON p.id  = f.presupuesto_id
            LEFT JOIN clientes        c  ON c.id  = COALESCE(ot.cliente_id, p.cliente_id)
            WHERE f.eliminacion_pendiente = 1
            ORDER BY f.id DESC
        `);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * POST /api/admin/facturas/:id/aprobar-eliminacion
 * Verifica que la factura tiene eliminacion_pendiente = 1 y la borra.
 * El gap-fill de correlación lo hace generarNumeroFactura() al emitir la próxima.
 * Si la factura está vinculada a un presupuesto, limpia también el campo correspondiente.
 */
async function aprobarEliminacion(req, res) {
    const { id }  = req.params;
    const usuario = req.usuario?.username || req.headers['x-user'] || 'desconocido';
    try {
        const { rows } = await db.execute({
            sql:  `SELECT id, numero_factura, presupuesto_id, eliminacion_pendiente
                   FROM facturas WHERE id=?`,
            args: [id]
        });
        if (!rows[0]) return res.status(404).json({ error: 'Factura no encontrada' });
        const f = rows[0];
        if (!f.eliminacion_pendiente) {
            return res.status(400).json({ error: 'Esta factura no tiene una solicitud de eliminación pendiente.' });
        }

        // Limpia campos del presupuesto que apunten a esta factura (por número)
        if (f.presupuesto_id && f.numero_factura) {
            await db.execute({
                sql:  `UPDATE presupuestos
                       SET proforma_numero      = CASE WHEN proforma_numero      = ? THEN NULL ELSE proforma_numero      END,
                           proforma_total       = CASE WHEN proforma_numero      = ? THEN NULL ELSE proforma_total       END,
                           factura_final_numero = CASE WHEN factura_final_numero = ? THEN NULL ELSE factura_final_numero END
                       WHERE id=?`,
                args: [f.numero_factura, f.numero_factura, f.numero_factura, f.presupuesto_id]
            });
        }

        // Borrado real: libera el número para el gap-fill
        await db.execute({ sql: `DELETE FROM facturas WHERE id=?`, args: [id] });

        await registrarLog(usuario, 'Aprobar eliminación factura', `Factura ${f.numero_factura || id}`, { id, numero: f.numero_factura }, 'APROBADO');
        res.json({ ok: true, mensaje: 'Factura eliminada.', numero_eliminado: f.numero_factura });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * POST /api/admin/facturas/:id/rechazar-eliminacion
 * Pone eliminacion_pendiente = 0.
 */
async function rechazarEliminacion(req, res) {
    const { id }  = req.params;
    const usuario = req.usuario?.username || req.headers['x-user'] || 'desconocido';
    try {
        const { rows } = await db.execute({
            sql:  `SELECT id, numero_factura, eliminacion_pendiente FROM facturas WHERE id=?`,
            args: [id]
        });
        if (!rows[0]) return res.status(404).json({ error: 'Factura no encontrada' });
        const f = rows[0];
        if (!f.eliminacion_pendiente) {
            return res.status(400).json({ error: 'Esta factura no tiene una solicitud de eliminación pendiente.' });
        }

        await db.execute({
            sql:  `UPDATE facturas SET eliminacion_pendiente=0 WHERE id=?`,
            args: [id]
        });

        await registrarLog(usuario, 'Rechazar eliminación factura', `Factura ${f.numero_factura || id}`, { id, numero: f.numero_factura }, 'RECHAZADO');
        res.json({ ok: true, mensaje: 'Solicitud de eliminación rechazada.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

module.exports = { listarPendientes, aprobarEliminacion, rechazarEliminacion };
