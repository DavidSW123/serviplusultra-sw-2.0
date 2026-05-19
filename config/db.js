require('dotenv').config();
const { createClient } = require('@libsql/client');

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
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
            implicados TEXT DEFAULT 'Giancarlo,David,Kevin'
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
            `ALTER TABLE gastos_socios ADD COLUMN implicados TEXT DEFAULT 'Giancarlo,David,Kevin'`,
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
            // VeriFactu / AEAT
            `ALTER TABLE facturas ADD COLUMN aeat_huella TEXT`,
            `ALTER TABLE facturas ADD COLUMN aeat_huella_anterior TEXT`,
            `ALTER TABLE facturas ADD COLUMN aeat_estado TEXT DEFAULT 'PENDIENTE'`,
            `ALTER TABLE facturas ADD COLUMN aeat_csv TEXT`,
            `ALTER TABLE facturas ADD COLUMN aeat_fecha_envio TEXT`,
            `ALTER TABLE facturas ADD COLUMN aeat_error TEXT`,
            `ALTER TABLE facturas ADD COLUMN aeat_intentos INTEGER DEFAULT 0`,
            `ALTER TABLE facturas ADD COLUMN aeat_xml_enviado TEXT`,
            `ALTER TABLE facturas ADD COLUMN aeat_respuesta TEXT`,
            // Rectificativas
            `ALTER TABLE facturas ADD COLUMN es_rectificativa INTEGER DEFAULT 0`,
            `ALTER TABLE facturas ADD COLUMN factura_rectificada_id INTEGER`,
            `ALTER TABLE facturas ADD COLUMN motivo_rectificacion TEXT`,
            `ALTER TABLE facturas ADD COLUMN rectificada_por_id INTEGER`,
            // Solicitud de eliminación pendiente de aprobación admin (para facturas protegidas)
            `ALTER TABLE facturas ADD COLUMN eliminacion_pendiente INTEGER DEFAULT 0`
        ];
        for (const sql of migraciones) {
            try { await db.execute(sql); } catch (_) { /* columna ya existe, ok */ }
        }

        // --- LIMPIEZA: facturas huérfanas (sin OT ni presupuesto vivo) ---
        // Liberan sus números para que el gap-fill los reasigne.
        try {
            const { rows: huerfanas } = await db.execute(`
                SELECT f.id, f.numero_factura
                FROM facturas f
                LEFT JOIN ordenes_trabajo ot ON ot.id = f.ot_id
                LEFT JOIN presupuestos    p  ON p.id  = f.presupuesto_id
                WHERE (f.ot_id IS NULL OR ot.id IS NULL)
                  AND (f.presupuesto_id IS NULL OR p.id IS NULL)
            `);
            for (const h of huerfanas) {
                await db.execute({ sql: `DELETE FROM facturas WHERE id=?`, args: [h.id] });
                console.log(`🧹 Factura huérfana ${h.numero_factura || h.id} eliminada (número liberado)`);
            }
        } catch (_) { /* tabla aún no inicializada, ok */ }

        // --- SEED: usuario admin por defecto si la tabla está vacía ---
        const { rows } = await db.execute("SELECT count(*) as count FROM usuarios");
        if (rows[0].count === 0) {
            await db.execute(`
                INSERT INTO usuarios (username, password, rol)
                VALUES ('Giancarlo', 'gian123', 'admin'),
                       ('David',     'dav123',  'admin'),
                       ('Kevin',     'kev123',  'director')
            `);
        }

        console.log('✅ Base de datos Turso conectada y operativa.');
    } catch (error) {
        console.error('❌ Error inicializando DB:', error);
        process.exit(1); // Si la DB falla al arrancar, no tiene sentido continuar
    }
}

module.exports = { db, inicializarDB };
