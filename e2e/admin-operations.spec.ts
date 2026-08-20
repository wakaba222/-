import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, COACH_EMAIL, login, logout, selectOptionContaining } from './helpers';

/**
 * ADMIN の修正系操作 (仕様18章・26章)。
 * 売上の返金処理・成果記録の取消・CSV出力を、実データに対して確認する。
 *
 * 対象はテスト内で作成した売上・成果に限定し、デモデータには手を付けない。
 */
test.describe('ADMINの修正操作', () => {
  test.skip(({ isMobile }) => isMobile === true, 'ADMIN画面はPC利用が前提');

  test('コーチが登録した売上をADMINが返金処理できる', async ({ page }) => {
    // 対象の売上をコーチ側で作る
    await login(page, COACH_EMAIL);
    await page.goto('/coach/sales/new');
    await selectOptionContaining(page, '商品', 'RE:START');
    const amount = 300_000 + (Date.now() % 90_000);
    await page.getByLabel('金額').fill(String(amount));
    await page.getByLabel('備考').fill('[E2E検証] 返金処理の確認');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText(/登録しました/);
    await logout(page);

    await login(page, ADMIN_EMAIL);
    await page.goto('/admin/sales');
    const row = page.locator('tbody tr').filter({ hasText: '¥' + amount.toLocaleString('ja-JP') }).first();
    await expect(row).toBeVisible();

    await row.getByRole('textbox', { name: '返金額' }).fill('100000');
    await row.getByRole('button', { name: '返金' }).click();
    await expect(page.getByRole('status').first()).toContainText('返金を登録しました');

    await page.reload();
    const refunded = page.locator('tbody tr').filter({ hasText: '¥' + amount.toLocaleString('ja-JP') }).first();
    await expect(refunded).toContainText('返金');
  });

  test('コーチが登録した成果をADMINが取消できる', async ({ page }) => {
    await login(page, COACH_EMAIL);
    await page.goto('/coach/records/new');
    const select = page.getByLabel('顧客');
    const options = await select.locator('option').allTextContents();
    const first = options.find((label) => label !== '選択してください');
    await select.selectOption({ label: first! });

    const goalText = await page.getByText(/目標:/).innerText();
    const scoreTarget = goalText.match(/スコア\s+([\d.]+)/);
    const distanceTarget = goalText.match(/([\d.]+)yd/);
    if (scoreTarget) await page.getByLabel('スコア').fill(String(Number(scoreTarget[1]) + 40));
    if (distanceTarget) await page.getByLabel('飛距離 (yd)').fill(String(Number(distanceTarget[1]) - 40));
    await page.getByLabel('メモ').fill('[E2E検証] 取消対象');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText(/登録しました/);

    const customerLink = page.getByRole('link', { name: '担当顧客' });
    await customerLink.click();
    await logout(page);

    await login(page, ADMIN_EMAIL);
    await page.goto('/admin/customers');
    await page.getByRole('link', { name: first!.replace('（達成済み）', '') }).first().click();

    const record = page.locator('li').filter({ hasText: '[E2E検証] 取消対象' }).first();
    await expect(record).toBeVisible();
    await record.getByRole('button', { name: '取消' }).click();
    await expect(page.getByRole('status').first()).toContainText('取消しました');
  });

  test('CSV出力が権限つきで取得できる', async ({ page }) => {
    await login(page, ADMIN_EMAIL);

    for (const [type, header] of [
      ['coaches', 'Professional Score'],
      ['customers', '完全達成'],
      ['sales', '純額'],
    ] as const) {
      const response = await page.request.get(`/api/export/${type}`);
      expect(response.status(), `${type} のCSVが取得できる`).toBe(200);
      const body = await response.text();
      expect(body).toContain(header);
    }
  });
});
