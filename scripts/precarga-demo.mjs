// Precarga de datos para la demo (pauta 2 de la cátedra): ONG habilitadas, certificaciones vigentes,
// tipos de recurso e inventario con stock suficiente, en el Sistema Nacional y en la base local.
//
// Es una herramienta de preparación del entorno, no parte de la aplicación web: la app nunca llama al SN.
// Idempotente: se puede correr varias veces (POST /ongs del SN es upsert por externalId y el inventario
// local se actualiza por ONG + código de recurso).
//
// Uso (desde la raíz del repo):  node scripts/precarga-demo.mjs
// Lee DATABASE_URL, SN_API_URL, SN_ADMIN_EMAIL y SN_ADMIN_PASSWORD del entorno o de backend/.env.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(raiz, 'backend', 'package.json'));
const { Client } = require('pg');

const envFile = join(raiz, 'backend', '.env');
const fileEnv = existsSync(envFile) ? Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; })) : {};
const env = (k) => process.env[k] ?? fileEnv[k];
for (const k of ['DATABASE_URL', 'SN_API_URL', 'SN_ADMIN_EMAIL', 'SN_ADMIN_PASSWORD'])
  if (!env(k)) { console.error(`Falta ${k} (variable de entorno o backend/.env).`); process.exit(1); }

const VENCE = '2030-12-31T00:00:00Z';
// externalId en el SN = id del usuario ONG de la app (ver seed del backend).
const ONGS = [
  {
    id: '33333333-3333-4333-8333-333333333333', nombre: 'ONG A',
    recursos: [
      { codigo: 'PARAMEDICO', tipo: 'PERSONAL', descripcion: 'Paramédicos', unidad: 'personas', total: 20, cert: 'PARAMEDICO_AVANZADO' },
      // Primeros auxilios habilita hasta riesgo MEDIO: en una emergencia ALTA la oferta da APOYO.
      { codigo: 'KIT_MEDICO', tipo: 'RECURSO', descripcion: 'Kits médicos', unidad: 'kits', total: 100, cert: 'PRIMEROS_AUXILIOS' },
    ],
  },
  {
    id: '44444444-4444-4444-8444-444444444444', nombre: 'ONG B',
    recursos: [
      { codigo: 'RACION_ALIMENTO', tipo: 'RECURSO', descripcion: 'Raciones de alimento', unidad: 'raciones', total: 5000, cert: 'MANIPULACION_ALIMENTOS' },
      { codigo: 'AGUA_POTABLE', tipo: 'RECURSO', descripcion: 'Agua potable', unidad: 'litros', total: 20000, cert: 'LOGISTICA_AGUA' },
      { codigo: 'VEHICULO_RESCATE', tipo: 'RECURSO', descripcion: 'Vehículos de rescate', unidad: 'vehículos', total: 4, cert: 'RESCATE_VEHICULAR' },
      // Paramédico básico habilita hasta MEDIO: sirve para mostrar APOYO y un consorcio con ONG A.
      { codigo: 'PARAMEDICO', tipo: 'PERSONAL', descripcion: 'Paramédicos', unidad: 'personas', total: 5, cert: 'PARAMEDICO_BASICO' },
    ],
  },
];

const sn = env('SN_API_URL').replace(/\/+$/, '');
async function snCall(path, options = {}) {
  for (let intento = 1; ; intento++) {
    try { return await fetch(sn + path, { ...options, signal: AbortSignal.timeout(90_000) }); }
    catch (e) { if (intento >= 3) throw e; console.log('  el SN no respondió (Render despertando), reintento…'); }
  }
}

console.log(`Sistema Nacional: ${sn}`);
const login = await snCall('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: env('SN_ADMIN_EMAIL'), password: env('SN_ADMIN_PASSWORD') }) });
if (login.status !== 200) { console.error('Login ADMIN en el SN falló:', login.status); process.exit(1); }
const { token } = await login.json();
for (const ong of ONGS) {
  const res = await snCall('/ongs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      externalId: ong.id, nombre: ong.nombre, estado: 'HABILITADA',
      certificaciones: [...new Set(ong.recursos.map(r => r.cert))].map(codigo => ({ codigo, vencimiento: VENCE })),
      recursos: ong.recursos.map(r => ({ tipoRecurso: r.codigo, total: r.total })),
    }),
  });
  const body = await res.json();
  if (res.status !== 200 && res.status !== 201) { console.error(`  ${ong.nombre}: HTTP ${res.status}`, body); process.exit(1); }
  console.log(`  ${ong.nombre}: ${body.estado} · ${body.recursos.map(r => `${r.tipoRecurso} ${r.disponible}/${r.total}`).join(' · ')} · certs ${body.certificaciones.map(c => c.codigo).join(', ')}`);
}

const db = new Client({ connectionString: env('DATABASE_URL') });
await db.connect();
console.log('Base local: inventario de las ONG');
try {
  await db.query('BEGIN');
  for (const ong of ONGS) for (const r of ong.recursos) {
    const upd = await db.query(
      `UPDATE inventario_items SET tipo = $3::tipo_lote, descripcion = $4, cantidad = $5, unidad = $6, updated_at = now()
       WHERE ong_usuario_id = $1 AND codigo_sn = $2`, [ong.id, r.codigo, r.tipo, r.descripcion, r.total, r.unidad]);
    if (!upd.rowCount) await db.query(
      `INSERT INTO inventario_items (id, ong_usuario_id, tipo, descripcion, cantidad, unidad, codigo_sn, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $3::tipo_lote, $4, $5, $6, $2, now(), now())`, [ong.id, r.codigo, r.tipo, r.descripcion, r.total, r.unidad]);
    console.log(`  ${ong.nombre}: ${r.descripcion} ${r.total} ${r.unidad} (${r.codigo})`);
  }
  await db.query('COMMIT');
} catch (e) { await db.query('ROLLBACK'); throw e; } finally { await db.end(); }
console.log('Precarga lista.');
