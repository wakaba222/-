import { expect, test } from '@playwright/test';
import { login, readProfessionalScore, selectOptionContaining, skipIfNoCoachAccount, COACH_EMAIL } from './helpers';

/**
 * 仕様45章の完成条件のうち、コーチ操作が Professional Score に反映されるところまでを確認する。
 *
 * 売上点が上限(60点)に達しているコーチでは差分が出ないため、
 * 当月売上がまだ基準に届いていない佐藤コーチで検証する。
 */
/**
 * 売上点が上限に達していないコーチで検証する。
 * 環境ごとに在籍コーチが違うため E2E_MID_RANGE_COACH_EMAIL で差し替えられる。
 */
const MID_RANGE_COACH = process.env.E2E_MID_RANGE_COACH_EMAIL ?? COACH_EMAIL;
test.describe('スコアの更新', () => {
  test.skip(({ isMobile }) => isMobile === true, 'デスクトップのみで実行');

  test('売上登録が Professional Score に反映される', async ({ page }) => {
    skipIfNoCoachAccount();
    await login(page, MID_RANGE_COACH);
    const before = await readProfessionalScore(page);

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
    expect(after).toBeGreaterThan(before);
  });
});
