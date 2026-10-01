import { z } from 'zod';
import { cantidadSchema } from './lotes.schema.js';

export const loteOfertasParamsSchema = z.object({ loteId: z.uuid({ error: 'Debe ser un UUID válido.' }) });
export const ofertaIdParamsSchema = z.object({ id: z.uuid({ error: 'Debe ser un UUID válido.' }) });

export const crearOfertaSchema = z.strictObject({
  ong_usuario_id: z.uuid({ error: 'Debe ser un UUID válido.' }),
  cantidad_ofrecida: cantidadSchema,
  observaciones: z.string().trim().max(5000).nullish().transform((value) => value || null),
  consorcio_id: z.uuid({ error: 'Debe ser un UUID válido.' }).nullish().transform((value) => value || null),
  inventario_item_id: z.uuid({ error: 'Debe ser un UUID válido.' }).nullish().transform((value) => value || null),
});

export const actualizarOfertaSchema = z.strictObject({
  cantidad_ofrecida: cantidadSchema,
  observaciones: z.string().trim().max(5000).nullish().transform((value) => value || null),
});

export type CrearOfertaInput = z.infer<typeof crearOfertaSchema>;
export type ActualizarOfertaInput = z.infer<typeof actualizarOfertaSchema>;
export type LoteOfertasParams = z.infer<typeof loteOfertasParamsSchema>;
export type OfertaIdParams = z.infer<typeof ofertaIdParamsSchema>;
