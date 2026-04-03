// ── CONTABILIDAD ─────────────────────────────────────────────

/** Renderiza filas en una tabla. Si no hay datos muestra mensaje centrado. */
function renderTabla(tbodyId, rows, cols, rowFn) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    if (!rows || rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center; color:#aaa; padding:12px;">Sin datos</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(r => `<tr>${rowFn(r)}</tr>`).join('');
}

document.getElementById('contNombre').innerText = sesion.username;
API.get('/api/usuarios/nombres').then(lista => {
    const yo = lista.find(u => u.username === sesion.username);
    if (yo && yo.foto) document.getElementById('contAvatar').src = yo.foto;
}).catch(() => {});

let grafico = null;

function fmt(v) { return parseFloat(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }

function colorValor(el, v) {
    const n = parseFloat(v);
    el.classList.toggle('positivo', n >= 0);
    el.classList.toggle('negativo', n < 0);
}

API.get('/api/contabilidad/resumen').then(data => {
    const k = data.kpis;

    document.getElementById('kpiIngresos').innerText   = fmt(k.ingresos_base);
    document.getElementById('kpiMateriales').innerText = fmt(k.costes_materiales);
    document.getElementById('kpiGastos').innerText     = fmt(k.gastos_generales);
    document.getElementById('kpiTotalIva').innerText   = fmt(k.ingresos_total);

    const elBruto = document.getElementById('kpiBruto');
    const elNeto  = document.getElementById('kpiNeto');
    elBruto.innerText = fmt(k.beneficio_bruto);
    elNeto.innerText  = fmt(k.beneficio_neto);
    colorValor(elBruto, k.beneficio_bruto);
    colorValor(elNeto,  k.beneficio_neto);

    // Gráfica mensual
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
                scales: {
                    y: { beginAtZero: true, ticks: { callback: v => v + ' €' } }
                }
            }
        });
    }

    // OTs por estado
    const colores = { HECHO: 'hecho', PENDIENTE: 'pendiente', ANULADO: 'anulado' };
    const iconos  = { HECHO: '✅', PENDIENTE: '⏳', ANULADO: '❌' };
    const divOts  = document.getElementById('otsEstado');
    divOts.innerHTML = '';
    if (data.ots_por_estado.length === 0) {
        divOts.innerHTML = '<p style="color:#aaa; text-align:center; grid-column:1/-1;">Sin datos</p>';
    } else {
        data.ots_por_estado.forEach(o => {
            const cls = colores[o.estado] || 'pendiente';
            divOts.innerHTML += `<div class="ot-stat ${cls}">
                <div class="num">${iconos[o.estado] || ''} ${o.total}</div>
                <div class="lbl">${o.estado}</div>
            </div>`;
        });
    }

    // Horas por técnico
    renderTabla('tablaHoras', data.horas_por_tecnico, 2,
        t => `<td>👷 ${t.tecnicos_nombres || '—'}</td><td><strong>${parseFloat(t.horas_totales).toFixed(1)} h</strong></td>`
    );

    // Top clientes por facturación
    renderTabla('tablaClientesIngresos', data.clientes_ingresos, 3,
        c => `<td>${c.cliente}</td><td style="text-align:center;">${c.num_facturas}</td><td><strong>${fmt(c.total_facturado)}</strong></td>`
    );

    // Clientes por materiales
    renderTabla('tablaClientesMateriales', data.clientes_materiales, 3,
        c => `<td>${c.cliente}</td><td style="text-align:center;">${c.num_ots}</td><td><strong>${fmt(c.total_materiales)}</strong></td>`
    );

    // Clientes por OTs
    renderTabla('tablaClientesOTs', data.clientes_ots, 3,
        c => `<td>${c.cliente}</td><td style="text-align:center;">${c.num_ots}</td><td style="text-align:center;">${c.ots_hechas}</td>`
    );
});
