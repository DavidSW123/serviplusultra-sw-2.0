// ── STOCK / MATERIALES ───────────────────────────────────────

function cargarStock() {
    API.get('/api/stock').then(data => {
        stockGlobal = data;
        const tbody = document.getElementById('tablaStockBody');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">El almacén está vacío.</td></tr>';
            return;
        }
        data.forEach(s => {
            const icon     = s.imagen ? `<a href="${s.imagen}" target="_blank" title="Ver Ticket">📄</a>` : '-';
            const rowClass = s.cantidad <= 0 ? 'background:#fdedec; color:#e74c3c;' : '';
            tbody.innerHTML += `<tr style="${rowClass}">
                <td><strong>${s.descripcion}</strong></td>
                <td>${s.cantidad} uds</td>
                <td>${s.precio_unidad.toFixed(2)} €</td>
                <td style="text-align:center; font-size:1.2em;">${icon}</td>
            </tr>`;
        });
    });
}

function abrirModuloStock() { cargarStock(); abrirModal('modalStock'); }

document.getElementById('formStock').addEventListener('submit', function(e) {
    e.preventDefault();
    const desc   = document.getElementById('s_desc').value;
    const cant   = parseFloat(document.getElementById('s_cant').value);
    const precio = parseFloat(document.getElementById('s_precio').value);
    const file   = document.getElementById('s_file').files[0];
    const pUnit  = (precio / cant).toFixed(2);
    const enviar = (imgB64) => {
        API.post('/api/stock', { descripcion: desc, cantidad: cant, precio_unidad: pUnit, imagen: imgB64 })
            .then(d => {
                if (d.error) alert('❌ ' + d.error);
                else { alert('✅ ' + d.mensaje); document.getElementById('formStock').reset(); cargarStock(); }
            });
    };
    if (file) comprimirImagen(file, enviar); else enviar('');
});

// ── LÍNEAS DE MATERIALES (selector en OT) ───────────────────

let arrayLineasMat = [];
let counterLineas  = 0;
let modoEdicionOT  = null;

function preguntarMateriales(e) {
    e.preventDefault();
    modoEdicionOT = null;
    if (tecnicosSeleccionados.length === 0) { alert('❌ Debes asignar al menos a un técnico.'); return; }
    const codigo   = document.getElementById('codigo_ot').value;
    const fechaEn  = document.getElementById('fecha_encargo').value;
    const fechaCo  = document.getElementById('fecha_completada').value;
    if (!validarFormulario(codigo, fechaEn, fechaCo)) return;
    abrirModal('modalPreguntaMateriales');
}

function abrirEditorMateriales() {
    cerrarModal('modalPreguntaMateriales');
    arrayLineasMat = [];
    document.getElementById('contenedorLineasMat').innerHTML = '';
    document.getElementById('totalMaterialesCalc').innerText = '0.00';
    addLineaMaterial();
    abrirModal('modalLineasMateriales');
}

function abrirGestorMaterialesDesdeEdicion() {
    cerrarModal('modalEditarOT');
    abrirTicketsOT(otActualId, document.getElementById('ed_codigo_ot').value);
}

function abrirGestorMaterialesEdicion() {
    cerrarModal('modalTickets');
    modoEdicionOT = otActualId;
    arrayLineasMat = [];
    document.getElementById('contenedorLineasMat').innerHTML = '';
    document.getElementById('totalMaterialesCalc').innerText = '0.00';
    addLineaMaterial();
    abrirModal('modalLineasMateriales');
}

function addLineaMaterial() {
    const id = counterLineas++;
    arrayLineasMat.push({ id, is_stock: false, stock_id: '', descripcion: '', cantidad: 1, precio: 0, importe: 0, imagen: '' });
    renderizarLineasMateriales();
}

function borrarLineaMaterial(id) {
    arrayLineasMat = arrayLineasMat.filter(l => l.id !== id);
    renderizarLineasMateriales();
}

function onChangeLinea(id, campo, valor) {
    const linea = arrayLineasMat.find(l => l.id === id);
    if (!linea) return;
    if (campo === 'is_stock') {
        linea.is_stock = valor; linea.descripcion = ''; linea.stock_id = ''; linea.precio = 0; linea.imagen = '';
    } else if (campo === 'stock_id') {
        linea.stock_id = valor;
        const sItem = stockGlobal.find(s => s.id == valor);
        if (sItem) { linea.descripcion = sItem.descripcion; linea.precio = sItem.precio_unidad; }
    } else {
        linea[campo] = (campo === 'cantidad' || campo === 'precio') ? parseFloat(valor) || 0 : valor;
    }
    linea.importe = linea.cantidad * linea.precio;
    document.getElementById('totalMaterialesCalc').innerText = arrayLineasMat.reduce((a, c) => a + c.importe, 0).toFixed(2);
    if (campo === 'is_stock' || campo === 'stock_id') renderizarLineasMateriales();
}

function handleFileSelect(id, fileInput) {
    if (!fileInput.files[0]) return;
    comprimirImagen(fileInput.files[0], (b64) => {
        const linea = arrayLineasMat.find(l => l.id === id);
        if (linea) { linea.imagen = b64; alert('✅ Foto guardada en la línea'); }
    });
}

function renderizarLineasMateriales() {
    const cont = document.getElementById('contenedorLineasMat');
    cont.innerHTML = '';
    arrayLineasMat.forEach(l => {
        let opcionesStock = '<option value="">-- Elige del almacén --</option>';
        stockGlobal.forEach(s => { if (s.cantidad > 0) opcionesStock += `<option value="${s.id}">${s.descripcion} (${s.cantidad} disp.)</option>`; });
        const htmlDesc = l.is_stock
            ? `<select onchange="onChangeLinea(${l.id}, 'stock_id', this.value)" required>${opcionesStock}</select>`
            : `<input type="text" placeholder="Ej: Rollo Cable..." value="${l.descripcion}" oninput="onChangeLinea(${l.id}, 'descripcion', this.value)" required>`;
        const htmlFoto = l.is_stock
            ? `<small style="color:#27ae60; font-weight:bold;">Stock descontado auto.</small>`
            : `<input type="file" accept="image/*" capture="environment" onchange="handleFileSelect(${l.id}, this)">`;
        const extraImg = l.imagen && !l.is_stock ? `<br><small style="color:#8e44ad;">📸 Ticket IA / Foto adjunta</small>` : '';

        cont.innerHTML += `<div class="linea-mat">
            <button class="eliminar-linea" onclick="borrarLineaMaterial(${l.id})">X</button>
            <div style="margin-bottom:10px;">
                <label style="display:inline-flex; align-items:center; gap:5px; font-weight:normal; cursor:pointer;">
                    <input type="checkbox" ${l.is_stock ? 'checked' : ''} onchange="onChangeLinea(${l.id}, 'is_stock', this.checked)"> Usar material existente del Stock
                </label>
            </div>
            <div class="grid-linea">
                <div><label>Descripción</label>${htmlDesc}</div>
                <div><label>Cant.</label><input type="number" step="0.01" value="${l.cantidad}" oninput="onChangeLinea(${l.id}, 'cantidad', this.value); document.getElementById('tot_${l.id}').innerText=(this.value*${l.precio}).toFixed(2)" required></div>
                <div><label>Precio/U (€)</label><input type="number" step="0.01" value="${l.precio}" ${l.is_stock ? 'readonly' : ''} oninput="onChangeLinea(${l.id}, 'precio', this.value); document.getElementById('tot_${l.id}').innerText=(this.value*${l.cantidad}).toFixed(2)" required></div>
                <div><label>Total (€)</label><strong id="tot_${l.id}">${l.importe.toFixed(2)}</strong></div>
            </div>
            <div style="margin-top:10px;">${htmlFoto} ${extraImg}</div>
        </div>`;
        if (l.is_stock && l.stock_id) {
            setTimeout(() => { const sels = cont.querySelectorAll('select'); sels[sels.length - 1].value = l.stock_id; }, 10);
        }
    });
}

let _datosOTPendientes = null;
let _otTieneMateriales = false;

function guardarOTFinal(tieneMateriales) {
    if (modoEdicionOT) {
        if (!tieneMateriales) { cerrarModal('modalPreguntaMateriales'); return; }
        if (arrayLineasMat.length === 0) { alert('❌ No hay líneas.'); return; }
        for (const l of arrayLineasMat) {
            if (l.is_stock && !l.stock_id)   { alert('❌ Elige un material del stock.'); return; }
            if (!l.is_stock && !l.descripcion) { alert('❌ Pon descripción en las líneas.'); return; }
        }
        API.post(`/api/ot/${modoEdicionOT}/lineas_materiales`, { lineas_materiales: arrayLineasMat })
            .then(data => {
                if (data.error) alert('❌ ' + data.error);
                else { alert('✅ ' + data.mensaje); cerrarModal('modalLineasMateriales'); cargarOTs(); cargarStock(); abrirTicketsOT(otActualId, otActualCodigo); }
            });
        return;
    }
    if (tieneMateriales) {
        if (arrayLineasMat.length === 0) { alert('❌ No hay líneas de materiales.'); return; }
        for (const l of arrayLineasMat) {
            if (l.is_stock && !l.stock_id)   { alert('❌ Elige un material del stock.'); return; }
            if (!l.is_stock && !l.descripcion) { alert('❌ Pon descripción en las líneas.'); return; }
        }
    } else {
        arrayLineasMat = [];
        cerrarModal('modalPreguntaMateriales');
    }

    _datosOTPendientes = {
        codigo_ot:        document.getElementById('codigo_ot').value,
        fecha_encargo:    document.getElementById('fecha_encargo').value,
        fecha_completada: document.getElementById('fecha_completada').value,
        horas:            parseFloat(document.getElementById('horas').value),
        num_tecnicos:     tecnicosSeleccionados.length,
        tecnicos_nombres: tecnicosSeleccionados.join(', '),
        marca:            document.getElementById('marca').value,
        tipo_urgencia:    document.getElementById('tipo_urgencia').value,
        cliente_id:       document.getElementById('ot_cliente_id').value || null,
        lineas_materiales: arrayLineasMat
    };
    _otTieneMateriales = tieneMateriales;

    // Solo admin y director eligen el precio/hora; técnicos usan 15 € por defecto
    if (sesion.rol === 'admin' || sesion.rol === 'director') {
        document.getElementById('inputPrecioHora').value = 15;
        if (tieneMateriales) cerrarModal('modalLineasMateriales');
        document.getElementById('modalPrecioHora').style.display = 'block';
    } else {
        _enviarOT(15);
    }
}

function confirmarPrecioHora(precio) {
    document.getElementById('modalPrecioHora').style.display = 'none';
    _enviarOT(parseFloat(precio) || 15);
}

function _enviarOT(precioHora) {
    const datos = Object.assign({}, _datosOTPendientes, { precio_hora: precioHora });
    API.post('/api/ot', datos).then(data => {
        if (data.error) alert('❌ ' + data.error);
        else {
            alert('ℹ️ ' + data.mensaje);
            document.getElementById('formOT').reset();
            tecnicosSeleccionados = []; renderizarTecnicosOT();
            cargarOTs(); cargarStock();
        }
    });
}
