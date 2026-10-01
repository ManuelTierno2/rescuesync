import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, type Consorcio, type InventarioItem, type Lote, type Oferta } from '../api';
import { useApiData, useSubmission } from '../hooks';
import { useDevUser } from '../auth-context';
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
  const inventarios = useApiData<InventarioItem[]>('/inventario');
  const consorcios = useApiData<Consorcio[]>('/consorcios');
  const [cantidad, setCantidad] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [inventarioId, setInventarioId] = useState('');
  const [consorcioId, setConsorcioId] = useState('');
  const state = useSubmission();
  function save(event: FormEvent) {
    event.preventDefault();
    void state.submit(
      () =>
        api<Oferta>('/lotes/' + lote.id + '/ofertas', {
          body: {
            ong_usuario_id: userId,
            cantidad_ofrecida: Number(cantidad),
            observaciones,
            inventario_item_id: inventarioId || null,
            consorcio_id: consorcioId || null,
          },
        }),
      () => {
        setCantidad('');
        setObservaciones('');
        setInventarioId('');
        setConsorcioId('');
        onSaved();
      },
      'Oferta registrada.',
    );
  }
  return (
    <form className="offer-form" onSubmit={save}>
      <h4>Ofrecer ayuda</h4>
      <p className="muted">
        Puede ofrecer una parte de la cantidad requerida. Opcional:{' '}
        <Link to="/inventario">vincular inventario</Link>.
      </p>
      <ErrorMessage error={state.error} />
      <Success message={state.success} />
      <fieldset disabled={state.pending}>
        <Field label={'Cantidad ofrecida (' + lote.unidad + ')'} error={state.error} field="cantidad_ofrecida">
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
        <Field label="Inventario (opcional)" error={state.error} field="inventario_item_id">
          <select value={inventarioId} onChange={(e) => setInventarioId(e.target.value)}>
            <option value="">Sin vincular</option>
            {inventarios.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.descripcion} ({formatNumber(item.cantidad)} {item.unidad})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Consorcio (opcional)" error={state.error} field="consorcio_id">
          <select value={consorcioId} onChange={(e) => setConsorcioId(e.target.value)}>
            <option value="">Individual</option>
            {consorcios.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nombre}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit">{state.pending ? 'Enviando oferta…' : 'Enviar oferta'}</button>
      </fieldset>
    </form>
  );
}

function EditOfertaForm({ oferta, lote, onSaved }: { oferta: Oferta; lote: Lote; onSaved: () => void }) {
  const [cantidad, setCantidad] = useState(String(oferta.cantidad_ofrecida));
  const [observaciones, setObservaciones] = useState(oferta.observaciones || '');
  const state = useSubmission();
  function save(event: FormEvent) {
    event.preventDefault();
    void state.submit(
      () =>
        api<Oferta>('/ofertas/' + oferta.id, {
          method: 'PATCH',
          body: { cantidad_ofrecida: Number(cantidad), observaciones },
        }),
      onSaved,
      'Oferta actualizada.',
    );
  }
  return (
    <form className="offer-form" onSubmit={save}>
      <h4>Editar oferta (v{oferta.version})</h4>
      <ErrorMessage error={state.error} />
      <Success message={state.success} />
      <fieldset disabled={state.pending}>
        <Field label={'Cantidad (' + lote.unidad + ')'} error={state.error} field="cantidad_ofrecida">
          <input type="number" required min={1} value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        </Field>
        <Field label="Observaciones" error={state.error} field="observaciones">
          <textarea rows={2} maxLength={5000} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
        </Field>
        <button type="submit">{state.pending ? 'Guardando…' : 'Guardar cambios'}</button>
      </fieldset>
    </form>
  );
}

export function LoteCard({ lote, canOffer = false, onOfferSaved }: { lote: Lote; canOffer?: boolean; onOfferSaved?: () => void }) {
  const { user } = useDevUser();
  const query = useApiData<Oferta[]>('/lotes/' + lote.id + '/ofertas');
  const [editingId, setEditingId] = useState<string>();
  const ownOffer = query.data?.find((o) => o.ong_usuario_id === user?.id && o.activa && !o.adjudicacion);
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
        {query.data?.length === 0 && <p className="muted">Todavía no hay ofertas para este lote.</p>}
        <ul>
          {query.data?.map((oferta) => (
            <li key={oferta.id}>
              <div className="offer-heading">
                <strong>{oferta.ong_usuario.organizacion}</strong>
                <span>
                  {formatNumber(oferta.cantidad_ofrecida)} {lote.unidad} · v{oferta.version ?? 1}
                </span>
              </div>
              <small className="muted">{oferta.ong_usuario.nombre}</small>
              {oferta.observaciones && <p className="preserve">{oferta.observaciones}</p>}
              {user?.rol === 'ONG' && user.id === oferta.ong_usuario_id && canOffer && oferta.activa && !oferta.adjudicacion && (
                <button type="button" className="secondary" onClick={() => setEditingId(oferta.id)}>
                  Editar
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      {user?.rol === 'ONG' && canOffer && editingId && ownOffer?.id === editingId && (
        <EditOfertaForm
          key={editingId + ':' + ownOffer.version}
          oferta={ownOffer}
          lote={lote}
          onSaved={() => {
            setEditingId(undefined);
            query.refresh();
            onOfferSaved?.();
          }}
        />
      )}
      {user?.rol === 'ONG' && canOffer && !ownOffer && (
        <OfertaForm key={user.id} lote={lote} userId={user.id} onSaved={() => { query.refresh(); onOfferSaved?.(); }} />
      )}
    </article>
  );
}
