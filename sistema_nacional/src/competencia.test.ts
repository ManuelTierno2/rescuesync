import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluar } from "./competencia.js";

const ok = { habilitada: true, certNiveles: ["ALTO" as const], disponible: 10 };

test("evaluar", () => {
  assert.equal(evaluar({ cantidad: 10, nivelRiesgo: "ALTO" }, ok).resultado, "COMPLETA");
  assert.equal(evaluar({ cantidad: 5, nivelRiesgo: "BAJO" }, ok).resultado, "COMPLETA");
  // 10 de 10 disponibles: varias ofertas de <= 10 pasan; cada una se evalúa sola
  assert.equal(evaluar({ cantidad: 10, nivelRiesgo: "MEDIO" }, ok).cantidadValida, 10);
  const p = evaluar({ cantidad: 15, nivelRiesgo: "ALTO" }, ok);
  assert.deepEqual([p.resultado, p.cantidadValida], ["PARCIAL", 10]);
  const a = evaluar({ cantidad: 4, nivelRiesgo: "CRITICO" }, ok);
  assert.deepEqual([a.resultado, a.cantidadValida], ["APOYO", 4]);
  // el mayor nivel entre varias certificaciones
  assert.equal(evaluar({ cantidad: 1, nivelRiesgo: "CRITICO" }, { ...ok, certNiveles: ["MEDIO", "CRITICO"] }).resultado, "COMPLETA");
  assert.equal(evaluar({ cantidad: 1, nivelRiesgo: "BAJO" }, { ...ok, habilitada: false }).resultado, "SIN_CAPACIDAD");
  assert.equal(evaluar({ cantidad: 1, nivelRiesgo: "BAJO" }, { ...ok, certNiveles: [] }).resultado, "SIN_CAPACIDAD");
  assert.equal(evaluar({ cantidad: 1, nivelRiesgo: "BAJO" }, { ...ok, disponible: 0 }).resultado, "SIN_CAPACIDAD");
});
