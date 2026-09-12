import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Usuario } from './api';
import { useApiData } from './hooks';
import { ErrorMessage, Loading } from './ui';

const storageKey = 'rescuesync.dev-user-id';
const UserContext = createContext<{ user?: Usuario }>({});
export const useDevUser = () => useContext(UserContext);

export function UserProvider({ children }: { children: ReactNode }) {
  const users = useApiData<Usuario[]>('/usuarios');
  const [selectedId, setSelectedId] = useState(() => {
    try {
      return localStorage.getItem(storageKey) || '';
    } catch {
      return '';
    }
  });
  const user = users.data?.find((item) => item.id === selectedId);
  function select(id: string) {
    setSelectedId(id);
    try {
      id ? localStorage.setItem(storageKey, id) : localStorage.removeItem(storageKey);
    } catch {
      /* Selection still works for this visit. */
    }
  }
  return (
    <UserContext.Provider value={{ user }}>
      <section className="dev-banner" aria-label="Modo desarrollo">
        <div>
          <strong>Modo desarrollo</strong>
          <p>Selector de usuario de prueba · Sin autenticación real</p>
        </div>
        <div className="user-selector">
          <label htmlFor="dev-user">Usuario de desarrollo</label>
          <select
            id="dev-user"
            value={user?.id || ''}
            onChange={(event) => select(event.target.value)}
            disabled={users.loading}
          >
            <option value="">Seleccionar usuario</option>
            {users.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.rol} · {item.organizacion} · {item.nombre}
              </option>
            ))}
          </select>
          {users.loading && <Loading />}
          {!users.loading && users.data?.length === 0 && (
            <p>No hay usuarios de prueba disponibles.</p>
          )}
          {selectedId && users.data && !user && (
            <p>El usuario guardado ya no está disponible. Seleccione otro.</p>
          )}
          <ErrorMessage error={users.error} retry={users.refresh} />
        </div>
      </section>
      {children}
    </UserContext.Provider>
  );
}
