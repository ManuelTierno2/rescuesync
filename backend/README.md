# Actualizaci?n: workflow web completo

Ver [BONITA_WORKFLOW.md](../BONITA_WORKFLOW.md) para migraci?n, endpoints, configuraci?n, reintentos y cambios manuales de Studio. La publicaci?n ahora es expl?cita, las ofertas requieren una ventana abierta y la adjudicaci?n requiere `OFERTAS_VALIDACION_MODE=DESARROLLO`. Los lotes y ofertas exigen `X-Dev-User-Id`, adem?s de las nuevas acciones. El contrato de Registrar emergencia del caso real #2 todav?a est? vac?o: ese caso no fue avanzado autom?ticamente.

Los ejemplos de alta e instanciaci?n de abajo siguen describiendo sus endpoints, pero el recorrido de tareas y las instrucciones de prueba vigentes est?n en la gu?a de workflow.

# RescueSync — backend de la Etapa 2

Backend local con Node.js 24, Express 5, TypeScript, Prisma 7.10.0 y PostgreSQL. Permite registrar emergencias, crear lotes y recibir ofertas parciales, con inicio opcional de procesos en Bonita Community 2025.2.

La interfaz React está en [frontend](../frontend/README.md). No contiene login, JWT ni control de acceso de la aplicación: `creada_por_id` y `ong_usuario_id` identifican usuarios de prueba y pueden ser enviados por cualquier cliente. La API valida roles municipales y ONG como reglas de negocio; no acredita la identidad del solicitante. La creación de lotes se presenta solo al coordinador en la interfaz, pero el endpoint es público. El selector de desarrollo y CORS no implementan RBAC. La autenticación técnica con Bonita es independiente.

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
if (!(Test-Path .env)) { Copy-Item .env.example .env }
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

La API escucha en `http://localhost:3000` y admite CORS desde `http://localhost:5173` para GET/POST y preflight JSON, sin credenciales. El arranque comprueba PostgreSQL. Con `BONITA_ENABLED=false` (valor predeterminado) no necesita Bonita ni valida sus credenciales. Con Bonita habilitado valida la configuración local, pero tampoco realiza conexiones externas al arrancar.

Para ejecutar el código compilado:

```powershell
npm.cmd run build
npm.cmd start
```

El seed es explícito y repetible; crea, sin sobrescribir un usuario ya existente con ese ID:

| Rol | Organización | ID |
|---|---|---|
| MUNICIPIO | Municipio de prueba | `11111111-1111-4111-8111-111111111111` |
| COORDINADOR | Centro Coordinador | `22222222-2222-4222-8222-222222222222` |
| ONG | ONG A | `33333333-3333-4333-8333-333333333333` |
| ONG | ONG B | `44444444-4444-4444-8444-444444444444` |
| AUDITOR | Auditoría | `55555555-5555-4555-8555-555555555555` |

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

`bonita_instance_id` es un `BIGINT` nullable y único. Se representa como **string** para conservar la precisión. Con integración deshabilitada permanece en `null`; habilitada, el alta inicia una instancia real y guarda su identificador. Consultar la sección Bonita para el tratamiento de resultados parciales.

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
| 404 | `EMERGENCIA_NOT_FOUND`, `LOTE_NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 422 | `INVALID_CREATOR`: usuario inexistente o no municipal; `INVALID_ONG`: usuario inexistente o sin rol ONG |
| 503 | `DATABASE_UNAVAILABLE` |
| 500 | `INTERNAL_ERROR` |

Los errores generales tienen `details: []`. El límite del cuerpo JSON es 100 KB. Las respuestas no exponen SQL, credenciales ni stacks.

## Organización y modelo

```text
prisma/schema.prisma    Modelos y relaciones
prisma/migrations/     Historial SQL versionado
prisma/seed.ts         Usuarios de desarrollo de los cuatro roles
src/config/            Variables de entorno
src/database/          Cliente Prisma y pool PostgreSQL
src/routes/            Rutas y validaciones
src/controllers/       Traducción entre HTTP y servicios
src/services/          Reglas de negocio y persistencia
src/integrations/bonita/ Cliente REST y servicio de inicio de procesos
src/validators/        Esquemas Zod
src/middlewares/       Validación y manejo de errores
src/generated/        Cliente Prisma generado, ignorado por Git
tests/                Pruebas con PostgreSQL real
```

Las tablas usan UUID y timestamps `TIMESTAMPTZ(3)`. Prisma genera los UUID y mantiene `updated_at` al actualizar registros; una modificación mediante SQL directo debe actualizar ese campo explícitamente.

| Tabla | Contenido y relaciones |
|---|---|
| `usuarios` | Nombre, email único, organización como texto y rol `MUNICIPIO`, `COORDINADOR`, `ONG` o `AUDITOR`. |
| `emergencias` | Usuario municipal autor, gravedad, zona, descripción y referencia opcional a Bonita. Puede existir sin lotes. |
| `lotes` | Una necesidad de tipo `PERSONAL` o `RECURSO`, su cantidad entera positiva y unidad. Pertenece a una emergencia. |
| `ofertas` | Cantidad entera positiva ofrecida para un lote por un usuario ONG, con observaciones opcionales. Admite cobertura parcial. |

Hay índices en las claves foráneas. Estas restringen la eliminación de registros referenciados. Las cantidades positivas se imponen mediante `CHECK` en la migración SQL y también se validan en HTTP. El servicio de ofertas valida el rol ONG, del mismo modo que el servicio de emergencias valida el rol municipal. No se requieren nuevas migraciones para este subflujo.

Las organizaciones independientes, consorcios, historial de ofertas, estados del proceso y control de acceso requieren futuras migraciones y servicios; no forman parte de esta base.

## Migraciones y comandos

| Comando | Uso |
|---|---|
| `npm.cmd run generate` | Generar el cliente Prisma después de instalar o modificar el esquema. |
| `npm.cmd run db:migrate` | Aplicar las migraciones versionadas con `migrate deploy`. |
| `npm.cmd run db:migrate:dev -- --name nombre` | Crear una nueva migración durante desarrollo. |
| `npm.cmd run db:seed` | Cargar explícitamente los cinco usuarios de prueba. |
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

Las pruebas usan `node:test`, `tsx`, Supertest y PostgreSQL real. Cubren los endpoints, persistencia, límites, roles, CORS, errores y resultados parciales del alta. El cliente Bonita se contrasta con un servidor HTTP local que exige sesión y CSRF según el contrato oficial, incluyendo timeout, precisión de IDs, falta de permisos y ausencia de reintentos. Estas pruebas no requieren credenciales ni crean instancias en el motor Bonita real. Las pruebas de navegador se ejecutan desde el frontend contra la base `_test`; no ejecutar ambas suites simultáneamente sobre la misma base.

## Endpoints de usuarios, lotes y ofertas

Las consultas devuelven `200 { data: ... }`; las altas de lotes/ofertas devuelven `201 { data: ... }`. Las colecciones vacías son `{ data: [] }`. UUID mal formado produce `400`; padre inexistente produce `404`, también al listar.

| Endpoint | Resultado |
|---|---|
| `GET /api/usuarios` | Usuarios existentes con `id`, `nombre`, `organizacion`, `rol`. |
| `GET /api/emergencias` | Emergencias, más recientes primero, con la misma serialización del detalle. |
| `GET /api/emergencias/:emergenciaId/lotes` | Lotes de la emergencia, más antiguos primero. |
| `POST /api/emergencias/:emergenciaId/lotes` | Guardar un lote en la ronda en preparaci?n; la publicaci?n es una acci?n separada. |
| `GET /api/lotes/:loteId/ofertas` | Ofertas, más antiguas primero, con `ong_usuario` (los mismos campos públicos del selector). |
| `POST /api/lotes/:loteId/ofertas` | Registrar una oferta y devolverla con `ong_usuario`. |

Cuerpo para crear un lote:

```json
{
  "tipo": "RECURSO",
  "descripcion": "Raciones de alimento",
  "cantidad_requerida": 1000,
  "unidad": "raciones"
}
```

`tipo` admite `PERSONAL` o `RECURSO`. Descripción obligatoria de 1–5000 caracteres; unidad de texto libre de 1–50 caracteres. Ambos textos se recortan antes de validar. Las cantidades son números JSON enteros de 1 a 2147483647, sin coerción de strings. Se rechazan propiedades adicionales y campos administrados.

Cuerpo para ofrecer sobre un lote:

```json
{
  "ong_usuario_id": "33333333-3333-4333-8333-333333333333",
  "cantidad_ofrecida": 400,
  "observaciones": "Disponibles para entrega inmediata"
}
```

El usuario debe existir y tener rol ONG. Observaciones admite hasta 5000 caracteres; ausente, `null` o texto vacío se almacena como `null`. Se aceptan ofertas parciales, distintas ONG y ofertas sucesivas de la misma ONG. Tampoco se limita la cantidad según cobertura acumulada. No hay asignación, aceptación, estados ni versionado de ofertas en esta entrega.

## Bonita Community 2025.2: conexión e inicio real

La fuente principal es la documentación oficial de Bonitasoft correspondiente a la instalación local: Bonita Community 2025.2, motor 10.4.0 (también declarado por el proyecto Maven). La página de esa versión enlaza a la referencia REST 1.0.6:

- [REST API de Bonita 2025.2](https://documentation.bonitasoft.com/bonita/2025.2/api/rest-api-overview).
- [Login, sesión, logout, proceso e instanciación — OpenAPI oficial 1.0.6](https://api-documentation.bonitasoft.com/1.0.6/).
- [CSRF en Bonita 2025.2](https://documentation.bonitasoft.com/bonita/2025.2/security/csrf-security).

Los enlaces del dominio oficial redirigen actualmente a su documentación en `documentation.ofelia.com` y `api-documentation.ofelia.com`. No se utilizó documentación de terceros para implementar el protocolo.

Agregar a `backend/.env`, conservando las URLs PostgreSQL existentes:

```dotenv
BONITA_ENABLED=false
BONITA_URL=http://localhost:8080/bonita
BONITA_USERNAME=
BONITA_PASSWORD=
BONITA_PROCESS_ID=
BONITA_TIMEOUT_MS=10000
```

Solo se aceptan las cadenas `true` y `false` para el interruptor. Deshabilitado no requiere ni valida otros valores Bonita y no realiza llamadas. Habilitado exige URL HTTP(S), usuario, contraseña y un ID decimal positivo de proceso compatible con BIGINT. El timeout debe estar entre 1 y 60000 milisegundos.

Para activar:

1. Tener el proceso **RescueSync** desplegado en Bonita Community 2025.2, habilitado y con configuración resuelta. El contrato de inicio del diagrama local está vacío. Esta entrega lo invoca con `{}` y no transfiere campos de la emergencia al motor.
2. Usar un usuario existente en Bonita con permiso para consultar e iniciar ese proceso y correctamente asociado al actor iniciador. Los usuarios del seed PostgreSQL no crean cuentas en Bonita.
3. Obtener el ID de la definición desplegada desde la aplicación de administración de Bonita. También se puede consultar, con la sesión autenticada, `GET /API/bpm/process?p=0&c=100&f=name%3DRescueSync&f=activationState%3DENABLED`; revisar nombre y versión y copiar su `id` como texto. No confundirlo con un ID de instancia. Un despliegue diferente puede requerir actualizar esta configuración.
4. Completar las variables y establecer `BONITA_ENABLED=true`. Reiniciar el backend. No guardar credenciales en el repositorio ni en variables `VITE_*`.

Secuencia implementada:

1. Validar el autor municipal y guardar la emergencia en PostgreSQL.
2. Abrir sesión mediante `POST /loginservice` con formulario URL-encoded y `redirect=false`. La referencia oficial establece `204` como éxito.
3. Conservar los cookies recibidos (incluido `JSESSIONID`) y el token del cookie `X-Bonita-API-Token`; reenviarlos en las consultas y en el encabezado CSRF.
4. Consultar `GET /API/bpm/process/{BONITA_PROCESS_ID}` y comprobar ID, nombre RescueSync, estado ENABLED y configuración RESOLVED.
5. Invocar `POST /API/bpm/process/{BONITA_PROCESS_ID}/instantiation` con JSON `{}`. Una respuesta `201` debe contener `caseId`.
6. Guardar el identificador en `bonita_instance_id` y responder al alta. Se preserva la precisión tanto para IDs JSON string como numéricos usando el token JSON original de Node 24.
7. Cerrar la sesión con `GET /logoutservice?redirect=false`. Cada intento usa una sesión independiente; un fallo de logout no invalida el resultado.

El timeout abarca login, consulta e inicio, incluida la lectura de respuestas. El cierre de sesión tiene un límite separado de 2 segundos. No se mantiene una transacción de base de datos abierta durante llamadas HTTP, no se siguen redirecciones ni se reintenta automáticamente la instanciación.

### Resultado parcial del alta

Una emergencia ya guardada siempre devuelve `201`, también si falla la integración. En ese caso el cuerpo conserva `data` y agrega `warnings`:

```json
{
  "data": {
    "id": "89d93b6e-f3dc-4d9d-b84e-3672ce99fb70",
    "creada_por_id": "11111111-1111-4111-8111-111111111111",
    "gravedad": "ALTA",
    "zona": "La Plata",
    "descripcion": "Inundación",
    "bonita_instance_id": null,
    "created_at": "2026-09-12T00:00:00.000Z",
    "updated_at": "2026-09-12T00:00:00.000Z"
  },
  "warnings": [{
    "code": "BONITA_CONNECTION_FAILED",
    "message": "La emergencia se guardó, pero no se pudo completar la conexión con Bonita."
  }]
}
```

| Código de advertencia | Interpretación |
|---|---|
| `BONITA_AUTH_FAILED` | Login rechazado o sesión/CSRF incompletos. |
| `BONITA_PROCESS_UNAVAILABLE` | Proceso inaccesible, diferente, deshabilitado o sin resolver. |
| `BONITA_CONNECTION_FAILED` | Conexión o respuesta fallida antes del inicio. |
| `BONITA_START_FAILED` | Bonita no confirmó el inicio con 201. |
| `BONITA_INVALID_RESPONSE` | Falta un ID válido en la respuesta de inicio. |
| `BONITA_TIMEOUT`, `BONITA_RESULT_UNKNOWN` | No se pudo confirmar el resultado; si se envió el inicio, podría existir una instancia. |
| `BONITA_LINK_FAILED` | Instancia creada, pero no se confirmó el guardado del vínculo; el mensaje y el log contienen los IDs conocidos. |

No repetir el alta para resolver una advertencia. El registro ya existe y, ante timeout, también podría existir la instancia. Consultar emergencias e instancias en Bonita para conciliación manual. No hay reintentos, compensaciones, colas ni endpoint de recuperación. Las advertencias se devuelven en el POST; no son un historial persistido. `bonita_instance_id=null` solo expresa ausencia de vínculo registrado.

Los logs de integración contienen únicamente códigos e identificadores, nunca credenciales, tokens, SQL o respuestas internas. Si falla el guardado inicial, continúa aplicando el formato centralizado de errores y no se contacta Bonita.

### Comprobación manual de Bonita

Con configuración válida y `BONITA_ENABLED=true`, registrar una emergencia desde la interfaz y comprobar que el detalle muestra un ID Bonita. Verificar la misma instancia en Bonita y el mismo valor mediante `GET /api/emergencias/:id`; refrescar la página.

Para probar indisponibilidad sin detener un motor compartido, usar temporalmente un puerto local libre en `BONITA_URL`, reiniciar el backend y registrar otra emergencia. Debe responder 201 con advertencia y conservarla sin vínculo. Restaurar la URL después. Con `BONITA_ENABLED=false` repetir el alta: debe funcionar sin advertencia de integración ni necesidad de Bonita.

La integración termina al iniciar la instancia. No ejecuta human tasks, no configura timers ni incorpora Sistema Nacional. Las etapas posteriores siguen pendientes dentro del proceso.

## Ejecución del flujo web

Terminal 1, desde la raíz del proyecto:

```powershell
cd backend
npm.cmd run db:seed
npm.cmd run dev
```

Terminal 2, desde la raíz:

```powershell
cd frontend
npm.cmd install
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd run dev
```

Abrir `http://localhost:5173`. Seleccionar MUNICIPIO y registrar una emergencia; cambiar a COORDINADOR y crear 1000 raciones y 5 paramédicos; cambiar a ONG y ofrecer 400 raciones y 2 personas; cambiar a AUDITOR para consultar y refrescar para verificar persistencia. La guía detallada y las pruebas de navegador están en [frontend/README.md](../frontend/README.md).
