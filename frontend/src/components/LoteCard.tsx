import { useState, type FormEvent } from 'react';
import { api, type Lote, type Oferta } from '../api';
import { useApiData, useSubmission } from '../hooks';
import { useDevUser } from '../user-context';
import { ErrorMessage, Field, Loading, Success, formatNumber } from '../ui';

function OfertaForm({
  lote,
  userId,
  onSaved,
}: {
  lote: Lote;
  userId: string;
  onSaved: () => void;
}) {
  const [cantidad, setCantidad] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const state = useSubmission();
  function save(event: FormEvent) {
    event.preventDefault();
    void state.submit(
      () =>
        api<Oferta>('/lotes/' + lote.id + '/ofertas', {
          body: { ong_usuario_id: userId, cantidad_ofrecida: Number(cantidad), observaciones },
        }),
      () => {
        setCantidad('');
        setObservaciones('');
        onSaved();
      },
      'Oferta registrada.',
    );
  }
  return (
    <form className="offer-form" onSubmit={save}>
      <h4>Ofrecer ayuda</h4>
      <p className="muted">Puede ofrecer una parte de la cantidad requerida.</p>
      <ErrorMessage error={state.error} />
      <Success message={state.success} />
      <fieldset disabled={state.pending}>
        <Field
          label={'Cantidad ofrecida (' + lote.unidad + ')'}
          error={state.error}
          field="cantidad_ofrecida"
        >
          <input
            type="number"
            required
            min={1}
            max={2147483647}
            step={1}
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
          />
        </Field>
        <Field label="Observaciones (opcional)" error={state.error} field="observaciones">
          <textarea
            rows={2}
            maxLength={5000}
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Disponibilidad, entrega u otros detalles."
          />
        </Field>
        <button type="submit">{state.pending ? 'Enviando oferta…' : 'Enviar oferta'}</button>
      </fieldset>
    </form>
  );
}
export function LoteCard({ lote, canOffer = false, onOfferSaved }: { lote: Lote; canOffer?: boolean; onOfferSaved?: () => void }) {
  const { user } = useDevUser();
  const query = useApiData<Oferta[]>('/lotes/' + lote.id + '/ofertas');
  return (
    <article className="card lote-card" aria-label={lote.descripcion}>
      <span className="badge">{lote.tipo === 'PERSONAL' ? 'Personal' : 'Recurso'}</span>
      <h3>{lote.descripcion}</h3>
      <p className="quantity">
        <strong>{formatNumber(lote.cantidad_requerida)}</strong> {lote.unidad}
        <span className="muted"> requeridas</span>
      </p>
      <div className="offers">
        <h4>Ofertas registradas</h4>
        {query.loading && <Loading />}
        <ErrorMessage error={query.error} retry={query.refresh} />
        {query.data?.length === 0 && (
          <p className="muted">Todavía no hay ofertas para este lote.</p>
        )}
        <ul>
          {query.data?.map((oferta) => (
            <li key={oferta.id}>
              <div className="offer-heading">
                <strong>{oferta.ong_usuario.organizacion}</strong>
                <span>
                  {formatNumber(oferta.cantidad_ofrecida)} {lote.unidad}
                </span>
              </div>
              <small className="muted">{oferta.ong_usuario.nombre}</small>
              {oferta.observaciones && <p className="preserve">{oferta.observaciones}</p>}
            </li>
          ))}
        </ul>
      </div>
      {user?.rol === 'ONG' && canOffer && (
        <OfertaForm key={user.id} lote={lote} userId={user.id} onSaved={() => { query.refresh(); onOfferSaved?.(); }} />
      )}
    </article>
  );
}
