// Especificación OpenAPI 3.0 servida en /docs (Swagger UI) y /openapi.json.
// openapi.test.ts verifica que cada ruta de Express esté documentada acá y viceversa.
const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const body = (schema: object, example?: unknown) => ({ required: true, content: { "application/json": { schema, ...(example !== undefined && { example }) } } });
const ok = (descripcion: string, schema: object) => ({ description: descripcion, content: { "application/json": { schema } } });
const err = (descripcion: string, schema: object = ref("Error")) => ({ description: descripcion, content: { "application/json": { schema } } });

const R401 = err("Falta el token o es inválido o está vencido");
const R403 = err("El rol del token no tiene permisos para esta operación");
const R404 = err("ONG no encontrada");
const bearer = [{ bearerAuth: [] }];
const idParam = {
  name: "id", in: "path", required: true, schema: { type: "string" },
  description: "Id interno (numérico) de la ONG o su externalId (id del usuario ONG en la app local; nunca es solo numérico).",
};
const str = { type: "string" };
const int = { type: "integer" };
const fecha = { type: "string", format: "date-time", nullable: true };
const arr = (items: object) => ({ type: "array", items });
const obj = (properties: Record<string, object>, required: string[] = []) => ({ type: "object", properties, ...(required.length && { required }) });

export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "Sistema Nacional de Gestión de Recursos y Riesgos",
    version: "1.0.0",
    description:
      "API externa de RescueSync. Valida ofertas por niveles de competencia y compromete (bloquea) y libera los recursos de las ONGs.\n\n" +
      "**Autenticación:** `POST /login` devuelve un JWT (8 horas). Enviarlo en `Authorization: Bearer <token>`. " +
      "Los roles son **ADMIN** (cuenta de servicio de la plataforma: valida, bloquea, libera y gestiona ONGs) y **ONG** (solo lectura de su perfil y del catálogo).\n\n" +
      "**Flujo típico:** alta de la ONG (`POST /ongs`) con sus certificaciones e inventario → validación de ofertas (`POST /validaciones`, solo lee) → " +
      "bloqueo al adjudicar (`POST /compromisos`) → liberación al finalizar o cerrar la emergencia (`POST /compromisos/liberar`).",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "Estado" }, { name: "Autenticación" }, { name: "Catálogo" },
    { name: "ONGs" }, { name: "Validación" }, { name: "Compromisos" },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      Error: obj({ error: str }, ["error"]),
      Nivel: { type: "string", enum: ["BAJO", "MEDIO", "ALTO", "CRITICO"] },
      EstadoOng: { type: "string", enum: ["PENDIENTE", "HABILITADA", "SUSPENDIDA"] },
      Resultado: { type: "string", enum: ["COMPLETA", "PARCIAL", "APOYO", "SIN_CAPACIDAD"] },
      LoginRequest: obj({ email: { type: "string", format: "email" }, password: str }, ["email", "password"]),
      LoginResponse: obj({ token: str, tokenType: { type: "string", example: "Bearer" }, expiresIn: { ...int, example: 28800 }, rol: { type: "string", enum: ["ADMIN", "ONG"] }, ongId: { ...int, nullable: true } }),
      RegisterRequest: obj({ nombre: str, cuit: { ...str, description: "Opcional. 11 dígitos, con o sin guiones.", example: "30-71234567-8" }, email: { type: "string", format: "email" }, password: { ...str, minLength: 8 } }, ["nombre", "email", "password"]),
      RegisterResponse: obj({ id: int, nombre: str, cuit: { ...str, nullable: true }, estado: ref("EstadoOng") }),
      Certificacion: obj({ codigo: str, nombre: str, tipoRecurso: str, nivelRiesgoMax: ref("Nivel") }),
      TipoRecurso: obj({ codigo: str, unidad: str }),
      OngCertificacion: obj({ codigo: str, nombre: str, tipoRecurso: str, nivelRiesgoMax: ref("Nivel"), vencimiento: fecha, vigente: { type: "boolean" } }),
      OngRecurso: obj({ tipoRecurso: str, unidad: str, total: int, bloqueado: int, disponible: { ...int, description: "total - bloqueado" } }),
      Ong: obj({ id: int, externalId: { ...str, nullable: true }, nombre: str, cuit: { ...str, nullable: true }, estado: ref("EstadoOng"), certificaciones: arr(ref("OngCertificacion")), recursos: arr(ref("OngRecurso")) }),
      CertificacionInput: obj({ codigo: str, vencimiento: { type: "string", format: "date-time", nullable: true } }, ["codigo"]),
      RecursoInput: obj({ tipoRecurso: str, total: { type: "integer", minimum: 0 } }, ["tipoRecurso", "total"]),
      OngAltaRequest: obj({
        externalId: { ...str, description: "Id del usuario ONG en la app local. No puede ser solo numérico." },
        nombre: str, cuit: str, estado: { ...ref("EstadoOng"), description: "Si no viene, una ONG nueva queda PENDIENTE y una existente conserva su estado." },
        certificaciones: { ...arr(ref("CertificacionInput")), description: "Reemplaza el conjunto actual." },
        recursos: { ...arr(ref("RecursoInput")), description: "Fija el total de cada tipo; no toca lo bloqueado." },
      }, ["externalId", "nombre"]),
      EstadoRequest: obj({ estado: ref("EstadoOng") }, ["estado"]),
      Disponibilidad: obj({ tipoRecurso: str, unidad: str, total: int, bloqueado: int, ongs: { ...int, description: "Cantidad de ONGs habilitadas con este recurso" }, disponible: int }),
      OfertaValidacion: obj({
        ofertaId: { ...str, description: "Identificador de la oferta en la app local; se devuelve tal cual." },
        ongId: { oneOf: [int, str], description: "Id interno o externalId de la ONG." },
        tipoRecurso: str, cantidad: { type: "integer", minimum: 1 }, nivelRiesgo: ref("Nivel"),
      }, ["ofertaId", "ongId", "tipoRecurso", "cantidad", "nivelRiesgo"]),
      ValidacionRequest: obj({ ofertas: { ...arr(ref("OfertaValidacion")), minItems: 1, maxItems: 500 } }, ["ofertas"]),
      ResultadoValidacion: obj({
        ofertaId: str, ongId: { oneOf: [int, str] }, tipoRecurso: str, cantidad: int, nivelRiesgo: ref("Nivel"),
        resultado: ref("Resultado"), cantidadValida: { ...int, description: "Cantidad que la ONG puede cubrir" },
        nivelRiesgoMax: { ...ref("Nivel"), nullable: true }, disponible: { ...int, description: "total - bloqueado al momento de validar" }, motivo: str,
      }),
      ValidacionResponse: obj({ resultados: arr(ref("ResultadoValidacion")) }),
      ItemCompromiso: obj({ tipoRecurso: str, cantidad: { type: "integer", minimum: 1 } }, ["tipoRecurso", "cantidad"]),
      BloqueoRequest: obj({
        emergenciaId: str, loteId: str, ongId: { oneOf: [int, str], description: "Id interno o externalId." },
        items: { ...arr(ref("ItemCompromiso")), minItems: 1, description: "Sin tipos repetidos." },
      }, ["emergenciaId", "loteId", "ongId", "items"]),
      Compromiso: obj({
        id: int, emergenciaId: str, loteId: str, ongId: int, externalId: { ...str, nullable: true },
        estado: { type: "string", enum: ["ACTIVO", "LIBERADO"] }, createdAt: { type: "string", format: "date-time" }, liberadoAt: fecha,
        items: arr(ref("ItemCompromiso")),
      }),
      CompromisoCreado: { allOf: [ref("Compromiso"), obj({ repetido: { type: "boolean", description: "true si el compromiso ya existía (reintento idempotente)" } })] },
      Faltante: obj({ tipoRecurso: str, solicitado: int, disponible: int, resultado: ref("Resultado"), motivo: str }),
      ErrorStock: obj({ error: str, detalle: arr(ref("Faltante")) }),
      LiberarRequest: obj({ emergenciaId: str, ongId: { oneOf: [int, str], description: "Opcional: solo los compromisos de esa ONG." }, loteId: { ...str, description: "Opcional: solo ese lote." } }, ["emergenciaId"]),
      LiberarResponse: obj({ emergenciaId: str, liberados: int, yaLiberados: int, compromisos: arr(ref("Compromiso")) }),
    },
  },
  paths: {
    "/health": { get: { tags: ["Estado"], summary: "Estado del servicio", responses: { 200: ok("Servicio activo", obj({ status: { type: "string", example: "ok" } })) } } },
    "/login": {
      post: {
        tags: ["Autenticación"], summary: "Inicio de sesión (JWT)",
        requestBody: body(ref("LoginRequest"), { email: "admin@rescuesync.local", password: "su-password" }),
        responses: { 200: ok("Token JWT de 8 horas", ref("LoginResponse")), 400: err("Faltan email o password"), 401: err("Credenciales inválidas") },
      },
    },
    "/register": {
      post: {
        tags: ["Autenticación"], summary: "Registro (onboarding) de una ONG",
        description: "Público. Crea la ONG en estado PENDIENTE y su usuario en una sola transacción. Un ADMIN debe habilitarla.",
        requestBody: body(ref("RegisterRequest")),
        responses: { 201: ok("ONG creada", ref("RegisterResponse")), 400: err("Datos inválidos"), 409: err("CUIT o email ya registrados") },
      },
    },
    "/certificaciones": { get: { tags: ["Catálogo"], summary: "Certificaciones disponibles", description: "Cada una habilita un tipo de recurso hasta un nivel de riesgo máximo.", security: bearer, responses: { 200: ok("Lista", arr(ref("Certificacion"))), 401: R401 } } },
    "/tipos-recurso": { get: { tags: ["Catálogo"], summary: "Tipos de recurso (categorías)", security: bearer, responses: { 200: ok("Lista", arr(ref("TipoRecurso"))), 401: R401 } } },
    "/recursos/disponibilidad": { get: { tags: ["Catálogo"], summary: "Disponibilidad global por tipo de recurso", description: "Suma solo las ONGs habilitadas.", security: bearer, responses: { 200: ok("Lista", arr(ref("Disponibilidad"))), 401: R401 } } },
    "/ongs": {
      get: {
        tags: ["ONGs"], summary: "ONGs habilitadas", security: bearer,
        parameters: [{ name: "estado", in: "query", required: false, schema: ref("EstadoOng"), description: "Solo lo respeta un ADMIN; para otros roles siempre se listan las HABILITADAS." }],
        responses: { 200: ok("Lista con certificaciones e inventario", arr(ref("Ong"))), 400: err("estado inválido"), 401: R401 },
      },
      post: {
        tags: ["ONGs"], summary: "Alta o actualización de una ONG desde la app local (ADMIN)",
        description: "Idempotente por externalId: crea (201) o actualiza (200). No crea usuario. Si trae certificaciones o recursos, los reemplaza o fija.",
        security: bearer,
        requestBody: body(ref("OngAltaRequest"), {
          externalId: "3f2b8c1e-6a52-4a39-9d1e-0b7c2a9f4d10", nombre: "Bomberos Voluntarios del Sur", estado: "HABILITADA",
          certificaciones: [{ codigo: "RESCATE_VEHICULAR" }], recursos: [{ tipoRecurso: "VEHICULO_RESCATE", total: 4 }],
        }),
        responses: { 200: ok("ONG actualizada", ref("Ong")), 201: ok("ONG creada", ref("Ong")), 400: err("Datos inválidos (la ONG puede haber quedado creada; reintentar con datos corregidos)"), 401: R401, 403: R403, 409: err("El CUIT pertenece a otra ONG o el total es menor a lo ya bloqueado") },
      },
    },
    "/ongs/me": { get: { tags: ["ONGs"], summary: "Perfil de la ONG autenticada (rol ONG)", security: bearer, responses: { 200: ok("ONG", ref("Ong")), 401: R401, 403: R403, 404: R404 } } },
    "/ongs/{id}": {
      get: {
        tags: ["ONGs"], summary: "Detalle de una ONG", description: "Un ADMIN puede ver cualquiera; una ONG solo la suya.",
        security: bearer, parameters: [idParam],
        responses: { 200: ok("ONG", ref("Ong")), 401: R401, 403: R403, 404: R404 },
      },
    },
    "/ongs/{id}/estado": {
      patch: {
        tags: ["ONGs"], summary: "Habilitar, suspender o dejar pendiente una ONG (ADMIN)", security: bearer, parameters: [idParam],
        requestBody: body(ref("EstadoRequest"), { estado: "HABILITADA" }),
        responses: { 200: ok("Estado actualizado", obj({ id: int, estado: ref("EstadoOng") })), 400: err("estado inválido"), 401: R401, 403: R403, 404: R404 },
      },
    },
    "/ongs/{id}/certificaciones": {
      put: {
        tags: ["ONGs"], summary: "Reemplazar las certificaciones de una ONG (ADMIN)", security: bearer, parameters: [idParam],
        requestBody: body(obj({ certificaciones: arr(ref("CertificacionInput")) }, ["certificaciones"]), { certificaciones: [{ codigo: "PARAMEDICO_AVANZADO", vencimiento: "2030-01-01T00:00:00Z" }] }),
        responses: { 200: ok("ONG actualizada", ref("Ong")), 400: err("Formato inválido o certificaciones inexistentes"), 401: R401, 403: R403, 404: R404 },
      },
    },
    "/ongs/{id}/recursos": {
      put: {
        tags: ["ONGs"], summary: "Fijar el inventario total de una ONG (ADMIN)",
        description: "Fija el total por tipo de recurso (no es un incremento, se puede repetir). No toca lo bloqueado.",
        security: bearer, parameters: [idParam],
        requestBody: body(obj({ recursos: arr(ref("RecursoInput")) }, ["recursos"]), { recursos: [{ tipoRecurso: "PARAMEDICO", total: 10 }] }),
        responses: { 200: ok("ONG actualizada", ref("Ong")), 400: err("Formato inválido o tipos inexistentes"), 401: R401, 403: R403, 404: R404, 409: err("El total sería menor a la cantidad ya bloqueada") },
      },
    },
    "/validaciones": {
      post: {
        tags: ["Validación"], summary: "Validar ofertas por niveles de competencia (ADMIN)",
        description:
          "Solo lee: no bloquea ni descuenta inventario. Cada oferta se evalúa por separado contra lo disponible (total - bloqueado); " +
          "una ONG con 10 puede ofertar varias veces 10 o menos. El inventario se descuenta recién al adjudicar (`POST /compromisos`).\n\n" +
          "Resultados: **COMPLETA** (categoría, riesgo y cantidad ok), **PARCIAL** (puede cubrir menos de lo pedido), " +
          "**APOYO** (el riesgo del lote supera lo que habilitan sus certificaciones: sirve como apoyo secundario) y " +
          "**SIN_CAPACIDAD** (ONG no habilitada o inexistente, sin certificación vigente, sin disponibilidad o tipo desconocido). " +
          "Nunca es un rechazo con error: siempre responde 200 con el detalle por oferta.",
        security: bearer,
        requestBody: body(ref("ValidacionRequest"), { ofertas: [{ ofertaId: "oferta-1", ongId: 1, tipoRecurso: "PARAMEDICO", cantidad: 8, nivelRiesgo: "ALTO" }] }),
        responses: { 200: ok("Un resultado por oferta", ref("ValidacionResponse")), 400: err("Lista vacía, de más de 500 ofertas o con campos inválidos"), 401: R401, 403: R403 },
      },
    },
    "/compromisos": {
      post: {
        tags: ["Compromisos"], summary: "Bloquear recursos al adjudicar una oferta (ADMIN)",
        description:
          "Todo o nada y transaccional: bloquea las filas de inventario con `SELECT ... FOR UPDATE` (ordenadas por id), " +
          "así dos adjudicaciones simultáneas sobre el mismo stock se serializan y la segunda ve lo ya bloqueado. " +
          "Exige ONG habilitada, certificación vigente del tipo y disponibilidad (no filtra por nivel de riesgo).\n\n" +
          "Idempotente por (emergenciaId, loteId, ongId): repetir la llamada devuelve el compromiso existente con 200 y `repetido: true`. " +
          "Si ese compromiso ya fue liberado responde 409.",
        security: bearer,
        requestBody: body(ref("BloqueoRequest"), { emergenciaId: "EM-2026-001", loteId: "lote-7", ongId: 1, items: [{ tipoRecurso: "PARAMEDICO", cantidad: 6 }] }),
        responses: {
          201: ok("Compromiso creado", ref("CompromisoCreado")), 200: ok("Reintento: el compromiso ya existía", ref("CompromisoCreado")),
          400: err("Datos inválidos o tipos de recurso inexistentes"), 401: R401, 403: R403, 404: R404,
          409: err("Recursos insuficientes o ONG sin capacidad (con detalle por ítem), o compromiso ya liberado", ref("ErrorStock")),
        },
      },
      get: {
        tags: ["Compromisos"], summary: "Listar compromisos (ADMIN)", security: bearer,
        parameters: [
          { name: "emergenciaId", in: "query", required: false, schema: str },
          { name: "estado", in: "query", required: false, schema: { type: "string", enum: ["ACTIVO", "LIBERADO"] } },
        ],
        responses: { 200: ok("Lista", arr(ref("Compromiso"))), 400: err("estado inválido"), 401: R401, 403: R403 },
      },
    },
    "/compromisos/liberar": {
      post: {
        tags: ["Compromisos"], summary: "Liberar recursos al finalizar o cerrar (ADMIN)",
        description:
          "Devuelve al disponible lo bloqueado por los compromisos ACTIVOS que coincidan y los marca LIBERADO. " +
          "Una ONG termina su actividad: `emergenciaId` + `ongId`. Cierre del proyecto: solo `emergenciaId` (todas las ONGs). " +
          "Idempotente: repetirla no vuelve a restar (responde 200 con `liberados: 0`). 404 si no hay ningún compromiso para ese criterio.",
        security: bearer,
        requestBody: body(ref("LiberarRequest"), { emergenciaId: "EM-2026-001" }),
        responses: { 200: ok("Resultado de la liberación", ref("LiberarResponse")), 400: err("Datos inválidos"), 401: R401, 403: R403, 404: err("No hay compromisos para ese criterio o la ONG no existe") },
      },
    },
  },
};
