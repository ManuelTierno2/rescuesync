# Actualizaci?n: acciones de workflow

La pantalla de detalle incluye Estado Bonita, publicaci?n, decisi?n del coordinador, selecci?n municipal, notificaciones y actividades ONG, monitoreo y cierre. Ver [la gu?a de workflow](../BONITA_WORKFLOW.md) para configuraci?n y requisitos manuales de Studio.

Con Bonita deshabilitado y validaci?n de desarrollo expl?cita: crear emergencia, guardar lotes, **Publicar convocatoria**, cargar ofertas, **Continuar a selecci?n**, adjudicar ofertas completas, confirmar lectura, finalizar actividades y monitoreo y cerrar. El frontend de pruebas Playwright usa **5174**; el frontend de desarrollo conserva **5173**. Las credenciales y el secreto de conectores permanecen en Node.

# RescueSync — interfaz de Etapa 2

Aplicación React + Vite + TypeScript, con React Router, Fetch y CSS responsive. Permite probar Municipio → Coordinador → ONG sobre el backend y PostgreSQL existentes.

## Ejecutar

Requiere Node.js 24.x, el backend instalado, migrado y su seed actualizado. En PowerShell usar `npm.cmd` si la política de ejecución bloquea `npm.ps1`; en otros entornos usar `npm`.

Terminal 1, desde la raíz del repositorio:

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

`frontend/.env`:

```dotenv
VITE_API_URL=http://localhost:3000/api
```

Abrir **http://localhost:5173**. Vite usa el puerto 5173 y falla si está ocupado para mantener coherencia con CORS. El backend usa el puerto 3000 y conserva su configuración PostgreSQL.

Para instalaciones repetibles con el lockfile existente usar `npm.cmd ci`. No colocar contraseñas Bonita en el frontend: todas las variables `VITE_*` se incluyen en el cliente.

## Usuarios y navegación

La franja superior dice **Modo desarrollo · Sin autenticación real**. El selector obtiene los usuarios de `GET /api/usuarios` y guarda únicamente su ID en `localStorage`. El rol se obtiene de la respuesta de la API. Si no hay selección válida, se puede consultar pero no se habilitan formularios.

| Rol | Acciones visuales |
|---|---|
| MUNICIPIO | Listar, consultar y registrar emergencias. |
| COORDINADOR | Listar, consultar y crear lotes. |
| ONG | Consultar y ofrecer sobre cada lote. |
| AUDITOR | Consultar únicamente. |

Se incluyen un municipio, un coordinador, ONG A, ONG B y un auditor. El seed puede repetirse sin sobrescribir usuarios existentes. Ocultar acciones no autentica a nadie: los endpoints siguen siendo públicos y validan las reglas de negocio en el backend.

Rutas: `/` redirige a `/emergencias`; `/emergencias/nueva` contiene el alta municipal; `/emergencias/:id` muestra datos, lotes y ofertas. Las restricciones visuales también se aplican al entrar directamente a una ruta o cambiar de usuario.

## Probar el flujo completo

1. Seleccionar **MUNICIPIO · Municipio de prueba** y pulsar **Registrar emergencia**.
2. Elegir gravedad ALTA, zona La Plata y una descripción. Guardar; la aplicación abre el detalle.
3. Cambiar a **COORDINADOR · Centro Coordinador**.
4. Crear un lote RECURSO: descripción “Raciones de alimento”, cantidad 1000, unidad “raciones”.
5. Crear un lote PERSONAL: descripción “Paramédicos”, cantidad 5, unidad “personas”.
6. Los lotes aparecen inmediatamente; crear un lote también lo publica.
7. Cambiar a **ONG · ONG A**. En raciones, ofrecer 400 y completar observaciones; en paramédicos, ofrecer 2.
8. Comprobar las ofertas debajo de cada lote. Cambiar a ONG B para registrar otra oferta si se desea.
9. Cambiar a **AUDITOR** y comprobar que puede consultar, sin formularios de escritura.
10. Refrescar: la selección permanece y los registros se recuperan de PostgreSQL. Volver al listado y abrir el detalle nuevamente.

Las cantidades son enteras positivas. Se aceptan ofertas parciales y varias ofertas por lote, incluso de la misma ONG. La unidad es texto libre de hasta 50 caracteres. Los errores del backend se muestran en el formulario y asociados al campo correspondiente. Los botones quedan deshabilitados durante el envío.

## Bonita

La configuración está exclusivamente en `backend/.env`:

```dotenv
BONITA_ENABLED=false
BONITA_URL=http://localhost:8080/bonita
BONITA_USERNAME=
BONITA_PASSWORD=
BONITA_PROCESS_ID=
BONITA_TIMEOUT_MS=10000
```

Con `false` el flujo funciona sin Bonita. Con `true`, el backend guarda la emergencia, autentica su conexión con Bonita Community 2025.2, inicia RescueSync y guarda el `caseId`. El usuario técnico debe existir en Bonita y poder iniciar la definición desplegada elegida. Obtener su ID en la administración del motor o mediante la consulta REST documentada en el [README del backend](../backend/README.md#bonita-community-20252-conexión-e-inicio-real).

El detalle muestra el identificador de instancia o **Sin vínculo registrado**. Si la integración falla después del guardado, el alta sigue siendo exitosa y el detalle muestra una advertencia. **No repetir el alta**: ante timeout la instancia podría existir. Las advertencias vienen de la respuesta del alta y no son un historial persistido.

La implementación sigue la [documentación oficial Bonitasoft 2025.2](https://documentation.bonitasoft.com/bonita/2025.2/api/rest-api-overview), su referencia REST 1.0.6 y su documentación CSRF. No gestiona human tasks, timers ni Sistema Nacional.

## Verificaciones

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run preview
```

El build comprueba TypeScript antes de generar `dist/`. Preview también usa el puerto 5173. Para servir el build con otro servidor, configurar la reescritura de rutas de la SPA hacia `index.html` y permitir el origen elegido en el backend.

Pruebas de navegador con Chromium:

```powershell
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

Estas pruebas leen `TEST_DATABASE_URL` del backend y exigen una base separada terminada en `_test`. Levantan una API temporal en 3001 con Bonita deshabilitado y Vite en 5173; ambos puertos deben estar libres. Preparan el seed, recorren el flujo completo, verifican persistencia y roles, prueban validaciones y simulan una advertencia en la respuesta HTTP para comprobar su presentación. Eliminan solo las emergencias de su ejecución y sus lotes/ofertas. No ejecutar al mismo tiempo la suite del backend sobre esa base.

Las capturas de escritorio y móvil se guardan en `test-results/`, ignorado por Git. Las pruebas de conexión Bonita y resultados parciales con PostgreSQL se ejecutan con `npm.cmd test` desde el backend.

## Organización

- `src/api.ts`: tipos y capa Fetch con tratamiento común de respuestas y errores.
- `src/user-context.tsx`: selector y usuario de desarrollo.
- `src/pages/`: listado, alta y detalle.
- `src/components/`: formularios de lotes y ofertas.
- `src/hooks.ts`, `src/ui.tsx`: consultas cancelables, envíos y componentes compartidos.
- `src/styles.css`: estilos de escritorio y móvil.
