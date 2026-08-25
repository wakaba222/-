import { expect, test } from '@playwright/test';
import { openAsCoach, skipIfNoCoachSession } from './helpers';

/**
 * COACH は設定変更の権限を一切持たない、をブラウザ側から確認する。
 *
 * 画面に出さないことは利便性のためであり、権限の担保ではない
 * (実際の拒否は RLS・拒否トリガ・Server Action ガードが行い、
 *  `npm run verify:authz` で HTTP レベルの拒否を検証している)。
 * ここでは「コーチが設定に触れる入口を目にしない」ことだけを見る。
 */
const ADMIN_ONLY_PATHS = [
  '/admin',
  '/admin/rules',
  '/admin/products',
  '/admin/coaches',
  '/admin/customers',
  '/admin/promotions',
  '/admin/approvals',
  '/admin/close',
  '/admin/audit',
  '/admin/sales',
];

const COACH_PATHS = ['/coach', '/coach/customers', '/coach/records/new', '/coach/sales/new', '/coach/promotion', '/coach/compensation'];

test.describe('COACHは設定を変更できない', () => {
  test.beforeEach(() => skipIfNoCoachSession());

  test('設定系のADMIN画面はCOACHには開かない', async ({ context, page, baseURL }) => {
    await openAsCoach(context, page, baseURL!);

    for (const path of ADMIN_ONLY_PATHS) {
      await page.goto(path);
      await expect(page, `${path} は COACH には開かないこと`).toHaveURL(/\/(coach|login)/);
    }
  });

  test('COACHの画面に設定への入口が出ていない', async ({ context, page, baseURL }) => {
    await openAsCoach(context, page, baseURL!);

    for (const path of COACH_PATHS) {
      await page.goto(path);

      // 管理画面へのリンクが1つも無いこと
      const adminLinks = page.locator('a[href^="/admin"]');
      await expect(adminLinks, `${path} に管理画面へのリンクがある`).toHaveCount(0);

      // 設定変更を思わせる操作が並んでいないこと
      const settingsWords = /評価ルール|商品マスタ|インセンティブ設定|ランク変更|レッスン単価|行動ルールを設定|昇格を承認|月次締め|監査ログ/;
      await expect(page.getByText(settingsWords), `${path} に設定変更のUIがある`).toHaveCount(0);
    }
  });

  test('CSV出力はCOACHには許可されない', async ({ context, page, baseURL }) => {
    await openAsCoach(context, page, baseURL!);

    for (const type of ['coaches', 'customers', 'sales']) {
      const response = await page.request.get(`${baseURL}/api/export/${type}`);
      expect(response.status(), `/api/export/${type} が COACH に開放されている`).toBe(403);
    }
  });
});
