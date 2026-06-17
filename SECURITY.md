# Política de Seguridad — ServiPlusUltra ERP

## Reporte de vulnerabilidades

Si detectas una vulnerabilidad, **no abras un issue público**. Escribe a
**serviplusultrasolutionssl@gmail.com** con los detalles y, si es posible, pasos para reproducirla.
Se atenderá con prioridad.

## Medidas implementadas (Fase 0)

- **Autenticación**: sesión por JWT firmado en cookie `httpOnly`, `Secure` (bajo HTTPS) y `SameSite=Strict`. El usuario y el rol se derivan **solo** del token verificado en el servidor — nunca de cabeceras enviadas por el cliente.
- **Contraseñas**: almacenadas con hash `bcrypt` (coste 12). Migración perezosa desde texto plano en el primer inicio de sesión.
- **Autorización por rol**: middlewares `autenticado` / `soloAdmin` / `adminODirector`.
- **Cabeceras**: `helmet` (HSTS, `noSniff`, anti-clickjacking).
- **CORS**: restringido al origen propio (`APP_ORIGIN`).
- **Rate limiting**: límite global y límite estricto en `/api/login` y `/api/recuperar-password` (anti fuerza bruta).
- **Errores**: respuesta genérica con referencia al cliente; el detalle se registra solo en el servidor (no se filtran `e.message`, rutas ni estructura interna).
- **XSS**: escape de salida (`escapeHTML`) en las vistas; sin `e.message` ni HTML sin escapar en el render de datos de usuario.
- **Configuración**: variables de entorno con validación *fail-fast*; **sin secretos hardcodeados** en el código.
- **Datos**: backups de la base de datos restaurables (`scripts/backup-turso.js`).

## Buenas prácticas para el equipo

- No commitear nunca el archivo `.env` (está en `.gitignore`).
- Rotar `JWT_SECRET` y el endpoint del relay de email si se sospecha exposición.
- Mantener `npm audit` sin vulnerabilidades `high` (revisar en cada despliegue).
- No probar con datos reales en producción: usar borradores o un entorno de pruebas.
- Guardar copias de seguridad **fuera** de la máquina de trabajo.

## Endurecimiento pendiente

Ver [ROADMAP.md](ROADMAP.md): completar escape XSS en todos los módulos, recuperación de contraseña con token de un solo uso, CSP estricta, cifrado en reposo de datos sensibles (de cara a la integración bancaria), tests de seguridad y CI con `npm audit`.
