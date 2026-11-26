// Prepara los casos de la demo usando la API de la aplicación, como lo harían las personas
// (Bonita y el Sistema Nacional funcionan de verdad: timers, conectores y compromisos reales).
// Todos los casos corren en paralelo, así los timers de 2 minutos vencen juntos (~4 minutos en total).
//
//  - F1 a F5: casos completos de punta a punta (alta → cierre y liberación), para el dashboard.
//  - A y B: sin cobertura, esperando «Evaluar curso alternativo» (reabrir y reformular).
//  - C: sin cobertura con una oferta APOYO, esperando «Evaluar curso alternativo» (continuar parcial).
//  - D y E: con 15 paramédicos de ONG A validados cada una, esperando «Seleccionar y adjudicar ofertas»
//    (al adjudicar la segunda, el SN responde 409 porque ONG A tiene 20).
//
// Requiere backend (http://localhost:3000), Bonita con RescueSync 1.8 y el SN despierto.
// Uso (después de limpiar-demo y precarga-demo):  node scripts/preparar-demo.mjs
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const PASS = 'demo1234';
const ID = {
  municipio: '11111111-1111-4111-8111-111111111111', coordinador: '22222222-2222-4222-8222-222222222222',
  ongA: '33333333-3333-4333-8333-333333333333', ongB: '44444444-4444-4444-8444-444444444444',
};
const EMAIL = { municipio: 'municipio', coordinador: 'coordinador', ongA: 'ong.a', ongB: 'ong.b' };

const token = {};
async function http(rol, method, path, body) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token[rol] ? { Authorization: 'Bearer ' + token[rol] } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} (${rol}) → ${r.status} ${json.error?.code ?? ''} ${json.error?.message ?? ''}`);
  return json;
}
for (const rol of Object.keys(EMAIL)) {
  const r = await http(rol, 'POST', '/auth/login', { email: `${EMAIL[rol]}@rescuesync.test`, password: PASS });
  token[rol] = r.data?.token ?? r.token;
  if (!token[rol]) throw new Error('No se obtuvo token para ' + rol);
}

// Inventario de cada ONG (cargado por precarga-demo) y consorcio de la demo.
const items = {};
for (const ong of ['ongA', 'ongB']) items[ong] = Object.fromEntries((await http(ong, 'GET', '/inventario')).data.map(i => [i.codigo_sn, i.id]));
const consorcio = (await http('ongB', 'POST', '/consorcios', { nombre: 'Red Solidaria', miembroIds: [ID.ongA] })).data.id;

const workflow = async id => (await http('coordinador', 'GET', `/emergencias/${id}/workflow`)).data;
async function esperar(id, que, cond, maxMs = 6 * 60_000) {
  const fin = Date.now() + maxMs;
  for (;;) {
    const w = await workflow(id);
    if (cond(w)) return w;
    if (Date.now() > fin) throw new Error(`timeout esperando ${que}`);
    await sleep(3000);
  }
}
const lista = (w, nombre) => w.readyTasks.some(t => t.name === nombre);
async function accion(rol, id, nombre, extra = {}) {
  const r = await http(rol, 'POST', `/emergencias/${id}/acciones/${nombre}`, { accionId: randomUUID(), ...extra });
  let a = r.data;
  for (let i = 0; a.estado !== 'CONFIRMADO' && i < 10; i++) {
    await sleep(2000);
    a = (await http(rol, 'POST', `/emergencias/${id}/acciones/${a.id}/reconciliar`, {})).data;
  }
  if (a.estado !== 'CONFIRMADO') throw new Error(`${nombre} quedó ${a.estado} (${a.error_code ?? ''})`);
  return a;
}

/** Recorre una emergencia hasta `hasta`: 'decision', 'seleccion' o 'cerrada'. */
async function caso({ clave, zona, gravedad, descripcion, lotes, hasta }) {
  const log = m => console.log(`[${clave}] ${m}`);
  const e = (await http('municipio', 'POST', '/emergencias', { creada_por_id: ID.municipio, gravedad, zona, descripcion })).data;
  await esperar(e.id, 'Generar y publicar lotes', w => lista(w, 'Generar y publicar lotes'));
  const creados = [];
  for (const l of lotes) creados.push({ ...l, id: (await http('coordinador', 'POST', `/emergencias/${e.id}/lotes`,
    { tipo: l.tipo, descripcion: l.descripcion, cantidad_requerida: l.requerida, unidad: l.unidad })).data.id });
  await accion('coordinador', e.id, 'publicar');
  await esperar(e.id, 'apertura de la ventana', w => w.windows.some(v => !v.cerrada_at));
  log('convocatoria abierta');
  for (const l of creados) for (const o of l.ofertas) {
    const of = (await http(o.ong, 'POST', `/lotes/${l.id}/ofertas`, { ong_usuario_id: ID[o.ong], cantidad_ofrecida: o.primera ?? o.cantidad,
      inventario_item_id: items[o.ong][l.codigo], ...(o.consorcio ? { consorcio_id: consorcio } : {}) })).data;
    if (o.primera) await http(o.ong, 'PATCH', `/ofertas/${of.id}`, { cantidad_ofrecida: o.cantidad }); // versión 2
  }
  log('ofertas cargadas; esperando el timer');
  const w = await esperar(e.id, 'fin del timer y validación', x => lista(x, 'Seleccionar y adjudicar ofertas') || lista(x, 'Evaluar curso alternativo'));
  const estado = lista(w, 'Evaluar curso alternativo') ? 'decision' : 'seleccion';
  log(estado === 'decision' ? 'sin cobertura: esperando al coordinador' : 'validado: esperando la adjudicación');
  if (hasta !== 'cerrada') {
    if (estado !== hasta) throw new Error(`quedó en «${estado}» y se esperaba «${hasta}»`);
    return { clave, zona, id: e.id, estado: hasta === 'decision' ? 'Evaluar curso alternativo' : 'Seleccionar y adjudicar ofertas' };
  }
  if (estado !== 'seleccion') throw new Error('sin cobertura total; revisar stock');
  await accion('municipio', e.id, 'ver-ofertas');
  const mon = (await http('municipio', 'GET', `/emergencias/${e.id}/monitoreo`)).data;
  const ofertaIds = mon.rondas[0].lotes.flatMap(l => l.ofertas.filter(o => o.validacion_actual && o.validacion_actual.resultado !== 'SIN_CAPACIDAD').map(o => o.id));
  await accion('municipio', e.id, 'adjudicar', { ofertaIds });
  const conf = await esperar(e.id, 'compromiso en el SN', x => x.compromiso?.estado !== 'PENDIENTE');
  if (conf.compromiso?.estado !== 'CONFIRMADO') throw new Error('el SN rechazó el compromiso: ' + conf.compromiso?.motivo);
  log('compromiso confirmado por el SN');
  const ongs = [...new Set(creados.flatMap(l => l.ofertas.map(o => o.ong)))];
  for (const ong of ongs) await accion(ong, e.id, 'leer');
  await accion('coordinador', e.id, 'finalizar-monitoreo');
  await esperar(e.id, 'tareas de las ONG', x => ongs.every(o => x.readyTasks.some(t => t.name === 'Marcar actividad finalizada' && t.ongUsuarioId === ID[o])));
  for (const ong of ongs) await accion(ong, e.id, 'finalizar-actividad');
  await esperar(e.id, 'Cerrar operativo', x => lista(x, 'Cerrar operativo'));
  await accion('coordinador', e.id, 'cerrar');
  await esperar(e.id, 'liberación y cierre', x => x.localClosed);
  log('cerrada y recursos liberados');
  return { clave, zona, id: e.id, estado: 'Finalizada' };
}

const P = (cantidad, ong = 'ongA', extra = {}) => ({ ong, cantidad, ...extra });
const casos = [
  { clave: 'F1', zona: 'Inundación Concordia', gravedad: 'ALTA', descripcion: 'Desborde del río Uruguay; 300 familias evacuadas.', hasta: 'cerrada', lotes: [
    { tipo: 'RECURSO', descripcion: 'Raciones de alimento', requerida: 800, unidad: 'raciones', codigo: 'RACION_ALIMENTO', ofertas: [P(800, 'ongB', { primera: 600 })] },
    { tipo: 'RECURSO', descripcion: 'Agua potable', requerida: 3000, unidad: 'litros', codigo: 'AGUA_POTABLE', ofertas: [P(3000, 'ongB')] }] },
  { clave: 'F2', zona: 'Incendio forestal El Bolsón', gravedad: 'ALTA', descripcion: 'Incendio de interfase en la comarca andina.', hasta: 'cerrada', lotes: [
    { tipo: 'RECURSO', descripcion: 'Vehículos de rescate', requerida: 2, unidad: 'vehículos', codigo: 'VEHICULO_RESCATE', ofertas: [P(2, 'ongB')] },
    { tipo: 'RECURSO', descripcion: 'Raciones de alimento', requerida: 400, unidad: 'raciones', codigo: 'RACION_ALIMENTO', ofertas: [P(400, 'ongB', { consorcio: true })] }] },
  { clave: 'F3', zona: 'Temporal Mar del Plata', gravedad: 'MEDIA', descripcion: 'Anegamientos y viviendas con techos dañados.', hasta: 'cerrada', lotes: [
    { tipo: 'RECURSO', descripcion: 'Kits médicos', requerida: 30, unidad: 'kits', codigo: 'KIT_MEDICO', ofertas: [P(30, 'ongA', { primera: 25 })] },
    { tipo: 'RECURSO', descripcion: 'Agua potable', requerida: 2000, unidad: 'litros', codigo: 'AGUA_POTABLE', ofertas: [P(2000, 'ongB', { consorcio: true })] }] },
  { clave: 'F4', zona: 'Tornado Pehuajó', gravedad: 'MEDIA', descripcion: 'Tornado con daños en la zona rural.', hasta: 'cerrada', lotes: [
    { tipo: 'RECURSO', descripcion: 'Kits médicos', requerida: 20, unidad: 'kits', codigo: 'KIT_MEDICO', ofertas: [P(20, 'ongA')] },
    { tipo: 'RECURSO', descripcion: 'Raciones de alimento', requerida: 600, unidad: 'raciones', codigo: 'RACION_ALIMENTO', ofertas: [P(600, 'ongB')] }] },
  { clave: 'F5', zona: 'Aluvión Tartagal', gravedad: 'ALTA', descripcion: 'Aluvión en barrios ribereños del río Tartagal.', hasta: 'cerrada', lotes: [
    { tipo: 'RECURSO', descripcion: 'Agua potable', requerida: 5000, unidad: 'litros', codigo: 'AGUA_POTABLE', ofertas: [P(5000, 'ongB', { consorcio: true })] },
    { tipo: 'RECURSO', descripcion: 'Vehículos de rescate', requerida: 1, unidad: 'vehículos', codigo: 'VEHICULO_RESCATE', ofertas: [P(1, 'ongB')] }] },
  { clave: 'A', zona: 'Incendio Tandil', gravedad: 'ALTA', descripcion: 'Incendio en las sierras; brigadas desbordadas.', hasta: 'decision', lotes: [
    { tipo: 'PERSONAL', descripcion: 'Paramédicos', requerida: 15, unidad: 'personas', codigo: 'PARAMEDICO', ofertas: [P(10)] }] },
  { clave: 'B', zona: 'Sismo San Juan', gravedad: 'ALTA', descripcion: 'Sismo de magnitud 6 con edificios afectados.', hasta: 'decision', lotes: [
    { tipo: 'PERSONAL', descripcion: 'Paramédicos', requerida: 15, unidad: 'personas', codigo: 'PARAMEDICO', ofertas: [P(10)] }] },
  { clave: 'C', zona: 'Temporal Bahía Blanca', gravedad: 'ALTA', descripcion: 'Temporal con vientos de 140 km/h.', hasta: 'decision', lotes: [
    { tipo: 'PERSONAL', descripcion: 'Paramédicos', requerida: 10, unidad: 'personas', codigo: 'PARAMEDICO', ofertas: [P(5)] },
    { tipo: 'RECURSO', descripcion: 'Kits médicos', requerida: 20, unidad: 'kits', codigo: 'KIT_MEDICO', ofertas: [P(20)] }] },
  { clave: 'D', zona: 'Crecida Luján', gravedad: 'ALTA', descripcion: 'Crecida del río Luján; evacuados en escuelas.', hasta: 'seleccion', lotes: [
    { tipo: 'PERSONAL', descripcion: 'Paramédicos', requerida: 15, unidad: 'personas', codigo: 'PARAMEDICO', ofertas: [P(15)] }] },
  { clave: 'E', zona: 'Crecida Pilar', gravedad: 'ALTA', descripcion: 'Crecida del río Luján aguas abajo, en Pilar.', hasta: 'seleccion', lotes: [
    { tipo: 'PERSONAL', descripcion: 'Paramédicos', requerida: 15, unidad: 'personas', codigo: 'PARAMEDICO', ofertas: [P(15)] }] },
];

console.log(`Preparando ${casos.length} casos en paralelo (unos 4 minutos)…`);
const res = await Promise.allSettled(casos.map(c => caso(c)));
console.log('\nResultado:');
res.forEach((r, i) => console.log(`  ${casos[i].clave.padEnd(3)} ${casos[i].zona.padEnd(30)} ${r.status === 'fulfilled' ? r.value.estado : 'ERROR: ' + r.reason.message}`));
if (res.some(r => r.status === 'rejected')) process.exitCode = 1;
