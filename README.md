# ServiPlusUltra ERP

ERP interno de **ServiPlusUltra Solutions S.L.** para la gestión de órdenes de trabajo, clientes, facturación, presupuestos, stock y contabilidad de una empresa de servicios técnicos.

Arquitectura modular sobre Node.js/Express con base de datos en la nube (Turso) y frontend en JavaScript vanilla. Desplegado en Render.

---

## ✨ Funcionalidades

- **Órdenes de Trabajo (OT)** — alta, edición, estados, técnicos, materiales/tickets y adjuntos.
- **Clientes (CRM)** — alta con aprobación por administrador, ficha y logo.
- **Facturación** — numeración correlativa anual (`XX-YYYYMMDD`), facturas **rectificativas** en serie propia (`R-NN-YYYYMMDD`), proforma/final desde presupuesto, PDF con QR y envío por email.
- **Presupuestos** — creación, edición, envío, conversión a OT y emisión de facturas.
- **Stock de materiales** — con descuento automático al consumir en OTs.
- **Escáner IA de tickets** — extracción de base imponible con Google Gemini.
- **Contabilidad** — panel con ingresos, costes y evolución.
- **Gastos entre socios** — estilo Splitwise.
- **Auditoría / Logs** — registro de acciones con flujo de aprobación de pendientes.

## 🧱 Stack

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express 5 (CommonJS) |
| Base de datos | Turso (libSQL / SQLite) vía `@libsql/client` |
| Autenticación | JWT en cookie `httpOnly` + `bcryptjs` |
| Seguridad HTTP | `helmet`, `cors` (allowlist), `express-rate-limit` |
| Frontend | HTML + CSS + JavaScript vanilla |
| PDF / Export | `html2pdf.js`, `xlsx` |
| IA | Google Gemini |
| Email | Google Apps Script (relay) |
| Despliegue | Render |

## 📁 Estructura

```
.
├── server.js                 # Bootstrap Express (seguridad, rutas, arranque)
├── config/
│   ├── db.js                 # Cliente Turso, esquema y migraciones idempotentes
│   └── env.js                # Validación fail-fast de variables de entorno
├── middlewares/
│   └── authMiddleware.js     # autenticado / soloAdmin / adminODirector (verifican JWT de cookie)
├── controllers/              # Lógica por dominio (ot, clientes, facturas, presupuestos, ...)
├── routes/
│   └── apiRoutes.js          # Definición de endpoints /api
├── utils/
│   ├── responder.js          # Respuesta de error genérica + log con referencia
│   ├── registrarLog.js       # Auditoría
│   └── validaciones.js
├── scripts/
│   └── backup-turso.js       # Backup de la BBDD a .sql restaurable
└── public/                   # Frontend (HTML, CSS, JS por módulos)
```

## 🚀 Puesta en marcha (local)

**Requisitos:** Node.js 18+.

```bash
git clone https://github.com/DavidSW123/serviplusultra-sw-2.0.git
cd serviplusultra-sw-2.0
npm install
cp .env.example .env        # rellena los valores (ver más abajo)
npm start                   # producción local  →  http://localhost:3000
# o
npm run dev                 # con recarga automática (nodemon)
```

## 🔑 Variables de entorno

Definidas y validadas en [`config/env.js`](config/env.js). El servidor **no arranca** si falta una obligatoria.

| Variable | Obligatoria | Descripción |
|----------|:-----------:|-------------|
| `TURSO_DATABASE_URL` | ✅ | URL de la base de datos Turso |
| `TURSO_AUTH_TOKEN` | ✅ | Token de acceso a Turso |
| `JWT_SECRET` | ✅ | Secreto para firmar las sesiones (cadena aleatoria larga) |
| `GOOGLE_SCRIPT_URL` | ✅ | Endpoint del relay de email (Apps Script) |
| `GEMINI_API_KEY` | — | API key de Google Gemini (escáner IA) |
| `APP_ORIGIN` | — | Origen permitido para CORS (por defecto, la URL de Render) |
| `PORT` | — | Puerto del servidor (por defecto `3000`) |

Generar un `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 🧰 Scripts

| Comando | Acción |
|---------|--------|
| `npm start` | Arranca el servidor (`node server.js`) |
| `npm run dev` | Arranca con recarga automática (`nodemon`) |
| `node scripts/backup-turso.js` | Vuelca toda la BBDD a `backups/turso-backup-<fecha>.sql` |

## 💾 Backups y restauración

> Los datos contables tienen obligación legal de conservación. Haz copias con regularidad.

```bash
# Crear backup (genera un .sql en /backups, carpeta ignorada por git)
node scripts/backup-turso.js

# Restaurar en otra BBDD (Turso CLI o SQLite)
turso db shell <db> < backups/turso-backup-XXXX.sql
```

El backup incluye esquema + datos y es restaurable (verificado por *replay*). Guarda una copia **fuera de la máquina** (Drive, disco externo, etc.).

## ☁️ Despliegue (Render)

- El servicio despliega automáticamente desde la rama `main`.
- Configura las variables de entorno en **Render → Environment** (las obligatorias de la tabla anterior).
- Tras un cambio en autenticación, los usuarios deberán iniciar sesión de nuevo una vez.

## 🔐 Seguridad

Estado tras la **Fase 0** (ver [SECURITY.md](SECURITY.md) y [ROADMAP.md](ROADMAP.md)):

- Autenticación real por **JWT en cookie `httpOnly` + `SameSite=Strict`**; el rol se deriva solo del token verificado en servidor.
- Contraseñas con **hash `bcrypt`** (migración transparente desde texto plano).
- **`helmet`**, **CORS** restringido al dominio propio y **rate limiting** (estricto en login y recuperación).
- Errores genéricos al cliente con referencia; el detalle queda en los logs del servidor.
- Escape de salida (XSS) en las vistas.
- Validación *fail-fast* de configuración; sin secretos hardcodeados.

## 🗺️ Roadmap

El proyecto evoluciona hacia un ERP profesional conectado al banco. Plan por fases en [ROADMAP.md](ROADMAP.md):

- **Fase 0 — Seguridad mínima viable** ✅ (en curso de despliegue)
- **Fase 1 — Integridad contable y fiscal**
- **Fase 2 — Profesionalización** (tests, CI/CD, observabilidad, backups automáticos)
- **Fase 3 — Integración bancaria** (conciliación vía PSD2 / Norma 43)

## 📄 Licencia

Software propietario de ServiPlusUltra Solutions S.L. Todos los derechos reservados.
