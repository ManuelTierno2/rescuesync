import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "./db.js";
import { requireAuth } from "./auth.js";
import type { EstadoOng } from "./generated/prisma/enums.js";

export const ongsRouter = Router();

const ESTADOS: EstadoOng[] = ["PENDIENTE", "HABILITADA", "SUSPENDIDA"];
const bad = (res: Response, error: string) => res.status(400).json({ error });
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

// :id acepta el id interno (numérico) o el externalId de la app local (nunca puramente numérico).
async function ongId(req: Request): Promise<number | null> {
  const p = String(req.params.id);
  if (/^\d+$/.test(p)) return Number(p) > 0 ? Number(p) : null;
  return (await prisma.ong.findUnique({ where: { externalId: p }, select: { id: true } }))?.id ?? null;
}
const noEncontrada = (res: Response) => res.status(404).json({ error: "ONG no encontrada" });

const detalle = {
  certificaciones: { include: { certificacion: { include: { tipoRecurso: true } } } },
  recursos: { include: { tipoRecurso: true } },
} as const;

type OngDetalle = NonNullable<Awaited<ReturnType<typeof buscarOng>>>;
const buscarOng = (id: number) => prisma.ong.findUnique({ where: { id }, include: detalle });

function vista(o: OngDetalle) {
  const hoy = new Date();
  return {
    id: o.id, externalId: o.externalId, nombre: o.nombre, cuit: o.cuit, estado: o.estado,
    certificaciones: o.certificaciones.map((c) => ({
      codigo: c.certificacion.codigo, nombre: c.certificacion.nombre,
      tipoRecurso: c.certificacion.tipoRecurso.codigo, nivelRiesgoMax: c.certificacion.nivelRiesgoMax,
      vencimiento: c.vencimiento, vigente: !c.vencimiento || c.vencimiento > hoy,
    })),
    recursos: o.recursos.map((r) => ({
      tipoRecurso: r.tipoRecurso.codigo, unidad: r.tipoRecurso.unidad,
      total: r.total, bloqueado: r.bloqueado, disponible: r.total - r.bloqueado,
    })),
  };
}

// undefined = no informado, false = inválido, string = 11 dígitos normalizados.
function cuitValido(v: unknown): string | undefined | false {
  if (v == null || v === "") return undefined;
  const n = isStr(v) ? v.replace(/-/g, "") : "";
  return /^\d{11}$/.test(n) ? n : false;
}

// --- Onboarding (público): la ONG queda PENDIENTE hasta que un ADMIN la habilite ---
ongsRouter.post("/register", async (req, res) => {
  const { nombre, cuit, email, password } = req.body ?? {};
  const cuitNum = cuitValido(cuit);
  if (!isStr(nombre)) return bad(res, "nombre es obligatorio");
  if (cuitNum === false) return bad(res, "cuit debe tener 11 dígitos");
  if (!isStr(email) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, "email inválido");
  if (!isStr(password) || password.length < 8) return bad(res, "password debe tener al menos 8 caracteres");
  try {
    // Un create anidado corre en una sola transacción: no queda Ong sin Usuario.
    const ong = await prisma.ong.create({
      data: {
        nombre: nombre.trim(), cuit: cuitNum || null,
        usuario: { create: { email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 10), rol: "ONG" } },
      },
    });
    res.status(201).json({ id: ong.id, nombre: ong.nombre, cuit: ong.cuit, estado: ong.estado });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return res.status(409).json({ error: "cuit o email ya registrados" });
    throw e;
  }
});

// --- Catálogo (cualquier usuario autenticado) ---
ongsRouter.get("/certificaciones", requireAuth(), async (_req, res) => {
  const cs = await prisma.certificacion.findMany({ include: { tipoRecurso: true }, orderBy: { codigo: "asc" } });
  res.json(cs.map((c) => ({
    codigo: c.codigo, nombre: c.nombre, tipoRecurso: c.tipoRecurso.codigo, nivelRiesgoMax: c.nivelRiesgoMax,
  })));
});

ongsRouter.get("/tipos-recurso", requireAuth(), async (_req, res) => {
  res.json(await prisma.tipoRecurso.findMany({ select: { codigo: true, unidad: true }, orderBy: { codigo: "asc" } }));
});

// ONGs habilitadas. Solo un ADMIN puede pedir otro estado con ?estado=
ongsRouter.get("/ongs", requireAuth(), async (req, res) => {
  const pedido = req.query.estado;
  if (pedido !== undefined && !ESTADOS.includes(pedido as EstadoOng)) return bad(res, "estado inválido");
  const estado = req.user!.rol === "ADMIN" && pedido ? (pedido as EstadoOng) : "HABILITADA";
  const ongs = await prisma.ong.findMany({ where: { estado }, include: detalle, orderBy: { id: "asc" } });
  res.json(ongs.map(vista));
});

ongsRouter.get("/ongs/me", requireAuth("ONG"), async (req, res) => {
  const o = await buscarOng(req.user!.ongId!);
  if (!o) return res.status(404).json({ error: "ONG no encontrada" });
  res.json(vista(o));
});

ongsRouter.get("/ongs/:id", requireAuth(), async (req, res) => {
  const id = await ongId(req);
  if (!id) return noEncontrada(res);
  if (req.user!.rol === "ONG" && req.user!.ongId !== id) return res.status(403).json({ error: "Sin permisos" });
  const o = await buscarOng(id);
  if (!o) return res.status(404).json({ error: "ONG no encontrada" });
  res.json(vista(o));
});

// Disponibilidad global por tipo de recurso, sumando solo ONGs habilitadas.
ongsRouter.get("/recursos/disponibilidad", requireAuth(), async (_req, res) => {
  const filas = await prisma.ongRecurso.findMany({
    where: { ong: { estado: "HABILITADA" } }, include: { tipoRecurso: true },
  });
  const porTipo = new Map<string, { tipoRecurso: string; unidad: string; total: number; bloqueado: number; ongs: number }>();
  for (const f of filas) {
    const a = porTipo.get(f.tipoRecurso.codigo) ??
      { tipoRecurso: f.tipoRecurso.codigo, unidad: f.tipoRecurso.unidad, total: 0, bloqueado: 0, ongs: 0 };
    a.total += f.total; a.bloqueado += f.bloqueado; a.ongs += 1;
    porTipo.set(a.tipoRecurso, a);
  }
  res.json([...porTipo.values()].map((a) => ({ ...a, disponible: a.total - a.bloqueado })));
});

// --- Gestión (solo ADMIN) ---
type Fallo = { status: number; error: string };

// Reemplaza el conjunto de certificaciones de la ONG.
async function setCertificaciones(id: number, lista: unknown): Promise<Fallo | null> {
  if (!Array.isArray(lista) || !lista.every((c) => isStr(c?.codigo) && (c.vencimiento == null || !isNaN(Date.parse(c.vencimiento)))))
    return { status: 400, error: "certificaciones debe ser [{codigo, vencimiento?}] con fechas ISO válidas" };
  const codigos: string[] = [...new Set<string>(lista.map((c) => c.codigo))];
  const certs = await prisma.certificacion.findMany({ where: { codigo: { in: codigos } } });
  const faltan = codigos.filter((c) => !certs.some((x) => x.codigo === c));
  if (faltan.length) return { status: 400, error: `certificaciones inexistentes: ${faltan.join(", ")}` };
  await prisma.$transaction([
    prisma.ongCertificacion.deleteMany({ where: { ongId: id } }),
    prisma.ongCertificacion.createMany({
      data: codigos.map((codigo) => {
        const venc = lista.find((c) => c.codigo === codigo).vencimiento;
        return { ongId: id, certificacionId: certs.find((c) => c.codigo === codigo)!.id, vencimiento: venc ? new Date(venc) : null };
      }),
    }),
  ]);
  return null;
}

// Fija el total de cada tipo de recurso. No toca `bloqueado`.
async function setRecursos(id: number, lista: unknown): Promise<Fallo | null> {
  if (!Array.isArray(lista) || !lista.every((r) => isStr(r?.tipoRecurso) && isCount(r?.total)))
    return { status: 400, error: "recursos debe ser [{tipoRecurso, total}] con total entero >= 0" };
  if (new Set(lista.map((r) => r.tipoRecurso)).size !== lista.length) return { status: 400, error: "tipoRecurso repetido" };
  const tipos = await prisma.tipoRecurso.findMany({ where: { codigo: { in: lista.map((r) => r.tipoRecurso) } } });
  const faltan = lista.filter((r) => !tipos.some((t) => t.codigo === r.tipoRecurso)).map((r) => r.tipoRecurso);
  if (faltan.length) return { status: 400, error: `tipos de recurso inexistentes: ${faltan.join(", ")}` };
  const tipoId = (codigo: string) => tipos.find((t) => t.codigo === codigo)!.id;
  try {
    await prisma.$transaction(
      lista.map((r) => prisma.ongRecurso.upsert({
        where: { ongId_tipoRecursoId: { ongId: id, tipoRecursoId: tipoId(r.tipoRecurso) } },
        update: { total: r.total },
        create: { ongId: id, tipoRecursoId: tipoId(r.tipoRecurso), total: r.total },
      })),
    );
  } catch (e) {
    // El CHECK 0 <= bloqueado <= total impide bajar el total por debajo de lo ya comprometido.
    if (String((e as Error).message).includes("check constraint"))
      return { status: 409, error: "total menor a la cantidad ya bloqueada" };
    throw e;
  }
  return null;
}

// Alta/actualización desde el backend local, idempotente por externalId. No crea usuario.
// `estado` solo se aplica si viene; una ONG nueva queda PENDIENTE por defecto.
ongsRouter.post("/ongs", requireAuth("ADMIN"), async (req, res) => {
  const { externalId, nombre, cuit, estado, certificaciones, recursos } = req.body ?? {};
  const cuitNum = cuitValido(cuit);
  if (!isStr(externalId) || /^\d+$/.test(externalId)) return bad(res, "externalId es obligatorio y no puede ser solo numérico");
  if (!isStr(nombre)) return bad(res, "nombre es obligatorio");
  if (cuitNum === false) return bad(res, "cuit debe tener 11 dígitos");
  if (estado !== undefined && !ESTADOS.includes(estado)) return bad(res, `estado debe ser uno de ${ESTADOS.join(", ")}`);
  const existente = await prisma.ong.findUnique({ where: { externalId } });
  let ong;
  try {
    ong = existente
      ? await prisma.ong.update({ where: { id: existente.id }, data: { nombre: nombre.trim(), ...(cuitNum && { cuit: cuitNum }), ...(estado && { estado }) } })
      : await prisma.ong.create({ data: { externalId, nombre: nombre.trim(), cuit: cuitNum ?? null, ...(estado && { estado }) } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return res.status(409).json({ error: "cuit ya registrado en otra ONG" });
    throw e;
  }
  const fallo = (certificaciones !== undefined && (await setCertificaciones(ong.id, certificaciones))) ||
    (recursos !== undefined && (await setRecursos(ong.id, recursos))) || null;
  if (fallo) return res.status(fallo.status).json({ error: fallo.error, ongId: ong.id });
  res.status(existente ? 200 : 201).json(vista((await buscarOng(ong.id))!));
});

ongsRouter.patch("/ongs/:id/estado", requireAuth("ADMIN"), async (req, res) => {
  const id = await ongId(req);
  const { estado } = req.body ?? {};
  if (!id) return noEncontrada(res);
  if (!ESTADOS.includes(estado)) return bad(res, `estado debe ser uno de ${ESTADOS.join(", ")}`);
  if (!(await prisma.ong.findUnique({ where: { id } }))) return noEncontrada(res);
  const ong = await prisma.ong.update({ where: { id }, data: { estado } });
  res.json({ id: ong.id, estado: ong.estado });
});

ongsRouter.put("/ongs/:id/certificaciones", requireAuth("ADMIN"), async (req, res) => {
  const id = await ongId(req);
  if (!id || !(await prisma.ong.findUnique({ where: { id } }))) return noEncontrada(res);
  const fallo = await setCertificaciones(id, req.body?.certificaciones);
  if (fallo) return res.status(fallo.status).json({ error: fallo.error });
  res.json(vista((await buscarOng(id))!));
});

ongsRouter.put("/ongs/:id/recursos", requireAuth("ADMIN"), async (req, res) => {
  const id = await ongId(req);
  if (!id || !(await prisma.ong.findUnique({ where: { id } }))) return noEncontrada(res);
  const fallo = await setRecursos(id, req.body?.recursos);
  if (fallo) return res.status(fallo.status).json({ error: fallo.error });
  res.json(vista((await buscarOng(id))!));
});
