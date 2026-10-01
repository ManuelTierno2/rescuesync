import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth-context';
import { ErrorMessage, Field } from '../ui';
import { useSubmission } from '../hooks';

export function RegisterPage() {
  const { user, register, loading } = useAuth();
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizacion, setOrganizacion] = useState('');
  const state = useSubmission();
  const navigate = useNavigate();
  if (!loading && user) return <Navigate to="/emergencias" replace />;
  function save(event: FormEvent) {
    event.preventDefault();
    void state.submit(
      () => register({ nombre, email, password, organizacion }),
      () => navigate('/emergencias'),
      '',
    );
  }
  return (
    <section className="card form-panel auth-panel">
      <h1>Registro ONG</h1>
      <p className="muted">Cree una cuenta para ofrecer ayuda.</p>
      <ErrorMessage error={state.error} />
      <form onSubmit={save}>
        <fieldset disabled={state.pending}>
          <Field label="Nombre" error={state.error} field="nombre">
            <input required maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </Field>
          <Field label="Email" error={state.error} field="email">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Contraseña" error={state.error} field="password">
            <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Organización" error={state.error} field="organizacion">
            <input required maxLength={150} value={organizacion} onChange={(e) => setOrganizacion(e.target.value)} />
          </Field>
          <button type="submit">{state.pending ? 'Registrando…' : 'Crear cuenta'}</button>
        </fieldset>
      </form>
      <p className="muted">
        ¿Ya tiene cuenta? <Link to="/login">Ingresar</Link>
      </p>
    </section>
  );
}
