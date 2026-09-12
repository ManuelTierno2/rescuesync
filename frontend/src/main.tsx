import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { UserProvider } from './user-context';
import { EmergenciasPage } from './pages/EmergenciasPage';
import { NuevaEmergenciaPage } from './pages/NuevaEmergenciaPage';
import { EmergenciaDetailPage } from './pages/EmergenciaDetailPage';
import './styles.css';

function App() {
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
          </nav>
        </div>
      </header>
      <div className="shell">
        <UserProvider>
          <main id="main-content">
            <Routes>
              <Route path="/" element={<Navigate to="/emergencias" replace />} />
              <Route path="/emergencias" element={<EmergenciasPage />} />
              <Route path="/emergencias/nueva" element={<NuevaEmergenciaPage />} />
              <Route path="/emergencias/:id" element={<EmergenciaDetailPage />} />
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
        </UserProvider>
        <footer>RescueSync · Etapa 2 · Entorno de pruebas manuales</footer>
      </div>
    </BrowserRouter>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
