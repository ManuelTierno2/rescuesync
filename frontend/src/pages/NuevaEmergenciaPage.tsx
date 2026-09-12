import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, type Emergencia, type Gravedad } from '../api';
import { useSubmission } from '../hooks';
import { useDevUser } from '../user-context';
import { ErrorMessage, Field } from '../ui';

function EmergencyForm({ userId }: { userId: string }) {
  const [gravedad, setGravedad] = useState<Gravedad>('ALTA');
  const [zona, setZona] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const state = useSubmission();
  const navigate = useNavigate();
  function save(event: FormEvent) {
    event.preventDefault();
    void state.submit(
      () =>
        api<Emergencia>('/emergencias', {
          body: { creada_por_id: userId, gravedad, zona, descripcion },
        }),
      (result) =>
        navigate('/emergencias/' + result.data.id, {
          state: { warnings: result.warnings, created: true },
        }),
      '',
    );
  }
  return (
    <form className="card form-panel" onSubmit={save}>
      <ErrorMessage error={state.error} />
      <fieldset disabled={state.pending}>
        <Field label="Gravedad" error={state.error} field="gravedad">
          <select value={gravedad} onChange={(e) => setGravedad(e.target.value as Gravedad)}>
            {(['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] as const).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label="Zona" error={state.error} field="zona">
          <input
            required
            maxLength={200}
            value={zona}
            onChange={(e) => setZona(e.target.value)}
            placeholder="Por ejemplo, La Plata"
          />
        </Field>
        <Field label="Descripción" error={state.error} field="descripcion">
          <textarea
            required
            maxLength={5000}
            rows={5}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Describa la situación y las necesidades identificadas."
          />
        </Field>
        <button type="submit">
          {state.pending ? 'Registrando emergencia…' : 'Guardar emergencia'}
        </button>
      </fieldset>
    </form>
  );
}
export function NuevaEmergenciaPage() {
  const { user } = useDevUser();
  return (
    <>
      <Link className="back-link" to="/emergencias">
        ← Emergencias
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Municipio</p>
          <h1>Registrar emergencia</h1>
          <p className="muted">Complete los datos iniciales de la situación.</p>
        </div>
      </div>
      {user?.rol === 'MUNICIPIO' ? (
        <EmergencyForm key={user.id} userId={user.id} />
      ) : (
        <p className="notice">
          Seleccione un usuario con rol MUNICIPIO para registrar una emergencia.
        </p>
      )}
    </>
  );
}
