# Entrega 3 — Sistema Nacional (diferida)

Esta entrega **no forma parte de la Entrega 2**. La app local usa `OFERTAS_VALIDACION_MODE=DESARROLLO|PENDIENTE` como sustituto explícito hasta implementar la API externa.

## Objetivo

Desarrollar el **Sistema Nacional de Gestión de Recursos y Riesgos**: API RESTful con JWT, dockerizada (Render/Heroku u equivalente), documentación Swagger, repositorio y Dockerfile.

## Servicios mínimos obligatorios

1. **Autenticación y gestión de cuentas**
   - `POST /login` con JWT
   - Registro/onboarding de ONGs

2. **Catálogo y consulta**
   - Certificaciones
   - ONGs habilitadas
   - Disponibilidad global de recursos

3. **Validación por niveles de competencia**
   - Respuestas estructuradas con capacidades habilitadas y niveles de riesgo permitidos
   - Evitar rechazo punitivo binario

4. **Control de concurrencia y bloqueo**
   - Validar restricciones
   - Bloqueo/compromiso transaccional al adjudicar
   - Locking en PostgreSQL contra race conditions

5. **Liberación y cierre**
   - Reportar finalización de actividades ONG
   - Cerrar proyecto y liberar recursos bloqueados a nivel nacional

## Enganche con RescueSync / Bonita

En el BPM RescueSync 1.5, las Service Tasks de la lane **Sistema Nacional** son el punto de integración futuro:

- Validacion de ofertas
- Registrar compromiso de recursos
- (y, en diseños ampliados) clasificación, liberación, notificación)

Hoy **no tienen conectores reales**. La Entrega 3 debe:

1. Publicar la API SN documentada (Swagger).
2. Conectar desde Bonita o desde el backend RescueSync tras adjudicación/cierre.
3. Reemplazar `OFERTAS_VALIDACION_MODE=DESARROLLO` por llamadas reales de validación por niveles.
4. Ejecutar compromiso al adjudicar y liberación al finalizar/cerrar.

## Criterio de no-alcance para Entrega 2

Cualquier mock local en RescueSync debe identificarse como desarrollo y **no** presentarse como Sistema Nacional desplegado.
