// Lógica pura de validación por niveles de competencia (sin DB, para poder testearla sola).
export const NIVELES = ["BAJO", "MEDIO", "ALTO", "CRITICO"] as const;
export type Nivel = (typeof NIVELES)[number];
export type Resultado = "COMPLETA" | "PARCIAL" | "APOYO" | "SIN_CAPACIDAD";

export type Contexto = {
  habilitada: boolean;
  /** nivelRiesgoMax de cada certificación vigente de la ONG para este tipo de recurso */
  certNiveles: Nivel[];
  /** total - bloqueado de la ONG para este tipo (0 si no tiene inventario) */
  disponible: number;
};

export function evaluar(oferta: { cantidad: number; nivelRiesgo: Nivel }, ctx: Contexto) {
  const nivelRiesgoMax = ctx.certNiveles.length
    ? NIVELES[Math.max(...ctx.certNiveles.map((n) => NIVELES.indexOf(n)))]
    : null;
  const sin = (motivo: string) => ({ resultado: "SIN_CAPACIDAD" as Resultado, cantidadValida: 0, nivelRiesgoMax, motivo });

  if (!ctx.habilitada) return sin("ONG no habilitada");
  if (!nivelRiesgoMax) return sin("Sin certificación vigente para este tipo de recurso");
  if (ctx.disponible <= 0) return sin("Sin disponibilidad de este recurso");

  const cantidadValida = Math.min(oferta.cantidad, ctx.disponible);
  // Riesgo del lote por encima de lo que habilita la ONG: sirve solo como apoyo secundario.
  if (NIVELES.indexOf(oferta.nivelRiesgo) > NIVELES.indexOf(nivelRiesgoMax))
    return { resultado: "APOYO" as Resultado, cantidadValida, nivelRiesgoMax, motivo: `Habilitada hasta riesgo ${nivelRiesgoMax}` };
  if (cantidadValida < oferta.cantidad)
    return { resultado: "PARCIAL" as Resultado, cantidadValida, nivelRiesgoMax, motivo: `Disponible ${ctx.disponible} de ${oferta.cantidad}` };
  return { resultado: "COMPLETA" as Resultado, cantidadValida, nivelRiesgoMax, motivo: "Cumple categoría, riesgo y cantidad" };
}
