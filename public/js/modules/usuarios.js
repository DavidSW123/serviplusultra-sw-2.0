// ── USUARIOS ─────────────────────────────────────────────────

function guardarPassword() {
    const oldPass = document.getElementById('oldPass').value;
    const newPass = document.getElementById('newPass').value;
    API.put('/api/usuarios/password', { username: sesion.username, oldPass, newPass })
        .then(d => {
            if (d.error) alert('❌ ' + d.error);
            else { alert('✅ ' + d.mensaje); cerrarModal('modalPassword'); }
        });
}

function crearTecnico() {
    const u = document.getElementById('newTecUser').value;
    const p = document.getElementById('newTecPass').value;
    if (!u || !p) return;
    API.post('/api/usuarios/tecnico', { username: u, password: p })
        .then(d => {
            if (d.error) alert('❌ ' + d.error);
            else { alert('✅ ' + d.mensaje); cerrarModal('modalTecnico'); cargarUsuariosParaOT(); }
        });
}
