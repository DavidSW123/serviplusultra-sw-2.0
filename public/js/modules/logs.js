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
                <td>${escapeHTML(log.fecha)}</td>
                <td>${escapeHTML(log.usuario)}</td>
                <td>${escapeHTML(log.accion)}</td>
                <td>${escapeHTML(log.referencia)}</td>
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
        return `${escapeHTML(log.usuario)} solicitó crear la orden <strong>${escapeHTML(d.codigo_ot)}</strong> para ${escapeHTML(tecns)}, con ${horas} de trabajo en "${escapeHTML(d.marca)}".${mat}`;
    }

    if (accion === 'Eliminar OT') {
        return `${escapeHTML(log.usuario)} solicitó <strong>eliminar</strong> la orden con referencia "${escapeHTML(log.referencia)}".`;
    }

    if (accion === 'Editar OT') {
        if (d.nuevoEstado) return `${escapeHTML(log.usuario)} cambió el estado de la orden a <strong>${escapeHTML(d.nuevoEstado)}</strong>.`;
        const campos = [];
        if (d.horas)            campos.push(`horas: ${d.horas}`);
        if (d.marca)            campos.push(`descripción: "${escapeHTML(d.marca)}"`);
        if (d.tipo_urgencia)    campos.push(`urgencia: ${escapeHTML(d.tipo_urgencia)}`);
        if (d.tecnicos_nombres) campos.push(`técnicos: ${escapeHTML(d.tecnicos_nombres)}`);
        return `${escapeHTML(log.usuario)} modificó la orden <strong>${escapeHTML(d.codigo_ot || log.referencia)}</strong>` +
               (campos.length ? ` — ${campos.join(', ')}.` : '.');
    }

    if (accion === 'Eliminar OT') {
        return `${escapeHTML(log.usuario)} eliminó la orden "${escapeHTML(log.referencia)}".`;
    }

    // Fallback genérico legible
    const pares = Object.entries(d)
        .filter(([k]) => !['imagen', 'logo', 'lineas_materiales'].includes(k))
        .map(([k, v]) => `${escapeHTML(k)}: ${escapeHTML(v)}`).join(' · ');
    return pares || null;
}

function _renderDetalleLog(log) {
    const texto = _textoHumano(log);
    return `<div style="font-size:0.9em; padding:5px 0;">
        <span style="font-size:1.1em;">${texto || 'Sin detalles adicionales.'}</span>
        <br><small style="color:#aaa; margin-top:6px; display:block;">${escapeHTML(log.fecha)} · ID #${log.id}</small>
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
