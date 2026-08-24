/**
 * デモデータを本番プロジェクトから削除する。
 *
 *   npm run demo:purge -- --confirm
 *
 * 残すもの: ADMIN アカウント / 商品マスタ / 評価ルール
 * 消すもの: 顧客・目標・担当履歴・成果・売上・評価スナップショット・昇格判定・
 *           行動ルール・レッスン数・通知・コーチ (ログインアカウント含む)
 *           および --with-audit 指定時は監査ログ
 *
 * 取り消せない操作のため、--confirm がなければ件数を表示するだけで終了する。
 */
import { createClient } from '@supabase/supabase-js';

const KEEP_ADMIN_EMAIL = process.env.PURGE_KEEP_ADMIN_EMAIL ?? 'admin@eagle.example';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} が設定されていません`);
  return value;
}

async function main(): Promise<void> {
  const confirmed = process.argv.includes('--confirm');
  const withAudit = process.argv.includes('--with-audit');
  const admin = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const tables = [
    'sales',
    'performance_records',
    'customer_goals',
    'customer_coach_assignments',
    'customers',
    'evaluation_snapshots',
    'promotion_reviews',
    'promotion_requirement_checks',
    'coach_behavior_statuses',
    'monthly_lesson_counts',
    'notifications',
    'coaches',
  ] as const;

  console.log('現在の件数:');
  for (const table of tables) {
    const { count } = await admin.from(table).select('id', { count: 'exact', head: true });
    console.log(`  ${table.padEnd(30)} ${count ?? 0}`);
  }

  const { data: users } = await admin.from('users').select('id, email, role');
  const targets = (users ?? []).filter((u) => u.email.toLowerCase() !== KEEP_ADMIN_EMAIL.toLowerCase());
  console.log(`  削除対象のログインアカウント        ${targets.length} (${KEEP_ADMIN_EMAIL} は残す)`);

  if (!confirmed) {
    console.log('\n--confirm を付けると実際に削除します');
    return;
  }

  // 外部キーの依存順に削除する
  for (const table of tables) {
    const { error } = await admin.from(table).delete().not('id', 'is', null);
    if (error) throw new Error(`${table} の削除に失敗しました: ${error.message}`);
    console.log(`削除: ${table}`);
  }

  // 監査ログは実行者を参照している。履歴を残す場合でもアカウントは消せるよう、参照だけ外す
  for (const user of targets) {
    const { error } = await admin.from('audit_logs').update({ actor_user_id: null }).eq('actor_user_id', user.id);
    if (error) throw new Error(`監査ログの実行者の付け替えに失敗しました: ${error.message}`);
  }

  for (const user of targets) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`${user.email} の削除に失敗しました: ${error.message}`);
    console.log(`削除: ${user.email}`);
  }

  if (withAudit) {
    // 上の削除操作自体も監査ログに残るため、最後にまとめて消す
    const { error } = await admin.from('audit_logs').delete().not('id', 'is', null);
    if (error) throw new Error(`監査ログの削除に失敗しました: ${error.message}`);
    console.log('削除: audit_logs');
  }

  console.log('\nデモデータを削除しました');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
