import { expect, test } from '@playwright/test';
import { COACH_EMAIL, login, readProfessionalScore, selectOptionContaining } from './helpers';

/**
 * 仕様45章の完成条件のうち、コーチ操作が Professional Score に反映されるところまでを確認する。
 * 売上を登録すると当月の売上点が上がり、Score が増える (上限に達している場合を除く)。
 */
test.describe('スコアの更新', () => {
  test.skip(({ isMobile }) => isMobile === true, 'デスクトップのみで実行');

  test('売上登録が Professional Score に反映される', async ({ page }) => {
    await login(page, COACH_EMAIL);
    const before = await readProfessionalScore(page);
    const salesBefore = await page.getByText('売上', { exact: true }).locator('..').innerText();

    await page.goto('/coach/sales/new');
    await selectOptionContaining(page, '商品', 'RE:START');
    // 重複ガードを避けるため一意な金額にする
    const uniqueAmount = 400_000 + (Date.now() % 90_000);
    await page.getByLabel('金額').fill(String(uniqueAmount));
    await page.getByLabel('備考').fill('[E2E検証] スコア反映の確認');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText(/登録しました/);

    await page.goto('/coach');
    const after = await readProfessionalScore(page);

    // 売上点が上限 (60点) に達している場合はスコアが動かないため、その場合も許容する
    const salesCapped = salesBefore.includes('60.0 / 60');
    if (salesCapped) {
      expect(after).toBeGreaterThanOrEqual(before);
    } else {
      expect(after).toBeGreaterThan(before);
    }
  });
});
