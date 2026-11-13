import type { InventarioNacional } from '../api';
import { useApiData } from '../hooks';
import { ErrorMessage, Loading, formatNumber } from '../ui';

const ESTADO_CLASE = { HABILITADA: 'severity-baja', PENDIENTE: 'severity-alta', SUSPENDIDA: 'severity-critica' } as const;

/** Estado de la ONG en el Sistema Nacional: habilitación, certificaciones y recursos comprometidos. */
export function DisponibilidadNacional() {
  const query = useApiData<InventarioNacional>('/inventario/nacional');
  const d = query.data;
  return (
    <section className="card nacional" aria-labelledby="nacional-title">
      <div className="chart-header">
        <div>
          <h2 id="nacional-title">Sistema Nacional</h2>
          <p className="muted chart-subtitle">Lo bloqueado está comprometido en emergencias adjudicadas y no puede volver a ofrecerse hasta su liberación.</p>
        </div>
        <button type="button" className="secondary small" onClick={query.refresh}>Actualizar</button>
      </div>
      <ErrorMessage error={query.error} retry={query.refresh} />
      {query.loading && !d && <Loading />}
      {d && !d.conectado && <p className="notice">El Sistema Nacional no está configurado en este entorno.</p>}
      {d?.conectado && !d.ong && (
        <p className="notice">Su ONG todavía no figura en el Sistema Nacional. Se registra cuando se valida su primera oferta.</p>
      )}
      {d?.ong && (
        <>
          <p>Estado: <span className={'badge ' + ESTADO_CLASE[d.ong.estado]}>{d.ong.estado}</span></p>
          <h3>Sus recursos</h3>
          {d.ong.recursos.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Recurso</th><th className="num">Total</th><th className="num">Bloqueado</th><th className="num">Disponible</th></tr></thead>
                <tbody>
                  {d.ong.recursos.map(r => (
                    <tr key={r.tipoRecurso}>
                      <td>{r.tipoRecurso} <span className="muted">({r.unidad})</span></td>
                      <td className="num">{formatNumber(r.total)}</td>
                      <td className="num">{formatNumber(r.bloqueado)}</td>
                      <td className="num"><strong>{formatNumber(r.disponible)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">Sin recursos registrados en el Sistema Nacional.</p>}
          <h3>Certificaciones</h3>
          {d.ong.certificaciones.length ? (
            <ul className="list-plain cert-list">
              {d.ong.certificaciones.map(c => (
                <li key={c.codigo}>
                  <strong>{c.nombre}</strong> · {c.tipoRecurso} hasta riesgo {c.nivelRiesgoMax}
                  {c.vigente ? '' : <span className="badge severity-critica">VENCIDA</span>}
                </li>
              ))}
            </ul>
          ) : <p className="muted">Sin certificaciones: sus ofertas se validan como SIN_CAPACIDAD.</p>}
        </>
      )}
      {d?.conectado && d.disponibilidad.length > 0 && (
        <>
          <h3>Disponibilidad nacional</h3>
          <p className="muted chart-subtitle">Suma de todas las ONG habilitadas.</p>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Recurso</th><th className="num">ONGs</th><th className="num">Total</th><th className="num">Bloqueado</th><th className="num">Disponible</th></tr></thead>
              <tbody>
                {d.disponibilidad.map(r => (
                  <tr key={r.tipoRecurso}>
                    <td>{r.tipoRecurso} <span className="muted">({r.unidad})</span></td>
                    <td className="num">{formatNumber(r.ongs)}</td>
                    <td className="num">{formatNumber(r.total)}</td>
                    <td className="num">{formatNumber(r.bloqueado)}</td>
                    <td className="num"><strong>{formatNumber(r.disponible)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
