// ── SESIÓN Y ESTADO GLOBAL ───────────────────────────────────
const sesionStr = localStorage.getItem('sesionPlusUltra');
if (!sesionStr) window.location.href = '/login';
const sesion = JSON.parse(sesionStr);

const imgDefecto    = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
const imgClienteDef = "https://cdn-icons-png.flaticon.com/512/3135/3135768.png";
const prefijoAnoActual = `OT${new Date().getFullYear().toString().slice(-2)}/`;

const headersSeguridad = {
    'Content-Type': 'application/json',
    'x-rol':  sesion.rol,
    'x-user': sesion.username
};

// Estado compartido entre módulos
let otsGlobal      = [];
let logsGlobal     = [];
let clientesGlobal = [];
let stockGlobal    = [];

// ── SERVICIOS API ────────────────────────────────────────────

const API = {
    get:    (url)           => fetch(url, { headers: headersSeguridad }).then(r => r.json()),
    post:   (url, body)     => fetch(url, { method: 'POST',   headers: headersSeguridad, body: JSON.stringify(body) }).then(r => r.json()),
    put:    (url, body)     => fetch(url, { method: 'PUT',    headers: headersSeguridad, body: JSON.stringify(body) }).then(r => r.json()),
    delete: (url)           => fetch(url, { method: 'DELETE', headers: headersSeguridad }).then(r => r.json()),
};
