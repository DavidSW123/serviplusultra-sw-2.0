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

function _textoHumano(log) {
    let d = {};
    try { d = typeof log.datos === 'string' ? JSON.parse(log.datos) : (log.datos || {}); } catch { return null; }

    const accion = log.accion;

    if (accion === 'Añadir OT') {
        const tecns = d.tecnicos_nombres || 'sin asignar';
        const horas = d.horas ? `${d.horas} h` : '—';
        const mat   = d.materiales_precio > 0 ? ` Se añadieron materiales por ${parseFloat(d.materiales_precio).toFixed(2)} €.` : '';
        return `${log.usuario} solicitó crear la orden <strong>${d.codigo_ot}</strong> para ${tecns}, con ${horas} de trabajo en "${d.marca}".${mat}`;
    }

    if (accion === 'Eliminar OT') {
        return `${log.usuario} solicitó <strong>eliminar</strong> la orden con referencia "${log.referencia}".`;
    }

    if (accion === 'Editar OT') {
        if (d.nuevoEstado) return `${log.usuario} cambió el estado de la orden a <strong>${d.nuevoEstado}</strong>.`;
        const campos = [];
        if (d.horas)            campos.push(`horas: ${d.horas}`);
        if (d.marca)            campos.push(`descripción: "${d.marca}"`);
        if (d.tipo_urgencia)    campos.push(`urgencia: ${d.tipo_urgencia}`);
        if (d.tecnicos_nombres) campos.push(`técnicos: ${d.tecnicos_nombres}`);
        return `${log.usuario} modificó la orden <strong>${d.codigo_ot || log.referencia}</strong>` +
               (campos.length ? ` — ${campos.join(', ')}.` : '.');
    }

    if (accion === 'Eliminar OT') {
        return `${log.usuario} eliminó la orden "${log.referencia}".`;
    }

    // Fallback genérico legible
    const pares = Object.entries(d)
        .filter(([k]) => !['imagen', 'logo', 'lineas_materiales'].includes(k))
        .map(([k, v]) => `${k}: ${v}`).join(' · ');
    return pares || null;
}

function _renderDetalleLog(log) {
    const texto = _textoHumano(log);
    return `<div style="font-size:0.9em; padding:5px 0;">
        <span style="font-size:1.1em;">${texto || 'Sin detalles adicionales.'}</span>
        <br><small style="color:#aaa; margin-top:6px; display:block;">${log.fecha} · ID #${log.id}</small>
    </div>`;
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
