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
    document.getElementById('factNumero').innerText    = ot.numero_factura || '(sin número)';
    document.getElementById('factNumero').style.color  = ot.numero_factura ? '#1abc9c' : '#aaa';

    const fechaEmision = ot.factura_fecha_emision
        ? new Date(ot.factura_fecha_emision + 'T00:00:00').toLocaleDateString('es-ES')
        : new Date().toLocaleDateString('es-ES');
    document.getElementById('factFechaHoy').innerText  = fechaEmision;

    document.getElementById('selClienteFactura').value = ot.cliente_id || '';
    actualizarInfoClienteFactura();

    // Si la factura ya fue guardada (borrador con o sin número, o emitida), cargar sus líneas
    if (ot.factura_lineas) {
        try {
            lineasFactura = JSON.parse(ot.factura_lineas);
        } catch (_) {
            lineasFactura = [];
        }
        if (lineasFactura.length === 0) _construirLineasDesdeOT(ot);
    } else {
        _construirLineasDesdeOT(ot);
    }

    // Limpiar badges/avisos dinámicos previos (antes de re-render)
    ['tagEstadoFact','tagRectificada','tagHistorial','badgePendienteElim'].forEach(id => {
        const el = document.getElementById(id); if (el) el.remove();
    });
    const avisoPrev = document.getElementById('avisoEstadoFact'); if (avisoPrev) avisoPrev.remove();

    renderizarTablaFactura();
    _renderBadgeEnviada(ot.factura_emails_enviados);
    _renderQRFactura(ot.factura_qr);
    _renderBadgePendienteElim(ot.factura_eliminacion_pendiente);
    window._facturaActualId   = ot.factura_id || null;
    window._modoRectificativa = false;

    // Botones del modal
    const btnRect    = document.getElementById('btnRectificarFact');
    const btnGuardar = document.getElementById('btnGuardarBorrador');
    const btnAsignar = document.getElementById('btnAsignarNumFact');
    const btnEmitir  = document.getElementById('btnEmitirFact');
    const btnEmail   = document.getElementById('btnEnviarFact');
    const btnPDF     = document.getElementById('btnDescargarFact');
    [btnRect, btnGuardar, btnAsignar, btnEmitir, btnEmail, btnPDF].forEach(b => { if (b) b.style.display = ''; });
    if (btnGuardar) { btnGuardar.innerText = '💾 Guardar borrador'; btnGuardar.style.backgroundColor = ''; btnGuardar.style.color = ''; }

    const estado   = ot.factura_estado || (ot.numero_factura ? 'EMITIDA' : 'BORRADOR');
    const tieneNum = !!ot.numero_factura;
    const wrap     = document.getElementById('factBadgesWrap');

    if (estado === 'EMITIDA') {
        // Factura definitiva: congelada. Solo PDF, enviar y rectificar.
        if (btnGuardar) btnGuardar.style.display = 'none';
        if (btnAsignar) btnAsignar.style.display = 'none';
        if (btnEmitir)  btnEmitir.style.display = 'none';
        if (wrap) wrap.insertAdjacentHTML('beforeend',
            `<span id="tagEstadoFact" class="fact-pill fact-pill-green fact-pill-static" title="Factura definitiva e inmutable">✅ EMITIDA</span>`);
    } else {
        // BORRADOR (con o sin número): editable. Sin email/rectificar hasta emitir.
        if (btnEmail) btnEmail.style.display = 'none';
        if (btnRect)  btnRect.style.display = 'none';
        // "Asignar número" solo si todavía no lo tiene
        if (btnAsignar) btnAsignar.style.display = tieneNum ? 'none' : '';
        const badgeTxt   = tieneNum ? '📝 BORRADOR · nº ' + escapeHTML(ot.numero_factura) : '📝 BORRADOR';
        const badgeTitle = tieneNum ? 'Borrador con número asignado: editable hasta marcarla como emitida' : 'Borrador sin número fiscal';
        if (wrap) wrap.insertAdjacentHTML('beforeend',
            `<span id="tagEstadoFact" class="fact-pill fact-pill-grey fact-pill-static" title="${badgeTitle}">${badgeTxt}</span>`);
        const factHeader = document.querySelector('.datos-factura');
        const avisoHtml  = tieneNum
            ? `Borrador <strong>con número ${escapeHTML(ot.numero_factura)}</strong> (ya puedes enviarlo al cliente fuera de la app). Sigue siendo <strong>editable</strong>; pulsa <em>✅ Marcar emitida</em> cuando sea definitiva (quedará inmutable).`
            : `Borrador <strong>sin número fiscal</strong>. Edítalo libremente. Pulsa <em>🔢 Asignar número</em> si necesitas enviarlo fuera de la app, o <em>✅ Marcar emitida</em> para asignar número y congelarla.`;
        if (factHeader) factHeader.insertAdjacentHTML('beforeend',
            `<div id="avisoEstadoFact" class="no-print" style="background:#fff3e0; border-left:4px solid #e67e22; padding:8px 12px; margin-top:10px; font-size:0.85em; color:#7f8c8d;">${avisoHtml}</div>`);
    }

    // Si es una refactura (la OT tuvo una factura anterior rectificada), mostrar el origen
    if (ot.factura_anterior_id && wrap) {
        wrap.insertAdjacentHTML('beforeend',
            `<span id="tagHistorial" class="fact-pill fact-pill-blue" onclick="abrirFacturaAnterior(${ot.factura_anterior_id})" title="Click para ver la factura anterior rectificada">📜 Refactura de ${escapeHTML(ot.factura_anterior_numero)}${ot.factura_anterior_rectificativa ? ' (rect. ' + escapeHTML(ot.factura_anterior_rectificativa) + ')' : ''} →</span>`);
    }

    abrirModal('modalFactura');
}

function _renderBadgePendienteElim(pendiente) {
    const prev = document.getElementById('badgePendienteElim');
    if (prev) prev.remove();
    if (!pendiente) return;
    const wrap = document.getElementById('factBadgesWrap');
    if (!wrap) return;
    wrap.insertAdjacentHTML('beforeend',
        `<span id="badgePendienteElim" class="fact-pill fact-pill-orange fact-pill-static" title="Esta factura tiene una solicitud de eliminación pendiente de admin">⚠️ Pendiente eliminación</span>`);
}

// ── Rectificativa ──────────────────────────────────────────────

let lineasRect = [];

function abrirRectificar() {
    const numActual = document.getElementById('factNumero').innerText;
    if (!window._facturaActualId || numActual.includes('sin número')) {
        alert('❌ Guarda primero la factura antes de rectificarla.');
        return;
    }
    if (numActual.startsWith('R-')) {
        alert('❌ No se puede rectificar una factura rectificativa.');
        return;
    }
    document.getElementById('rectOrigNumero').innerText = numActual;
    document.getElementById('rectMotivo').value = '';
    // Guardar copia de las líneas originales para reconstruir según el tipo elegido
    window._rectLineasOrig = lineasFactura.map(l => ({ concepto: l.concepto, cantidad: l.cantidad, precio: l.precio }));
    document.getElementById('rectTipo').value = 'abono';
    cambiarTipoRect();   // por defecto: abono (importes en negativo)
    abrirModal('modalRectificar');
}

/** Reconstruye las líneas de la rectificativa según el tipo (abono = negativo / manual). */
function cambiarTipoRect() {
    const tipo  = document.getElementById('rectTipo').value;
    const orig  = window._rectLineasOrig || [];
    const ayuda = document.getElementById('rectTipoAyuda');
    if (tipo === 'abono') {
        // Anulación: importes de la original en NEGATIVO
        lineasRect = orig.map(l => ({ concepto: l.concepto, cantidad: l.cantidad, precio: -Math.abs(parseFloat(l.precio) || 0) }));
        if (ayuda) ayuda.innerText = 'Un abono anula la factura original: refleja sus importes en negativo.';
    } else {
        // Manual: parte de la original; el usuario ajusta (negativos para abonar, positivos para cargos)
        lineasRect = orig.map(l => ({ concepto: l.concepto, cantidad: l.cantidad, precio: parseFloat(l.precio) || 0 }));
        if (ayuda) ayuda.innerText = 'Edita los importes a mano: negativos para abonar, positivos para cargos adicionales.';
    }
    _renderLineasRect();
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

// ── Solicitudes de eliminación de facturas (admin) ────────────

/** Refresca el badge naranja "Solicitudes eliminación" en top bar (solo admin con pendientes). */
async function _actualizarBadgeSolicitudesElim() {
    const btn = document.getElementById('btnSolicitudesElim');
    if (!btn) return;
    if (!sesion || sesion.rol !== 'admin') { btn.style.display = 'none'; return; }
    try {
        const r = await API.get('/api/admin/facturas/pendientes-eliminacion');
        if (Array.isArray(r) && r.length > 0) {
            btn.style.display = '';
            btn.innerText = `⚠️ Solicitudes eliminación (${r.length})`;
        } else {
            btn.style.display = 'none';
        }
    } catch (_) { btn.style.display = 'none'; }
}

async function verSolicitudesEliminacion() {
    const lista = await API.get('/api/admin/facturas/pendientes-eliminacion');
    const tbody = document.getElementById('tbodySolicitudesElim');
    if (!Array.isArray(lista) || lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#888; padding:20px;">No hay solicitudes pendientes.</td></tr>';
    } else {
        tbody.innerHTML = lista.map(f => {
            const tipo = f.es_rectificativa ? '📝 Rectificativa' : '📄 Regular';
            return `<tr>
                <td><strong>${escapeHTML(f.numero_factura)}</strong></td>
                <td>${f.fecha_emision || '—'}</td>
                <td>${escapeHTML(f.cliente_nombre || '—')}</td>
                <td>${escapeHTML(f.codigo_ot || f.presupuesto_ref || '—')}</td>
                <td style="text-align:right;"><strong>${parseFloat(f.total||0).toFixed(2)} €</strong></td>
                <td>${tipo}</td>
                <td style="text-align:center;">
                    <button class="btn-secundario" style="background:#27ae60; color:#fff; padding:5px 10px; font-size:0.82em;" onclick="aprobarEliminacionFact(${f.id})">✓ Aprobar</button>
                    <button class="btn-secundario" style="background:#95a5a6; color:#fff; padding:5px 10px; font-size:0.82em;" onclick="rechazarEliminacionFact(${f.id})">✕ Rechazar</button>
                </td>
            </tr>`;
        }).join('');
    }
    abrirModal('modalSolicitudesElim');
}

async function aprobarEliminacionFact(id) {
    if (!confirm('¿Aprobar eliminación? La factura se borrará definitivamente y su número quedará libre para gap-fill.')) return;
    const r = await API.post(`/api/admin/facturas/${id}/aprobar-eliminacion`, {});
    if (r.ok) {
        alert(`✅ Factura ${r.numero_eliminado || ''} eliminada. Número liberado.`);
        try { const frescas = await API.get('/api/ot'); if (Array.isArray(frescas)) otsGlobal = frescas; } catch (_) {}
        verSolicitudesEliminacion();
        _actualizarBadgeSolicitudesElim();
    } else {
        alert('❌ ' + (r.error || 'Error desconocido'));
    }
}

async function rechazarEliminacionFact(id) {
    if (!confirm('¿Rechazar la solicitud? La factura seguirá activa.')) return;
    const r = await API.post(`/api/admin/facturas/${id}/rechazar-eliminacion`, {});
    if (r.ok) {
        alert('✅ Solicitud rechazada. La factura sigue activa.');
        verSolicitudesEliminacion();
        _actualizarBadgeSolicitudesElim();
    } else {
        alert('❌ ' + (r.error || 'Error desconocido'));
    }
}

// Refrescar badge al cargar y cada cierto tiempo
if (typeof window !== 'undefined') {
    setTimeout(_actualizarBadgeSolicitudesElim, 2000);
    setInterval(_actualizarBadgeSolicitudesElim, 60000);
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
                <td><strong style="color:#e67e22;">${escapeHTML(r.numero_factura)}</strong></td>
                <td>${r.fecha_emision || '—'}</td>
                <td>${escapeHTML(r.orig_numero || '—')}</td>
                <td>${escapeHTML(r.cliente_nombre || '—')}</td>
                <td>${escapeHTML(r.codigo_ot || r.presupuesto_ref || '—')}</td>
                <td style="text-align:right;"><strong>${parseFloat(r.total||0).toFixed(2)} €</strong></td>
                <td style="font-size:0.85em; color:#7f8c8d;">${escapeHTML((r.motivo_rectificacion||'').substring(0,60))}${(r.motivo_rectificacion||'').length>60?'...':''}</td>
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
    _renderQRFactura(f.qr_data);
    // Limpiar badges/avisos dinámicos previos
    ['tagEstadoFact','tagRectificada','tagHistorial','badgePendienteElim'].forEach(id => {
        const el = document.getElementById(id); if (el) el.remove();
    });
    const avisoPrev = document.getElementById('avisoEstadoFact'); if (avisoPrev) avisoPrev.remove();
    const wrap = document.getElementById('factBadgesWrap');
    if (wrap) {
        if (f.es_rectificativa) {
            wrap.insertAdjacentHTML('beforeend',
                `<span id="tagRectificada" class="fact-pill fact-pill-orange fact-pill-static" title="${(f.motivo_rectificacion || '').replace(/"/g,'&quot;')}">📝 Rectificativa de ${escapeHTML(f.rectifica_a_numero || '')}</span>`);
        } else if (f.rectificada_por_id) {
            wrap.insertAdjacentHTML('beforeend',
                `<span id="tagRectificada" class="fact-pill fact-pill-orange" onclick="verRectificativa(${f.rectificada_por_id})" title="Click para ver la rectificativa">📝 Rectificada por ${escapeHTML(f.rectificada_por_numero || '')} →</span>`);
        }
    }

    // Botones en modo rectificativa: una rectificativa es EMITIDA → sin "Emitir", "Asignar nº" ni "Rectificar".
    const btnRect    = document.getElementById('btnRectificarFact');
    const btnEmitir  = document.getElementById('btnEmitirFact');
    const btnAsignar = document.getElementById('btnAsignarNumFact');
    const btnGuardar = document.getElementById('btnGuardarBorrador');
    if (btnRect)    btnRect.style.display = 'none';
    if (btnEmitir)  btnEmitir.style.display = 'none';
    if (btnAsignar) btnAsignar.style.display = 'none';
    if (btnGuardar) btnGuardar.style.display = 'none';

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

function _renderQRFactura(qrDataUrl) {
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
    badge.style.display = 'inline-flex';
    badge.className = 'fact-pill fact-pill-green';
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
            `<tr><td>${i + 1}</td><td>${escapeHTML(e.email || '-')}</td><td>${escapeHTML(e.fecha || '-')}</td></tr>`
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
            <td><input class="conc-input" type="text" value="${escapeHTML(l.concepto)}" title="${escapeHTML(l.concepto)}" onchange="actualizarLinea(${idx},'concepto',this.value)"><span class="conc-print">${escapeHTML(l.concepto)}</span></td>
            <td><input type="number" step="0.1"  value="${l.cantidad}" onchange="actualizarLinea(${idx},'cantidad',this.value)"></td>
            <td><input type="number" step="0.01" value="${l.precio}"   onchange="actualizarLinea(${idx},'precio',this.value)"></td>
            <td class="celda-total" style="text-align:right;">${t.toFixed(2)} €</td>
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
        if (data.qr_data) _renderQRFactura(data.qr_data);
    }
    return data;
}

/** Guarda como BORRADOR (sin asignar número fiscal). En rectificativa, guarda sus líneas. */
async function guardarCambiosFactura() {
    try {
        const base  = parseFloat(document.getElementById('factBase').innerText);
        const iva   = parseFloat(document.getElementById('factIva').innerText);
        const total = parseFloat(document.getElementById('factTotal').innerText);

        if (window._modoRectificativa) {
            await API.post('/api/factura/lineas', { factura_id: window._facturaActualId, lineas: lineasFactura });
            alert('✅ Cambios guardados');
            return;
        }

        const r = await API.post('/api/factura/borrador', {
            ot_id: otActualId, base_imponible: base, iva, total, lineas: lineasFactura
        });
        if (r.error) { alert('❌ ' + r.error); return; }
        window._facturaActualId = r.factura_id || window._facturaActualId;
        const frescas = await API.get('/api/ot');
        if (Array.isArray(frescas)) otsGlobal = frescas;
        alert('💾 Borrador guardado (todavía sin número de factura).');
    } catch (e) {
        alert('❌ Error al guardar: ' + e.message);
    }
}

/** Asigna número fiscal SIN congelar: la factura sigue editable (BORRADOR con número). */
async function asignarNumeroFactura() {
    if (window._modoRectificativa) return;
    if (!confirm('¿Asignar número de factura ahora?\n\nRecibirá su número correlativo pero SEGUIRÁ SIENDO EDITABLE (no se congela). Úsalo si necesitas enviarla al cliente fuera de la app antes de darla por definitiva.\n\nCuando sea definitiva, pulsa "✅ Marcar emitida".')) return;
    try {
        const base  = parseFloat(document.getElementById('factBase').innerText);
        const iva   = parseFloat(document.getElementById('factIva').innerText);
        const total = parseFloat(document.getElementById('factTotal').innerText);
        const data = await API.post('/api/factura/asignar-numero', {
            ot_id: otActualId, base_imponible: base, iva, total, lineas: lineasFactura
        });
        if (data.error) { alert('❌ ' + data.error); return; }
        const frescas = await API.get('/api/ot');
        if (Array.isArray(frescas)) otsGlobal = frescas;
        alert(`🔢 Número asignado: ${data.numero_factura}\n\nLa factura sigue editable. Cuando sea definitiva, pulsa "✅ Marcar emitida".`);
        if (otsGlobal.find(o => o.id === otActualId)) abrirGeneradorFactura(otActualId);
    } catch (e) {
        alert('❌ Error al asignar número: ' + e.message);
    }
}

/** Marca la factura como EMITIDA: asigna número si no tiene y la congela (inmutable). */
async function emitirFactura() {
    if (!confirm('¿Marcar la factura como EMITIDA?\n\nQuedará DEFINITIVA e INMUTABLE: no se podrá editar ni borrar, solo corregir mediante una rectificativa (abono). Si todavía no tiene número, se le asignará el siguiente correlativo.')) return;
    try {
        const base  = parseFloat(document.getElementById('factBase').innerText);
        const iva   = parseFloat(document.getElementById('factIva').innerText);
        const total = parseFloat(document.getElementById('factTotal').innerText);
        const data = await API.post('/api/factura', {
            ot_id: otActualId, codigo_ot: otActualCodigo, base_imponible: base, iva, total, lineas: lineasFactura
        });
        if (data.error) { alert('❌ ' + data.error); return; }
        const frescas = await API.get('/api/ot');
        if (Array.isArray(frescas)) otsGlobal = frescas;
        alert(`✅ Factura emitida: ${data.numero_factura}`);
        // Reabrir en estado EMITIDA para reflejar el cambio (congelada)
        if (otsGlobal.find(o => o.id === otActualId)) abrirGeneradorFactura(otActualId);
    } catch (e) {
        alert('❌ Error al emitir: ' + e.message);
    }
}

/** Espera a que imágenes y fuentes del área estén listas antes de capturar (evita PDF en blanco). */
function _esperarRecursosFactura(area) {
    const imgs = [...area.querySelectorAll('img')];
    const espImgs = imgs.map(img =>
        (img.complete && img.naturalWidth > 0)
            ? Promise.resolve()
            : new Promise(res => { img.onload = res; img.onerror = res; })
    );
    const espFonts  = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    const seguridad = new Promise(res => setTimeout(res, 3000)); // nunca colgar
    return Promise.race([Promise.all([...espImgs, espFonts]), seguridad]);
}

const _OPC_HTML2CANVAS = { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false };

/** Descarga el PDF de la factura sin cabeceras del navegador. */
async function descargarFacturaPDF() {
    const numFactura = document.getElementById('factNumero').innerText;
    const area       = document.getElementById('facturaAreaImpresion');
    const noPrints   = document.querySelectorAll('.no-print');

    area.classList.add('factura-pdf-limpia');
    noPrints.forEach(el => el.style.display = 'none');
    document.getElementById('printClienteNombre').style.display = 'block';

    const _restaurar = () => {
        area.classList.remove('factura-pdf-limpia');
        noPrints.forEach(el => el.style.display = '');
        document.getElementById('printClienteNombre').style.display = 'none';
    };

    try {
        await _esperarRecursosFactura(area);
        await html2pdf().set({
            margin:      10,
            filename:    `Factura-${numFactura}.pdf`,
            image:       { type: 'jpeg', quality: 0.98 },
            html2canvas: _OPC_HTML2CANVAS,
            jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).from(area).save();
    } catch (e) {
        alert('❌ No se pudo generar el PDF (' + (e && e.message ? e.message : e) + '). Inténtalo de nuevo; si persiste, prueba con otro navegador.');
    } finally {
        _restaurar();
    }
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

    const _restaurar = () => {
        area.classList.remove('factura-pdf-limpia');
        noPrints.forEach(el => el.style.display = '');
        document.getElementById('printClienteNombre').style.display = 'none';
    };

    let pdfDataUrl;
    try {
        await _esperarRecursosFactura(area);
        pdfDataUrl = await html2pdf().set({
            margin:      10,
            filename:    `Factura-${numFactura}.pdf`,
            image:       { type: 'jpeg', quality: 0.98 },
            html2canvas: _OPC_HTML2CANVAS,
            jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).from(area).outputPdf('datauristring');
    } catch (e) {
        _restaurar();
        alert('❌ No se pudo generar el PDF: ' + (e && e.message ? e.message : e));
        return;
    }
    _restaurar();

    {
        await API.post('/api/enviar-factura', {
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
    }
}
