// ── SESIÓN Y ESTADO GLOBAL ───────────────────────────────────
const sesionStr = localStorage.getItem('sesionPlusUltra');
if (!sesionStr) window.location.href = '/login';
const sesion = JSON.parse(sesionStr);

const imgDefecto    = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
const imgClienteDef = "https://cdn-icons-png.flaticon.com/512/3135/3135768.png";
const prefijoAnoActual = `OT${new Date().getFullYear().toString().slice(-2)}/`;

// La sesión va en una cookie httpOnly que el navegador envía sola (mismo origen).
// Solo queda el Content-Type; el rol/usuario ya NO se mandan por cabecera.
const headersSeguridad = { 'Content-Type': 'application/json' };

// Estado compartido entre módulos
let otsGlobal      = [];
let logsGlobal     = [];
let clientesGlobal = [];
let stockGlobal    = [];

// ── SERVICIOS API ────────────────────────────────────────────

// Si el servidor responde 401 (sesión caducada/ausente) → limpiar y volver al login.
function _resp(r) {
    if (r.status === 401) {
        localStorage.removeItem('sesionPlusUltra');
        window.location.href = '/login';
        return new Promise(() => {}); // detiene la cadena durante la redirección
    }
    return r.json();
}

const API = {
    get:    (url)       => fetch(url, { headers: headersSeguridad, credentials: 'same-origin' }).then(_resp),
    post:   (url, body) => fetch(url, { method: 'POST',   headers: headersSeguridad, credentials: 'same-origin', body: JSON.stringify(body) }).then(_resp),
    put:    (url, body) => fetch(url, { method: 'PUT',    headers: headersSeguridad, credentials: 'same-origin', body: JSON.stringify(body) }).then(_resp),
    delete: (url)       => fetch(url, { method: 'DELETE', headers: headersSeguridad, credentials: 'same-origin' }).then(_resp),
};
