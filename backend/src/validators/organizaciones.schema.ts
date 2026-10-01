import { z } from 'zod';
import { OrganizacionTipo } from '../generated/prisma/enums.js';

export const crearOrganizacionSchema = z.strictObject({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(150),
  tipo: z.enum(OrganizacionTipo, { error: 'Tipo de organización inválido.' }),
});

export type CrearOrganizacionInput = z.infer<typeof crearOrganizacionSchema>;
