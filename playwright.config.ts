import { defineConfig, devices } from '@playwright/test';

/**
 * この環境にはブラウザが事前導入されている。Playwright のバージョンが期待する
 * ビルド番号と一致しないことがあるため、実体のパスを明示して起動する。
 */
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

/** CI コンテナは root で動くため、Chromium のサンドボックスを無効化して起動する */
const LAUNCH_OPTIONS = { executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] };

/**
 * この環境の外部通信は HTTP プロキシ経由に限られる。
 * Chromium は環境変数を読まないため明示的に指定する (ローカル検証時は素通し)。
 */
const PROXY_SERVER = process.env.HTTPS_PROXY ?? process.env.https_proxy;
const PROXY = PROXY_SERVER ? { proxy: { server: PROXY_SERVER, bypass: 'localhost,127.0.0.1' } } : {};

/**
 * 実環境 (Supabase) に接続したアプリを、実ブラウザで通しで確認するための設定。
 * 事前に `npm run build` を済ませ、本番ビルドを起動して検証する。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '.playwright/results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    ...PROXY,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], launchOptions: LAUNCH_OPTIONS },
    },
    {
      // iPhone のデバイス定義は既定で WebKit を使うが、この環境には Chromium しか無い。
      // 画面サイズとタッチ操作の条件だけを borrow して Chromium で実行する。
      name: 'mobile',
      use: { ...devices['iPhone 14'], browserName: 'chromium', launchOptions: LAUNCH_OPTIONS },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run start -- --port 3000',
        url: 'http://127.0.0.1:3000/login',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
