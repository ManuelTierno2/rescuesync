import { Router } from "express";
import { prisma } from "./db.js";
import { requireAuth } from "./auth.js";
import { evaluar, NIVELES, type Nivel } from "./competencia.js";

export const validacionRouter = Router();

type OfertaIn = { ofertaId: string; ongId: string | number; tipoRecurso: string; cantidad: number; nivelRiesgo: Nivel };

const esOferta = (o: any): o is OfertaIn =>
  typeof o?.ofertaId === "string" && o.ofertaId !== "" &&
  (typeof o.ongId === "string" || Number.isInteger(o.ongId)) && String(o.ongId) !== "" &&
  typeof o.tipoRecurso === "string" && o.tipoRecurso !== "" &&
  Number.isInteger(o.cantidad) && o.cantidad > 0 && NIVELES.includes(o.nivelRiesgo);

// Solo lectura: no bloquea nada. Cada oferta se evalúa por separado contra lo disponible,
// porque recién al adjudicar se descuenta del inventario (ver bloqueo).
validacionRouter.post("/validaciones", requireAuth("ADMIN"), async (req, res) => {
  const ofertas = req.body?.ofertas;
  if (!Array.isArray(ofertas) || ofertas.length === 0 || ofertas.length > 500 || !ofertas.every(esOferta))
    return res.status(400).json({
      error: "ofertas debe ser una lista de 1 a 500 [{ofertaId, ongId, tipoRecurso, cantidad > 0, nivelRiesgo: BAJO|MEDIO|ALTO|CRITICO}]",
    });

  const refs = [...new Set(ofertas.map((o: OfertaIn) => String(o.ongId)))];
  const ongs = await prisma.ong.findMany({
    where: { OR: [{ id: { in: refs.filter((r) => /^\d+$/.test(r)).map(Number) } }, { externalId: { in: refs } }] },
    include: {
      certificaciones: { include: { certificacion: { include: { tipoRecurso: true } } } },
      recursos: { include: { tipoRecurso: true } },
    },
  });
  const tipos = new Set((await prisma.tipoRecurso.findMany({ select: { codigo: true } })).map((t) => t.codigo));
  const hoy = new Date();

  const resultados = ofertas.map((o: OfertaIn) => {
    const ref = String(o.ongId);
    const ong = ongs.find((x) => String(x.id) === ref || x.externalId === ref);
    const base = { ofertaId: o.ofertaId, ongId: o.ongId, tipoRecurso: o.tipoRecurso, cantidad: o.cantidad, nivelRiesgo: o.nivelRiesgo };
    const sin = (motivo: string) => ({ ...base, resultado: "SIN_CAPACIDAD", cantidadValida: 0, nivelRiesgoMax: null, disponible: 0, motivo });
    if (!ong) return sin("ONG no encontrada");
    if (!tipos.has(o.tipoRecurso)) return sin("Tipo de recurso desconocido");

    const certNiveles = ong.certificaciones
      .filter((c) => c.certificacion.tipoRecurso.codigo === o.tipoRecurso && (!c.vencimiento || c.vencimiento > hoy))
      .map((c) => c.certificacion.nivelRiesgoMax);
    const r = ong.recursos.find((x) => x.tipoRecurso.codigo === o.tipoRecurso);
    const disponible = r ? r.total - r.bloqueado : 0;
    return { ...base, ...evaluar(o, { habilitada: ong.estado === "HABILITADA", certNiveles, disponible }), disponible };
  });
  res.json({ resultados });
});
