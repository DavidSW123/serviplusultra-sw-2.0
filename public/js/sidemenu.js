// ── MENÚ LATERAL GLOBAL ──────────────────────────────────────
// Inyecta el menú en cualquier página que incluya este script.
// Requiere: api.js cargado antes (sesion, API disponibles)

(function () {
    const paginaActual = window.location.pathname;

    const html = `
    <div id="overlayMenu" class="overlay-menu" onclick="cerrarMenuLateral()"></div>
    <div id="sideMenu" class="side-menu">
        <span class="close-menu" onclick="cerrarMenuLateral()">&times;</span>
        <div class="perfil-header">
            <div class="avatar-container" style="cursor:default;">
                <img id="menuAvatar" src="" class="avatar-large" onerror="this.src='/icon-192.png'">
            </div>
            <h2 id="menuNombre" style="margin:0; color:#1abc9c;"></h2>
            <p id="menuRol" style="margin:5px 0 0 0; color:#bdc3c7; text-transform:uppercase;"></p>
        </div>
        <div class="menu-items">
            <h4 style="color:#95a5a6; margin:0 0 12px 0; font-size:0.78em; text-transform:uppercase; letter-spacing:1px;">Navegación</h4>
            <a href="/"             class="btn-side" style="display:block; text-decoration:none; text-align:left; ${paginaActual==='/'?'background:#1abc9c;':''}">🏠 Inicio</a>
            <a href="/facturas"     class="btn-side" style="display:block; text-decoration:none; text-align:left; ${paginaActual==='/facturas'?'background:#3498db;':''}">🛠️ Facturas &amp; OTs</a>
            <a href="/contabilidad" class="btn-side" style="display:block; text-decoration:none; text-align:left; ${paginaActual==='/contabilidad'?'background:#27ae60;':''}">📊 Contabilidad</a>
            <a href="/presupuestos" class="btn-side" style="display:block; text-decoration:none; text-align:left; ${paginaActual==='/presupuestos'?'background:#9b59b6;':''}">📋 Presupuestos</a>
            <div style="border-top:1px solid #34495e; margin:16px 0;"></div>
            <button class="btn-side" onclick="abrirCambiarPasswordGlobal()">🔑 Cambiar Contraseña</button>
        </div>
        <button class="btn-side-red" onclick="cerrarSesionGlobal()">🚪 CERRAR SESIÓN</button>
    </div>

    <div id="modalPasswordGlobal" style="display:none; position:fixed; z-index:6000; left:0; top:0; width:100%; height:100%; background:rgba(0,0,0,0.7);">
        <div style="background:#fff; margin:10% auto; padding:30px; border-radius:10px; width:90%; max-width:360px; box-shadow:0 5px 15px rgba(0,0,0,0.3);">
            <h3 style="margin-top:0;">🔑 Cambiar Contraseña</h3>
            <input type="password" id="gpOld" placeholder="Contraseña actual" style="width:100%; padding:10px; margin-bottom:10px; border:1px solid #ddd; border-radius:6px; box-sizing:border-box;">
            <input type="password" id="gpNew" placeholder="Nueva contraseña"  style="width:100%; padding:10px; margin-bottom:16px; border:1px solid #ddd; border-radius:6px; box-sizing:border-box;">
            <div style="display:flex; gap:10px;">
                <button onclick="document.getElementById('modalPasswordGlobal').style.display='none'" style="flex:1; padding:10px; border:1px solid #ddd; border-radius:6px; background:#f8f9fa; cursor:pointer;">Cancelar</button>
                <button onclick="guardarPasswordGlobal()" style="flex:1; padding:10px; border:none; border-radius:6px; background:#1abc9c; color:#fff; font-weight:600; cursor:pointer;">Guardar</button>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('afterbegin', html);

    // Rellenar datos de sesión
    document.getElementById('menuNombre').innerText = sesion.username;
    document.getElementById('menuRol').innerText    = sesion.rol;

    // Cargar foto del usuario
    API.get('/api/usuarios/nombres').then(lista => {
        const yo = lista.find(u => u.username === sesion.username);
        if (yo && yo.foto) document.getElementById('menuAvatar').src = yo.foto;
    }).catch(() => {});
})();

function abrirMenuLateral()  { document.getElementById('sideMenu').classList.add('open');    document.getElementById('overlayMenu').style.display = 'block'; }
function cerrarMenuLateral() { document.getElementById('sideMenu').classList.remove('open'); document.getElementById('overlayMenu').style.display = 'none';  }
function cerrarSesionGlobal() { localStorage.removeItem('sesionPlusUltra'); window.location.href = '/login'; }

function abrirCambiarPasswordGlobal() {
    cerrarMenuLateral();
    document.getElementById('gpOld').value = '';
    document.getElementById('gpNew').value = '';
    document.getElementById('modalPasswordGlobal').style.display = 'block';
}
function guardarPasswordGlobal() {
    const oldPass = document.getElementById('gpOld').value;
    const newPass = document.getElementById('gpNew').value;
    if (!oldPass || !newPass) { alert('Rellena ambos campos.'); return; }
    API.put('/api/usuarios/password', { oldPass, newPass }).then(r => {
        if (r.error) { alert('❌ ' + r.error); }
        else { alert('✅ Contraseña actualizada.'); document.getElementById('modalPasswordGlobal').style.display = 'none'; }
    });
}
