import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "./app.js";
import { openapi } from "./openapi.js";

// Recorre las capas de Express (incluidos los routers montados) y arma "METODO /ruta".
function rutas(stack: any[]): string[] {
  return stack.flatMap((l) =>
    l.route
      ? Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route.path.replace(/:(\w+)/g, "{$1}")}`)
      : l.name === "router" && l.handle?.stack ? rutas(l.handle.stack) : []);
}

test("la especificación OpenAPI documenta exactamente las rutas de la API", () => {
  const enExpress = rutas((app as any).router.stack)
    .filter((r) => !/ \/(docs|openapi\.json)?$/.test(r)) // la UI, el propio JSON y la redirección de /
    .sort();
  const enSpec = Object.entries(openapi.paths)
    .flatMap(([ruta, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${ruta}`))
    .sort();
  assert.ok(enExpress.length > 10, "no se encontraron las rutas de Express");
  assert.deepEqual(enSpec, enExpress);
});
