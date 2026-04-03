// ── CONTABILIDAD — Dashboard interactivo ──────────────────────

let _dash = null; // datos globales del dashboard
let grafico = null;

// ── Helpers ────────────────────────────────────────────────────

function fmt(v) {
    return parseFloat(v || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function colorValor(el, v) {
    const n = parseFloat(v);
    el.classList.toggle('positivo', n >= 0);
    el.classList.toggle('negativo', n < 0);
}

function renderTabla(tbodyId, rows, cols, rowFn, onClickFn) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    if (!rows || rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center;color:#aaa;padding:12px;">Sin datos</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map((r, i) => `<tr data-idx="${i}">${rowFn(r)}</tr>`).join('');
    if (onClickFn) {
        tbody.querySelectorAll('tr').forEach((tr, i) => {
            tr.addEventListener('click', () => onClickFn(rows[i]));
        });
    }
}

// ── Modal de detalle genérico ──────────────────────────────────

function abrirDetalle(titulo, columnas, filas) {
    document.getElementById('detalleTitle').innerText = titulo;
    document.getElementById('detalleThead').innerHTML =
        '<tr>' + columnas.map(c => `<th>${c}</th>`).join('') + '</tr>';
    const tbody = document.getElementById('detalleTbody');
    const sinDatos = document.getElementById('detalleSinDatos');
    if (!filas || filas.length === 0) {
        tbody.innerHTML = '';
        sinDatos.style.display = 'block';
    } else {
        sinDatos.style.display = 'none';
        tbody.innerHTML = filas.map(f => '<tr>' + f.map(c => `<td>${c ?? '—'}</td>`).join('') + '</tr>').join('');
    }
    document.getElementById('modalDetalle').style.display = 'block';
}

// ── Drill-downs ────────────────────────────────────────────────

function detalleIngresos() {
    if (!_dash) return;
    const filas = _dash.facturas_lista.map(f => [
        f.codigo_ot || '—',
        f.cliente_nombre || '— Sin cliente —',
        f.fecha_emision ? f.fecha_emision.split('T')[0] : '—',
        fmt(f.base_imponible),
        fmt(f.iva),
        `<strong>${fmt(f.total)}</strong>`
    ]);
    abrirDetalle('💰 Facturas emitidas', ['OT', 'Cliente', 'Fecha', 'Base', 'IVA', 'Total'], filas);
}

function detalleMateriales() {
    if (!_dash) return;
    const ots = _dash.ots_lista.filter(o => parseFloat(o.materiales_precio) > 0);
    const filas = ots.map(o => [
        o.codigo_ot,
        o.cliente_nombre || '— Sin cliente —',
        o.tecnicos_nombres || '—',
        `<span class="badge-est ${o.estado}">${o.estado}</span>`,
        `<strong>${fmt(o.materiales_precio)}</strong>`
    ]);
    abrirDetalle('🔧 Costes de materiales por OT', ['OT', 'Cliente', 'Técnicos', 'Estado', 'Materiales'], filas);
}

function detalleCosteMO() {
    if (!_dash) return;
    const ots = _dash.ots_lista.filter(o => o.estado === 'HECHO');
    const filas = ots.map(o => [
        o.codigo_ot,
        o.cliente_nombre || '— Sin cliente —',
        o.tecnicos_nombres || '—',
        `${parseFloat(o.horas || 0).toFixed(1)} h`,
        `${o.num_tecnicos} tec.`,
        `${parseFloat(o.precio_hora || 15).toFixed(2)} €/h`,
        `<strong>${fmt(o.coste_mo)}</strong>`
    ]);
    abrirDetalle('👷 Coste de mano de obra por OT', ['OT', 'Cliente', 'Técnicos', 'Horas', 'Num tec.', '€/h', 'Coste MO'], filas);
}

function detalleGastos() {
    if (!_dash) return;
    const filas = _dash.gastos_lista.map(g => [
        g.pagador,
        g.concepto,
        g.fecha || '—',
        g.implicados || '—',
        `<strong>${fmt(g.importe)}</strong>`
    ]);
    abrirDetalle('💸 Gastos generales socios', ['Pagador', 'Concepto', 'Fecha', 'Implicados', 'Importe'], filas);
}

function detalleBeneficioBruto() {
    if (!_dash) return;
    const k = _dash.kpis;
    const filas = [
        ['Ingresos facturados (sin IVA)', '', fmt(k.ingresos_base)],
        ['Costes de materiales', '−', fmt(k.costes_materiales)],
        ['<strong>Beneficio bruto</strong>', '=', `<strong>${fmt(k.beneficio_bruto)}</strong>`]
    ];
    abrirDetalle('📊 Desglose beneficio bruto', ['Concepto', '', 'Importe'], filas);
}

function detalleBeneficioNeto() {
    if (!_dash) return;
    const k = _dash.kpis;
    const filas = [
        ['Ingresos facturados (sin IVA)', '', fmt(k.ingresos_base)],
        ['Costes de materiales', '−', fmt(k.costes_materiales)],
        ['Coste de mano de obra', '−', fmt(k.costes_mo)],
        ['Gastos generales socios', '−', fmt(k.gastos_generales)],
        ['<strong>Beneficio neto</strong>', '=', `<strong>${fmt(k.beneficio_neto)}</strong>`]
    ];
    abrirDetalle('📊 Desglose beneficio neto', ['Concepto', '', 'Importe'], filas);
}

function detalleOTsPorEstado(estado) {
    if (!_dash) return;
    const ots = _dash.ots_lista.filter(o => o.estado === estado);
    const filas = ots.map(o => [
        o.codigo_ot,
        o.cliente_nombre || '— Sin cliente —',
        o.marca || '—',
        o.tecnicos_nombres || '—',
        `${parseFloat(o.horas || 0).toFixed(1)} h`,
        fmt(o.materiales_precio)
    ]);
    abrirDetalle(`OTs en estado: ${estado}`, ['OT', 'Cliente', 'Descripción', 'Técnicos', 'Horas', 'Materiales'], filas);
}

function detalleClienteIngresos(c) {
    if (!_dash) return;
    const ots = _dash.ots_lista.filter(o => o.cliente_nombre === c.cliente);
    const facturas = _dash.facturas_lista.filter(f => f.cliente_nombre === c.cliente);
    const filasFact = facturas.map(f => [
        f.codigo_ot || '—',
        f.fecha_emision ? f.fecha_emision.split('T')[0] : '—',
        fmt(f.base_imponible),
        `<strong>${fmt(f.total)}</strong>`
    ]);
    abrirDetalle(`💰 Facturación de "${c.cliente}"`, ['OT', 'Fecha', 'Base imponible', 'Total con IVA'], filasFact);
}

function detalleClienteMateriales(c) {
    if (!_dash) return;
    const ots = _dash.ots_lista.filter(o => o.cliente_nombre === c.cliente && parseFloat(o.materiales_precio) > 0);
    const filas = ots.map(o => [
        o.codigo_ot,
        `<span class="badge-est ${o.estado}">${o.estado}</span>`,
        o.tecnicos_nombres || '—',
        `<strong>${fmt(o.materiales_precio)}</strong>`
    ]);
    abrirDetalle(`🔧 Materiales en OTs de "${c.cliente}"`, ['OT', 'Estado', 'Técnicos', 'Materiales'], filas);
}

function detalleClienteOTs(c) {
    if (!_dash) return;
    const ots = _dash.ots_lista.filter(o => o.cliente_nombre === c.cliente);
    const filas = ots.map(o => [
        o.codigo_ot,
        o.marca || '—',
        o.tecnicos_nombres || '—',
        o.fecha_encargo ? o.fecha_encargo.split('T')[0] : '—',
        `<span class="badge-est ${o.estado}">${o.estado}</span>`,
        fmt(o.materiales_precio)
    ]);
    abrirDetalle(`🛠️ OTs de "${c.cliente}"`, ['OT', 'Descripción', 'Técnicos', 'Fecha', 'Estado', 'Materiales'], filas);
}

function detalleTecnico(t) {
    if (!_dash) return;
    const nombre = t.tecnicos_nombres || '';
    const ots = _dash.ots_lista.filter(o =>
        o.estado === 'HECHO' && (o.tecnicos_nombres || '').includes(nombre.split(',')[0].trim())
    );
    const filas = ots.map(o => [
        o.codigo_ot,
        o.cliente_nombre || '— Sin cliente —',
        o.marca || '—',
        `${parseFloat(o.horas || 0).toFixed(1)} h`,
        `${parseFloat(o.precio_hora || 15).toFixed(2)} €/h`,
        `<strong>${fmt(o.coste_mo)}</strong>`
    ]);
    abrirDetalle(`👷 OTs de "${nombre}"`, ['OT', 'Cliente', 'Descripción', 'Horas', '€/h', 'Coste MO'], filas);
}

function detalleMes(mes) {
    if (!_dash) return;
    const facturas = _dash.facturas_lista.filter(f => f.fecha_emision && f.fecha_emision.startsWith(mes));
    const filas = facturas.map(f => [
        f.codigo_ot || '—',
        f.cliente_nombre || '— Sin cliente —',
        f.fecha_emision ? f.fecha_emision.split('T')[0] : '—',
        fmt(f.base_imponible),
        `<strong>${fmt(f.total)}</strong>`
    ]);
    abrirDetalle(`📅 Facturas de ${mes}`, ['OT', 'Cliente', 'Fecha', 'Base', 'Total'], filas);
}

// ── Avatar ─────────────────────────────────────────────────────

document.getElementById('contNombre').innerText = sesion.username;
API.get('/api/usuarios/nombres').then(lista => {
    const yo = lista.find(u => u.username === sesion.username);
    if (yo && yo.foto) document.getElementById('contAvatar').src = yo.foto;
}).catch(() => {});

// ── Carga principal ────────────────────────────────────────────

API.get('/api/contabilidad/resumen').then(data => {
    _dash = data;
    const k = data.kpis;

    // KPIs con click handlers
    document.getElementById('kpiIngresos').innerText   = fmt(k.ingresos_base);
    document.getElementById('kpiMateriales').innerText = fmt(k.costes_materiales);
    document.getElementById('kpiCosteMO').innerText    = fmt(k.costes_mo);
    document.getElementById('kpiGastos').innerText     = fmt(k.gastos_generales);
    document.getElementById('kpiTotalIva').innerText   = fmt(k.ingresos_total);

    const elBruto = document.getElementById('kpiBruto');
    const elNeto  = document.getElementById('kpiNeto');
    elBruto.innerText = fmt(k.beneficio_bruto);
    elNeto.innerText  = fmt(k.beneficio_neto);
    colorValor(elBruto, k.beneficio_bruto);
    colorValor(elNeto,  k.beneficio_neto);

    document.getElementById('kpiIngresos').closest('.kpi-card').onclick   = detalleIngresos;
    document.getElementById('kpiMateriales').closest('.kpi-card').onclick = detalleMateriales;
    document.getElementById('kpiCosteMO').closest('.kpi-card').onclick    = detalleCosteMO;
    document.getElementById('kpiGastos').closest('.kpi-card').onclick     = detalleGastos;
    document.getElementById('kpiBruto').closest('.kpi-card').onclick      = detalleBeneficioBruto;
    document.getElementById('kpiNeto').closest('.kpi-card').onclick       = detalleBeneficioNeto;
    document.getElementById('kpiTotalIva').closest('.kpi-card').onclick   = detalleIngresos;

    // Gráfica mensual — click en barra abre detalle del mes
    const meses = data.evolucion_mensual;
    if (meses.length === 0) {
        document.getElementById('sinDatos').style.display = 'block';
    } else {
        const labels   = meses.map(m => m.mes || 'Sin fecha');
        const ingresos = meses.map(m => parseFloat(m.total_base));
        const ctx      = document.getElementById('graficoMensual').getContext('2d');
        if (grafico) grafico.destroy();
        grafico = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Ingresos sin IVA (€)',
                    data: ingresos,
                    backgroundColor: 'rgba(26,188,156,0.6)',
                    borderColor: '#1abc9c',
                    borderWidth: 2,
                    borderRadius: 4,
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { callback: v => v + ' €' } } },
                onClick: (_e, elements) => {
                    if (elements.length > 0) detalleMes(labels[elements[0].index]);
                }
            }
        });
    }

    // OTs por estado — click abre detalle
    const colores = { HECHO: 'hecho', PENDIENTE: 'pendiente', ANULADO: 'anulado' };
    const iconos  = { HECHO: '✅', PENDIENTE: '⏳', ANULADO: '❌' };
    const divOts  = document.getElementById('otsEstado');
    divOts.innerHTML = '';
    if (data.ots_por_estado.length === 0) {
        divOts.innerHTML = '<p style="color:#aaa;text-align:center;grid-column:1/-1;">Sin datos</p>';
    } else {
        data.ots_por_estado.forEach(o => {
            const cls = colores[o.estado] || 'pendiente';
            const el  = document.createElement('div');
            el.className = `ot-stat ${cls}`;
            el.innerHTML = `<div class="num">${iconos[o.estado] || ''} ${o.total}</div><div class="lbl">${o.estado}</div>`;
            el.onclick = () => detalleOTsPorEstado(o.estado);
            divOts.appendChild(el);
        });
    }

    // Tablas con click en fila
    renderTabla('tablaHoras', data.horas_por_tecnico, 3,
        t => `<td>👷 ${t.tecnicos_nombres || '—'}</td><td><strong>${parseFloat(t.horas_totales).toFixed(1)} h</strong></td><td>${fmt(t.coste_mo || 0)}</td>`,
        detalleTecnico
    );

    renderTabla('tablaClientesIngresos', data.clientes_ingresos, 3,
        c => `<td>${c.cliente}</td><td style="text-align:center;">${c.num_facturas}</td><td><strong>${fmt(c.total_facturado)}</strong></td>`,
        detalleClienteIngresos
    );

    renderTabla('tablaClientesMateriales', data.clientes_materiales, 3,
        c => `<td>${c.cliente}</td><td style="text-align:center;">${c.num_ots}</td><td><strong>${fmt(c.total_materiales)}</strong></td>`,
        detalleClienteMateriales
    );

    renderTabla('tablaClientesOTs', data.clientes_ots, 3,
        c => `<td>${c.cliente}</td><td style="text-align:center;">${c.num_ots}</td><td style="text-align:center;">${c.ots_hechas}</td>`,
        detalleClienteOTs
    );

    // Paneles — click en título o área vacía abre detalle global
    document.getElementById('panelHorasTecnico').querySelector('h3').style.cursor = 'default';
    document.getElementById('panelClientesIngresos').querySelector('h3').style.cursor = 'default';
    document.getElementById('panelClientesMateriales').querySelector('h3').style.cursor = 'default';
    document.getElementById('panelClientesOTs').querySelector('h3').style.cursor = 'default';
});
