import { useState } from 'react';
import { Link } from 'react-router';
import type { Duracion, Gravedad, Indicadores } from '../api';
import { useAuth } from '../auth-context';
import { useApiData } from '../hooks';
import { ErrorMessage, Loading, formatDate, formatDuracion, formatNumber, formatPercent } from '../ui';
import {
  BarList, ChartCard, DataTable, SegmentedBar, SERIES, StackedColumns, StatTile, download, toCsv, type Column,
} from '../components/charts';

const GRAVEDADES: Gravedad[] = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'];
const RESULTADOS: Record<string, string> = {
  COMPLETA: 'Completa', PARCIAL: 'Parcial', APOYO: 'Apoyo secundario', SIN_CAPACIDAD: 'Sin capacidad',
};

function etiquetaMes(mes: string) {
  const [anio, m] = mes.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit' }).format(new Date(anio, m - 1, 1));
}

const columnasDuracion: Column<Duracion>[] = [
  { label: 'Etapa', value: r => r.etapa },
  { label: 'Muestras', value: r => r.n, numeric: true },
  { label: 'Promedio (h)', value: r => +(r.promedioMs / 3600000).toFixed(2), format: r => formatDuracion(r.promedioMs), numeric: true },
  { label: 'Mínimo (h)', value: r => +(r.minMs / 3600000).toFixed(2), format: r => formatDuracion(r.minMs), numeric: true },
  { label: 'Máximo (h)', value: r => +(r.maxMs / 3600000).toFixed(2), format: r => formatDuracion(r.maxMs), numeric: true },
];

type FilaEmergencia = Indicadores['emergencias'][number];
const columnasEmergencias: Column<FilaEmergencia>[] = [
  { label: 'Zona', value: r => r.zona, format: r => <Link to={'/emergencias/' + r.id}>{r.zona}</Link> },
  { label: 'Gravedad', value: r => r.gravedad },
  { label: 'Estado', value: r => r.estado },
  { label: 'Alta', value: r => r.creadaAt, format: r => formatDate(r.creadaAt) },
  { label: 'Cierre', value: r => r.cerradaAt, format: r => (r.cerradaAt ? formatDate(r.cerradaAt) : '—') },
  { label: 'Rondas', value: r => r.rondas, numeric: true },
  { label: 'Lotes', value: r => r.lotes, numeric: true },
  { label: 'Requerido', value: r => r.cantidadRequerida, numeric: true },
  { label: 'Adjudicado', value: r => r.cantidadAdjudicada, numeric: true },
  { label: 'Cobertura', value: r => r.cobertura, format: r => formatPercent(r.cobertura), numeric: true },
  { label: 'Consorcio', value: r => (r.usaConsorcio ? 'Sí' : 'No') },
  { label: 'Duración (h)', value: r => (r.duracionMs === null ? null : +(r.duracionMs / 3600000).toFixed(2)), format: r => formatDuracion(r.duracionMs), numeric: true },
  { label: 'Caso Bonita', value: r => r.bonitaCaseId },
];

function TiemposCard({ data }: { data: Indicadores }) {
  const bonitaConDatos = data.bonita.disponible && data.bonita.etapas.length > 0;
  const [fuente, setFuente] = useState<'bonita' | 'local'>(bonitaConDatos ? 'bonita' : 'local');
  const filas = fuente === 'bonita' ? data.bonita.etapas : data.tiemposLocales;
  return (
    <ChartCard
      title="Tiempo promedio por etapa"
      subtitle={fuente === 'bonita'
        ? `API de Bonita: tareas humanas terminadas de ${formatNumber(data.bonita.casosConsultados)} casos. Duración media de un caso completo: ${formatDuracion(data.bonita.duracionCasoPromedioMs)}.`
        : 'Registro local: marcas de tiempo de rondas, ventanas de convocatoria, adjudicación y cierre.'}
      rows={filas}
      columns={columnasDuracion}
      filename={`tiempos-${fuente}`}
      actions={
        <div className="segmented-control" role="group" aria-label="Fuente de los tiempos">
          <button type="button" aria-pressed={fuente === 'bonita'} onClick={() => setFuente('bonita')} disabled={!bonitaConDatos}
            title={bonitaConDatos ? undefined : data.bonita.motivo ?? 'Bonita no tiene tareas terminadas para este período.'}>Bonita</button>
          <button type="button" aria-pressed={fuente === 'local'} onClick={() => setFuente('local')}>Registro local</button>
        </div>
      }
    >
      <BarList
        label="Tiempo promedio por etapa"
        format={v => formatDuracion(v)}
        data={filas.map(e => ({
          label: e.etapa, value: e.promedioMs,
          detail: [`Muestras: ${e.n}`, `Mínimo: ${formatDuracion(e.minMs)}`, `Máximo: ${formatDuracion(e.maxMs)}`],
        }))}
      />
    </ChartCard>
  );
}

export function AuditorDashboard() {
  const { user } = useAuth();
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [gravedad, setGravedad] = useState<Gravedad | ''>('');
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  if (gravedad) params.set('gravedad', gravedad);
  const query = useApiData<Indicadores>('/indicadores' + (params.size ? '?' + params : ''));
  if (user?.rol !== 'AUDITOR') {
    return <p className="notice">Solo el rol AUDITOR puede ver este tablero.</p>;
  }
  const d = query.data;
  const sufijo = [desde || 'inicio', hasta || 'hoy', gravedad].filter(Boolean).join('_');

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Auditoría · Dirección</p>
          <h1>Indicadores</h1>
          <p className="muted">Datos de la aplicación combinados con los tiempos del motor Bonita.</p>
        </div>
        <div className="chart-actions">
          <button type="button" className="secondary" disabled={!d}
            onClick={() => d && download(`indicadores_${sufijo}.json`, JSON.stringify(d, null, 2), 'application/json')}>
            Exportar JSON
          </button>
          <button type="button" disabled={!d?.emergencias.length}
            onClick={() => d && download(`emergencias_${sufijo}.csv`, toCsv(d.emergencias, columnasEmergencias), 'text/csv;charset=utf-8')}>
            Exportar CSV
          </button>
        </div>
      </div>

      <form className="filter-bar" onSubmit={e => e.preventDefault()} aria-label="Filtros del tablero">
        <label>Desde<input type="date" value={desde} max={hasta || undefined} onChange={e => setDesde(e.target.value)} /></label>
        <label>Hasta<input type="date" value={hasta} min={desde || undefined} onChange={e => setHasta(e.target.value)} /></label>
        <label>Gravedad
          <select value={gravedad} onChange={e => setGravedad(e.target.value as Gravedad | '')}>
            <option value="">Todas</option>
            {GRAVEDADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => { setDesde(''); setHasta(''); setGravedad(''); }}
          disabled={!desde && !hasta && !gravedad}>Limpiar</button>
        <button type="button" className="secondary" onClick={query.refresh}>Actualizar</button>
      </form>

      <ErrorMessage error={query.error} retry={query.refresh} />
      {query.loading && !d && <Loading />}
      {d && (
        <div className={query.loading ? 'dashboard is-loading' : 'dashboard'} aria-busy={query.loading}>
          {!d.bonita.disponible && <p className="notice warning">{d.bonita.motivo} Los tiempos se muestran desde el registro local.</p>}

          <div className="stat-grid">
            <StatTile label="Emergencias" value={formatNumber(d.resumen.emergencias)}
              hint={`${formatNumber(d.resumen.finalizadas)} finalizadas · ${formatNumber(d.resumen.enCurso)} en curso`} />
            <StatTile label="Suministros movilizados" value={formatNumber(d.resumen.suministrosMovilizados)}
              hint={`${formatNumber(d.resumen.adjudicaciones)} ofertas adjudicadas`} />
            <StatTile label="Resolución mediante consorcios" value={formatPercent(d.resumen.porcentajeConsorcio)}
              hint={`${formatNumber(d.resumen.emergenciasConConsorcio)} emergencias con consorcio`} />
            <StatTile label="Cobertura media de lotes" value={formatPercent(d.resumen.coberturaPromedio)}
              hint="Sobre lotes ya adjudicados" />
            <StatTile label="Duración media del operativo" value={formatDuracion(d.resumen.duracionPromedioMs)}
              hint="Desde el alta hasta el cierre" />
          </div>

          <div className="chart-grid">
            <ChartCard title="Suministros movilizados por mes" subtitle="Cantidad adjudicada según el mes de adjudicación. Personal y recursos van por separado, cada uno con su escala."
              rows={d.suministrosPorMes} filename={`suministros-por-mes_${sufijo}`}
              columns={[
                { label: 'Mes', value: r => r.mes, format: r => etiquetaMes(r.mes) },
                { label: 'Personal', value: r => r.personal, numeric: true },
                { label: 'Recursos', value: r => r.recurso, numeric: true },
              ]}>
              <StackedColumns unit="personas" height={150}
                series={[{ name: 'Personal', color: SERIES[0] }]}
                data={d.suministrosPorMes.map(m => ({ label: etiquetaMes(m.mes), values: [m.personal] }))} />
              <StackedColumns unit="unidades" height={150}
                series={[{ name: 'Recursos', color: SERIES[1] }]}
                data={d.suministrosPorMes.map(m => ({ label: etiquetaMes(m.mes), values: [m.recurso] }))} />
            </ChartCard>

            <ChartCard title="Estado de los proyectos" subtitle="Etapa actual de cada emergencia del período."
              rows={d.estados} filename={`estados_${sufijo}`}
              columns={[{ label: 'Estado', value: r => r.etiqueta }, { label: 'Emergencias', value: r => r.cantidad, numeric: true }]}>
              <BarList label="Emergencias por estado"
                data={d.estados.map(e => ({ label: e.etiqueta, value: e.cantidad, detail: [`${e.cantidad} de ${d.resumen.emergencias} emergencias`] }))} />
            </ChartCard>

            <ChartCard title="Adjudicaciones con consorcio" subtitle="Ofertas adjudicadas presentadas en consorcio frente a ofertas individuales."
              rows={[
                { tipo: 'Consorcio', cantidad: d.resumen.adjudicacionesConsorcio },
                { tipo: 'Individual', cantidad: d.resumen.adjudicaciones - d.resumen.adjudicacionesConsorcio },
              ].filter(() => d.resumen.adjudicaciones > 0)}
              filename={`consorcios_${sufijo}`}
              columns={[{ label: 'Modalidad', value: r => r.tipo }, { label: 'Adjudicaciones', value: r => r.cantidad, numeric: true }]}>
              <SegmentedBar parts={[
                { name: 'Consorcio', value: d.resumen.adjudicacionesConsorcio, color: SERIES[0] },
                { name: 'Individual', value: d.resumen.adjudicaciones - d.resumen.adjudicacionesConsorcio, color: SERIES[1] },
              ]} />
            </ChartCard>

            <TiemposCard key={`${d.bonita.disponible}-${d.bonita.etapas.length > 0}`} data={d} />

            <ChartCard title="Validación del Sistema Nacional" subtitle="Resultado de cada evaluación de oferta por niveles de competencia."
              rows={d.validaciones} filename={`validaciones_${sufijo}`}
              columns={[{ label: 'Resultado', value: r => r.resultado, format: r => RESULTADOS[r.resultado] ?? r.resultado }, { label: 'Ofertas', value: r => r.cantidad, numeric: true }]}>
              <BarList label="Resultados de validación"
                data={d.validaciones.map(v => ({ label: RESULTADOS[v.resultado] ?? v.resultado, value: v.cantidad }))} />
            </ChartCard>

            <ChartCard title="ONGs con más suministros adjudicados" subtitle="Las diez organizaciones con mayor cantidad adjudicada."
              rows={d.ongs} filename={`ongs_${sufijo}`}
              columns={[
                { label: 'Organización', value: r => r.organizacion },
                { label: 'Cantidad', value: r => r.cantidad, numeric: true },
                { label: 'Adjudicaciones', value: r => r.adjudicaciones, numeric: true },
                { label: 'En consorcio', value: r => r.viaConsorcio, numeric: true },
              ]}>
              <BarList label="ONGs por cantidad adjudicada"
                data={d.ongs.map(o => ({
                  label: o.organizacion, value: o.cantidad,
                  detail: [`${o.adjudicaciones} ofertas adjudicadas`, `${o.viaConsorcio} en consorcio`],
                }))} />
            </ChartCard>
          </div>

          <section className="card" aria-label="Detalle por emergencia">
            <header className="chart-header">
              <div>
                <h2>Detalle por emergencia</h2>
                <p className="muted chart-subtitle">Generado {formatDate(d.generadoAt)}. Es la tabla que se descarga con «Exportar CSV».</p>
              </div>
            </header>
            <DataTable rows={d.emergencias} columns={columnasEmergencias} caption="Detalle por emergencia" />
          </section>
        </div>
      )}
    </>
  );
}
