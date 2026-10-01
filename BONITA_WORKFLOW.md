# RescueSync: integración web ↔ Bonita (RescueSync 1.5)

## Fuente de verdad

El diagrama canónico es [`app/diagrams/MyDiagram-1.0.proc`](app/diagrams/MyDiagram-1.0.proc) — pool **RescueSync** versión **1.5**. La web y el backend se alinean a ese BPMN. No se altera el diagrama como parte de la Entrega 2.

## Flujo del proceso 1.5

```text
Ocurre emergencia
  → Registrar emergencia (Municipio, contrato emergenciaId)
  → Generar y publicar lotes
  → Cargar o editar ofertas (ONG) + BoundaryTimer interruptivo
       + connector ON_ENTER «Apertura de ofertas» → POST .../convocatoria/abrir
  → Obtener ofertas (service)
  → Validacion de ofertas (service, lane Sistema Nacional — sin conector real)
  → XOR Hay cobertura? (variable lotesCubiertos)
       sí → Adjudicar y notificar a ONG (service)
          → Registrar compromiso de recursos (service)
          → Monitorear despliegue (Centro coordinador)
          → Marcar actividad finalizada (ONG, multi-instancia ongUsuarioId)
          → Finalizacion
       no → Evaluar curso alternativo → Generar y publicar lotes
```

### Human tasks que la web completa vía API Bonita

| Acción web | Tarea Bonita | Rol app |
|---|---|---|
| `registrar` | Registrar emergencia | MUNICIPIO |
| `publicar` | Generar y publicar lotes | COORDINADOR |
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

Si el XOR sale por cobertura insuficiente, el token vuelve a `Generar y publicar lotes`. La web usa `POST .../acciones/nueva-ronda` cuando observa esa tarea distinta a la de la ronda publicada.

## Contratos

| Tarea | Contrato |
|---|---|
| Instanciación | `{}` |
| Registrar emergencia | `{ "emergenciaId": "<uuid>" }` |
| Generar y publicar lotes | `{}` |
| Monitorear despliegue | `{}` |
| Marcar actividad finalizada | `{}` |

## Callbacks de convocatoria

Headers: `Content-Type: application/json` y `Authorization: Bearer <BONITA_CALLBACK_SECRET>`.

### Apertura (ON_ENTER de Cargar o editar ofertas)

`POST /api/internal/bonita/emergencias/<emergenciaId>/convocatoria/abrir`

```json
{ "caseId": "<caseId>", "actividadId": "<taskInstanceId>", "duracionMs": 120000 }
```

En el `.proc` el timer está en **120000 ms** (2 minutos). Guardar `actividad_id` en `convocatoriaActividadId` si Studio lo mapea.

### Evaluación (debe alimentar `lotesCubiertos` antes del XOR)

`POST /api/internal/bonita/emergencias/<emergenciaId>/convocatoria/evaluar`

```json
{ "caseId": "<caseId>", "actividadId": "<convocatoriaActividadId>" }
```

Respuesta: `{ "data": { "rondaId": "...", "lotes": [...], "lotesCubiertos": true|false } }`.

**Operativo:** verificar en Studio que el conector previo al XOR mapea `data.lotesCubiertos` a la variable de proceso Boolean. Sin ese mapeo el gateway no refleja la cobertura real. El backend ya expone `/evaluar`; no modifica el BPMN.

## Variables de proceso relevantes

| Variable | Uso |
|---|---|
| `emergenciaId` | UUID local |
| `lotesCubiertos` | Condición del XOR |
| `convocatoriaActividadId` | Sobrevive al aborto del timer |
| `ongDestinatarios` | Colección multi-instancia de `Marcar actividad finalizada` |
| `cursoAccion` | Declarada en el `.proc`; no hay Human Task que la consuma en 1.5 |

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
- `BONITA_WORKFLOW_PROCESS_IDS`: IDs de definiciones **verificadas** (RescueSync 1.5 desplegado). Vacío bloquea tramos posteriores al registro.
- `OFERTAS_VALIDACION_MODE=DESARROLLO`: permite ver/adjudicar sin Sistema Nacional. Entrega 3 reemplazará esto.
- Auth de la app: JWT (`Authorization: Bearer`). En tests, `AUTH_ALLOW_DEV_HEADER` / `NODE_ENV=test` acepta `X-Dev-User-Id`.

`npm run bonita:inspect` solo consulta casos vinculados.

## Certificación contra Bonita real

Checklist operativo (no automatizado por los tests con stub):

1. Desplegar RescueSync 1.5 desde Studio.
2. Confirmar contrato `emergenciaId` en Registrar emergencia.
3. Confirmar connector de apertura y mapeo de `/evaluar` → `lotesCubiertos`.
4. Confirmar multi-instancia `ongUsuarioId` en Marcar actividad finalizada.
5. Cargar el process definition id en `BONITA_PROCESS_ID` y `BONITA_WORKFLOW_PROCESS_IDS`.
6. Probar emergencia nueva: registro → publicar → ofertas → timer → cobertura → adjudicación local → monitoreo/actividades → cierre local y caso archivado `COMPLETED`.

Los tests (`backend/tests` + stub HTTP) cubren el contrato de la app alineado a 1.5; **no** certifican timers/conectores del motor real.

## API de workflow (resumen)

Bajo `/api/emergencias/:id`, con JWT:

| Ruta | Notas |
|---|---|
| GET `/workflow` | Estado, tareas ready, acciones disponibles |
| GET `/cobertura` / `/monitoreo` | Cobertura y historial |
| POST `/acciones/registrar\|publicar\|ver-ofertas\|adjudicar\|leer\|finalizar-actividad\|finalizar-monitoreo\|cerrar` | Ver tablas arriba |
| POST `/acciones/nueva-ronda` | Reformulación |
| POST `/acciones/:accionId/reconciliar` | Reintento/consulta |

## Service Tasks Sistema Nacional

`Validacion de ofertas`, `Adjudicar y notificar a ONG`, `Registrar compromiso de recursos` (y futuros cierre/liberación) son puntos de integración de la **Entrega 3**. No interpretar su paso automático como llamada real al Sistema Nacional.
