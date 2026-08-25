/**
 * COACH ロールが設定を変更できないことの実地検証。
 *
 *   npm run verify:authz
 *
 * 「画面に出していない」「Server Action で弾いている」だけでは不十分で、
 * COACH のアクセストークンを直接 PostgREST へ投げれば通ってしまう、という穴を潰すための検証。
 * ここでは実際に COACH のトークンで HTTP を叩き、
 *   ① 拒否されること
 *   ② 拒否のあとに値が1つも変わっていないこと
 * の両方を確認する。②が無いと「エラーは返るが書き込まれている」を見逃す。
 *
 * 対象 (設定・評価に直結し、COACH が触れてはいけないもの):
 *   evaluation_rules / products / coaches.professional_level / coaches.lesson_unit_price /
 *   coach_behavior_statuses / promotion_reviews / promotion_requirement_checks /
 *   evaluation_snapshots / users.role / インセンティブ設定 (products.incentive_amount)
 *
 * コーチのパスワードは保持しないため、service_role のマジックリンクから
 * 検証用のアクセストークンを一時的に発行して使う (パスワードは変更しない)。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

/** COACH の検証用アクセストークンを発行する (パスワード不要・パスワードを変えない) */
async function issueCoachToken(url: string, anonKey: string, service: AnyClient, email: string): Promise<string> {
  const { data, error } = await service.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`${email} のトークン発行に失敗しました: ${error.message}`);

  const pub = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const verified = await pub.auth.verifyOtp({
    email,
    token: data.properties.email_otp,
    type: 'email',
  });
  if (verified.error || !verified.data.session) {
    throw new Error(`${email} のトークン検証に失敗しました: ${verified.error?.message}`);
  }
  return verified.data.session.access_token;
}

interface Attempt {
  label: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
}

/** PostgREST へ生の HTTP を投げる (supabase-js を介さないので、クライアント側の細工では回避できない) */
async function raw(
  url: string,
  anonKey: string,
  token: string,
  attempt: Attempt,
): Promise<{ status: number; text: string }> {
  const response = await fetch(`${url}/rest/v1/${attempt.path}`, {
    method: attempt.method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    ...(attempt.body === undefined ? {} : { body: JSON.stringify(attempt.body) }),
  });
  return { status: response.status, text: (await response.text()).slice(0, 300) };
}

/** 書き込みが通ってしまったと見なす条件: 2xx かつ 0件更新でない */
function wasAccepted(status: number, text: string): boolean {
  if (status < 200 || status >= 300) return false;
  // PATCH/DELETE は該当行が無ければ 2xx で空配列が返る。これは「拒否」ではなく「対象なし」。
  return text.trim() !== '[]' && text.trim() !== '';
}

async function main(): Promise<void> {
  // E2E からコーチ視点の確認をするためのセッションCookieを出力するモード
  const printCookieOnly = process.argv.includes('--print-coach-cookie');

  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const service = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as AnyClient;

  // 検証に使うコーチ (在籍している任意の1名)
  const { data: coaches, error: coachError } = await service
    .from('coaches')
    .select('id, user_id, professional_level, lesson_unit_price, users(email, name, role)')
    .is('deleted_at', null)
    .limit(1);
  if (coachError) throw new Error(`コーチの取得に失敗しました: ${coachError.message}`);
  const coach = coaches?.[0];
  if (!coach) throw new Error('検証に使えるコーチが登録されていません');

  // PostgREST の埋め込みは配列で返ることがあるため、どちらでも取り出せるようにする
  const coachUser = (Array.isArray(coach.users) ? coach.users[0] : coach.users) as
    | { email: string; name: string }
    | undefined;
  const coachEmail = coachUser?.email;
  if (!coachEmail) throw new Error('コーチのメールアドレスを取得できませんでした');
  if (!printCookieOnly) {
    console.log(`\n検証に使うコーチ: ${coachUser?.name} <${coachEmail}> (${coach.professional_level})`);
  }

  if (printCookieOnly) {
    process.stdout.write(buildSessionCookie(url, await issueCoachSession(url, anonKey, service, coachEmail)));
    return;
  }

  const token = await issueCoachToken(url, anonKey, service, coachEmail);

  // 変更前の値を控える (拒否されたのに書き換わっていないかを後で突き合わせる)
  const before = await snapshotSettings(service, coach.id);

  const { data: rules } = await service
    .from('evaluation_rules')
    .select('version, rules')
    .order('version', { ascending: false })
    .limit(1);
  const currentVersion = rules?.[0]?.version as number | undefined;

  const { data: products } = await service.from('products').select('id, code, incentive_amount').limit(1);
  const product = products?.[0];

  const { data: snapshots } = await service.from('evaluation_snapshots').select('id').limit(1);
  const snapshot = snapshots?.[0];

  const { data: reviews } = await service.from('promotion_reviews').select('id').limit(1);
  const review = reviews?.[0];

  const { data: behaviors } = await service.from('coach_behavior_statuses').select('id').limit(1);
  const behavior = behaviors?.[0];

  const { data: checkRows } = await service.from('promotion_requirement_checks').select('id').limit(1);
  const requirement = checkRows?.[0];

  const attempts: Attempt[] = [
    // --- 評価ルール (Score配点・昇格条件・報酬設定そのもの) ---
    {
      label: '評価ルールの新バージョンを作る',
      method: 'POST',
      path: 'evaluation_rules',
      body: { version: (currentVersion ?? 0) + 900, effective_from: '2030-01-01', rules: { tampered: true } },
    },
    ...(currentVersion === undefined
      ? []
      : [
          {
            label: '現在の評価ルールの中身を書き換える',
            method: 'PATCH' as const,
            path: `evaluation_rules?version=eq.${currentVersion}`,
            body: { note: '[不正] COACHによる変更' },
          },
          {
            label: '評価ルールを削除する',
            method: 'DELETE' as const,
            path: `evaluation_rules?version=eq.${currentVersion}`,
          },
        ]),

    // --- 商品マスタ / インセンティブ設定 ---
    {
      label: '商品を新規登録する',
      method: 'POST',
      path: 'products',
      body: { code: 'TAMPER', name: '[不正] COACHが作った商品', default_price: 1, incentive_amount: 999_999 },
    },
    ...(product === undefined
      ? []
      : [
          {
            label: 'インセンティブ額を引き上げる',
            method: 'PATCH' as const,
            path: `products?id=eq.${product.id}`,
            body: { incentive_amount: 999_999 },
          },
          {
            label: '商品の価格を書き換える',
            method: 'PATCH' as const,
            path: `products?id=eq.${product.id}`,
            body: { default_price: 1 },
          },
          {
            label: '商品を評価対象外にする',
            method: 'PATCH' as const,
            path: `products?id=eq.${product.id}`,
            body: { is_sales_score_target: false },
          },
        ]),

    // --- 自分のランク・単価 ---
    {
      label: '自分のランクを P4 に上げる',
      method: 'PATCH',
      path: `coaches?id=eq.${coach.id}`,
      body: { professional_level: 'P4' },
    },
    {
      label: '自分のレッスン単価を引き上げる',
      method: 'PATCH',
      path: `coaches?id=eq.${coach.id}`,
      body: { lesson_unit_price: 999_999 },
    },
    {
      label: '自分の入社日を書き換える (経過月数の偽装)',
      method: 'PATCH',
      path: `coaches?id=eq.${coach.id}`,
      body: { hire_date: '2000-01-01' },
    },

    // --- 行動ルール ---
    {
      label: '自分の行動ルール状態を OK にする',
      method: 'POST',
      path: 'coach_behavior_statuses',
      body: { coach_id: coach.id, year_month: '2030-01', status: 'OK', note: '[不正] COACHによる登録' },
    },
    ...(behavior === undefined
      ? []
      : [
          {
            label: '既存の行動ルール状態を書き換える',
            method: 'PATCH' as const,
            path: `coach_behavior_statuses?id=eq.${behavior.id}`,
            body: { status: 'OK' },
          },
        ]),

    // --- 昇格 ---
    {
      label: '自分の昇格審査を承認済みにする',
      method: 'POST',
      path: 'promotion_reviews',
      body: {
        coach_id: coach.id,
        year_month: '2030-01',
        from_level: coach.professional_level,
        to_level: 'P4',
        status: 'APPROVED',
      },
    },
    ...(review === undefined
      ? []
      : [
          {
            label: '既存の昇格審査を承認済みに書き換える',
            method: 'PATCH' as const,
            path: `promotion_reviews?id=eq.${review.id}`,
            body: { status: 'APPROVED' },
          },
        ]),
    {
      label: '昇格要件を自分で承認済みにする',
      method: 'POST',
      path: 'promotion_requirement_checks',
      body: { coach_id: coach.id, requirement_code: 'TAMPER', label: '[不正]', achieved_count: 99, approved_at: '2026-01-01T00:00:00Z' },
    },
    ...(requirement === undefined
      ? []
      : [
          {
            label: '既存の昇格要件を承認済みにする',
            method: 'PATCH' as const,
            path: `promotion_requirement_checks?id=eq.${requirement.id}`,
            body: { approved_at: '2026-01-01T00:00:00Z', achieved_count: 99 },
          },
          {
            label: '昇格要件を削除する',
            method: 'DELETE' as const,
            path: `promotion_requirement_checks?id=eq.${requirement.id}`,
          },
        ]),

    // --- 評価スナップショット (確定済みの評価結果) ---
    {
      label: '自分の評価スナップショットを作る',
      method: 'POST',
      path: 'evaluation_snapshots',
      body: {
        coach_id: coach.id,
        year_month: '2030-01',
        revision: 1,
        professional_score: 120,
        current_rank: coach.professional_level,
        evaluation_rule_version: currentVersion ?? 1,
      },
    },
    ...(snapshot === undefined
      ? []
      : [
          {
            label: '確定済みスナップショットのScoreを書き換える',
            method: 'PATCH' as const,
            path: `evaluation_snapshots?id=eq.${snapshot.id}`,
            body: { professional_score: 120 },
          },
          {
            label: '確定済みスナップショットを削除する',
            method: 'DELETE' as const,
            path: `evaluation_snapshots?id=eq.${snapshot.id}`,
          },
        ]),

    // --- 権限そのもの ---
    {
      label: '自分のロールを ADMIN に昇格させる',
      method: 'PATCH',
      path: `users?id=eq.${coach.user_id}`,
      body: { role: 'ADMIN' },
    },
  ];

  console.log(`\n[1] DB層: COACHトークンでPostgRESTを直接叩く (${attempts.length}件)`);
  for (const attempt of attempts) {
    const { status, text } = await raw(url, anonKey, token, attempt);
    check(!wasAccepted(status, text), `拒否: ${attempt.label}`, describeRejection(status, text));
  }

  console.log('\n[2] 拒否のあとに値が変わっていないこと');
  const after = await snapshotSettings(service, coach.id);
  for (const [key, value] of Object.entries(before)) {
    check(
      JSON.stringify(after[key]) === JSON.stringify(value),
      `変更なし: ${key}`,
      JSON.stringify(after[key]).slice(0, 80),
    );
  }

  // --- COACH が「できてよいこと」も確認する (締めすぎて業務が止まらないように) ---
  console.log('\n[3] COACH が本来できることは、できたままであること');
  const allowed: { label: string; path: string }[] = [
    { label: '自分のコーチ情報を見る', path: `coaches?id=eq.${coach.id}&select=id,professional_level` },
    { label: '評価ルールを見る (画面表示に必要)', path: 'evaluation_rules?select=version&limit=1' },
    { label: '商品を見る (売上登録に必要)', path: 'products?select=id,name&limit=1' },
    { label: '自分の担当顧客を見る', path: `customers?current_coach_id=eq.${coach.id}&select=id` },
    { label: '自分の売上を見る', path: `sales?coach_id=eq.${coach.id}&select=id` },
  ];
  for (const item of allowed) {
    const response = await fetch(`${url}/rest/v1/${item.path}`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
    check(response.ok, `参照できる: ${item.label}`, `HTTP ${response.status}`);
  }

  // 監査ログは ADMIN のみ参照できる
  const auditResponse = await fetch(`${url}/rest/v1/audit_logs?select=id&limit=1`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  const auditRows = auditResponse.ok ? ((await auditResponse.json()) as unknown[]) : [];
  check(auditRows.length === 0, '参照できない: 監査ログ', `HTTP ${auditResponse.status} / ${auditRows.length}件`);

  // --- アプリ層 (Server Action / Route Handler) ---
  const appUrl = process.env.AUTHZ_APP_URL;
  if (!appUrl) {
    console.log('\n[4] アプリ層: AUTHZ_APP_URL が未指定のためスキップ');
    console.log('    例: AUTHZ_APP_URL=https://flame-eight-54.vercel.app npm run verify:authz');
  } else {
    console.log(`\n[4] アプリ層: COACHのセッションで ${appUrl} を叩く`);
    const cookie = buildSessionCookie(url, await issueCoachSession(url, anonKey, service, coachEmail));

    // Route Handler: CSV出力は ADMIN 限定
    for (const type of ['coaches', 'customers', 'sales']) {
      const response = await fetch(`${appUrl}/api/export/${type}`, { headers: { cookie }, redirect: 'manual' });
      check(response.status === 403, `403で拒否: CSV出力 /api/export/${type}`, `HTTP ${response.status}`);
    }

    // 月次締めジョブは共有シークレットが要る (COACHのセッションでは通らない)
    const cronResponse = await fetch(`${appUrl}/api/cron/monthly-close`, { headers: { cookie }, redirect: 'manual' });
    check(cronResponse.status === 401, '401で拒否: 月次締めジョブの直接呼び出し', `HTTP ${cronResponse.status}`);

    // 画面: 設定系のADMIN画面はCOACHには開かない
    for (const path of ['/admin', '/admin/rules', '/admin/products', '/admin/coaches', '/admin/promotions', '/admin/audit']) {
      const response = await fetch(`${appUrl}${path}`, { headers: { cookie }, redirect: 'manual' });
      const location = response.headers.get('location') ?? '';
      const blocked = response.status >= 300 && response.status < 400 && !location.includes('/admin');
      check(blocked, `COACHには開かない: ${path}`, `HTTP ${response.status} → ${location || '(遷移なし)'}`);
    }
  }

  console.log(`\n${failures === 0 ? '✅ 全て意図どおりでした' : `❌ ${failures}件の問題があります`} (${checks}件検証)`);
  if (failures > 0) process.exitCode = 1;
}

/** 拒否のされ方を短く説明する (無言の空振りか、明示的な拒否か) */
function describeRejection(status: number, text: string): string {
  if (status === 403 || status === 401) return `HTTP ${status} 明示的に拒否`;
  if (status >= 200 && status < 300) return `HTTP ${status} 対象行なし (RLSが行を隠した)`;
  return `HTTP ${status} ${text.slice(0, 60)}`;
}

/** アプリ層の検証用に、Cookie に入れるセッションを作る */
async function issueCoachSession(
  url: string,
  anonKey: string,
  service: AnyClient,
  email: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await service.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`${email} のセッション発行に失敗しました: ${error.message}`);

  const pub = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const verified = await pub.auth.verifyOtp({ email, token: data.properties.email_otp, type: 'email' });
  if (verified.error || !verified.data.session) {
    throw new Error(`${email} のセッション検証に失敗しました: ${verified.error?.message}`);
  }
  const session = verified.data.session;
  return {
    access_token: session.access_token,
    token_type: session.token_type,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    refresh_token: session.refresh_token,
    user: session.user,
  };
}

/** @supabase/ssr が読む形式の Cookie 文字列を組み立てる */
function buildSessionCookie(url: string, session: Record<string, unknown>): string {
  const ref = new URL(url).hostname.split('.')[0];
  const encoded = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;
  const chunkSize = 3180;
  if (encoded.length <= chunkSize) return `sb-${ref}-auth-token=${encoded}`;

  const parts: string[] = [];
  for (let i = 0; i * chunkSize < encoded.length; i += 1) {
    parts.push(`sb-${ref}-auth-token.${i}=${encoded.slice(i * chunkSize, (i + 1) * chunkSize)}`);
  }
  return parts.join('; ');
}

/** 設定系テーブルの現在値をまとめて控える */
async function snapshotSettings(service: AnyClient, coachId: string): Promise<Record<string, unknown>> {
  const [rules, products, coach, behaviors, reviews, requirements, snapshots, users] = await Promise.all([
    service.from('evaluation_rules').select('version, rules, note').order('version'),
    service.from('products').select('id, code, default_price, incentive_amount, is_sales_score_target').order('code'),
    service.from('coaches').select('id, professional_level, lesson_unit_price, hire_date').eq('id', coachId),
    service.from('coach_behavior_statuses').select('id, coach_id, year_month, status').order('id'),
    service.from('promotion_reviews').select('id, coach_id, year_month, status').order('id'),
    service.from('promotion_requirement_checks').select('id, coach_id, requirement_code, achieved_count, approved_at').order('id'),
    service.from('evaluation_snapshots').select('id, coach_id, year_month, revision, professional_score').order('id'),
    service.from('users').select('id, role').order('id'),
  ]);

  return {
    評価ルール: rules.data,
    商品マスタ: products.data,
    コーチのランクと単価: coach.data,
    行動ルール: behaviors.data,
    昇格審査: reviews.data,
    昇格要件: requirements.data,
    評価スナップショット: snapshots.data,
    ユーザーのロール: users.data,
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
