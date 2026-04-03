const QRCode = require('qrcode');
const { db } = require('../config/db');

// Relay de email via Google Apps Script (sin credenciales SMTP expuestas)
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL
    || 'https://script.google.com/macros/s/AKfycbxwi8cCg4D0mGEK_Xh3V52AHMf31ESpvEbfmXgLNSw-k9GMt9_wauc3GicRqUvT9AkEow/exec';

/**
 * POST /api/factura
 * Body: { ot_id, codigo_ot, base_imponible, iva, total }
 * Genera QR, guarda la factura y devuelve el QR en base64.
 */
async function emitir(req, res) {
    const { ot_id, codigo_ot, base_imponible, iva, total } = req.body;
    const fecha = new Date().toISOString().split('T')[0];
    const textoQR = `NIF:B-26892760|FacturaRef:${codigo_ot}|Fecha:${fecha}|Total:${total}EUR`;

    try {
        const qr = await QRCode.toDataURL(textoQR);
        await db.execute({
            sql:  `INSERT INTO facturas (ot_id, base_imponible, iva, total, qr_data, fecha_emision)
                   VALUES (?, ?, ?, ?, ?, ?)`,
            args: [ot_id, base_imponible, iva, total, qr, fecha]
        });
        res.json({ mensaje: 'Factura emitida', qr_data: qr });
    } catch (e) {
        res.status(500).json({ error: 'Error al generar QR o guardar factura.' });
    }
}

/**
 * POST /api/enviar-factura
 * Body: { emailDestino, asunto, htmlBody, pdfBase64, nombreArchivo }
 * Envía la factura PDF al cliente vía el relay de Google Apps Script.
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
        res.json({ mensaje: 'Factura enviada con éxito al cliente por correo electrónico. 🚀' });
    } catch (e) {
        res.status(500).json({ error: 'Fallo de conexión al enviar la factura.' });
    }
}

/**
 * POST /api/test-email
 * Body: { emailDestino }
 * Envía un correo de prueba para verificar el relay.
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
        res.json({ mensaje: 'Correo enviado con éxito. ¡Revisa tu bandeja de entrada! 😎' });
    } catch (e) {
        res.status(500).json({ error: 'Fallo al enviar el correo por el puente.' });
    }
}

module.exports = { emitir, enviarEmail, testEmail };
