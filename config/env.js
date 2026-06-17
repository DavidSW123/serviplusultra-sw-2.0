/**
 * Validación centralizada de variables de entorno.
 *
 * Las variables OBLIGATORIAS hacen que el servidor falle al arrancar si faltan
 * (fail-fast): es preferible no arrancar a arrancar con secretos hardcodeados o
 * con una configuración a medias.
 */
require('dotenv').config();

function requerida(nombre) {
    const v = process.env[nombre];
    if (!v || !v.trim()) {
        console.error(`❌ Falta la variable de entorno OBLIGATORIA: ${nombre}`);
        console.error('   Configúrala en Render (Environment) o en tu archivo .env local.');
        process.exit(1);
    }
    return v.trim();
}

function opcional(nombre, porDefecto) {
    const v = process.env[nombre];
    return (v && v.trim()) ? v.trim() : porDefecto;
}

module.exports = {
    TURSO_DATABASE_URL: requerida('TURSO_DATABASE_URL'),
    TURSO_AUTH_TOKEN:   requerida('TURSO_AUTH_TOKEN'),
    GOOGLE_SCRIPT_URL:  requerida('GOOGLE_SCRIPT_URL'),
    JWT_SECRET:         requerida('JWT_SECRET'),
    APP_ORIGIN:         opcional('APP_ORIGIN', 'https://serviplusultra-sw-2-0.onrender.com'),
    PORT:               opcional('PORT', '3000')
};
