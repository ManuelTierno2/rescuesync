import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const email = (process.env.ADMIN_EMAIL ?? "admin@rescuesync.local").toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!password) throw new Error("Falta ADMIN_PASSWORD");

const tipos = [
  { codigo: "PARAMEDICO", unidad: "persona" },
  { codigo: "RACION_ALIMENTO", unidad: "racion" },
  { codigo: "AGUA_POTABLE", unidad: "litro" },
  { codigo: "KIT_MEDICO", unidad: "kit" },
  { codigo: "VEHICULO_RESCATE", unidad: "vehiculo" },
];

// Cada certificación habilita un tipo de recurso hasta un nivel de riesgo.
const certs = [
  { codigo: "PARAMEDICO_BASICO", nombre: "Paramédico básico", tipo: "PARAMEDICO", nivelRiesgoMax: "MEDIO" },
  { codigo: "PARAMEDICO_AVANZADO", nombre: "Paramédico avanzado", tipo: "PARAMEDICO", nivelRiesgoMax: "CRITICO" },
  { codigo: "MANIPULACION_ALIMENTOS", nombre: "Manipulación de alimentos", tipo: "RACION_ALIMENTO", nivelRiesgoMax: "ALTO" },
  { codigo: "LOGISTICA_AGUA", nombre: "Logística de agua potable", tipo: "AGUA_POTABLE", nivelRiesgoMax: "ALTO" },
  { codigo: "PRIMEROS_AUXILIOS", nombre: "Primeros auxilios", tipo: "KIT_MEDICO", nivelRiesgoMax: "MEDIO" },
  { codigo: "RESCATE_VEHICULAR", nombre: "Rescate vehicular", tipo: "VEHICULO_RESCATE", nivelRiesgoMax: "ALTO" },
] as const;

await prisma.usuario.upsert({
  where: { email },
  update: { passwordHash: await bcrypt.hash(password, 10) },
  create: { email, passwordHash: await bcrypt.hash(password, 10), rol: "ADMIN" },
});

for (const t of tipos) {
  await prisma.tipoRecurso.upsert({ where: { codigo: t.codigo }, update: { unidad: t.unidad }, create: t });
}
for (const { tipo, ...c } of certs) {
  const tr = await prisma.tipoRecurso.findUniqueOrThrow({ where: { codigo: tipo } });
  await prisma.certificacion.upsert({
    where: { codigo: c.codigo },
    update: { ...c, tipoRecursoId: tr.id },
    create: { ...c, tipoRecursoId: tr.id },
  });
}
console.log(`Seed OK: admin ${email}, ${tipos.length} tipos de recurso, ${certs.length} certificaciones`);
await prisma.$disconnect();
