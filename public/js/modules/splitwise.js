// ── SPLITWISE / GASTOS SOCIOS ────────────────────────────────

function cambiarTabGastos(tipo) {
    const esGasto = tipo === 'gasto';
    document.getElementById('tabGasto').style.cssText = esGasto
        ? 'flex-grow:1; text-align:center; padding:10px; cursor:pointer; border-bottom:3px solid #1abc9c; font-weight:bold; color:#1abc9c;'
        : 'flex-grow:1; text-align:center; padding:10px; cursor:pointer; color:#7f8c8d;';
    document.getElementById('tabPago').style.cssText = !esGasto
        ? 'flex-grow:1; text-align:center; padding:10px; cursor:pointer; border-bottom:3px solid #3498db; font-weight:bold; color:#3498db;'
        : 'flex-grow:1; text-align:center; padding:10px; cursor:pointer; color:#7f8c8d;';
    document.getElementById('panelGasto').style.display = esGasto ? 'block' : 'none';
    document.getElementById('panelPago').style.display  = esGasto ? 'none'  : 'block';
}

function abrirGastosSocios() {
    API.get('/api/gastos').then(gastos => {
        renderizarDeudas(gastos);
        const div = document.getElementById('listaHistorialGastos');
        div.innerHTML = '';
        if (gastos.length === 0) {
            div.innerHTML = '<p style="text-align:center; padding:10px; color:#aaa;">No hay gastos registrados aún.</p>';
        } else {
            gastos.forEach(g => {
                const esPago = g.concepto.startsWith('[PAGO]');
                if (esPago) {
                    const receptor = g.implicados || 'Alguien';
                    div.innerHTML += `<div class="gasto-item pago-directo">
                        <div><strong>💸 Devolución / Puesta al día</strong><br>
                        <small style="color:#7f8c8d;">${g.pagador} ➡️ devolvió a ➡️ ${receptor} | ${g.fecha}</small></div>
                        <div style="text-align:right;"><strong>${g.importe.toFixed(2)} €</strong><br>
                        <button class="btn-peligro" style="padding:2px 5px; font-size:0.8em; margin-top:5px;" onclick="borrarGastoSocio(${g.id})">Borrar</button></div>
                    </div>`;
                } else {
                    const imp = g.implicados ? g.implicados.split(',').join(', ') : 'Todos';
                    div.innerHTML += `<div class="gasto-item">
                        <div><strong>🛒 ${g.concepto}</strong><br>
                        <small style="color:#7f8c8d;">Pagó: ${g.pagador} | Reparto: ${imp} | ${g.fecha}</small></div>
                        <div style="text-align:right;"><strong>${g.importe.toFixed(2)} €</strong><br>
                        <button class="btn-peligro" style="padding:2px 5px; font-size:0.8em; margin-top:5px;" onclick="borrarGastoSocio(${g.id})">Borrar</button></div>
                    </div>`;
                }
            });
        }
        abrirModal('modalGastos');
    });
}

function renderizarDeudas(gastos) {
    const socios   = ['Giancarlo', 'David', 'Kevin'];
    const balances = { Giancarlo: 0, David: 0, Kevin: 0 };
    const desglose = { Giancarlo: [], David: [], Kevin: [] };

    gastos.forEach(g => {
        const pagador   = g.pagador;
        const importe   = parseFloat(g.importe);
        const esPago    = g.concepto.startsWith('[PAGO]');
        const implStr   = g.implicados || 'Giancarlo,David,Kevin';
        const implicados = implStr.split(',');

        if (esPago) {
            const receptor = implicados[0];
            if (balances[pagador]  !== undefined) balances[pagador]  += importe;
            if (balances[receptor] !== undefined) balances[receptor] -= importe;
            if (desglose[pagador])  desglose[pagador].push(`<div class="linea-desglose"><span style="color:#3498db">💸 Devolviste ${importe.toFixed(2)}€</span> a ${receptor}.</div>`);
            if (desglose[receptor]) desglose[receptor].push(`<div class="linea-desglose"><span style="color:#3498db">📥 Recibiste ${importe.toFixed(2)}€</span> de ${pagador}.</div>`);
        } else {
            const cuota = importe / implicados.length;
            if (balances[pagador] !== undefined) {
                balances[pagador] += importe;
                desglose[pagador].push(`<div class="linea-desglose"><span style="color:#27ae60">🛒 Pagaste ${importe.toFixed(2)}€</span> por: ${g.concepto}</div>`);
            }
            implicados.forEach(imp => {
                const name = imp.trim();
                if (balances[name] !== undefined) {
                    balances[name] -= cuota;
                    if (name !== pagador) desglose[name].push(`<div class="linea-desglose"><span style="color:#e74c3c">➖ Tu parte (-${cuota.toFixed(2)}€)</span> en: ${g.concepto} (Lo pagó ${pagador})</div>`);
                    else                 desglose[name].push(`<div class="linea-desglose"><span style="color:#7f8c8d">➖ Tu propia parte (-${cuota.toFixed(2)}€)</span> en: ${g.concepto}</div>`);
                }
            });
        }
    });

    let deudores = [], acreedores = [];
    socios.forEach(s => {
        const n = balances[s];
        if (n < -0.01) deudores.push({ nombre: s, cantidad: Math.abs(n) });
        else if (n > 0.01) acreedores.push({ nombre: s, cantidad: n });
    });

    const transferencias = [];
    let i = 0, j = 0;
    while (i < deudores.length && j < acreedores.length) {
        const d = deudores[i], a = acreedores[j];
        const cant = Math.min(d.cantidad, a.cantidad);
        transferencias.push(`<div class="deuda-linea"><span class="pagador">${d.nombre}</span> debe devolver a <span class="receptor">${a.nombre}</span>: <strong>${cant.toFixed(2)} €</strong></div>`);
        d.cantidad -= cant; a.cantidad -= cant;
        if (d.cantidad < 0.01) i++;
        if (a.cantidad < 0.01) j++;
    }

    const divResumen = document.getElementById('resumenDeudas');
    divResumen.innerHTML = transferencias.length === 0
        ? '<p style="color:#27ae60; font-weight:bold; font-size:1.2em;">¡Las cuentas están cuadradas a 0!</p>'
        : transferencias.join('');

    let htmlBal = '';
    socios.forEach(s => {
        const n       = balances[s];
        const color   = n >= 0 ? 'bal-positivo' : 'bal-negativo';
        const signo   = n > 0 ? '+' : '';
        const dJSON   = encodeURIComponent(JSON.stringify(desglose[s]));
        htmlBal += `<div style="cursor:pointer; padding:10px; border-radius:8px; transition:0.2s; border:1px solid transparent;"
            onmouseover="this.style.background='#f0f4f8'; this.style.borderColor='#1abc9c';"
            onmouseout="this.style.background='transparent'; this.style.borderColor='transparent';"
            onclick="mostrarDesglose('${s}','${dJSON}',${n})">
            <strong>${s}</strong><br>
            Balance: <span class="${color}">${signo}${n.toFixed(2)}€</span><br>
            <small style="color:#3498db;">🔍 Ver detalles</small>
        </div>`;
    });
    document.getElementById('resumenBalances').innerHTML = htmlBal;
}

function mostrarDesglose(nombre, dJSON, neto) {
    document.getElementById('desgloseNombre').innerText = nombre;
    const color = neto >= 0 ? 'green' : 'red';
    const signo = neto > 0 ? '+' : '';
    document.getElementById('desgloseTotal').innerHTML = `<span style="color:${color}">${signo}${neto.toFixed(2)} €</span>`;
    const ops = JSON.parse(decodeURIComponent(dJSON));
    document.getElementById('desgloseOperaciones').innerHTML = ops.length > 0
        ? ops.join('')
        : '<p style="padding:10px; text-align:center;">Aún no hay movimientos.</p>';
    abrirModal('modalDesgloseSplitwise');
}

document.getElementById('formGastoSocio').addEventListener('submit', function(e) {
    e.preventDefault();
    const pagador    = document.getElementById('g_pagador').value;
    const importe    = document.getElementById('g_importe').value;
    const concepto   = document.getElementById('g_concepto').value;
    const implicados = Array.from(document.querySelectorAll('input[name="chk_implicados"]:checked')).map(c => c.value);
    if (implicados.length === 0) { alert('❌ Marca al menos a 1 persona en el reparto.'); return; }
    API.post('/api/gastos', { pagador, importe, concepto, implicados }).then(data => {
        if (data.error) alert('❌ ' + data.error);
        else {
            document.getElementById('g_importe').value  = '';
            document.getElementById('g_concepto').value = '';
            document.querySelectorAll('input[name="chk_implicados"]').forEach(c => c.checked = true);
            abrirGastosSocios();
        }
    });
});

document.getElementById('formPagoSocio').addEventListener('submit', function(e) {
    e.preventDefault();
    const emisor   = document.getElementById('p_emisor').value;
    const receptor = document.getElementById('p_receptor').value;
    const importe  = document.getElementById('p_importe').value;
    if (emisor === receptor) { alert('❌ No puedes devolverte dinero a ti mismo.'); return; }
    API.post('/api/gastos', { pagador: emisor, importe, concepto: '[PAGO] Liquidación de deuda', implicados: [receptor] })
        .then(data => {
            if (data.error) alert('❌ ' + data.error);
            else { document.getElementById('p_importe').value = ''; abrirGastosSocios(); }
        });
});

function borrarGastoSocio(id) {
    if (!confirm('¿Borrar este movimiento?')) return;
    API.delete(`/api/gastos/${id}`).then(() => abrirGastosSocios());
}
