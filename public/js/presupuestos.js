// ── PRESUPUESTOS ──────────────────────────────────────────────

let presupuestosGlobal = [];
let clientesPresGlobal = [];
let lineasPres         = [];
let presEditandoId     = null;

const esAdmin = sesion.rol === 'admin';

// ── Helpers ────────────────────────────────────────────────────

function fmtP(v) {
    return parseFloat(v || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function fmtFecha(f) {
    if (!f) return '—';
    return f.split(' ')[0] || f;
}

function cerrarModal(id) { document.getElementById(id).style.display = 'none'; }

// ── Carga inicial ──────────────────────────────────────────────

Promise.all([
    API.get('/api/presupuestos'),
    API.get('/api/clientes'),
    API.get('/api/usuarios/nombres')
]).then(([pres, clientes, usuarios]) => {
    presupuestosGlobal = pres;
    clientesPresGlobal = clientes.filter(c => c.estado === 'ACTIVO' || !c.estado);
    renderizarPresupuestos(presupuestosGlobal);
    _poblarSelectClientes();
    const yo = usuarios.find(u => u.username === sesion.username);
    if (yo && yo.foto) document.getElementById('presAvatar').src = yo.foto;
});

function _poblarSelectClientes() {
    const sel = document.getElementById('presCliente');
    sel.innerHTML = '<option value="">— Sin cliente asignado —</option>';
    clientesPresGlobal.forEach(c => {
        sel.innerHTML += `<option value="${c.id}">${c.nombre}${c.nif ? ' — ' + c.nif : ''}</option>`;
    });
}

// ── Render lista ───────────────────────────────────────────────

function renderizarPresupuestos(lista) {
    const div = document.getElementById('presLista');
    if (!lista.length) {
        div.innerHTML = '<p style="color:#aaa; text-align:center; padding:40px 0;">No hay presupuestos. Crea el primero.</p>';
        return;
    }
    div.innerHTML = lista.map(p => {
        const estado = p.estado || 'BORRADOR';
        const acciones = _accionesPorEstado(p, estado);
        return `
        <div class="pres-card ${estado}" onclick="verPresupuesto(${p.id})" id="pcard_${p.id}">
            <div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span class="pres-ref">${p.referencia}</span>
                    <span class="badge-estado ${estado}">${_textoEstado(estado)}</span>
                </div>
                <div class="pres-cliente">${p.cliente_nombre || '— Sin cliente —'}</div>
                <div class="pres-desc">${p.descripcion || ''}</div>
            </div>
            <div class="pres-meta">
                <div style="text-align:right;">
                    <div class="pres-total">${fmtP(p.total)}</div>
                    <div class="pres-fecha">${fmtFecha(p.fecha_creacion)}</div>
                </div>
                <div class="pres-acciones" onclick="event.stopPropagation()">
                    ${acciones}
                </div>
            </div>
        </div>`;
    }).join('');
}

function _textoEstado(e) {
    return { BORRADOR:'Borrador', ENVIADO:'Enviado', ACEPTADO:'Aceptado', RECHAZADO:'Rechazado', CONVERTIDO:'OT creada' }[e] || e;
}

function _accionesPorEstado(p, estado) {
    const id = p.id;
    let btns = '';

    if (estado === 'BORRADOR' || estado === 'ENVIADO') {
        btns += `<button class="btn-pdf" onclick="generarPDF(${id})">PDF</button>`;
    }
    if (estado === 'BORRADOR') {
        if (esAdmin) btns += `<button class="btn-editar" onclick="abrirEditarPresupuesto(${id})">Editar</button>`;
        btns += `<button class="btn-enviar" onclick="marcarEnviado(${id})">Marcar enviado</button>`;
        if (p.cliente_email) btns += `<button class="btn-enviar" onclick="enviarPorEmail(${id})">Enviar email</button>`;
    }
    if (estado === 'ENVIADO') {
        if (esAdmin) {
            btns += `<button class="btn-aceptar" onclick="cambiarEstadoPres(${id},'ACEPTADO')">Aceptar</button>`;
            btns += `<button class="btn-rechazar" onclick="cambiarEstadoPres(${id},'RECHAZADO')">Rechazar</button>`;
        }
    }
    if (estado === 'ACEPTADO' && esAdmin) {
        btns += `<button class="btn-convertir" onclick="abrirConvertir(${id})">→ Crear OT</button>`;
        btns += `<button class="btn-pdf" onclick="generarPDF(${id})">PDF</button>`;
    }
    if ((estado === 'BORRADOR' || estado === 'RECHAZADO') && esAdmin) {
        btns += `<button class="btn-eliminar" onclick="eliminarPresupuesto(${id})">Eliminar</button>`;
    }
    return btns;
}

// ── Filtros ────────────────────────────────────────────────────

function filtrarPresupuestos() {
    const estado  = document.getElementById('filtroEstado').value;
    const buscar  = document.getElementById('filtroBuscar').value.toLowerCase();
    const filtrado = presupuestosGlobal.filter(p => {
        const matchEstado = !estado || p.estado === estado;
        const matchBuscar = !buscar
            || (p.referencia || '').toLowerCase().includes(buscar)
            || (p.cliente_nombre || '').toLowerCase().includes(buscar)
            || (p.descripcion || '').toLowerCase().includes(buscar);
        return matchEstado && matchBuscar;
    });
    renderizarPresupuestos(filtrado);
}

// ── Nuevo / Editar ─────────────────────────────────────────────

function abrirNuevoPresupuesto() {
    presEditandoId = null;
    lineasPres     = [];
    document.getElementById('modalPresTitle').innerText = 'Nuevo presupuesto';
    document.getElementById('presCliente').value        = '';
    document.getElementById('presDescripcion').value    = '';
    document.getElementById('presNotas').value          = '';
    _renderLineasPres();
    _calcularResumen();
    document.getElementById('modalPresupuesto').style.display = 'flex';
}

function abrirEditarPresupuesto(id) {
    const p = presupuestosGlobal.find(x => x.id === id);
    if (!p) return;
    presEditandoId = id;
    lineasPres     = JSON.parse(p.lineas || '[]');
    document.getElementById('modalPresTitle').innerText   = `Editar ${p.referencia}`;
    document.getElementById('presCliente').value          = p.cliente_id || '';
    document.getElementById('presDescripcion').value      = p.descripcion || '';
    document.getElementById('presNotas').value            = p.notas || '';
    _renderLineasPres();
    _calcularResumen();
    document.getElementById('modalPresupuesto').style.display = 'flex';
}

function addLineaPres(desc = '', importe = '') {
    lineasPres.push({ descripcion: desc, importe: importe });
    _renderLineasPres();
}

function _renderLineasPres() {
    const div = document.getElementById('lineasPres');
    div.innerHTML = lineasPres.map((l, i) => `
        <div class="linea-pres">
            <input type="text" placeholder="Descripción" value="${l.descripcion || ''}"
                   oninput="lineasPres[${i}].descripcion = this.value">
            <input type="number" placeholder="Importe €" value="${l.importe || ''}" style="width:110px;"
                   oninput="lineasPres[${i}].importe = parseFloat(this.value)||0; _calcularResumen()">
            <button class="btn-rm" onclick="lineasPres.splice(${i},1); _renderLineasPres(); _calcularResumen()">✕</button>
        </div>
    `).join('');
}

function _calcularResumen() {
    const base = lineasPres.reduce((s, l) => s + (parseFloat(l.importe) || 0), 0);
    const iva  = base * 0.21;
    const total = base + iva;
    document.getElementById('presBase').innerText  = fmtP(base);
    document.getElementById('presIva').innerText   = fmtP(iva);
    document.getElementById('presTotal').innerText = fmtP(total);
}

async function guardarPresupuesto() {
    const cliente_id   = document.getElementById('presCliente').value || null;
    const descripcion  = document.getElementById('presDescripcion').value.trim();
    const notas        = document.getElementById('presNotas').value.trim();
    const base         = lineasPres.reduce((s, l) => s + (parseFloat(l.importe) || 0), 0);
    const iva          = base * 0.21;
    const total        = base + iva;

    const payload = { cliente_id, descripcion, lineas: lineasPres, base_imponible: base, iva, total, notas };

    let res;
    if (presEditandoId) {
        res = await API.put(`/api/presupuestos/${presEditandoId}`, payload);
    } else {
        res = await API.post('/api/presupuestos', payload);
    }

    if (res.ok || res.referencia) {
        cerrarModal('modalPresupuesto');
        const lista = await API.get('/api/presupuestos');
        presupuestosGlobal = lista;
        renderizarPresupuestos(lista);
    } else {
        alert('Error al guardar: ' + (res.error || 'desconocido'));
    }
}

// ── Acciones de estado ─────────────────────────────────────────

async function cambiarEstadoPres(id, estado) {
    const res = await API.put(`/api/presupuestos/${id}/estado`, { estado });
    if (res.ok) {
        const lista = await API.get('/api/presupuestos');
        presupuestosGlobal = lista;
        filtrarPresupuestos();
    }
}

async function marcarEnviado(id) {
    await cambiarEstadoPres(id, 'ENVIADO');
}

async function eliminarPresupuesto(id) {
    if (!confirm('¿Eliminar este presupuesto? Esta acción no se puede deshacer.')) return;
    const res = await API.delete(`/api/presupuestos/${id}`);
    if (res.ok) {
        presupuestosGlobal = presupuestosGlobal.filter(p => p.id !== id);
        filtrarPresupuestos();
    }
}

// ── Detalle (click en tarjeta) ─────────────────────────────────

function verPresupuesto(id) {
    // Solo abre edición si es borrador y admin, si no genera PDF
    const p = presupuestosGlobal.find(x => x.id === id);
    if (!p) return;
    if (p.estado === 'BORRADOR' && esAdmin) {
        abrirEditarPresupuesto(id);
    } else {
        generarPDF(id);
    }
}

// ── Convertir a OT ─────────────────────────────────────────────

function abrirConvertir(id) {
    document.getElementById('convertirPresId').value    = id;
    document.getElementById('convertirTecnicos').value  = '';
    document.getElementById('convertirFecha').value     = new Date().toISOString().split('T')[0];
    document.getElementById('modalConvertir').style.display = 'flex';
}

async function ejecutarConversion() {
    const id        = document.getElementById('convertirPresId').value;
    const tecnicos  = document.getElementById('convertirTecnicos').value.trim();
    const fecha     = document.getElementById('convertirFecha').value;
    const res = await API.post(`/api/presupuestos/${id}/convertir`, { tecnicos_nombres: tecnicos, fecha_encargo: fecha });
    if (res.ok) {
        cerrarModal('modalConvertir');
        alert(`✅ OT creada: ${res.codigoOT}`);
        const lista = await API.get('/api/presupuestos');
        presupuestosGlobal = lista;
        filtrarPresupuestos();
    } else {
        alert('Error: ' + (res.error || 'desconocido'));
    }
}

// ── PDF ────────────────────────────────────────────────────────

function _rellenarPDF(p) {
    document.getElementById('pdfRef').innerText          = p.referencia;
    document.getElementById('pdfFecha').innerText        = fmtFecha(p.fecha_creacion);
    document.getElementById('pdfCliente').innerText      = p.cliente_nombre || '— Sin cliente —';
    document.getElementById('pdfClienteNif').innerText   = p.cliente_nif    ? `NIF: ${p.cliente_nif}` : '';
    document.getElementById('pdfClienteDir').innerText   = p.cliente_direccion || '';
    document.getElementById('pdfClienteEmail').innerText = p.cliente_email  || '';
    document.getElementById('pdfDesc').innerText         = p.descripcion    || '';

    const lineas = JSON.parse(p.lineas || '[]');
    document.getElementById('pdfLineas').innerHTML = lineas.map((l, i) =>
        `<tr style="background:${i%2===0?'#fff':'#f8f9fa'}">
            <td style="padding:9px 14px; border-bottom:1px solid #f0f0f0;">${l.descripcion || ''}</td>
            <td style="padding:9px 14px; border-bottom:1px solid #f0f0f0; text-align:right; font-weight:600;">${fmtP(l.importe)}</td>
        </tr>`
    ).join('');

    document.getElementById('pdfBase2').innerText  = fmtP(p.base_imponible);
    document.getElementById('pdfIva2').innerText   = fmtP(p.iva);
    document.getElementById('pdfTotal2').innerText = fmtP(p.total);

    const notasBloque = document.getElementById('pdfNotasBloque');
    if (p.notas) {
        document.getElementById('pdfNotas').innerText = p.notas;
        notasBloque.style.display = 'block';
    } else {
        notasBloque.style.display = 'none';
    }
}

function generarPDF(id) {
    const p = presupuestosGlobal.find(x => x.id === id);
    if (!p) return;
    _rellenarPDF(p);
    const el = document.getElementById('pdfPresupuesto');
    el.style.display = 'block';
    html2pdf().set({
        margin:      0,
        filename:    `${p.referencia.replace('/', '-')}.pdf`,
        image:       { type: 'jpeg', quality: 0.97 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(el).save().then(() => { el.style.display = 'none'; });
}

async function enviarPorEmail(id) {
    const p = presupuestosGlobal.find(x => x.id === id);
    if (!p || !p.cliente_email) { alert('El cliente no tiene email registrado.'); return; }
    if (!confirm(`¿Enviar el presupuesto ${p.referencia} a ${p.cliente_email}?`)) return;

    _rellenarPDF(p);

    const el = document.getElementById('pdfPresupuesto');
    el.style.display = 'block';

    try {
        const blob = await html2pdf().set({
            margin: [10,10], image: { type:'jpeg', quality:0.95 },
            html2canvas: { scale:2 }, jsPDF: { unit:'mm', format:'a4', orientation:'portrait' }
        }).from(el).outputPdf('blob');

        el.style.display = 'none';

        const reader = new FileReader();
        reader.onload = async () => {
            const base64 = reader.result.split(',')[1];
            const res    = await API.post(`/api/presupuestos/${id}/email`, { pdfBase64: base64 });
            if (res.ok) {
                alert('✅ Presupuesto enviado por email.');
                const lista = await API.get('/api/presupuestos');
                presupuestosGlobal = lista;
                filtrarPresupuestos();
            } else {
                alert('Error al enviar: ' + (res.error || 'desconocido'));
            }
        };
        reader.readAsDataURL(blob);
    } catch (e) {
        el.style.display = 'none';
        alert('Error generando PDF: ' + e.message);
    }
}
