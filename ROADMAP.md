# Roadmap — ServiPlusUltra ERP

Plan de evolución hacia un ERP profesional, apto para producción seria y, finalmente, **conectado al banco** (conciliación bancaria). Derivado de una auditoría técnica de 6 dimensiones (seguridad, integridad de datos, cumplimiento fiscal, arquitectura, integración bancaria y operaciones).

El orden es deliberado: **proteger el acceso y los datos → blindar la integridad fiscal → profesionalizar → conectar el banco.**

---

## Fase 0 — Seguridad mínima viable  🟢 *en despliegue*

Cierra los agujeros que impedirían cualquier uso serio o bancario.

- [x] **Autenticación real** por cookie `httpOnly` + JWT (elimina la confianza en cabeceras `x-rol`/`x-user` falsificables).
- [x] **Hash de contraseñas** con `bcrypt` (migración perezosa, transparente).
- [x] **Hardening HTTP**: `helmet`, CORS restringido, `rate-limit` (estricto en login/recuperación).
- [x] **Errores genéricos** + log central con referencia (sin filtrar detalles internos).
- [x] **Escape XSS** en las vistas de mayor riesgo *(resto de módulos: en curso)*.
- [x] **Gestión de secretos** vía entorno con validación *fail-fast*; backups de BBDD restaurables.
- [ ] **Bloque 4** — recuperación de contraseña con enlace de un solo uso.
- [ ] **Bloque 5 parte 2** — completar el escape XSS en los módulos restantes.

## Fase 1 — Integridad contable y fiscal

- [ ] Numeración **inmutable** (`max+1`, sin reutilizar números) y sin borrado físico de facturas emitidas.
- [ ] Concepto **BORRADOR vs EMITIDA**: los borradores se editan/borran libremente; las emitidas solo se anulan con abono.
- [ ] **Transacciones** en operaciones multi-tabla; índices `UNIQUE` en numeración.
- [ ] **Recálculo de importes en servidor** (no confiar en el cliente).
- [ ] **IVA por línea** (21/10/4/exento/ISP/recargo) con menciones legales.
- [ ] Validación de entrada (Zod) y de NIF/CIF; auditoría inmutable con snapshot.
- [ ] Dinero en céntimos enteros (evitar coma flotante).

## Fase 2 — Profesionalización

- [ ] Capa de servicios/repositorios; controladores finos.
- [ ] **Tests** automatizados (numeración, tarifas, importes) + **CI/CD**.
- [ ] **Backups automáticos** de Turso + restauración probada.
- [ ] Logger estructurado + alertas; healthchecks.
- [ ] Migraciones versionadas; entorno de **staging** separado.

## Fase 3 — Integración bancaria

- [ ] Modelo de cobros: estado de pago, vencimientos, métodos de cobro.
- [ ] Tablas de cuentas/movimientos/conciliación.
- [ ] **Conexión PSD2 read-only** (p. ej. GoCardless Bank Account Data) + importador **Norma 43** de respaldo.
- [ ] Motor de **conciliación** automática (matching importe/concepto/NIF).
- [ ] Cifrado en reposo de datos sensibles (IBAN, tokens). El backend nunca custodia credenciales bancarias.

---

*Documento vivo. Las casillas reflejan el estado de desarrollo, no asesoramiento fiscal: los aspectos legales deben confirmarse con la gestoría.*
