import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './auth-context';
import { EmergenciasPage } from './pages/EmergenciasPage';
import { NuevaEmergenciaPage } from './pages/NuevaEmergenciaPage';
import { EmergenciaDetailPage } from './pages/EmergenciaDetailPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { InventarioPage } from './pages/InventarioPage';
import { ConsorciosPage } from './pages/ConsorciosPage';
import { OrganizacionesPage } from './pages/OrganizacionesPage';
import { AuditorDashboard } from './pages/AuditorDashboard';
import './styles.css';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppShell() {
  const { user, logout } = useAuth();
  return (
    <BrowserRouter>
      <header className="site-header">
        <div className="header-inner">
          <Link className="brand" to="/emergencias">
            <span className="brand-mark" aria-hidden="true">
              +
            </span>
            RescueSync
          </Link>
          <span className="header-caption">Coordinación de ayuda</span>
          <nav aria-label="Principal">
            <Link to="/emergencias">Emergencias</Link>
            {user?.rol === 'ONG' && <Link to="/inventario">Inventario</Link>}
            {user?.rol === 'ONG' && <Link to="/consorcios">Consorcios</Link>}
            {(user?.rol === 'COORDINADOR' || user?.rol === 'AUDITOR') && (
              <Link to="/organizaciones">Organizaciones</Link>
            )}
            {user?.rol === 'AUDITOR' && <Link to="/auditoria">Auditoría</Link>}
          </nav>
          <div className="header-user">
            {user ? (
              <>
                <span className="muted-on-dark">
                  {user.rol} · {user.organizacion}
                </span>
                <button type="button" className="secondary header-logout" onClick={logout}>
                  Cerrar sesión
                </button>
              </>
            ) : (
              <Link to="/login">Ingresar</Link>
            )}
          </div>
        </div>
      </header>
      <div className="shell">
        <main id="main-content">
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/" element={<Navigate to="/emergencias" replace />} />
            <Route path="/emergencias" element={<RequireAuth><EmergenciasPage /></RequireAuth>} />
            <Route path="/emergencias/nueva" element={<RequireAuth><NuevaEmergenciaPage /></RequireAuth>} />
            <Route path="/emergencias/:id" element={<RequireAuth><EmergenciaDetailPage /></RequireAuth>} />
            <Route path="/inventario" element={<RequireAuth><InventarioPage /></RequireAuth>} />
            <Route path="/consorcios" element={<RequireAuth><ConsorciosPage /></RequireAuth>} />
            <Route path="/organizaciones" element={<RequireAuth><OrganizacionesPage /></RequireAuth>} />
            <Route path="/auditoria" element={<RequireAuth><AuditorDashboard /></RequireAuth>} />
            <Route
              path="*"
              element={
                <div className="empty">
                  <h1>Página no encontrada</h1>
                  <Link to="/emergencias">Volver a emergencias</Link>
                </div>
              }
            />
          </Routes>
        </main>
        <footer>RescueSync · Entrega 2</footer>
      </div>
    </BrowserRouter>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
