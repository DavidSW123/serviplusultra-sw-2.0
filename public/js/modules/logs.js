// ── LOGS / AUDITORÍA ─────────────────────────────────────────

function abrirLogs() {
    API.get('/api/logs').then(data => {
        logsGlobal = data;
        const tbody = document.getElementById('cuerpoLogs');
        tbody.innerHTML = '';

        data.forEach(log => {
            const bc   = log.estado === 'PENDIENTE' ? 'f39c12' : (log.estado === 'APROBADO' ? '27ae60' : 'e74c3c');
            const btnAp = (log.estado === 'PENDIENTE' && sesion.rol === 'admin')
                ? `<button onclick="event.stopPropagation(); resolverLog(${log.id},'APROBADO')">✅</button>
                   <button onclick="event.stopPropagation(); resolverLog(${log.id},'RECHAZADO')">❌</button>`
                : '-';

            // Fila principal (click para expandir detalle)
            tbody.innerHTML += `<tr onclick="toggleDetalleLog(${log.id})" style="cursor:pointer;">
                <td>${log.fecha}</td>
                <td>${log.usuario}</td>
                <td>${log.accion}</td>
                <td>${log.referencia}</td>
                <td><span class="badge-log" style="background:#${bc}">${log.estado}</span></td>
                <td>${btnAp}</td>
            </tr>
            <tr id="detalle_log_${log.id}" style="display:none; background:#f8f9fa;">
                <td colspan="6" style="padding:15px;">
                    ${_renderDetalleLog(log)}
                </td>
            </tr>`;
        });

        abrirModal('modalLogs');
    });
}

function _renderDetalleLog(log) {
    let html = `<div style="font-size:0.9em;">
        <strong>📋 Detalle completo del registro</strong><br><br>
        <table style="width:100%; border-collapse:collapse; font-size:0.95em;">
            <tr><td style="padding:4px 10px; color:#7f8c8d; width:120px;">ID</td><td>${log.id}</td></tr>
            <tr><td style="padding:4px 10px; color:#7f8c8d;">Fecha</td><td>${log.fecha}</td></tr>
            <tr><td style="padding:4px 10px; color:#7f8c8d;">Usuario</td><td>${log.usuario}</td></tr>
            <tr><td style="padding:4px 10px; color:#7f8c8d;">Acción</td><td>${log.accion}</td></tr>
            <tr><td style="padding:4px 10px; color:#7f8c8d;">Referencia</td><td>${log.referencia}</td></tr>
            <tr><td style="padding:4px 10px; color:#7f8c8d;">Estado</td><td>${log.estado}</td></tr>`;

    if (log.datos) {
        try {
            const datos = typeof log.datos === 'string' ? JSON.parse(log.datos) : log.datos;
            html += `<tr><td style="padding:4px 10px; color:#7f8c8d; vertical-align:top;">Datos</td>
                <td><pre style="margin:0; background:#fff; padding:8px; border-radius:4px; border:1px solid #ddd; font-size:0.85em; overflow-x:auto;">${JSON.stringify(datos, null, 2)}</pre></td></tr>`;
        } catch {
            html += `<tr><td style="padding:4px 10px; color:#7f8c8d;">Datos</td><td>${log.datos}</td></tr>`;
        }
    }

    html += '</table></div>';
    return html;
}

function toggleDetalleLog(id) {
    const row = document.getElementById(`detalle_log_${id}`);
    if (!row) return;
    row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
}

function resolverLog(id, res) {
    let motivo = '';
    if (res === 'RECHAZADO') {
        motivo = prompt('Motivo:');
        if (!motivo) return;
    }
    API.put(`/api/logs/${id}/resolver`, { resolucion: res, motivo }).then(d => {
        alert(d.mensaje);
        abrirLogs();
        cargarOTs();
    });
}
