// ── ÓRDENES DE TRABAJO ───────────────────────────────────────

let otActualId     = null;
let otActualCodigo = '';

function cargarOTs() {
    API.get('/api/ot').then(ots => {
        otsGlobal = ots;
        const cont = document.getElementById('contenedorOTs');
        cont.innerHTML = '';
        ots.forEach(ot => {
            const btnB    = sesion.rol === 'tecnico' ? '' : `<button class="btn-peligro" onclick="eliminarOT(${ot.id})">🗑️</button>`;
            const disable = sesion.rol === 'tecnico' ? 'disabled' : '';
            const btnF    = ot.estado === 'HECHO' ? `<button class="btn-factura" onclick="abrirGeneradorFactura(${ot.id})">💶 Factura</button>` : '';
            const btnE    = sesion.rol === 'admin'  ? `<button class="btn-editar" onclick="abrirEditarOT(${ot.id})">✏️</button>` : '';
            const nC      = ot.cliente_id ? (clientesGlobal.find(c => c.id === ot.cliente_id)?.nombre || '') : '';
            const sC      = nC ? `<br><small style="color:#7f8c8d;">🏢 ${nC}</small>` : '';
            const sT      = ot.tecnicos_nombres ? `<br><small style="color:#3498db; font-weight:bold;">👷 ${ot.tecnicos_nombres}</small>` : '';
            const clsEst  = ot.estado === 'HECHO' ? 'est-hecho' : (ot.estado === 'ANULADO' ? 'est-anulado' : 'est-pendiente');

            cont.innerHTML += `<div class="ot-card">
                <div class="ot-info">
                    <strong>${ot.codigo_ot}</strong> - ${ot.marca} ${sC} ${sT}
                    <br><strong style="color:#e67e22;">Materiales/Tickets: ${ot.materiales_precio.toFixed(2)} €</strong>
                </div>
                <div class="actions">
                    <select class="sel-estado ${clsEst}" ${disable} onchange="cambiarEstado(${ot.id}, this)">
                        <option value="PENDIENTE" ${ot.estado==='PENDIENTE'?'selected':''}>PENDIENTE</option>
                        <option value="HECHO"     ${ot.estado==='HECHO'    ?'selected':''}>HECHO</option>
                        <option value="ANULADO"   ${ot.estado==='ANULADO'  ?'selected':''}>ANULADO</option>
                    </select>
                    <button class="btn-ticket" onclick="abrirTicketsOT(${ot.id}, '${ot.codigo_ot}')">🧾 Materiales / Tickets</button>
                    ${btnF} ${btnE} ${btnB}
                </div>
            </div>`;
        });
    });
}

function cambiarEstado(id, sel) {
    API.put(`/api/ot/${id}/estado`, { estado: sel.value }).then(d => { alert('ℹ️ ' + d.mensaje); cargarOTs(); });
}

function eliminarOT(id) {
    if (!confirm('¿Solicitar borrado?')) return;
    API.delete(`/api/ot/${id}`).then(d => { alert('ℹ️ ' + d.mensaje); cargarOTs(); });
}

function abrirEditarOT(id) {
    const ot = otsGlobal.find(o => o.id === id);
    otActualId = id;
    document.getElementById('ed_codigo_ot').value         = ot.codigo_ot;
    document.getElementById('ed_ot_cliente_id').value     = ot.cliente_id || '';
    document.getElementById('ed_fecha_encargo').value     = ot.fecha_encargo || '';
    document.getElementById('ed_fecha_completada').value  = ot.fecha_completada || '';
    document.getElementById('ed_horas').value             = ot.horas;
    document.getElementById('ed_marca').value             = ot.marca;
    document.getElementById('ed_tipo_urgencia').value     = ot.tipo_urgencia;
    document.getElementById('ed_materiales_texto').innerText = `${ot.materiales_precio.toFixed(2)} €`;
    ed_tecnicosSeleccionados = ot.tecnicos_nombres ? ot.tecnicos_nombres.split(',').map(t => t.trim()) : [];
    renderizarEdTecnicosOT();
    abrirModal('modalEditarOT');
}

function guardarEdicionOT() {
    if (ed_tecnicosSeleccionados.length === 0) { alert('❌ Asigna al menos un técnico.'); return; }
    const datos = {
        codigo_ot:        document.getElementById('ed_codigo_ot').value,
        cliente_id:       document.getElementById('ed_ot_cliente_id').value || null,
        fecha_encargo:    document.getElementById('ed_fecha_encargo').value,
        fecha_completada: document.getElementById('ed_fecha_completada').value,
        horas:            parseFloat(document.getElementById('ed_horas').value),
        num_tecnicos:     ed_tecnicosSeleccionados.length,
        tecnicos_nombres: ed_tecnicosSeleccionados.join(', '),
        marca:            document.getElementById('ed_marca').value,
        tipo_urgencia:    document.getElementById('ed_tipo_urgencia').value
    };
    if (!validarFormulario(datos.codigo_ot, datos.fecha_encargo, datos.fecha_completada)) return;
    API.put(`/api/ot/${otActualId}`, datos).then(d => {
        if (d.error) alert('❌ ' + d.error);
        else { alert(d.mensaje); cerrarModal('modalEditarOT'); cargarOTs(); }
    });
}

// ── TICKETS / ADJUNTOS ───────────────────────────────────────

function abrirTicketsOT(id, codigo) {
    otActualId     = id;
    otActualCodigo = codigo;
    document.getElementById('t_codigo_ot').innerText = codigo;
    document.getElementById('t_file').value    = '';
    document.getElementById('t_importe').value = '';
    document.getElementById('t_desc').value    = '';
    API.get(`/api/ot/${id}/adjuntos`).then(data => {
        const galeria = document.getElementById('t_galeria');
        galeria.innerHTML = '';
        if (data.length === 0) {
            galeria.innerHTML = '<p style="grid-column:1/-1; color:#7f8c8d; text-align:center;">No hay líneas o tickets subidos.</p>';
        } else {
            data.forEach(t => {
                const btnB    = sesion.rol === 'admin' ? `<button class="btn-peligro" style="padding:3px 6px; font-size:0.8em; margin-top:5px;" onclick="borrarAdjuntoOT(${t.id}, ${id})">🗑️ Borrar</button>` : '';
                const isStock = String(t.descripcion).includes('[STOCK]');
                const imgHtml = isStock
                    ? `<div style="height:150px; background:#e8f8f5; display:flex; align-items:center; justify-content:center; color:#27ae60; font-weight:bold;">📦 STOCK</div>`
                    : `<img src="${t.imagen || imgDefecto}" class="ticket-img" onclick="window.open('${t.imagen}')">`;
                galeria.innerHTML += `<div class="ticket-card">
                    ${imgHtml}
                    <div class="ticket-info">
                        <strong>${t.importe.toFixed(2)} €</strong><br>
                        <small>${t.descripcion || 'Sin descripción'}</small><br>
                        <small style="color:#aaa;">${t.fecha}</small><br>
                        ${btnB}
                    </div>
                </div>`;
            });
        }
        abrirModal('modalTickets');
    });
}

function subirTicketOT() {
    const file    = document.getElementById('t_file').files[0];
    const importe = document.getElementById('t_importe').value;
    const desc    = document.getElementById('t_desc').value;
    if (!file) { alert('❌ Adjunta una foto.'); return; }
    comprimirImagen(file, (imagenB64) => {
        API.post(`/api/ot/${otActualId}/adjuntos`, { imagen: imagenB64, importe, descripcion: desc })
            .then(data => {
                if (data.error) alert('❌ ' + data.error);
                else { alert('✅ ' + data.mensaje); abrirTicketsOT(otActualId, otActualCodigo); cargarOTs(); }
            });
    });
}

function borrarAdjuntoOT(idAdjunto, otId) {
    if (!confirm('¿Seguro que quieres borrar este material/ticket? Se restará del total de la OT.')) return;
    API.delete(`/api/ot/adjuntos/${idAdjunto}`).then(data => {
        if (data.error) alert('❌ ' + data.error);
        else { abrirTicketsOT(otId, otActualCodigo); cargarOTs(); }
    });
}
