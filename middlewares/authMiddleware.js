/**
 * Middlewares de autorización por rol.
 *
 * El sistema actual propaga el rol y el usuario mediante cabeceras HTTP
 * (x-rol, x-user) que el frontend adjunta en cada petición.
 *
 * Cada función es un middleware Express estándar: (req, res, next) =>
 * Se compone en las rutas que lo necesiten, p.ej:
 *   router.delete('/ot/:id', soloAdmin, otController.eliminar);
 */

const ROLES = {
    ADMIN:    'admin',
    DIRECTOR: 'director',
    TECNICO:  'tecnico'
};

/** Cualquier usuario con sesión activa (cabeceras presentes). */
function autenticado(req, res, next) {
    if (!req.headers['x-rol'] || !req.headers['x-user']) {
        return res.status(401).json({ error: 'No autenticado. Inicia sesión.' });
    }
    // Inyectamos en req para que los controllers no tengan que leer cabeceras directamente
    req.usuario = {
        username: req.headers['x-user'],
        rol:      req.headers['x-rol']
    };
    next();
}

/** Solo CEO / CFO (rol admin). */
function soloAdmin(req, res, next) {
    if (req.headers['x-rol'] !== ROLES.ADMIN) {
        return res.status(403).json({ error: 'Acceso restringido: solo administradores.' });
    }
    req.usuario = { username: req.headers['x-user'], rol: req.headers['x-rol'] };
    next();
}

/** Admins + COO (rol director). Excluye técnicos. */
function adminODirector(req, res, next) {
    const rol = req.headers['x-rol'];
    if (rol !== ROLES.ADMIN && rol !== ROLES.DIRECTOR) {
        return res.status(403).json({ error: 'Acceso restringido: sin permisos suficientes.' });
    }
    req.usuario = { username: req.headers['x-user'], rol };
    next();
}

module.exports = { autenticado, soloAdmin, adminODirector, ROLES };
