import { ApiError } from './api';
import { cloneElement, useId, type ReactElement, type ReactNode, type HTMLAttributes } from 'react';

export function ErrorMessage({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  return (
    <div className="notice error" role="alert">
      <p>{error instanceof Error ? error.message : 'Ocurrió un error inesperado.'}</p>
      {error instanceof ApiError && error.details.length > 0 && (
        <ul>
          {error.details.map((detail, index) => (
            <li key={index}>
              <strong>{detail.field}:</strong> {detail.message}
            </li>
          ))}
        </ul>
      )}
      {retry && (
        <button className="secondary" onClick={retry}>
          Volver a intentar
        </button>
      )}
    </div>
  );
}
export function Field({
  label,
  error,
  field,
  children,
}: {
  label: ReactNode;
  error?: unknown;
  field: string;
  children: ReactElement<HTMLAttributes<HTMLElement>>;
}) {
  const id = useId();
  const details =
    error instanceof ApiError ? error.details.filter((item) => item.field === field) : [];
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, {
        id,
        'aria-invalid': details.length > 0,
        'aria-describedby': details.length ? id + '-error' : undefined,
      })}
      {details.length > 0 && (
        <span className="field-error" id={id + '-error'}>
          {details.map((d) => d.message).join(' ')}
        </span>
      )}
    </div>
  );
}
export function Loading() {
  return (
    <p className="muted" role="status">
      Cargando…
    </p>
  );
}
export function Success({ message }: { message: string }) {
  return message ? (
    <p className="notice success" role="status">
      {message}
    </p>
  ) : null;
}
export const formatDate = (value: string) =>
  new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
export const formatNumber = (value: number) => new Intl.NumberFormat('es-AR').format(value);
