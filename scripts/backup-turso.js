/**
 * Backup completo de la base de datos Turso a un archivo .sql restaurable.
 *
 * Uso:
 *   node scripts/backup-turso.js
 *
 * Lee TURSO_DATABASE_URL y TURSO_AUTH_TOKEN del .env. Genera un volcado con
 * el esquema (CREATE TABLE/INDEX) y todos los datos (INSERT) dentro de
 * /backups/turso-backup-<fecha>.sql. La carpeta /backups está en .gitignore.
 *
 * Restaurar (con la CLI de Turso o cualquier SQLite):
 *   turso db shell <db> < backups/turso-backup-XXXX.sql
 *   # o en sqlite local:  sqlite3 restaurada.db < backups/turso-backup-XXXX.sql
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const URL   = process.env.TURSO_DATABASE_URL;
const TOKEN = process.env.TURSO_AUTH_TOKEN;
if (!URL || !TOKEN) {
    console.error('❌ Faltan TURSO_DATABASE_URL / TURSO_AUTH_TOKEN en el entorno (.env).');
    process.exit(1);
}

const db = createClient({ url: URL, authToken: TOKEN });

/** Convierte un valor JS a su literal SQL seguro. */
function lit(v) {
    if (v === null || v === undefined)  return 'NULL';
    if (typeof v === 'bigint')          return v.toString();
    if (typeof v === 'number')          return Number.isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'boolean')         return v ? '1' : '0';
    if (v instanceof Uint8Array)        return "X'" + Buffer.from(v).toString('hex') + "'";
    return "'" + String(v).replace(/'/g, "''") + "'";
}

function sello() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

(async () => {
    const dir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const archivo = path.join(dir, `turso-backup-${sello()}.sql`);

    let salida = `-- Backup ServiPlusUltra Turso\n-- Generado: ${new Date().toISOString()}\n`;
    salida += 'PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n\n';

    // Esquema: tablas e índices definidos por el usuario
    const esquema = await db.execute(
        "SELECT type, name, sql FROM sqlite_master " +
        "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' " +
        "ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name"
    );

    const tablas = [];
    for (const obj of esquema.rows) {
        salida += `${obj.sql};\n`;
        if (obj.type === 'table') tablas.push(obj.name);
    }
    salida += '\n';

    // Datos
    let totalFilas = 0;
    for (const tabla of tablas) {
        const res = await db.execute(`SELECT * FROM "${tabla}"`);
        if (res.rows.length === 0) continue;
        const cols = res.columns;
        const colList = cols.map(c => `"${c}"`).join(', ');
        salida += `-- ${tabla} (${res.rows.length} filas)\n`;
        for (const fila of res.rows) {
            const vals = cols.map(c => lit(fila[c])).join(', ');
            salida += `INSERT INTO "${tabla}" (${colList}) VALUES (${vals});\n`;
        }
        salida += '\n';
        totalFilas += res.rows.length;
    }

    salida += 'COMMIT;\nPRAGMA foreign_keys=ON;\n';
    fs.writeFileSync(archivo, salida, 'utf8');

    const kb = (fs.statSync(archivo).size / 1024).toFixed(1);
    console.log(`✅ Backup creado: ${archivo}`);
    console.log(`   ${tablas.length} tablas · ${totalFilas} filas · ${kb} KB`);
})().catch(e => {
    console.error('❌ Error durante el backup:', e.message);
    process.exit(1);
});
