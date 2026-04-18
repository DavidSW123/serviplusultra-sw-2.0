// ── FACTURAS ─────────────────────────────────────────────────

let lineasFactura = [];

// ── Helpers de tarifas ────────────────────────────────────────

/**
 * Devuelve true si la fecha cae en un festivo nacional español o catalán.
 * Se incluyen festivos fijos + Viernes Santo y Lunes de Pascua (variable).
 */
function _esFestivo(fecha) {
    const d    = new Date(fecha);
    const year = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    const mmdd = `${mm}-${dd}`;

    // Festivos nacionales fijos
    if (['01-01','01-06','05-01','08-15','10-12','11-01','12-06','12-08','12-25'].includes(mmdd)) return true;
    // Festivos catalanes fijos
    if (['06-24','09-11','09-24','12-26'].includes(mmdd)) return true;

    // Semana Santa variable (Viernes Santo + Lunes de Pascua catalán)
    const viernesSanto  = { 2024:'03-29', 2025:'04-18', 2026:'04-03', 2027:'03-26', 2028:'04-14' };
    const lunesPascua   = { 2024:'04-01', 2025:'04-21', 2026:'04-06', 2027:'03-29', 2028:'04-17' };
    if (viernesSanto[year] === mmdd || lunesPascua[year] === mmdd) return true;

    return false;
}

/**
 * Determina las tarifas aplicables a partir del objeto OT.
 * Devuelve { pHora, pDesp, motivo }
 *
 *  Festivo:                        55 €/h  |  65 € desp
 *  Urgente / Finde / Extralab. / Nocturno:  55 €/h  |  55 € desp
 *  Normal:                         30 €/h  |  40 € desp
 */
function _calcularTarifas(ot) {
    const esUrgente = ot.tipo_urgencia === 'Rojo';
    let esFestivo = false, esFinde = false, esNocturno = false, esExtralaboral = false;

    if (ot.fecha_encargo) {
        // Normalizar separador de fecha ("2025-01-15 14:30" → ISO)
        const raw  = ot.fecha_encargo.replace(' ', 'T');
        const d    = new Date(raw);
        if (!isNaN(d)) {
            const dia  = d.getDay();   // 0=Dom, 6=Sab
            const hora = d.getHours();
            const min  = d.getMinutes();
            const h    = hora + min / 60;

            esFestivo      = _esFestivo(d);
            esFinde        = (dia === 0 || dia === 6);
            esNocturno     = (hora >= 22 || hora < 6);
            esExtralaboral = !esFinde && !esNocturno && (h < 8 || h >= 17);
        }
    }

    if (esFestivo)                                          return { pHora: 55, pDesp: 65, motivo: 'FESTIVO' };
    if (esFinde)                                            return { pHora: 55, pDesp: 55, motivo: 'FIN DE SEMANA' };
    if (esNocturno)                                         return { pHora: 55, pDesp: 55, motivo: 'NOCTURNO' };
    if (esExtralaboral)                                     return { pHora: 55, pDesp: 55, motivo: 'EXTRALABORAL' };
    if (esUrgente)                                          return { pHora: 55, pDesp: 55, motivo: 'URGENTE' };
    return { pHora: 30, pDesp: 40, motivo: 'NORMAL' };
}

// ── Modal ─────────────────────────────────────────────────────

async function abrirGeneradorFactura(id) {
    const ot = otsGlobal.find(o => o.id === id);
    otActualId     = ot.id;
    otActualCodigo = ot.codigo_ot;

    document.getElementById('factOtCode').innerText    = ot.codigo_ot;
    document.getElementById('factNumero').innerText    = ot.numero_factura || '(se asignará al emitir)';
    document.getElementById('factNumero').style.color  = ot.numero_factura ? '#1abc9c' : '#aaa';

    const fechaEmision = ot.factura_fecha_emision
        ? new Date(ot.factura_fecha_emision + 'T00:00:00').toLocaleDateString('es-ES')
        : new Date().toLocaleDateString('es-ES');
    document.getElementById('factFechaHoy').innerText  = fechaEmision;

    document.getElementById('selClienteFactura').value = ot.cliente_id || '';
    actualizarInfoClienteFactura();

    // Si la factura ya fue guardada, cargar sus líneas guardadas
    if (ot.numero_factura && ot.factura_lineas) {
        try {
            lineasFactura = JSON.parse(ot.factura_lineas);
        } catch (_) {
            lineasFactura = [];
        }
        if (lineasFactura.length === 0) _construirLineasDesdeOT(ot);
    } else {
        _construirLineasDesdeOT(ot);
    }

    renderizarTablaFactura();
    abrirModal('modalFactura');
}

function _construirLineasDesdeOT(ot) {
    const { pHora, pDesp, motivo } = _calcularTarifas(ot);
    const label   = ot.num_tecnicos === 1 ? 'técnico' : 'técnicos';
    const sufijo  = motivo !== 'NORMAL' ? ` [${motivo}]` : '';
    const txtObra = `Mano de Obra${sufijo} (${ot.num_tecnicos} ${label} x ${ot.horas} hrs)`;

    lineasFactura = [
        { concepto: `Desplazamiento${sufijo}`, cantidad: 1,                          precio: pDesp },
        { concepto: txtObra,                    cantidad: ot.horas * ot.num_tecnicos,  precio: pHora }
    ];

    // Materiales desde adjuntos (cargados async en el siguiente tick)
    API.get(`/api/ot/${ot.id}/adjuntos`).then(adjuntos => {
        if (adjuntos && adjuntos.length > 0) {
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
            lineasFactura.push({ concepto: 'Materiales y repuestos', cantidad: 1, precio: ot.materiales_precio });
        }
        renderizarTablaFactura();
    }).catch(() => {
        if (ot.materiales_precio > 0) {
            lineasFactura.push({ concepto: 'Materiales y repuestos', cantidad: 1, precio: ot.materiales_precio });
            renderizarTablaFactura();
        }
    });
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

// ── Emitir / Registrar ────────────────────────────────────────

/**
 * Llama a POST /api/factura → crea o recupera la factura para esta OT.
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
        document.getElementById('factNumero').innerText   = data.numero_factura;
        document.getElementById('factNumero').style.color = '#1abc9c';
        document.getElementById('factFechaHoy').innerText = data.fecha_emision
            ? new Date(data.fecha_emision + 'T00:00:00').toLocaleDateString('es-ES')
            : new Date().toLocaleDateString('es-ES');
    }
    return data;
}

/** Guarda las líneas modificadas en la factura (crea la factura si no existe todavía). */
async function guardarCambiosFactura() {
    try {
        await _emitirYRegistrar();
        await API.post('/api/factura/lineas', { ot_id: otActualId, lineas: lineasFactura });
        // Refrescar otsGlobal para que la próxima apertura cargue las líneas guardadas
        const frescas = await API.get('/api/ot');
        if (Array.isArray(frescas)) otsGlobal = frescas;
        const numFact = document.getElementById('factNumero').innerText;
        alert(`✅ Cambios guardados (${numFact})`);
    } catch (e) {
        alert('❌ Error al guardar: ' + e.message);
    }
}

/** Descarga el PDF de la factura sin cabeceras del navegador. */
async function descargarFacturaPDF() {
    try { await _emitirYRegistrar(); } catch (e) { alert('❌ ' + e.message); return; }

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
    try { await _emitirYRegistrar(); } catch (e) { alert('❌ ' + e.message); return; }

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
            htmlBody:      `<div style="font-family:Arial;padding:20px;"><h2>Hola, ${cliente.nombre}</h2><p>Adjuntamos la factura <strong>${numFactura}</strong> de la OT <strong>${otActualCodigo}</strong>.</p></div>`,
            pdfBase64:     pdfDataUrl.split(',')[1],
            nombreArchivo: `Factura-${numFactura}.pdf`
        }).then(data => { if (data.error) alert('❌ ' + data.error); else alert('✅ ' + data.mensaje); });
    });
}
