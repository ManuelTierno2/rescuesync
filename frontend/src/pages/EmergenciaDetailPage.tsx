import { Link, useLocation, useParams } from 'react-router';
import type { Emergencia, Lote, Warning } from '../api';
import { useApiData } from '../hooks';
import { useDevUser } from '../user-context';
import { ErrorMessage, Loading, Success, formatDate } from '../ui';
import { LoteForm } from '../components/LoteForm';
import { LoteCard } from '../components/LoteCard';
import { WorkflowPanel } from '../components/WorkflowPanel';
import { useWorkflow } from '../workflow';

function Detail({ id }: { id: string }) {
  const { user } = useDevUser();
  const emergency = useApiData<Emergencia>('/emergencias/' + id);
  const lotes = useApiData<Lote[]>('/emergencias/' + id + '/lotes');
  const workflow = useWorkflow(id);
  const canCreate = user?.rol === 'COORDINADOR' && workflow.data && !workflow.data.round?.publicada_at && !workflow.data.localClosed && !workflow.error;
  const canOffer = !!workflow.data?.windows.some(w => !w.cerrada_at && new Date(w.vence_at).getTime() > Date.now())
    && !workflow.data?.round?.seleccionada_at && !workflow.data?.localClosed && !workflow.error;
  const refreshAll = () => { emergency.refresh(); lotes.refresh(); workflow.refresh(); };
  const location = useLocation();
  const feedback = location.state as { warnings?: Warning[]; created?: boolean } | null;
  const data = emergency.data;
  return (
    <>
      <Link className="back-link" to="/emergencias">
        ← Emergencias
      </Link>
      <ErrorMessage error={emergency.error} retry={emergency.refresh} />
      {emergency.loading && <Loading />}
      {data && (
        <>
          <div className="page-heading">
            <div>
              <p className="eyebrow">Detalle de emergencia</p>
              <h1>{data.zona}</h1>
              <span className={'badge severity-' + data.gravedad.toLowerCase()}>
                Gravedad {data.gravedad}
              </span>
            </div>
          </div>
          {feedback?.created && <Success message="Emergencia registrada." />}
          {feedback?.warnings?.map((warning, index) => (
            <p className="notice warning" role="alert" key={index}>
              {warning.message}
            </p>
          ))}
          <section className="card emergency-details">
            <p className="preserve">{data.descripcion}</p>
            <dl>
              <div>
                <dt>Emergencia</dt>
                <dd className="identifier">{data.id}</dd>
              </div>
              <div>
                <dt>Registrada</dt>
                <dd>{formatDate(data.created_at)}</dd>
              </div>
              <div>
                <dt>Instancia Bonita</dt>
                <dd className="identifier">
                  {data.bonita_instance_id || 'Sin vínculo registrado'}
                </dd>
              </div>
            </dl>
          </section>
          <WorkflowPanel id={id} query={workflow} onChanged={refreshAll} />
          <div className="section-heading">
            <h2>Lotes de necesidades</h2>
            <p className="muted">Recursos y personas solicitados para esta emergencia.</p>
          </div>
          <div className={canCreate ? 'detail-layout' : ''}>
            <div>
              <ErrorMessage error={lotes.error} retry={lotes.refresh} />
              {lotes.loading && <Loading />}
              {lotes.data?.length === 0 && (
                <div className="empty">
                  <h3>Aún no hay lotes</h3>
                  <p>El Centro Coordinador puede registrar las necesidades de esta emergencia.</p>
                </div>
              )}
              <div className="lotes-list">
                {lotes.data?.filter(l => l.ronda_id === workflow.data?.round?.id).map((lote) => (
                  <LoteCard key={lote.id} lote={lote} canOffer={canOffer} onOfferSaved={workflow.refresh} />
                ))}
              </div>
            </div>
            {canCreate && (
              <LoteForm key={user.id} emergenciaId={id} onSaved={() => { lotes.refresh(); workflow.refresh(); }} />
            )}
          </div>
        </>
      )}
    </>
  );
}
export function EmergenciaDetailPage() {
  const { id = '' } = useParams();
  return <Detail key={id} id={id} />;
}
