# Implementación de Etapa 2 — 12 de septiembre de 2026

Flujo implementado: registro municipal de emergencia, creación/publicación de lotes por coordinador y ofertas parciales de ONG, con selector de desarrollo y consulta de auditor.

La integración inicial real con Bonita Community 2025.2 está detrás de `BONITA_ENABLED`: autentica, conserva sesión/CSRF, inicia RescueSync y guarda el ID. Con Bonita deshabilitado funciona sin conexión. Los fallos posteriores al guardado devuelven 201 con advertencia, sin reintentar.

## Verificación realizada

- Backend: **47 pruebas aprobadas**, incluidas PostgreSQL real, endpoints, cliente HTTP Bonita y resultados parciales.
- Backend: `npm run build` aprobado (Prisma generate + TypeScript).
- Frontend: `npm run build` aprobado (TypeScript + Vite).
- Navegador: **2 pruebas Playwright aprobadas** en Chromium: flujo por roles, persistencia al refrescar, vista móvil, restricciones visuales, validación y presentación de advertencias.
- Seed aplicado a la base de la aplicación: cinco usuarios de desarrollo.
- Revisadas las capturas de escritorio y móvil; disponibles localmente en `frontend/test-results/` (ignoradas por Git).
- Configuración PostgreSQL y esquema existentes conservados, sin nuevas migraciones.

La fuente del protocolo fue la [documentación oficial Bonitasoft 2025.2](https://documentation.bonitasoft.com/bonita/2025.2/api/rest-api-overview), que enlaza a OpenAPI 1.0.6, y la [referencia oficial de CSRF](https://documentation.bonitasoft.com/bonita/2025.2/security/csrf-security).

**Limitación de validación:** se comprobó el cliente contra un servidor HTTP local de pruebas que exige el contrato oficial. No se inició una instancia en el motor Bonita real: faltan `BONITA_USERNAME`, `BONITA_PASSWORD` y `BONITA_PROCESS_ID` en la configuración local. El motor escucha en 8080. La implementación de la llamada real está incluida, pero esa comprobación debe realizarse con credenciales y definición desplegada válidas.

## Probar manualmente

Consultar [la guía del frontend](frontend/README.md#probar-el-flujo-completo) y [la configuración Bonita del backend](backend/README.md#bonita-community-20252-conexión-e-inicio-real).

1. Ejecutar `npm run dev` desde `backend/` y desde `frontend/` en terminales separadas; abrir http://localhost:5173.
2. Seleccionar MUNICIPIO, crear una emergencia y abrir su detalle.
3. Seleccionar COORDINADOR y crear 1000 raciones y 5 paramédicos.
4. Seleccionar ONG A y ofrecer 400 raciones y 2 personas.
5. Seleccionar AUDITOR, consultar las ofertas y refrescar para comprobar persistencia.
6. Para el motor real, completar sus variables, activar `BONITA_ENABLED=true`, reiniciar backend y crear otra emergencia; comprobar el mismo ID en PostgreSQL y Bonita.

En PowerShell usar `npm.cmd` si la política de ejecución bloquea `npm.ps1`. Los servidores de desarrollo se dejaron iniciados en los puertos 3000 y 5173 al entregar.

## Archivos modificados

- [backend/.env.example](backend/.env.example)
- [backend/README.md](backend/README.md)
- [backend/package-lock.json](backend/package-lock.json)
- [backend/package.json](backend/package.json)
- [backend/prisma/seed.ts](backend/prisma/seed.ts)
- [backend/src/app.ts](backend/src/app.ts)
- [backend/src/config/env.ts](backend/src/config/env.ts)
- [backend/src/controllers/emergencias.controller.ts](backend/src/controllers/emergencias.controller.ts)
- [backend/src/routes/emergencias.routes.ts](backend/src/routes/emergencias.routes.ts)
- [backend/src/server.ts](backend/src/server.ts)
- [backend/src/services/emergencias.service.ts](backend/src/services/emergencias.service.ts)
- [backend/tests/emergencias.integration.test.ts](backend/tests/emergencias.integration.test.ts)

## Archivos creados

- [backend/src/controllers/lotes.controller.ts](backend/src/controllers/lotes.controller.ts)
- [backend/src/controllers/ofertas.controller.ts](backend/src/controllers/ofertas.controller.ts)
- [backend/src/controllers/usuarios.controller.ts](backend/src/controllers/usuarios.controller.ts)
- [backend/src/integrations/bonita/bonita.client.ts](backend/src/integrations/bonita/bonita.client.ts)
- [backend/src/integrations/bonita/bonita.service.ts](backend/src/integrations/bonita/bonita.service.ts)
- [backend/src/routes/lotes.routes.ts](backend/src/routes/lotes.routes.ts)
- [backend/src/routes/ofertas.routes.ts](backend/src/routes/ofertas.routes.ts)
- [backend/src/routes/usuarios.routes.ts](backend/src/routes/usuarios.routes.ts)
- [backend/src/services/lotes.service.ts](backend/src/services/lotes.service.ts)
- [backend/src/services/ofertas.service.ts](backend/src/services/ofertas.service.ts)
- [backend/src/services/usuarios.service.ts](backend/src/services/usuarios.service.ts)
- [backend/src/validators/lotes.schema.ts](backend/src/validators/lotes.schema.ts)
- [backend/src/validators/ofertas.schema.ts](backend/src/validators/ofertas.schema.ts)
- [backend/tests/bonita.client.test.ts](backend/tests/bonita.client.test.ts)
- [backend/tests/helpers/bonita-server.ts](backend/tests/helpers/bonita-server.ts)
- [backend/tests/helpers/browser-cleanup.ts](backend/tests/helpers/browser-cleanup.ts)
- [backend/tests/helpers/browser-server.ts](backend/tests/helpers/browser-server.ts)
- [backend/tests/helpers/test-database.ts](backend/tests/helpers/test-database.ts)
- [frontend/.env.example](frontend/.env.example)
- [frontend/.gitignore](frontend/.gitignore)
- [frontend/README.md](frontend/README.md)
- [frontend/index.html](frontend/index.html)
- [frontend/package-lock.json](frontend/package-lock.json)
- [frontend/package.json](frontend/package.json)
- [frontend/playwright.config.ts](frontend/playwright.config.ts)
- [frontend/src/api.ts](frontend/src/api.ts)
- [frontend/src/components/LoteCard.tsx](frontend/src/components/LoteCard.tsx)
- [frontend/src/components/LoteForm.tsx](frontend/src/components/LoteForm.tsx)
- [frontend/src/hooks.ts](frontend/src/hooks.ts)
- [frontend/src/main.tsx](frontend/src/main.tsx)
- [frontend/src/pages/EmergenciaDetailPage.tsx](frontend/src/pages/EmergenciaDetailPage.tsx)
- [frontend/src/pages/EmergenciasPage.tsx](frontend/src/pages/EmergenciasPage.tsx)
- [frontend/src/pages/NuevaEmergenciaPage.tsx](frontend/src/pages/NuevaEmergenciaPage.tsx)
- [frontend/src/styles.css](frontend/src/styles.css)
- [frontend/src/ui.tsx](frontend/src/ui.tsx)
- [frontend/src/user-context.tsx](frontend/src/user-context.tsx)
- [frontend/tests/flujo.spec.ts](frontend/tests/flujo.spec.ts)
- [frontend/tsconfig.json](frontend/tsconfig.json)
- [frontend/vite.config.ts](frontend/vite.config.ts)
- [IMPLEMENTACION.md](IMPLEMENTACION.md)

Se creó además `frontend/.env` local a partir del ejemplo; está ignorado por Git y solo contiene la URL pública de la API.
