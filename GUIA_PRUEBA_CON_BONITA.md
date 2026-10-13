# Guía de prueba — modo con Bonita

Recorrido manual de la **aplicación web + PostgreSQL + motor Bonita** (proceso RescueSync 1.5).

Usá esta guía **después** de haber verificado el modo local: [GUIA_PRUEBA_SIN_BONITA.md](GUIA_PRUEBA_SIN_BONITA.md).

Detalle técnico del BPM: [BONITA_WORKFLOW.md](BONITA_WORKFLOW.md). Sistema Nacional sigue **sin** implementar (`OFERTAS_VALIDACION_MODE=DESARROLLO`).

---

## Qué demuestra este modo

| Incluye | Sigue siendo local en la app |
|---|---|
| Instancia de caso al crear emergencia | Ver ofertas / adjudicar |
| Completar human tasks vía API | Confirmar lectura ONG |
| Timer de convocatoria + callbacks | Cierre operativo local |
| Monitorear / Marcar actividad en Bonita | Stub de validación SN (`DESARROLLO`) |
| Caso hacia `COMPLETED` (si el BPM cierra bien) | — |

La web **nunca** completa la tarea `Cargar o editar ofertas`: el **timer** la aborta.

---

## 0. Prerrequisitos

1. Modo sin Bonita ya funciona en tu máquina.
2. Bonita Community **2025.2** (o compatible) con Portal accesible (típico `http://localhost:8080/bonita`).
3. Proceso **RescueSync 1.6** desplegado desde Studio (`app/diagrams/MyDiagram-1.0.proc`).
4. **Tres usuarios Bonita** (`rs.municipio`, `rs.coordinador`, `rs.ong`) creados y mapeados 1:1 a actores — ver [BONITA_USUARIOS_LOCAL.md](BONITA_USUARIOS_LOCAL.md). No usar `walter.bates`.
5. Backend alcanzable **desde el JVM de Bonita** para los conectores HTTP (en local suele ser `http://host.docker.internal:3000` o la IP de tu máquina; en el `.proc` de ejemplo aparece `localhost:3000` — ajustá en Studio si Bonita corre en otro host).

### Checklist Studio antes de probar

- [ ] Contrato de **Registrar emergencia**: input `emergenciaId`
- [ ] Instanciación con contrato vacío `{}`
- [ ] Connector ON_ENTER de apertura → `POST .../convocatoria/abrir` con Bearer
- [ ] Antes del XOR **Hay cobertura?**: `lotesCubiertos` alimentado desde `/evaluar` (o equivalente)
- [ ] Multi-instancia **Marcar actividad finalizada** con `ongUsuarioId`
- [ ] Timer de borde en **Cargar o editar ofertas** (en el `.proc`: 120000 ms = 2 min)

---

## 1. Configurar `.env` del backend

```dotenv
BONITA_ENABLED=true
BONITA_URL=http://localhost:8080/bonita
BONITA_USER_MUNICIPIO=rs.municipio
BONITA_PASS_MUNICIPIO=<password>
BONITA_USER_COORDINADOR=rs.coordinador
BONITA_PASS_COORDINADOR=<password>
BONITA_USER_ONG=rs.ong
BONITA_PASS_ONG=<password>
BONITA_PROCESS_ID=<id_definicion_rescueSync>
BONITA_WORKFLOW_PROCESS_IDS=<mismo_id_o_lista_certificada>
BONITA_CALLBACK_SECRET=<secreto_de_al_menos_32_caracteres>
BONITA_TIMEOUT_MS=10000
OFERTAS_VALIDACION_MODE=DESARROLLO
JWT_SECRET=change-me-rescuesync-jwt-secret-32c
DATABASE_URL="postgresql://rescuesync:rescuesync@localhost:5432/rescuesync"
```

### De dónde sacar cada valor

| Variable | Origen |
|---|---|
| `BONITA_URL` | URL del Portal/API |
| `BONITA_USER_*` / `BONITA_PASS_*` | Tres usuarios por actor ([BONITA_USUARIOS_LOCAL.md](BONITA_USUARIOS_LOCAL.md)) |
| `BONITA_PROCESS_ID` | ID de la **definición** desplegada (Processes en Portal), **no** el caseId |
| `BONITA_WORKFLOW_PROCESS_IDS` | Mismo ID (o varios certificados separados por coma). Vacío = bloquea tramos post-registro |
| `BONITA_CALLBACK_SECRET` | Lo inventás vos; **igual** en `.env` y en los conectores Studio (`Authorization: Bearer …`) |

Reiniciá el backend después de cambiar el `.env`.

```bash
cd backend
npm run dev
```

Frontend igual que siempre (`npm run dev` en `frontend/`).

Comprobación opcional (solo consulta):

```bash
cd backend
npm run bonita:inspect
```

---

## 2. Municipio — alta + registro en Bonita

1. Login `municipio@rescuesync.test` / `demo1234`.
2. Registrar emergencia nueva (zona distinta a pruebas anteriores).
3. En el detalle:
   - **Esperado:** aparece un **Caso #<id>** (ya no “Sin vínculo”).
4. Si hay botón **Completar registro en Bonita** / acción `registrar` pendiente → confirmarla.
5. En Portal Bonita: el caso debe avanzar hacia **Generar y publicar lotes** (o equivalente ready).

Si el alta guarda la emergencia pero muestra **advertencia** Bonita: no repitas el alta a ciegas; inspeccioná el caso / logs.

---

## 3. Coordinador — lotes y publicar (tarea Bonita)

1. Login `coordinador@rescuesync.test`.
2. Crear los dos lotes (1000 raciones, 5 paramédicos) como en la guía sin Bonita.
3. **Publicar convocatoria** → confirmar.
4. **Esperado en web:** ronda publicada; posible ventana con vencimiento real.
5. **Esperado en Bonita:** tras publicar, el token entra a **Cargar o editar ofertas** y el connector llama a `/convocatoria/abrir`.

Si `BPMN_INCOMPATIBLE` o no aparecen acciones posteriores al registro: revisá `BONITA_WORKFLOW_PROCESS_IDS` y el secreto de callback.

---

## 4. ONG — ofertas dentro de la ventana

1. Login `ong.a@rescuesync.test` (y opcionalmente ONG B).
2. Cargar ofertas **antes** de que venza el timer (en el diagrama: ~2 minutos).
3. **No** busques un botón web que “complete” Cargar o editar ofertas: eso lo hace el timer.

Si la ventana ya cerró, las nuevas ofertas deben rechazarse.

---

## 5. Esperar el timer y la cobertura

1. Esperá el vencimiento del BoundaryTimer (o usá una duración corta en Studio para demos).
2. Bonita debe llamar `/convocatoria/evaluar` y setear `lotesCubiertos`.
3. XOR:
   - **Con cobertura** → caminos de service → luego **Monitorear despliegue** y **Marcar actividad finalizada**.
   - **Sin cobertura** → vuelve hacia **Generar y publicar lotes** → en la web puede habilitarse **Preparar nueva ronda**.

En la web: **Actualizar estado** en el panel Estado Bonita y anotar tareas ready.

---

## 6. Municipio — adjudicación local

Aunque Bonita tenga Service Task de adjudicación (placeholder), la selección municipal es en la **app**:

1. Login municipio.
2. Con `DESARROLLO`: **Continuar a selección** → elegir ofertas → **Confirmar adjudicación**.
3. Eso deja participaciones ONG en Postgres (necesarias para el resto del flujo web).

---

## 7. ONG — lectura (local) y finalizar actividad (Bonita)

1. Login ONG adjudicada.
2. **Confirmar lectura** (acción local).
3. Cuando exista la human task **Marcar actividad finalizada** para esa ONG:
   - **Marcar actividad finalizada** → confirmar.
4. Si hay dos ONG, repetí con la segunda.

En Portal: las instancias multi-instancia de esa tarea deben ir completándose.

---

## 8. Coordinador — monitoreo (Bonita) y cierre local

1. Login coordinador.
2. Cuando la tarea **Monitorear despliegue** esté ready: **Finalizar monitoreo** → confirmar.
3. Cuando monitoreo + todas las actividades ONG estén listas: **Cerrar operativo** (cierre **local** en Postgres).
4. **Actualizar estado**:
   - `localClosed` = sí
   - Idealmente estado Bonita `COMPLETED` (caso archivado). Un listado vacío de tareas **no** alcanza por sí solo; ver criterio en BONITA_WORKFLOW.md.

---

## 9. Auditor

Igual que en la guía sin Bonita: solo lectura en `/auditoria` y detalle.

---

## Checklist de éxito (con Bonita)

- [ ] `.env` con IDs + secreto; backend reiniciado
- [ ] Alta crea `caseId` visible en el detalle
- [ ] `registrar` / `publicar` sincronizan human tasks
- [ ] Callback `/abrir` al entrar a convocatoria
- [ ] Ofertas dentro de la ventana; rechazo si ya venció
- [ ] Tras timer, XOR coherente con cobertura
- [ ] Adjudicación local + participaciones
- [ ] Lectura local + `Marcar actividad finalizada` en Bonita
- [ ] `Monitorear despliegue` en Bonita
- [ ] Cierre local; caso preferentemente `COMPLETED`

---

## Problemas frecuentes

| Síntoma | Qué revisar |
|---|---|
| Alta OK pero sin caso | Credenciales Bonita, process id, motor arriba, logs backend |
| `BPMN_INCOMPATIBLE` | `BONITA_WORKFLOW_PROCESS_IDS` debe incluir el process definition id real |
| `CALLBACK_UNAUTHORIZED` / no abre ventana | Mismo `BONITA_CALLBACK_SECRET` en `.env` y Studio; URL del connector alcanzable desde Bonita |
| Timer no evalúa cobertura | Connector `/evaluar` y mapeo a `lotesCubiertos` |
| No aparece Marcar actividad | Adjudicación local hecha; multi-instancia/`ongUsuarioId`; Actualizar estado |
| Cierre local pero caso no COMPLETED | Faltan tareas Bonita; o el BPM no archiva aún — inspeccionar Portal |
| Confusión con SN | Normal: Entrega 3; usá `DESARROLLO` solo para demo |

---

## Orden recomendado de demo ante el grupo / cátedra

1. Mostrar primero [modo sin Bonita](GUIA_PRUEBA_SIN_BONITA.md) (app completa).
2. Luego este modo: Portal + panel Estado Bonita + mismos roles.
3. Aclarar: Sistema Nacional diferido ([ENTREGA3.md](ENTREGA3.md)).
