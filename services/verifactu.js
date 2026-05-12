// ─────────────────────────────────────────────────────────────────────────────
//  Servicio VeriFactu — envío telemático AEAT
//  Spec: Reglamento RD 1007/2023 (sistemas SIF) + ResolucionTGI 28/10/2024
//  Endpoint pruebas:    https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP
//  Endpoint producción: https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP
//
//  Variables de entorno requeridas:
//    AEAT_CERT_PATH         Ruta al .p12/.pfx (alternativa: AEAT_CERT_BASE64)
//    AEAT_CERT_BASE64       Cert .p12 codificado base64 (para Render)
//    AEAT_CERT_PASSWORD     Contraseña del .p12
//    AEAT_ENV               'pruebas' | 'produccion'  (default: pruebas)
//    NIF_EMISOR             NIF de la empresa emisora (sin guion)
//    NOMBRE_EMISOR          Razón social
// ─────────────────────────────────────────────────────────────────────────────

const fs       = require('fs');
const crypto   = require('crypto');
const https    = require('https');
const axios    = require('axios');
const forge    = require('node-forge');
const { create } = require('xmlbuilder2');
const { db }   = require('../config/db');

const NIF_EMISOR     = (process.env.NIF_EMISOR || 'B26892760').replace(/-/g, '').toUpperCase();
const NOMBRE_EMISOR  = process.env.NOMBRE_EMISOR || 'ServiPlusUltra Solutions S.L.';
const AEAT_ENV       = (process.env.AEAT_ENV || 'pruebas').toLowerCase();
const AEAT_ENDPOINT  = AEAT_ENV === 'produccion'
    ? 'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP'
    : 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP';

let _httpsAgent = null;

/** Carga certificado .p12 → devuelve { key, cert } en PEM, cacheado. */
function _cargarCertificado() {
    if (_httpsAgent) return _httpsAgent;

    const pwd = process.env.AEAT_CERT_PASSWORD || '';
    let p12Buffer;

    if (process.env.AEAT_CERT_BASE64) {
        p12Buffer = Buffer.from(process.env.AEAT_CERT_BASE64, 'base64');
    } else if (process.env.AEAT_CERT_PATH) {
        p12Buffer = fs.readFileSync(process.env.AEAT_CERT_PATH);
    } else {
        throw new Error('Falta AEAT_CERT_PATH o AEAT_CERT_BASE64');
    }

    const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
    const p12     = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, pwd);

    // Extraer clave privada
    const keyBags  = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBag   = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0]
                   || p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag][0];
    const privKey  = forge.pki.privateKeyToPem(keyBag.key);

    // Cadena de certificados
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certPem  = certBags[forge.pki.oids.certBag]
        .map(b => forge.pki.certificateToPem(b.cert))
        .join('\n');

    _httpsAgent = new https.Agent({
        cert: certPem,
        key:  privKey,
        rejectUnauthorized: AEAT_ENV === 'produccion'
    });
    return _httpsAgent;
}

// ── Cadena de huellas ─────────────────────────────────────────────────────────

/**
 * Calcula la huella SHA-256 de un RegistroAlta según anexo de la Resolución.
 * Campos concatenados separados por '&', con clave=valor:
 *   IDEmisorFactura=...&NumSerieFactura=...&FechaExpedicionFactura=...&
 *   TipoFactura=...&CuotaTotal=...&ImporteTotal=...&Huella=<huella anterior>&
 *   FechaHoraHusoGenRegistro=...
 */
function calcularHuella(reg) {
    const cadena =
        `IDEmisorFactura=${reg.IDEmisorFactura}` +
        `&NumSerieFactura=${reg.NumSerieFactura}` +
        `&FechaExpedicionFactura=${reg.FechaExpedicionFactura}` +
        `&TipoFactura=${reg.TipoFactura}` +
        `&CuotaTotal=${reg.CuotaTotal}` +
        `&ImporteTotal=${reg.ImporteTotal}` +
        `&Huella=${reg.HuellaAnterior || ''}` +
        `&FechaHoraHusoGenRegistro=${reg.FechaHoraHusoGenRegistro}`;
    return crypto.createHash('sha256').update(cadena, 'utf8').digest('hex').toUpperCase();
}

/** Recupera la última factura enviada (para encadenar huella). */
async function _ultimaHuella() {
    const { rows } = await db.execute(`
        SELECT aeat_huella FROM facturas
        WHERE aeat_huella IS NOT NULL AND aeat_estado IN ('ACEPTADO','PARCIAL')
        ORDER BY id DESC LIMIT 1
    `);
    return rows[0]?.aeat_huella || '';
}

// ── XML RegistroAlta ──────────────────────────────────────────────────────────

/**
 * Convierte fecha ISO (YYYY-MM-DD) a formato AEAT (DD-MM-YYYY).
 */
function _fechaAEAT(iso) {
    const [y, m, d] = (iso || '').split('-');
    return `${d}-${m}-${y}`;
}

/** Formato AEAT FechaHoraHusoGenRegistro: ISO 8601 con offset, ej 2026-05-08T12:34:56+02:00 */
function _ahoraISO() {
    const d = new Date();
    const tz = -d.getTimezoneOffset();
    const sign = tz >= 0 ? '+' : '-';
    const hh = String(Math.floor(Math.abs(tz)/60)).padStart(2,'0');
    const mm = String(Math.abs(tz)%60).padStart(2,'0');
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}:${mm}`;
}

/**
 * Construye el SOAP envelope completo con un RegistroAlta dentro de RegFactuSistemaFacturacion.
 * factura = { numero_factura, fecha_emision (YYYY-MM-DD), base_imponible, iva, total, lineas (JSON) }
 * cliente = { nombre, nif } (puede ser null para 'Consumidor Final' → IDOtro tipo 07 + ID generico)
 */
function buildXMLAlta(factura, cliente, huellaAnterior) {
    const fechaExp = _fechaAEAT(factura.fecha_emision);
    const fechaGen = _ahoraISO();

    const reg = {
        IDEmisorFactura: NIF_EMISOR,
        NumSerieFactura: factura.numero_factura,
        FechaExpedicionFactura: fechaExp,
        TipoFactura: 'F1',
        CuotaTotal: parseFloat(factura.iva || 0).toFixed(2),
        ImporteTotal: parseFloat(factura.total || 0).toFixed(2),
        HuellaAnterior: huellaAnterior || '',
        FechaHoraHusoGenRegistro: fechaGen
    };
    const huella = calcularHuella(reg);

    // Datos destinatario
    const destinatarioXml = cliente && cliente.nif
        ? {
            NombreRazon: cliente.nombre || '',
            NIF: String(cliente.nif).replace(/[^A-Z0-9]/gi, '').toUpperCase()
          }
        : null;

    const sf  = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd';
    const sum = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd';

    const obj = {
        'soapenv:Envelope': {
            '@xmlns:soapenv': 'http://schemas.xmlsoap.org/soap/envelope/',
            '@xmlns:sum':     sum,
            '@xmlns:sf':      sf,
            'soapenv:Header': {},
            'soapenv:Body': {
                'sum:RegFactuSistemaFacturacion': {
                    'sum:Cabecera': {
                        'sf:ObligadoEmision': {
                            'sf:NombreRazon': NOMBRE_EMISOR,
                            'sf:NIF':         NIF_EMISOR
                        }
                    },
                    'sum:RegistroFactura': {
                        'sf:RegistroAlta': {
                            'sf:IDVersion': '1.0',
                            'sf:IDFactura': {
                                'sf:IDEmisorFactura':         NIF_EMISOR,
                                'sf:NumSerieFactura':         factura.numero_factura,
                                'sf:FechaExpedicionFactura':  fechaExp
                            },
                            'sf:NombreRazonEmisor': NOMBRE_EMISOR,
                            'sf:TipoFactura':       'F1',
                            'sf:DescripcionOperacion': (factura.descripcion || `Factura ${factura.numero_factura}`).substring(0, 500),
                            ...(destinatarioXml ? {
                                'sf:Destinatarios': {
                                    'sf:IDDestinatario': {
                                        'sf:NombreRazon': destinatarioXml.NombreRazon,
                                        'sf:NIF':         destinatarioXml.NIF
                                    }
                                }
                            } : {}),
                            'sf:Desglose': {
                                'sf:DetalleDesglose': {
                                    'sf:Impuesto':            '01', // IVA
                                    'sf:ClaveRegimen':        '01', // Operación general
                                    'sf:CalificacionOperacion':'S1',
                                    'sf:TipoImpositivo':      '21',
                                    'sf:BaseImponibleOimporteNoSujeto': parseFloat(factura.base_imponible || 0).toFixed(2),
                                    'sf:CuotaRepercutida':    parseFloat(factura.iva || 0).toFixed(2)
                                }
                            },
                            'sf:CuotaTotal':   reg.CuotaTotal,
                            'sf:ImporteTotal': reg.ImporteTotal,
                            'sf:Encadenamiento': huellaAnterior
                                ? { 'sf:RegistroAnterior': {
                                        'sf:IDEmisorFactura':        NIF_EMISOR,
                                        'sf:NumSerieFactura':        '__PREV__', // se deja informativo; AEAT exige campo
                                        'sf:FechaExpedicionFactura': '__PREV__',
                                        'sf:Huella':                 huellaAnterior
                                    } }
                                : { 'sf:PrimerRegistro': 'S' },
                            'sf:SistemaInformatico': {
                                'sf:NombreRazon':      NOMBRE_EMISOR,
                                'sf:NIF':              NIF_EMISOR,
                                'sf:NombreSistemaInformatico': 'ServiPlusUltra ERP',
                                'sf:IdSistemaInformatico':     '01',
                                'sf:Version':                  '2.0',
                                'sf:NumeroInstalacion':        '0001',
                                'sf:TipoUsoPosibleSoloVerifactu': 'S',
                                'sf:TipoUsoPosibleMultiOT':       'N',
                                'sf:IndicadorMultiplesOT':        'N'
                            },
                            'sf:FechaHoraHusoGenRegistro': fechaGen,
                            'sf:TipoHuella': '01', // SHA-256
                            'sf:Huella':     huella
                        }
                    }
                }
            }
        }
    };

    const xml = create({ version: '1.0', encoding: 'UTF-8' }, obj).end({ prettyPrint: false });
    return { xml, huella };
}

// ── Envío SOAP ────────────────────────────────────────────────────────────────

/** Envía a AEAT y devuelve { ok, csv, estado, error, respuesta }. */
async function enviarAEAT(xml) {
    const agent = _cargarCertificado();
    try {
        const resp = await axios.post(AEAT_ENDPOINT, xml, {
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction':   ''
            },
            httpsAgent: agent,
            timeout:    30000,
            transformResponse: r => r
        });
        const body = resp.data || '';
        // Extraer CSV y estado del XML respuesta (parseo ligero)
        const csv      = (body.match(/<.*?CSV.*?>([^<]+)</)            || [])[1] || null;
        const estadoR  = (body.match(/<.*?EstadoRegistro.*?>([^<]+)</) || [])[1] || null;
        const estadoE  = (body.match(/<.*?EstadoEnvio.*?>([^<]+)</)    || [])[1] || null;
        const errMsg   = (body.match(/<.*?DescripcionErrorRegistro.*?>([^<]+)</) || [])[1] || null;
        // Normaliza términos AEAT (Correcto/Incorrecto/AceptadoConErrores) → ACEPTADO/RECHAZADO/PARCIAL
        const raw = estadoR || estadoE || '';
        let estado = 'ERROR';
        if (/correcto/i.test(raw) && !/incorrecto/i.test(raw)) estado = 'ACEPTADO';
        else if (/aceptado.*error/i.test(raw))                  estado = 'PARCIAL';
        else if (/incorrecto|rechaz/i.test(raw))                estado = 'RECHAZADO';
        else if (raw)                                           estado = raw.toUpperCase();
        return { ok: estado === 'ACEPTADO' && !errMsg, csv, estado, error: errMsg, respuesta: body };
    } catch (e) {
        const respuesta = e.response?.data || e.message;
        return { ok: false, csv: null, estado: 'ERROR', error: e.message, respuesta };
    }
}

// ── Flujo público ─────────────────────────────────────────────────────────────

/**
 * Envía una factura ya insertada en BBDD a AEAT.
 * Actualiza facturas.aeat_* con el resultado.
 * No lanza errores: registra el fallo para reintento posterior.
 */
async function enviarFactura(facturaId) {
    // Feature flag: VeriFactu no es obligatorio hasta 2027.
    // Para activar pon VERIFACTU_ENABLED=true en variables de entorno.
    if (process.env.VERIFACTU_ENABLED !== 'true') {
        return { ok: false, estado: 'DESACTIVADO', error: null };
    }
    try {
        const { rows } = await db.execute({
            sql: `SELECT f.*, c.nombre AS cliente_nombre, c.nif AS cliente_nif
                  FROM facturas f
                  LEFT JOIN ordenes_trabajo ot ON ot.id = f.ot_id
                  LEFT JOIN presupuestos    p  ON p.id  = f.presupuesto_id
                  LEFT JOIN clientes c ON c.id = COALESCE(ot.cliente_id, p.cliente_id)
                  WHERE f.id = ?`,
            args: [facturaId]
        });
        if (!rows[0]) return { ok: false, error: 'Factura no encontrada' };
        const f = rows[0];

        const huellaAnterior = await _ultimaHuella();
        const cliente = f.cliente_nif ? { nombre: f.cliente_nombre, nif: f.cliente_nif } : null;
        const { xml, huella } = buildXMLAlta(f, cliente, huellaAnterior);

        const result = await enviarAEAT(xml);

        await db.execute({
            sql: `UPDATE facturas SET
                    aeat_huella = ?,
                    aeat_huella_anterior = ?,
                    aeat_estado = ?,
                    aeat_csv = ?,
                    aeat_fecha_envio = ?,
                    aeat_error = ?,
                    aeat_intentos = COALESCE(aeat_intentos,0) + 1,
                    aeat_xml_enviado = ?,
                    aeat_respuesta = ?
                  WHERE id = ?`,
            args: [
                huella, huellaAnterior || null,
                result.estado || 'ERROR',
                result.csv,
                new Date().toISOString(),
                result.error,
                xml.substring(0, 16000),
                (result.respuesta || '').toString().substring(0, 16000),
                facturaId
            ]
        });

        return { ok: result.ok, estado: result.estado, csv: result.csv, error: result.error };
    } catch (e) {
        try {
            await db.execute({
                sql: `UPDATE facturas SET aeat_estado='ERROR', aeat_error=?, aeat_intentos=COALESCE(aeat_intentos,0)+1 WHERE id=?`,
                args: [e.message, facturaId]
            });
        } catch (_) {}
        return { ok: false, error: e.message };
    }
}

module.exports = { enviarFactura, calcularHuella, buildXMLAlta };
