import { expect, test } from '@playwright/test';

test('dashboard loads and responds to panel interactions', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('대한민국 지도 화면을 준비하고 있습니다.')).toBeVisible();
  await expect(page.locator('[data-naver-map-root]')).toBeVisible();

  const mapLayerToggle = page.getByRole('button', { name: /^지도/ });
  const hasMapControls = (await mapLayerToggle.count()) > 0;

  if (hasMapControls) {
    await mapLayerToggle.click();
    await expect(mapLayerToggle).toHaveAttribute('aria-expanded', 'true');

    const firstLayerButton = page.locator('button[aria-pressed]').first();
    await expect(firstLayerButton).toBeVisible();
    await firstLayerButton.click();
    await page.keyboard.press('Escape');
    await expect(mapLayerToggle).toHaveAttribute('aria-expanded', 'false');
  }

  const root = page.locator('html');
  const lightTheme = page.getByText('라이트', { exact: true });
  const darkTheme = page.getByText('다크', { exact: true });
  await expect(lightTheme).toBeVisible();
  await expect(darkTheme).toBeVisible();

  await darkTheme.click();
  await expect(root).toHaveClass(/(^|\s)dark(\s|$)/);

  await lightTheme.click();
  await expect(root).not.toHaveClass(/(^|\s)dark(\s|$)/);
});
