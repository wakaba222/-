import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, demoPassword, login, logout } from './helpers';

/**
 * セッションと画面到達性の確認。
 *
 * middleware の対象パスやセッション検証方法を変えたときに、
 * 「未ログインで保護画面が開けてしまう」「ログイン後に画面へ入れない」といった
 * 退行が起きていないことを、データに依存せず確認する。
 */
const ADMIN_SCREENS: [string, string, RegExp][] = [
  ['ADMINダッシュボード', '/admin', /コーチ一覧/],
  ['顧客一覧', '/admin/customers', /顧客一覧/],
  ['売上一覧', '/admin/sales', /売上一覧/],
  ['コーチ一覧', '/admin/coaches', /コーチ一覧/],
  ['目標承認', '/admin/approvals', /目標承認/],
  ['昇格審査', '/admin/promotions', /昇格候補/],
  ['月次締め', '/admin/close', /月次締め/],
  ['評価ルール', '/admin/rules', /評価ルール/],
  ['商品マスタ', '/admin/products', /商品/],
  ['監査ログ', '/admin/audit', /監査ログ/],
];

test.describe('セッションと画面到達性', () => {
  test.skip(({ isMobile }) => isMobile === true, 'ADMIN画面はPC利用が前提');

  test('未ログインでは保護された画面を開けない', async ({ page }) => {
    for (const path of ['/admin', '/coach', '/admin/audit', '/coach/records/new']) {
      await page.goto(path);
      await expect(page, `${path} は未ログインでは開けないこと`).toHaveURL(/\/login/);
    }
  });

  test('ログイン後は全ADMIN画面へ到達でき、サーバーエラーが出ない', async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(`JSエラー: ${error}`));
    page.on('response', (response) => {
      if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
    });

    await login(page, ADMIN_EMAIL);

    for (const [label, path, pattern] of ADMIN_SCREENS) {
      const startedAt = Date.now();
      await page.goto(path);
      await expect(page.getByText(pattern).first(), `${label} が表示されること`).toBeVisible();
      console.log(`  ${label} (${path}): ${Date.now() - startedAt}ms`);
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });

  test('ログアウトするとログイン画面へ戻り、保護画面へ入れなくなる', async ({ page }) => {
    await login(page, ADMIN_EMAIL);
    await logout(page);

    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });

  test('誤ったパスワードではログインできない', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('メールアドレス').fill(ADMIN_EMAIL);
    await page.getByLabel('パスワード').fill(`${demoPassword()}-wrong`);
    await page.getByRole('button', { name: 'ログイン' }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/ログインできません|メールアドレスまたはパスワード/)).toBeVisible();
  });
});
