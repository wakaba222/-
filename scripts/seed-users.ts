/**
 * デモ用の認証ユーザーを Supabase Auth の Admin API で作成する。
 *
 * auth スキーマへ直接 INSERT すると GoTrue のバージョン差でログインできなくなるため、
 * 公式 API 経由で作成する。public.users のプロフィール行は
 * auth.users のトリガ (handle_new_auth_user) がメタデータから作る。
 *
 *   npm run seed:users
 *
 * 必要な環境変数 (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   DEMO_USER_PASSWORD (未設定なら実行を中止する)
 */
import { createClient } from '@supabase/supabase-js';

interface DemoUser {
  email: string;
  name: string;
  role: 'ADMIN' | 'COACH';
}

const DEMO_USERS: DemoUser[] = [
  { email: 'admin@eagle.example', name: '経営管理者', role: 'ADMIN' },
  { email: 'tanaka@eagle.example', name: '田中 健一', role: 'COACH' },
  { email: 'sato@eagle.example', name: '佐藤 美咲', role: 'COACH' },
  { email: 'suzuki@eagle.example', name: '鈴木 大輔', role: 'COACH' },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} が設定されていません (.env.local を確認してください)`);
  return value;
}

async function main(): Promise<void> {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const password = requireEnv('DEMO_USER_PASSWORD');

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: existing, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listError) throw new Error(`既存ユーザーの取得に失敗しました: ${listError.message}`);
  const byEmail = new Map(existing.users.map((user) => [user.email?.toLowerCase() ?? '', user]));

  for (const demo of DEMO_USERS) {
    const found = byEmail.get(demo.email);
    const attributes = {
      email: demo.email,
      password,
      email_confirm: true,
      user_metadata: { name: demo.name, role: demo.role },
    };

    if (found) {
      const { error } = await admin.auth.admin.updateUserById(found.id, attributes);
      if (error) throw new Error(`${demo.email} の更新に失敗しました: ${error.message}`);
      console.log(`更新: ${demo.email} (${demo.role})`);
    } else {
      const { error } = await admin.auth.admin.createUser(attributes);
      if (error) throw new Error(`${demo.email} の作成に失敗しました: ${error.message}`);
      console.log(`作成: ${demo.email} (${demo.role})`);
    }
  }

  // トリガでプロフィール行が作られたか確認する (RLS をバイパスするサービスロールで参照)
  const { data: profiles, error: profileError } = await admin
    .from('users')
    .select('email, role, name')
    .in('email', DEMO_USERS.map((u) => u.email));
  if (profileError) throw new Error(`プロフィール行の確認に失敗しました: ${profileError.message}`);

  const missing = DEMO_USERS.filter((u) => !(profiles ?? []).some((p) => p.email === u.email));
  if (missing.length > 0) {
    throw new Error(
      `public.users にプロフィール行が作られていません: ${missing.map((m) => m.email).join(', ')}\n` +
        'マイグレーション (auth_hook) が適用されているか確認してください',
    );
  }

  console.log(`\nデモユーザー ${DEMO_USERS.length}名を準備しました`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
