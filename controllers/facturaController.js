const QRCode = require('qrcode');
const { db } = require('../config/db');

const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL
    || 'https://script.google.com/macros/s/AKfycbxwi8cCg4D0mGEK_Xh3V52AHMf31ESpvEbfmXgLNSw-k9GMt9_wauc3GicRqUvT9AkEow/exec';

/**
 * Genera el número de factura secuencial del año actual.
 * Formato: XX-YYYYMMDD  (XX crece a 3/4 dígitos automáticamente)
 * El contador se reinicia cada año.
 */
async function generarNumeroFactura() {
    const hoy  = new Date();
    const year = hoy.getFullYear();
    const mm   = String(hoy.getMonth() + 1).padStart(2, '0');
    const dd   = String(hoy.getDate()).padStart(2, '0');

    const { rows } = await db.execute({
        sql:  `SELECT MAX(CAST(SUBSTR(numero_factura, 1, INSTR(numero_factura, '-') - 1) AS INTEGER)) AS max_seq
               FROM facturas
               WHERE numero_factura IS NOT NULL
                 AND SUBSTR(numero_factura, INSTR(numero_factura, '-') + 1, 4) = ?`,
        args: [String(year)]
    });

    const seq    = (rows[0].max_seq || 0) + 1;
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
    const { emailDestino, asunto, htmlBody, pdfBase64, nombreArchivo } = req.body;
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

module.exports = { emitir, enviarEmail, testEmail };
