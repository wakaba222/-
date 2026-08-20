import { expect, test } from '@playwright/test';
import { COACH_EMAIL, login, readProfessionalScore, selectOptionContaining } from './helpers';

/**
 * コーチの主要導線。
 * 「顧客を選ぶ → 数値を入れる → 達成判定が出る → 保存」までが
 * 実環境でも成立するかを確認する。
 */
test.describe('コーチ画面', () => {
  test('ダッシュボードに現在地と次の条件が表示される', async ({ page }, testInfo) => {
    await login(page, COACH_EMAIL);

    await expect(page.getByText('Professional Score')).toBeVisible();
    const score = await readProfessionalScore(page);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(120);

    // 内訳・長期/短期・売上・昇格条件が揃っていること
    await expect(page.getByText('顧客成果', { exact: true })).toBeVisible();
    await expect(page.getByText('長期｜完全成果率')).toBeVisible();
    await expect(page.getByText('短期｜直近3ヶ月成果率')).toBeVisible();
    await expect(page.getByRole('heading', { name: /昇格までの条件|昇格/ })).toBeVisible();

    await page.screenshot({ path: `${testInfo.outputDir}/../coach-dashboard-${testInfo.project.name}.png`, fullPage: true });
  });

  test('成果を登録すると達成判定が即時表示され、保存できる', async ({ page }, testInfo) => {
    await login(page, COACH_EMAIL);
    await page.goto('/coach/records/new');

    // 未達成の顧客を選ぶ (達成済みは選択肢に「（達成済み）」が付く)
    const select = page.getByLabel('顧客');
    const options = await select.locator('option').allTextContents();
    const target = options.find((label) => label !== '選択してください' && !label.includes('達成済み'));
    expect(target, '未達成の顧客が見つかりません').toBeTruthy();
    await select.selectOption({ label: target! });

    await expect(page.getByText(/目標:/)).toBeVisible();

    // 目標を確実に上回らない値を入れて「まだ届いていない」表示を確認する
    await page.getByLabel('スコア').fill('130');
    await expect(page.getByText('まだ目標に届いていません')).toBeVisible();

    // 目標を達成する値に変えると即座に達成表示へ変わる
    await page.getByLabel('スコア').fill('70');
    await expect(page.getByText('🎉 目標達成')).toBeVisible();
    await page.screenshot({ path: `${testInfo.outputDir}/../coach-record-judge-${testInfo.project.name}.png`, fullPage: true });

    await page.getByLabel('メモ').fill('[E2E検証] 自動テストによる登録');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText(/登録しました|目標達成/);
  });

  test('売上を登録すると金額が自動入力されインセンティブが表示される', async ({ page }, testInfo) => {
    await login(page, COACH_EMAIL);
    await page.goto('/coach/sales/new');

    await selectOptionContaining(page, '商品', 'HIGH PERFORMANCE');
    await expect(page.getByLabel('金額')).toHaveValue('2000000');
    await expect(page.getByText(/成約ショットインセンティブ/)).toContainText('50,000');
    await page.screenshot({ path: `${testInfo.outputDir}/../coach-sale-form-${testInfo.project.name}.png`, fullPage: true });

    // 重複ガードに掛からないよう金額を少しずらす
    await page.getByLabel('金額').fill('1999999');
    await page.getByLabel('備考').fill('[E2E検証] 自動テストによる登録');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('status')).toContainText(/成約を登録しました|売上を登録しました/);
  });
});
