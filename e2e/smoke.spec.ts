import { test, expect } from '@playwright/test';

/**
 * Lightweight smoke: app boots. Full dual-map / ZIP flows stay manual
 * (File System Access + peer sync need human auth).
 * Covered in CI via the playwright-smoke job.
 */
test.describe('Udonarium smoke', () => {
  test('home page loads shell', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('app-root')).toBeVisible({ timeout: 30_000 });
  });

  test('shell mounts without fatal boot error overlay', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(String(err)));
    await page.goto('/');
    await expect(page.locator('app-root')).toBeVisible({ timeout: 30_000 });
    // Ignore transient network/SkyWay noise; fail only on Angular boot fatals.
    const fatal = pageErrors.filter(e =>
      /NullInjector|NG0\d{3}|Cannot find module|Unexpected token/i.test(e)
    );
    expect(fatal).toEqual([]);
  });
});
