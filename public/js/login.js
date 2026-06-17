// Toggle mostrar/ocultar contraseña
document.getElementById('togglePass').addEventListener('click', function() {
    const inp = document.getElementById('pass');
    if (inp.type === 'password') { inp.type = 'text';  this.innerText = '🙈'; }
    else                          { inp.type = 'password'; this.innerText = '👁️'; }
});

// Login
document.getElementById('formLogin').addEventListener('submit', function(e) {
    e.preventDefault();
    const user = document.getElementById('user').value;
    const pass = document.getElementById('pass').value;

    fetch('/api/login', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body:        JSON.stringify({ username: user, password: pass })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            const errorBox = document.getElementById('errorBox');
            errorBox.style.display = 'block';
            errorBox.innerText = data.error;
        } else {
            localStorage.setItem('sesionPlusUltra', JSON.stringify({ username: data.username, rol: data.rol }));
            window.location.href = '/';
        }
    })
    .catch(() => alert('Error de conexión con el servidor.'));
});

// ── Recuperar contraseña ──────────────────────────────────────
function abrirRecuperar() {
    document.getElementById('recuperarUser').value = '';
    document.getElementById('msgRecuperar').innerHTML = '';
    document.getElementById('btnEnviarRecuperar').disabled = false;
    document.getElementById('modalRecuperar').classList.add('show');
}
function cerrarRecuperar() {
    document.getElementById('modalRecuperar').classList.remove('show');
}

async function enviarRecuperar() {
    const username = document.getElementById('recuperarUser').value.trim();
    const msg = document.getElementById('msgRecuperar');
    if (!username) { msg.innerHTML = '<div class="msg-err">Introduce un nombre de usuario.</div>'; return; }
    const btn = document.getElementById('btnEnviarRecuperar');
    btn.disabled = true;
    msg.innerHTML = '<div style="color:#7f8c8d; font-size:0.85em;">Enviando solicitud…</div>';

    try {
        const r = await fetch('/api/recuperar-password', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ username })
        }).then(r => r.json());

        if (r.ok) {
            msg.innerHTML = '<div class="msg-ok">✅ Se ha enviado una contraseña temporal al correo de la empresa. Revisa la bandeja de entrada.</div>';
            setTimeout(cerrarRecuperar, 4000);
        } else {
            msg.innerHTML = `<div class="msg-err">❌ ${r.error || 'Error desconocido'}</div>`;
            btn.disabled = false;
        }
    } catch (e) {
        msg.innerHTML = '<div class="msg-err">❌ Error de conexión.</div>';
        btn.disabled = false;
    }
}
