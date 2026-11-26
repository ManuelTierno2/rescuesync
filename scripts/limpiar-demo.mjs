// Deja el entorno en cero antes de una demo:
//  1. Base local: borra emergencias, rondas, lotes, ofertas, validaciones, adjudicaciones, acciones,
//     consorcios e inventario. Conserva usuarios y organizaciones (seed).
//  2. Bonita (si responde): borra los casos abiertos y archivados de RescueSync con un usuario administrador.
//  3. Sistema Nacional: libera los compromisos que hayan quedado ACTIVOS (no borra historial).
// Después correr `node scripts/precarga-demo.mjs`.
//
// Uso:  node scripts/limpiar-demo.mjs
// Admin de Bonita: BONITA_ADMIN_USER / BONITA_ADMIN_PASS (por defecto walter.bates / bpm de Studio).
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
const env = (k, d) => process.env[k] ?? fileEnv[k] ?? d;

// 1. Base local
const db = new Client({ connectionString: env('DATABASE_URL') });
await db.connect();
const tablas = ['ofertas_validacion', 'adjudicaciones', 'ofertas_historial', 'ofertas', 'participaciones_ong',
  'ventanas_convocatoria', 'lotes', 'rondas', 'acciones_workflow', 'emergencias', 'consorcio_miembros', 'consorcios', 'inventario_items'];
const antes = {};
for (const t of tablas) antes[t] = Number((await db.query(`select count(*) from ${t}`)).rows[0].count);
await db.query(`TRUNCATE ${tablas.join(', ')}`);
await db.end();
console.log('Base local vaciada:', Object.entries(antes).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`).join(', ') || 'ya estaba vacía');

// 2. Bonita
const bonitaUrl = env('BONITA_URL', 'http://localhost:8080/bonita');
try {
  const cookies = new Map();
  const call = async (path, opts = {}) => {
    const headers = new Headers(opts.headers);
    if (cookies.size) headers.set('Cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    if (cookies.has('X-Bonita-API-Token')) headers.set('X-Bonita-API-Token', cookies.get('X-Bonita-API-Token'));
    const r = await fetch(bonitaUrl + path, { ...opts, headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    for (const c of r.headers.getSetCookie()) { const p = c.split(';')[0]; const i = p.indexOf('='); cookies.set(p.slice(0, i), p.slice(i + 1)); }
    return r;
  };
  const login = await call('/loginservice', { method: 'POST', body: new URLSearchParams({
    username: env('BONITA_ADMIN_USER', 'walter.bates'), password: env('BONITA_ADMIN_PASS', 'bpm'), redirect: 'false' }) });
  if (login.status !== 204) throw new Error('login de administrador rechazado (' + login.status + ')');
  const procesos = await (await call('/API/bpm/process?p=0&c=50&f=name=RescueSync')).json();
  let abiertos = 0, archivados = 0;
  for (const p of procesos) {
    for (;;) {
      const casos = await (await call(`/API/bpm/case?p=0&c=100&f=processDefinitionId=${p.id}`)).json();
      if (!Array.isArray(casos) || !casos.length) break;
      for (const c of casos) { const r = await call(`/API/bpm/case/${c.id}`, { method: 'DELETE' }); if (r.ok) abiertos++; else { console.log('  no se pudo borrar el caso', c.id, r.status); } }
      if (casos.length < 100) break;
    }
    for (;;) {
      const casos = await (await call(`/API/bpm/archivedCase?p=0&c=100&f=processDefinitionId=${p.id}`)).json();
      if (!Array.isArray(casos) || !casos.length) break;
      let borrados = 0;
      for (const c of casos) { const r = await call(`/API/bpm/archivedCase/${c.id}`, { method: 'DELETE' }); if (r.ok) { archivados++; borrados++; } }
      if (!borrados || casos.length < 100) break;
    }
  }
  console.log(`Bonita: ${abiertos} casos abiertos y ${archivados} archivados borrados`);
} catch (e) {
  console.log('Bonita: no se limpiaron casos (' + e.message + '). Volver a correr con Bonita levantado.');
}

// 3. Sistema Nacional
const sn = env('SN_API_URL', '').replace(/\/+$/, '');
if (sn) {
  const snCall = async (path, opts = {}) => {
    for (let i = 1; ; i++) {
      try { return await fetch(sn + path, { ...opts, signal: AbortSignal.timeout(90000) }); }
      catch (e) { if (i >= 3) throw e; console.log('  el SN no respondió (Render despertando), reintento…'); }
    }
  };
  const login = await (await snCall('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env('SN_ADMIN_EMAIL'), password: env('SN_ADMIN_PASSWORD') }) })).json();
  const auth = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const activos = await (await snCall('/compromisos?estado=ACTIVO', { headers: auth })).json();
  const emergencias = [...new Set((Array.isArray(activos) ? activos : []).map(c => c.emergenciaId))];
  for (const emergenciaId of emergencias)
    await snCall('/compromisos/liberar', { method: 'POST', headers: auth, body: JSON.stringify({ emergenciaId }) });
  console.log(`Sistema Nacional: ${Array.isArray(activos) ? activos.length : 0} compromisos activos liberados`);
}
console.log('Limpieza lista. Ahora: node scripts/precarga-demo.mjs');
