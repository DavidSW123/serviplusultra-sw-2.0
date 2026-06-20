const QRCode    = require('qrcode');
const PDFDocument = require('pdfkit');
const path      = require('path');
const { errorServidor } = require('../utils/responder');
const { db }    = require('../config/db');

const { GOOGLE_SCRIPT_URL } = require('../config/env');

/**
 * Genera el número de factura secuencial del año actual.
 * Formato: XX-YYYYMMDD  (XX crece a 3/4 dígitos automáticamente)
 * El contador se reinicia cada año.
 */
/**
 * Genera el siguiente número de factura del año.
 * IMPORTANTE (cumplimiento legal): rellena huecos en la secuencia.
 * Si se generó la 14 y luego se borró el registro, la próxima factura
 * recibirá la 14 (en lugar de saltar a 15+) para que NUNCA queden
 * números huérfanos en la secuencia anual.
 */
/**
 * Genera el siguiente número de factura RECTIFICATIVA del año.
 * Serie separada con prefijo R-, gap-fill propio.
 * Formato: R-NN-YYYYMMDD
 */
async function generarNumeroRectificativa() {
    const hoy  = new Date();
    const year = hoy.getFullYear();
    const mm   = String(hoy.getMonth() + 1).padStart(2, '0');
    const dd   = String(hoy.getDate()).padStart(2, '0');

    // Limpieza inline: huérfanas
    try {
        await db.execute(`
            DELETE FROM facturas
            WHERE id IN (
                SELECT f.id FROM facturas f
                LEFT JOIN ordenes_trabajo ot ON ot.id = f.ot_id
                LEFT JOIN presupuestos    p  ON p.id  = f.presupuesto_id
                WHERE (f.ot_id IS NULL OR ot.id IS NULL)
                  AND (f.presupuesto_id IS NULL OR p.id IS NULL)
                  AND (f.factura_rectificada_id IS NULL)
            )
        `);
    } catch (_) {}

    // Recupera todos los numero_factura que empiezan por R- del año
    const { rows } = await db.execute({
        sql:  `SELECT numero_factura FROM facturas
               WHERE numero_factura LIKE 'R-%' AND numero_factura LIKE ?
               ORDER BY numero_factura ASC`,
        args: [`R-%-${year}%`]
    });

    const usados = new Set();
    for (const r of rows) {
        // Formato R-NN-YYYYMMDD → extraer NN
        const m = (r.numero_factura || '').match(/^R-(\d+)-/);
        if (m) usados.add(parseInt(m[1]));
    }
    let seq = 1;
    while (usados.has(seq)) seq++;
    const seqStr = seq < 100 ? String(seq).padStart(2, '0') : String(seq);
    return `R-${seqStr}-${year}${mm}${dd}`;
}

async function generarNumeroFactura() {
    const hoy  = new Date();
    const year = hoy.getFullYear();
    const mm   = String(hoy.getMonth() + 1).padStart(2, '0');
    const dd   = String(hoy.getDate()).padStart(2, '0');

    // Limpieza inline: liberar números de facturas huérfanas (sin OT ni presupuesto vivo)
    try {
        await db.execute(`
            DELETE FROM facturas
            WHERE id IN (
                SELECT f.id FROM facturas f
                LEFT JOIN ordenes_trabajo ot ON ot.id = f.ot_id
                LEFT JOIN presupuestos    p  ON p.id  = f.presupuesto_id
                WHERE (f.ot_id IS NULL OR ot.id IS NULL)
                  AND (f.presupuesto_id IS NULL OR p.id IS NULL)
            )
        `);
    } catch (_) { /* tabla aún no inicializada, ok */ }

    const { rows } = await db.execute({
        sql:  `SELECT CAST(SUBSTR(numero_factura, 1, INSTR(numero_factura, '-') - 1) AS INTEGER) AS seq
               FROM facturas
               WHERE numero_factura IS NOT NULL
                 AND SUBSTR(numero_factura, INSTR(numero_factura, '-') + 1, 4) = ?
               ORDER BY seq ASC`,
        args: [String(year)]
    });

    const usados = new Set(rows.map(r => r.seq));
    let seq = 1;
    while (usados.has(seq)) seq++;

    const seqStr = seq < 100 ? String(seq).padStart(2, '0') : String(seq);
    return `${seqStr}-${year}${mm}${dd}`;
}

/** Devuelve la factura ACTIVA de una OT (borrador o emitida; nunca anulada/rectificativa). */
async function _facturaActiva(ot_id) {
    const r = await db.execute({
        sql:  `SELECT * FROM facturas
               WHERE ot_id = ?
                 AND COALESCE(es_rectificativa, 0) = 0
                 AND COALESCE(estado, 'EMITIDA') <> 'ANULADA'
                 AND rectificada_por_id IS NULL
               ORDER BY id DESC LIMIT 1`,
        args: [ot_id]
    });
    return r.rows[0] || null;
}

/**
 * POST /api/factura/borrador
 * Body: { ot_id, base_imponible, iva, total, lineas }
 * Crea o actualiza el BORRADOR de la OT. NO asigna número fiscal.
 */
async function guardarBorrador(req, res) {
    const { ot_id, base_imponible, iva, total, lineas } = req.body;
    try {
        const activa = await _facturaActiva(ot_id);
        if (activa && activa.estado === 'EMITIDA') {
            return res.status(400).json({ error: 'Esta OT ya tiene una factura EMITIDA. Para cambiarla, emite una rectificativa.' });
        }
        const lineasJSON = JSON.stringify(lineas || []);
        if (activa && activa.estado === 'BORRADOR') {
            // Si el borrador ya tiene número asignado, regenerar el QR para que su total
            // siga siendo coherente tras editar las líneas/importes.
            if (activa.numero_factura) {
                const fechaQR = activa.fecha_emision || new Date().toISOString().split('T')[0];
                const textoQR = `NIF:B26892760|Factura:${activa.numero_factura}|Fecha:${fechaQR}|Total:${total}EUR`;
                const qr      = await QRCode.toDataURL(textoQR);
                await db.execute({
                    sql:  `UPDATE facturas SET base_imponible=?, iva=?, total=?, lineas=?, qr_data=? WHERE id=?`,
                    args: [base_imponible, iva, total, lineasJSON, qr, activa.id]
                });
            } else {
                await db.execute({
                    sql:  `UPDATE facturas SET base_imponible=?, iva=?, total=?, lineas=? WHERE id=?`,
                    args: [base_imponible, iva, total, lineasJSON, activa.id]
                });
            }
            return res.json({ ok: true, estado: 'BORRADOR', factura_id: activa.id });
        }
        const r = await db.execute({
            sql:  `INSERT INTO facturas (ot_id, base_imponible, iva, total, lineas, estado)
                   VALUES (?, ?, ?, ?, ?, 'BORRADOR')`,
            args: [ot_id, base_imponible, iva, total, lineasJSON]
        });
        res.json({ ok: true, estado: 'BORRADOR', factura_id: Number(r.lastInsertRowid) });
    } catch (e) {
        errorServidor(res, e, 'guardarBorrador');
    }
}

/**
 * POST /api/factura/asignar-numero
 * Body: { ot_id, base_imponible, iva, total, lineas }
 * Asigna el número fiscal correlativo a la factura SIN congelarla: sigue en
 * estado BORRADOR y editable. Útil para enviarla al cliente fuera de la app
 * antes de darla por definitiva (luego se marca EMITIDA, que la hace inmutable).
 * Idempotente: si ya tiene número (borrador o emitida), lo devuelve sin cambios.
 */
async function asignarNumero(req, res) {
    const { ot_id, base_imponible, iva, total, lineas } = req.body;
    try {
        let activa = await _facturaActiva(ot_id);
        const lineasJSON = JSON.stringify(lineas || (activa ? JSON.parse(activa.lineas || '[]') : []));

        // Asegurar que existe el borrador (crear, o actualizar importes/líneas si sigue editable)
        if (!activa) {
            const r = await db.execute({
                sql:  `INSERT INTO facturas (ot_id, base_imponible, iva, total, lineas, estado)
                       VALUES (?, ?, ?, ?, ?, 'BORRADOR')`,
                args: [ot_id, base_imponible, iva, total, lineasJSON]
            });
            activa = { id: Number(r.lastInsertRowid), numero_factura: null, qr_data: null, estado: 'BORRADOR' };
        } else if (activa.estado === 'BORRADOR') {
            await db.execute({
                sql:  `UPDATE facturas SET base_imponible=?, iva=?, total=?, lineas=? WHERE id=?`,
                args: [base_imponible, iva, total, lineasJSON, activa.id]
            });
        }

        // Si ya tiene número (borrador con número, o emitida) → idempotente, sin tocar nada más
        if (activa.numero_factura) {
            return res.json({ ok: true, numero_factura: activa.numero_factura, qr_data: activa.qr_data, estado: activa.estado, factura_id: activa.id });
        }

        const fecha   = new Date().toISOString().split('T')[0];
        const numero  = await generarNumeroFactura();
        const textoQR = `NIF:B26892760|Factura:${numero}|Fecha:${fecha}|Total:${total}EUR`;
        const qr      = await QRCode.toDataURL(textoQR);
        await db.execute({
            sql:  `UPDATE facturas SET numero_factura=?, fecha_emision=?, qr_data=? WHERE id=?`,
            args: [numero, fecha, qr, activa.id]
        });
        res.json({ ok: true, numero_factura: numero, qr_data: qr, estado: 'BORRADOR', factura_id: activa.id });
    } catch (e) {
        errorServidor(res, e, 'asignarNumero');
    }
}

/**
 * POST /api/factura
 * Body: { ot_id, base_imponible, iva, total, lineas }
 * EMITE la factura de la OT: asigna número correlativo y la congela (estado EMITIDA).
 * Si ya hay una EMITIDA activa → idempotente (la devuelve).
 * Si hay un BORRADOR → lo convierte en EMITIDA.
 */
async function emitir(req, res) {
    const { ot_id, base_imponible, iva, total, lineas } = req.body;

    try {
        const activa = await _facturaActiva(ot_id);
        if (activa && activa.estado === 'EMITIDA') {
            return res.json({
                mensaje:        'Factura ya registrada',
                qr_data:        activa.qr_data,
                numero_factura: activa.numero_factura,
                fecha_emision:  activa.fecha_emision,
                estado:         'EMITIDA'
            });
        }

        // Si el borrador ya tenía número asignado (vía /asignar-numero), se respeta;
        // no se regenera ni se cambia la fecha de emisión original.
        const fecha          = (activa && activa.fecha_emision) ? activa.fecha_emision : new Date().toISOString().split('T')[0];
        const numero_factura = (activa && activa.numero_factura) ? activa.numero_factura : await generarNumeroFactura();
        const textoQR        = `NIF:B26892760|Factura:${numero_factura}|Fecha:${fecha}|Total:${total}EUR`;
        const qr             = await QRCode.toDataURL(textoQR);
        const lineasJSON     = JSON.stringify(lineas || (activa ? JSON.parse(activa.lineas || '[]') : []));
        const ahora          = new Date().toISOString();

        if (activa && activa.estado === 'BORRADOR') {
            // Emitir el borrador existente
            await db.execute({
                sql:  `UPDATE facturas SET estado='EMITIDA', numero_factura=?, fecha_emision=?, emitida_en=?, qr_data=?, base_imponible=?, iva=?, total=?, lineas=? WHERE id=?`,
                args: [numero_factura, fecha, ahora, qr, base_imponible, iva, total, lineasJSON, activa.id]
            });
        } else {
            // Crear directamente como EMITIDA
            await db.execute({
                sql:  `INSERT INTO facturas (ot_id, base_imponible, iva, total, qr_data, fecha_emision, numero_factura, lineas, estado, emitida_en)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EMITIDA', ?)`,
                args: [ot_id, base_imponible, iva, total, qr, fecha, numero_factura, lineasJSON, ahora]
            });
        }

        res.json({ mensaje: 'Factura emitida', qr_data: qr, numero_factura, fecha_emision: fecha, estado: 'EMITIDA' });
    } catch (e) {
        errorServidor(res, e, 'emitir');
    }
}

/**
 * POST /api/enviar-factura
 * Body: { emailDestino, asunto, htmlBody, pdfBase64, nombreArchivo }
 */
async function enviarEmail(req, res) {
    const { emailDestino, asunto, htmlBody, pdfBase64, nombreArchivo, ot_id, factura_id } = req.body;
    try {
        await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                to:            emailDestino,
                subject:       asunto,
                html:          htmlBody,
                adjuntoBase64: pdfBase64,
                adjuntoNombre: nombreArchivo
            })
        });

        // Registrar envío en facturas.emails_enviados (preferimos factura_id si viene)
        if (factura_id || ot_id) {
            try {
                const whereClause = factura_id ? 'id = ?' : 'ot_id = ? AND COALESCE(es_rectificativa,0)=0';
                const arg         = factura_id || ot_id;
                const { rows } = await db.execute({
                    sql:  `SELECT id, emails_enviados FROM facturas WHERE ${whereClause}`,
                    args: [arg]
                });
                if (rows[0]) {
                    let arr = [];
                    try { arr = JSON.parse(rows[0].emails_enviados || '[]'); } catch { arr = []; }
                    arr.push({ email: emailDestino, fecha: new Date().toLocaleString('es-ES') });
                    await db.execute({
                        sql:  `UPDATE facturas SET emails_enviados=? WHERE id=?`,
                        args: [JSON.stringify(arr), rows[0].id]
                    });
                }
            } catch (_) { /* no bloquear respuesta si falla el tracking */ }
        }

        res.json({ mensaje: 'Factura enviada con éxito al cliente por correo electrónico.' });
    } catch (e) {
        res.status(500).json({ error: 'Fallo de conexión al enviar la factura.' });
    }
}

/**
 * POST /api/test-email
 */
async function testEmail(req, res) {
    const { emailDestino } = req.body;
    try {
        await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                to:      emailDestino,
                subject: '🛠️ Prueba de conexión - ServiPlusUltra',
                html:    `<div style="text-align:center;"><h2 style="color:#1abc9c;">¡El túnel secreto funciona! 🚀</h2></div>`
            })
        });
        res.json({ mensaje: 'Correo enviado con éxito. ¡Revisa tu bandeja de entrada!' });
    } catch (e) {
        res.status(500).json({ error: 'Fallo al enviar el correo.' });
    }
}

/**
 * POST /api/factura/lineas
 * Body: { ot_id, lineas }
 * Guarda las líneas modificadas en la factura existente.
 */
async function actualizarLineas(req, res) {
    const { ot_id, factura_id, lineas } = req.body;
    try {
        const lineasJSON = JSON.stringify(lineas || []);
        if (factura_id) {
            // Una factura regular EMITIDA es inmutable (solo se corrige por rectificativa).
            const f = await db.execute({ sql: `SELECT estado, es_rectificativa FROM facturas WHERE id=?`, args: [factura_id] });
            if (f.rows[0] && f.rows[0].estado === 'EMITIDA' && !f.rows[0].es_rectificativa) {
                return res.status(400).json({ error: 'No se puede modificar una factura emitida. Emite una rectificativa.' });
            }
            await db.execute({ sql: `UPDATE facturas SET lineas=? WHERE id=?`, args: [lineasJSON, factura_id] });
        } else {
            // Solo el BORRADOR activo de la OT
            await db.execute({
                sql:  `UPDATE facturas SET lineas=? WHERE ot_id=? AND COALESCE(es_rectificativa,0)=0 AND COALESCE(estado,'EMITIDA')='BORRADOR'`,
                args: [lineasJSON, ot_id]
            });
        }
        res.json({ ok: true });
    } catch (e) {
        errorServidor(res, e, 'actualizarLineas');
    }
}

/**
 * POST /api/factura/desde-presupuesto
 * Body: { presupuesto_id, tipo ('proforma'|'final'), base_imponible, iva, total, lineas }
 * Genera número secuencial y registra la factura vinculada al presupuesto.
 */
async function emitirDesdePresupuesto(req, res) {
    const { presupuesto_id, tipo, base_imponible, iva, total, lineas } = req.body;
    if (!['proforma', 'final'].includes(tipo)) return res.status(400).json({ error: 'tipo inválido' });

    try {
        // Idempotente: si ya existe, devuelve la existente
        const campo = tipo === 'proforma' ? 'proforma_numero' : 'factura_final_numero';
        const { rows: pRows } = await db.execute({
            sql:  `SELECT ${campo} FROM presupuestos WHERE id=?`,
            args: [presupuesto_id]
        });
        if (pRows[0] && pRows[0][campo]) {
            return res.json({ numero_factura: pRows[0][campo], yaExistia: true });
        }

        const fecha          = new Date().toISOString().split('T')[0];
        const numero_factura = await generarNumeroFactura();

        const textoQR = `NIF:B26892760|Factura:${numero_factura}|Fecha:${fecha}|Total:${total}EUR`;
        const qr = await QRCode.toDataURL(textoQR);
        await db.execute({
            sql:  `INSERT INTO facturas (presupuesto_id, base_imponible, iva, total, fecha_emision, numero_factura, lineas, qr_data, estado, emitida_en)
                   VALUES (?,?,?,?,?,?,?,?, 'EMITIDA', ?)`,
            args: [presupuesto_id, base_imponible, iva, total, fecha, numero_factura, JSON.stringify(lineas || []), qr, new Date().toISOString()]
        });

        const campoTotal = tipo === 'proforma' ? ', proforma_total=?' : '';
        const args = tipo === 'proforma'
            ? [numero_factura, total, presupuesto_id]
            : [numero_factura, presupuesto_id];

        await db.execute({
            sql:  `UPDATE presupuestos SET ${campo}=?${campoTotal} WHERE id=?`,
            args
        });

        res.json({ ok: true, numero_factura, fecha_emision: fecha, qr_data: qr });
    } catch (e) {
        errorServidor(res, e, 'emitirDesdePresupuesto');
    }
}

/**
 * POST /api/facturas/purgar-huerfanas
 * Elimina facturas cuyo ot_id apunta a una OT inexistente
 * y cuyo presupuesto_id apunta a un presupuesto inexistente (o ambos NULL).
 * Libera esos números para que el gap-fill los reasigne en la próxima emisión.
 */
async function purgarHuerfanas(req, res) {
    try {
        const { rows: huerfanas } = await db.execute(`
            SELECT f.id, f.numero_factura
            FROM facturas f
            LEFT JOIN ordenes_trabajo ot ON ot.id = f.ot_id
            LEFT JOIN presupuestos    p  ON p.id  = f.presupuesto_id
            WHERE (f.ot_id IS NULL OR ot.id IS NULL)
              AND (f.presupuesto_id IS NULL OR p.id IS NULL)
        `);
        for (const h of huerfanas) {
            await db.execute({ sql: `DELETE FROM facturas WHERE id=?`, args: [h.id] });
        }
        res.json({ ok: true, eliminadas: huerfanas.length, numeros: huerfanas.map(h => h.numero_factura) });
    } catch (e) {
        errorServidor(res, e);
    }
}

/**
 * GET /api/facturas/diagnostico
 * Lista todas las facturas con su contexto (OT viva, presupuesto vivo).
 * Útil para encontrar facturas "fantasma" que ocupan número.
 */
async function diagnostico(req, res) {
    try {
        const { rows } = await db.execute(`
            SELECT f.id, f.numero_factura, f.ot_id, f.presupuesto_id,
                   ot.codigo_ot AS ot_codigo,
                   p.referencia AS presupuesto_ref,
                   CASE WHEN f.ot_id IS NOT NULL AND ot.id IS NULL THEN 1 ELSE 0 END AS ot_huerfana,
                   CASE WHEN f.presupuesto_id IS NOT NULL AND p.id IS NULL THEN 1 ELSE 0 END AS pres_huerfano
            FROM facturas f
            LEFT JOIN ordenes_trabajo ot ON ot.id = f.ot_id
            LEFT JOIN presupuestos    p  ON p.id  = f.presupuesto_id
            ORDER BY f.numero_factura
        `);
        res.json(rows);
    } catch (e) {
        errorServidor(res, e);
    }
}

/**
 * POST /api/facturas/:id/rectificar
 * Body: { lineas, base_imponible, iva, total, motivo }
 * Crea una factura rectificativa vinculada a la original y la marca como "rectificada_por".
 */
async function rectificar(req, res) {
    const { id } = req.params;
    const { lineas, base_imponible, iva, total, motivo } = req.body;
    try {
        const { rows } = await db.execute({ sql: `SELECT * FROM facturas WHERE id=?`, args: [id] });
        if (!rows[0]) return res.status(404).json({ error: 'Factura original no encontrada' });
        const orig = rows[0];

        if (orig.es_rectificativa) {
            return res.status(400).json({ error: 'No se puede rectificar una factura rectificativa. Rectifica la original.' });
        }
        if (orig.rectificada_por_id) {
            return res.status(400).json({ error: `Esta factura ya tiene una rectificativa asociada (ID ${orig.rectificada_por_id}).` });
        }

        const fecha   = new Date().toISOString().split('T')[0];
        const numeroR = await generarNumeroRectificativa();
        const textoQR = `NIF:B26892760|Factura:${numeroR}|Fecha:${fecha}|Total:${total}EUR`;
        const qr      = await QRCode.toDataURL(textoQR);

        const r = await db.execute({
            sql:  `INSERT INTO facturas
                   (ot_id, presupuesto_id, base_imponible, iva, total, qr_data, fecha_emision, numero_factura, lineas,
                    es_rectificativa, factura_rectificada_id, motivo_rectificacion, estado, emitida_en)
                   VALUES (?,?,?,?,?,?,?,?,?,1,?,?, 'EMITIDA', ?)`,
            args: [
                orig.ot_id, orig.presupuesto_id,
                base_imponible, iva, total, qr, fecha, numeroR,
                JSON.stringify(lineas || []),
                orig.id, motivo || '', new Date().toISOString()
            ]
        });

        const newId = Number(r.lastInsertRowid);
        await db.execute({
            sql:  `UPDATE facturas SET rectificada_por_id=?, estado='ANULADA' WHERE id=?`,
            args: [newId, orig.id]
        });

        res.json({
            ok: true,
            id: newId,
            numero_factura: numeroR,
            fecha_emision: fecha,
            qr_data: qr,
            factura_rectificada_id: orig.id,
            numero_rectificada: orig.numero_factura
        });
    } catch (e) {
        errorServidor(res, e);
    }
}

/**
 * GET /api/facturas/:id
 * Devuelve los datos completos de una factura (incluida lineas, qr, etc.)
 * Útil para mostrar rectificativas o consultar facturas concretas.
 */
async function getFactura(req, res) {
    const { id } = req.params;
    try {
        const { rows } = await db.execute({
            sql: `SELECT f.*,
                         ot.codigo_ot,
                         p.referencia AS presupuesto_ref,
                         orig.numero_factura AS rectifica_a_numero,
                         rect.id          AS rectificada_por_id_join,
                         rect.numero_factura AS rectificada_por_numero
                  FROM facturas f
                  LEFT JOIN ordenes_trabajo ot ON ot.id = f.ot_id
                  LEFT JOIN presupuestos    p  ON p.id  = f.presupuesto_id
                  LEFT JOIN facturas        orig ON orig.id = f.factura_rectificada_id
                  LEFT JOIN facturas        rect ON rect.id = f.rectificada_por_id
                  WHERE f.id = ?`,
            args: [id]
        });
        if (!rows[0]) return res.status(404).json({ error: 'Factura no encontrada' });
        res.json(rows[0]);
    } catch (e) {
        errorServidor(res, e);
    }
}

/**
 * GET /api/facturas/rectificativas
 * Lista todas las facturas rectificativas con su factura original.
 */
async function listarRectificativas(req, res) {
    try {
        const { rows } = await db.execute(`
            SELECT f.id, f.numero_factura, f.fecha_emision, f.base_imponible, f.iva, f.total,
                   f.motivo_rectificacion, f.lineas,
                   orig.id AS orig_id, orig.numero_factura AS orig_numero,
                   ot.codigo_ot, p.referencia AS presupuesto_ref,
                   c.nombre AS cliente_nombre
            FROM facturas f
            LEFT JOIN facturas        orig ON orig.id = f.factura_rectificada_id
            LEFT JOIN ordenes_trabajo ot   ON ot.id   = f.ot_id
            LEFT JOIN presupuestos    p    ON p.id    = f.presupuesto_id
            LEFT JOIN clientes        c    ON c.id    = COALESCE(ot.cliente_id, p.cliente_id)
            WHERE f.es_rectificativa = 1
            ORDER BY f.id DESC
        `);
        res.json(rows);
    } catch (e) {
        errorServidor(res, e);
    }
}

/**
 * POST /api/facturas/:id/reasignar-numero
 * Reasigna el numero_factura al hueco libre más bajo en la serie regular del año actual.
 * Solo permitido si la factura:
 *   - NO ha sido enviada al cliente (emails_enviados vacío)
 *   - NO es rectificativa (las R- tienen su propia serie)
 *   - Existe un hueco con número menor al actual
 * Sincroniza QR y referencias en presupuestos.
 */
async function reasignarNumero(req, res) {
    const { id } = req.params;
    try {
        const { rows } = await db.execute({
            sql:  `SELECT * FROM facturas WHERE id=?`,
            args: [id]
        });
        if (!rows[0]) return res.status(404).json({ error: 'Factura no encontrada' });
        const f = rows[0];

        // Validaciones
        if (f.es_rectificativa) {
            return res.status(400).json({ error: 'Las rectificativas usan su propia serie R-, no se renumeran a la regular.' });
        }
        let envios = [];
        try { envios = JSON.parse(f.emails_enviados || '[]'); } catch (_) {}
        if (Array.isArray(envios) && envios.length > 0) {
            return res.status(400).json({ error: 'Esta factura ya se envió al cliente. Su número es inmutable.' });
        }
        if (!f.numero_factura) {
            return res.status(400).json({ error: 'Esta factura aún no tiene número asignado.' });
        }

        // Extraer seq actual de su numero_factura
        const mActual = f.numero_factura.match(/^(\d+)-(\d{4})/);
        if (!mActual) return res.status(400).json({ error: 'Formato de número no reconocido.' });
        const seqActual = parseInt(mActual[1]);

        // Calcular hueco más bajo libre en la serie regular del año
        const hoy = new Date();
        const year = hoy.getFullYear();
        const mm   = String(hoy.getMonth() + 1).padStart(2, '0');
        const dd   = String(hoy.getDate()).padStart(2, '0');
        const { rows: rN } = await db.execute({
            sql:  `SELECT CAST(SUBSTR(numero_factura, 1, INSTR(numero_factura, '-') - 1) AS INTEGER) AS seq
                   FROM facturas
                   WHERE numero_factura IS NOT NULL
                     AND numero_factura NOT LIKE 'R-%'
                     AND SUBSTR(numero_factura, INSTR(numero_factura, '-') + 1, 4) = ?
                     AND id != ?
                   ORDER BY seq ASC`,
            args: [String(year), id]
        });
        const usados = new Set(rN.map(r => r.seq));
        let seq = 1;
        while (usados.has(seq)) seq++;

        if (seq >= seqActual) {
            return res.json({ ok: true, sinCambio: true, mensaje: 'No hay huecos por debajo del número actual.', numero_actual: f.numero_factura });
        }

        const seqStr     = seq < 100 ? String(seq).padStart(2, '0') : String(seq);
        const nuevoNum   = `${seqStr}-${year}${mm}${dd}`;

        // Regenerar QR
        const textoQR = `NIF:B26892760|Factura:${nuevoNum}|Fecha:${f.fecha_emision}|Total:${f.total}EUR`;
        const qr = await QRCode.toDataURL(textoQR);

        // Actualizar la factura
        await db.execute({
            sql:  `UPDATE facturas SET numero_factura=?, qr_data=? WHERE id=?`,
            args: [nuevoNum, qr, id]
        });

        // Sincronizar referencias en presupuestos si las hubiera
        if (f.presupuesto_id) {
            await db.execute({
                sql:  `UPDATE presupuestos
                       SET proforma_numero      = CASE WHEN proforma_numero      = ? THEN ? ELSE proforma_numero      END,
                           factura_final_numero = CASE WHEN factura_final_numero = ? THEN ? ELSE factura_final_numero END
                       WHERE id = ?`,
                args: [f.numero_factura, nuevoNum, f.numero_factura, nuevoNum, f.presupuesto_id]
            });
        }

        res.json({
            ok: true,
            numero_anterior: f.numero_factura,
            numero_nuevo:    nuevoNum,
            qr_data:         qr
        });
    } catch (e) {
        errorServidor(res, e);
    }
}

// ============================================================
// PDF DE FACTURA GENERADO EN SERVIDOR (fiable; nunca sale en blanco)
// ============================================================
const _eur = n => (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

/** Dibuja la factura en el documento pdfkit a partir de los datos del modal. */
function _construirPdfFactura(doc, d) {
    const M = 40, right = doc.page.width - M;
    const teal = '#1abc9c', dark = '#2c3e50', grey = '#7f8c8d';

    // Logo (si existe)
    try { doc.image(path.join(__dirname, '..', 'public', 'logo.png'), M, M, { width: 150 }); } catch (_) {}

    // Título + datos de la factura (derecha)
    doc.fillColor(teal).font('Helvetica-Bold').fontSize(26).text('FACTURA', M, M + 4, { width: right - M, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(dark);
    doc.text(`Nº de Factura: ${d.numero || '—'}`,  M, M + 40, { width: right - M, align: 'right' });
    doc.text(`Ref. OT: ${d.otCode || '—'}`,         M, doc.y,   { width: right - M, align: 'right' });
    doc.text(`Fecha de emisión: ${d.fecha || '—'}`, M, doc.y,   { width: right - M, align: 'right' });

    // Datos de empresa (izquierda, bajo el logo)
    doc.font('Helvetica-Bold').fontSize(13).fillColor(dark).text('ServiPlusUltra Solutions S.L.', M, M + 64);
    doc.font('Helvetica').fontSize(9).fillColor(grey)
       .text('B-26892760', M, doc.y + 2)
       .text("Carrer d'Aribau 168, 1-1, 08036 BCN", M, doc.y);

    // Caja de cliente (derecha)
    const cli = d.cliente || {};
    const bw = 250, bx = right - bw, by = M + 100;
    let bh = 40;
    doc.font('Helvetica').fontSize(8.5);
    if (cli.nif) bh += 12;
    if (cli.direccion) bh += doc.heightOfString('Dir: ' + cli.direccion, { width: bw - 20 });
    doc.save().roundedRect(bx, by, bw, bh, 4).fill('#f0f4f8').restore();
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(9).text('Facturar a:', bx + 10, by + 8, { width: bw - 20 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(dark).text(cli.nombre || 'Consumidor Final', bx + 10, doc.y + 1, { width: bw - 20 });
    doc.font('Helvetica').fontSize(8.5).fillColor('#555');
    if (cli.nif)       doc.text(`NIF/CIF: ${cli.nif}`, bx + 10, doc.y + 2, { width: bw - 20 });
    if (cli.direccion) doc.text(`Dir: ${cli.direccion}`, bx + 10, doc.y, { width: bw - 20 });

    // Línea divisoria
    let y = Math.max(M + 132, by + bh + 18);
    doc.moveTo(M, y).lineTo(right, y).lineWidth(1).strokeColor(dark).stroke();
    y += 12;

    // Cabecera de la tabla
    const cCon = M, cCant = 300, cPre = 360;
    const wCon = cCant - cCon - 10;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(dark);
    doc.text('Concepto', cCon, y, { width: wCon });
    doc.text('Cant.', cCant, y, { width: 50 });
    doc.text('Precio/U (€)', cPre, y, { width: 90 });
    doc.text('Total', right - 100, y, { width: 100, align: 'right' });
    y += 15;
    doc.moveTo(M, y).lineTo(right, y).lineWidth(1).strokeColor(dark).stroke();
    y += 8;

    // Filas (concepto ENVUELVE; total nunca se parte)
    (d.lineas || []).forEach(l => {
        const cant = Number(l.cantidad) || 0, precio = Number(l.precio) || 0;
        const concepto = String(l.concepto || '');
        doc.font('Helvetica').fontSize(10);
        const hCon = doc.heightOfString(concepto, { width: wCon });
        const rowH = Math.max(hCon, 13) + 9;
        if (y + rowH > doc.page.height - 140) { doc.addPage(); y = M; }
        doc.fillColor('#000').font('Helvetica').fontSize(10);
        doc.text(concepto, cCon, y, { width: wCon });
        doc.text(String(cant), cCant, y, { width: 50 });
        doc.text(String(precio), cPre, y, { width: 90 });
        doc.text(_eur(cant * precio), right - 100, y, { width: 100, align: 'right' });
        y += rowH;
        doc.moveTo(M, y - 5).lineTo(right, y - 5).lineWidth(0.5).strokeColor('#e5e5e5').stroke();
    });

    // QR (izquierda) + caja de totales (derecha)
    y += 18;
    if (y > doc.page.height - 130) { doc.addPage(); y = M; }
    if (d.qr_data && String(d.qr_data).includes(',')) {
        try { doc.image(Buffer.from(String(d.qr_data).split(',')[1], 'base64'), M, y, { width: 95 }); } catch (_) {}
    }
    const tw = 210, tx = right - tw;
    doc.save().roundedRect(tx, y, tw, 74, 4).fill('#f8f9fa').restore();
    doc.fillColor(dark).font('Helvetica').fontSize(10).text('Base:', tx + 12, y + 10);
    doc.font('Helvetica-Bold').text(_eur(d.base), tx + tw - 110, y + 10, { width: 98, align: 'right' });
    doc.font('Helvetica').fillColor(dark).text('IVA (21%):', tx + 12, y + 28);
    doc.font('Helvetica-Bold').text(_eur(d.iva), tx + tw - 110, y + 28, { width: 98, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(13).fillColor(teal).text('Total:', tx + 12, y + 48);
    doc.text(_eur(d.total), tx + tw - 110, y + 47, { width: 98, align: 'right' });
}

/** Genera el PDF en memoria y lo resuelve como Buffer. */
function _pdfFacturaBuffer(d) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', margin: 40 });
            const chunks = [];
            doc.on('data', c => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
            _construirPdfFactura(doc, d);
            doc.end();
        } catch (e) { reject(e); }
    });
}

/**
 * POST /api/factura/pdf
 * Body: { numero, fecha, otCode, cliente:{nombre,nif,direccion}, lineas, base, iva, total, qr_data }
 * Genera el PDF de la factura en el servidor (fiable) y lo devuelve como descarga.
 */
async function generarPdf(req, res) {
    try {
        const d = req.body || {};
        const buf = await _pdfFacturaBuffer(d);
        const base = (d.numero && !/sin|—/i.test(String(d.numero))) ? `Factura-${String(d.numero).replace(/[^\w-]/g, '')}` : 'Factura';
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
        res.send(buf);
    } catch (e) {
        errorServidor(res, e, 'generarPdf');
    }
}

module.exports = { emitir, guardarBorrador, asignarNumero, enviarEmail, testEmail, actualizarLineas, emitirDesdePresupuesto, purgarHuerfanas, diagnostico, rectificar, getFactura, listarRectificativas, reasignarNumero, generarPdf };
