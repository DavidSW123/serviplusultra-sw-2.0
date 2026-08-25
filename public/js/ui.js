// ── HELPERS DOM ──────────────────────────────────────────────

function abrirModal(id)  { document.getElementById(id).style.display = 'block'; cerrarMenuLateral(); }
function cerrarModal(id) { document.getElementById(id).style.display = 'none'; }

function abrirMenuLateral()  { document.getElementById('sideMenu').classList.add('open'); document.getElementById('overlayMenu').style.display = 'block'; }
function cerrarMenuLateral() { document.getElementById('sideMenu').classList.remove('open'); document.getElementById('overlayMenu').style.display = 'none'; }

function cerrarSesion() {
    fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
        .finally(() => { localStorage.removeItem('sesionPlusUltra'); window.location.href = '/login'; });
}

function comprimirImagen(file, callback) {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
        const img = new Image();
        img.src = e.target.result;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800;
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width  = MAX_WIDTH;
            canvas.height = img.height * scaleSize;
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            callback(canvas.toDataURL('image/jpeg', 0.6));
        };
    };
}

/** Sube la foto de perfil: comprime, guarda en BD y actualiza los avatares + sesión. */
function subirFoto(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    comprimirImagen(file, async (dataUrl) => {
        try {
            const r = await API.put('/api/usuarios/foto', { username: sesion.username, foto: dataUrl });
            if (r && r.error) { alert('❌ ' + r.error); return; }
            sesion.foto = dataUrl;
            try { localStorage.setItem('sesionPlusUltra', JSON.stringify(sesion)); } catch (_) {}
            const top  = document.getElementById('topAvatar');  if (top)  top.src  = dataUrl;
            const menu = document.getElementById('menuAvatar'); if (menu) menu.src = dataUrl;
            alert('✅ Foto de perfil actualizada.');
        } catch (e) {
            alert('❌ No se pudo subir la foto: ' + (e.message || e));
        }
    });
}

function validarFormulario(codigo, fechaIn, fechaOut) {
    if (!codigo || !/^ot\d{2}\//i.test(codigo)) { alert('❌ El código de OT no es válido (debe ser tipo OT26/12345).'); return false; }
    if (fechaOut && new Date(fechaOut) <= new Date(fechaIn)) { alert('❌ Finalización debe ser posterior al inicio.'); return false; }
    return true;
}

// ── INICIALIZACIÓN UI ────────────────────────────────────────

function inicializarUI() {
    document.getElementById('topNombre').innerText  = sesion.username;
    document.getElementById('topRol').innerText     = sesion.rol;
    document.getElementById('menuNombre').innerText = sesion.username;
    document.getElementById('menuRol').innerText    = sesion.rol;
    document.getElementById('topAvatar').src        = sesion.foto || imgDefecto;
    const _menuAv = document.getElementById('menuAvatar'); if (_menuAv) _menuAv.src = sesion.foto || imgDefecto;
    document.getElementById('codigo_ot').value = prefijoAnoActual;

    if (sesion.rol === 'admin' || sesion.rol === 'director') {
        // Módulo "Cuentas Claras" (gastos entre socios) apagado a petición del usuario:
        // no se usa por el momento. Descomentar para reactivarlo.
        // document.getElementById('menuGastosArea').style.display = 'block';
        document.getElementById('menuClientesArea').style.display  = 'block';
        document.getElementById('btnCrearTecnicoArea').innerHTML   = `<button class="btn-side" onclick="abrirModal('modalTecnico')">👷 Crear Perfil Técnico</button>`;
        document.getElementById('btnLogsArea').innerHTML           = `<button class="btn-side" style="background-color:#f39c12; margin-top:20px;" onclick="abrirLogs()">📝 Registro de Auditoría</button>`;
        if (['Juliana', 'David', 'Guille'].includes(sesion.username)) {
            document.getElementById('g_pagador').value = sesion.username;
            document.getElementById('p_emisor').value  = sesion.username;
        }
    }
    if (sesion.rol === 'admin') {
        document.getElementById('menuSolicitudesArea').innerHTML = `<button class="btn-side" style="background:#e67e22;" onclick="abrirSolicitudesClientes()">🔔 Solicitudes Nuevos Clientes</button>`;
    }
    if (sesion.rol === 'director') {
        document.getElementById('btnGuardarMain').innerText    = 'Enviar OT a Revisión (Standby)';
        document.getElementById('btnGuardarCliente').innerText = 'Enviar Cliente a Revisión';
    }
    cargarUsuariosParaOT();
    cargarStock();
}

// ── TÉCNICOS (3 conjuntos: nuevo, editar-log, editar-OT) ─────

let tecnicosSeleccionados    = [];
let e_tecnicosSeleccionados  = [];
let ed_tecnicosSeleccionados = [];

/** Lista fija de quién puede ir a un trabajo (no son los usuarios de la app: Jordi y
 *  el autónomo no tienen cuenta). "Autonomo" es el valor que activa el popup de precio/hora. */
const OPCIONES_TECNICOS_OT =
    '<option value="">-- Seleccionar --</option>' +
    '<option value="David">David (Socio)</option>' +
    '<option value="Guille">Guille (Socio)</option>' +
    '<option value="Jordi">Jordi</option>' +
    '<option value="Ayudante">Ayudante</option>' +
    '<option value="Autonomo">Autónomo subcontratado</option>';

function cargarUsuariosParaOT() {
    const s1 = document.getElementById('selTecnicosAdd');
    const s2 = document.getElementById('e_selTecnicosAdd');
    const s3 = document.getElementById('ed_selTecnicosAdd');
    s1.innerHTML = OPCIONES_TECNICOS_OT;
    s2.innerHTML = OPCIONES_TECNICOS_OT;
    if (s3) s3.innerHTML = OPCIONES_TECNICOS_OT;
}

function agregarTecnicoOT()  { const s = document.getElementById('selTecnicosAdd');    if (s.value && !tecnicosSeleccionados.includes(s.value))    { tecnicosSeleccionados.push(s.value);    renderizarTecnicosOT();   } s.value = ''; }
function quitarTecnicoOT(n)  { tecnicosSeleccionados    = tecnicosSeleccionados.filter(t => t !== n);    renderizarTecnicosOT();   }
function renderizarTecnicosOT()  { const d = document.getElementById('listaTecnicosOT');    d.innerHTML = ''; tecnicosSeleccionados.forEach(t    => d.innerHTML += `<div class="tecnico-badge">👤 ${t} <span onclick="quitarTecnicoOT('${t}')">&times;</span></div>`); }

function agregarETecnicoOT()  { const s = document.getElementById('e_selTecnicosAdd');  if (s.value && !e_tecnicosSeleccionados.includes(s.value))  { e_tecnicosSeleccionados.push(s.value);  renderizarETecnicosOT();  } s.value = ''; }
function quitarETecnicoOT(n)  { e_tecnicosSeleccionados  = e_tecnicosSeleccionados.filter(t => t !== n);  renderizarETecnicosOT();  }
function renderizarETecnicosOT()  { const d = document.getElementById('e_listaTecnicosOT');  d.innerHTML = ''; e_tecnicosSeleccionados.forEach(t  => d.innerHTML += `<div class="tecnico-badge">👤 ${t} <span onclick="quitarETecnicoOT('${t}')">&times;</span></div>`); }

function agregarEdTecnicoOT() { const s = document.getElementById('ed_selTecnicosAdd'); if (s.value && !ed_tecnicosSeleccionados.includes(s.value)) { ed_tecnicosSeleccionados.push(s.value); renderizarEdTecnicosOT(); } s.value = ''; }
function quitarEdTecnicoOT(n) { ed_tecnicosSeleccionados = ed_tecnicosSeleccionados.filter(t => t !== n); renderizarEdTecnicosOT(); }
function renderizarEdTecnicosOT() { const d = document.getElementById('ed_listaTecnicosOT'); d.innerHTML = ''; ed_tecnicosSeleccionados.forEach(t => d.innerHTML += `<div class="tecnico-badge">👤 ${t} <span onclick="quitarEdTecnicoOT('${t}')">&times;</span></div>`); }

// ── TEST EMAIL ───────────────────────────────────────────────

function probarEnvioCorreo() {
    const email = prompt('Introduce tu correo para la prueba:');
    if (!email) return;
    alert('⏳ Enviando...');
    API.post('/api/test-email', { emailDestino: email })
        .then(data => { if (data.error) alert('❌ ' + data.error); else alert('✅ ' + data.mensaje); })
        .catch(() => alert('❌ Error.'));
}
