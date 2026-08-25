// sesion, sesionStr, headersSeguridad, escapeHTML, prefijoAnoActual, clientesGlobal,
// otsGlobal, ed_tecnicosSeleccionados y otActualId los aportan /js/api.js, /js/ui.js
// y /js/modules/ot.js, cargados ANTES que este archivo (api.js ya valida la sesión y
// redirige a /login si falta). NO se redeclaran aquí: un const/let duplicado entre
// scripts clásicos lanza SyntaxError y dejaría toda la página sin JS.

document.getElementById('infoUsuarioBBDD').innerHTML = `👤 <strong>${sesion.username.toUpperCase()}</strong> (${sesion.rol})`;
if (sesion.rol !== 'admin') document.getElementById('colAcciones').style.display = 'none';

let datosBBDD = [];

// ── CARGA DE DATOS ───────────────────────────────────────────

async function cargarDatos() {
    try {
        cargarUsuariosParaOT();

        const resClientes = await fetch('/api/clientes', { headers: headersSeguridad });
        if (resClientes.status === 401) { localStorage.removeItem('sesionPlusUltra'); window.location.href = '/login'; return; }
        clientesGlobal = await resClientes.json();

        const selectCliente = document.getElementById('filtroCliente');
        const selEdit = document.getElementById('ed_ot_cliente_id');
        const clientesAprobados = clientesGlobal.filter(c => c.estado === 'APROBADO');
        clientesAprobados.forEach(c => {
            selectCliente.innerHTML += `<option value="${c.id}">${c.nombre}</option>`;
            selEdit.innerHTML += `<option value="${c.id}">${c.nombre}</option>`;
        });
        poblarSelectFactura();   // rellena el <select> de cliente del modal de factura

        const resOT = await fetch('/api/ot', { headers: headersSeguridad });
        datosBBDD = await resOT.json();
        otsGlobal = datosBBDD;   // facturas.js localiza la OT en otsGlobal
        dibujarTabla(datosBBDD);
    } catch (e) {
        document.getElementById('cuerpoTabla').innerHTML =
            '<tr><td colspan="12" style="color:red; text-align:center;">Error cargando datos.</td></tr>';
    }
}

// ── TABLA ────────────────────────────────────────────────────

function dibujarTabla(datos) {
    const tbody = document.getElementById('cuerpoTabla');
    tbody.innerHTML = '';

    if (datos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" style="text-align:center; color:#7f8c8d; padding:30px;">No hay resultados con los filtros seleccionados.</td></tr>';
        return;
    }

    datos.forEach(ot => {
        const colorEstado = ot.estado === 'HECHO' ? '#27ae60' : (ot.estado === 'ANULADO' ? '#e74c3c' : '#f1c40f');
        const colorTexto  = ot.estado === 'PENDIENTE' ? '#333' : 'white';

        const celdaAcciones = sesion.rol === 'admin'
            ? `<td style="display:flex; gap:5px;">
                 <button class="btn-editar" title="Editar OT" onclick="abrirEditarOT(${ot.id})">✏️</button>
                 <button class="btn btn-peligro" title="Borrar de la BBDD" onclick="eliminarFila(${ot.id})">🗑️</button>
               </td>`
            : '<td style="display:none;"></td>';

        const cliente      = clientesGlobal.find(c => c.id === ot.cliente_id);
        const nombreCliente = cliente ? cliente.nombre : 'Consumidor Final';
        const tecnicos     = ot.tecnicos_nombres ? ot.tecnicos_nombres : ot.num_tecnicos;
        const fechaLimpia  = ot.fecha_encargo ? ot.fecha_encargo.replace('T', ' ') : '';

        tbody.innerHTML += `<tr>
            <td>${ot.id}</td>
            <td><a href="javascript:void(0)" onclick="abrirFacturaDesdeBBDD(${ot.id})" style="color:#1abc9c; font-weight:bold; text-decoration:none; cursor:pointer;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'" title="Abrir la factura de esta OT (sin salir de la BBDD)">${escapeHTML(ot.codigo_ot)}</a></td>
            <td>${escapeHTML(nombreCliente)}</td>
            <td>${escapeHTML(ot.marca)}</td>
            <td>${escapeHTML(fechaLimpia)}</td>
            <td>${escapeHTML(ot.tipo_urgencia)}</td>
            <td>${ot.horas}</td>
            <td>${escapeHTML(tecnicos)}</td>
            <td>${ot.materiales_precio} €</td>
            <td><span class="badge" style="background-color:${colorEstado}; color:${colorTexto};">${escapeHTML(ot.estado)}</span></td>
            <td style="color:${ot.numero_factura ? '#1abc9c' : '#ccc'}; font-weight:${ot.numero_factura ? 'bold' : 'normal'};">${escapeHTML(ot.numero_factura) || '—'}${ot.factura_anterior_numero ? `<br><small style="color:#e67e22; font-weight:normal;" title="Factura rectificada (anulada)">↩ ${escapeHTML(ot.factura_anterior_numero)} rectif.${ot.factura_anterior_rectificativa ? ' (' + escapeHTML(ot.factura_anterior_rectificativa) + ')' : ''}</small>` : ''}</td>
            ${celdaAcciones}
        </tr>`;
    });
}

function eliminarFila(id) {
    if (!confirm('⚠ CUIDADO: Estás a punto de borrar esta OT para siempre. ¿Continuar?')) return;
    fetch(`/api/ot/${id}`, { method: 'DELETE', headers: headersSeguridad })
        .then(res => res.json())
        .then(data => { if (data.error) alert('❌ ' + data.error); else cargarDatos(); });
}

// ── MODAL DE EDICIÓN ─────────────────────────────────────────

function abrirModal(id)  { document.getElementById(id).style.display = 'block'; }
function cerrarModal(id) {
    document.getElementById(id).style.display = 'none';
    // Al cerrar el modal de factura abierto desde la BBDD, refrescar la tabla:
    // facturas.js actualiza otsGlobal tras emitir/asignar/rectificar, pero no la tabla.
    if (id === 'modalFactura' && Array.isArray(otsGlobal)) { datosBBDD = otsGlobal; filtrarTabla(); }
}

/** Rellena el <select id="selClienteFactura"> del modal de factura (mismo patrón que clientes.js). */
function poblarSelectFactura() {
    const selFact = document.getElementById('selClienteFactura');
    if (!selFact) return;
    selFact.innerHTML = '<option value="">-- Seleccionar Cliente --</option>';
    clientesGlobal.filter(c => c.estado === 'APROBADO').forEach(c => {
        selFact.innerHTML += `<option value="${c.id}">${escapeHTML(c.nombre)}</option>`;
    });
}

/** Abre la factura de una OT en el modal, dentro de la propia BBDD (sin navegar a /facturas). */
function abrirFacturaDesdeBBDD(id) {
    if (!Array.isArray(otsGlobal) || !otsGlobal.find(o => o.id === id)) {
        // Salvaguarda por si los datos aún no estuvieran cargados: recargar y reintentar.
        cargarDatos().then(() => {
            if (Array.isArray(otsGlobal) && otsGlobal.find(o => o.id === id)) abrirGeneradorFactura(id);
        });
        return;
    }
    abrirGeneradorFactura(id);
}

function cargarUsuariosParaOT() {
    document.getElementById('ed_selTecnicosAdd').innerHTML = OPCIONES_TECNICOS_OT;
}

function agregarEdTecnicoOT() {
    const s = document.getElementById('ed_selTecnicosAdd');
    if (s.value && !ed_tecnicosSeleccionados.includes(s.value)) {
        ed_tecnicosSeleccionados.push(s.value);
        renderizarEdTecnicosOT();
    }
    s.value = '';
}

function quitarEdTecnicoOT(nombre) {
    ed_tecnicosSeleccionados = ed_tecnicosSeleccionados.filter(t => t !== nombre);
    renderizarEdTecnicosOT();
}

function renderizarEdTecnicosOT() {
    const d = document.getElementById('ed_listaTecnicosOT');
    d.innerHTML = '';
    ed_tecnicosSeleccionados.forEach(t => {
        d.innerHTML += `<div class="tecnico-badge">👤 ${t} <span onclick="quitarEdTecnicoOT('${t}')">&times;</span></div>`;
    });
}

function validarFormulario(codigo, fechaIn, fechaOut) {
    if (!codigo || !/^ot\d{2}\//i.test(codigo)) { alert('❌ El código de OT no es válido (debe ser tipo OT26/12345).'); return false; }
    if (fechaOut && new Date(fechaOut) <= new Date(fechaIn)) { alert('❌ Finalización debe ser posterior al inicio.'); return false; }
    return true;
}

function abrirEditarOT(id) {
    const ot = datosBBDD.find(o => o.id === id);
    otActualId = id;
    document.getElementById('ed_codigo_ot').value          = ot.codigo_ot;
    document.getElementById('ed_ot_cliente_id').value      = ot.cliente_id || '';
    document.getElementById('ed_fecha_encargo').value      = ot.fecha_encargo || '';
    document.getElementById('ed_fecha_completada').value   = ot.fecha_completada || '';
    document.getElementById('ed_horas').value              = ot.horas;
    document.getElementById('ed_marca').value              = ot.marca;
    document.getElementById('ed_tipo_urgencia').value      = ot.tipo_urgencia;
    document.getElementById('ed_materiales_precio').value  = ot.materiales_precio;

    ed_tecnicosSeleccionados = ot.tecnicos_nombres
        ? ot.tecnicos_nombres.split(',').map(t => t.trim())
        : [];
    renderizarEdTecnicosOT();
    abrirModal('modalEditarOT');
}

function guardarEdicionOT() {
    if (ed_tecnicosSeleccionados.length === 0) { alert('❌ Asigna al menos un técnico.'); return; }

    const datos = {
        codigo_ot:         document.getElementById('ed_codigo_ot').value,
        cliente_id:        document.getElementById('ed_ot_cliente_id').value || null,
        fecha_encargo:     document.getElementById('ed_fecha_encargo').value,
        fecha_completada:  document.getElementById('ed_fecha_completada').value,
        horas:             parseFloat(document.getElementById('ed_horas').value),
        num_tecnicos:      ed_tecnicosSeleccionados.length,
        tecnicos_nombres:  ed_tecnicosSeleccionados.join(', '),
        marca:             document.getElementById('ed_marca').value,
        tipo_urgencia:     document.getElementById('ed_tipo_urgencia').value,
        materiales_precio: parseFloat(document.getElementById('ed_materiales_precio').value)
    };

    if (!validarFormulario(datos.codigo_ot, datos.fecha_encargo, datos.fecha_completada)) return;

    fetch(`/api/ot/${otActualId}`, { method: 'PUT', headers: headersSeguridad, body: JSON.stringify(datos) })
        .then(r => r.json())
        .then(d => {
            if (d.error) alert('❌ ' + d.error);
            else { alert(d.mensaje); cerrarModal('modalEditarOT'); borrarFiltros(); }
        });
}

// ── FILTROS ──────────────────────────────────────────────────

function filtrarTabla() {
    const textoOT         = document.getElementById('filtroOT').value.toLowerCase();
    const textoNumFactura = document.getElementById('filtroNumFactura').value.toLowerCase();
    const textoMarca      = document.getElementById('filtroMarca').value.toLowerCase();
    const comboEstado  = document.getElementById('filtroEstado').value;
    const comboCliente = document.getElementById('filtroCliente').value;
    const fechaIni   = document.getElementById('filtroFechaInicio').value;
    const fechaFin   = document.getElementById('filtroFechaFin').value;

    const filtrados = datosBBDD.filter(ot => {
        const coincideOT         = ot.codigo_ot.toLowerCase().includes(textoOT);
        const coincideNumFactura = !textoNumFactura || (ot.numero_factura || '').toLowerCase().includes(textoNumFactura);
        const coincideMarca      = ot.marca.toLowerCase().includes(textoMarca);
        const coincideEstado = comboEstado === 'TODOS' || ot.estado === comboEstado;
        const coincideCliente = comboCliente === 'TODOS' || String(ot.cliente_id) === comboCliente;

        let coincideFecha = true;
        if (ot.fecha_encargo) {
            const fechaOT = ot.fecha_encargo.split('T')[0];
            if (fechaIni && fechaOT < fechaIni) coincideFecha = false;
            if (fechaFin && fechaOT > fechaFin) coincideFecha = false;
        } else if (fechaIni || fechaFin) {
            coincideFecha = false;
        }

        return coincideOT && coincideNumFactura && coincideMarca && coincideEstado && coincideCliente && coincideFecha;
    });
    dibujarTabla(filtrados);
}

function borrarFiltros() {
    document.getElementById('filtroOT').value          = '';
    document.getElementById('filtroNumFactura').value  = '';
    document.getElementById('filtroMarca').value       = '';
    document.getElementById('filtroEstado').value      = 'TODOS';
    document.getElementById('filtroCliente').value     = 'TODOS';
    document.getElementById('filtroFechaInicio').value = '';
    document.getElementById('filtroFechaFin').value    = '';
    cargarDatos();
}

// ── EXPORTAR EXCEL ───────────────────────────────────────────

function exportarExcel() {
    const tabla     = document.getElementById('tablaBBDD');
    const tablaClon = tabla.cloneNode(true);
    if (sesion.rol === 'admin') {
        for (let i = 0; i < tablaClon.rows.length; i++) { tablaClon.rows[i].deleteCell(-1); }
    }
    const wb = XLSX.utils.table_to_book(tablaClon, { sheet: 'Base de Datos OTs' });
    const fechaHoy = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Historial_ServiPlusUltra_${fechaHoy}.xlsx`);
}

// ── INIT ─────────────────────────────────────────────────────
cargarDatos();
