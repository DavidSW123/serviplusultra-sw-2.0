const { db } = require('../config/db');

/**
 * POST /api/login
 * Body: { username, password }
 * Público — no requiere middleware de auth.
 */
async function login(req, res) {
    try {
        const { username, password } = req.body;
        const result = await db.execute({
            sql:  `SELECT username, rol, foto FROM usuarios WHERE username = ? AND password = ?`,
            args: [username, password]
        });

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }

        const usuario = result.rows[0];
        res.json({
            mensaje:  'Login exitoso',
            username: usuario.username,
            rol:      usuario.rol,
            foto:     usuario.foto
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * PUT /api/usuarios/foto
 * Body: { username, foto }  (foto en base64)
 */
async function actualizarFoto(req, res) {
    try {
        const { username, foto } = req.body;
        await db.execute({
            sql:  `UPDATE usuarios SET foto = ? WHERE username = ?`,
            args: [foto, username]
        });
        res.json({ mensaje: 'Foto actualizada' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * PUT /api/usuarios/password
 * Body: { username, oldPass, newPass }
 */
async function cambiarPassword(req, res) {
    try {
        const { username, oldPass, newPass } = req.body;
        const check = await db.execute({
            sql:  `SELECT id FROM usuarios WHERE username = ? AND password = ?`,
            args: [username, oldPass]
        });

        if (check.rows.length === 0) {
            return res.status(400).json({ error: 'Clave actual incorrecta' });
        }

        await db.execute({
            sql:  `UPDATE usuarios SET password = ? WHERE username = ?`,
            args: [newPass, username]
        });
        res.json({ mensaje: 'Contraseña cambiada' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

/**
 * POST /api/usuarios/tecnico
 * Body: { username, password }
 * Requiere rol admin o director (aplicado en la ruta).
 */
async function crearTecnico(req, res) {
    try {
        const { username, password } = req.body;
        await db.execute({
            sql:  `INSERT INTO usuarios (username, password, rol) VALUES (?, ?, 'tecnico')`,
            args: [username, password]
        });
        res.json({ mensaje: 'Técnico creado' });
    } catch (e) {
        // UNIQUE constraint
        res.status(500).json({ error: 'El usuario ya existe' });
    }
}

/**
 * GET /api/usuarios/nombres
 * Devuelve lista de { username, rol } para los selectores de técnicos.
 */
async function getNombres(req, res) {
    try {
        const result = await db.execute(
            `SELECT username, rol FROM usuarios ORDER BY rol, username`
        );
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

module.exports = { login, actualizarFoto, cambiarPassword, crearTecnico, getNombres };
