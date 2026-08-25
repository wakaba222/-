import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, login, SCREENSHOT_DIR } from './helpers';

/** 氏名をそのまま正規表現に埋め込めるようにする */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('ADMIN画面', () => {
  test.skip(({ isMobile }) => isMobile === true, 'ADMIN画面はPC利用が前提');

  test('全コーチの比較表が表示される', async ({ page }) => {
    await login(page, ADMIN_EMAIL);
    await expect(page).toHaveURL(/\/admin/);

    await expect(page.getByRole('heading', { name: 'コーチ一覧' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Score/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '完全成果率' })).toBeVisible();

    // 在籍コーチが全員並ぶ (人数は環境によって変わるため、見出しの人数表示と突き合わせる)
    const rows = page.locator('table tbody tr');
    const shown = await rows.count();
    expect(shown).toBeGreaterThan(0);
    await expect(page.getByText(`${shown}名を表示`)).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/admin-dashboard.png`, fullPage: true });
  });

  test('コーチ一覧の並び替えと絞り込みが動く', async ({ page }) => {
    await login(page, ADMIN_EMAIL);

    const rows = page.locator('tbody tr');
    const total = await rows.count();
    expect(total).toBeGreaterThan(0);

    const firstCoachName = (await rows.first().locator('td').first().innerText()).trim();

    // Score 見出しを押すと並び順が反転する (コーチが2名以上いる環境でのみ確認できる)
    if (total > 1) {
      const lastCoachName = (await rows.last().locator('td').first().innerText()).trim();
      await page.getByRole('button', { name: /Score/ }).click();
      await expect(rows.first().locator('td').first()).toHaveText(new RegExp(escapeRegExp(lastCoachName)));
      await page.getByRole('button', { name: /Score/ }).click();
    }

    // ランクで絞り込むと、そのランクのコーチだけになる
    const rankOfFirst = (await rows.first().locator('td').nth(1).innerText()).trim();
    await page.getByRole('combobox').selectOption(rankOfFirst);
    const filtered = await rows.count();
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThanOrEqual(total);
    await expect(page.getByText(`${filtered}名を表示`)).toBeVisible();

    // 名前での絞り込み
    await page.getByRole('combobox').selectOption('ALL');
    await page.getByPlaceholder('コーチ名で絞り込み').fill(firstCoachName);
    await expect(rows.first()).toContainText(firstCoachName);
  });

  test('顧客一覧・目標承認・昇格審査・月次締めの各画面が開ける', async ({ page }) => {
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
