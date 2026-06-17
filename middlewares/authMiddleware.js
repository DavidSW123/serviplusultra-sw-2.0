/**
 * Middlewares de autorización por rol.
 *
 * La sesión viaja en una cookie httpOnly firmada (JWT). El usuario y el rol se
 * derivan SOLO del token verificado en el servidor — nunca de cabeceras que
 * pueda poner el cliente. Un token ausente/inválido/caducado => 401.
 */

const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');

const ROLES = {
    ADMIN:    'admin',
    DIRECTOR: 'director',
    TECNICO:  'tecnico'
};

/** Devuelve el payload verificado de la cookie, o null si no es válido. */
function _sesion(req) {
    const token = req.cookies && req.cookies.token;
    if (!token) return null;
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (_) {
        return null;
    }
}

/** Cualquier usuario con sesión válida. */
function autenticado(req, res, next) {
    const u = _sesion(req);
    if (!u) return res.status(401).json({ error: 'No autenticado. Inicia sesión.' });
    req.usuario = { username: u.username, rol: u.rol };
    next();
}

/** Solo rol admin. */
function soloAdmin(req, res, next) {
    const u = _sesion(req);
    if (!u) return res.status(401).json({ error: 'No autenticado. Inicia sesión.' });
    if (u.rol !== ROLES.ADMIN) {
        return res.status(403).json({ error: 'Acceso restringido: solo administradores.' });
    }
    req.usuario = { username: u.username, rol: u.rol };
    next();
}

/** Admins + director. Excluye técnicos. */
function adminODirector(req, res, next) {
    const u = _sesion(req);
    if (!u) return res.status(401).json({ error: 'No autenticado. Inicia sesión.' });
    if (u.rol !== ROLES.ADMIN && u.rol !== ROLES.DIRECTOR) {
        return res.status(403).json({ error: 'Acceso restringido: sin permisos suficientes.' });
    }
    req.usuario = { username: u.username, rol: u.rol };
    next();
}

module.exports = { autenticado, soloAdmin, adminODirector, ROLES };
