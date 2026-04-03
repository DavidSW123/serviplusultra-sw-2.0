// ── CLIENTES CRM ─────────────────────────────────────────────

function cargarClientes() {
    API.get('/api/clientes').then(data => {
        clientesGlobal = data;
        const aprobados = data.filter(c => c.estado === 'APROBADO');

        const selOt   = document.getElementById('ot_cliente_id');
        const selFact = document.getElementById('selClienteFactura');
        const selEdOt = document.getElementById('ed_ot_cliente_id');

        selOt.innerHTML   = '<option value="">-- Sin asignar / General --</option>';
        selFact.innerHTML = '<option value="">-- Seleccionar Cliente --</option>';
        if (selEdOt) selEdOt.innerHTML = '<option value="">-- Sin asignar / General --</option>';

        aprobados.forEach(c => {
            const opt = `<option value="${c.id}">${c.nombre}</option>`;
            selOt.innerHTML   += opt;
            selFact.innerHTML += opt;
            if (selEdOt) selEdOt.innerHTML += opt;
        });
    });
}

function renderizarBurbujasClientes() {
    const grid      = document.getElementById('gridClientes');
    const aprobados = clientesGlobal.filter(c => c.estado === 'APROBADO');
    grid.innerHTML  = '';
    if (aprobados.length === 0) {
        grid.innerHTML = '<p style="grid-column:1/-1; text-align:center;">Aún no hay clientes.</p>';
        return;
    }
    aprobados.forEach(c => {
        grid.innerHTML += `<div class="cliente-bubble" onclick="abrirDetalleCliente(${c.id})">
            <img src="${c.logo || imgClienteDef}" class="bubble-img">
            <div class="bubble-name">${c.nombre}</div>
        </div>`;
    });
}

function abrirDetalleCliente(id) {
    const c = clientesGlobal.find(x => x.id === id);
    document.getElementById('d_c_logo').src          = c.logo || imgClienteDef;
    document.getElementById('d_c_nombre').innerText  = c.nombre;
    document.getElementById('d_c_nif').innerText     = c.nif;
    document.getElementById('d_c_direccion').innerText = c.direccion;
    document.getElementById('d_c_tel').innerText     = c.telefono || '-';
    document.getElementById('d_c_email').innerText   = c.email || '-';

    const divAcciones = document.getElementById('d_c_acciones');
    divAcciones.innerHTML = sesion.rol === 'admin'
        ? `<button class="btn-editar" onclick="abrirModalEditarCliente(${id})">✏️ Editar Datos</button>`
        : '';

    const ots    = otsGlobal.filter(ot => ot.cliente_id === id);
    const divOts = document.getElementById('d_c_ots');
    divOts.innerHTML = '';
    if (ots.length === 0) { divOts.innerHTML = '<p>No hay OTs para este cliente.</p>'; }
    else {
        ots.forEach(ot => {
            const color = ot.estado === 'HECHO' ? '#27ae60' : (ot.estado === 'PENDIENTE' ? '#f39c12' : '#e74c3c');
            divOts.innerHTML += `<div style="border-left:4px solid ${color}; padding:10px; background:#fff; margin-bottom:8px;">
                <strong>${ot.codigo_ot}</strong> - ${ot.marca}
                <span style="float:right; color:${color};">${ot.estado}</span>
            </div>`;
        });
    }
    cerrarModal('modalClientes');
    abrirModal('modalDetalleCliente');
}

function abrirModalEditarCliente(id) {
    const c = clientesGlobal.find(x => x.id === id);
    document.getElementById('edit_c_id').value        = c.id;
    document.getElementById('edit_c_nombre').value    = c.nombre;
    document.getElementById('edit_c_nif').value       = c.nif;
    document.getElementById('edit_c_direccion').value = c.direccion;
    document.getElementById('edit_c_telefono').value  = c.telefono || '';
    document.getElementById('edit_c_email').value     = c.email || '';
    cerrarModal('modalDetalleCliente');
    abrirModal('modalEditarCliente');
}

document.getElementById('formEditarCliente').addEventListener('submit', function(e) {
    e.preventDefault();
    const id   = document.getElementById('edit_c_id').value;
    const file = document.getElementById('edit_c_logo_file').files[0];
    const enviar = (logoB64) => {
        const payload = {
            nombre:    document.getElementById('edit_c_nombre').value,
            nif:       document.getElementById('edit_c_nif').value,
            direccion: document.getElementById('edit_c_direccion').value,
            email:     document.getElementById('edit_c_email').value,
            telefono:  document.getElementById('edit_c_telefono').value,
            logo:      logoB64 || clientesGlobal.find(x => x.id == id).logo
        };
        API.put(`/api/clientes/${id}`, payload).then(d => {
            if (d.error) alert('❌ ' + d.error);
            else {
                alert(d.mensaje);
                document.getElementById('formEditarCliente').reset();
                cerrarModal('modalEditarCliente');
                cargarClientes();
                abrirModal('modalClientes');
                setTimeout(renderizarBurbujasClientes, 500);
            }
        });
    };
    if (file) comprimirImagen(file, enviar); else enviar('');
});

document.getElementById('formCliente').addEventListener('submit', function(e) {
    e.preventDefault();
    const file = document.getElementById('c_logo_file').files[0];
    const enviar = (logoB64) => {
        API.post('/api/clientes', {
            nombre:    document.getElementById('c_nombre').value,
            nif:       document.getElementById('c_nif').value,
            direccion: document.getElementById('c_direccion').value,
            email:     document.getElementById('c_email').value,
            telefono:  document.getElementById('c_telefono').value,
            logo:      logoB64
        }).then(d => {
            alert('ℹ️ ' + d.mensaje);
            document.getElementById('formCliente').reset();
            cerrarModal('modalCrearCliente');
            cargarClientes();
        });
    };
    if (file) comprimirImagen(file, enviar); else enviar('');
});

function abrirSolicitudesClientes() {
    const tbody = document.getElementById('tbodySolicitudesClientes');
    const pend  = clientesGlobal.filter(c => c.estado === 'PENDIENTE');
    tbody.innerHTML = '';
    if (pend.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No hay solicitudes</td></tr>';
    } else {
        pend.forEach(c => {
            tbody.innerHTML += `<tr>
                <td><strong>${c.nombre}</strong></td>
                <td>${c.nif}</td>
                <td>Director</td>
                <td>
                    <button style="background:#27ae60; border:none; color:white; padding:5px; cursor:pointer;" onclick="resolverCliente(${c.id},'APROBADO')">✅</button>
                    <button style="background:#e74c3c; border:none; color:white; padding:5px; cursor:pointer;" onclick="resolverCliente(${c.id},'RECHAZADO')">❌</button>
                </td>
            </tr>`;
        });
    }
    abrirModal('modalSolicitudesClientes');
}

function resolverCliente(id, estado) {
    API.put(`/api/clientes/${id}/estado`, { estado }).then(d => {
        alert('ℹ️ ' + d.mensaje);
        cargarClientes();
        abrirSolicitudesClientes();
    });
}
