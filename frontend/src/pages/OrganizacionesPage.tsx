import { useState, type FormEvent } from 'react';
import { api, type Organizacion } from '../api';
import { useAuth } from '../auth-context';
import { useApiData, useSubmission } from '../hooks';
import { ErrorMessage, Field, Loading, Success } from '../ui';

const tipos = ['MUNICIPIO', 'CENTRO_COORDINADOR', 'ONG', 'AUDITORIA'] as const;

export function OrganizacionesPage() {
  const { user } = useAuth();
  const query = useApiData<Organizacion[]>('/organizaciones');
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<(typeof tipos)[number]>('ONG');
  const state = useSubmission();
  const canCreate = user?.rol === 'COORDINADOR' || user?.rol === 'AUDITOR';
  if (!canCreate && user?.rol !== 'MUNICIPIO' && user?.rol !== 'ONG') {
    return <p className="notice">No tiene acceso a organizaciones.</p>;
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void state.submit(
      () => api<Organizacion>('/organizaciones', { body: { nombre, tipo } }),
      () => {
        setNombre('');
        query.refresh();
      },
      'Organización creada.',
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Directorio</p>
          <h1>Organizaciones</h1>
          <p className="muted">Municipios, centros, ONG y auditoría.</p>
        </div>
      </div>
      <ErrorMessage error={query.error} retry={query.refresh} />
      {query.loading && <Loading />}
      <ul className="list-plain">
        {query.data?.map((item) => (
          <li key={item.id} className="card">
            <strong>{item.nombre}</strong>
            <p className="muted">{item.tipo}</p>
          </li>
        ))}
      </ul>
      {canCreate && (
        <form className="card form-panel" onSubmit={save}>
          <h2>Nueva organización</h2>
          <ErrorMessage error={state.error} />
          <Success message={state.success} />
          <fieldset disabled={state.pending}>
            <Field label="Nombre" error={state.error} field="nombre">
              <input required maxLength={150} value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </Field>
            <Field label="Tipo" error={state.error} field="tipo">
              <select value={tipo} onChange={(e) => setTipo(e.target.value as (typeof tipos)[number])}>
                {tipos.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
            <button type="submit">{state.pending ? 'Creando…' : 'Crear'}</button>
          </fieldset>
        </form>
      )}
    </>
  );
}
