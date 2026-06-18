const { db } = require('../config/db');
const { errorServidor } = require('../utils/responder');
const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { JWT_SECRET, APP_ORIGIN, GOOGLE_SCRIPT_URL } = require('../config/env');

const EMAIL_EMPRESA = 'serviplusultrasolutionssl@gmail.com';

const BCRYPT_ROUNDS = 12;
/** ¿El valor guardado ya es un hash bcrypt? */
function esHash(v) { return typeof v === 'string' && v.startsWith('$2'); }

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
            sql:  `SELECT id, username, rol, foto, password FROM usuarios WHERE username = ?`,
            args: [username]
        });

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }

        const usuario  = result.rows[0];
        const guardada = usuario.password || '';

        // Verificación con migración perezosa: si la contraseña aún está en texto
        // plano, se compara directamente y se re-hashea para la próxima vez.
        let ok;
        if (esHash(guardada)) {
            ok = await bcrypt.compare(password, guardada);
        } else {
            ok = (password === guardada);
            if (ok) {
                const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
                await db.execute({ sql: `UPDATE usuarios SET password=? WHERE id=?`, args: [hash, usuario.id] });
            }
        }
        if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' });

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
        errorServidor(res, e);
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
        errorServidor(res, e);
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
            sql:  `SELECT id, password FROM usuarios WHERE username = ?`,
            args: [username]
        });

        if (check.rows.length === 0) {
            return res.status(400).json({ error: 'Clave actual incorrecta' });
        }
        const guardada = check.rows[0].password || '';
        const ok = esHash(guardada) ? await bcrypt.compare(oldPass, guardada) : (oldPass === guardada);
        if (!ok) {
            return res.status(400).json({ error: 'Clave actual incorrecta' });
        }

        const hash = await bcrypt.hash(newPass, BCRYPT_ROUNDS);
        await db.execute({
            sql:  `UPDATE usuarios SET password = ? WHERE username = ?`,
            args: [hash, username]
        });
        res.json({ mensaje: 'Contraseña cambiada' });
    } catch (e) {
        errorServidor(res, e);
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
        const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await db.execute({
            sql:  `INSERT INTO usuarios (username, password, rol) VALUES (?, ?, 'tecnico')`,
            args: [username, hash]
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
        errorServidor(res, e);
    }
}

/**
 * POST /api/recuperar-password
 * Body: { username }
 * Genera un enlace de un solo uso (token) y lo envía al correo de la empresa.
 * NO cambia la contraseña; el admin abre el enlace y fija la nueva.
 * Respuesta SIEMPRE genérica (anti-enumeración). Público.
 */
async function recuperarPassword(req, res) {
    const GENERICO = { ok: true, mensaje: 'Si el usuario existe, se ha enviado un enlace de restablecimiento al correo de la empresa.' };
    try {
        const username = (req.body.username || '').trim();
        if (!username) return res.json(GENERICO);

        const check = await db.execute({ sql: `SELECT id FROM usuarios WHERE username = ?`, args: [username] });
        if (check.rows.length === 0) return res.json(GENERICO); // no revelar si existe

        // Token de un solo uso: se guarda solo su hash; caduca en 1 hora.
        const token     = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expira    = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        await db.execute({
            sql:  `UPDATE usuarios SET reset_token_hash = ?, reset_token_expira = ? WHERE id = ?`,
            args: [tokenHash, expira, check.rows[0].id]
        });

        const enlace = `${APP_ORIGIN}/reset-password?token=${token}`;
        try {
            await fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to:      EMAIL_EMPRESA,
                    subject: `🔑 Restablecer contraseña — ${username}`,
                    html: `
                        <div style="font-family:Arial; padding:20px; max-width:520px;">
                            <h2 style="color:#2c3e50;">Restablecer contraseña — ServiPlusUltra</h2>
                            <p>Se ha solicitado restablecer la contraseña del usuario <strong>${username}</strong>.</p>
                            <p>Pulsa el botón para fijar una nueva contraseña (enlace válido 1 hora, un solo uso):</p>
                            <p style="text-align:center; margin:24px 0;">
                                <a href="${enlace}" style="background:#1abc9c; color:#fff; padding:12px 22px; border-radius:6px; text-decoration:none; font-weight:bold;">Establecer nueva contraseña</a>
                            </p>
                            <p style="color:#7f8c8d; font-size:0.85em;">Si el botón no funciona, copia este enlace:<br><span style="word-break:break-all;">${enlace}</span></p>
                            <p style="color:#95a5a6; font-size:0.8em; margin-top:24px;">
                                Si no has solicitado este cambio, ignora este correo.<br>
                                Solicitud realizada el ${new Date().toLocaleString('es-ES')}.
                            </p>
                        </div>
                    `
                })
            });
        } catch (mailErr) {
            console.error('Error enviando email de recuperación:', mailErr.message);
            // No revelamos el fallo al cliente (anti-enumeración); el token queda guardado.
        }

        return res.json(GENERICO);
    } catch (e) {
        errorServidor(res, e);
    }
}

/**
 * POST /api/reset-password
 * Body: { token, newPass }
 * Valida el token de un solo uso y fija la nueva contraseña (hasheada). Público.
 */
async function resetPassword(req, res) {
    try {
        const { token, newPass } = req.body;
        if (!token || !newPass) return res.status(400).json({ error: 'Faltan datos.' });
        if (String(newPass).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });

        const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
        const r = await db.execute({
            sql:  `SELECT id, reset_token_expira FROM usuarios WHERE reset_token_hash = ?`,
            args: [tokenHash]
        });
        if (r.rows.length === 0) return res.status(400).json({ error: 'Enlace inválido o ya utilizado.' });

        const user = r.rows[0];
        if (!user.reset_token_expira || new Date(user.reset_token_expira) < new Date()) {
            return res.status(400).json({ error: 'El enlace ha caducado. Solicita uno nuevo.' });
        }

        const hash = await bcrypt.hash(newPass, BCRYPT_ROUNDS);
        await db.execute({
            sql:  `UPDATE usuarios SET password = ?, reset_token_hash = NULL, reset_token_expira = NULL WHERE id = ?`,
            args: [hash, user.id]
        });
        res.json({ ok: true, mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
    } catch (e) {
        errorServidor(res, e);
    }
}

module.exports = { login, logout, me, actualizarFoto, cambiarPassword, crearTecnico, getNombres, recuperarPassword, resetPassword };
