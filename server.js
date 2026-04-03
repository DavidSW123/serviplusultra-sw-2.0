require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const { inicializarDB } = require('./config/db');
const apiRoutes         = require('./routes/apiRoutes');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares globales ───────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

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
