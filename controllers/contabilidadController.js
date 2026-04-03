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

        // Lista completa de OTs con cliente
        const rOTsLista = await db.execute(`
            SELECT ot.id, ot.codigo_ot, ot.fecha_encargo, ot.fecha_completada,
                   ot.horas, ot.num_tecnicos, ot.precio_hora, ot.tecnicos_nombres,
                   ot.marca, ot.tipo_urgencia, ot.materiales_precio, ot.estado,
                   ot.horas * ot.num_tecnicos * COALESCE(ot.precio_hora,15) AS coste_mo,
                   c.nombre AS cliente_nombre
            FROM ordenes_trabajo ot
            LEFT JOIN clientes c ON c.id = ot.cliente_id
            ORDER BY ot.id DESC
        `);

        // Lista completa de facturas con OT y cliente
        const rFacturasLista = await db.execute(`
            SELECT f.id, f.fecha_emision, f.base_imponible, f.iva, f.total,
                   ot.codigo_ot, c.nombre AS cliente_nombre
            FROM facturas f
            LEFT JOIN ordenes_trabajo ot ON ot.id = f.ot_id
            LEFT JOIN clientes c ON c.id = ot.cliente_id
            ORDER BY f.id DESC
        `);

        // Lista de gastos socios
        const rGastosLista = await db.execute(`
            SELECT id, pagador, concepto, importe, fecha, implicados
            FROM gastos_socios
            WHERE concepto NOT LIKE '[PAGO]%'
            ORDER BY id DESC
        `);

        // Horas trabajadas por técnico + coste MO
        const rHoras = await db.execute(`
            SELECT tecnicos_nombres,
                   SUM(horas) AS horas_totales,
                   SUM(horas * num_tecnicos * precio_hora) AS coste_mo
            FROM ordenes_trabajo
            WHERE estado = 'HECHO'
            GROUP BY tecnicos_nombres
            ORDER BY horas_totales DESC
        `);

        // Coste total de mano de obra
        const rCosteMO = await db.execute(`
            SELECT COALESCE(SUM(horas * num_tecnicos * COALESCE(precio_hora, 15)), 0) AS total_mo
            FROM ordenes_trabajo
            WHERE estado = 'HECHO'
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
        const coste_mo       = parseFloat(rCosteMO.rows[0]?.total_mo || 0);

        res.json({
            kpis: {
                ingresos_base:     ingresos_base.toFixed(2),
                ingresos_total:    ingresos_total.toFixed(2),
                costes_materiales: costes_mat.toFixed(2),
                costes_mo:         coste_mo.toFixed(2),
                gastos_generales:  gastos_gen.toFixed(2),
                beneficio_bruto:   (ingresos_base - costes_mat).toFixed(2),
                beneficio_neto:    (ingresos_base - costes_mat - coste_mo - gastos_gen).toFixed(2),
            },
            evolucion_mensual:      rFacturas.rows,
            ots_por_estado:         rOTs.rows,
            horas_por_tecnico:      rHoras.rows,
            clientes_ingresos:      rClientesIngresos.rows,
            clientes_materiales:    rClientesMateriales.rows,
            clientes_ots:           rClientesOTs.rows,
            ots_lista:              rOTsLista.rows,
            facturas_lista:         rFacturasLista.rows,
            gastos_lista:           rGastosLista.rows,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

module.exports = { getResumen };
