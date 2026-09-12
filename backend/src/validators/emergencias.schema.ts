import { z } from 'zod';
import { Gravedad } from '../generated/prisma/enums.js';

export const crearEmergenciaSchema = z.strictObject({
  creada_por_id: z.uuid({ error: 'Debe ser un UUID válido.' }),
  gravedad: z.enum(Gravedad, { error: 'Debe ser BAJA, MEDIA, ALTA o CRITICA.' }),
  zona: z.string().trim().min(1, 'La zona es obligatoria.').max(200),
  descripcion: z.string().trim().min(1, 'La descripción es obligatoria.').max(5000),
});

export const emergenciaIdSchema = z.object({
  id: z.uuid({ error: 'Debe ser un UUID válido.' }),
});

export type CrearEmergenciaInput = z.infer<typeof crearEmergenciaSchema>;
export type EmergenciaIdInput = z.infer<typeof emergenciaIdSchema>;
