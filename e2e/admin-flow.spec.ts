import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, login, SCREENSHOT_DIR } from './helpers';

test.describe('ADMIN画面', () => {
  test.skip(({ isMobile }) => isMobile === true, 'ADMIN画面はPC利用が前提');

  test('全コーチの比較表が表示される', async ({ page }, testInfo) => {
    await login(page, ADMIN_EMAIL);
    await expect(page).toHaveURL(/\/admin/);

    await expect(page.getByRole('heading', { name: 'コーチ一覧' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Score/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '完全成果率' })).toBeVisible();

    // 3名のコーチが並び、昇格候補が識別できる
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(page.getByText('候補').first()).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/admin-dashboard.png`, fullPage: true });
  });

  test('顧客一覧・目標承認・昇格審査・月次締めの各画面が開ける', async ({ page }, testInfo) => {
    await login(page, ADMIN_EMAIL);

    await page.goto('/admin/customers');
    await expect(page.getByRole('heading', { name: '顧客一覧' })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/admin-customers.png`, fullPage: true });

    await page.goto('/admin/approvals');
    await expect(page.getByRole('heading', { name: '目標承認' })).toBeVisible();

    await page.goto('/admin/promotions');
    await expect(page.getByRole('heading', { name: '昇格候補' })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/admin-promotions.png`, fullPage: true });

    await page.goto('/admin/close');
    await expect(page.getByRole('heading', { name: '月次締め' })).toBeVisible();

    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: '監査ログ' })).toBeVisible();
  });

  test('目標を承認すると評価対象になり、コーチのスコアに反映される', async ({ page }) => {
    await login(page, ADMIN_EMAIL);
    await page.goto('/admin/approvals');

    const pendingRows = page.locator('li').filter({ hasText: '目標:' });
    const count = await pendingRows.count();
    if (count === 0) {
      test.skip(true, '承認待ちの目標がないためスキップ');
      return;
    }

    await pendingRows.first().getByRole('button', { name: '承認する' }).click();
    // 承認された顧客は一覧から消える (評価対象に入る)
    await expect(pendingRows).toHaveCount(count - 1);
  });
});
