import { Router } from "express";
import { prisma, tabla } from "./db.js";
import { requireAuth } from "./auth.js";
import { Prisma } from "./generated/prisma/client.js";
import { evaluar } from "./competencia.js";

export type ItemIn = { tipoRecurso: string; cantidad: number };
export type BloqueoIn = { emergenciaId: string; loteId: string; ongId: string | number; items: ItemIn[] };

type Faltante = { tipoRecurso: string; solicitado: number; disponible: number; resultado: string; motivo: string };
class Conflicto extends Error {
  constructor(public status: number, public detalle: Faltante[] | string) { super("conflicto"); }
}

const vista = (c: Prisma.CompromisoGetPayload<{ include: { ong: true; items: { include: { tipoRecurso: true } } } }>) => ({
  id: c.id, emergenciaId: c.emergenciaId, loteId: c.loteId, ongId: c.ongId, externalId: c.ong.externalId,
  estado: c.estado, createdAt: c.createdAt, liberadoAt: c.liberadoAt,
  items: c.items.map((i) => ({ tipoRecurso: i.tipoRecurso.codigo, cantidad: i.cantidad })),
});
const incluir = { ong: true, items: { include: { tipoRecurso: true } } } as const;

/**
 * Compromete recursos de una ONG para un lote, todo o nada.
 * Bloquea las filas de inventario con SELECT ... FOR UPDATE (ordenadas por id para evitar deadlocks),
 * así dos adjudicaciones simultáneas sobre el mismo stock se serializan y la segunda ve lo ya bloqueado.
 * Idempotente por (emergenciaId, loteId, ongId): repetir una llamada devuelve el compromiso existente.
 */
export async function bloquear(inp: BloqueoIn) {
  const ref = String(inp.ongId);
  const ong = await prisma.ong.findFirst({
    where: { OR: [{ id: /^\d+$/.test(ref) ? Number(ref) : -1 }, { externalId: ref }] },
  });
  if (!ong) return { status: 404, error: "ONG no encontrada" } as const;
  const tipos = await prisma.tipoRecurso.findMany({ where: { codigo: { in: inp.items.map((i) => i.tipoRecurso) } } });
  const faltan = inp.items.filter((i) => !tipos.some((t) => t.codigo === i.tipoRecurso)).map((i) => i.tipoRecurso);
  if (faltan.length) return { status: 400, error: `tipos de recurso inexistentes: ${faltan.join(", ")}` } as const;

  try {
    return await prisma.$transaction(async (tx) => {
      const tipoIds = tipos.map((t) => t.id);
      await tx.$queryRaw`SELECT id FROM ${Prisma.raw(tabla("OngRecurso"))} WHERE "ongId" = ${ong.id}
        AND "tipoRecursoId" IN (${Prisma.join(tipoIds)}) ORDER BY id FOR UPDATE`;

      // Con el lock tomado, recién ahora es seguro mirar si ya existe (reintentos concurrentes).
      const key = { emergenciaId_loteId_ongId: { emergenciaId: inp.emergenciaId, loteId: inp.loteId, ongId: ong.id } };
      const previo = await tx.compromiso.findUnique({ where: key, include: incluir });
      if (previo?.estado === "ACTIVO") return { status: 200, compromiso: vista(previo), repetido: true } as const;
      if (previo) throw new Conflicto(409, "El compromiso de este lote ya fue liberado");

      const [recursos, certs] = await Promise.all([
        tx.ongRecurso.findMany({ where: { ongId: ong.id, tipoRecursoId: { in: tipoIds } } }),
        tx.ongCertificacion.findMany({ where: { ongId: ong.id }, include: { certificacion: { include: { tipoRecurso: true } } } }),
      ]);
      const hoy = new Date();
      const faltantes: Faltante[] = [];
      const aplicar: { id: number; cantidad: number }[] = [];
      for (const it of inp.items) {
        const tipo = tipos.find((t) => t.codigo === it.tipoRecurso)!;
        const r = recursos.find((x) => x.tipoRecursoId === tipo.id);
        const disponible = r ? r.total - r.bloqueado : 0;
        const certNiveles = certs
          .filter((c) => c.certificacion.tipoRecurso.codigo === it.tipoRecurso && (!c.vencimiento || c.vencimiento > hoy))
          .map((c) => c.certificacion.nivelRiesgoMax);
        // Riesgo BAJO: al adjudicar no se filtra por riesgo (una oferta de APOYO también se adjudica).
        const ev = evaluar({ cantidad: it.cantidad, nivelRiesgo: "BAJO" }, { habilitada: ong.estado === "HABILITADA", certNiveles, disponible });
        if (ev.resultado !== "COMPLETA") faltantes.push({ tipoRecurso: it.tipoRecurso, solicitado: it.cantidad, disponible, resultado: ev.resultado, motivo: ev.motivo });
        else aplicar.push({ id: r!.id, cantidad: it.cantidad });
      }
      if (faltantes.length) throw new Conflicto(409, faltantes);

      for (const a of aplicar) await tx.ongRecurso.update({ where: { id: a.id }, data: { bloqueado: { increment: a.cantidad } } });
      const creado = await tx.compromiso.create({
        data: {
          emergenciaId: inp.emergenciaId, loteId: inp.loteId, ongId: ong.id,
          items: { create: inp.items.map((i) => ({ tipoRecursoId: tipos.find((t) => t.codigo === i.tipoRecurso)!.id, cantidad: i.cantidad })) },
        },
        include: incluir,
      });
      return { status: 201, compromiso: vista(creado), repetido: false } as const;
    });
  } catch (e) {
    if (e instanceof Conflicto)
      return typeof e.detalle === "string"
        ? ({ status: e.status, error: e.detalle } as const)
        : ({ status: e.status, error: "Recursos insuficientes o ONG sin capacidad", detalle: e.detalle } as const);
    throw e;
  }
}

export type LiberarIn = { emergenciaId: string; ongId?: string | number; loteId?: string };

/**
 * Libera compromisos ACTIVOS de una emergencia (opcionalmente solo de una ONG y/o un lote):
 * devuelve lo bloqueado al disponible y los marca LIBERADO.
 * - Una ONG termina su actividad: emergenciaId + ongId.
 * - Cierre del proyecto: solo emergenciaId (todas las ONGs).
 * Idempotente: repetirla no vuelve a restar. Toma los mismos locks que `bloquear`, en el mismo orden.
 */
export async function liberar(inp: LiberarIn) {
  let ongFiltro: number | undefined;
  if (inp.ongId !== undefined) {
    const ref = String(inp.ongId);
    const ong = await prisma.ong.findFirst({ where: { OR: [{ id: /^\d+$/.test(ref) ? Number(ref) : -1 }, { externalId: ref }] } });
    if (!ong) return { status: 404, error: "ONG no encontrada" } as const;
    ongFiltro = ong.id;
  }
  const where = { emergenciaId: inp.emergenciaId, ...(ongFiltro && { ongId: ongFiltro }), ...(inp.loteId && { loteId: inp.loteId }) };
  const todos = await prisma.compromiso.findMany({ where, select: { ongId: true } });
  if (!todos.length) return { status: 404, error: "No hay compromisos para ese criterio" } as const;
  const ongIds = [...new Set(todos.map((c) => c.ongId))];

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM ${Prisma.raw(tabla("OngRecurso"))} WHERE "ongId" IN (${Prisma.join(ongIds)}) ORDER BY id FOR UPDATE`;
    // Con el lock tomado se leen los ACTIVOS: una liberación concurrente ya los habría marcado.
    const activos = await tx.compromiso.findMany({ where: { ...where, estado: "ACTIVO" }, include: { items: true } });
    const aDevolver = new Map<string, { ongId: number; tipoRecursoId: number; cantidad: number }>();
    for (const c of activos) for (const i of c.items) {
      const k = `${c.ongId}:${i.tipoRecursoId}`;
      aDevolver.set(k, { ongId: c.ongId, tipoRecursoId: i.tipoRecursoId, cantidad: (aDevolver.get(k)?.cantidad ?? 0) + i.cantidad });
    }
    for (const d of aDevolver.values())
      await tx.ongRecurso.updateMany({ where: { ongId: d.ongId, tipoRecursoId: d.tipoRecursoId }, data: { bloqueado: { decrement: d.cantidad } } });
    const ids = activos.map((c) => c.id);
    await tx.compromiso.updateMany({ where: { id: { in: ids } }, data: { estado: "LIBERADO", liberadoAt: new Date() } });
    const liberados = await tx.compromiso.findMany({ where: { id: { in: ids } }, include: incluir, orderBy: { id: "asc" } });
    return { status: 200, liberados: liberados.length, yaLiberados: todos.length - liberados.length, compromisos: liberados.map(vista) } as const;
  });
}

export const compromisosRouter = Router();

const esItem = (i: any): i is ItemIn => typeof i?.tipoRecurso === "string" && i.tipoRecurso !== "" && Number.isInteger(i.cantidad) && i.cantidad > 0;
const esTxt = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

compromisosRouter.post("/compromisos", requireAuth("ADMIN"), async (req, res) => {
  const { emergenciaId, loteId, ongId, items } = req.body ?? {};
  if (!esTxt(emergenciaId) || !esTxt(loteId) || !(esTxt(ongId) || Number.isInteger(ongId)) ||
      !Array.isArray(items) || items.length === 0 || !items.every(esItem) ||
      new Set(items.map((i) => i.tipoRecurso)).size !== items.length)
    return res.status(400).json({ error: "Se requiere {emergenciaId, loteId, ongId, items: [{tipoRecurso, cantidad > 0}]} sin tipos repetidos" });
  const r = await bloquear({ emergenciaId, loteId, ongId, items });
  if ("compromiso" in r) return res.status(r.status).json({ ...r.compromiso, repetido: r.repetido });
  res.status(r.status).json({ error: r.error, ...("detalle" in r && { detalle: r.detalle }) });
});

compromisosRouter.get("/compromisos", requireAuth("ADMIN"), async (req, res) => {
  const { emergenciaId, estado } = req.query;
  if (estado !== undefined && estado !== "ACTIVO" && estado !== "LIBERADO") return res.status(400).json({ error: "estado debe ser ACTIVO o LIBERADO" });
  const cs = await prisma.compromiso.findMany({
    where: { ...(typeof emergenciaId === "string" && { emergenciaId }), ...(estado && { estado }) },
    include: incluir, orderBy: { id: "asc" },
  });
  res.json(cs.map(vista));
});

compromisosRouter.post("/compromisos/liberar", requireAuth("ADMIN"), async (req, res) => {
  const { emergenciaId, ongId, loteId } = req.body ?? {};
  if (!esTxt(emergenciaId) || (ongId !== undefined && !(esTxt(ongId) || Number.isInteger(ongId))) || (loteId !== undefined && !esTxt(loteId)))
    return res.status(400).json({ error: "Se requiere {emergenciaId} y, opcionalmente, ongId y/o loteId" });
  const r = await liberar({ emergenciaId, ongId, loteId });
  if ("compromisos" in r) return res.status(r.status).json({ emergenciaId, liberados: r.liberados, yaLiberados: r.yaLiberados, compromisos: r.compromisos });
  res.status(r.status).json({ error: r.error });
});
