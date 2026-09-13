import { useState, type FormEvent } from 'react';
import { api, type Lote } from '../api';
import { useSubmission } from '../hooks';
import { ErrorMessage, Field, Success } from '../ui';

export function LoteForm({ emergenciaId, onSaved }: { emergenciaId: string; onSaved: () => void }) {
  const [tipo, setTipo] = useState<Lote['tipo']>('RECURSO');
  const [descripcion, setDescripcion] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [unidad, setUnidad] = useState('');
  const state = useSubmission();
  function save(event: FormEvent) {
    event.preventDefault();
    void state.submit(
      () =>
        api<Lote>('/emergencias/' + emergenciaId + '/lotes', {
          body: { tipo, descripcion, cantidad_requerida: Number(cantidad), unidad },
        }),
      () => {
        setDescripcion('');
        setCantidad('');
        setUnidad('');
        onSaved();
      },
      'Lote guardado. Publique la convocatoria para recibir ofertas.',
    );
  }
  return (
    <section className="card form-panel">
      <p className="eyebrow">Centro Coordinador</p>
      <h2>Crear lote</h2>
      <p className="muted">Guarde los lotes y luego confirme Publicar convocatoria.</p>
      <form onSubmit={save}>
        <ErrorMessage error={state.error} />
        <Success message={state.success} />
        <fieldset disabled={state.pending}>
          <Field label="Tipo" error={state.error} field="tipo">
            <select value={tipo} onChange={(e) => setTipo(e.target.value as Lote['tipo'])}>
              <option value="RECURSO">Recurso</option>
              <option value="PERSONAL">Personal</option>
            </select>
          </Field>
          <Field label="Descripción del lote" error={state.error} field="descripcion">
            <input
              required
              maxLength={5000}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Por ejemplo, Raciones de alimento"
            />
          </Field>
          <div className="form-row">
            <Field label="Cantidad requerida" error={state.error} field="cantidad_requerida">
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
            <Field label="Unidad" error={state.error} field="unidad">
              <input
                required
                maxLength={50}
                value={unidad}
                onChange={(e) => setUnidad(e.target.value)}
                placeholder="raciones, personas…"
              />
            </Field>
          </div>
          <button type="submit">{state.pending ? 'Guardando lote…' : 'Crear lote'}</button>
        </fieldset>
      </form>
    </section>
  );
}
