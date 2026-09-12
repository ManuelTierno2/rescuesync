import { Link } from 'react-router';
import type { Emergencia } from '../api';
import { useApiData } from '../hooks';
import { useDevUser } from '../user-context';
import { ErrorMessage, Loading, formatDate } from '../ui';

export function EmergenciasPage() {
  const { user } = useDevUser();
  const query = useApiData<Emergencia[]>('/emergencias');
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Coordinación territorial</p>
          <h1>Emergencias</h1>
          <p className="muted">Necesidades y ofertas de ayuda, en un mismo lugar.</p>
        </div>
        {user?.rol === 'MUNICIPIO' && (
          <Link className="button" to="/emergencias/nueva">
            Registrar emergencia
          </Link>
        )}
      </div>
      <ErrorMessage error={query.error} retry={query.refresh} />
      {query.loading && <Loading />}
      {query.data?.length === 0 && (
        <div className="empty">
          <h2>Todavía no hay emergencias</h2>
          <p>Seleccione un usuario municipal para registrar la primera.</p>
        </div>
      )}
      <div className="emergency-grid">
        {query.data?.map((item) => (
          <article className="card" key={item.id}>
            <div className="card-top">
              <span className={'badge severity-' + item.gravedad.toLowerCase()}>
                {item.gravedad}
              </span>
              <time dateTime={item.created_at}>{formatDate(item.created_at)}</time>
            </div>
            <h2>
              <Link to={'/emergencias/' + item.id}>{item.zona}</Link>
            </h2>
            <p className="clamp">{item.descripcion}</p>
            <Link className="text-link" to={'/emergencias/' + item.id}>
              Ver emergencia →
            </Link>
          </article>
        ))}
      </div>
    </>
  );
}
