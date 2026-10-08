# RescueSync: integración web ↔ Bonita (RescueSync 1.6)

## Actualización 1.6: curso alternativo

El diagrama de Studio incorpora `Evaluar curso alternativo` como tarea humana de
`CentroCoordinador`. Su contrato recibe `decisionCurso` (TEXT), restringido a
`CONTINUAR_PARCIAL`, `REABRIR` o `REFORMULAR`; una operación lo asigna a `cursoAccion`.

La web presenta las tres opciones al coordinador cuando Bonita tiene esa tarea
disponible. `POST /api/emergencias/:id/acciones/decidir` recibe
`{ "accionId": "<uuid>", "decisionCurso": "REABRIR" }`. La decisión se registra y
se ejecuta con el mismo mecanismo de reconciliación de las otras tareas humanas.

- **Continuar parcialmente:** requiere ofertas y una evaluación cerrada con
  cobertura insuficiente. Después de confirmar la decisión en Bonita, el municipio
  puede seleccionar y adjudicar las ofertas disponibles.
- **Reabrir:** vuelve a `Cargar o editar ofertas`; su conector de entrada abre otra
  ventana sobre la misma ronda. Conserva lotes y ofertas activas. La evaluación
  anterior sigue congelada y la nueva ventana se identifica por otro ID de actividad.
- **Reformular:** vuelve a `Generar y publicar lotes`. El coordinador usa
  `Preparar nueva ronda`, carga los lotes y publica; la ronda anterior queda en el historial.

Con Bonita habilitado, la selección se bloquea mientras se reciben ofertas,
se espera la decisión o se reformulan lotes. Requiere evaluación cerrada y cobertura
completa o decisión confirmada de continuar parcialmente para la ventana vigente.
El modo sin Bonita conserva el recorrido local existente.

Los conectores `/abrir` y `/evaluar` deben guardar respectivamente
`data.actividad_id` en `convocatoriaActividadId` y `data.lotesCubiertos` en
`lotesCubiertos`. `/evaluar` recibe el ID guardado, no el de la tarea de evaluación.
Después de desplegar 1.6, hay que configurar sus IDs en el backend y crear un caso
nuevo; los casos anteriores conservan su definición.

Las pruebas con motor simulado verifican las tres decisiones, roles, rechazo de
valores inválidos, conservación de datos y reintentos. No certifican el despliegue
real. `Monitorear despliegue` recibe `ongDestinatariosInput` (TEXT, múltiple) y lo
asigna a `ongDestinatarios` en sus operaciones. El backend obtiene la lista sin
duplicados de las participaciones adjudicadas de la ronda vigente, la persiste en
el contrato de la acción y la envía al finalizar el monitoreo. El navegador no
puede elegir los destinatarios. Los contratos vacíos de versiones anteriores
siguen recibiendo `{}`.

Después del monitoreo, `Marcar actividad finalizada` crea instancias paralelas a
partir de `ongDestinatarios`, con iterador String `ongUsuarioId`. En 1.6 las ONG
finalizan sus actividades después de que el coordinador finaliza el monitoreo.

La descripción siguiente corresponde al diagrama 1.6. Para levantar ambos sistemas
y distinguir las pruebas locales de la integración pendiente, ver
[PRUEBAS_INTEGRACION.md](PRUEBAS_INTEGRACION.md).

## Fuente de verdad

El diagrama canónico es [`app/diagrams/MyDiagram-1.0.proc`](app/diagrams/MyDiagram-1.0.proc) — pool **RescueSync** versión **1.6** (el nombre del archivo conserva 1.0).

## Flujo del proceso 1.6

```text
Ocurre emergencia
  → Registrar emergencia (Municipio, contrato emergenciaId)
  → Generar y publicar lotes
  → Cargar o editar ofertas (ONG) + BoundaryTimer interruptivo
       + connector ON_ENTER «Apertura de ofertas» → POST .../convocatoria/abrir
  → Obtener ofertas (service)
  → Validacion de ofertas (service, evalúa cobertura en el backend local; aún sin API nacional)
  → XOR Hay cobertura? (variable lotesCubiertos)
       sí → Adjudicar y notificar a ONG (service)
          → Registrar compromiso de recursos (service)
          → Monitorear despliegue (Centro coordinador)
          → Marcar actividad finalizada (ONG, multi-instancia ongUsuarioId)
          → Finalizacion
       no → Evaluar curso alternativo (CentroCoordinador)
          → REFORMULAR → Generar y publicar lotes
          → REABRIR → Cargar o editar ofertas
          → CONTINUAR_PARCIAL → Adjudicar y notificar a ONG
```

### Human tasks que la web completa vía API Bonita

| Acción web | Tarea Bonita | Rol app |
|---|---|---|
| `registrar` | Registrar emergencia | MUNICIPIO |
| `publicar` | Generar y publicar lotes | COORDINADOR |
| `decidir` | Evaluar curso alternativo | COORDINADOR |
| `finalizar-monitoreo` | Monitorear despliegue | COORDINADOR |
| `finalizar-actividad` | Marcar actividad finalizada | ONG |

La web **nunca** completa `Cargar o editar ofertas`: el timer de borde la aborta. Las ofertas viven en PostgreSQL durante la ventana abierta por el conector.

### Acciones solo locales (PostgreSQL, sin human task Bonita)

| Acción | Uso |
|---|---|
| `ver-ofertas` | Municipio confirma visualización (modo `DESARROLLO`) |
| `adjudicar` | Selección de ofertas en Postgres; el Service Task BPM es placeholder |
| `leer` | ONG confirma lectura de adjudicación |
| `cerrar` | Cierre local del operativo cuando monitoreo + actividades ONG terminaron |

### Reformulación

Si el coordinador elige `REFORMULAR`, el token vuelve a `Generar y publicar lotes`. La web usa `POST .../acciones/nueva-ronda` cuando observa esa tarea distinta a la de la ronda publicada. `REABRIR` conserva la ronda y abre otra ventana; `CONTINUAR_PARCIAL` habilita la selección local.

## Contratos

| Tarea | Contrato |
|---|---|
| Instanciación | `{}` |
| Registrar emergencia | `{ "emergenciaId": "<uuid>" }` |
| Generar y publicar lotes | `{}` |
| Evaluar curso alternativo | `{ "decisionCurso": "CONTINUAR_PARCIAL\|REABRIR\|REFORMULAR" }` (elegir un valor) |
| Monitorear despliegue | `{ "ongDestinatariosInput": ["<uuid ONG adjudicada>"] }` |
| Marcar actividad finalizada | `{}` |

## Callbacks de convocatoria

Headers: `Content-Type: application/json` y `Authorization: Bearer <BONITA_CALLBACK_SECRET>`.

### Apertura (ON_ENTER de Cargar o editar ofertas)

`POST /api/internal/bonita/emergencias/<emergenciaId>/convocatoria/abrir`

```json
{ "caseId": "<caseId>", "actividadId": "<taskInstanceId>", "duracionMs": 120000 }
```

En el `.proc` el timer está en **120000 ms** (2 minutos). El conector guarda `data.actividad_id` en `convocatoriaActividadId`.

### Evaluación (debe alimentar `lotesCubiertos` antes del XOR)

`POST /api/internal/bonita/emergencias/<emergenciaId>/convocatoria/evaluar`

```json
{ "caseId": "<caseId>", "actividadId": "<convocatoriaActividadId>" }
```

Respuesta: `{ "data": { "rondaId": "...", "lotes": [...], "lotesCubiertos": true|false } }`.

El conector `Evaluar cobertura`, en `Validacion de ofertas`, mapea `data.lotesCubiertos` a la variable Boolean. Esto calcula cobertura local; no verifica certificaciones ni disponibilidad nacional. Confirmar su ejecución en Studio tras desplegar.

## Variables de proceso relevantes

| Variable | Uso |
|---|---|
| `emergenciaId` | UUID local |
| `lotesCubiertos` | Condición del XOR |
| `convocatoriaActividadId` | Sobrevive al aborto del timer |
| `ongDestinatarios` | Colección multi-instancia de `Marcar actividad finalizada` |
| `cursoAccion` | Recibe `decisionCurso` y dirige el gateway de curso alternativo |

## Actores Bonita vs roles app

| Actor Bonita | Rol app |
|---|---|
| Municipio | MUNICIPIO |
| CentroCoordinador | COORDINADOR |
| ONG | ONG |

La cuenta técnica Bonita se mapea a los tres actores. Los usuarios JWT de PostgreSQL no son usuarios Bonita. Publicar lotes en la app exige **COORDINADOR** (Centro Coordinador del enunciado), aunque la lane del diagrama diga Municipio: el motor usa la cuenta técnica.

## Configuración

```dotenv
BONITA_ENABLED=false
BONITA_PROCESS_ID=
BONITA_WORKFLOW_PROCESS_IDS=
BONITA_CALLBACK_SECRET=
OFERTAS_VALIDACION_MODE=DESARROLLO
JWT_SECRET=change-me-rescuesync-jwt-secret-32c
```

- `BONITA_ENABLED=false`: flujo local sin motor. `nueva-ronda` y timers reales requieren Bonita.
- `BONITA_WORKFLOW_PROCESS_IDS`: IDs de definiciones **verificadas** (RescueSync 1.6 desplegado). Vacío bloquea tramos posteriores al registro.
- `OFERTAS_VALIDACION_MODE=DESARROLLO`: permite ver/adjudicar sin Sistema Nacional. Entrega 3 reemplazará esto.
- Auth de la app: JWT (`Authorization: Bearer`). En tests, `AUTH_ALLOW_DEV_HEADER` / `NODE_ENV=test` acepta `X-Dev-User-Id`.

`npm run bonita:inspect` solo consulta casos vinculados.

## Certificación contra Bonita real

Checklist operativo (no automatizado por los tests con stub):

1. Validar y desplegar RescueSync 1.6 desde Studio; crear casos nuevos para esta versión.
2. Confirmar contrato `emergenciaId` en Registrar emergencia.
3. Confirmar connector de apertura y mapeo de `/evaluar` → `lotesCubiertos`.
4. Confirmar contrato `decisionCurso`, sus tres ramas, contrato `ongDestinatariosInput` del monitoreo y multi-instancia `ongUsuarioId` en Marcar actividad finalizada.
5. Cargar el process definition id en `BONITA_PROCESS_ID` y `BONITA_WORKFLOW_PROCESS_IDS`.
6. Probar emergencia nueva: registro → publicar → ofertas → timer → cobertura → adjudicación local → monitoreo/actividades → cierre local y caso archivado `COMPLETED`.

Los tests (`backend/tests` + stub HTTP) cubren el contrato de la app, incluidas las tres decisiones de 1.6; **no** certifican timers/conectores del motor real.

## API de workflow (resumen)

Bajo `/api/emergencias/:id`, con JWT:

| Ruta | Notas |
|---|---|
| GET `/workflow` | Estado, tareas ready, acciones disponibles |
| GET `/cobertura` / `/monitoreo` | Cobertura y historial |
| POST `/acciones/registrar\|publicar\|decidir\|ver-ofertas\|adjudicar\|leer\|finalizar-actividad\|finalizar-monitoreo\|cerrar` | Ver tablas arriba |
| POST `/acciones/nueva-ronda` | Reformulación |
| POST `/acciones/:accionId/reconciliar` | Reintento/consulta |

## Service Tasks Sistema Nacional

`Validacion de ofertas`, `Adjudicar y notificar a ONG`, `Registrar compromiso de recursos` (y futuros cierre/liberación) son puntos de integración de la **Entrega 3**. No interpretar su paso automático como llamada real al Sistema Nacional.
