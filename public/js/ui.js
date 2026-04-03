// ── HELPERS DOM ──────────────────────────────────────────────

function abrirModal(id)  { document.getElementById(id).style.display = 'block'; cerrarMenuLateral(); }
function cerrarModal(id) { document.getElementById(id).style.display = 'none'; }

function abrirMenuLateral()  { document.getElementById('sideMenu').classList.add('open'); document.getElementById('overlayMenu').style.display = 'block'; }
function cerrarMenuLateral() { document.getElementById('sideMenu').classList.remove('open'); document.getElementById('overlayMenu').style.display = 'none'; }

function cerrarSesion() { localStorage.removeItem('sesionPlusUltra'); window.location.href = '/login'; }

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

function validarFormulario(codigo, fechaIn, fechaOut) {
    if (!codigo.startsWith(prefijoAnoActual)) { alert(`❌ Debe empezar por ${prefijoAnoActual}`); return false; }
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
    document.getElementById('codigo_ot').placeholder = `${prefijoAnoActual}00001`;

    if (sesion.rol === 'admin' || sesion.rol === 'director') {
        document.getElementById('menuGastosArea').style.display    = 'block';
        document.getElementById('menuClientesArea').style.display  = 'block';
        document.getElementById('btnCrearTecnicoArea').innerHTML   = `<button class="btn-side" onclick="abrirModal('modalTecnico')">👷 Crear Perfil Técnico</button>`;
        document.getElementById('btnLogsArea').innerHTML           = `<button class="btn-side" style="background-color:#f39c12; margin-top:20px;" onclick="abrirLogs()">📝 Registro de Auditoría</button>`;
        if (['Giancarlo', 'David', 'Kevin'].includes(sesion.username)) {
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

function cargarUsuariosParaOT() {
    API.get('/api/usuarios/nombres').then(data => {
        const s1 = document.getElementById('selTecnicosAdd');
        const s2 = document.getElementById('e_selTecnicosAdd');
        const s3 = document.getElementById('ed_selTecnicosAdd');
        const base = '<option value="">-- Seleccionar --</option>';
        s1.innerHTML = base; s2.innerHTML = base;
        if (s3) s3.innerHTML = base;
        data.forEach(u => {
            const opt = `<option value="${u.username}">${u.username} (${u.rol})</option>`;
            s1.innerHTML += opt; s2.innerHTML += opt;
            if (s3) s3.innerHTML += opt;
        });
    });
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
