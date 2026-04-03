const sesionStr = localStorage.getItem('sesionPlusUltra');
if (!sesionStr) window.location.href = '/login';
const sesion = JSON.parse(sesionStr);
const headersSeguridad = { 'Content-Type': 'application/json', 'x-rol': sesion.rol, 'x-user': sesion.username };
const prefijoAnoActual = `OT${new Date().getFullYear().toString().slice(-2)}/`;

document.getElementById('infoUsuarioBBDD').innerHTML = `👤 <strong>${sesion.username.toUpperCase()}</strong> (${sesion.rol})`;
if (sesion.rol !== 'admin') document.getElementById('colAcciones').style.display = 'none';

let datosBBDD = [];
let clientesGlobal = [];
let ed_tecnicosSeleccionados = [];
let otActualId = null;

// ── CARGA DE DATOS ───────────────────────────────────────────

async function cargarDatos() {
    try {
        cargarUsuariosParaOT();

        const resClientes = await fetch('/api/clientes', { headers: headersSeguridad });
        clientesGlobal = await resClientes.json();

        const selectCliente = document.getElementById('filtroCliente');
        const selEdit = document.getElementById('ed_ot_cliente_id');
        const clientesAprobados = clientesGlobal.filter(c => c.estado === 'APROBADO');
        clientesAprobados.forEach(c => {
            selectCliente.innerHTML += `<option value="${c.id}">${c.nombre}</option>`;
            selEdit.innerHTML += `<option value="${c.id}">${c.nombre}</option>`;
        });

        const resOT = await fetch('/api/ot', { headers: headersSeguridad });
        datosBBDD = await resOT.json();
        dibujarTabla(datosBBDD);
    } catch (e) {
        document.getElementById('cuerpoTabla').innerHTML =
            '<tr><td colspan="11" style="color:red; text-align:center;">Error cargando datos.</td></tr>';
    }
}

// ── TABLA ────────────────────────────────────────────────────

function dibujarTabla(datos) {
    const tbody = document.getElementById('cuerpoTabla');
    tbody.innerHTML = '';

    if (datos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; color:#7f8c8d; padding:30px;">No hay resultados con los filtros seleccionados.</td></tr>';
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
            <td><strong>${ot.codigo_ot}</strong></td>
            <td>${nombreCliente}</td>
            <td>${ot.marca}</td>
            <td>${fechaLimpia}</td>
            <td>${ot.tipo_urgencia}</td>
            <td>${ot.horas}</td>
            <td>${tecnicos}</td>
            <td>${ot.materiales_precio} €</td>
            <td><span class="badge" style="background-color:${colorEstado}; color:${colorTexto};">${ot.estado}</span></td>
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
function cerrarModal(id) { document.getElementById(id).style.display = 'none';  }

function cargarUsuariosParaOT() {
    fetch('/api/usuarios/nombres')
        .then(res => res.json())
        .then(data => {
            const s = document.getElementById('ed_selTecnicosAdd');
            s.innerHTML = '<option value="">-- Seleccionar --</option>';
            data.forEach(u => { s.innerHTML += `<option value="${u.username}">${u.username} (${u.rol})</option>`; });
        });
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
    if (!codigo.startsWith(prefijoAnoActual)) { alert(`❌ Debe empezar por ${prefijoAnoActual}`); return false; }
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
    const textoOT    = document.getElementById('filtroOT').value.toLowerCase();
    const textoMarca = document.getElementById('filtroMarca').value.toLowerCase();
    const comboEstado  = document.getElementById('filtroEstado').value;
    const comboCliente = document.getElementById('filtroCliente').value;
    const fechaIni   = document.getElementById('filtroFechaInicio').value;
    const fechaFin   = document.getElementById('filtroFechaFin').value;

    const filtrados = datosBBDD.filter(ot => {
        const coincideOT     = ot.codigo_ot.toLowerCase().includes(textoOT);
        const coincideMarca  = ot.marca.toLowerCase().includes(textoMarca);
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

        return coincideOT && coincideMarca && coincideEstado && coincideCliente && coincideFecha;
    });
    dibujarTabla(filtrados);
}

function borrarFiltros() {
    document.getElementById('filtroOT').value          = '';
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
