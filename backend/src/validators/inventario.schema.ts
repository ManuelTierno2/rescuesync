import { z } from 'zod';
import { TipoLote } from '../generated/prisma/enums.js';
import { cantidadSchema } from './lotes.schema.js';

/** Formato del código; que exista lo valida el catálogo del Sistema Nacional (no un enum fijo). */
const codigoSnSchema = (mensaje: string) => z.string({ error: mensaje }).trim()
  .min(1, mensaje).max(50, 'El código no puede superar 50 caracteres.')
  .regex(/^[A-Z0-9_]+$/, 'El código solo admite mayúsculas, números y guion bajo.');

export const crearInventarioSchema = z.strictObject({
  tipo: z.enum(TipoLote, { error: 'Debe ser PERSONAL o RECURSO.' }),
  descripcion: z.string().trim().min(1, 'La descripción es obligatoria.').max(5000),
  cantidad: cantidadSchema,
  unidad: z.string().trim().min(1, 'La unidad es obligatoria.').max(50),
  codigoSn: codigoSnSchema('El código del Sistema Nacional es obligatorio.'),
});

export const actualizarInventarioSchema = z.strictObject({
  tipo: z.enum(TipoLote, { error: 'Debe ser PERSONAL o RECURSO.' }).optional(),
  descripcion: z.string().trim().min(1).max(5000).optional(),
  cantidad: cantidadSchema.optional(),
  unidad: z.string().trim().min(1).max(50).optional(),
  codigoSn: codigoSnSchema('Código del Sistema Nacional inválido.').optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Debe enviar al menos un campo.' });

export const inventarioIdParamsSchema = z.object({ id: z.uuid({ error: 'Debe ser un UUID válido.' }) });

export type CrearInventarioInput = z.infer<typeof crearInventarioSchema>;
export type ActualizarInventarioInput = z.infer<typeof actualizarInventarioSchema>;
