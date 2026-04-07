// ── FACTURAS ─────────────────────────────────────────────────

let lineasFactura = [];

async function abrirGeneradorFactura(id) {
    const ot = otsGlobal.find(o => o.id === id);
    otActualId     = ot.id;
    otActualCodigo = ot.codigo_ot;

    document.getElementById('factOtCode').innerText   = ot.codigo_ot;
    document.getElementById('factNumero').innerText   = ot.numero_factura || '(se asignará al emitir)';
    document.getElementById('factNumero').style.color = ot.numero_factura ? '#1abc9c' : '#aaa';

    const fechaEmision = ot.factura_fecha_emision
        ? new Date(ot.factura_fecha_emision + 'T00:00:00').toLocaleDateString('es-ES')
        : new Date().toLocaleDateString('es-ES');
    document.getElementById('factFechaHoy').innerText  = fechaEmision;

    document.getElementById('selClienteFactura').value = ot.cliente_id || '';
    actualizarInfoClienteFactura();

    const isUrg   = ot.tipo_urgencia === 'Rojo';
    const pDesp   = isUrg ? 55.00 : 40.00;
    const pHora   = isUrg ? 45.00 : 25.00;
    const label   = ot.num_tecnicos === 1 ? 'técnico' : 'técnicos';
    const txtObra = isUrg
        ? `Mano de Obra URGENTE (${ot.num_tecnicos} ${label} x ${ot.horas} hrs)`
        : `Mano de Obra (${ot.num_tecnicos} ${label} x ${ot.horas} hrs)`;

    lineasFactura = [
        { concepto: 'Desplazamiento', cantidad: 1,                          precio: pDesp },
        { concepto: txtObra,          cantidad: ot.horas * ot.num_tecnicos,  precio: pHora }
    ];

    try {
        const adjuntos = await API.get(`/api/ot/${id}/adjuntos`);
        if (adjuntos.length > 0) {
            adjuntos.forEach(adj => {
                if (adj.importe > 0) {
                    let cant     = 1;
                    let concepto = adj.descripcion || 'Material / Recambio';
                    const match  = concepto.match(/\(Cant:\s*([\d.]+)\)/i);
                    if (match) {
                        cant     = parseFloat(match[1]);
                        concepto = concepto.replace(/\(Cant:\s*[\d.]+\)/i, '').replace(/\[STOCK\]\s*/i, '').trim();
                    }
                    lineasFactura.push({ concepto, cantidad: cant, precio: cant > 0 ? adj.importe / cant : adj.importe });
                }
            });
        } else if (ot.materiales_precio > 0) {
            lineasFactura.push({ concepto: 'Materiales y repuestos (Sin detallar)', cantidad: 1, precio: ot.materiales_precio });
        }
    } catch (e) {
        if (ot.materiales_precio > 0) lineasFactura.push({ concepto: 'Materiales y repuestos', cantidad: 1, precio: ot.materiales_precio });
    }

    renderizarTablaFactura();
    abrirModal('modalFactura');
}

function actualizarInfoClienteFactura() {
    const id       = document.getElementById('selClienteFactura').value;
    const divPrint = document.getElementById('printClienteNombre');
    const divInfo  = document.getElementById('infoClienteFacturaTexto');
    if (!id) { divInfo.innerHTML = ''; divPrint.innerText = 'Consumidor Final'; return; }
    const c = clientesGlobal.find(x => x.id == id);
    divPrint.innerText = c.nombre;
    divInfo.innerHTML  = `<strong>NIF/CIF:</strong> ${c.nif}<br><strong>Dir:</strong> ${c.direccion}`;
}

function renderizarTablaFactura() {
    const tbody = document.getElementById('tbodyLineas');
    tbody.innerHTML = '';
    let base = 0;
    lineasFactura.forEach((l, idx) => {
        const t = l.cantidad * l.precio;
        base += t;
        tbody.innerHTML += `<tr>
            <td><input type="text"   value="${l.concepto}"  onchange="actualizarLinea(${idx},'concepto',this.value)"></td>
            <td><input type="number" step="0.1"  value="${l.cantidad}" onchange="actualizarLinea(${idx},'cantidad',this.value)"></td>
            <td><input type="number" step="0.01" value="${l.precio}"   onchange="actualizarLinea(${idx},'precio',this.value)"></td>
            <td style="text-align:right;">${t.toFixed(2)} €</td>
            <td class="no-print"><button class="btn-peligro" onclick="borrarLineaFactura(${idx})">🗑️</button></td>
        </tr>`;
    });
    const iva = base * 0.21;
    document.getElementById('factBase').innerText  = base.toFixed(2);
    document.getElementById('factIva').innerText   = iva.toFixed(2);
    document.getElementById('factTotal').innerText = (base + iva).toFixed(2);
}

function actualizarLinea(i, c, v) { lineasFactura[i][c] = c === 'concepto' ? v : (parseFloat(v) || 0); renderizarTablaFactura(); }
function agregarLineaBlanco()      { lineasFactura.push({ concepto: '', cantidad: 1, precio: 0 }); renderizarTablaFactura(); }
function borrarLineaFactura(i)     { lineasFactura.splice(i, 1); renderizarTablaFactura(); }

/**
 * Llama a POST /api/factura para registrar/recuperar la factura.
 * Si ya existe para este ot_id, devuelve la existente (inmutable).
 * Actualiza #factNumero y #factFechaHoy con los datos definitivos.
 */
async function _emitirYRegistrar() {
    const base  = parseFloat(document.getElementById('factBase').innerText);
    const iva   = parseFloat(document.getElementById('factIva').innerText);
    const total = parseFloat(document.getElementById('factTotal').innerText);

    const data = await API.post('/api/factura', {
        ot_id:          otActualId,
        codigo_ot:      otActualCodigo,
        base_imponible: base,
        iva,
        total
    });

    if (data.numero_factura) {
        document.getElementById('factNumero').innerText    = data.numero_factura;
        document.getElementById('factNumero').style.color  = '#1abc9c';
        document.getElementById('factFechaHoy').innerText  = data.fecha_emision
            ? new Date(data.fecha_emision + 'T00:00:00').toLocaleDateString('es-ES')
            : new Date().toLocaleDateString('es-ES');
    }
    return data;
}

/** Genera y descarga el PDF (sin usar window.print, sin cabeceras del navegador). */
async function descargarFacturaPDF() {
    try {
        await _emitirYRegistrar();
    } catch (e) {
        alert('❌ Error al registrar la factura: ' + e.message);
        return;
    }

    const numFactura = document.getElementById('factNumero').innerText;
    const area       = document.getElementById('facturaAreaImpresion');
    const noPrints   = document.querySelectorAll('.no-print');

    area.classList.add('factura-pdf-limpia');
    noPrints.forEach(el => el.style.display = 'none');
    document.getElementById('printClienteNombre').style.display = 'block';

    html2pdf().set({
        margin:      10,
        filename:    `Factura-${numFactura}.pdf`,
        image:       { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(area).save().then(() => {
        area.classList.remove('factura-pdf-limpia');
        noPrints.forEach(el => el.style.display = '');
        document.getElementById('printClienteNombre').style.display = 'none';
    });
}

async function enviarFacturaAlCliente() {
    const idCliente = document.getElementById('selClienteFactura').value;
    if (!idCliente) { alert('❌ Selecciona un cliente primero.'); return; }
    const cliente = clientesGlobal.find(c => c.id == idCliente);
    if (!cliente.email || !cliente.email.includes('@')) { alert('❌ El cliente no tiene un email válido.'); return; }
    if (!confirm(`¿Enviar PDF a ${cliente.email}?`)) return;

    alert('⏳ Generando PDF y enviando...');

    try {
        await _emitirYRegistrar();
    } catch (e) {
        alert('❌ Error al registrar la factura: ' + e.message);
        return;
    }

    const numFactura = document.getElementById('factNumero').innerText;
    const area       = document.getElementById('facturaAreaImpresion');
    const noPrints   = document.querySelectorAll('.no-print');

    area.classList.add('factura-pdf-limpia');
    noPrints.forEach(el => el.style.display = 'none');
    document.getElementById('printClienteNombre').style.display = 'block';

    html2pdf().set({
        margin:      10,
        filename:    `Factura-${numFactura}.pdf`,
        image:       { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(area).outputPdf('datauristring').then(pdfDataUrl => {
        area.classList.remove('factura-pdf-limpia');
        noPrints.forEach(el => el.style.display = '');
        document.getElementById('printClienteNombre').style.display = 'none';

        API.post('/api/enviar-factura', {
            emailDestino:  cliente.email,
            asunto:        `Factura ${numFactura} - ServiPlusUltra`,
            htmlBody:      `<div style="font-family:Arial; padding:20px;"><h2>Hola, ${cliente.nombre}</h2><p>Adjuntamos la factura <strong>${numFactura}</strong> correspondiente a la OT <strong>${otActualCodigo}</strong>.</p></div>`,
            pdfBase64:     pdfDataUrl.split(',')[1],
            nombreArchivo: `Factura-${numFactura}.pdf`
        }).then(data => { if (data.error) alert('❌ ' + data.error); else alert('✅ ' + data.mensaje); });
    });
}
