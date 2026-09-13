# Implementación de workflow — 12 de septiembre de 2026

Se implementaron las acciones web y la sincronización de Human Tasks: registro, publicación explícita, cobertura desde PostgreSQL, decisión del coordinador, visualización, adjudicación de ofertas completas, notificación por ONG, actividades, monitoreo paralelo y cierre. El backend conserva sesión/CSRF/logout centralizados, valida tareas y destinatarios y registra las acciones antes de enviar HTTP. Los errores posteriores a persistencia devuelven advertencias; los resultados desconocidos se reconcilian por la tarea original y nunca crean otra instancia.

## Verificación

- **80 pruebas backend aprobadas**, con PostgreSQL exclusivo de pruebas y servidor HTTP Bonita falso. Incluyen las tres decisiones, dos ONG, monitoreo antes/después de actividades, archivo final, errores, ambigüedad, timeout, no duplicación y modo desacoplado.
- **2 pruebas Playwright aprobadas**, incluido el recorrido local completo hasta cierre, persistencia tras refrescar, roles, advertencias y viewport móvil. Las pruebas usan puertos exclusivos 3001/5174.
- Builds de backend (Prisma + TypeScript) y frontend (TypeScript + Vite) aprobados.
- Migración aditiva aplicada a la base de la aplicación: conservadas **3 emergencias, 2 lotes, 4 ofertas y 5 usuarios**; vínculo del caso **2** intacto. Tres rondas iniciales, ningún lote sin ronda. Prisma no detectó diferencias entre el esquema y la base.
- Revisada la captura de escritorio; Playwright comprobó ausencia de desbordamiento horizontal móvil. Capturas locales en `frontend/test-results/`.
- `app/diagrams/MyDiagram-1.0.proc` permanece sin modificaciones.

## Bonita real: punto de parada

Se consultaron autenticación, caso, Human Tasks y contrato contra el motor real. El caso **2**, definición **6344068941249062927**, continúa abierto en **Registrar emergencia**, tarea **4**, con contrato vacío. No se ejecutaron tareas ni se inició otra instancia durante esta comprobación.

El proceso desplegado necesita incorporar el contrato `emergenciaId`, los conectores de apertura/cobertura previos al XOR, las condiciones de `cursoAccion`, las tareas por destinatario ONG y las ramas paralelas de monitoreo. La configuración bloquea los tramos nuevos hasta certificar una definición compatible. Sistema Nacional real continúa pendiente; la validación de desarrollo se habilita explícitamente y se identifica en pantalla.

La guía [BONITA_WORKFLOW.md](BONITA_WORKFLOW.md) contiene los cambios manuales exactos, contratos, endpoints de conectores, configuración, tratamiento de errores y procedimiento para validar el recorrido real después del nuevo despliegue. No se han alterado automáticamente el BPMN, las credenciales ni la definición configurada.
