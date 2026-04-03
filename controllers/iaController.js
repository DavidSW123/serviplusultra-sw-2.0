/**
 * POST /api/ia/escanear-ticket
 * Body: { imagenBase64 }
 *
 * Envía la imagen a Gemini 2.5 Flash y devuelve las líneas de compra
 * con la base imponible ya calculada (sin IVA).
 */
async function escanearTicket(req, res) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'Falta GEMINI_API_KEY en las variables de entorno.' });
    }

    try {
        const { imagenBase64 } = req.body;

        // Extraemos el mimeType del data URI y dejamos solo los bytes en base64
        const mimeMatch = imagenBase64.match(/^data:(image\/\w+);base64,/);
        const mimeType  = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const b64Limpio = imagenBase64.replace(/^data:image\/\w+;base64,/, '');

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const prompt = `Actúa como un contable experto español. Analiza este ticket o factura.
Necesito que extraigas cada producto comprado pero SIN EL IVA.

INSTRUCCIONES CLAVE:
1. Para cada línea, localiza el importe total de ese producto.
2. Descuenta el IVA correspondiente (normalmente 21%, 10% o 4%) para obtener la BASE IMPONIBLE.
3. Si el ticket ya muestra la base imponible por separado, úsala directamente.
4. Devuelve ÚNICAMENTE un array en formato JSON con esta estructura:
[{"descripcion": "nombre del producto", "cantidad": 1, "precio": 10.50}]

REGLAS DE ORO:
- El campo 'precio' debe ser SIEMPRE la BASE IMPONIBLE TOTAL de la línea (Cantidad x Precio Unitario sin IVA).
- No incluyas descuentos ni el total final del ticket como un producto.
- Responde SOLO con el JSON crudo, sin bloques de código ni texto adicional.`;

        const payload = {
            contents: [{
                parts: [
                    { text: prompt },
                    { inlineData: { mimeType, data: b64Limpio } }
                ]
            }],
            generationConfig: { responseMimeType: 'application/json' }
        };

        const response = await fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(500).json({ error: `Error de Google: ${data.error?.message}` });
        }

        // Limpiamos posibles bloques markdown que Gemini pueda añadir
        let texto = data.candidates[0].content.parts[0].text;
        texto = texto.replace(/```json/gi, '').replace(/```/g, '').trim();

        const lineas = JSON.parse(texto);
        res.json({ lineas });

    } catch (e) {
        console.error('Error en escaneo IA:', e);
        res.status(500).json({ error: `Fallo al procesar el ticket: ${e.message}` });
    }
}

module.exports = { escanearTicket };
