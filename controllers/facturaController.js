const QRCode = require('qrcode');
const { db } = require('../config/db');

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
async function generarNumeroFactura() {
    const hoy  = new Date();
    const year = hoy.getFullYear();
    const mm   = String(hoy.getMonth() + 1).padStart(2, '0');
    const dd   = String(hoy.getDate()).padStart(2, '0');

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
        // Factura ya existente → inmutable
        const existing = await db.execute({
            sql:  `SELECT * FROM facturas WHERE ot_id = ?`,
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
        const textoQR        = `NIF:B-26892760|Factura:${numero_factura}|Fecha:${fecha}|Total:${total}EUR`;
        const qr             = await QRCode.toDataURL(textoQR);

        await db.execute({
            sql:  `INSERT INTO facturas (ot_id, base_imponible, iva, total, qr_data, fecha_emision, numero_factura)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: [ot_id, base_imponible, iva, total, qr, fecha, numero_factura]
        });

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
    const { emailDestino, asunto, htmlBody, pdfBase64, nombreArchivo, ot_id } = req.body;
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

        // Registrar envío en facturas.emails_enviados si hay ot_id
        if (ot_id) {
            try {
                const { rows } = await db.execute({
                    sql:  `SELECT emails_enviados FROM facturas WHERE ot_id = ?`,
                    args: [ot_id]
                });
                if (rows[0]) {
                    let arr = [];
                    try { arr = JSON.parse(rows[0].emails_enviados || '[]'); } catch { arr = []; }
                    arr.push({ email: emailDestino, fecha: new Date().toLocaleString('es-ES') });
                    await db.execute({
                        sql:  `UPDATE facturas SET emails_enviados=? WHERE ot_id=?`,
                        args: [JSON.stringify(arr), ot_id]
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
    const { ot_id, lineas } = req.body;
    try {
        await db.execute({
            sql:  `UPDATE facturas SET lineas=? WHERE ot_id=?`,
            args: [JSON.stringify(lineas || []), ot_id]
        });
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

        await db.execute({
            sql:  `INSERT INTO facturas (presupuesto_id, base_imponible, iva, total, fecha_emision, numero_factura, lineas)
                   VALUES (?,?,?,?,?,?,?)`,
            args: [presupuesto_id, base_imponible, iva, total, fecha, numero_factura, JSON.stringify(lineas || [])]
        });

        const campoTotal = tipo === 'proforma' ? ', proforma_total=?' : '';
        const args = tipo === 'proforma'
            ? [numero_factura, total, presupuesto_id]
            : [numero_factura, presupuesto_id];

        await db.execute({
            sql:  `UPDATE presupuestos SET ${campo}=?${campoTotal} WHERE id=?`,
            args
        });

        res.json({ ok: true, numero_factura, fecha_emision: fecha });
    } catch (e) {
        res.status(500).json({ error: 'Error al emitir desde presupuesto: ' + e.message });
    }
}

module.exports = { emitir, enviarEmail, testEmail, actualizarLineas, emitirDesdePresupuesto };
