// ── SESIÓN Y ESTADO GLOBAL ───────────────────────────────────
const sesionStr = localStorage.getItem('sesionPlusUltra');
if (!sesionStr) window.location.href = '/login';
const sesion = JSON.parse(sesionStr);

const imgDefecto    = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
const imgClienteDef = "https://cdn-icons-png.flaticon.com/512/3135/3135768.png";
const prefijoAnoActual = `OT${new Date().getFullYear().toString().slice(-2)}/`;

/**
 * Normaliza un código de OT al prefijo del año actual, tolerando errores
 * (mayúsculas, año equivocado, letras de más, prefijo olvidado...).
 * Todo lo que va después de la primera "/" se conserva tal cual; si no hay
 * "/", se descarta cualquier "OT.." inicial reconocible. Devuelve null si
 * el texto queda vacío tras normalizar.
 */
function normalizarCodigoOT(valor) {
    const c = String(valor || '').trim();
    if (!c) return null;
    const barra = c.indexOf('/');
    let resto;
    if (barra !== -1) {
        resto = c.slice(barra + 1).trim();
    } else {
        const m = c.match(/^ot\d*/i);
        resto = (m ? c.slice(m[0].length) : c).trim();
    }
    return resto ? prefijoAnoActual + resto : null;
}

// La sesión va en una cookie httpOnly que el navegador envía sola (mismo origen).
// Solo queda el Content-Type; el rol/usuario ya NO se mandan por cabecera.
const headersSeguridad = { 'Content-Type': 'application/json' };

// Escapa texto del usuario antes de meterlo en innerHTML (previene XSS).
function escapeHTML(v) {
    if (v === null || v === undefined) return '';
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

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
