const { db } = require('../config/db');
const jwt    = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');

const DURACION_SESION = 7 * 24 * 60 * 60; // 7 días en segundos

/** Opciones de la cookie de sesión. `secure` se activa solo bajo HTTPS (Render). */
function _opcionesCookie(req) {
    return {
        httpOnly: true,
        secure:   req.secure,
        sameSite: 'strict',
        maxAge:   DURACION_SESION * 1000
    };
}

/**
 * POST /api/login
 * Body: { username, password }
 * Verifica credenciales y emite una cookie de sesión firmada (JWT).
 * (El hash de contraseñas llega en el Bloque 2; de momento compara el valor guardado.)
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
        const token = jwt.sign(
            { username: usuario.username, rol: usuario.rol },
            JWT_SECRET,
            { expiresIn: DURACION_SESION }
        );
        res.cookie('token', token, _opcionesCookie(req));

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

/** POST /api/logout — borra la cookie de sesión. */
function logout(req, res) {
    res.clearCookie('token', { httpOnly: true, secure: req.secure, sameSite: 'strict' });
    res.json({ ok: true });
}

/** GET /api/me — devuelve el usuario de la sesión actual (tras middleware autenticado). */
function me(req, res) {
    res.json({ username: req.usuario.username, rol: req.usuario.rol });
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

/**
 * POST /api/recuperar-password
 * Body: { username }
 * Genera una contraseña temporal y la envía al email de la empresa.
 * Público — no requiere autenticación (es el flujo de "olvidé mi contraseña").
 */
async function recuperarPassword(req, res) {
    try {
        const { username } = req.body;
        if (!username || !username.trim()) {
            return res.status(400).json({ error: 'Indica un nombre de usuario.' });
        }

        // Verificar que el usuario existe
        const check = await db.execute({
            sql:  `SELECT username FROM usuarios WHERE username = ?`,
            args: [username.trim()]
        });
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }

        // Generar contraseña temporal (12 chars, sin caracteres confusos)
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        let tempPass = '';
        for (let i = 0; i < 12; i++) tempPass += chars[Math.floor(Math.random() * chars.length)];

        // Actualizar BBDD
        await db.execute({
            sql:  `UPDATE usuarios SET password = ? WHERE username = ?`,
            args: [tempPass, username.trim()]
        });

        // Enviar email al correo corporativo
        const { GOOGLE_SCRIPT_URL } = require('../config/env');
        const emailEmpresa = 'serviplusultrasolutionssl@gmail.com';

        try {
            await fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to:      emailEmpresa,
                    subject: `🔑 Recuperación de contraseña — ${username}`,
                    html: `
                        <div style="font-family:Arial; padding:20px; max-width:500px;">
                            <h2 style="color:#2c3e50;">Recuperación de contraseña — ServiPlusUltra</h2>
                            <p>Se ha solicitado un restablecimiento de contraseña para el usuario:</p>
                            <p style="background:#f4f6f7; padding:10px; border-radius:6px;">
                                <strong>Usuario:</strong> ${username}
                            </p>
                            <p>Esta es la nueva contraseña temporal:</p>
                            <p style="background:#fffbe6; padding:15px; border-radius:6px; font-family:monospace; font-size:1.3em; text-align:center; letter-spacing:2px; border:2px dashed #f39c12;">
                                <strong>${tempPass}</strong>
                            </p>
                            <p style="color:#7f8c8d; font-size:0.9em;">
                                <strong>Importante:</strong> al iniciar sesión, cambia esta contraseña por una propia desde tu perfil.<br>
                                Si no has solicitado este cambio, contacta inmediatamente con el administrador.
                            </p>
                            <p style="color:#95a5a6; font-size:0.8em; margin-top:30px;">
                                Solicitud realizada el ${new Date().toLocaleString('es-ES')}.
                            </p>
                        </div>
                    `
                })
            });
        } catch (mailErr) {
            // El password se ha cambiado igualmente. Logueamos el error pero no rompemos el flujo.
            console.error('Error enviando email de recuperación:', mailErr.message);
            return res.status(500).json({ error: 'Contraseña reseteada pero falló el envío del email. Contacta con el administrador.' });
        }

        res.json({ ok: true, mensaje: 'Contraseña temporal enviada al correo de la empresa.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

module.exports = { login, logout, me, actualizarFoto, cambiarPassword, crearTecnico, getNombres, recuperarPassword };
