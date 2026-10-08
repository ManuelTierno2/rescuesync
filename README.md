# RescueSync

Plataforma para coordinar respuesta ante desastres: municipios, centro coordinador, ONGs y (opcional) Bonita BPM.

| Parte | Carpeta | Puerto |
|---|---|---|
| Frontend (React + Vite) | `frontend/` | http://localhost:5173 |
| Backend (Node + Express + Prisma) | `backend/` | http://localhost:3000 |
| Sistema Nacional (API base: health/login) | `sistema_nacional/` | http://localhost:3002 (configurar `.env`) |
| Proceso Bonita | `app/` | Studio / http://localhost:8080/bonita |

Documentación: [backend/README.md](backend/README.md), [frontend/README.md](frontend/README.md), [BONITA_WORKFLOW.md](BONITA_WORKFLOW.md), [IMPLEMENTACION.md](IMPLEMENTACION.md), [ENTREGA3.md](ENTREGA3.md) (Sistema Nacional, fuera de E2).

Guía actual de arranque conjunto, pruebas y límites de la integración nacional:
[PRUEBAS_INTEGRACION.md](PRUEBAS_INTEGRACION.md). El Sistema Nacional todavía no
expone validación, reserva ni liberación; levantarlo no activa esas operaciones en Bonita.

## Requisitos

- **Node.js 24.x** (el `package.json` pide `>=24 <25`; con Node 25 puede arrancar con warning)
- **npm**
- **PostgreSQL** (local **o** Docker)
- Opcional: Bonita Community 2025.2

## Arranque rápido

### 1. PostgreSQL

**Opción A — Docker** (incluida en el repo):

```bash
docker compose up -d
```

Levanta Postgres 16 en el puerto `5432` con usuario/password/db `rescuesync`, y crea también `rescuesync_test`.

**Opción B — PostgreSQL local:**

```sql
CREATE ROLE rescuesync LOGIN PASSWORD 'tu_password';
CREATE DATABASE rescuesync OWNER rescuesync;
CREATE DATABASE rescuesync_test OWNER rescuesync;
```

### 2. Variables de entorno

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Editá `backend/.env` (ver tablas más abajo). Con Docker, podés usar:

```dotenv
DATABASE_URL="postgresql://rescuesync:rescuesync@localhost:5432/rescuesync"
TEST_DATABASE_URL="postgresql://rescuesync:rescuesync@localhost:5432/rescuesync_test"
```

Para recorrer el flujo web **sin** Sistema Nacional:

```dotenv
OFERTAS_VALIDACION_MODE=DESARROLLO
BONITA_ENABLED=false
JWT_SECRET=change-me-rescuesync-jwt-secret-32c
```

Abrí **http://localhost:5173/login**. Usuarios seed (password `demo1234`): `municipio@rescuesync.test`, `coordinador@rescuesync.test`, `ong.a@rescuesync.test`, `ong.b@rescuesync.test`, `auditor@rescuesync.test`. Onboarding ONG: `/register`.

### 3. Backend

```bash
cd backend
npm ci
npm run generate
npm run db:migrate
npm run db:seed
npm run dev
```

Qué hace cada comando:

| Comando | Para qué |
|---|---|
| `npm ci` | Instala dependencias según el lockfile |
| `npm run generate` | Genera el cliente Prisma |
| `npm run db:migrate` | Aplica `prisma/migrations/` (crea/actualiza tablas) |
| `npm run db:seed` | Carga usuarios de prueba |
| `npm run dev` | API en http://localhost:3000 |

### 4. Frontend

En otra terminal:

```bash
cd frontend
npm ci
npm run dev
```

Abrí **http://localhost:5173**.

## Variables de entorno

### Backend (`backend/.env`)

| Variable | Descripción | Ejemplo / default |
|---|---|---|
| `NODE_ENV` | Entorno | `development` |
| `PORT` | Puerto HTTP | `3000` |
| `DATABASE_URL` | Postgres de la app (**obligatoria**) | `postgresql://rescuesync:…@localhost:5432/rescuesync` |
| `TEST_DATABASE_URL` | Postgres solo para tests (nombre debe terminar en `_test`) | `…/rescuesync_test` |
| `BONITA_ENABLED` | Integra con Bonita | `false` / `true` |
| `BONITA_URL` | Base URL del motor | `http://localhost:8080/bonita` |
| `BONITA_USERNAME` | Usuario técnico Bonita | (vacío si disabled) |
| `BONITA_PASSWORD` | Password Bonita | (vacío si disabled) |
| `BONITA_PROCESS_ID` | ID de la definición **RescueSync** desplegada | decimal positivo |
| `BONITA_TIMEOUT_MS` | Timeout llamadas Bonita (1–60000) | `10000` |
| `BONITA_WORKFLOW_PROCESS_IDS` | IDs de definiciones habilitadas para el workflow completo; vacío bloquea tramos nuevos | (vacío) |
| `BONITA_CALLBACK_SECRET` | Secreto de conectores Studio (≥32 chars); nunca en `VITE_*` | (vacío) |
| `OFERTAS_VALIDACION_MODE` | `PENDIENTE` (seguro) o `DESARROLLO` (permite adjudicar sin SN) | `PENDIENTE` |
| `JWT_SECRET` | Secreto firma JWT (**≥32 caracteres**) | (obligatorio) |
| `JWT_EXPIRES_IN` | Expiración del token | `8h` |
| `AUTH_ALLOW_DEV_HEADER` | Acepta `X-Dev-User-Id` (solo tests/dev) | `false` (en test, default true) |

Con `BONITA_ENABLED=false` no hace falta completar el resto de variables Bonita.

### Frontend (`frontend/.env`)

| Variable | Descripción |
|---|---|
| `VITE_API_URL` | Base de la API: `http://localhost:3000/api` |

No poner credenciales Bonita en el frontend (`VITE_*` se empaquetan en el cliente).

## Usuarios de desarrollo (seed)

Login JWT (password `demo1234`):

| Rol | Email | Organización |
|---|---|---|
| MUNICIPIO | `municipio@rescuesync.test` | Municipio de prueba |
| COORDINADOR | `coordinador@rescuesync.test` | Centro Coordinador |
| ONG | `ong.a@rescuesync.test` / `ong.b@…` | ONG A / ONG B |
| AUDITOR | `auditor@rescuesync.test` | Auditoría |

## Flujo mínimo para probar la UI

1. Login como **MUNICIPIO** → registrar emergencia.
2. Login **COORDINADOR** → crear lotes → **Publicar convocatoria**.
3. Login **ONG** → inventario / consorcios (opcional) → cargar u editar ofertas (versionado).
4. Con `OFERTAS_VALIDACION_MODE=DESARROLLO`, municipio adjudica; ONG lee y finaliza; coordinador monitorea y cierra.

## Bonita (opcional)

1. Desplegar el proceso **RescueSync** desde Bonita Studio.  
2. Completar `BONITA_*` en `backend/.env` y `BONITA_ENABLED=true`.  
3. Reiniciar el backend.  
4. Ver detalle de integración y cambios de Studio en [BONITA_WORKFLOW.md](BONITA_WORKFLOW.md).

## Estructura

```text
rescuesync/
├── frontend/          # React + Vite (JWT)
├── backend/           # Express + Prisma + Bonita + auth
├── app/               # Proyecto Bonita (RescueSync 1.5)
├── docker-compose.yml
├── BONITA_WORKFLOW.md
├── ENTREGA3.md        # Sistema Nacional (fuera de E2)
└── IMPLEMENTACION.md
```
