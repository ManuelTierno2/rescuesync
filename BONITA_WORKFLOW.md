# RescueSync: workflow web y cambios manuales de Bonita 2025.2

## Estado de esta entrega

La web y el backend implementan registro, publicación explícita, cobertura, decisión, visualización, adjudicación de ofertas completas, notificaciones por ONG, actividades, monitoreo y cierre. PostgreSQL conserva los datos y el historial. El BPMN no fue modificado.

**Punto de parada real comprobado el 12/09/2026:** la emergencia `b9aeba49-e250-43e4-b361-6f467cfef1f7` está vinculada al caso **2**, definición **6344068941249062927**, abierto en la tarea **4 — Registrar emergencia**. Su contrato desplegado tiene `inputs: []`. Se consultaron caso, tareas y contrato con autenticación real; no se ejecutó ni se creó una instancia. Esta definición todavía no satisface el contrato `emergenciaId` ni las correcciones posteriores descritas aquí.

El recorrido completo está probado con PostgreSQL y el servidor HTTP Bonita falso, y el recorrido desacoplado está probado con Playwright. Una prueba falsa no certifica los timers, conectores, actores ni gateways del motor real.

## Configuración y migración

Desde `backend`, ejecutar `npm.cmd run db:migrate` y `npm.cmd run build`. La migración `20260912000000_workflow` agrega rondas, ventanas, adjudicaciones, participaciones y acciones; vincula lotes existentes a una ronda inicial sin inferir publicación. Es aditiva. No alterar migraciones ya aplicadas.

La migración ya se aplicó en esta instalación: se conservaron **3 emergencias, 2 lotes, 4 ofertas y 5 usuarios**, con el vínculo al caso **2** intacto. Se crearon tres rondas iniciales y no quedaron lotes sin ronda. El historial previo conserva ofertas aunque su ronda inicial todavía no figure publicada; eso no habilita nuevas ofertas automáticamente.

Variables de `backend/.env`:

```dotenv
BONITA_ENABLED=false
BONITA_WORKFLOW_PROCESS_IDS=
BONITA_CALLBACK_SECRET=
OFERTAS_VALIDACION_MODE=PENDIENTE
```

- `BONITA_ENABLED=false` evita todas las llamadas Bonita. Permite publicación, visualización, adjudicación, lectura, actividad, monitoreo y cierre locales. Las decisiones y nuevas rondas por reformulación requieren Bonita. No hay timer ni routing local.
- `OFERTAS_VALIDACION_MODE=DESARROLLO` habilita explícitamente ofertas activas como disponibles para seleccionar, con aviso visible. `PENDIENTE` bloquea visualización confirmada/adjudicación. Ninguno implementa Sistema Nacional.
- `BONITA_WORKFLOW_PROCESS_IDS` es una lista separada por comas de **IDs de definiciones desplegadas y verificadas manualmente**, nunca IDs de casos. Por defecto vacía: bloquea los tramos posteriores al registro. Agregar un ID es una certificación operativa de los cambios de Studio, no una detección automática de topología. No agregar el ID del proceso antiguo para eludir el bloqueo.
- `BONITA_CALLBACK_SECRET`: secreto exclusivo de los conectores, al menos 32 caracteres. Los callbacks usan `Authorization: Bearer <secreto>`. No exponerlo en frontend, en contratos ni en logs.
- Conservar URL, cuenta técnica, contraseña e ID de instanciación Bonita ya configurados. Reiniciar el backend después de cambiar configuración. El selector web sigue siendo de desarrollo y no constituye autenticación real.

`npm.cmd run bonita:inspect` realiza solamente consultas de los últimos cinco casos vinculados. No ejecuta, asigna, migra ni inicia casos.

## Cambios manuales en Studio, en orden

Trabajar sobre una nueva versión de RescueSync. No modificar casos existentes ni iniciarlos de nuevo como recuperación. Una definición nueva se aplica a nuevas emergencias; las ya vinculadas siguen con su versión anterior.

### 1. Registro y contratos

Agregar variable de proceso `emergenciaId` (Text/String). En **Registrar emergencia**, contrato de un único input `emergenciaId`, TEXT, no múltiple, y operación para copiar el contrato a la variable. Mantener el contrato de instanciación vacío: Node inicia con `{}`, guarda `caseId`, y recién entonces completa el registro con el UUID local.

El backend valida estos contratos exactos; no agregar inputs obligatorios extra sin actualizarlo:

| Tarea | Contrato JSON |
|---|---|
| Registrar emergencia | `{ "emergenciaId": "UUID-local" }` |
| Generar y publicar lotes | `{}` |
| Decidir curso accion | `{ "cursoAccion": "REABRIR" }`, `REFORMULAR` o `PARCIAL` |
| Visualizar ofertas validas | `{}` |
| Seleccionar ofertas | `{ "ongDestinatarios": ["UUID-ONG-A", "UUID-ONG-B"] }` |
| Visualizar notificacion | `{}` |
| Monitorear despliegue | `{}` |
| Marcar actividad finalizada | `{}` |
| Cerrar operativo | `{}` |

### 2. Apertura y evaluación de convocatoria

Conservar **recibir ofertas** con timer de borde **interruptivo**; la web nunca completa esta tarea. Su antiguo input `lotesCubiertos` no alimenta el camino del timer y deja de ser la fuente de cobertura.

Agregar parámetro de duración en milisegundos, inicialmente `3600000`, usado tanto por el timer como por el conector de apertura. En pruebas reales se puede usar una duración menor, por ejemplo 10000 ms.

Al entrar a **recibir ofertas**, configurar un conector HTTP POST hacia:

```text
http://<backend-accesible-desde-Bonita>:3000/api/internal/bonita/emergencias/<emergenciaId>/convocatoria/abrir
```

Headers: `Content-Type: application/json` y `Authorization: Bearer <secreto>`.

```json
{
  "caseId": "ID-del-caso-como-texto",
  "actividadId": "ID-de-esta-instancia-de-recibir-ofertas-como-texto",
  "duracionMs": 3600000
}
```

Usar el selector de expresiones de Studio para obtener los IDs de instancia, no el ID estático del nodo. Guardar el `data.actividad_id` retornado en una variable de proceso Text `convocatoriaActividadId`; debe conservarse después de que el timer aborte la tarea. Cada reapertura genera una instancia distinta de recibir ofertas y por tanto una ventana distinta.

Insertar Service Task **Calcular cobertura** entre el timer y **Lotes cubiertos?**. Configurar POST a la misma ruta terminada en `/evaluar`:

```json
{
  "caseId": "ID-del-caso-como-texto",
  "actividadId": "valor-de-convocatoriaActividadId"
}
```

Respuesta: `{ "data": { "rondaId": "...", "lotes": [...], "lotesCubiertos": true } }`. Mapear `data.lotesCubiertos` a la variable de proceso Boolean existente. Configurar fallo del conector como fallo de actividad: **no continuar**, no valor predeterminado `false`, no catch que oculte el error. Solo el éxito permite evaluar el gateway.

El endpoint cierra la ventana y calcula cobertura bajo el mismo bloqueo PostgreSQL usado por ofertas. Rechaza evaluación anticipada y ofertas posteriores al vencimiento. Los reintentos con la misma actividad devuelven la misma ventana o snapshot; no vuelven a calcular la cobertura congelada.

Configurar expresiones booleanas de las salidas de **Lotes cubiertos?**: `lotesCubiertos` y `!lotesCubiertos`. Nunca enviar una oferta individual a Bonita.

### 3. Decisión y rondas

Reutilizar variable Text `cursoAccion`. Añadir input TEXT del mismo nombre en **Decidir curso accion**, operación de asignación y restricción que solo acepte los tres valores.

En **Unica decision**, reemplazar las actuales condiciones literales por scripts booleanos:

```groovy
cursoAccion == "REABRIR"
cursoAccion == "REFORMULAR"
cursoAccion == "PARCIAL"
```

Mantener destinos: recibir ofertas, Generar y publicar lotes, Validacion de ofertas, respectivamente. La web no interpreta el resultado para mover tokens. Si Bonita vuelve a Generar y publicar lotes con otra instancia de tarea, se habilita **Preparar nueva ronda**. Esa operación crea una ronda vacía; la anterior y sus ofertas quedan en el historial. REABRIR conserva la ronda y sus ofertas.

### 4. Adjudicación y tareas por ONG

En **Seleccionar ofertas**, input `ongDestinatarios` de tipo TEXT con **multiple=true**; copiarlo a una colección de proceso de strings. El backend deriva usuarios distintos de las ofertas adjudicadas; no acepta esa lista desde el navegador. Esta entrega identifica una ONG por `ong_usuario_id`.

Configurar **Visualizar notificacion** y **Marcar actividad finalizada** como multiinstancia paralela sobre esa colección, esperando todas las instancias (sin terminación anticipada). El iterador/local de cada instancia debe llamarse **ongUsuarioId**, tener valor UUID string y poder consultarse mediante `GET /API/bpm/activityVariable/<taskId>/ongUsuarioId`.

Comprobar esa consulta en dos instancias reales: deben compartir nombre pero devolver distintos destinatarios. Si el iterador no se expone directamente, declarar una variable Text local `ongUsuarioId` e inicializarla desde el iterador. La ausencia o ambigüedad bloquea la ejecución; Node nunca toma la primera tarea homónima.

Mapear la cuenta técnica a los actores Municipio, CentroCoordinador y ONG con los permisos necesarios. El backend consulta la sesión y no reasigna tareas que detecte asignadas a otro usuario. Los usuarios PostgreSQL no se convierten en cuentas Bonita. Las acciones web validan roles y pertenencia con el usuario de desarrollo seleccionado.

### 5. Monitoreo en paralelo y cierre

Después de **Adjudicacion completa**, añadir una bifurcación AND con dos ramas:

1. **Monitorear despliegue**, completada solo por el botón explícito del coordinador.
2. **Marcar actividad finalizada**, multiinstancia ONG, esperando todas.

Agregar unión AND de ambas ramas antes de **Registrar finalizacion → Liberar recursos → Cerrar operativo → Finalizacion**. Eliminar la conexión secuencial actual de Monitorear a Marcar actividad finalizada. La rama de notificaciones anterior también debe esperar todas las lecturas.

Las Service Tasks **Validacion de ofertas**, **Clasificacion de ofertas**, **Registrar compromiso de recursos**, **Registrar finalizacion**, **Liberar recursos** y **Notificar ONGs** actualmente no tienen conectores reales. Conservarlas como puntos de integración pendientes y marcarlas así en la documentación del proceso. No interpretar su paso como una llamada al Sistema Nacional ni como una notificación externa efectivamente enviada.

### 6. Verificación antes de habilitar

Validar y desplegar manualmente la nueva versión. Verificar actores, todos los contratos, expresiones booleanas, conector de apertura, snapshot previo al XOR, destinatarios multiinstancia y unión AND. Recién entonces configurar su nuevo ID en `BONITA_PROCESS_ID` y `BONITA_WORKFLOW_PROCESS_IDS`, junto con el secreto.

Probar una **nueva emergencia de prueba**: registro → publicación → ofertas de dos ONG → timer → cobertura/decisión → visualización y selección → lecturas individuales → monitoreo y actividades en ambos órdenes → cierre. Registrar los IDs observados. El éxito del cierre requiere que `GET /workflow` devuelva `COMPLETED`, sustentado en un caso archivado `state=completed` cuyo `sourceObjectId` sea el caseId original. Un array vacío de tareas no demuestra finalización.

## API web

Mantiene el sobre `{ data, warnings? }`. IDs Bonita son strings decimales, no números JavaScript. Acciones nuevas y altas de lotes/ofertas llevan `X-Dev-User-Id: <UUID>`; las ofertas deben pertenecer a ese usuario. El backend comprueba rol y, para operaciones municipales y ONG, pertenencia.

Bajo `/api/emergencias/:id`:

| Método y ruta | Uso |
|---|---|
| GET `/workflow` | Estado `DISABLED`, `UNLINKED`, `OPEN`, `COMPLETED` o `UNKNOWN`; tareas, destinatarios, rondas y acciones pendientes |
| GET `/cobertura` | Cobertura actual de la ronda vigente; no sustituye el snapshot del timer |
| GET `/monitoreo` | Emergencia, historial de rondas, lotes, ofertas/adjudicaciones y participación ONG |
| POST `/acciones/registrar` | Completar registro pendiente sobre el caso ya vinculado |
| POST `/acciones/publicar` | Publicación explícita, requiere lotes |
| POST `/acciones/decidir` | `cursoAccion` |
| POST `/acciones/ver-ofertas` | Confirmar visualización |
| POST `/acciones/adjudicar` | `ofertaIds: string[]`; completas, sin duplicados ni excedentes por lote |
| POST `/acciones/leer` | Lectura del destinatario ONG |
| POST `/acciones/finalizar-actividad` | Finalización de la ONG adjudicada |
| POST `/acciones/finalizar-monitoreo` | Confirmación del coordinador |
| POST `/acciones/cerrar` | Cierre local y ejecución de Cerrar operativo |
| POST `/acciones/nueva-ronda` | Cuerpo `{}`; solo cuando Bonita habilita una nueva tarea de reformulación |
| POST `/acciones/:accionId/reconciliar` | Cuerpo `{}`; consultar/reintentar exclusivamente la acción original |

Todas las acciones excepto las dos últimas requieren `accionId` UUID generado por el cliente; reusar el mismo UUID ante un resultado de red incierto, con exactamente la misma selección/decisión. La UI conserva el UUID mientras está abierta la confirmación y muestra las acciones persistidas pendientes tras refrescar. Si una solicitud nunca llegó al servidor no aparecerá en el registro; consultar antes de repetir.

Persistir datos de dominio y acción en una transacción breve. Tras commit, reclamar la acción para envío y ejecutar HTTP. Los resultados desconocidos nunca se reenvían automáticamente: la reconciliación busca la tarea **original** archivada. Un rechazo explícito puede reintentarse sobre su mismo taskId. Un timeout sin evidencia archivada permanece pendiente de inspección; no se busca una nueva tarea por nombre. No hay compensación destructiva ni segunda instanciación.

El cierre local puede quedar guardado mientras Bonita está pendiente. La web lo muestra y permite reconciliar; no afirma que el caso está archivado hasta comprobarlo en Bonita.

## Pruebas y fuentes

```powershell
cd backend
npm.cmd test
npm.cmd run build
cd ../frontend
npm.cmd run build
npm.cmd run test:e2e
```

Los tests usan una base `*_test` distinta de la aplicación y limpian solo sus propios registros. Playwright usa frontend **5174** y API **3001**, sin reemplazar los servicios de desarrollo en 5173/3000. El falso modela los cambios propuestos, avanza las ramas y archiva tareas/casos, pero no es una validación del `.proc` actual.

Referencias oficiales: [Bonita 2025.2 REST overview](https://documentation.bonitasoft.com/bonita/2025.2/api/rest-api-overview) y [OpenAPI 1.0.6](https://api-documentation.ofelia.com/1.0.6/). Se usan humanTask, userTask/contract, userTask/context, userTask/execution, activityVariable, case, archivedCase, archivedHumanTask y system/session, con sesión/cookies/CSRF/logout centralizados.

Cambiar `BONITA_ENABLED` no reproduce automáticamente acciones locales ya realizadas ni migra casos existentes. Ante una divergencia entre estado local y caso vinculado, inspeccionar y conciliar explícitamente sobre ese caso; nunca iniciar otro como recuperación.
