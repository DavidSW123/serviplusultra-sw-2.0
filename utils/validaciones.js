/**
 * Valida los campos básicos de una OT.
 * Devuelve un string con el error o null si todo es correcto.
 */
function validarOT(datos) {
    const anio   = new Date().getFullYear().toString().slice(-2);
    const prefijo = `OT${anio}/`;

    if (!datos.codigo_ot.startsWith(prefijo)) {
        return `El código de OT debe empezar por ${prefijo}`;
    }
    if (datos.fecha_completada && new Date(datos.fecha_completada) <= new Date(datos.fecha_encargo)) {
        return 'La fecha de finalización debe ser posterior a la de inicio.';
    }
    return null;
}

module.exports = { validarOT };
