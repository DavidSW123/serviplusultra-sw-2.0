const { db } = require('../config/db');

/**
 * GET /api/contabilidad/resumen
 * Agrega datos financieros de todas las tablas.
 * Accesible para todos los roles.
 */
async function getResumen(req, res) {
    try {
        // Ingresos facturados
        const rFacturas = await db.execute(`
            SELECT
                COALESCE(SUM(base_imponible), 0) AS total_base,
                COALESCE(SUM(total),          0) AS total_con_iva,
                COUNT(*)                          AS num_facturas,
                strftime('%Y-%m', fecha_emision)  AS mes
            FROM facturas
            GROUP BY mes
            ORDER BY mes ASC
        `);

        // Coste total de materiales (tickets y líneas de OT)
        const rMateriales = await db.execute(`
            SELECT COALESCE(SUM(importe), 0) AS total_materiales
            FROM ot_adjuntos
        `);

        // Gastos generales socios (excluir pagos de liquidación)
        const rGastos = await db.execute(`
            SELECT COALESCE(SUM(importe), 0) AS total_gastos
            FROM gastos_socios
            WHERE concepto NOT LIKE '[PAGO]%'
        `);

        // OTs por estado
        const rOTs = await db.execute(`
            SELECT estado, COUNT(*) AS total
            FROM ordenes_trabajo
            GROUP BY estado
        `);

        // Horas trabajadas por técnico
        const rHoras = await db.execute(`
            SELECT tecnicos_nombres, SUM(horas) AS horas_totales
            FROM ordenes_trabajo
            WHERE estado = 'HECHO'
            GROUP BY tecnicos_nombres
            ORDER BY horas_totales DESC
        `);

        // Totales globales facturación
        const rTotales = await db.execute(`
            SELECT
                COALESCE(SUM(base_imponible), 0) AS ingresos_base,
                COALESCE(SUM(total),          0) AS ingresos_total
            FROM facturas
        `);

        const ingresos_base  = parseFloat(rTotales.rows[0]?.ingresos_base  || 0);
        const ingresos_total = parseFloat(rTotales.rows[0]?.ingresos_total || 0);
        const costes_mat     = parseFloat(rMateriales.rows[0]?.total_materiales || 0);
        const gastos_gen     = parseFloat(rGastos.rows[0]?.total_gastos || 0);

        res.json({
            kpis: {
                ingresos_base:    ingresos_base.toFixed(2),
                ingresos_total:   ingresos_total.toFixed(2),
                costes_materiales: costes_mat.toFixed(2),
                gastos_generales:  gastos_gen.toFixed(2),
                beneficio_bruto:  (ingresos_base - costes_mat).toFixed(2),
                beneficio_neto:   (ingresos_base - costes_mat - gastos_gen).toFixed(2),
            },
            evolucion_mensual: rFacturas.rows,
            ots_por_estado:    rOTs.rows,
            horas_por_tecnico: rHoras.rows,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

module.exports = { getResumen };
