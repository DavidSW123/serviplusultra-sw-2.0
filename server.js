const env       = require('./config/env');
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path         = require('path');

const { inicializarDB } = require('./config/db');
const apiRoutes         = require('./routes/apiRoutes');

const app  = express();
const PORT = env.PORT;

// ── Detrás del proxy TLS de Render ─────────────────────────────
app.set('trust proxy', 1);

// ── Seguridad de cabeceras ─────────────────────────────────────
// CSP desactivada de momento: el frontend usa muchos handlers/estilos inline
// que una CSP estricta rompería. Se endurecerá al limpiar el inline (fase posterior).
app.use(helmet({ contentSecurityPolicy: false }));

// ── CORS restringido al dominio propio ─────────────────────────
app.use(cors({ origin: env.APP_ORIGIN, credentials: true }));

app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ── Rate limiting ──────────────────────────────────────────────
// Límite global generoso para uso normal de la API.
const limitadorGlobal = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false
});
// Límite estricto para endpoints sensibles (fuerza bruta / abuso).
const limitadorAuth = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }
});

app.use('/api/login',              limitadorAuth);
app.use('/api/recuperar-password', limitadorAuth);
app.use('/api',                    limitadorGlobal);

// ── Rutas API ──────────────────────────────────────────────────
app.use('/api', apiRoutes);

// ── Páginas HTML ───────────────────────────────────────────────
app.get('/',              (_req, res) => res.sendFile(path.join(__dirname, 'public', 'hub.html')));
app.get('/facturas',      (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/contabilidad',  (_req, res) => res.sendFile(path.join(__dirname, 'public', 'contabilidad.html')));
app.get('/presupuestos',  (_req, res) => res.sendFile(path.join(__dirname, 'public', 'presupuestos.html')));
app.get('/bbdd',          (_req, res) => res.sendFile(path.join(__dirname, 'public', 'bbdd.html')));
app.get('/login',         (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// ── Arranque ───────────────────────────────────────────────────
inicializarDB().then(() => {
    app.listen(PORT, () => console.log(`🚀 ServiPlusUltra V2 listo en el puerto ${PORT}`));
});
