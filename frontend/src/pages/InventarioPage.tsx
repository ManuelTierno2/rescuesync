import { useState, type FormEvent } from 'react';
import { api, CODIGOS_SN, type CodigoRecursoSn, type InventarioItem } from '../api';
import { useAuth } from '../auth-context';
import { useApiData, useSubmission } from '../hooks';
import { ErrorMessage, Field, Loading, Success, formatNumber } from '../ui';

export function InventarioPage() {
  const { user } = useAuth();
  const query = useApiData<InventarioItem[]>('/inventario');
  const [tipo, setTipo] = useState<'PERSONAL' | 'RECURSO'>('RECURSO');
  const [descripcion, setDescripcion] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [unidad, setUnidad] = useState('');
  const [codigoSn, setCodigoSn] = useState<CodigoRecursoSn | ''>('');
  const state = useSubmission();
  if (user?.rol !== 'ONG') {
    return <p className="notice">Solo usuarios ONG pueden gestionar inventario.</p>;
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void state.submit(
      () => api<InventarioItem>('/inventario', {
        body: { tipo, descripcion, cantidad: Number(cantidad), unidad, codigoSn: codigoSn || null },
      }),
      () => {
        setDescripcion('');
        setCantidad('');
        setUnidad('');
        setCodigoSn('');
        query.refresh();
      },
      'Ítem agregado.',
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ONG</p>
          <h1>Inventario</h1>
          <p className="muted">Stock disponible para ofertar en convocatorias. El código del Sistema Nacional permite validar tus ofertas.</p>
        </div>
      </div>
      <ErrorMessage error={query.error} retry={query.refresh} />
      {query.loading && <Loading />}
      <ul className="list-plain">
        {query.data?.map((item) => (
          <li key={item.id} className="card">
            <strong>{item.descripcion}</strong>
            <p>
              {formatNumber(item.cantidad)} {item.unidad} · {item.tipo}
              {item.codigo_sn ? ` · SN: ${item.codigo_sn}` : ' · Sin código SN'}
            </p>
          </li>
        ))}
      </ul>
      <form className="card form-panel" onSubmit={save}>
        <h2>Agregar ítem</h2>
        <ErrorMessage error={state.error} />
        <Success message={state.success} />
        <fieldset disabled={state.pending}>
          <Field label="Tipo" error={state.error} field="tipo">
            <select value={tipo} onChange={(e) => setTipo(e.target.value as 'PERSONAL' | 'RECURSO')}>
              <option value="RECURSO">RECURSO</option>
              <option value="PERSONAL">PERSONAL</option>
            </select>
          </Field>
          <Field label="Descripción" error={state.error} field="descripcion">
            <input required value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          </Field>
          <Field label="Cantidad" error={state.error} field="cantidad">
            <input type="number" required min={1} value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
          </Field>
          <Field label="Unidad" error={state.error} field="unidad">
            <input required value={unidad} onChange={(e) => setUnidad(e.target.value)} />
          </Field>
          <Field label="Código Sistema Nacional" error={state.error} field="codigoSn">
            <select value={codigoSn} onChange={(e) => setCodigoSn(e.target.value as CodigoRecursoSn | '')}>
              <option value="">Sin mapeo</option>
              {CODIGOS_SN.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <button type="submit">{state.pending ? 'Guardando…' : 'Agregar'}</button>
        </fieldset>
      </form>
    </>
  );
}
