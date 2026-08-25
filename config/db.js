const env = require('./env');
const { createClient } = require('@libsql/client');

const db = createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN
});

async function inicializarDB() {
    try {
        // --- TABLAS CORE ---
        await db.execute(`CREATE TABLE IF NOT EXISTS usuarios (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            rol      TEXT NOT NULL,
            foto     TEXT DEFAULT ''
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS clientes (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre    TEXT NOT NULL,
            nif       TEXT,
            direccion TEXT,
            email     TEXT,
            telefono  TEXT,
            logo      TEXT,
            estado    TEXT DEFAULT 'PENDIENTE'
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS ordenes_trabajo (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo_ot        TEXT UNIQUE NOT NULL,
            fecha_encargo    TEXT,
            fecha_completada TEXT,
            horas            REAL,
            num_tecnicos     INTEGER,
            marca            TEXT,
            tipo_urgencia    TEXT,
            materiales_precio REAL,
            estado           TEXT DEFAULT 'PENDIENTE',
            cliente_id       INTEGER,
            tecnicos_nombres TEXT DEFAULT ''
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS ot_adjuntos (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ot_id       INTEGER,
            imagen      TEXT NOT NULL,
            importe     REAL DEFAULT 0,
            descripcion TEXT,
            fecha       TEXT
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS facturas (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            ot_id          INTEGER,
            base_imponible REAL,
            iva            REAL,
            total          REAL,
            qr_data        TEXT,
            fecha_emision  TEXT,
            FOREIGN KEY (ot_id) REFERENCES ordenes_trabajo (id)
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS gastos_socios (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            pagador   TEXT NOT NULL,
            concepto  TEXT,
            importe   REAL,
            fecha     TEXT,
            implicados TEXT DEFAULT 'Juliana,David,Guille'
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS stock_materiales (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            descripcion  TEXT NOT NULL,
            cantidad     REAL NOT NULL,
            precio_unidad REAL NOT NULL,
            imagen       TEXT,
            fecha        TEXT
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS logs (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario    TEXT,
            accion     TEXT,
            referencia TEXT,
            datos      TEXT,
            estado     TEXT,
            fecha      TEXT
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS presupuestos (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            referencia       TEXT UNIQUE NOT NULL,
            cliente_id       INTEGER,
            descripcion      TEXT,
            lineas           TEXT,
            base_imponible   REAL DEFAULT 0,
            iva              REAL DEFAULT 0,
            total            REAL DEFAULT 0,
            estado           TEXT DEFAULT 'BORRADOR',
            fecha_creacion   TEXT,
            fecha_envio      TEXT,
            notas            TEXT,
            FOREIGN KEY (cliente_id) REFERENCES clientes (id)
        )`);

        // --- MIGRACIONES SEGURAS (idempotentes) ---
        const migraciones = [
            `ALTER TABLE ordenes_trabajo ADD COLUMN cliente_id INTEGER`,
            `ALTER TABLE ordenes_trabajo ADD COLUMN tecnicos_nombres TEXT DEFAULT ''`,
            `ALTER TABLE gastos_socios ADD COLUMN implicados TEXT DEFAULT 'Juliana,David,Guille'`,
            `UPDATE usuarios SET rol = 'admin' WHERE username = 'David' AND rol = 'director'`,
            `ALTER TABLE ordenes_trabajo ADD COLUMN precio_hora REAL DEFAULT 15`,
            `ALTER TABLE facturas ADD COLUMN numero_factura TEXT`,
            `ALTER TABLE facturas ADD COLUMN lineas TEXT`,
            `ALTER TABLE facturas ADD COLUMN presupuesto_id INTEGER`,
            `ALTER TABLE presupuestos ADD COLUMN proforma_numero TEXT`,
            `ALTER TABLE presupuestos ADD COLUMN proforma_total REAL`,
            `ALTER TABLE presupuestos ADD COLUMN factura_final_numero TEXT`,
            `ALTER TABLE presupuestos ADD COLUMN ot_asociada_id INTEGER`,
            `ALTER TABLE presupuestos ADD COLUMN ot_asociada_codigo TEXT`,
            `ALTER TABLE facturas ADD COLUMN emails_enviados TEXT`,
            // Rectificativas
            `ALTER TABLE facturas ADD COLUMN es_rectificativa INTEGER DEFAULT 0`,
            `ALTER TABLE facturas ADD COLUMN factura_rectificada_id INTEGER`,
            `ALTER TABLE facturas ADD COLUMN motivo_rectificacion TEXT`,
            `ALTER TABLE facturas ADD COLUMN rectificada_por_id INTEGER`,
            // Solicitud de eliminación pendiente de aprobación admin (para facturas protegidas)
            `ALTER TABLE facturas ADD COLUMN eliminacion_pendiente INTEGER DEFAULT 0`,
            // Recuperación de contraseña con token de un solo uso
            `ALTER TABLE usuarios ADD COLUMN reset_token_hash TEXT`,
            `ALTER TABLE usuarios ADD COLUMN reset_token_expira TEXT`,
            // Fase 1 — Estados de factura: BORRADOR / EMITIDA / ANULADA
            `ALTER TABLE facturas ADD COLUMN estado TEXT`,
            `ALTER TABLE facturas ADD COLUMN emitida_en TEXT`,
            // Backfill idempotente: las facturas existentes ya estaban emitidas
            `UPDATE facturas SET estado='EMITIDA' WHERE estado IS NULL AND numero_factura IS NOT NULL`,
            `UPDATE facturas SET estado='BORRADOR' WHERE estado IS NULL AND numero_factura IS NULL`,
            `UPDATE facturas SET estado='ANULADA' WHERE rectificada_por_id IS NOT NULL AND estado='EMITIDA'`,
            // Índices de rendimiento: /api/ot hace subconsultas correlacionadas sobre
            // facturas por ot_id (sin índice tardaba ~8s; con índice ~0.3s).
            `CREATE INDEX IF NOT EXISTS idx_facturas_ot_id ON facturas(ot_id)`,
            `CREATE INDEX IF NOT EXISTS idx_facturas_rectificada_por ON facturas(rectificada_por_id)`,
            `CREATE INDEX IF NOT EXISTS idx_facturas_presupuesto_id ON facturas(presupuesto_id)`,
            `CREATE INDEX IF NOT EXISTS idx_ot_cliente_id ON ordenes_trabajo(cliente_id)`,
            // Quién realiza el trabajo a efectos de coste: 'Guille' / 'Jordi' (nómina de la
            // otra empresa, sin coste hora hoy) o 'Autonomo' (subcontratado, con precio pactado).
            `ALTER TABLE ordenes_trabajo ADD COLUMN tipo_trabajador TEXT`
        ];
        for (const sql of migraciones) {
            try { await db.execute(sql); } catch (_) { /* columna ya existe, ok */ }
        }

        // (Eliminado) La limpieza automática de facturas "huérfanas" en cada arranque
        // borraba documentos fiscales en cada deploy. Retirado por riesgo de pérdida
        // de datos y por incompatibilidad con la inmutabilidad de la numeración.

        // --- SEED: usuario admin por defecto si la tabla está vacía ---
        const { rows } = await db.execute("SELECT count(*) as count FROM usuarios");
        if (rows[0].count === 0) {
            const bcrypt = require('bcryptjs');
            const seed = [
                ['Juliana', 'Jul123', 'admin'],
                ['David',   'dav123', 'admin'],
                ['Guille',  'Gui123', 'director']
            ];
            for (const [u, p, r] of seed) {
                const hash = await bcrypt.hash(p, 12);
                await db.execute({ sql: `INSERT INTO usuarios (username, password, rol) VALUES (?, ?, ?)`, args: [u, hash, r] });
            }
        }

        console.log('✅ Base de datos Turso conectada y operativa.');
    } catch (error) {
        console.error('❌ Error inicializando DB:', error);
        process.exit(1); // Si la DB falla al arrancar, no tiene sentido continuar
    }
}

module.exports = { db, inicializarDB };
