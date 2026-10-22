# Guía de prueba — modo sin Bonita

Recorrido manual completo de la **aplicación web + PostgreSQL**, sin motor BPM y sin Sistema Nacional.

Usá esta guía para demos rápidas, desarrollo y verificación de Entrega 2 (UI, JWT, roles, ofertas, adjudicación, cierre).

Documentación relacionada: [README](README.md), [modo con Bonita](GUIA_PRUEBA_CON_BONITA.md).

---

## Qué demuestra este modo

| Incluye | No incluye |
|---|---|
| Login JWT y 4 roles | Timers reales de Bonita |
| Emergencias, lotes, ofertas, versiones | Human tasks en el Portal |
| Inventario, consorcios, organizaciones | Caso BPM archivado |
| Adjudicación, lectura, actividades, monitoreo, cierre | Validación/bloqueo Sistema Nacional |

El panel mostrará algo como **Bonita deshabilitado** / **Operaciones locales**.

---

## 0. Preparación (una vez)

### Postgres

Si usás el Docker del repo:

```bash
cd ~/proyectos/rescuesync   # o la ruta de tu clone
docker compose up -d
```

Usuario / password / base: `rescuesync` / `rescuesync` / `rescuesync`.

Si ya tenés otro Postgres en `5432`, ajustá `DATABASE_URL` a tus credenciales.

### Backend `.env`

```bash
cd backend
cp .env.example .env
```

Valores mínimos:

```dotenv
DATABASE_URL="postgresql://rescuesync:rescuesync@localhost:5432/rescuesync"
TEST_DATABASE_URL="postgresql://rescuesync:rescuesync@localhost:5432/rescuesync_test"
JWT_SECRET=change-me-rescuesync-jwt-secret-32c
OFERTAS_VALIDACION_MODE=DESARROLLO
BONITA_ENABLED=false
```

### Arrancar

Terminal 1:

```bash
cd backend
npm ci
npm run generate
npm run db:migrate
npm run db:seed
npm run dev
```

Terminal 2:

```bash
cd frontend
cp .env.example .env
# VITE_API_URL=http://localhost:3000/api
npm ci
npm run dev
```

Abrí: http://localhost:5173/login

### Usuarios (password `demo1234`)

| Rol | Email |
|---|---|
| MUNICIPIO | `municipio@rescuesync.test` |
| COORDINADOR | `coordinador@rescuesync.test` |
| ONG A | `ong.a@rescuesync.test` |
| ONG B | `ong.b@rescuesync.test` |
| AUDITOR | `auditor@rescuesync.test` |

En cada cambio de rol: **Cerrar sesión** → login con la otra cuenta.

---

## 1. Municipio — registrar emergencia

1. Login como `municipio@rescuesync.test`.
2. Ir a **Registrar emergencia** (o `/emergencias/nueva`).
3. Completar:
   - Gravedad: `ALTA`
   - Zona: por ejemplo `La Plata - prueba local`
   - Descripción: breve texto
4. Guardar.
5. **Esperado:** entrás al detalle; **Instancia Bonita** = *Sin vínculo registrado* (normal en este modo).

Anotá la URL del detalle (`/emergencias/<uuid>`).

---

## 2. Coordinador — lotes y publicación

1. Cerrar sesión → login `coordinador@rescuesync.test`.
2. Abrir la misma emergencia.
3. Crear lote **RECURSO**:
   - Descripción: `Raciones de alimento`
   - Cantidad: `1000`
   - Unidad: `raciones`
4. Crear lote **PERSONAL**:
   - Descripción: `Paramédicos`
   - Cantidad: `5`
   - Unidad: `personas`
5. En **Acciones del operativo** → **Publicar convocatoria** → confirmar.
6. **Esperado:** estado *Ronda 1 · Publicada*; ventana abierta (hasta adjudicación en modo local).

---

## 3. ONG — inventario (opcional) y ofertas

1. Login `ong.a@rescuesync.test`.
2. (Opcional) Ir a **/inventario**, dar de alta un ítem (ej. 500 raciones).
3. (Opcional) Ir a **/consorcios** y crear uno si querés probar ofertas conjuntas.
4. Volver al detalle de la emergencia.
5. En **Raciones de alimento**: ofrecer `400`, observaciones, enviar.
6. En **Paramédicos**: ofrecer `2`, enviar.
7. (Opcional) Editar una oferta y verificar que sube la **versión** (v2).
8. **Esperado:** las ofertas aparecen bajo cada lote.

(Opcional) Repetí con `ong.b@rescuesync.test` otra oferta parcial.

---

## 4. Municipio — ver y adjudicar

1. Login `municipio@rescuesync.test` → detalle.
2. Debe verse el aviso de **validación de desarrollo** (SN pendiente).
3. **Continuar a selección** → confirmar.
4. Marcar las ofertas de ONG A (400 raciones y 2 personas).
5. **Confirmar adjudicación** → confirmar.
6. **Esperado:** adjudicación guardada; no debe superar cantidades requeridas.

---

## 5. ONG — lectura y actividad

1. Login `ong.a@rescuesync.test` → detalle.
2. **Esperado:** mensaje de ofertas adjudicadas.
3. **Confirmar lectura** → confirmar.
4. **Marcar actividad finalizada** → confirmar.
5. **Esperado:** lectura y actividad confirmadas.

---

## 6. Coordinador — monitoreo y cierre

1. Login `coordinador@rescuesync.test` → detalle.
2. Revisar sección **Monitoreo**.
3. **Finalizar monitoreo / continuar cierre** → confirmar.
4. **Cerrar operativo** → confirmar (habilitado cuando monitoreo + actividades ONG están listos).
5. **Esperado:** *Cierre local confirmado*.

---

## 7. Auditor — solo lectura

1. Login `auditor@rescuesync.test`.
2. Ir a **/auditoria** y abrir la emergencia.
3. **Esperado:** puede ver datos/monitoreo; **no** formularios de alta de lotes ni ofertar.
4. Probar `/emergencias/nueva`: no debe poder guardar como municipio.

---

## Checklist de éxito (sin Bonita)

- [ ] Login/logout por los 5 usuarios
- [ ] Emergencia creada sin caseId Bonita
- [ ] Lotes + publicar convocatoria
- [ ] Ofertas (y edición con versión)
- [ ] Adjudicación en modo DESARROLLO
- [ ] Lectura + actividad ONG
- [ ] Monitoreo + cierre local
- [ ] Auditor sin escritura

---

## Problemas frecuentes

| Síntoma | Qué revisar |
|---|---|
| Error de DB / migrate | `DATABASE_URL`, Postgres arriba, password (`rescuesync` en Docker del repo) |
| No deja adjudicar | `OFERTAS_VALIDACION_MODE=DESARROLLO` y reiniciar backend |
| CORS / API | Backend en `:3000`, `VITE_API_URL=http://localhost:3000/api` |
| “Usuario/contraseña inválidos” | Seed corrido; password exacto `demo1234` |
| Botones de workflow deshabilitados | Rol incorrecto o paso anterior incompleto |

Cuando este recorrido pase, seguí con [GUIA_PRUEBA_CON_BONITA.md](GUIA_PRUEBA_CON_BONITA.md).
