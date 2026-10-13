# Usuarios Bonita por actor (setup local)

Cada humano del proceso RescueSync se completa con **un usuario Bonita distinto**. Ya no se usa `walter.bates` para los tres actores.

Los usuarios JWT de la app web (Postgres) **no** son usuarios Bonita. El backend inicia sesión en Bonita con la cuenta del actor según la tarea.

## Usuarios a crear (Portal / Organization)

Crear en Bonita Organization (Portal → Organization → Users, o desde Studio):

| Usuario Bonita | Password (lab) | Actor mapeado |
|---|---|---|
| `rs.municipio` | el que acuerde el equipo (ej. `bpm`) | Municipio + Employee (initiator) |
| `rs.coordinador` | idem | CentroCoordinador |
| `rs.ong` | idem | ONG |

Permisos: poder ejecutar human tasks de su actor. No hace falta perfil administrador.

**Sistema Nacional no lleva usuario Bonita** (lane de Service Tasks / API externa).

## Actor mapping (Studio)

1. Abrir el proceso **RescueSync** en Bonita Studio (`app/diagrams/MyDiagram-1.0.proc`).
2. Configuration → Production → Actor mapping:
   - **Employee actor** → `rs.municipio`
   - **Municipio** → `rs.municipio`
   - **CentroCoordinador** → `rs.coordinador`
   - **ONG** → `rs.ong`
3. Quitar cualquier referencia a `walter.bates`.
4. La tarea **Generar y publicar lotes** usa actor **CentroCoordinador** (override de lane), aunque visualmente siga en la lane Municipio en el diagrama.
5. Validar configuración → **Deploy**.
6. Anotar el nuevo **process definition id** (Portal → Processes).

Casos creados con el mapping anterior **no** sirven: probar solo con casos nuevos.

## Variables en `backend/.env`

```dotenv
BONITA_ENABLED=true
BONITA_URL=http://localhost:8080/bonita
BONITA_USER_MUNICIPIO=rs.municipio
BONITA_PASS_MUNICIPIO=<password>
BONITA_USER_COORDINADOR=rs.coordinador
BONITA_PASS_COORDINADOR=<password>
BONITA_USER_ONG=rs.ong
BONITA_PASS_ONG=<password>
BONITA_PROCESS_ID=<id_definicion>
BONITA_WORKFLOW_PROCESS_IDS=<mismo_id>
BONITA_CALLBACK_SECRET=<secreto_conector_≥32>
```

`BONITA_USERNAME` / `BONITA_PASSWORD` **ya no existen**. Reiniciar el backend tras cambiar el `.env`.

## Quién ejecuta qué (backend → Bonita)

| Acción app / tarea | Usuario Bonita |
|---|---|
| Inicio de caso + Registrar emergencia | `rs.municipio` |
| Generar y publicar lotes, Evaluar curso alternativo, Monitorear despliegue | `rs.coordinador` |
| Marcar actividad finalizada | `rs.ong` |
| Lectura de tareas ready (`inspect`) | merge de los tres logins |
| Conectores `/abrir` y `/evaluar` | `BONITA_CALLBACK_SECRET` (no es usuario-actor) |

## Verificación rápida en Portal

1. Login como `rs.municipio`: solo debería poder tomar tareas del actor Municipio.
2. Idem `rs.coordinador` / `rs.ong`.
3. Recorrido web: registrar → publicar → ofertas → timer → adjudicación local → monitoreo / finalizar → cierre.

Detalle de flujo: [BONITA_WORKFLOW.md](BONITA_WORKFLOW.md). Prueba guiada: [GUIA_PRUEBA_CON_BONITA.md](GUIA_PRUEBA_CON_BONITA.md).
