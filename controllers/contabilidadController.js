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

        // Ranking clientes por facturación (ingresos base)
        const rClientesIngresos = await db.execute(`
            SELECT c.nombre AS cliente, COALESCE(SUM(f.base_imponible), 0) AS total_facturado,
                   COUNT(f.id) AS num_facturas
            FROM clientes c
            LEFT JOIN ordenes_trabajo ot ON ot.cliente_id = c.id
            LEFT JOIN facturas f ON f.ot_id = ot.id
            GROUP BY c.id, c.nombre
            HAVING total_facturado > 0
            ORDER BY total_facturado DESC
            LIMIT 10
        `);

        // Ranking clientes por coste de materiales
        const rClientesMateriales = await db.execute(`
            SELECT c.nombre AS cliente, COALESCE(SUM(a.importe), 0) AS total_materiales,
                   COUNT(DISTINCT ot.id) AS num_ots
            FROM clientes c
            LEFT JOIN ordenes_trabajo ot ON ot.cliente_id = c.id
            LEFT JOIN ot_adjuntos a ON a.ot_id = ot.id
            GROUP BY c.id, c.nombre
            HAVING total_materiales > 0
            ORDER BY total_materiales DESC
            LIMIT 10
        `);

        // OTs por cliente (conteo)
        const rClientesOTs = await db.execute(`
            SELECT c.nombre AS cliente, COUNT(ot.id) AS num_ots,
                   SUM(CASE WHEN ot.estado='HECHO' THEN 1 ELSE 0 END) AS ots_hechas
            FROM clientes c
            LEFT JOIN ordenes_trabajo ot ON ot.cliente_id = c.id
            GROUP BY c.id, c.nombre
            HAVING num_ots > 0
            ORDER BY num_ots DESC
            LIMIT 10
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
                ingresos_base:     ingresos_base.toFixed(2),
                ingresos_total:    ingresos_total.toFixed(2),
                costes_materiales: costes_mat.toFixed(2),
                gastos_generales:  gastos_gen.toFixed(2),
                beneficio_bruto:   (ingresos_base - costes_mat).toFixed(2),
                beneficio_neto:    (ingresos_base - costes_mat - gastos_gen).toFixed(2),
            },
            evolucion_mensual:      rFacturas.rows,
            ots_por_estado:         rOTs.rows,
            horas_por_tecnico:      rHoras.rows,
            clientes_ingresos:      rClientesIngresos.rows,
            clientes_materiales:    rClientesMateriales.rows,
            clientes_ots:           rClientesOTs.rows,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

module.exports = { getResumen };
