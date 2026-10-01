# Implementación Entrega 2 — actualización

## Estado

La Entrega 2 de la aplicación web incluye:

- Flujo operativo alineado al BPM **RescueSync 1.5** ([BONITA_WORKFLOW.md](BONITA_WORKFLOW.md))
- Auth JWT (`/api/auth/login`, `/register`, `/me`) y RBAC de 4 roles
- Versionado de ofertas (`PATCH` + historial)
- Consorcios, inventario ONG y organizaciones
- Panel auditor de solo lectura
- Tests backend con stub Bonita (83) y Playwright con login

Sistema Nacional: diferido — ver [ENTREGA3.md](ENTREGA3.md).

## Verificación local

```bash
cd backend && npm ci && npm run db:migrate && npm run db:seed && npm test && npm run build
cd ../frontend && npm ci && npm run build && npm run test:e2e
```

Usuarios seed (password `demo1234`): municipio / coordinador / ong.a / ong.b / auditor `@rescuesync.test`.

## Bonita real

El stub HTTP y el modo `BONITA_ENABLED=false` no certifican el motor. Checklist de certificación en [BONITA_WORKFLOW.md](BONITA_WORKFLOW.md).
