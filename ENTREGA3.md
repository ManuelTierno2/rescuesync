# Entrega 3 — Sistema Nacional (integrada)

Implementada: API del Sistema Nacional (`sistema_nacional/`) **integrada** con RescueSync y Bonita (proceso RescueSync **1.7**). `OFERTAS_VALIDACION_MODE=DESARROLLO` queda solo como modo degradado cuando no hay variables `SN_*` configuradas.

## Qué hace la API SN (`sistema_nacional/`, puerto 3001)

- `POST /login` JWT; `POST /register` onboarding de ONGs (quedan `PENDIENTE`, un ADMIN habilita).
- Catálogo: `GET /certificaciones`, `/tipos-recurso`, `/ongs`, `/recursos/disponibilidad`, `/recursos/:tipo`.
- `POST /validaciones` → perfiles `COMPLETA`/`PARCIAL`/`APOYO`/`SIN_CAPACIDAD` con `cantidadValida`, `nivelRiesgoMax`, `disponible`, `motivo`.
- `POST /compromisos` (bloqueo transaccional `FOR UPDATE`, idempotente) y `POST /compromisos/liberar`.
- Swagger en `/docs` y `/openapi.json`; despliegue Docker/Render (`render.yaml`).

## Integración RescueSync + Bonita

1. Al vencer la ventana, la Service Task **Validacion de ofertas** (Bonita 1.7) ejecuta 4 conectores `rest-post`:
   `POST {back}/convocatoria/ofertas-validacion` (el back sincroniza las ONGs al SN y devuelve el JSON de ofertas) →
   `POST {sn}/login` → `POST {sn}/validaciones` → `POST {back}/convocatoria/validacion-resultado` (persiste `OfertaValidacion`, recalcula cobertura y devuelve `lotesCubiertos` para el XOR).
2. Los ítems de inventario llevan `codigoSn` **obligatorio**, y el catálogo de códigos **lo define el SN**: el back lo lee de `GET /tipos-recurso` (con caché de 60 s y copia previa si el SN cae) y lo expone en `GET /api/inventario/codigos-sn`; la ONG elige cualquier código publicado (un código nuevo del SN queda disponible sin tocar el back). Códigos fuera del catálogo: 422 `CODIGO_SN_INVALIDO`. Sin SN configurado se usa un catálogo local de 5 códigos (`origen: LOCAL`). El código no se ata a `PERSONAL`/`RECURSO`. Toda oferta exige un ítem propio, del mismo tipo que el lote y con código (errores 422 `INVENTARIO_REQUERIDO`, `CODIGO_SN_REQUERIDO`, `TIPO_INCOMPATIBLE`, `INSUFFICIENT_STOCK`). Las ofertas legadas sin ítem se corrigen con `PATCH /ofertas/:id` (`inventario_item_id`) y mientras tanto se validan como `SIN_CAPACIDAD`. El stock acumulado entre lotes/emergencias no se valida en el back: lo arbitra el SN (validación y compromiso). Si el SN rechaza a una ONG (4xx al sincronizarla), sus ofertas quedan `SIN_CAPACIDAD` con el motivo y la validación continúa; si el SN no responde o rechaza las credenciales, el back responde 502 (`SN_UNREACHABLE`/`SN_AUTH_FAILED`).
3. El municipio ve el perfil SN por oferta antes de adjudicar; no se puede adjudicar `SIN_CAPACIDAD` ni superar la suma de `cantidadValida` por lote.
4. Al adjudicar, el back llama `POST /compromisos` por (lote, ONG) **antes** de escribir la adjudicación; un 409 del SN cancela todo. Al cerrar, llama `POST /compromisos/liberar` antes de marcar `cerrada_at`.
5. Configuración: `SN_API_URL`, `SN_ADMIN_EMAIL`, `SN_ADMIN_PASSWORD` en `backend/.env`; credenciales de Bonita Studio en los parámetros de proceso `snUrl`, `snAdminEmail`, `snAdminPassword` (nunca en el repo).

## Pendientes manuales

- Despliegue real del SN en Render (hay `render.yaml`, falta publicar la URL) y credenciales ADMIN de laboratorio para el equipo.
- En Bonita Studio: cargar `snAdminPassword`, deploy de RescueSync 1.7 y actualizar `BONITA_PROCESS_ID`.
