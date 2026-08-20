/**
 * SQL ファイルを Supabase プロジェクトへ適用する。
 *
 * 直接 PostgreSQL へ TCP 接続できない環境 (アウトバウンドが HTTPS のみ許可) でも
 * マイグレーションを流せるよう、Management API の query エンドポイントを使う。
 *
 *   npm run db:push -- supabase/migrations/*.sql
 *
 * 必要な環境変数 (.env.local):
 *   SUPABASE_PROJECT_REF     プロジェクト参照ID (URL の xxxx.supabase.co の xxxx)
 *   SUPABASE_ACCESS_TOKEN    個人アクセストークン (sbp_...)
 */
import { readFileSync } from 'node:fs';

const API_BASE = 'https://api.supabase.com/v1';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} が設定されていません (.env.local を確認してください)`);
  return value;
}

async function runQuery(projectRef: string, token: string, sql: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SQL の実行に失敗しました (HTTP ${response.status}): ${text.slice(0, 800)}`);
  }
  return text.length > 0 ? JSON.parse(text) : null;
}

async function main(): Promise<void> {
  const projectRef = requireEnv('SUPABASE_PROJECT_REF');
  const token = requireEnv('SUPABASE_ACCESS_TOKEN');

  const files = process.argv.slice(2);
  if (files.length === 0) throw new Error('適用する SQL ファイルを指定してください');

  for (const file of files) {
    const sql = readFileSync(file, 'utf8');
    process.stdout.write(`適用: ${file} … `);
    await runQuery(projectRef, token, sql);
    console.log('OK');
  }

  console.log(`\n${files.length}件の SQL を適用しました`);
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
