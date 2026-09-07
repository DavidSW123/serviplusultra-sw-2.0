/**
 * Valida los campos básicos de una OT.
 * Devuelve un string con el error o null si todo es correcto.
 * `esNueva`: al crear una OT hace falta cliente (las que no tienen cliente
 * son Factura Directa, no una OT). Al editar una ya existente no se exige,
 * por compatibilidad con OTs antiguas que se crearon sin cliente.
 */
function validarOT(datos, { esNueva = false } = {}) {
    const anio   = new Date().getFullYear().toString().slice(-2);
    const prefijo = `OT${anio}/`;

    if (!datos.codigo_ot.startsWith(prefijo)) {
        return `El código de OT debe empezar por ${prefijo}`;
    }
    if (esNueva && !datos.cliente_id) {
        return 'Toda OT nueva necesita un cliente asignado. Si no hay cliente, usa "🧾 Factura Directa" en su lugar.';
    }
    if (datos.fecha_completada && new Date(datos.fecha_completada) <= new Date(datos.fecha_encargo)) {
        return 'La fecha de finalización debe ser posterior a la de inicio.';
    }
    return null;
}

module.exports = { validarOT };
