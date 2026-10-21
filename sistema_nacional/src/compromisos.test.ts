// Test de integración: necesita la base del .env (crea y borra su propia ONG de prueba).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "./db.js";
import { bloquear, liberar } from "./compromisos.js";

const ext = `test-${randomUUID()}`;
const item = (cantidad: number) => [{ tipoRecurso: "PARAMEDICO", cantidad }];
const bloqueado = async () => (await prisma.ongRecurso.findFirstOrThrow({ where: { ong: { externalId: ext } } })).bloqueado;

async function preparar(total: number) {
  await limpiar();
  const tipo = await prisma.tipoRecurso.findUniqueOrThrow({ where: { codigo: "PARAMEDICO" } });
  const cert = await prisma.certificacion.findUniqueOrThrow({ where: { codigo: "PARAMEDICO_AVANZADO" } });
  await prisma.ong.create({
    data: {
      externalId: ext, nombre: "ONG de prueba", estado: "HABILITADA",
      certificaciones: { create: { certificacionId: cert.id } },
      recursos: { create: { tipoRecursoId: tipo.id, total } },
    },
  });
}
async function limpiar() {
  const ong = await prisma.ong.findUnique({ where: { externalId: ext } });
  if (!ong) return;
  await prisma.compromisoItem.deleteMany({ where: { compromiso: { ongId: ong.id } } });
  await prisma.compromiso.deleteMany({ where: { ongId: ong.id } });
  await prisma.ongRecurso.deleteMany({ where: { ongId: ong.id } });
  await prisma.ongCertificacion.deleteMany({ where: { ongId: ong.id } });
  await prisma.ong.delete({ where: { id: ong.id } });
}
after(async () => { await limpiar(); await prisma.$disconnect(); });

test("dos adjudicaciones simultáneas sobre el mismo stock: solo una entra", async () => {
  await preparar(10);
  const [a, b] = await Promise.all([
    bloquear({ emergenciaId: "E1", loteId: "A", ongId: ext, items: item(6) }),
    bloquear({ emergenciaId: "E1", loteId: "B", ongId: ext, items: item(6) }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(await bloqueado(), 6);
  const perdedor = a.status === 409 ? a : b;
  assert.ok("detalle" in perdedor && perdedor.detalle[0].disponible === 4); // informa lo que sí queda
});

test("muchas adjudicaciones en paralelo nunca superan el total", async () => {
  await preparar(10);
  const rs = await Promise.all(Array.from({ length: 12 }, (_, i) =>
    bloquear({ emergenciaId: "E2", loteId: `L${i}`, ongId: ext, items: item(3) })));
  assert.equal(rs.filter((r) => r.status === 201).length, 3);
  assert.equal(rs.filter((r) => r.status === 409).length, 9);
  assert.equal(await bloqueado(), 9);
});

test("reintentos simultáneos del mismo compromiso se aplican una sola vez", async () => {
  await preparar(10);
  const rs = await Promise.all(Array.from({ length: 5 }, () =>
    bloquear({ emergenciaId: "E3", loteId: "A", ongId: ext, items: item(4) })));
  assert.equal(rs.filter((r) => r.status === 201).length, 1);
  assert.equal(rs.filter((r) => r.status === 200).length, 4);
  assert.equal(await bloqueado(), 4);
});

test("todo o nada: si un ítem no alcanza no se bloquea ninguno", async () => {
  await preparar(10);
  const tipo = await prisma.tipoRecurso.findUniqueOrThrow({ where: { codigo: "AGUA_POTABLE" } });
  const ong = await prisma.ong.findUniqueOrThrow({ where: { externalId: ext } });
  await prisma.ongRecurso.create({ data: { ongId: ong.id, tipoRecursoId: tipo.id, total: 5 } });
  const r = await bloquear({ emergenciaId: "E4", loteId: "A", ongId: ext,
    items: [{ tipoRecurso: "PARAMEDICO", cantidad: 2 }, { tipoRecurso: "AGUA_POTABLE", cantidad: 99 }] });
  assert.equal(r.status, 409);
  assert.equal(await bloqueado(), 0);
});

test("liberar devuelve el stock, es idempotente y una emergencia nueva puede volver a pedir lo mismo", async () => {
  await preparar(10);
  assert.equal((await bloquear({ emergenciaId: "E5", loteId: "A", ongId: ext, items: item(10) })).status, 201);
  assert.equal(await bloqueado(), 10);
  assert.equal((await bloquear({ emergenciaId: "E6", loteId: "A", ongId: ext, items: item(10) })).status, 409); // sin stock

  const l1 = await liberar({ emergenciaId: "E5" });
  assert.deepEqual([l1.status, "liberados" in l1 && l1.liberados], [200, 1]);
  assert.equal(await bloqueado(), 0);
  const l2 = await liberar({ emergenciaId: "E5" }); // repetida: no resta de nuevo
  assert.deepEqual([l2.status, "liberados" in l2 && l2.liberados, "yaLiberados" in l2 && l2.yaLiberados], [200, 0, 1]);
  assert.equal(await bloqueado(), 0);

  assert.equal((await bloquear({ emergenciaId: "E6", loteId: "A", ongId: ext, items: item(10) })).status, 201); // otra emergencia, mismos 10
  assert.equal((await bloquear({ emergenciaId: "E5", loteId: "A", ongId: ext, items: item(1) })).status, 409); // reintento tardío de la liberada
  assert.equal(await bloqueado(), 10);
});

test("liberaciones simultáneas del mismo compromiso restan una sola vez", async () => {
  await preparar(10);
  await bloquear({ emergenciaId: "E7", loteId: "A", ongId: ext, items: item(4) });
  await bloquear({ emergenciaId: "E7", loteId: "B", ongId: ext, items: item(3) });
  await Promise.all(Array.from({ length: 6 }, () => liberar({ emergenciaId: "E7" })));
  assert.equal(await bloqueado(), 0);
});

test("liberar por ONG y lote solo toca lo pedido; sin compromisos da 404", async () => {
  await preparar(10);
  await bloquear({ emergenciaId: "E8", loteId: "A", ongId: ext, items: item(4) });
  await bloquear({ emergenciaId: "E8", loteId: "B", ongId: ext, items: item(3) });
  await liberar({ emergenciaId: "E8", ongId: ext, loteId: "A" });
  assert.equal(await bloqueado(), 3);
  assert.equal((await liberar({ emergenciaId: "E-inexistente" })).status, 404);
});
