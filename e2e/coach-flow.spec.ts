import { expect, test } from '@playwright/test';
import { COACH_EMAIL, login, readProfessionalScore, selectOptionContaining, SCREENSHOT_DIR } from './helpers';

/**
 * コーチの主要導線。
 * 「顧客を選ぶ → 数値を入れる → 達成判定が出る → 保存」までが
 * 実環境でも成立するかを確認する。
 */
test.describe('コーチ画面', () => {
  test('ダッシュボードに現在地と次の条件が表示される', async ({ page }, testInfo) => {
    await login(page, COACH_EMAIL);

    await expect(page.getByText('Professional Score', { exact: true })).toBeVisible();
    const score = await readProfessionalScore(page);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(120);

    // 内訳・長期/短期・売上・昇格条件が揃っていること
    await expect(page.getByText('顧客成果', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('長期｜完全成果率')).toBeVisible();
    await expect(page.getByText('短期｜直近3ヶ月成果率')).toBeVisible();
    await expect(page.getByRole('heading', { name: /昇格までの条件|昇格/ })).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/coach-dashboard-${testInfo.project.name}.png`, fullPage: true });
  });

  test('成果を登録すると達成判定が即時表示され、保存できる', async ({ page }, testInfo) => {
    await login(page, COACH_EMAIL);
    await page.goto('/coach/records/new');

    // 何度実行してもデモデータの達成状況を変えないよう、対象は先頭の顧客に固定する
    const select = page.getByLabel('顧客');
    const options = await select.locator('option').allTextContents();
    const target = options.find((label) => label !== '選択してください');
    expect(target, '担当顧客が見つかりません').toBeTruthy();
    await select.selectOption({ label: target! });

    // 顧客の目標種別 (スコア / 飛距離 / 両方) によって入力欄が変わる
    const goalText = await page.getByText(/目標:/).innerText();
    const scoreTarget = goalText.match(/スコア\s+([\d.]+)/);
    const distanceTarget = goalText.match(/([\d.]+)yd/);
    expect(scoreTarget || distanceTarget, `目標が読み取れません: ${goalText}`).toBeTruthy();

    const fields: { label: string; miss: string; hit: string }[] = [];
    if (scoreTarget) {
      // スコアは小さいほど良い
      const value = Number(scoreTarget[1]);
      fields.push({ label: 'スコア', miss: String(value + 30), hit: String(value - 2) });
    }
    if (distanceTarget) {
      // 飛距離は大きいほど良い
      const value = Number(distanceTarget[1]);
      fields.push({ label: '飛距離 (yd)', miss: String(value - 30), hit: String(value + 5) });
    }

    // 目標に届かない値では未達と表示される
    for (const field of fields) await page.getByLabel(field.label).fill(field.miss);
    await expect(page.getByText('まだ目標に届いていません')).toBeVisible();

    // 目標を満たす値に変えると、保存前に達成判定が切り替わる
    for (const field of fields) await page.getByLabel(field.label).fill(field.hit);
    await expect(page.getByText('🎉 目標達成')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/coach-record-judge-${testInfo.project.name}.png`, fullPage: true });

    // 保存するのは未達の記録にとどめる。
    // 達成記録の保存経路は supabase/tests/rls_test.sql の整合性テストが担保している
    for (const field of fields) await page.getByLabel(field.label).fill(field.miss);
    await page.getByLabel('メモ').fill('[E2E検証] 自動テストによる登録');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText(/登録しました/);
  });

  test('売上を登録すると金額が自動入力されインセンティブが表示される', async ({ page }, testInfo) => {
    await login(page, COACH_EMAIL);
    await page.goto('/coach/sales/new');

    await selectOptionContaining(page, '商品', 'HIGH PERFORMANCE');
    await expect(page.getByLabel('金額')).toHaveValue('2000000');
    await expect(page.getByText(/成約ショットインセンティブ/)).toContainText('50,000');
    await page.screenshot({ path: `${SCREENSHOT_DIR}/coach-sale-form-${testInfo.project.name}.png`, fullPage: true });

    // 重複ガードに掛からないよう金額を少しずらす
    await page.getByLabel('金額').fill('1999999');
    await page.getByLabel('備考').fill('[E2E検証] 自動テストによる登録');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText(/成約を登録しました|売上を登録しました/);
  });
});
