const QRCode    = require('qrcode');
const { db }    = require('../config/db');
const verifactu = require('../services/verifactu');

// NIF emisor (sin guion, formato AEAT)
const NIF_EMISOR = (process.env.NIF_EMISOR || 'B26892760').replace(/-/g, '');
// VeriFactu: prewww2 = entorno pruebas, www2 = producción
const VERIFACTU_BASE = process.env.VERIFACTU_BASE
    || 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR';

/**
 * Genera la URL VeriFactu del QR según especificación AEAT.
 * Formato: BASE?nif=...&numserie=...&fecha=DD-MM-YYYY&importe=NN.NN
 */
function _urlVeriFactu(numero_factura, fechaISO, importe) {
    const [yyyy, mm, dd] = (fechaISO || '').split('-');
    const fechaParam = `${dd}-${mm}-${yyyy}`;
    const importeFmt = parseFloat(importe || 0).toFixed(2);
    const params = new URLSearchParams({
        nif:      NIF_EMISOR,
        numserie: numero_factura,
        fecha:    fechaParam,
        importe:  importeFmt
    });
    return `${VERIFACTU_BASE}?${params.toString()}`;
}

async function _generarQRVeriFactu(numero_factura, fechaISO, total) {
    const url = _urlVeriFactu(numero_factura, fechaISO, total);
    return await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 220 });
}

const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL
    || 'https://script.google.com/macros/s/AKfycbxwi8cCg4D0mGEK_Xh3V52AHMf31ESpvEbfmXgLNSw-k9GMt9_wauc3GicRqUvT9AkEow/exec';

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

/**
 * POST /api/factura
 * Body: { ot_id, codigo_ot, base_imponible, iva, total }
 * Si ya existe una factura para este ot_id, devuelve la existente (inmutable).
 * Si no, genera número secuencial, guarda y devuelve.
 */
async function emitir(req, res) {
    const { ot_id, codigo_ot, base_imponible, iva, total } = req.body;

    try {
        // Factura ACTIVA (regular y no rectificada) → idempotente.
        // Si la original fue rectificada se permite emitir una nueva con el siguiente correlativo.
        const existing = await db.execute({
            sql:  `SELECT * FROM facturas
                   WHERE ot_id = ?
                     AND COALESCE(es_rectificativa, 0) = 0
                     AND rectificada_por_id IS NULL
                   ORDER BY id DESC LIMIT 1`,
            args: [ot_id]
        });
        if (existing.rows.length > 0) {
            const f = existing.rows[0];
            return res.json({
                mensaje:        'Factura ya registrada',
                qr_data:        f.qr_data,
                numero_factura: f.numero_factura,
                fecha_emision:  f.fecha_emision
            });
        }

        const fecha          = new Date().toISOString().split('T')[0];
        const numero_factura = await generarNumeroFactura();
        const qr             = await _generarQRVeriFactu(numero_factura, fecha, total);

        const r = await db.execute({
            sql:  `INSERT INTO facturas (ot_id, base_imponible, iva, total, qr_data, fecha_emision, numero_factura)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: [ot_id, base_imponible, iva, total, qr, fecha, numero_factura]
        });

        // Envío async a AEAT (no bloquea respuesta)
        const facturaId = Number(r.lastInsertRowid);
        verifactu.enviarFactura(facturaId)
            .then(rs => console.log(`📤 AEAT ${numero_factura}: ${rs.estado || (rs.ok?'OK':'ERROR')} ${rs.csv?'CSV='+rs.csv:''} ${rs.error?'ERR='+rs.error:''}`))
            .catch(e  => console.error(`📤 AEAT ${numero_factura} fallo:`, e.message));

        res.json({ mensaje: 'Factura emitida', qr_data: qr, numero_factura, fecha_emision: fecha });
    } catch (e) {
        res.status(500).json({ error: 'Error al emitir la factura: ' + e.message });
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
        if (factura_id) {
            await db.execute({
                sql:  `UPDATE facturas SET lineas=? WHERE id=?`,
                args: [JSON.stringify(lineas || []), factura_id]
            });
        } else {
            // Actualiza la regular (no rectificativa) por ot_id
            await db.execute({
                sql:  `UPDATE facturas SET lineas=? WHERE ot_id=? AND COALESCE(es_rectificativa,0)=0`,
                args: [JSON.stringify(lineas || []), ot_id]
            });
        }
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: 'Error al guardar líneas: ' + e.message });
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

        const qr = await _generarQRVeriFactu(numero_factura, fecha, total);
        const r = await db.execute({
            sql:  `INSERT INTO facturas (presupuesto_id, base_imponible, iva, total, fecha_emision, numero_factura, lineas, qr_data)
                   VALUES (?,?,?,?,?,?,?,?)`,
            args: [presupuesto_id, base_imponible, iva, total, fecha, numero_factura, JSON.stringify(lineas || []), qr]
        });

        // Envío async a AEAT
        const facturaId = Number(r.lastInsertRowid);
        verifactu.enviarFactura(facturaId)
            .then(rs => console.log(`📤 AEAT ${numero_factura}: ${rs.estado || (rs.ok?'OK':'ERROR')} ${rs.csv?'CSV='+rs.csv:''} ${rs.error?'ERR='+rs.error:''}`))
            .catch(e  => console.error(`📤 AEAT ${numero_factura} fallo:`, e.message));

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
        res.status(500).json({ error: 'Error al emitir desde presupuesto: ' + e.message });
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
        res.status(500).json({ error: e.message });
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
        res.status(500).json({ error: e.message });
    }
}

/**
 * POST /api/facturas/:id/aeat-reenviar
 * Reenvía a AEAT una factura (útil tras error o ERROR previo).
 */
async function reenviarAEAT(req, res) {
    const { id } = req.params;
    try {
        const r = await verifactu.enviarFactura(parseInt(id));
        res.json(r);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * GET /api/facturas/:id/aeat-estado
 * Devuelve el estado AEAT de una factura.
 */
async function estadoAEAT(req, res) {
    const { id } = req.params;
    try {
        const { rows } = await db.execute({
            sql:  `SELECT id, numero_factura, aeat_estado, aeat_csv, aeat_huella, aeat_huella_anterior,
                          aeat_fecha_envio, aeat_error, aeat_intentos, aeat_respuesta
                   FROM facturas WHERE id=?`,
            args: [id]
        });
        if (!rows[0]) return res.status(404).json({ error: 'No encontrada' });
        res.json(rows[0]);
    } catch (e) {
        res.status(500).json({ error: e.message });
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
        const qr      = await _generarQRVeriFactu(numeroR, fecha, total);

        const r = await db.execute({
            sql:  `INSERT INTO facturas
                   (ot_id, presupuesto_id, base_imponible, iva, total, qr_data, fecha_emision, numero_factura, lineas,
                    es_rectificativa, factura_rectificada_id, motivo_rectificacion)
                   VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`,
            args: [
                orig.ot_id, orig.presupuesto_id,
                base_imponible, iva, total, qr, fecha, numeroR,
                JSON.stringify(lineas || []),
                orig.id, motivo || ''
            ]
        });

        const newId = Number(r.lastInsertRowid);
        await db.execute({
            sql:  `UPDATE facturas SET rectificada_por_id=? WHERE id=?`,
            args: [newId, orig.id]
        });

        // Envío AEAT async (no bloquea)
        verifactu.enviarFactura(newId)
            .then(rs => console.log(`📤 AEAT ${numeroR}: ${rs.estado || (rs.ok?'OK':'ERROR')} ${rs.csv?'CSV='+rs.csv:''}`))
            .catch(e  => console.error(`📤 AEAT ${numeroR} fallo:`, e.message));

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
        res.status(500).json({ error: e.message });
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
                         orig.numero_factura AS rectifica_a_numero
                  FROM facturas f
                  LEFT JOIN ordenes_trabajo ot ON ot.id = f.ot_id
                  LEFT JOIN presupuestos    p  ON p.id  = f.presupuesto_id
                  LEFT JOIN facturas        orig ON orig.id = f.factura_rectificada_id
                  WHERE f.id = ?`,
            args: [id]
        });
        if (!rows[0]) return res.status(404).json({ error: 'Factura no encontrada' });
        res.json(rows[0]);
    } catch (e) {
        res.status(500).json({ error: e.message });
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
        res.status(500).json({ error: e.message });
    }
}

module.exports = { emitir, enviarEmail, testEmail, actualizarLineas, emitirDesdePresupuesto, purgarHuerfanas, diagnostico, reenviarAEAT, estadoAEAT, rectificar, getFactura, listarRectificativas };
