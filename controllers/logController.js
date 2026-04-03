const { db } = require('../config/db');
const { validarOT } = require('../utils/validaciones');

/**
 * GET /api/logs
 * Devuelve todos los logs, más recientes primero.
 * Solo admin (guard en ruta).
 */
async function getAll(req, res) {
    try {
        const result = await db.execute(`SELECT * FROM logs ORDER BY id DESC`);
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * PUT /api/logs/:id
 * Body: { nuevosDatos }
 * Permite al director editar los datos de una petición pendiente antes de que el admin la resuelva.
 */
async function editar(req, res) {
    try {
        const { nuevosDatos } = req.body;

        if (nuevosDatos.codigo_ot) {
            const err = validarOT(nuevosDatos);
            if (err) return res.status(400).json({ error: err });
        }

        await db.execute({
            sql:  `UPDATE logs SET datos = ? WHERE id = ?`,
            args: [JSON.stringify(nuevosDatos), req.params.id]
        });
        res.json({ mensaje: 'Petición actualizada.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * PUT /api/logs/:id/resolver
 * Body: { resolucion: 'APROBADO' | 'RECHAZADO', motivo? }
 * Solo admin (guard en ruta).
 *
 * Ejecuta la acción pendiente según el tipo de log:
 *   - 'Añadir OT'   → INSERT en ordenes_trabajo + adjuntos de materiales
 *   - 'Eliminar OT' → DELETE en cadena (facturas, adjuntos, OT)
 *   - 'Editar OT'   → UPDATE estado de la OT
 */
async function resolver(req, res) {
    const { id } = req.params;
    const { resolucion, motivo } = req.body;

    try {
        const rLog = await db.execute({ sql: `SELECT * FROM logs WHERE id = ?`, args: [id] });
        if (rLog.rows.length === 0) return res.status(404).json({ error: 'Log no encontrado' });

        const log = rLog.rows[0];

        if (resolucion === 'RECHAZADO') {
            await db.execute({
                sql:  `UPDATE logs SET estado = 'RECHAZADO', referencia = ? WHERE id = ?`,
                args: [`Rechazado: ${motivo}`, id]
            });
            return res.json({ mensaje: 'Petición rechazada.' });
        }

        const datos = JSON.parse(log.datos);

        if (log.accion === 'Añadir OT') {
            const estado = datos.fecha_completada ? 'HECHO' : 'PENDIENTE';
            const rIn = await db.execute({
                sql:  `INSERT INTO ordenes_trabajo
                           (codigo_ot, fecha_encargo, fecha_completada, horas, num_tecnicos,
                            marca, tipo_urgencia, materiales_precio, estado, cliente_id, tecnicos_nombres)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                    datos.codigo_ot, datos.fecha_encargo, datos.fecha_completada || null,
                    datos.horas, datos.num_tecnicos, datos.marca, datos.tipo_urgencia,
                    datos.materiales_precio, estado, datos.cliente_id || null,
                    datos.tecnicos_nombres || ''
                ]
            });

            const newOtId = Number(rIn.lastInsertRowid);

            if (datos.lineas_materiales?.length > 0) {
                const fecha = new Date().toLocaleString('es-ES');
                for (const mat of datos.lineas_materiales) {
                    const desc = mat.is_stock
                        ? `[STOCK] ${mat.descripcion} (Cant: ${mat.cantidad})`
                        : `${mat.descripcion} (Cant: ${mat.cantidad})`;
                    await db.execute({
                        sql:  `INSERT INTO ot_adjuntos (ot_id, imagen, importe, descripcion, fecha) VALUES (?, ?, ?, ?, ?)`,
                        args: [newOtId, mat.imagen || '', mat.importe, desc, fecha]
                    });
                    if (mat.is_stock && mat.stock_id) {
                        await db.execute({
                            sql:  `UPDATE stock_materiales SET cantidad = cantidad - ? WHERE id = ?`,
                            args: [mat.cantidad, mat.stock_id]
                        });
                    }
                }
            }

        } else if (log.accion === 'Eliminar OT') {
            await db.execute({ sql: `DELETE FROM facturas    WHERE ot_id = ?`, args: [datos.id] });
            await db.execute({ sql: `DELETE FROM ot_adjuntos WHERE ot_id = ?`, args: [datos.id] });
            await db.execute({ sql: `DELETE FROM ordenes_trabajo WHERE id = ?`, args: [datos.id] });

        } else if (log.accion === 'Editar OT') {
            await db.execute({
                sql:  `UPDATE ordenes_trabajo SET estado = ? WHERE id = ?`,
                args: [datos.nuevoEstado, datos.id]
            });
        }

        await db.execute({
            sql:  `UPDATE logs SET estado = 'APROBADO', referencia = 'APROBADO' WHERE id = ?`,
            args: [id]
        });
        res.json({ mensaje: 'Petición ejecutada y aprobada.' });

    } catch (e) {
        res.status(500).json({ error: `Error resolviendo petición: ${e.message}` });
    }
}

module.exports = { getAll, editar, resolver };
