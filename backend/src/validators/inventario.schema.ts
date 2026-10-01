import { z } from 'zod';
import { TipoLote } from '../generated/prisma/enums.js';
import { cantidadSchema } from './lotes.schema.js';

export const crearInventarioSchema = z.strictObject({
  tipo: z.enum(TipoLote, { error: 'Debe ser PERSONAL o RECURSO.' }),
  descripcion: z.string().trim().min(1, 'La descripción es obligatoria.').max(5000),
  cantidad: cantidadSchema,
  unidad: z.string().trim().min(1, 'La unidad es obligatoria.').max(50),
});

export const actualizarInventarioSchema = z.strictObject({
  tipo: z.enum(TipoLote, { error: 'Debe ser PERSONAL o RECURSO.' }).optional(),
  descripcion: z.string().trim().min(1).max(5000).optional(),
  cantidad: cantidadSchema.optional(),
  unidad: z.string().trim().min(1).max(50).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Debe enviar al menos un campo.' });

export const inventarioIdParamsSchema = z.object({ id: z.uuid({ error: 'Debe ser un UUID válido.' }) });

export type CrearInventarioInput = z.infer<typeof crearInventarioSchema>;
export type ActualizarInventarioInput = z.infer<typeof actualizarInventarioSchema>;
