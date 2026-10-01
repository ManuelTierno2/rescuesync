import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken, type Usuario } from './api';
import { ErrorMessage, Loading } from './ui';

type AuthState = {
  user?: Usuario;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { nombre: string; email: string; password: string; organizacion: string }) => Promise<void>;
  logout: () => void;
  refresh: () => void;
};

const AuthContext = createContext<AuthState>({
  loading: true,
  login: async () => undefined,
  register: async () => undefined,
  logout: () => undefined,
  refresh: () => undefined,
});

export const useAuth = () => useContext(AuthContext);
/** Alias de compatibilidad con componentes que aún usan useDevUser. */
export const useDevUser = () => {
  const { user } = useAuth();
  return { user };
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Usuario>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setUser(undefined);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void api<Usuario>('/auth/me', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setUser(result.data);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setToken('');
          setUser(undefined);
          setError(reason);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  async function login(email: string, password: string) {
    const result = await api<{ token: string; user: Usuario }>('/auth/login', { body: { email, password } });
    setToken(result.data.token);
    setUser(result.data.user);
    setError(undefined);
  }

  async function register(input: { nombre: string; email: string; password: string; organizacion: string }) {
    const result = await api<{ token: string; user: Usuario }>('/auth/register', { body: input });
    setToken(result.data.token);
    setUser(result.data.user);
    setError(undefined);
  }

  function logout() {
    setToken('');
    setUser(undefined);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh: () => setRevision((v) => v + 1) }}>
      {loading ? <Loading /> : null}
      {!loading && error && !user ? (
        <ErrorMessage error={error} retry={() => setRevision((v) => v + 1)} />
      ) : null}
      {children}
    </AuthContext.Provider>
  );
}
