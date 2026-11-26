import type { Gravedad, PrismaClient } from '../generated/prisma/client.js';
import type { BonitaService } from '../integrations/bonita/bonita.service.js';
import { BonitaError, type CaseTimeline } from '../integrations/bonita/bonita.client.js';

/**
 * Indicadores del tablero directivo (rol AUDITOR).
 * Combina datos propios (PostgreSQL local) con tiempos por etapa leídos de la API de Bonita.
 */

export type EstadoProyecto = 'REGISTRADA' | 'CONVOCATORIA' | 'EVALUACION' | 'EJECUCION' | 'FINALIZADA';

export const ESTADOS: { estado: EstadoProyecto; etiqueta: string }[] = [
  { estado: 'REGISTRADA', etiqueta: 'Registrada' },
  { estado: 'CONVOCATORIA', etiqueta: 'Convocatoria abierta' },
  { estado: 'EVALUACION', etiqueta: 'Validación y adjudicación' },
  { estado: 'EJECUCION', etiqueta: 'En ejecución' },
  { estado: 'FINALIZADA', etiqueta: 'Finalizada' },
];

/** Orden de las etapas locales (derivadas de los timestamps de la base). */
export const ETAPAS_LOCALES = [
  'Registro → publicación de lotes',
  'Convocatoria abierta',
  'Validación y adjudicación',
  'Ejecución y cierre',
  'Operativo completo',
] as const;

/** Orden de las tareas humanas del proceso RescueSync en Bonita. */
export const ETAPAS_BONITA = [
  'Registrar emergencia',
  'Generar y publicar lotes',
  'Cargar o editar ofertas',
  'Evaluar curso alternativo',
  'Seleccionar y adjudicar ofertas',
  'Monitorear despliegue',
  'Marcar actividad finalizada',
  'Cerrar operativo',
];

/** Máximo de casos que se consultan a Bonita por pedido (los más recientes del filtro). */
export const MAX_CASOS_BONITA = 50;

export interface FiltrosIndicadores {
  desde?: string;
  hasta?: string;
  gravedad?: Gravedad;
}

export interface Duracion {
  etapa: string;
  n: number;
  promedioMs: number;
  minMs: number;
  maxMs: number;
}

export interface TiemposBonita {
  disponible: boolean;
  motivo: string | null;
  casosConsultados: number;
  casosFinalizados: number;
  duracionCasoPromedioMs: number | null;
  etapas: Duracion[];
}

const MESES_MAX = 36;

function inicioDelDia(fecha: string) { return new Date(`${fecha}T00:00:00`); }
function diaSiguiente(fecha: string) { const d = inicioDelDia(fecha); d.setDate(d.getDate() + 1); return d; }
function claveMes(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function diff(a: Date | null | undefined, b: Date | null | undefined) {
  return a && b ? Math.max(0, b.getTime() - a.getTime()) : null;
}
const redondear = (valor: number, decimales = 4) => Math.round(valor * 10 ** decimales) / 10 ** decimales;

export function resumirDuraciones(orden: readonly string[], muestras: Map<string, number[]>): Duracion[] {
  const nombres = [...orden.filter(e => muestras.has(e)), ...[...muestras.keys()].filter(e => !orden.includes(e)).sort()];
  return nombres.flatMap(etapa => {
    const valores = muestras.get(etapa)!;
    if (!valores.length) return [];
    return [{
      etapa, n: valores.length,
      promedioMs: Math.round(valores.reduce((s, v) => s + v, 0) / valores.length),
      minMs: Math.min(...valores), maxMs: Math.max(...valores),
    }];
  });
}

function agregar(muestras: Map<string, number[]>, etapa: string, valor: number | null) {
  if (valor === null) return;
  muestras.set(etapa, [...(muestras.get(etapa) ?? []), valor]);
}

/** Promedia la duración de cada tarea humana y de los casos terminados. */
export function resumirTimelines(timelines: CaseTimeline[]): Omit<TiemposBonita, 'disponible' | 'motivo'> {
  const muestras = new Map<string, number[]>();
  const duracionesCaso: number[] = [];
  for (const t of timelines) {
    for (const task of t.tasks) agregar(muestras, task.name, new Date(task.end).getTime() - new Date(task.start).getTime());
    if (t.state === 'COMPLETED' && t.start && t.end) duracionesCaso.push(Math.max(0, new Date(t.end).getTime() - new Date(t.start).getTime()));
  }
  return {
    casosConsultados: timelines.length,
    casosFinalizados: timelines.filter(t => t.state === 'COMPLETED').length,
    duracionCasoPromedioMs: duracionesCaso.length ? Math.round(duracionesCaso.reduce((s, v) => s + v, 0) / duracionesCaso.length) : null,
    etapas: resumirDuraciones(ETAPAS_BONITA, muestras),
  };
}

async function tiemposBonita(bonita: BonitaService, caseIds: string[]): Promise<TiemposBonita> {
  const vacio = { casosConsultados: 0, casosFinalizados: 0, duracionCasoPromedioMs: null, etapas: [] };
  const client = bonita.client;
  if (!client) return { disponible: false, motivo: 'La integración con Bonita está deshabilitada (BONITA_ENABLED=false).', ...vacio };
  if (!caseIds.length) return { disponible: true, motivo: null, ...vacio };
  try {
    return { disponible: true, motivo: null, ...resumirTimelines(await client.getCaseTimelines(caseIds)) };
  } catch (error) {
    const codigo = error instanceof BonitaError ? error.code : 'BONITA_ERROR';
    return { disponible: false, motivo: `No se pudo consultar la API de Bonita (${codigo}).`, ...vacio };
  }
}

export async function calcularIndicadores(prisma: PrismaClient, bonita: BonitaService, filtros: FiltrosIndicadores = {}) {
  const emergencias = await prisma.emergencia.findMany({
    where: {
      ...(filtros.gravedad ? { gravedad: filtros.gravedad } : {}),
      created_at: {
        ...(filtros.desde ? { gte: inicioDelDia(filtros.desde) } : {}),
        ...(filtros.hasta ? { lt: diaSiguiente(filtros.hasta) } : {}),
      },
    },
    orderBy: { created_at: 'desc' },
    include: {
      rondas: { include: { ventanas: true }, orderBy: { numero: 'asc' } },
      lotes: {
        include: {
          ofertas: {
            include: {
              adjudicacion: true,
              ong_usuario: { select: { organizacion: true } },
              validaciones: { select: { resultado: true } },
            },
          },
        },
      },
    },
  });

  const estados = new Map<EstadoProyecto, number>(ESTADOS.map(e => [e.estado, 0]));
  const gravedades = new Map<Gravedad, number>([['BAJA', 0], ['MEDIA', 0], ['ALTA', 0], ['CRITICA', 0]]);
  const porMes = new Map<string, { personal: number; recurso: number }>();
  const validaciones = new Map<string, number>([['COMPLETA', 0], ['PARCIAL', 0], ['APOYO', 0], ['SIN_CAPACIDAD', 0]]);
  const ongs = new Map<string, { organizacion: string; cantidad: number; adjudicaciones: number; viaConsorcio: number }>();
  const tiempos = new Map<string, number[]>();
  const coberturasLote: number[] = [];
  let adjudicaciones = 0;
  let adjudicacionesConsorcio = 0;
  let emergenciasConConsorcio = 0;
  let suministros = 0;

  const filas = emergencias.map(e => {
    const ronda = e.rondas.at(-1);
    const ventanasRonda = ronda?.ventanas ?? [];
    let estado: EstadoProyecto = 'REGISTRADA';
    if (e.cerrada_at) estado = 'FINALIZADA';
    else if (ronda?.seleccionada_at) estado = 'EJECUCION';
    else if (ronda?.publicada_at) {
      estado = !ventanasRonda.length || ventanasRonda.some(v => !v.cerrada_at) ? 'CONVOCATORIA' : 'EVALUACION';
    }
    estados.set(estado, estados.get(estado)! + 1);
    gravedades.set(e.gravedad, gravedades.get(e.gravedad)! + 1);

    // Tiempos por etapa a partir de los timestamps locales.
    const primeraPublicacion = e.rondas.find(r => r.publicada_at)?.publicada_at;
    agregar(tiempos, ETAPAS_LOCALES[0], diff(e.created_at, primeraPublicacion));
    for (const r of e.rondas) {
      for (const v of r.ventanas) if (v.cerrada_at) agregar(tiempos, ETAPAS_LOCALES[1], diff(v.abierta_at, v.cerrada_at));
      const cierres = r.ventanas.flatMap(v => v.cerrada_at ? [v.cerrada_at.getTime()] : []);
      if (r.seleccionada_at && cierres.length) agregar(tiempos, ETAPAS_LOCALES[2], diff(new Date(Math.max(...cierres)), r.seleccionada_at));
    }
    agregar(tiempos, ETAPAS_LOCALES[3], diff(ronda?.seleccionada_at, e.cerrada_at));
    agregar(tiempos, ETAPAS_LOCALES[4], diff(e.created_at, e.cerrada_at));

    // Lotes de la ronda vigente (las rondas reformuladas quedan como historial).
    const lotes = ronda ? e.lotes.filter(l => l.ronda_id === ronda.id) : e.lotes;
    let requerida = 0;
    let adjudicada = 0;
    let cubierta = 0;
    let usaConsorcio = false;
    for (const lote of e.lotes) {
      for (const o of lote.ofertas) {
        for (const v of o.validaciones) validaciones.set(v.resultado, (validaciones.get(v.resultado) ?? 0) + 1);
        if (!o.adjudicacion) continue;
        adjudicaciones++;
        suministros += o.cantidad_ofrecida;
        const mes = claveMes(o.adjudicacion.created_at);
        const acumulado = porMes.get(mes) ?? { personal: 0, recurso: 0 };
        if (lote.tipo === 'PERSONAL') acumulado.personal += o.cantidad_ofrecida; else acumulado.recurso += o.cantidad_ofrecida;
        porMes.set(mes, acumulado);
        const ong = ongs.get(o.ong_usuario_id) ?? { organizacion: o.ong_usuario.organizacion, cantidad: 0, adjudicaciones: 0, viaConsorcio: 0 };
        ong.cantidad += o.cantidad_ofrecida;
        ong.adjudicaciones++;
        if (o.consorcio_id) { ong.viaConsorcio++; adjudicacionesConsorcio++; usaConsorcio = true; }
        ongs.set(o.ong_usuario_id, ong);
      }
    }
    if (usaConsorcio) emergenciasConConsorcio++;
    for (const lote of lotes) {
      const adj = lote.ofertas.filter(o => o.adjudicacion).reduce((s, o) => s + o.cantidad_ofrecida, 0);
      requerida += lote.cantidad_requerida;
      adjudicada += adj;
      cubierta += Math.min(adj, lote.cantidad_requerida);
      if (ronda?.seleccionada_at) coberturasLote.push(Math.min(adj, lote.cantidad_requerida) / lote.cantidad_requerida);
    }
    return {
      id: e.id,
      zona: e.zona,
      gravedad: e.gravedad,
      estado,
      creadaAt: e.created_at.toISOString(),
      cerradaAt: e.cerrada_at?.toISOString() ?? null,
      bonitaCaseId: e.bonita_instance_id?.toString() ?? null,
      rondas: e.rondas.length,
      lotes: lotes.length,
      cantidadRequerida: requerida,
      cantidadAdjudicada: adjudicada,
      cobertura: ronda?.seleccionada_at && requerida > 0 ? redondear(cubierta / requerida) : null,
      usaConsorcio,
      duracionMs: diff(e.created_at, e.cerrada_at),
    };
  });

  // Serie mensual continua (incluye meses sin movimientos).
  const meses = [...porMes.keys()].sort();
  const suministrosPorMes: { mes: string; personal: number; recurso: number }[] = [];
  if (meses.length) {
    const [anio, mes] = meses[0]!.split('-').map(Number) as [number, number];
    const cursor = new Date(anio, mes - 1, 1);
    while (claveMes(cursor) <= meses.at(-1)! && suministrosPorMes.length < MESES_MAX) {
      const clave = claveMes(cursor);
      suministrosPorMes.push({ mes: clave, ...(porMes.get(clave) ?? { personal: 0, recurso: 0 }) });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  const caseIds = emergencias.flatMap(e => e.bonita_instance_id ? [e.bonita_instance_id.toString()] : []).slice(0, MAX_CASOS_BONITA);
  const duraciones = filas.flatMap(f => f.duracionMs !== null ? [f.duracionMs] : []);

  return {
    generadoAt: new Date().toISOString(),
    filtros: { desde: filtros.desde ?? null, hasta: filtros.hasta ?? null, gravedad: filtros.gravedad ?? null },
    resumen: {
      emergencias: emergencias.length,
      finalizadas: estados.get('FINALIZADA')!,
      enCurso: emergencias.length - estados.get('FINALIZADA')!,
      suministrosMovilizados: suministros,
      adjudicaciones,
      adjudicacionesConsorcio,
      porcentajeConsorcio: adjudicaciones ? redondear(adjudicacionesConsorcio / adjudicaciones) : null,
      emergenciasConConsorcio,
      coberturaPromedio: coberturasLote.length ? redondear(coberturasLote.reduce((s, v) => s + v, 0) / coberturasLote.length) : null,
      duracionPromedioMs: duraciones.length ? Math.round(duraciones.reduce((s, v) => s + v, 0) / duraciones.length) : null,
    },
    suministrosPorMes,
    estados: ESTADOS.map(e => ({ ...e, cantidad: estados.get(e.estado)! })),
    gravedad: [...gravedades].map(([gravedad, cantidad]) => ({ gravedad, cantidad })),
    validaciones: [...validaciones].map(([resultado, cantidad]) => ({ resultado, cantidad })),
    ongs: [...ongs.values()].sort((a, b) => b.cantidad - a.cantidad || a.organizacion.localeCompare(b.organizacion)).slice(0, 10),
    tiemposLocales: resumirDuraciones(ETAPAS_LOCALES, tiempos),
    bonita: await tiemposBonita(bonita, caseIds),
    emergencias: filas,
  };
}

export type Indicadores = Awaited<ReturnType<typeof calcularIndicadores>>;
