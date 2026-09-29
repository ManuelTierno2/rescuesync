# RescueSync

Plataforma para coordinar respuesta ante desastres: municipios, centro coordinador, ONGs y (opcional) Bonita BPM.

| Parte | Carpeta | Puerto |
|---|---|---|
| Frontend (React + Vite) | `frontend/` | http://localhost:5173 |
| Backend (Node + Express + Prisma) | `backend/` | http://localhost:3000 |
| Proceso Bonita | `app/` | Studio / http://localhost:8080/bonita |

Documentación detallada: [backend/README.md](backend/README.md), [frontend/README.md](frontend/README.md), [BONITA_WORKFLOW.md](BONITA_WORKFLOW.md), [IMPLEMENTACION.md](IMPLEMENTACION.md).

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
```

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

Con `BONITA_ENABLED=false` no hace falta completar el resto de variables Bonita.

### Frontend (`frontend/.env`)

| Variable | Descripción |
|---|---|
| `VITE_API_URL` | Base de la API: `http://localhost:3000/api` |

No poner credenciales Bonita en el frontend (`VITE_*` se empaquetan en el cliente).

## Usuarios de desarrollo (seed)

Selector en la UI (modo desarrollo, sin login real):

| Rol | Organización | ID |
|---|---|---|
| MUNICIPIO | Municipio de prueba | `11111111-1111-4111-8111-111111111111` |
| COORDINADOR | Centro Coordinador | `22222222-2222-4222-8222-222222222222` |
| ONG | ONG A | `33333333-3333-4333-8333-333333333333` |
| ONG | ONG B | `44444444-4444-4444-8444-444444444444` |
| AUDITOR | Auditoría | `55555555-5555-4555-8555-555555555555` |

## Flujo mínimo para probar la UI

1. Rol **MUNICIPIO** → registrar emergencia.  
2. Rol **COORDINADOR** → crear lotes → **Publicar convocatoria**.  
3. Rol **ONG** → cargar ofertas.  
4. Con `OFERTAS_VALIDACION_MODE=DESARROLLO`, seguir adjudicación / cierre desde el panel de workflow.

## Bonita (opcional)

1. Desplegar el proceso **RescueSync** desde Bonita Studio.  
2. Completar `BONITA_*` en `backend/.env` y `BONITA_ENABLED=true`.  
3. Reiniciar el backend.  
4. Ver detalle de integración y cambios de Studio en [BONITA_WORKFLOW.md](BONITA_WORKFLOW.md).

## Estructura

```text
rescuesync/
├── frontend/          # React + Vite
├── backend/           # Express + Prisma + integración Bonita
├── app/               # Proyecto Bonita (diagrama BPMN)
├── docker-compose.yml # Postgres opcional
├── BONITA_WORKFLOW.md
└── IMPLEMENTACION.md
```
