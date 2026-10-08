import { test, expect } from '@playwright/test';

for (const [label, decisionCurso] of [
  ['Continuar con cobertura parcial', 'CONTINUAR_PARCIAL'],
  ['Reabrir convocatoria', 'REABRIR'],
  ['Reformular lotes', 'REFORMULAR'],
]) test(`coordinador confirma ${decisionCurso} desde la web`, async ({ page }) => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const date = '2026-10-01T12:00:00.000Z';
  const user = { id: 'coordinador', nombre: 'Coordinador', rol: 'COORDINADOR', organizacion: 'Centro Coordinador' };
  const emergency = { id, zona: 'Prueba de alternativas', gravedad: 'ALTA', descripcion: 'Emergencia', creada_por_id: 'municipio', bonita_instance_id: '1', created_at: date, updated_at: date };
  const round = { id: 'round', numero: 1, publicada_at: date, ofertas_vistas_at: null, seleccionada_at: null, monitoreo_finalizado_at: null };
  const offer = { id: 'offer', activa: true, cantidad_ofrecida: 4, ong_usuario: { organizacion: 'ONG A' } };
  let submitted: Record<string, unknown> | undefined;
  await page.addInitScript(() => localStorage.setItem('rescuesync.jwt', 'test-token'));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path.endsWith('/auth/me')) data = user;
    else if (path.endsWith('/acciones/decidir')) {
      submitted = route.request().postDataJSON(); data = { estado: 'CONFIRMADO' };
    } else if (path.endsWith('/workflow')) data = {
      enabled: true, compatible: true, state: 'OPEN', caseId: '1', localClosed: false, validationMode: 'DESARROLLO',
      round, readyTasks: [{ id: submitted ? '11' : '10', name: submitted ? 'Monitorear despliegue' : 'Evaluar curso alternativo' }],
      availableActions: submitted ? [] : ['decidir'], windows: [], actions: [],
    };
    else if (path.endsWith('/monitoreo')) data = { emergencia: emergency, rondas: [{ ...round, participaciones: [],
      lotes: [{ id: 'lot', descripcion: 'Bomberos', cantidad_requerida: 10, unidad: 'personas', ofertas: [offer] }] }] };
    else if (path.endsWith('/lotes')) data = [];
    else if (path.endsWith('/' + id)) data = emergency;
    else throw new Error('Unexpected request: ' + path);
    await route.fulfill({ json: { data } });
  });
  await page.goto('/emergencias/' + id);
  await expect(page.getByText('Bomberos: 4 / 10 personas ofrecidas · Faltan 6')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar adjudicación' })).toHaveCount(0);
  await page.getByRole('button', { name: label, exact: true }).click();
  expect(submitted).toBeUndefined();
  await page.getByRole('button', { name: 'Confirmar acción', exact: true }).click();
  await expect.poll(() => submitted?.decisionCurso).toBe(decisionCurso);
  expect(submitted?.accionId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
});
