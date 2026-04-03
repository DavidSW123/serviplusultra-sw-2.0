const { db }           = require('../config/db');
const { registrarLog } = require('../utils/registrarLog');

const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL
    || 'https://script.google.com/macros/s/AKfycbxwi8cCg4D0mGEK_Xh3V52AHMf31ESpvEbfmXgLNSw-k9GMt9_wauc3GicRqUvT9AkEow/exec';

// ── Helpers ────────────────────────────────────────────────────

function _ahora() { return new Date().toLocaleString('es-ES'); }

/** Genera referencia PRES{YY}/NNNNN */
async function _generarReferencia() {
    const yy   = new Date().getFullYear().toString().slice(-2);
    const { rows } = await db.execute(`
        SELECT COUNT(*) AS total FROM presupuestos
        WHERE referencia LIKE 'PRES${yy}/%'
    `);
    const n = (parseInt(rows[0].total) || 0) + 1;
    return `PRES${yy}/${String(n).padStart(5, '0')}`;
}

// ── CRUD ───────────────────────────────────────────────────────

async function getAll(req, res) {
    try {
        const { rows } = await db.execute(`
            SELECT p.*, c.nombre AS cliente_nombre, c.email AS cliente_email,
                   c.nif AS cliente_nif, c.direccion AS cliente_direccion
            FROM presupuestos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            ORDER BY p.id DESC
        `);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

async function crear(req, res) {
    const { cliente_id, descripcion, lineas, base_imponible, iva, total, notas } = req.body;
    const usuario = req.headers['x-user'] || 'desconocido';
    try {
        const referencia = await _generarReferencia();
        const fecha      = _ahora();
        await db.execute({
            sql:  `INSERT INTO presupuestos
                   (referencia, cliente_id, descripcion, lineas, base_imponible, iva, total, notas, estado, fecha_creacion)
                   VALUES (?,?,?,?,?,?,?,?,'BORRADOR',?)`,
            args: [referencia, cliente_id || null, descripcion || '', JSON.stringify(lineas || []),
                   base_imponible || 0, iva || 0, total || 0, notas || '', fecha]
        });
        await registrarLog(usuario, 'Crear presupuesto', referencia, { referencia, cliente_id, total });
        res.json({ ok: true, referencia });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

async function editar(req, res) {
    const { id } = req.params;
    const { descripcion, lineas, base_imponible, iva, total, notas, cliente_id } = req.body;
    const usuario = req.headers['x-user'] || 'desconocido';
    try {
        await db.execute({
            sql:  `UPDATE presupuestos SET descripcion=?, lineas=?, base_imponible=?, iva=?, total=?, notas=?, cliente_id=?
                   WHERE id=?`,
            args: [descripcion || '', JSON.stringify(lineas || []), base_imponible || 0,
                   iva || 0, total || 0, notas || '', cliente_id || null, id]
        });
        await registrarLog(usuario, 'Editar presupuesto', `ID:${id}`, { id, total });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

async function cambiarEstado(req, res) {
    const { id } = req.params;
    const { estado } = req.body;
    const usuario = req.headers['x-user'] || 'desconocido';
    const estadosValidos = ['BORRADOR', 'ENVIADO', 'ACEPTADO', 'RECHAZADO'];
    if (!estadosValidos.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
    try {
        const extra = estado === 'ENVIADO' ? `, fecha_envio = '${_ahora()}'` : '';
        await db.execute({ sql: `UPDATE presupuestos SET estado=?${extra} WHERE id=?`, args: [estado, id] });
        await registrarLog(usuario, 'Cambiar estado presupuesto', `ID:${id}`, { estado });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

async function eliminar(req, res) {
    const { id } = req.params;
    const usuario = req.headers['x-user'] || 'desconocido';
    try {
        const { rows } = await db.execute({ sql: `SELECT referencia FROM presupuestos WHERE id=?`, args: [id] });
        const ref = rows[0]?.referencia || id;
        await db.execute({ sql: `DELETE FROM presupuestos WHERE id=?`, args: [id] });
        await registrarLog(usuario, 'Eliminar presupuesto', ref, { id });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/** Convierte un presupuesto ACEPTADO en Orden de Trabajo */
async function convertirAOT(req, res) {
    const { id } = req.params;
    const { tecnicos_nombres, fecha_encargo } = req.body;
    const usuario = req.headers['x-user'] || 'desconocido';
    try {
        const { rows } = await db.execute({ sql: `SELECT * FROM presupuestos WHERE id=?`, args: [id] });
        if (!rows[0]) return res.status(404).json({ error: 'Presupuesto no encontrado' });
        const p = rows[0];
        if (p.estado !== 'ACEPTADO') return res.status(400).json({ error: 'Solo se pueden convertir presupuestos ACEPTADOS' });

        // Generar código OT
        const yy = new Date().getFullYear().toString().slice(-2);
        const { rows: rOT } = await db.execute(`SELECT COUNT(*) AS total FROM ordenes_trabajo WHERE codigo_ot LIKE 'OT${yy}/%'`);
        const nOT     = (parseInt(rOT[0].total) || 0) + 1;
        const codigoOT = `OT${yy}/${String(nOT).padStart(5, '0')}`;

        const lineas = JSON.parse(p.lineas || '[]');
        const costoMat = lineas.reduce((acc, l) => acc + (parseFloat(l.importe) || 0), 0);
        const fecha = fecha_encargo || _ahora();

        await db.execute({
            sql:  `INSERT INTO ordenes_trabajo
                   (codigo_ot, fecha_encargo, horas, num_tecnicos, marca, tipo_urgencia, materiales_precio, estado, cliente_id, tecnicos_nombres)
                   VALUES (?,?,0,1,?,?,?,?,?,?)`,
            args: [codigoOT, fecha, p.descripcion || '', 'NORMAL', costoMat, 'PENDIENTE', p.cliente_id, tecnicos_nombres || '']
        });

        const { rows: rNew } = await db.execute({ sql: `SELECT id FROM ordenes_trabajo WHERE codigo_ot=?`, args: [codigoOT] });
        const otId = rNew[0].id;

        // Insertar líneas como adjuntos
        for (const l of lineas) {
            await db.execute({
                sql:  `INSERT INTO ot_adjuntos (ot_id, imagen, importe, descripcion, fecha) VALUES (?,?,?,?,?)`,
                args: [otId, '', parseFloat(l.importe) || 0, l.descripcion || '', _ahora()]
            });
        }

        // Marcar presupuesto como convertido
        await db.execute({ sql: `UPDATE presupuestos SET estado='CONVERTIDO' WHERE id=?`, args: [id] });

        await registrarLog(usuario, 'Convertir presupuesto a OT', p.referencia, { codigoOT });
        res.json({ ok: true, codigoOT });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

async function enviarEmail(req, res) {
    const { id } = req.params;
    const { pdfBase64 } = req.body;
    const usuario = req.headers['x-user'] || 'desconocido';
    try {
        const { rows } = await db.execute({
            sql:  `SELECT p.*, c.email, c.nombre AS cliente_nombre FROM presupuestos p LEFT JOIN clientes c ON p.cliente_id=c.id WHERE p.id=?`,
            args: [id]
        });
        if (!rows[0]) return res.status(404).json({ error: 'Presupuesto no encontrado' });
        const p = rows[0];
        if (!p.email) return res.status(400).json({ error: 'El cliente no tiene email' });

        const resp = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to:       p.email,
                subject:  `Presupuesto ${p.referencia} — ServiPlusUltra Solutions S.L.`,
                body:     `Hola ${p.cliente_nombre},\n\nAdjunto encontrará el presupuesto ${p.referencia}.\n\nServiPlusUltra Solutions S.L.\nB-26892760`,
                pdf:      pdfBase64,
                filename: `${p.referencia.replace('/', '-')}.pdf`
            })
        });

        if (!resp.ok) throw new Error('Error al enviar el email');
        await db.execute({ sql: `UPDATE presupuestos SET estado='ENVIADO', fecha_envio=? WHERE id=?`, args: [_ahora(), id] });
        await registrarLog(usuario, 'Enviar presupuesto por email', p.referencia, { email: p.email });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

module.exports = { getAll, crear, editar, cambiarEstado, eliminar, convertirAOT, enviarEmail };
