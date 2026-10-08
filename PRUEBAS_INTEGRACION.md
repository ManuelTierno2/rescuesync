# RescueSync, Bonita y Sistema Nacional: arranque y pruebas

Revisión del 8 de octubre de 2026, sobre la base nacional del commit `384fef6`.

## Qué está implementado

El Sistema Nacional es una API independiente, sin interfaz web. Incluye Express,
Prisma/PostgreSQL, `GET /health`, `POST /login`, JWT de 8 horas y middleware
`requireAuth(...roles)`. Todavía no hay rutas de negocio que usen ese middleware.
El seed crea un ADMIN, cinco tipos de recurso y seis certificaciones; no crea ONG.

El modelo contempla ONG, certificaciones y vencimientos, recursos totales/bloqueados,
compromisos e ítems. La base impone `0 <= bloqueado <= total` y unicidad del compromiso
por emergencia, lote y ONG. Esas restricciones no implementan por sí solas la reserva
transaccional, la validación de competencias ni la liberación.

Pendientes: registro/aprobación de ONG, catálogos por API, validación por nivel de riesgo,
bloqueo concurrente, liberación, pruebas automatizadas propias, Swagger, Dockerfile
y despliegue. El PDF `Guia_SistemaNacional_Etapa3_Inicio.pdf` describe el mismo alcance.

Hoy no existe comunicación RescueSync/Bonita → API nacional. Los dos conectores del
diagrama llaman al backend local (`:3000`) para abrir y evaluar la convocatoria.
`OFERTAS_VALIDACION_MODE=DESARROLLO` permite adjudicar sin validación nacional;
`PENDIENTE` bloquea esa operación. Arrancar la API nacional no cambia ese comportamiento.

## Puertos y bases

| Servicio | Puerto | Persistencia |
|---|---|---|
| Web RescueSync | 5173 | API local |
| Backend RescueSync | 3000 | `rescuesync`, schema `public` |
| Sistema Nacional | 3002 recomendado | `rescuesync`, schema `sistema_nacional` |
| Bonita | 8080, `/bonita` | Base gestionada por Studio |
| PostgreSQL | 5432 | Compartido por las dos APIs, con esquemas separados |
| API / web de Playwright | 3001 / 5174 | `rescuesync_test` |

La plantilla nacional usa 3001. Cambiar **solo su `.env` local** a 3002 permite mantener
la API encendida mientras corren las pruebas de navegador. Su `server.ts` usa 3000
si falta `PORT`: completar la variable para evitar el choque con RescueSync.

## Preparación (PowerShell, desde la raíz)

Usar Node 24.x. Si ya hay PostgreSQL local en 5432, usarlo; no levantar otro en ese puerto.
Para una instalación con Docker:

```powershell
docker compose up -d
```

El compose crea `rescuesync` y, en un volumen nuevo, `rescuesync_test`.
En una instalación existente comprobar que la base de pruebas exista y sea distinta
de la principal. No borrar volúmenes para recrearla.

### Backend RescueSync

```powershell
cd backend
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd ci
npm.cmd run generate
npm.cmd run db:migrate
npm.cmd run db:seed
```

Completar `.env` antes de migrar: `DATABASE_URL`, `TEST_DATABASE_URL`, `JWT_SECRET`
(al menos 32 caracteres). Para probar sin motor:

```dotenv
BONITA_ENABLED=false
OFERTAS_VALIDACION_MODE=DESARROLLO
PORT=3000
```

Usar la conexión PostgreSQL propia; el ejemplo del compose es
`postgresql://rescuesync:rescuesync@localhost:5432/rescuesync`.
La conexión de tests debe terminar en `/rescuesync_test`.

### Sistema Nacional

En otra terminal, desde la raíz:

```powershell
cd sistema_nacional
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd ci
```

Editar `.env`: `PORT=3002`, `DATABASE_URL` con las mismas credenciales PostgreSQL
que el backend pero agregando `?schema=sistema_nacional`, y completar `JWT_SECRET`,
`ADMIN_EMAIL`, `ADMIN_PASSWORD`. No copiar la URL de tests del backend.

```powershell
npm.cmd run db:generate
npx.cmd prisma migrate deploy
npm.cmd run db:seed
npm.cmd run build
```

Usar `migrate deploy` para instalar las migraciones existentes. El script nacional
`db:migrate` ejecuta `migrate dev` y es para desarrollar nuevas migraciones.
El seed vuelve a establecer la contraseña del administrador a `ADMIN_PASSWORD`.

### Frontend

En otra terminal, desde la raíz:

```powershell
cd frontend
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd ci
```

Configurar `VITE_API_URL=http://localhost:3000/api`.

## Arrancar los tres servicios

Usar una terminal por servicio, desde la carpeta indicada:

| Carpeta | Comando | Dirección |
|---|---|---|
| `backend` | `npm.cmd run dev` | http://localhost:3000 |
| `frontend` | `npm.cmd run dev` | http://localhost:5173/login |
| `sistema_nacional` | `npm.cmd run dev` | http://localhost:3002/health |

`Ctrl+C` detiene cada servicio. La API nacional compilada también arranca con
`npm.cmd start`, después de `npm.cmd run build`.

## Prueba del Sistema Nacional disponible hoy

Con las credenciales locales configuradas en su `.env` (las de abajo son las del ejemplo):

```powershell
Invoke-RestMethod http://localhost:3002/health
$body = @{ email = 'admin@rescuesync.local'; password = 'admin1234' } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3002/login -ContentType 'application/json' -Body $body
$login | Select-Object tokenType, expiresIn, rol, ongId
```

Esperado: health `ok`; login `Bearer`, `28800`, `ADMIN`, `ongId=null` y token en
`$login.token`. Contraseña incorrecta o email inexistente: 401. Campos ausentes: 400.
`/health` no consulta la base; un login exitoso comprueba además acceso a los usuarios.
Todavía no hay un endpoint de reserva o validación al que enviar ese token.

## Prueba de RescueSync sin Bonita

1. Entrar como `municipio@rescuesync.test` (password `demo1234`) y crear emergencia.
2. Como `coordinador@rescuesync.test`, crear lotes y publicar convocatoria.
3. Como `ong.a@rescuesync.test` y/o `ong.b@rescuesync.test`, cargar ofertas.
4. Como municipio, continuar a selección, elegir ofertas y confirmar adjudicación.
5. Las ONG adjudicadas confirman lectura y finalización; el coordinador finaliza
   monitoreo y cierra cuando todas las actividades estén completas.

Los usuarios provienen del seed del backend. Este recorrido prueba la aplicación
local; no prueba timers, curso alternativo ni recursos nacionales.

## Prueba con Bonita 1.6

1. Abrir `app/diagrams/MyDiagram-1.0.proc` en Studio, validar y desplegar el pool
   **RescueSync 1.6**. Mapear la cuenta técnica a Municipio, CentroCoordinador y ONG.
2. Configurar en `backend/.env`: `BONITA_ENABLED=true`, URL y credenciales técnicas,
   `BONITA_PROCESS_ID` y `BONITA_WORKFLOW_PROCESS_IDS` con el ID de esa definición.
3. Hacer coincidir `BONITA_CALLBACK_SECRET` con el Bearer de ambos conectores;
   mantener `OFERTAS_VALIDACION_MODE=DESARROLLO` mientras no exista integración nacional.
4. Reiniciar el backend y crear una **emergencia nueva**; los casos anteriores no
   migran automáticamente. Completar registro desde la web y publicar lotes.
5. Cargar ofertas antes del timer de 2 minutos. Comprobar que la apertura guarda
   `convocatoriaActividadId` y que la evaluación guarda `lotesCubiertos`.
6. Probar casos separados: cobertura completa; cobertura insuficiente con continuar
   parcialmente; reabrir conservando ofertas; reformular creando una nueva ronda.
   Sin ninguna oferta, continuar parcialmente debe quedar deshabilitado.
7. Tras cobertura completa o decisión parcial, el municipio selecciona/adjudica
   **en la web**. El paso automático de la service task no hace esa adjudicación.
8. Confirmar lectura como ONG. El coordinador finaliza monitoreo: se envía la lista
   de ONG adjudicadas y se crean sus tareas de finalización en paralelo. Cada ONG
   finaliza su actividad; comprobar cierre local y caso Bonita `COMPLETED`.

`npm.cmd run bonita:inspect` en `backend` permite consultar los últimos casos
vinculados y sus contratos sin avanzarlos. Ver [BONITA_WORKFLOW.md](BONITA_WORKFLOW.md).

## Pruebas automatizadas

Ejecutarlas **en secuencia**, porque backend y Playwright comparten `rescuesync_test`:

```powershell
cd backend
npm.cmd run typecheck
npm.cmd test
cd ../frontend
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:e2e
cd ../sistema_nacional
npm.cmd run build
npm.cmd run typecheck
```

Las pruebas del backend usan PostgreSQL real y un motor Bonita simulado. Las tres
pruebas web de curso alternativo simulan respuestas de la API; no ejecutan el BPMN.
La suite web también comprueba el flujo local por roles contra el backend de pruebas.

Verificación realizada el 8/10/2026: backend 89/89 pruebas, frontend 5/5 pruebas,
compilación de backend/frontend/Sistema Nacional y typecheck correctos. Se aplicaron
las dos migraciones nacionales, se ejecutó su seed y se verificaron health y login
(200/400/401). Se comprobó también login y consulta de emergencias en RescueSync.
El XML del proceso no tiene IDs duplicados y sus conexiones resuelven a nodos existentes.
El motor Bonita no estaba activo: queda pendiente validar/desplegar en Studio y
ejecutar los escenarios reales anteriores. Estas comprobaciones no certifican una
integración nacional que todavía no existe.

## Integración nacional pendiente: decisiones a resolver

| Punto | Trabajo necesario |
|---|---|
| `Validacion de ofertas` | Llamar a validación nacional con ONG, recursos, cantidades y riesgo; conservar capacidades y límites devueltos. Hoy solo calcula cobertura local. |
| Adjudicación / `Registrar compromiso de recursos` | Reservar las ofertas efectivamente seleccionadas, con transacción, locking e idempotencia. |
| Finalización ONG / cierre | Liberar una sola vez los recursos comprometidos, con reconciliación de errores. |
| Identificadores | Relacionar UUID de ONG local con ID entero nacional; mapear recursos/unidades y `BAJA/MEDIA/ALTA/CRITICA` a `BAJO/MEDIO/ALTO/CRITICO`. |
| Autenticación | Obtener/renovar JWT de servicio en backend o Bonita; no enviar las credenciales ADMIN al navegador. |

**Hay una diferencia de orden que debe resolverse antes de conectar reservas:** el
BPMN llega automáticamente a `Registrar compromiso de recursos` antes de que el
municipio haga la adjudicación local. No alcanza con agregar un conector a esa tarea:
hay que esperar la selección (por tarea humana/evento) o coordinar el compromiso
desde el backend al adjudicar. Elegir un único responsable para no reservar dos veces.

La unicidad de compromisos no evita por sí sola sobreasignaciones concurrentes.
Probar dos adjudicaciones simultáneas, reintentos, timeout después de reservar,
certificaciones vencidas, ONG suspendida, recursos insuficientes y doble liberación.
Para compromisos de la misma emergencia/lote/ONG, definir además qué pasa al intentar
reservar nuevamente después de liberarlos. Estas pruebas requieren APIs aún pendientes.
