// ── PRESUPUESTOS ──────────────────────────────────────────────

let presupuestosGlobal = [];
let clientesPresGlobal = [];
let lineasPres         = [];
let presEditandoId     = null;
let otsParaAsociar     = [];  // cache de OTs para el buscador

const esAdmin = sesion.rol === 'admin';

// ── Helpers ────────────────────────────────────────────────────

function fmtP(v) {
    return parseFloat(v || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function fmtFecha(f) { if (!f) return '—'; return f.split(' ')[0] || f; }
function cerrarModal(id) { document.getElementById(id).style.display = 'none'; }

// ── Carga inicial ──────────────────────────────────────────────

Promise.all([
    API.get('/api/presupuestos'),
    API.get('/api/clientes'),
    API.get('/api/usuarios/nombres')
]).then(([pres, clientes, usuarios]) => {
    presupuestosGlobal = pres;
    clientesPresGlobal = clientes.filter(c => c.estado === 'ACTIVO' || !c.estado || c.estado === 'APROBADO');
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
        const otBadge = p.ot_asociada_codigo
            ? `<span style="font-size:0.75em; background:#e8f8f5; color:#1abc9c; padding:2px 7px; border-radius:10px; margin-left:6px;">OT: ${p.ot_asociada_codigo}</span>`
            : '';
        const factBadges = [
            p.proforma_numero     ? `<span style="font-size:0.72em; background:#ebf5fb; color:#2980b9; padding:2px 7px; border-radius:10px;">Proforma: ${p.proforma_numero}</span>` : '',
            p.factura_final_numero ? `<span style="font-size:0.72em; background:#eafaf1; color:#27ae60; padding:2px 7px; border-radius:10px;">Final: ${p.factura_final_numero}</span>` : ''
        ].filter(Boolean).join(' ');
        return `
        <div class="pres-card ${estado}" onclick="verPresupuesto(${p.id})" id="pcard_${p.id}">
            <div>
                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <span class="pres-ref">${p.referencia}</span>
                    <span class="badge-estado ${estado}">${_textoEstado(estado)}</span>
                    ${otBadge}
                </div>
                <div class="pres-cliente">${p.cliente_nombre || '— Sin cliente —'}</div>
                <div class="pres-desc">${p.descripcion || ''}</div>
                ${factBadges ? `<div style="margin-top:5px; display:flex; gap:6px; flex-wrap:wrap;">${factBadges}</div>` : ''}
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

    btns += `<button class="btn-pdf" onclick="generarPDF(${id})">PDF</button>`;

    if (estado === 'BORRADOR') {
        if (esAdmin) btns += `<button class="btn-editar" onclick="abrirEditarPresupuesto(${id})">Editar</button>`;
        btns += `<button class="btn-enviar" onclick="marcarEnviado(${id})">Marcar enviado</button>`;
        if (p.cliente_email) btns += `<button class="btn-enviar" onclick="enviarPorEmail(${id})">Email</button>`;
    }
    if (estado === 'ENVIADO' && esAdmin) {
        btns += `<button class="btn-aceptar" onclick="cambiarEstadoPres(${id},'ACEPTADO')">Aceptar</button>`;
        btns += `<button class="btn-rechazar" onclick="cambiarEstadoPres(${id},'RECHAZADO')">Rechazar</button>`;
    }
    if (estado === 'ACEPTADO' && esAdmin) {
        btns += `<button class="btn-convertir" onclick="abrirConvertir(${id})">→ Crear OT</button>`;
        if (!p.proforma_numero) {
            btns += `<button class="btn-proforma" onclick="abrirEmitirFacturaPres(${id},'proforma')">Proforma</button>`;
        }
        if (!p.factura_final_numero) {
            btns += `<button class="btn-ffinal" onclick="abrirEmitirFacturaPres(${id},'final')">Factura Final</button>`;
        }
    }
    if (['ACEPTADO','CONVERTIDO'].includes(estado) && esAdmin) {
        btns += `<button class="btn-editar" onclick="abrirAsociarOT(${id})">🔗 OT</button>`;
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
            || (p.descripcion || '').toLowerCase().includes(buscar)
            || (p.ot_asociada_codigo || '').toLowerCase().includes(buscar)
            || (p.proforma_numero || '').toLowerCase().includes(buscar)
            || (p.factura_final_numero || '').toLowerCase().includes(buscar);
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
            <input type="text" class="lp-desc" placeholder="Descripción del concepto" value="${(l.descripcion || '').replace(/"/g,'&quot;')}"
                   oninput="lineasPres[${i}].descripcion = this.value">
            <input type="number" class="lp-importe" placeholder="Importe €" value="${l.importe || ''}"
                   oninput="lineasPres[${i}].importe = parseFloat(this.value)||0; _calcularResumen()">
            <button class="btn-rm" onclick="lineasPres.splice(${i},1); _renderLineasPres(); _calcularResumen()">✕</button>
        </div>
    `).join('');
}

function _calcularResumen() {
    const base  = lineasPres.reduce((s, l) => s + (parseFloat(l.importe) || 0), 0);
    const iva   = base * 0.21;
    const total = base + iva;
    document.getElementById('presBase').innerText  = fmtP(base);
    document.getElementById('presIva').innerText   = fmtP(iva);
    document.getElementById('presTotal').innerText = fmtP(total);
}

async function guardarPresupuesto() {
    const cliente_id  = document.getElementById('presCliente').value || null;
    const descripcion = document.getElementById('presDescripcion').value.trim();
    const notas       = document.getElementById('presNotas').value.trim();
    const base        = lineasPres.reduce((s, l) => s + (parseFloat(l.importe) || 0), 0);
    const iva         = base * 0.21;
    const total       = base + iva;

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
async function marcarEnviado(id) { await cambiarEstadoPres(id, 'ENVIADO'); }

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
    const p = presupuestosGlobal.find(x => x.id === id);
    if (!p) return;
    if (p.estado === 'BORRADOR' && esAdmin) abrirEditarPresupuesto(id);
    else generarPDF(id);
}

// ── Convertir a OT ─────────────────────────────────────────────

function abrirConvertir(id) {
    document.getElementById('convertirPresId').value   = id;
    document.getElementById('convertirTecnicos').value = '';
    document.getElementById('convertirFecha').value    = new Date().toISOString().split('T')[0];
    document.getElementById('modalConvertir').style.display = 'flex';
}

async function ejecutarConversion() {
    const id       = document.getElementById('convertirPresId').value;
    const tecnicos = document.getElementById('convertirTecnicos').value.trim();
    const fecha    = document.getElementById('convertirFecha').value;
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

// ── Factura Proforma / Final ───────────────────────────────────

function abrirEmitirFacturaPres(id, tipo) {
    const p = presupuestosGlobal.find(x => x.id === id);
    if (!p) return;

    document.getElementById('emitirFactPresId').value   = id;
    document.getElementById('emitirFactPresTipo').value = tipo;

    if (tipo === 'proforma') {
        document.getElementById('emitirFactPresTitle').innerText = 'Emitir Factura Proforma';
        document.getElementById('emitirFactPresDesc').innerHTML =
            `Se emitirá una <strong>factura proforma</strong> por el total del presupuesto: <strong>${fmtP(p.total)}</strong><br>
             <span style="color:#e67e22; font-size:0.85em;">Esta factura quedará numerada y será permanente.</span>`;
    } else {
        const yaTienePF = !!p.proforma_numero;
        const restante  = yaTienePF ? Math.max(0, p.total - (p.proforma_total || 0)) : p.total;
        document.getElementById('emitirFactPresTitle').innerText = 'Emitir Factura Final';
        document.getElementById('emitirFactPresDesc').innerHTML = yaTienePF
            ? `Proforma emitida: <strong>${p.proforma_numero}</strong> (${fmtP(p.proforma_total)})<br>
               Se facturará el importe restante: <strong>${fmtP(restante)}</strong>`
            : `No hay proforma previa. Se facturará el total: <strong>${fmtP(p.total)}</strong>`;
    }
    document.getElementById('modalEmitirFacturaPres').style.display = 'flex';
}

async function confirmarEmitirFacturaPres() {
    const id   = parseInt(document.getElementById('emitirFactPresId').value);
    const tipo = document.getElementById('emitirFactPresTipo').value;
    const p    = presupuestosGlobal.find(x => x.id === id);
    if (!p) return;

    let base, iva, total, lineas;

    if (tipo === 'proforma') {
        base   = p.base_imponible;
        iva    = p.iva;
        total  = p.total;
        lineas = JSON.parse(p.lineas || '[]');
    } else {
        // Final: si hay proforma, solo el restante
        if (p.proforma_numero && p.proforma_total) {
            const restanteBruto = Math.max(0, p.total - p.proforma_total);
            base   = restanteBruto / 1.21;
            iva    = base * 0.21;
            total  = restanteBruto;
            lineas = [{ descripcion: `Resto factura presupuesto ${p.referencia}`, importe: parseFloat(base.toFixed(2)) }];
        } else {
            base   = p.base_imponible;
            iva    = p.iva;
            total  = p.total;
            lineas = JSON.parse(p.lineas || '[]');
        }
    }

    const res = await API.post('/api/factura/desde-presupuesto', {
        presupuesto_id: id, tipo, base_imponible: base, iva, total, lineas
    });

    if (res.error) { alert('❌ ' + res.error); return; }
    cerrarModal('modalEmitirFacturaPres');

    // Refrescar y generar PDF
    const lista = await API.get('/api/presupuestos');
    presupuestosGlobal = lista;
    filtrarPresupuestos();

    const pActualizado = presupuestosGlobal.find(x => x.id === id);
    if (pActualizado) await _generarFacturaPDF(pActualizado, tipo, res.numero_factura, res.fecha_emision, base, iva, total, lineas);
}

async function _generarFacturaPDF(p, tipo, numero_factura, fecha_emision, base, iva, total, lineas) {
    const esProforma = tipo === 'proforma';
    const el = document.getElementById('pdfFacturaPres');

    // Logo como base64
    try {
        const logoB64 = await _cargarLogoBase64();
        if (logoB64) document.getElementById('pdfFactPresLogo').src = logoB64;
    } catch (_) {}

    document.getElementById('pdfFactPresTitulo').innerText  = esProforma ? 'FACTURA PROFORMA' : 'FACTURA';
    document.getElementById('pdfFactPresNumero').innerText  = `Nº ${numero_factura}`;
    document.getElementById('pdfFactPresFecha').innerText   = fecha_emision
        ? new Date(fecha_emision + 'T00:00:00').toLocaleDateString('es-ES')
        : new Date().toLocaleDateString('es-ES');
    document.getElementById('pdfFactPresRef').innerText     = p.referencia;
    document.getElementById('pdfFactPresCliente').innerText = p.cliente_nombre || '— Sin cliente —';
    document.getElementById('pdfFactPresClienteNif').innerText  = p.cliente_nif     ? `NIF: ${p.cliente_nif}` : '';
    document.getElementById('pdfFactPresClienteDir').innerText  = p.cliente_direccion || '';
    document.getElementById('pdfFactPresBase').innerText    = fmtP(base);
    document.getElementById('pdfFactPresIva').innerText     = fmtP(iva);
    document.getElementById('pdfFactPresTotal').innerText   = fmtP(total);
    document.getElementById('pdfFactPresNotaProforma').style.display = esProforma ? 'block' : 'none';

    document.getElementById('pdfFactPresLineas').innerHTML = (lineas || []).map((l, i) =>
        `<tr style="background:${i%2===0?'#fff':'#f8f9fa'}">
            <td style="padding:9px 14px; border-bottom:1px solid #f0f0f0;">${l.descripcion || ''}</td>
            <td style="padding:9px 14px; border-bottom:1px solid #f0f0f0; text-align:right; font-weight:600;">${fmtP(l.importe)}</td>
        </tr>`
    ).join('');

    el.style.display = 'block';
    html2pdf().set({
        margin:      0,
        filename:    `Factura-${numero_factura}.pdf`,
        image:       { type: 'jpeg', quality: 0.97 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(el).save().then(() => { el.style.display = 'none'; });
}

// ── Asociar a OT ───────────────────────────────────────────────

async function abrirAsociarOT(id) {
    document.getElementById('asociarPresId').value = id;
    document.getElementById('buscarOTInput').value = '';
    document.getElementById('listaOTsBusqueda').innerHTML = '<p style="color:#aaa; padding:12px; text-align:center;">Cargando OTs...</p>';
    document.getElementById('modalAsociarOT').style.display = 'flex';

    // Cargar OTs si no están en caché
    if (!otsParaAsociar.length) {
        const ots = await API.get('/api/ot');
        otsParaAsociar = ots || [];
    }
    _renderOTsBusqueda('');
}

function buscarOTsParaAsociar() {
    const q = document.getElementById('buscarOTInput').value.toLowerCase();
    _renderOTsBusqueda(q);
}

function _renderOTsBusqueda(q) {
    const lista = document.getElementById('listaOTsBusqueda');
    const filtradas = otsParaAsociar.filter(ot =>
        !q
        || (ot.codigo_ot    || '').toLowerCase().includes(q)
        || (ot.marca        || '').toLowerCase().includes(q)
        || (ot.tipo_urgencia|| '').toLowerCase().includes(q)
        || String(ot.id).includes(q)
    ).slice(0, 50);

    if (!filtradas.length) {
        lista.innerHTML = '<p style="color:#aaa; padding:12px; text-align:center;">Sin resultados.</p>';
        return;
    }

    lista.innerHTML = filtradas.map(ot => {
        const fechaL = ot.fecha_encargo ? ot.fecha_encargo.split('T')[0] : '';
        return `<div onclick="confirmarAsociarOT(${ot.id},'${ot.codigo_ot}')"
                     style="padding:11px 14px; cursor:pointer; border-bottom:1px solid #eee; transition:background .12s;"
                     onmouseover="this.style.background='#f0f9f7'" onmouseout="this.style.background=''">
            <div style="font-weight:700; color:#2c3e50;">${ot.codigo_ot}</div>
            <div style="font-size:0.82em; color:#7f8c8d;">${ot.marca || ''} · ${ot.tipo_urgencia || ''} · ${fechaL}</div>
            ${ot.numero_factura ? `<div style="font-size:0.78em; color:#1abc9c;">Factura: ${ot.numero_factura}</div>` : ''}
        </div>`;
    }).join('');
}

async function confirmarAsociarOT(ot_id, ot_codigo) {
    if (!confirm(`¿Asociar este presupuesto a la OT ${ot_codigo}?`)) return;
    const id = document.getElementById('asociarPresId').value;
    const res = await API.put(`/api/presupuestos/${id}/asociar-ot`, { ot_id, ot_codigo });
    if (res.ok) {
        cerrarModal('modalAsociarOT');
        const lista = await API.get('/api/presupuestos');
        presupuestosGlobal = lista;
        filtrarPresupuestos();
    } else {
        alert('Error: ' + (res.error || 'desconocido'));
    }
}

// ── PDF Presupuesto ────────────────────────────────────────────

async function _cargarLogoBase64() {
    const resp = await fetch('/logo.png');
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

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

async function generarPDF(id) {
    const p = presupuestosGlobal.find(x => x.id === id);
    if (!p) return;
    _rellenarPDF(p);

    // Cargar logo como base64 para que html2pdf lo renderice correctamente
    try {
        const logoB64 = await _cargarLogoBase64();
        if (logoB64) document.getElementById('pdfLogo').src = logoB64;
    } catch (_) {}

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
    try {
        const logoB64 = await _cargarLogoBase64();
        if (logoB64) document.getElementById('pdfLogo').src = logoB64;
    } catch (_) {}

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
