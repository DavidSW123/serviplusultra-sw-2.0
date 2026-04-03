// ── CONTABILIDAD ─────────────────────────────────────────────

document.getElementById('contNombre').innerText = sesion.username;

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
    const tbody = document.getElementById('tablaHoras');
    tbody.innerHTML = '';
    if (data.horas_por_tecnico.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:#aaa;">Sin datos</td></tr>';
    } else {
        data.horas_por_tecnico.forEach(t => {
            tbody.innerHTML += `<tr>
                <td>👷 ${t.tecnicos_nombres || '—'}</td>
                <td><strong>${parseFloat(t.horas_totales).toFixed(1)} h</strong></td>
            </tr>`;
        });
    }
});
