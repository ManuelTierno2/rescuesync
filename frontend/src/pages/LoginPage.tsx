import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth-context';
import { ErrorMessage, Field } from '../ui';
import { useSubmission } from '../hooks';

export function LoginPage() {
  const { user, login, loading } = useAuth();
  const [email, setEmail] = useState('municipio@rescuesync.test');
  const [password, setPassword] = useState('demo1234');
  const state = useSubmission();
  const navigate = useNavigate();
  if (!loading && user) return <Navigate to="/emergencias" replace />;
  function save(event: FormEvent) {
    event.preventDefault();
    void state.submit(() => login(email, password), () => navigate('/emergencias'), '');
  }
  return (
    <section className="card form-panel auth-panel">
      <h1>Ingresar</h1>
      <p className="muted">Use su cuenta RescueSync.</p>
      <ErrorMessage error={state.error} />
      <form onSubmit={save}>
        <fieldset disabled={state.pending}>
          <Field label="Email" error={state.error} field="email">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Contraseña" error={state.error} field="password">
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button type="submit">{state.pending ? 'Ingresando…' : 'Ingresar'}</button>
        </fieldset>
      </form>
      <p className="muted">
        ¿ONG nueva? <Link to="/register">Registrarse</Link>
      </p>
    </section>
  );
}
