import { Link } from 'react-router';
import type { Emergencia } from '../api';
import { useAuth } from '../auth-context';
import { useApiData } from '../hooks';
import { ErrorMessage, Loading, formatDate } from '../ui';

export function AuditorDashboard() {
  const { user } = useAuth();
  const query = useApiData<Emergencia[]>('/emergencias');
  if (user?.rol !== 'AUDITOR') {
    return <p className="notice">Solo el rol AUDITOR puede ver este tablero.</p>;
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Auditoría</p>
          <h1>Monitoreo</h1>
          <p className="muted">Vista de solo lectura de emergencias activas.</p>
        </div>
      </div>
      <ErrorMessage error={query.error} retry={query.refresh} />
      {query.loading && <Loading />}
      <div className="emergency-grid">
        {query.data?.map((item) => (
          <article className="card" key={item.id}>
            <div className="card-top">
              <span className={'badge severity-' + item.gravedad.toLowerCase()}>{item.gravedad}</span>
              <time dateTime={item.created_at}>{formatDate(item.created_at)}</time>
            </div>
            <h2>
              <Link to={'/emergencias/' + item.id}>{item.zona}</Link>
            </h2>
            <p className="clamp">{item.descripcion}</p>
          </article>
        ))}
      </div>
    </>
  );
}
