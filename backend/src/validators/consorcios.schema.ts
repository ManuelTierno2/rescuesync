import { z } from 'zod';

export const crearConsorcioSchema = z.strictObject({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(150),
  miembroIds: z.array(z.uuid({ error: 'Debe ser un UUID válido.' })).max(50).default([]),
});

export const agregarMiembroSchema = z.strictObject({
  ong_usuario_id: z.uuid({ error: 'Debe ser un UUID válido.' }),
});

export const consorcioIdParamsSchema = z.object({ id: z.uuid({ error: 'Debe ser un UUID válido.' }) });

export type CrearConsorcioInput = z.infer<typeof crearConsorcioSchema>;
