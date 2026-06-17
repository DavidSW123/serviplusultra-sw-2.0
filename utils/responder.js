/**
 * Respuesta de error estandarizada.
 *
 * NUNCA devuelve el detalle técnico (e.message/stack) al cliente: registra el
 * detalle en el servidor con una referencia corta y responde al cliente con un
 * mensaje genérico que incluye esa referencia (para poder cruzarla con los logs).
 */
function _ref() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function errorServidor(res, e, contexto) {
    const ref = _ref();
    console.error(`[ERROR][${ref}]${contexto ? ' ' + contexto : ''}:`, (e && e.stack) ? e.stack : e);
    return res.status(500).json({ error: `Error interno del servidor. Ref: ${ref}` });
}

module.exports = { errorServidor };
