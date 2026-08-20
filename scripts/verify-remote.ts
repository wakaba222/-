/**
 * Supabase 実環境に対する通し検証。
 *
 *   npm run verify:remote
 *
 * 検証内容:
 *   1. Auth      … デモユーザーでログインできるか / ロールが正しいか
 *   2. RLS       … COACH が他コーチのデータへ到達できないか (実際に試して拒否を確認)
 *   3. 権限昇格  … COACH が完全達成フラグやインセン額を偽装できないか
 *   4. 評価計算  … Professional Score が想定どおりに算出されるか
 *   5. 月次締め  … スナップショットが revision 付きで保存されるか
 *   6. 昇格判定  … 昇格候補が正しく抽出されるか
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { addMonthsToYearMonth, todayInJst, yearMonthOf } from '@/domain/date';
import { getCoachOverview } from '@/server/services/evaluationService';
import { closeMonth } from '@/server/services/monthlyCloseService';
import { loadAdminCoaches } from '@/server/services/adminOverviewService';
import { formatRate, formatScore, formatYen } from '@/lib/format';

const ADMIN_EMAIL = 'admin@eagle.example';
const COACH_EMAILS = ['tanaka@eagle.example', 'sato@eagle.example', 'suzuki@eagle.example'];

let failures = 0;
let checks = 0;

function check(condition: boolean, label: string, detail = ''): void {
  checks += 1;
  if (condition) {
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
    return;
  }
  failures += 1;
  console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} が設定されていません (.env.local を確認してください)`);
  return value;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 生成型が無い環境でも動かすため
type AnyClient = SupabaseClient<any, 'public', any>;

async function signIn(url: string, anonKey: string, email: string, password: string): Promise<AnyClient> {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${email} でログインできません: ${error.message}`);
  return client as AnyClient;
}

async function main(): Promise<void> {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const password = requireEnv('DEMO_USER_PASSWORD');

  const service = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as AnyClient;

  const thisMonth = yearMonthOf(todayInJst());

  // ---------------------------------------------------------------- 1. Auth
  console.log('\n[1] 認証');
  const adminClient = await signIn(url, anonKey, ADMIN_EMAIL, password);
  const { data: adminProfile } = await adminClient.from('users').select('role, name').eq('email', ADMIN_EMAIL).maybeSingle();
  check(adminProfile?.role === 'ADMIN', 'ADMIN でログインでき、ロールが ADMIN', String(adminProfile?.name ?? ''));

  const coachClients: Record<string, AnyClient> = {};
  for (const email of COACH_EMAILS) {
    coachClients[email] = await signIn(url, anonKey, email, password);
  }
  check(Object.keys(coachClients).length === COACH_EMAILS.length, `COACH ${COACH_EMAILS.length}名がログインできる`);

  // ----------------------------------------------------------------- 2. RLS
  console.log('\n[2] Row Level Security (実環境)');
  const { count: allCustomers } = await service.from('customers').select('id', { count: 'exact', head: true });
  const tanaka = coachClients['tanaka@eagle.example']!;
  const { count: tanakaCustomers } = await tanaka.from('customers').select('id', { count: 'exact', head: true });
  check(
    (tanakaCustomers ?? 0) > 0 && (tanakaCustomers ?? 0) < (allCustomers ?? 0),
    'COACH に見える顧客は自分の担当のみ',
    `${tanakaCustomers}名 / 全${allCustomers}名`,
  );

  const { count: allSales } = await service.from('sales').select('id', { count: 'exact', head: true });
  const { count: tanakaSales } = await tanaka.from('sales').select('id', { count: 'exact', head: true });
  check(
    (tanakaSales ?? 0) > 0 && (tanakaSales ?? 0) < (allSales ?? 0),
    'COACH に見える売上は自分の分のみ',
    `${tanakaSales}件 / 全${allSales}件`,
  );

  const { count: visibleCoaches } = await tanaka.from('coaches').select('id', { count: 'exact', head: true });
  check(visibleCoaches === 1, 'COACH に見えるコーチ行は自分だけ (他人の単価・ランクは不可視)', `${visibleCoaches}件`);

  const { count: auditVisible } = await tanaka.from('audit_logs').select('id', { count: 'exact', head: true });
  check((auditVisible ?? 0) === 0, 'COACH は監査ログを参照できない');

  const { count: adminCustomers } = await adminClient.from('customers').select('id', { count: 'exact', head: true });
  check(adminCustomers === allCustomers, 'ADMIN は全顧客を参照できる', `${adminCustomers}名`);

  // --------------------------------------------------------- 3. 権限昇格の防止
  console.log('\n[3] 権限昇格の防止');
  const { data: otherCoachCustomer } = await service
    .from('customers')
    .select('id, name, current_coach_id')
    .neq('current_coach_id', (await service.from('coaches').select('id').limit(1).maybeSingle()).data?.id ?? '')
    .limit(1)
    .maybeSingle();

  const { data: ownCustomer } = await tanaka.from('customers').select('id, complete_success').limit(1).maybeSingle();
  if (ownCustomer) {
    const { data: escalated, error: escalationError } = await tanaka
      .from('customers')
      .update({ complete_success: true, complete_success_at: '2020-01-01' })
      .eq('id', ownCustomer.id)
      .select('id');
    check(
      escalationError !== null || (escalated ?? []).length === 0,
      'COACH は顧客の完全達成フラグを直接書き換えられない',
      escalationError ? escalationError.code ?? escalationError.message : '0行更新',
    );
  }

  if (otherCoachCustomer) {
    const { error: crossInsertError } = await tanaka
      .from('performance_records')
      .insert({ customer_id: otherCoachCustomer.id, recorded_on: todayInJst(), score: 80 })
      .select('id');
    check(crossInsertError !== null, '担当外の顧客へ成果を登録できない', crossInsertError?.code ?? '');
  }

  const { data: product } = await service.from('products').select('id, incentive_amount').eq('code', 'RESTART').maybeSingle();
  const { data: tanakaCoach } = await tanaka.from('coaches').select('id').maybeSingle();
  if (product && tanakaCoach && ownCustomer) {
    const { data: inserted, error: saleError } = await tanaka
      .from('sales')
      .insert({
        coach_id: tanakaCoach.id,
        customer_id: ownCustomer.id,
        product_id: product.id,
        sold_on: todayInJst(),
        amount: 1,
        incentive_amount: 999_999,
        note: '[検証用] インセン額の偽装テスト',
      })
      .select('id, incentive_amount')
      .maybeSingle();

    if (saleError) {
      check(false, '売上を登録できる (インセン額の検証)', saleError.message);
    } else {
      check(
        inserted?.incentive_amount === product.incentive_amount,
        'インセンティブ額は商品マスタの値で上書きされる',
        `申告 999,999 → 保存 ${formatYen(inserted?.incentive_amount ?? 0)}`,
      );
      // 検証用データは評価に混ざらないよう削除する
      await service.from('sales').delete().eq('id', inserted?.id ?? '');
    }
  }

  // ------------------------------------------------------------- 4. 評価計算
  console.log('\n[4] Professional Score の算出');
  const coaches = await loadAdminCoaches(service);
  for (const coach of coaches) {
    const overview = await getCoachOverview(service, coach.id, coach.professional_level, thisMonth);
    const { customerSuccess, sales, professional } = overview.evaluation;
    console.log(
      `  ${coach.users?.name}: Score ${formatScore(professional.score)} (${professional.band})` +
        ` = 顧客成果 ${formatScore(customerSuccess.score)} + 売上 ${formatScore(sales.score)}` +
        ` / 完全成果率 ${formatRate(customerSuccess.longTerm.rate)}` +
        ` (${customerSuccess.longTerm.achievedCount}/${customerSuccess.longTerm.targetCount}名)`,
    );
    check(
      professional.evaluable ? (professional.score ?? -1) >= 0 && (professional.score ?? 0) <= 120 : true,
      `${coach.users?.name} のスコアが 0〜120 の範囲`,
    );
  }

  // ----------------------------------------------------------- 5. 月次締め
  console.log('\n[5] 月次スナップショット');
  const targetMonths = [2, 1, 0].map((offset) => addMonthsToYearMonth(thisMonth, -offset));
  for (const month of targetMonths) {
    const results = await closeMonth(service, month);
    console.log(`  ${month}: ${results.length}名を確定 (更新 ${results.filter((r) => !r.skipped).length}名)`);
  }

  const { data: snapshots } = await service
    .from('latest_evaluation_snapshots')
    .select('coach_id, year_month, revision, professional_score, evaluation_rule_version, is_evaluable')
    .gte('year_month', targetMonths[0]!)
    .order('year_month');
  check((snapshots ?? []).length === coaches.length * targetMonths.length,
    'コーチ×月の数だけスナップショットが保存された',
    `${(snapshots ?? []).length}件`);
  check((snapshots ?? []).every((s) => s.evaluation_rule_version >= 1),
    '各スナップショットに適用した評価ルールのversionが記録されている');

  // 再締めしても数字が変わらなければ revision は増えない
  const before = (snapshots ?? []).find((s) => s.year_month === thisMonth);
  await closeMonth(service, thisMonth);
  const { data: afterRow } = await service
    .from('latest_evaluation_snapshots')
    .select('revision')
    .eq('coach_id', before?.coach_id ?? '')
    .eq('year_month', thisMonth)
    .maybeSingle();
  check(afterRow?.revision === before?.revision,
    '同じ内容の再締めでは revision が増えない',
    `rev ${before?.revision} → ${afterRow?.revision}`);

  // ------------------------------------------------------------- 6. 昇格判定
  console.log('\n[6] 昇格判定');
  const { data: reviews } = await service
    .from('promotion_reviews')
    .select('coach_id, year_month, from_level, to_level, status, three_month_avg_score')
    .eq('year_month', thisMonth);

  const nameByCoachId = new Map(coaches.map((c) => [c.id, c.users?.name ?? '']));
  for (const review of reviews ?? []) {
    console.log(
      `  ${nameByCoachId.get(review.coach_id)}: ${review.from_level} → ${review.to_level}` +
        ` / ${review.status} (3ヶ月平均 ${formatScore(review.three_month_avg_score)})`,
    );
  }
  const candidates = (reviews ?? []).filter(
    (r) => r.status === 'CANDIDATE' || r.status === 'CANDIDATE_REQUIRES_APPROVAL',
  );
  check(candidates.length === 1, '昇格候補が1名抽出される (デモ想定)', `${candidates.length}名`);
  check(
    nameByCoachId.get(candidates[0]?.coach_id ?? '')?.startsWith('田中') ?? false,
    '昇格候補は田中 健一 (P2 → P3)',
  );

  // --------------------------------------------------------------- 結果
  console.log(`\n${'='.repeat(60)}`);
  if (failures > 0) {
    console.error(`検証 ${checks}件中 ${failures}件が失敗しました`);
    process.exit(1);
  }
  console.log(`検証 ${checks}件すべて成功しました`);
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
