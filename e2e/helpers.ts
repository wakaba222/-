import { expect, test, type Page } from '@playwright/test';

/** 実行のたびに消えないよう、スクリーンショットは固定ディレクトリへ出す */
export const SCREENSHOT_DIR = 'e2e-screenshots';

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@eagle.example';

/**
 * コーチ用のログインアカウント。
 * 環境ごとに在籍コーチが違うため、E2E_COACH_EMAIL で差し替えられるようにしている。
 * 指定が無い環境では、コーチ操作を伴うテストは skipIfNoCoachAccount() で除外する。
 */
export const COACH_EMAIL = process.env.E2E_COACH_EMAIL ?? '';

/**
 * コーチのログイン情報が渡されていない環境ではコーチ操作のテストを飛ばす。
 * 本番のように「実在コーチのパスワードを保持していない」環境で、
 * 存在しないデモアカウントでのログイン失敗を「不具合」と誤認しないようにする。
 */
export function skipIfNoCoachAccount(): void {
  test.skip(
    COACH_EMAIL === '',
    'コーチのログイン情報 (E2E_COACH_EMAIL) が未指定のためスキップ',
  );
}

export function demoPassword(): string {
  const password = process.env.DEMO_USER_PASSWORD;
  if (!password) throw new Error('DEMO_USER_PASSWORD が設定されていません');
  return password;
}

export async function login(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(demoPassword());
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL(/\/(admin|coach)/, { timeout: 30_000 });
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'ログアウト' }).click();
  await page.waitForURL(/\/login/);
}

/**
 * ラベルで指定した select から、表示テキストに needle を含む選択肢を選ぶ。
 * selectOption は完全一致のラベルしか受け付けないため、部分一致で解決する。
 */
export async function selectOptionContaining(page: Page, label: string, needle: string): Promise<string> {
  const select = page.getByLabel(label);
  const options = await select.locator('option').allTextContents();
  const matched = options.find((text) => text.includes(needle));
  expect(matched, `${label} に「${needle}」を含む選択肢が見つかりません`).toBeTruthy();
  await select.selectOption({ label: matched! });
  return matched!;
}

/** 画面上の Professional Score (ヒーロー表示) を数値で取り出す */
export async function readProfessionalScore(page: Page): Promise<number> {
  const text = await page.locator('main .tabular').first().innerText();
  const value = Number(text.replace(/[^\d.]/g, ''));
  expect(Number.isFinite(value)).toBe(true);
  return value;
}
