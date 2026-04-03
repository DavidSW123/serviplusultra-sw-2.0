const { db } = require('../config/db');

/**
 * Inserta una entrada en la tabla de auditoría.
 * @param {string} usuario   - Nombre de usuario que realiza la acción
 * @param {string} accion    - Descripción corta ('Añadir OT', 'Eliminar OT', 'Editar OT'…)
 * @param {string} referencia - Identificador legible del recurso afectado
 * @param {object} datos     - Payload completo (se serializa a JSON)
 * @param {string} estado    - 'APROBADO' | 'PENDIENTE' | 'RECHAZADO'
 */
async function registrarLog(usuario, accion, referencia, datos, estado) {
    const fecha = new Date().toLocaleString('es-ES');
    try {
        await db.execute({
            sql:  `INSERT INTO logs (usuario, accion, referencia, datos, estado, fecha)
                   VALUES (?, ?, ?, ?, ?, ?)`,
            args: [usuario, accion, referencia, JSON.stringify(datos), estado, fecha]
        });
    } catch (e) {
        console.error('Error al registrar log:', e);
    }
}

module.exports = { registrarLog };
