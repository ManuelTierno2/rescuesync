import { useState, type FormEvent } from 'react';
import { api, type Consorcio, type Usuario } from '../api';
import { useAuth } from '../auth-context';
import { useApiData, useSubmission } from '../hooks';
import { ErrorMessage, Field, Loading, Success } from '../ui';

export function ConsorciosPage() {
  const { user } = useAuth();
  const query = useApiData<Consorcio[]>('/consorcios');
  const users = useApiData<Usuario[]>('/usuarios');
  const [nombre, setNombre] = useState('');
  const [miembroIds, setMiembroIds] = useState<string[]>([]);
  const state = useSubmission();
  if (user?.rol !== 'ONG') {
    return <p className="notice">Solo usuarios ONG pueden gestionar consorcios.</p>;
  }
  const ongs = users.data?.filter((u) => u.rol === 'ONG' && u.id !== user.id) ?? [];
  function toggle(id: string) {
    setMiembroIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void state.submit(
      () => api<Consorcio>('/consorcios', { body: { nombre, miembroIds } }),
      () => {
        setNombre('');
        setMiembroIds([]);
        query.refresh();
      },
      'Consorcio creado.',
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ONG</p>
          <h1>Consorcios</h1>
          <p className="muted">Agrupaciones de ONG para ofertar en conjunto.</p>
        </div>
      </div>
      <ErrorMessage error={query.error} retry={query.refresh} />
      {query.loading && <Loading />}
      <ul className="list-plain">
        {query.data?.map((item) => (
          <li key={item.id} className="card">
            <strong>{item.nombre}</strong>
            <p className="muted">
              Miembros: {item.miembros.map((m) => m.ong_usuario.organizacion).join(', ')}
            </p>
          </li>
        ))}
      </ul>
      <form className="card form-panel" onSubmit={save}>
        <h2>Nuevo consorcio</h2>
        <ErrorMessage error={state.error} />
        <Success message={state.success} />
        <fieldset disabled={state.pending}>
          <Field label="Nombre" error={state.error} field="nombre">
            <input required maxLength={150} value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </Field>
          <fieldset>
            <legend>Miembros adicionales</legend>
            {ongs.map((ong) => (
              <label key={ong.id} className="check-row">
                <input type="checkbox" checked={miembroIds.includes(ong.id)} onChange={() => toggle(ong.id)} />
                {ong.organizacion} · {ong.nombre}
              </label>
            ))}
          </fieldset>
          <button type="submit">{state.pending ? 'Creando…' : 'Crear consorcio'}</button>
        </fieldset>
      </form>
    </>
  );
}
