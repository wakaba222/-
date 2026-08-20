import { expect, test } from '@playwright/test';
import { COACH_EMAIL, login } from './helpers';

/**
 * 目標種別ごとの成果登録 (仕様4章)。
 * SCORE / DISTANCE / BOTH のそれぞれで、達成判定が正しく切り替わることを確認する。
 *
 * 保存はいずれも未達の値で行い、デモデータの達成状況を変えない。
 */
const SCORE_FIELD = 'スコア';
const DISTANCE_FIELD = '飛距離 (yd)';

interface GoalCase {
  name: string;
  kind: 'SCORE' | 'DISTANCE' | 'BOTH';
  fields: string[];
}

const CASES: GoalCase[] = [
  { name: '青木 慎一', kind: 'SCORE', fields: [SCORE_FIELD] },
  { name: '上田 直樹', kind: 'DISTANCE', fields: [DISTANCE_FIELD] },
  { name: '加藤 学', kind: 'BOTH', fields: [SCORE_FIELD, DISTANCE_FIELD] },
];

test.describe('目標種別ごとの成果登録', () => {
  test.skip(({ isMobile }) => isMobile === true, 'デスクトップで代表実行する');

  for (const target of CASES) {
    test(`${target.kind} 目標の顧客で達成判定が動く`, async ({ page }) => {
      await login(page, COACH_EMAIL);
      await page.goto('/coach/records/new');

      const select = page.getByLabel('顧客');
      const options = await select.locator('option').allTextContents();
      const matched = options.find((label) => label.startsWith(target.name));
      if (!matched) {
        test.skip(true, `${target.name} が担当顧客にいないためスキップ`);
        return;
      }
      await select.selectOption({ label: matched });

      // 目標種別に応じた入力欄だけが出ていること
      for (const field of target.fields) await expect(page.getByLabel(field)).toBeVisible();
      if (!target.fields.includes(SCORE_FIELD)) await expect(page.getByLabel(SCORE_FIELD)).toHaveCount(0);
      if (!target.fields.includes(DISTANCE_FIELD)) await expect(page.getByLabel(DISTANCE_FIELD)).toHaveCount(0);

      const goalText = await page.getByText(/目標:/).innerText();
      const scoreTarget = goalText.match(/スコア\s+([\d.]+)/);
      const distanceTarget = goalText.match(/([\d.]+)yd/);

      const miss: [string, string][] = [];
      const hit: [string, string][] = [];
      if (scoreTarget) {
        miss.push([SCORE_FIELD, String(Number(scoreTarget[1]) + 30)]);
        hit.push([SCORE_FIELD, String(Number(scoreTarget[1]) - 2)]);
      }
      if (distanceTarget) {
        miss.push([DISTANCE_FIELD, String(Number(distanceTarget[1]) - 30)]);
        hit.push([DISTANCE_FIELD, String(Number(distanceTarget[1]) + 5)]);
      }

      for (const [label, value] of miss) await page.getByLabel(label).fill(value);
      await expect(page.getByText('まだ目標に届いていません')).toBeVisible();

      for (const [label, value] of hit) await page.getByLabel(label).fill(value);
      await expect(page.getByText('🎉 目標達成')).toBeVisible();

      // BOTH は片方だけ満たしても達成にならない
      if (target.kind === 'BOTH') {
        await page.getByLabel(DISTANCE_FIELD).fill(miss.find(([label]) => label === DISTANCE_FIELD)![1]);
        await expect(page.getByText('まだ目標に届いていません')).toBeVisible();
      }

      for (const [label, value] of miss) await page.getByLabel(label).fill(value);
      await page.getByLabel('メモ').fill('[E2E検証] 目標種別の確認');
      await page.getByRole('button', { name: '登録する' }).click();
      await expect(page.getByRole('status')).toContainText(/登録しました/);
    });
  }
});
