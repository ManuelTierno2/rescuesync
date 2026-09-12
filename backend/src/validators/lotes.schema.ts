import { z } from 'zod';
import { TipoLote } from '../generated/prisma/enums.js';

export const cantidadSchema = z.number({ error: 'La cantidad debe ser numérica.' })
  .int('La cantidad debe ser entera.').min(1, 'La cantidad debe ser positiva.').max(2147483647);
export const emergenciaLotesParamsSchema = z.object({ emergenciaId: z.uuid({ error: 'Debe ser un UUID válido.' }) });
export const crearLoteSchema = z.strictObject({
  tipo: z.enum(TipoLote, { error: 'Debe ser PERSONAL o RECURSO.' }),
  descripcion: z.string().trim().min(1, 'La descripción es obligatoria.').max(5000),
  cantidad_requerida: cantidadSchema,
  unidad: z.string().trim().min(1, 'La unidad es obligatoria.').max(50),
});
export type CrearLoteInput = z.infer<typeof crearLoteSchema>;
export type EmergenciaLotesParams = z.infer<typeof emergenciaLotesParamsSchema>;
