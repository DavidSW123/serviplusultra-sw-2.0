// ── ESCÁNER IA ───────────────────────────────────────────────

function abrirEscanerIA() {
    cerrarModal('modalTickets');
    document.getElementById('ia_loading').style.display = 'none';
    document.getElementById('ia_file').value = '';
    abrirModal('modalEscanerIA');
}

function ejecutarEscaneoIA(input) {
    if (!input.files[0]) return;
    const loading = document.getElementById('ia_loading');
    loading.style.display = 'block';

    comprimirImagen(input.files[0], (b64) => {
        API.post('/api/ia/escanear-ticket', { imagenBase64: b64 })
            .then(data => {
                loading.style.display = 'none';
                if (data.error) { alert('❌ Error de IA: ' + data.error); return; }
                alert('✅ ¡Ticket leído por Inteligencia Artificial!');
                cerrarModal('modalEscanerIA');

                modoEdicionOT = otActualId;
                arrayLineasMat = [];
                document.getElementById('contenedorLineasMat').innerHTML = '';
                document.getElementById('totalMaterialesCalc').innerText  = '0.00';

                if (data.lineas && data.lineas.length > 0) {
                    data.lineas.forEach(linea => {
                        const idLinea = counterLineas++;
                        arrayLineasMat.push({
                            id:          idLinea,
                            is_stock:    false,
                            stock_id:    '',
                            descripcion: linea.descripcion || 'Material IA',
                            cantidad:    linea.cantidad || 1,
                            precio:      (linea.precio / (linea.cantidad || 1)).toFixed(2),
                            importe:     linea.precio || 0,
                            imagen:      b64
                        });
                    });
                } else {
                    addLineaMaterial();
                }

                renderizarLineasMateriales();
                abrirModal('modalLineasMateriales');
                document.getElementById('totalMaterialesCalc').innerText =
                    arrayLineasMat.reduce((acc, curr) => acc + curr.importe, 0).toFixed(2);
            })
            .catch(() => { loading.style.display = 'none'; alert('❌ Fallo de conexión con la IA.'); });
    });
}
