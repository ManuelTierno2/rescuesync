# RescueSync — base del backend de la Etapa 2

Backend local con Node.js 24, Express 5, TypeScript, Prisma 7.10.0 y PostgreSQL. Permite registrar y consultar emergencias y contiene los modelos y migraciones de Usuario, Emergencia, Lote y Oferta.

Esta base cubre el subconjunto acordado de la Etapa 2. Los formularios, los endpoints de lotes/ofertas, la integración REST con Bonita y el Sistema Nacional se incorporarán después. No contiene login, JWT ni control de acceso: `creada_por_id` identifica un usuario de prueba y puede ser enviado por cualquier cliente. El campo `rol` es un dato del modelo; no implementa RBAC.

## Requisitos

- Node.js 24.x y npm.
- PostgreSQL local (verificación realizada con PostgreSQL 18).
- Una base propia para la aplicación y otra separada para las pruebas.

Ejecutar los comandos desde `backend/`. En Windows PowerShell usar `npm.cmd` si la política de ejecución bloquea `npm.ps1`; los ejemplos de esta guía usan esa variante. En Linux/macOS reemplazarla por `npm`.

## Preparar PostgreSQL

Conectarse como administrador de PostgreSQL, por ejemplo:

```powershell
psql -U postgres -d postgres
```

Crear un rol y las bases de RescueSync. Los siguientes comandos se ejecutan dentro de `psql`; `\password` solicita la contraseña sin incluirla en el SQL:

```sql
CREATE ROLE rescuesync LOGIN;
\password rescuesync
CREATE DATABASE rescuesync OWNER rescuesync;
CREATE DATABASE rescuesync_test OWNER rescuesync;
```

Estas bases son independientes de las de Bonita. Si ya existen, continuar con su configuración en lugar de recrearlas.

## Instalar y ejecutar

```powershell
cd backend
Copy-Item .env.example .env
```

Editar `.env` con las credenciales elegidas:

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL="postgresql://rescuesync:CAMBIAR_PASSWORD@localhost:5432/rescuesync"
TEST_DATABASE_URL="postgresql://rescuesync:CAMBIAR_PASSWORD@localhost:5432/rescuesync_test"
```

Codificar los caracteres especiales de la contraseña al incluirla en la URL, por ejemplo `@` como `%40`. `DATABASE_URL` es obligatoria y se comparte entre la API, las migraciones y el seed. `TEST_DATABASE_URL` se utiliza exclusivamente al ejecutar las pruebas. Los valores definidos en el entorno tienen prioridad sobre `.env`, que está ignorado por Git.

```powershell
npm.cmd ci
npm.cmd run generate
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run dev
```

La API escucha en `http://localhost:3000`. El arranque comprueba la conexión a PostgreSQL y falla con código de salida distinto de cero si no puede establecerla. No necesita Bonita ni servicios externos activos.

Para ejecutar el código compilado:

```powershell
npm.cmd run build
npm.cmd start
```

El seed es explícito y repetible; crea, sin sobrescribir un usuario ya existente con ese ID:

| Campo | Valor |
|---|---|
| `id` | `11111111-1111-4111-8111-111111111111` |
| `email` | `municipio@rescuesync.test` |
| `rol` | `MUNICIPIO` |
| `organizacion` | `Municipio de prueba` |

No se asigna una contraseña. Para detener el servidor, usar `Ctrl+C`; se cierra el servidor HTTP y el pool de conexiones.

Se mantienen Prisma, su cliente y su adaptador en 7.10.0. `package.json` fija versiones corregidas de dos dependencias transitivas de su CLI (`deepmerge-ts` y `mysql2`) mediante `overrides`; el backend utiliza exclusivamente PostgreSQL.

## Endpoints

### POST /api/emergencias

El cuerpo admite únicamente estos cuatro campos:

```json
{
  "creada_por_id": "11111111-1111-4111-8111-111111111111",
  "gravedad": "ALTA",
  "zona": "Barrio Centro",
  "descripcion": "Inundación con viviendas afectadas."
}
```

- `creada_por_id`: UUID de un usuario existente con rol `MUNICIPIO`.
- `gravedad`: `BAJA`, `MEDIA`, `ALTA` o `CRITICA`.
- `zona`: texto de 1 a 200 caracteres.
- `descripcion`: texto de 1 a 5000 caracteres.
- Se quitan espacios iniciales/finales de zona y descripción antes de validar el largo.
- Se rechazan propiedades adicionales, incluidos `id`, `bonita_instance_id`, `created_at` y `updated_at`.

Ejemplo PowerShell:

```powershell
$body = @{
  creada_por_id = '11111111-1111-4111-8111-111111111111'
  gravedad = 'ALTA'
  zona = 'Barrio Centro'
  descripcion = 'Inundación con viviendas afectadas.'
} | ConvertTo-Json

$resultado = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/emergencias' -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
$resultado.data
```

Respuesta `201 Created`, con `Location: /api/emergencias/<id>` y estructura:

```json
{
  "data": {
    "id": "89d93b6e-f3dc-4d9d-b84e-3672ce99fb70",
    "creada_por_id": "11111111-1111-4111-8111-111111111111",
    "gravedad": "ALTA",
    "zona": "Barrio Centro",
    "descripcion": "Inundación con viviendas afectadas.",
    "bonita_instance_id": null,
    "created_at": "2026-09-11T12:00:00.000Z",
    "updated_at": "2026-09-11T12:00:00.000Z"
  }
}
```

### GET /api/emergencias/:id

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/emergencias/$($resultado.data.id)"
```

Responde `200 OK` con la misma estructura `{ "data": emergencia }`, sin expandir las relaciones. Devuelve `400` ante un UUID inválido y `404` si no existe la emergencia.

`bonita_instance_id` es un `BIGINT` nullable y único. En esta base permanece en `null`; cuando la integración futura lo asigne internamente, la respuesta lo representará como **string** para conservar la precisión. No se realizan llamadas a Bonita ni se simula el inicio de una instancia.

### Errores

Todas las respuestas de error usan esta estructura:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "La solicitud contiene datos inválidos.",
    "details": [{ "field": "zona", "message": "La zona es obligatoria." }]
  }
}
```

| HTTP | Códigos / situación |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_JSON`, `INVALID_URL`, `BODY_TOO_LARGE`, `INVALID_ENCODING` |
| 404 | `EMERGENCIA_NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 422 | `INVALID_CREATOR`: usuario inexistente o no municipal |
| 503 | `DATABASE_UNAVAILABLE` |
| 500 | `INTERNAL_ERROR` |

Los errores generales tienen `details: []`. El límite del cuerpo JSON es 100 KB. Las respuestas no exponen SQL, credenciales ni stacks.

## Organización y modelo

```text
prisma/schema.prisma    Modelos y relaciones
prisma/migrations/     Historial SQL versionado
prisma/seed.ts         Usuario municipal de prueba
src/config/            Variables de entorno
src/database/          Cliente Prisma y pool PostgreSQL
src/routes/            Rutas y validaciones
src/controllers/       Traducción entre HTTP y servicios
src/services/          Reglas de negocio y persistencia
src/validators/        Esquemas Zod
src/middlewares/       Validación y manejo de errores
src/generated/        Cliente Prisma generado, ignorado por Git
tests/                Pruebas con PostgreSQL real
```

Las tablas usan UUID y timestamps `TIMESTAMPTZ(3)`. Prisma genera los UUID y mantiene `updated_at` al actualizar registros; una modificación mediante SQL directo debe actualizar ese campo explícitamente.

| Tabla | Contenido y relaciones |
|---|---|
| `usuarios` | Nombre, email único, organización como texto y rol `MUNICIPIO`, `COORDINADOR`, `ONG` o `AUDITOR`. |
| `emergencias` | Usuario municipal autor, gravedad, zona, descripción y futura referencia a Bonita. Puede existir sin lotes. |
| `lotes` | Una necesidad de tipo `PERSONAL` o `RECURSO`, su cantidad entera positiva y unidad. Pertenece a una emergencia. |
| `ofertas` | Cantidad entera positiva ofrecida para un lote por un usuario ONG, con observaciones opcionales. Admite cobertura parcial. |

Hay índices en las claves foráneas. Estas restringen la eliminación de registros referenciados. Las cantidades positivas se imponen mediante `CHECK` en la migración SQL, ya que Prisma no las expresa en su esquema. Los futuros servicios de ofertas deberán validar el rol ONG, del mismo modo que el servicio de emergencias valida el rol municipal.

Las organizaciones independientes, consorcios, historial de ofertas, estados del proceso y control de acceso requieren futuras migraciones y servicios; no forman parte de esta base.

## Migraciones y comandos

| Comando | Uso |
|---|---|
| `npm.cmd run generate` | Generar el cliente Prisma después de instalar o modificar el esquema. |
| `npm.cmd run db:migrate` | Aplicar las migraciones versionadas con `migrate deploy`. |
| `npm.cmd run db:migrate:dev -- --name nombre` | Crear una nueva migración durante desarrollo. |
| `npm.cmd run db:seed` | Cargar explícitamente el usuario municipal de prueba. |
| `npm.cmd run dev` | Ejecutar con recarga de TypeScript. |
| `npm.cmd run typecheck` | Comprobar tipos sin emitir archivos. |
| `npm.cmd run build` | Generar el cliente y compilar a `dist/`. |
| `npm.cmd start` | Ejecutar el servidor compilado. |
| `npm.cmd test` | Migrar la base de pruebas y ejecutar las pruebas. |

`migrate deploy` aplica los archivos existentes y no necesita una base auxiliar. `migrate dev` requiere una base temporal de comparación (shadow database). Para crear nuevas migraciones, usar un rol de desarrollo con permiso `CREATEDB`, concedido por un administrador mediante `ALTER ROLE rescuesync CREATEDB;`. Este permiso no es necesario para instalar y ejecutar la base entregada.

Conservar las migraciones aplicadas y agregar otras nuevas cuando cambie el modelo. Los checks de cantidades están documentados en el esquema y deben preservarse en las migraciones futuras. No se sincroniza ni modifica automáticamente el esquema al arrancar el servidor.

## Pruebas

Configurar una base exclusiva en `TEST_DATABASE_URL`. Por protección, su nombre debe terminar en `_test` y ser distinto del nombre en `DATABASE_URL`. La suite aplica migraciones y repite el seed, pero elimina únicamente los registros creados por sus pruebas; conserva el usuario demo.

```powershell
npm.cmd run generate
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Las pruebas usan `node:test`, `tsx`, Supertest y PostgreSQL real. Cubren alta/consulta, persistencia, límites y normalización de campos, roles, errores HTTP, precisión y unicidad del ID Bonita, ofertas parciales, cantidades positivas, claves foráneas y conexión no disponible.
