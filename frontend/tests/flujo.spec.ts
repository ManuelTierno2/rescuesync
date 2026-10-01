import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const accounts = {
  municipio: { email: 'municipio@rescuesync.test', password: 'demo1234' },
  coordinador: { email: 'coordinador@rescuesync.test', password: 'demo1234' },
  ong: { email: 'ong.a@rescuesync.test', password: 'demo1234' },
  auditor: { email: 'auditor@rescuesync.test', password: 'demo1234' },
} as const;

async function loginAs(page: import('@playwright/test').Page, role: keyof typeof accounts) {
  await page.goto('/login');
  await page.evaluate(() => localStorage.removeItem('rescuesync.jwt'));
  await page.reload();
  await page.getByLabel('Email').fill(accounts[role].email);
  await page.getByLabel('Contraseña').fill(accounts[role].password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
}

test.afterAll(async () => {
  await promisify(execFile)(
    process.execPath,
    ['--import', './node_modules/tsx/dist/loader.mjs', 'tests/helpers/browser-cleanup.ts'],
    {
      cwd: fileURLToPath(new URL('../../backend/', import.meta.url)),
      env: process.env,
      windowsHide: true,
    },
  );
});

test('flujo completo por roles y persistencia después de refrescar', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await loginAs(page, 'municipio');
  await page.getByRole('link', { name: 'Registrar emergencia' }).click();
  const zona = process.env.BROWSER_TEST_RUN_ID + ' La Plata';
  await page.getByLabel('Zona', { exact: true }).fill(zona);
  await page
    .getByLabel('Descripción', { exact: true })
    .fill('Inundación. Se requieren alimentos y personal.');
  await page.getByRole('button', { name: 'Guardar emergencia' }).click();
  await expect(page.getByRole('heading', { name: zona, exact: true })).toBeVisible();
  await expect(page.getByText('Sin vínculo registrado')).toBeVisible();
  const detailUrl = page.url();

  await loginAs(page, 'coordinador');
  await page.goto(detailUrl);
  for (const [tipo, descripcion, cantidad, unidad] of [
    ['RECURSO', 'Raciones de alimento', '1000', 'raciones'],
    ['PERSONAL', 'Paramédicos', '5', 'personas'],
  ]) {
    await page.getByLabel('Tipo', { exact: true }).selectOption(tipo);
    await page.getByLabel('Descripción del lote').fill(descripcion);
    await page.getByLabel('Cantidad requerida').fill(cantidad);
    await page.getByLabel('Unidad', { exact: true }).fill(unidad);
    await page.getByRole('button', { name: 'Crear lote', exact: true }).click();
    await expect(page.getByRole('article', { name: descripcion })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Publicar convocatoria', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar acción', exact: true }).click();
  await expect(page.getByText('Ronda 1 · Publicada', { exact: true })).toBeVisible();

  await loginAs(page, 'ong');
  await page.goto(detailUrl);
  await expect(page.getByRole('heading', { name: 'Crear lote', exact: true })).toHaveCount(0);
  for (const [descripcion, cantidad] of [
    ['Raciones de alimento', '400'],
    ['Paramédicos', '2'],
  ]) {
    const card = page.getByRole('article', { name: descripcion });
    await card.getByLabel('Cantidad ofrecida', { exact: false }).fill(cantidad);
    await card.getByLabel('Observaciones', { exact: false }).fill('Entrega inmediata');
    await card.getByRole('button', { name: 'Enviar oferta' }).click();
    await expect(card.getByText('ONG A', { exact: true })).toBeVisible();
    await expect(card.getByText(new RegExp(`^${cantidad === '400' ? '400' : '2'} `))).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await expect(page.getByText(/400 raciones/)).toBeVisible();
  await expect(page.getByText(/2 personas/)).toBeVisible();

  await loginAs(page, 'municipio');
  await page.goto(detailUrl);
  await page.getByRole('button', { name: 'Continuar a selección', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar acción', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Acciones del operativo' }).getByRole('status')).toContainText('Acción confirmada.');
  await page.getByLabel('ONG A: 400 raciones', { exact: false }).check();
  await page.getByLabel('ONG A: 2 personas', { exact: false }).check();
  await page.getByRole('button', { name: 'Confirmar adjudicación', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar acción', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Acciones del operativo' }).getByRole('status')).toContainText('Acción confirmada.');
  await loginAs(page, 'ong');
  await page.goto(detailUrl);
  await expect(page.getByText('Tiene ofertas adjudicadas en esta ronda.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar lectura', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar acción', exact: true }).click();
  await expect(page.getByText('Lectura confirmada.', { exact: true })).toBeVisible();
  await loginAs(page, 'coordinador');
  await page.goto(detailUrl);
  await expect(page.getByRole('region', { name: 'Monitoreo', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar operativo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Finalizar monitoreo / continuar cierre', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar acción', exact: true }).click();
  await expect(page.getByText('Monitoreo finalizado.', { exact: true })).toBeVisible();
  await loginAs(page, 'ong');
  await page.goto(detailUrl);
  await page.getByRole('button', { name: 'Marcar actividad finalizada', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar acción', exact: true }).click();
  await expect(page.getByText('Actividad finalizada.', { exact: true })).toBeVisible();
  await loginAs(page, 'coordinador');
  await page.goto(detailUrl);
  await page.getByRole('button', { name: 'Cerrar operativo', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar acción', exact: true }).click();
  await expect(page.getByText('Ronda 1 · Cierre local confirmado', { exact: true })).toBeVisible();

  await loginAs(page, 'auditor');
  await page.goto(detailUrl);
  await expect(page.getByRole('button', { name: 'Enviar oferta' })).toHaveCount(0);
  await page.goto('/emergencias/nueva');
  await expect(
    page.getByText('Inicie sesión con un usuario MUNICIPIO', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar emergencia' })).toHaveCount(0);
  await page.goto(detailUrl);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText(/400 raciones/).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/flujo-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1365, height: 1000 });
  await page.screenshot({ path: 'test-results/flujo-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('muestra advertencias del alta sin proponer repetirla y muestra errores de validación', async ({
  page,
}) => {
  await loginAs(page, 'municipio');
  await page.goto('/emergencias/nueva');
  await page.getByLabel('Zona', { exact: true }).fill('   ');
  await page.getByLabel('Descripción', { exact: true }).fill('Prueba');
  await page.getByRole('button', { name: 'Guardar emergencia' }).click();
  await expect(page.getByRole('alert')).toContainText('zona');

  await page.route('**/api/emergencias', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const original = await route.fetch();
    const body = await original.json();
    await route.fulfill({
      response: original,
      json: {
        ...body,
        warnings: [
          {
            code: 'BONITA_CONNECTION_FAILED',
            message: 'La emergencia se guardó, pero no se pudo completar la conexión con Bonita.',
          },
        ],
      },
    });
  });
  await page
    .getByLabel('Zona', { exact: true })
    .fill(process.env.BROWSER_TEST_RUN_ID + ' Aviso Bonita');
  await page.getByRole('button', { name: 'Guardar emergencia' }).click();
  await expect(page.getByRole('alert')).toContainText('La emergencia se guardó');
  await expect(page.getByText('Emergencia registrada.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar emergencia' })).toHaveCount(0);
});
