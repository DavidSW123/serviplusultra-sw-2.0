const { db }           = require('../config/db');
const { validarOT }    = require('../utils/validaciones');
const { registrarLog } = require('../utils/registrarLog');

// ─────────────────────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────────────────────

/** Inserta las líneas de materiales y descuenta stock si procede. */
async function _insertarMateriales(otId, lineas) {
    const fecha = new Date().toLocaleString('es-ES');
    for (const mat of lineas) {
        const desc = mat.is_stock
            ? `[STOCK] ${mat.descripcion} (Cant: ${mat.cantidad})`
            : `${mat.descripcion} (Cant: ${mat.cantidad})`;

        await db.execute({
            sql:  `INSERT INTO ot_adjuntos (ot_id, imagen, importe, descripcion, fecha)
                   VALUES (?, ?, ?, ?, ?)`,
            args: [otId, mat.imagen || '', mat.importe, desc, fecha]
        });

        if (mat.is_stock && mat.stock_id) {
            await db.execute({
                sql:  `UPDATE stock_materiales SET cantidad = cantidad - ? WHERE id = ?`,
                args: [mat.cantidad, mat.stock_id]
            });
        }
    }
}

// ─────────────────────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────────────────────

/**
 * GET /api/ot
 * Devuelve todas las OTs, más recientes primero.
 */
async function getAll(req, res) {
    try {
        const result = await db.execute(
            `SELECT * FROM ordenes_trabajo ORDER BY id DESC`
        );
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * POST /api/ot
 * Body: { codigo_ot, fecha_encargo, fecha_completada, horas, num_tecnicos,
 *         marca, tipo_urgencia, cliente_id, tecnicos_nombres, lineas_materiales[] }
 *
 * Flujo de roles:
 *   - director → no inserta, manda a logs como PENDIENTE para aprobación del admin
 *   - admin    → inserta directamente y registra log APROBADO
 */
async function crear(req, res) {
    const { usuario } = req;
    const datos = req.body;

    const err = validarOT(datos);
    if (err) return res.status(400).json({ error: err });

    // Calculamos el total de materiales desde las líneas
    datos.materiales_precio = datos.lineas_materiales?.length > 0
        ? datos.lineas_materiales.reduce((acc, m) => acc + m.importe, 0)
        : 0;

    // Director: encola para aprobación
    if (usuario.rol === 'director') {
        await registrarLog(usuario.username, 'Añadir OT', datos.codigo_ot, datos, 'PENDIENTE');
        return res.json({ mensaje: 'OT enviada a Giancarlo para su aprobación.' });
    }

    // Admin: inserta directamente
    const estado = datos.fecha_completada ? 'HECHO' : 'PENDIENTE';
    try {
        const r = await db.execute({
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

        const newOtId = Number(r.lastInsertRowid);
        if (datos.lineas_materiales?.length > 0) {
            await _insertarMateriales(newOtId, datos.lineas_materiales);
        }

        await registrarLog(usuario.username, 'Añadir OT', `OT: ${datos.codigo_ot}`, datos, 'APROBADO');
        res.json({ mensaje: 'OT y materiales guardados correctamente.', id: newOtId });

    } catch (e) {
        if (e.message?.includes('UNIQUE')) {
            res.status(400).json({ error: 'Ese código de OT ya está registrado.' });
        } else {
            res.status(500).json({ error: e.message });
        }
    }
}

/**
 * PUT /api/ot/:id
 * Body: { codigo_ot, fecha_encargo, fecha_completada, horas, num_tecnicos,
 *         marca, tipo_urgencia, cliente_id, tecnicos_nombres }
 * Solo admin (guard en ruta).
 */
async function editar(req, res) {
    const { id } = req.params;
    const datos  = req.body;

    const err = validarOT(datos);
    if (err) return res.status(400).json({ error: err });

    try {
        await db.execute({
            sql:  `UPDATE ordenes_trabajo
                   SET codigo_ot = ?, fecha_encargo = ?, fecha_completada = ?, horas = ?,
                       num_tecnicos = ?, marca = ?, tipo_urgencia = ?, cliente_id = ?,
                       tecnicos_nombres = ?
                   WHERE id = ?`,
            args: [
                datos.codigo_ot, datos.fecha_encargo, datos.fecha_completada || null,
                datos.horas, datos.num_tecnicos, datos.marca, datos.tipo_urgencia,
                datos.cliente_id || null, datos.tecnicos_nombres || '', id
            ]
        });

        await registrarLog(
            req.usuario.username,
            'Editar OT',
            `OT: ${datos.codigo_ot} modificada directamente`,
            datos,
            'APROBADO'
        );
        res.json({ mensaje: '✅ Orden de Trabajo actualizada con éxito.' });

    } catch (e) {
        if (e.message?.includes('UNIQUE')) {
            res.status(400).json({ error: 'Ese código de OT ya está registrado.' });
        } else {
            res.status(500).json({ error: e.message });
        }
    }
}

/**
 * PUT /api/ot/:id/estado
 * Body: { estado }
 *
 * Flujo de roles:
 *   - director → encola en logs como PENDIENTE
 *   - admin    → actualiza directamente
 */
async function cambiarEstado(req, res) {
    const { usuario }  = req;
    const { id }       = req.params;
    const { estado }   = req.body;

    if (usuario.rol === 'director') {
        await registrarLog(
            usuario.username,
            'Editar OT',
            `Cambio estado OT ID: ${id}`,
            { id, nuevoEstado: estado },
            'PENDIENTE'
        );
        return res.json({ mensaje: 'Petición enviada a Giancarlo.' });
    }

    try {
        await db.execute({
            sql:  `UPDATE ordenes_trabajo SET estado = ? WHERE id = ?`,
            args: [estado, id]
        });
        await registrarLog(
            usuario.username,
            'Editar OT',
            `Estado cambiado OT: ${id}`,
            { id, nuevoEstado: estado },
            'APROBADO'
        );
        res.json({ mensaje: 'Estado actualizado.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * DELETE /api/ot/:id
 *
 * Flujo de roles:
 *   - director → encola en logs como PENDIENTE
 *   - admin    → borra en cadena (facturas → adjuntos → OT)
 */
async function eliminar(req, res) {
    const { usuario } = req;
    const { id }      = req.params;

    if (usuario.rol === 'director') {
        await registrarLog(usuario.username, 'Eliminar OT', `Borrado OT ID: ${id}`, { id }, 'PENDIENTE');
        return res.json({ mensaje: 'Petición enviada a Giancarlo.' });
    }

    try {
        await db.execute({ sql: `DELETE FROM facturas        WHERE ot_id = ?`, args: [id] });
        await db.execute({ sql: `DELETE FROM ot_adjuntos     WHERE ot_id = ?`, args: [id] });
        await db.execute({ sql: `DELETE FROM ordenes_trabajo WHERE id    = ?`, args: [id] });

        await registrarLog(usuario.username, 'Eliminar OT', `OT: ${id} eliminada`, { id }, 'APROBADO');
        res.json({ mensaje: 'OT eliminada.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * GET /api/ot/:id/adjuntos
 */
async function getAdjuntos(req, res) {
    try {
        const result = await db.execute({
            sql:  `SELECT * FROM ot_adjuntos WHERE ot_id = ? ORDER BY id DESC`,
            args: [req.params.id]
        });
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * POST /api/ot/:id/adjuntos
 * Body: { imagen, importe, descripcion }
 * Sube un ticket manual y suma su importe a materiales_precio de la OT.
 */
async function addAdjunto(req, res) {
    const ot_id = req.params.id;
    const { imagen, importe, descripcion } = req.body;
    const fecha  = new Date().toLocaleString('es-ES');
    const imp    = parseFloat(importe) || 0;

    try {
        await db.execute({
            sql:  `INSERT INTO ot_adjuntos (ot_id, imagen, importe, descripcion, fecha)
                   VALUES (?, ?, ?, ?, ?)`,
            args: [ot_id, imagen, imp, descripcion || '', fecha]
        });

        if (imp > 0) {
            await db.execute({
                sql:  `UPDATE ordenes_trabajo SET materiales_precio = materiales_precio + ? WHERE id = ?`,
                args: [imp, ot_id]
            });
        }
        res.json({ mensaje: 'Ticket guardado y sumado.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * POST /api/ot/:id/lineas_materiales
 * Body: { lineas_materiales[] }
 * Añade líneas de materiales a una OT ya existente y descuenta stock.
 */
async function addLineasMateriales(req, res) {
    const ot_id = req.params.id;
    const lineas = req.body.lineas_materiales;

    try {
        await _insertarMateriales(ot_id, lineas);

        const totalSuma = lineas.reduce((acc, m) => acc + m.importe, 0);
        if (totalSuma > 0) {
            await db.execute({
                sql:  `UPDATE ordenes_trabajo SET materiales_precio = materiales_precio + ? WHERE id = ?`,
                args: [totalSuma, ot_id]
            });
        }
        res.json({ mensaje: 'Nuevas líneas añadidas.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * DELETE /api/ot/adjuntos/:id
 * Elimina un adjunto y resta su importe de la OT.
 * Solo admin (guard en ruta).
 */
async function deleteAdjunto(req, res) {
    const { id } = req.params;
    try {
        const r = await db.execute({
            sql:  `SELECT ot_id, importe FROM ot_adjuntos WHERE id = ?`,
            args: [id]
        });

        if (r.rows.length === 0) return res.status(404).json({ error: 'Adjunto no encontrado.' });

        const { ot_id, importe } = r.rows[0];
        await db.execute({ sql: `DELETE FROM ot_adjuntos WHERE id = ?`, args: [id] });
        await db.execute({
            sql:  `UPDATE ordenes_trabajo SET materiales_precio = materiales_precio - ? WHERE id = ?`,
            args: [importe, ot_id]
        });

        res.json({ mensaje: 'Línea/Ticket eliminado.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

module.exports = {
    getAll, crear, editar, cambiarEstado, eliminar,
    getAdjuntos, addAdjunto, addLineasMateriales, deleteAdjunto
};
