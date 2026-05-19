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
    return { pHora: 30, pDesp: 35, motivo: 'NORMAL' };
}

// ── Modal ─────────────────────────────────────────────────────

async function abrirGeneradorFactura(id) {
    const ot = otsGlobal.find(o => o.id === id);
    otActualId     = ot.id;
    otActualCodigo = ot.codigo_ot;
    window._modoRectificativa = false;
    document.getElementById('factNumero').style.color  = ot.numero_factura ? '#1abc9c' : '#aaa';

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
    _renderBadgeEnviada(ot.factura_emails_enviados);
    _renderQRVeriFactu(ot.factura_qr);
    _renderBadgeAEAT(ot.factura_aeat_estado, ot.factura_aeat_error);
    window._facturaActualId = ot.factura_id || null;

    // Limpiar etiqueta "Rectificada por..." previa si la hubiera
    const prevTag = document.getElementById('tagRectificada');
    if (prevTag) prevTag.remove();

    // Restablecer botones por defecto
    const btnRect    = document.getElementById('btnRectificarFact');
    const btnGuardar = document.querySelector('#modalFactura [onclick="guardarCambiosFactura()"]');
    const btnEmail   = document.querySelector('#modalFactura [onclick="enviarFacturaAlCliente()"]');
    const btnPDF     = document.querySelector('#modalFactura [onclick="descargarFacturaPDF()"]');
    if (btnGuardar) { btnGuardar.innerText = '💾 Guardar Cambios'; btnGuardar.style.display = ''; }
    if (btnEmail)   btnEmail.style.display = '';
    if (btnPDF)     btnPDF.style.display = '';
    if (btnRect)    btnRect.style.display = '';
    const avisoPrev = document.getElementById('avisoRefactura');
    if (avisoPrev) avisoPrev.remove();
    const btnRefacPrev = document.getElementById('btnRefacturar');
    if (btnRefacPrev) btnRefacPrev.remove();
    window._modoRefactura = false;

    if (ot.factura_rectificada_por_id) {
        // Factura rectificada (anulada) → modo solo lectura.
        // Refacturar es OPCIONAL, no obligatorio (puede ser solo abono).
        if (btnRect)    btnRect.style.display = 'none';
        if (btnGuardar) btnGuardar.style.display = 'none';
        if (btnEmail)   btnEmail.style.display = 'none';

        const fNum = document.getElementById('factNumero');
        if (fNum) {
            const rectId = ot.factura_rectificada_por_id;
            fNum.insertAdjacentHTML('afterend',
                ` <span id="tagRectificada" class="no-print" onclick="verRectificativa(${rectId})" style="background:#e67e22; color:#fff; padding:3px 10px; border-radius:12px; font-size:0.8em; margin-left:6px; cursor:pointer;" title="Click para ver la rectificativa">📝 Rectificada por ${ot.factura_rectificativa_numero || ''} →</span>`);
        }
        const factHeader = document.querySelector('.datos-factura');
        if (factHeader) {
            factHeader.insertAdjacentHTML('beforeend',
                `<div id="avisoRefactura" class="no-print" style="background:#fff3e0; border-left:4px solid #e67e22; padding:8px 12px; margin-top:10px; font-size:0.85em; color:#7f8c8d;">Esta factura está <strong>anulada</strong> por la rectificativa. Si la anulación es solo un abono, no necesita más acción. Si necesitas emitir una nueva factura, pulsa <em>Emitir Refactura</em>.</div>`);
        }
        // Inyectar botón refactura como opción explícita (al final de la botonera)
        const botoneraFactura = document.querySelector('#modalFactura .no-print > button')?.parentNode;
        if (botoneraFactura && !document.getElementById('btnRefacturar')) {
            const btn = document.createElement('button');
            btn.id = 'btnRefacturar';
            btn.className = 'btn-secundario';
            btn.style.cssText = 'flex-grow:1; padding:14px; font-size:15px; background-color:#3498db; color:#fff;';
            btn.innerText = '📄 Emitir Refactura';
            btn.onclick = () => { window._modoRefactura = true; guardarCambiosFactura(); };
            botoneraFactura.appendChild(btn);
        }
    } else {

        // Si esta factura es una refactura (existe factura anterior rectificada en la misma OT),
        // mostrar el historial como badge clickable.
        const prevHist = document.getElementById('tagHistorial');
        if (prevHist) prevHist.remove();
        if (ot.factura_anterior_id) {
            const fNum = document.getElementById('factNumero');
            if (fNum) {
                fNum.insertAdjacentHTML('afterend',
                    ` <span id="tagHistorial" class="no-print" onclick="abrirFacturaAnterior(${ot.factura_anterior_id})" style="background:#3498db; color:#fff; padding:3px 10px; border-radius:12px; font-size:0.8em; margin-left:6px; cursor:pointer;" title="Click para ver la factura anterior rectificada">📜 Refactura de ${ot.factura_anterior_numero}${ot.factura_anterior_rectificativa ? ' (rect. ' + ot.factura_anterior_rectificativa + ')' : ''} →</span>`);
            }
        }
    }
    abrirModal('modalFactura');
}

function _renderBadgeAEAT(estado, error) {
    const badge = document.getElementById('badgeAEAT');
    if (!badge) return;
    // Si está desactivado (VeriFactu off hasta 2027), no mostramos badge
    if (!estado || estado === 'DESACTIVADO' || estado === 'PENDIENTE') { badge.style.display = 'none'; return; }
    const colors = {
        ACEPTADO:  { bg:'#27ae60', txt:'✓ AEAT Aceptada' },
        PARCIAL:   { bg:'#f39c12', txt:'⚠ AEAT Parcial' },
        PENDIENTE: { bg:'#95a5a6', txt:'⏳ AEAT Pendiente' },
        RECHAZADO: { bg:'#e74c3c', txt:'✗ AEAT Rechazada' },
        ERROR:     { bg:'#c0392b', txt:'⚠ AEAT Error' }
    };
    const c = colors[estado] || { bg:'#7f8c8d', txt: 'AEAT ' + estado };
    badge.style.background = c.bg;
    badge.style.color = '#fff';
    badge.innerText = c.txt;
    badge.title = error || `Estado AEAT: ${estado}`;
    badge.style.display = 'inline-block';
}

async function verEstadoAEAT() {
    const id = window._facturaActualId;
    if (!id) { alert('No hay factura con ID asociado todavía. Guarda primero los cambios.'); return; }
    const r = await API.get(`/api/facturas/${id}/aeat-estado`);
    const cont = document.getElementById('contEstadoAEAT');
    if (r.error) { cont.innerHTML = `<p style="color:#e74c3c;">${r.error}</p>`; }
    else {
        cont.innerHTML = `
            <p><strong>Nº Factura:</strong> ${r.numero_factura}</p>
            <p><strong>Estado:</strong> ${r.aeat_estado || '—'}</p>
            <p><strong>CSV AEAT:</strong> ${r.aeat_csv || '—'}</p>
            <p><strong>Huella:</strong> <span style="word-break:break-all;">${r.aeat_huella || '—'}</span></p>
            <p><strong>Huella anterior:</strong> <span style="word-break:break-all;">${r.aeat_huella_anterior || '(primera)'}</span></p>
            <p><strong>Fecha envío:</strong> ${r.aeat_fecha_envio || '—'}</p>
            <p><strong>Intentos:</strong> ${r.aeat_intentos || 0}</p>
            ${r.aeat_error ? `<p style="color:#e74c3c;"><strong>Error:</strong> ${r.aeat_error}</p>` : ''}
            ${r.aeat_respuesta ? `<details><summary>Respuesta AEAT (raw)</summary><pre style="white-space:pre-wrap; font-size:0.75em; max-height:200px; overflow:auto;">${r.aeat_respuesta.replace(/</g,'&lt;')}</pre></details>` : ''}
        `;
    }
    abrirModal('modalEstadoAEAT');
}

// ── Rectificativa ──────────────────────────────────────────────

let lineasRect = [];

function abrirRectificar() {
    const numActual = document.getElementById('factNumero').innerText;
    if (!window._facturaActualId || numActual.includes('asignará')) {
        alert('❌ Guarda primero la factura antes de rectificarla.');
        return;
    }
    if (numActual.startsWith('R-')) {
        alert('❌ No se puede rectificar una factura rectificativa.');
        return;
    }
    document.getElementById('rectOrigNumero').innerText = numActual;
    document.getElementById('rectMotivo').value = '';
    // Pre-cargar líneas de la factura original (copia editable)
    lineasRect = lineasFactura.map(l => ({ concepto: l.concepto, cantidad: l.cantidad, precio: l.precio }));
    _renderLineasRect();
    abrirModal('modalRectificar');
}

function _renderLineasRect() {
    const tbody = document.getElementById('tbodyRectLineas');
    tbody.innerHTML = '';
    let base = 0;
    lineasRect.forEach((l, idx) => {
        const t = (parseFloat(l.cantidad)||0) * (parseFloat(l.precio)||0);
        base += t;
        tbody.innerHTML += `<tr>
            <td><input type="text"   value="${(l.concepto||'').replace(/"/g,'&quot;')}" onchange="rectActualizarLinea(${idx},'concepto',this.value)"></td>
            <td><input type="number" step="0.1"  value="${l.cantidad}" onchange="rectActualizarLinea(${idx},'cantidad',this.value)"></td>
            <td><input type="number" step="0.01" value="${l.precio}"   onchange="rectActualizarLinea(${idx},'precio',this.value)"></td>
            <td style="text-align:right;">${t.toFixed(2)} €</td>
            <td><button class="btn-peligro" onclick="rectBorrarLinea(${idx})">🗑️</button></td>
        </tr>`;
    });
    const iva = base * 0.21;
    document.getElementById('rectBase').innerText  = base.toFixed(2);
    document.getElementById('rectIva').innerText   = iva.toFixed(2);
    document.getElementById('rectTotal').innerText = (base + iva).toFixed(2);
}
function rectActualizarLinea(i, c, v) { lineasRect[i][c] = c === 'concepto' ? v : (parseFloat(v) || 0); _renderLineasRect(); }
function rectAgregarLinea()           { lineasRect.push({ concepto: '', cantidad: 1, precio: 0 }); _renderLineasRect(); }
function rectBorrarLinea(i)           { lineasRect.splice(i, 1); _renderLineasRect(); }

/** Abre una factura por su id (factura regular rectificada, para ver el historial). */
async function abrirFacturaAnterior(facturaId) {
    if (!facturaId) return;
    // Reutilizamos verRectificativa que pinta cualquier factura por id en el modal completo.
    await verRectificativa(facturaId);
}

/** Listado global de facturas rectificativas. */
async function verListaRectificativas() {
    const lista = await API.get('/api/facturas/rectificativas');
    const tbody = document.getElementById('tbodyRectList');
    if (!Array.isArray(lista) || lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#888; padding:20px;">No hay facturas rectificativas emitidas todavía.</td></tr>';
    } else {
        tbody.innerHTML = lista.map(r => `
            <tr>
                <td><strong style="color:#e67e22;">${r.numero_factura}</strong></td>
                <td>${r.fecha_emision || '—'}</td>
                <td>${r.orig_numero || '—'}</td>
                <td>${r.cliente_nombre || '—'}</td>
                <td>${r.codigo_ot || r.presupuesto_ref || '—'}</td>
                <td style="text-align:right;"><strong>${parseFloat(r.total||0).toFixed(2)} €</strong></td>
                <td style="font-size:0.85em; color:#7f8c8d;">${(r.motivo_rectificacion||'').substring(0,60)}${(r.motivo_rectificacion||'').length>60?'...':''}</td>
                <td><button class="btn-secundario" style="padding:5px 10px; font-size:0.85em;" onclick="verRectificativa(${r.id})">Ver</button></td>
            </tr>
        `).join('');
    }
    abrirModal('modalListaRect');
}

/** Abre una rectificativa en el modal completo de factura (editable, PDF, email). */
async function verRectificativa(facturaId) {
    if (!facturaId) return;
    // Cerrar el listado si está abierto (mejor UX)
    cerrarModal('modalListaRect');

    const f = await API.get(`/api/facturas/${facturaId}`);
    if (f.error) { alert('❌ ' + f.error); return; }

    // Modo rectificativa: marcamos flag y cargamos en el modal estándar
    window._modoRectificativa = true;
    window._facturaActualId   = f.id;
    otActualId     = f.ot_id || null;
    otActualCodigo = f.codigo_ot || f.presupuesto_ref || '—';

    // Cargar líneas
    try { lineasFactura = JSON.parse(f.lineas || '[]'); } catch (_) { lineasFactura = []; }

    // Populate UI
    document.getElementById('factOtCode').innerText    = `${otActualCodigo} (rectifica ${f.rectifica_a_numero || ''})`;
    document.getElementById('factNumero').innerText    = f.numero_factura;
    document.getElementById('factNumero').style.color  = '#e67e22';
    document.getElementById('factFechaHoy').innerText  = f.fecha_emision
        ? new Date(f.fecha_emision + 'T00:00:00').toLocaleDateString('es-ES')
        : new Date().toLocaleDateString('es-ES');

    // Cliente: usar el de la OT/presupuesto si está disponible
    const clienteId = (otsGlobal.find(o => o.id === f.ot_id) || {}).cliente_id || '';
    document.getElementById('selClienteFactura').value = clienteId || '';
    actualizarInfoClienteFactura();

    renderizarTablaFactura();
    _renderBadgeEnviada(f.emails_enviados);
    _renderQRVeriFactu(f.qr_data);
    _renderBadgeAEAT(f.aeat_estado, f.aeat_error);

    // Limpiar tag previa y añadir aviso de "es rectificativa de XX"
    const prevTag = document.getElementById('tagRectificada');
    if (prevTag) prevTag.remove();
    const fNum = document.getElementById('factNumero');
    if (fNum) {
        fNum.insertAdjacentHTML('afterend',
            ` <span id="tagRectificada" class="no-print" style="background:#e67e22; color:#fff; padding:3px 10px; border-radius:12px; font-size:0.8em; margin-left:6px;" title="${(f.motivo_rectificacion || '').replace(/"/g,'&quot;')}">📝 Rectificativa de ${f.rectifica_a_numero || ''}</span>`);
    }

    // Ocultar botón "Emitir Rectificativa" (no se puede rectificar una rectificativa)
    const btnRect = document.getElementById('btnRectificarFact');
    if (btnRect) btnRect.style.display = 'none';

    abrirModal('modalFactura');
}

async function confirmarRectificar() {
    const motivo = document.getElementById('rectMotivo').value.trim();
    if (!motivo) { alert('❌ Indica el motivo de la rectificación.'); return; }
    const base  = parseFloat(document.getElementById('rectBase').innerText);
    const iva   = parseFloat(document.getElementById('rectIva').innerText);
    const total = parseFloat(document.getElementById('rectTotal').innerText);

    if (!confirm(`¿Emitir rectificativa por ${total.toFixed(2)} €?\n\nMotivo: ${motivo}\n\nSe creará una nueva factura R-NN-YYYYMMDD y la original quedará marcada como rectificada.`)) return;

    const r = await API.post(`/api/facturas/${window._facturaActualId}/rectificar`, {
        lineas: lineasRect, base_imponible: base, iva, total, motivo
    });
    if (r.error) { alert('❌ ' + r.error); return; }
    cerrarModal('modalRectificar');
    alert(`✅ Rectificativa emitida: ${r.numero_factura}\n\nLa factura original (${r.numero_rectificada}) ha quedado vinculada.`);
    try { const frescas = await API.get('/api/ot'); if (Array.isArray(frescas)) otsGlobal = frescas; } catch (_) {}
    cerrarModal('modalFactura');
}

async function reenviarAEAT() {
    const id = window._facturaActualId;
    if (!id) return;
    const r = await API.post(`/api/facturas/${id}/aeat-reenviar`, {});
    alert(r.ok ? `✅ AEAT: ${r.estado} ${r.csv ? '(CSV: '+r.csv+')' : ''}` : `❌ ${r.error || r.estado}`);
    await verEstadoAEAT();
    // Refrescar lista global
    try { const frescas = await API.get('/api/ot'); if (Array.isArray(frescas)) otsGlobal = frescas; } catch (_) {}
}

function _renderQRVeriFactu(qrDataUrl) {
    const bloque = document.getElementById('bloqueQRFact');
    const img    = document.getElementById('factQRImg');
    if (!bloque || !img) return;
    if (qrDataUrl) {
        img.src = qrDataUrl;
        bloque.style.display = 'block';
    } else {
        bloque.style.display = 'none';
    }
}

/** Muestra badge "Enviada X veces" al lado de #factNumero si hay envíos registrados. */
function _renderBadgeEnviada(emailsJson) {
    const badge = document.getElementById('badgeFactEnviada');
    if (!badge) return;
    let arr = [];
    try { arr = JSON.parse(emailsJson || '[]'); } catch { arr = []; }
    window._emailsEnviadosActual = arr;
    if (arr.length === 0) {
        badge.style.display = 'none';
        return;
    }
    badge.style.display = 'inline-block';
    badge.innerText = `📧 Enviada ${arr.length} ${arr.length === 1 ? 'vez' : 'veces'}`;
}

/** Abre popup con historial de envíos de la factura actual. */
function verHistorialEnvios() {
    const arr = window._emailsEnviadosActual || [];
    const cont = document.getElementById('tbodyHistorialEnvios');
    if (!cont) return;
    if (arr.length === 0) {
        cont.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#888;">Sin envíos registrados</td></tr>';
    } else {
        cont.innerHTML = arr.map((e, i) =>
            `<tr><td>${i + 1}</td><td>${e.email || '-'}</td><td>${e.fecha || '-'}</td></tr>`
        ).join('');
    }
    abrirModal('modalHistorialEnvios');
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
        if (data.qr_data) _renderQRVeriFactu(data.qr_data);
    }
    return data;
}

/** Guarda las líneas modificadas en la factura (crea la factura si no existe todavía). */
async function guardarCambiosFactura() {
    try {
        if (window._modoRectificativa) {
            // Rectificativa: ya está emitida, solo actualizamos líneas
            await API.post('/api/factura/lineas', { factura_id: window._facturaActualId, lineas: lineasFactura });
        } else {
            await _emitirYRegistrar();
            await API.post('/api/factura/lineas', { ot_id: otActualId, lineas: lineasFactura });
            const frescas = await API.get('/api/ot');
            if (Array.isArray(frescas)) otsGlobal = frescas;
        }
        const numFact = document.getElementById('factNumero').innerText;
        alert(`✅ Cambios guardados (${numFact})`);
    } catch (e) {
        alert('❌ Error al guardar: ' + e.message);
    }
}

/** Descarga el PDF de la factura sin cabeceras del navegador. */
async function descargarFacturaPDF() {
    if (!window._modoRectificativa) {
        try { await _emitirYRegistrar(); } catch (e) { alert('❌ ' + e.message); return; }
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
    if (!window._modoRectificativa) {
        try { await _emitirYRegistrar(); } catch (e) { alert('❌ ' + e.message); return; }
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
            ot_id:         window._modoRectificativa ? null : otActualId,
            factura_id:    window._facturaActualId,
            emailDestino:  cliente.email,
            asunto:        `Factura ${numFactura} - ServiPlusUltra`,
            htmlBody:      `<div style="font-family:Arial;padding:20px;"><h2>Hola, ${cliente.nombre}</h2><p>Adjuntamos la factura <strong>${numFactura}</strong> de la OT <strong>${otActualCodigo}</strong>.</p></div>`,
            pdfBase64:     pdfDataUrl.split(',')[1],
            nombreArchivo: `Factura-${numFactura}.pdf`
        }).then(async data => {
            if (data.error) { alert('❌ ' + data.error); return; }
            alert('✅ ' + data.mensaje);
            // Refrescar badge: si rectificativa, recargar desde /api/facturas/:id; si no, otsGlobal
            try {
                if (window._modoRectificativa) {
                    const fresh = await API.get(`/api/facturas/${window._facturaActualId}`);
                    if (fresh && !fresh.error) _renderBadgeEnviada(fresh.emails_enviados);
                } else {
                    const frescas = await API.get('/api/ot');
                    if (Array.isArray(frescas)) {
                        otsGlobal = frescas;
                        const otFresh = otsGlobal.find(o => o.id === otActualId);
                        if (otFresh) _renderBadgeEnviada(otFresh.factura_emails_enviados);
                    }
                }
            } catch (_) {}
        });
    });
}
