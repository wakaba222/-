/**
 * コーチをまとめて登録する。
 *
 *   npm run coaches:create -- --confirm
 *
 * ADMIN画面の登録処理と同じ手順を踏む:
 *   ログインアカウント作成 → プロフィールの氏名/ロール確定 → コーチ行の作成
 * レッスン単価は評価ルールのランク別単価から取る。
 *
 * 既に同じメールアドレスが登録されている場合はスキップする (二重登録の防止)。
 */
import { createClient } from '@supabase/supabase-js';
import { todayInJst, yearMonthOf } from '@/domain/date';
import { evaluationRulesSchema, DEFAULT_EVALUATION_RULES } from '@/domain/evaluation';
import type { ProfessionalLevel } from '@/domain/types';

interface CoachSeed {
  name: string;
  email: string;
  level: ProfessionalLevel;
  hireDate: string;
  note: string;
}

const COACHES: CoachSeed[] = [
  { name: '松本 菜々子', email: 'matsumoto@eagle.example', level: 'P1', hireDate: '2024-03-01', note: '2年前の3月から' },
  { name: '鎮守 あいか', email: 'chinju@eagle.example', level: 'P1', hireDate: '2025-10-01', note: '2025年9〜11月ごろから' },
  { name: '坂東 莉子', email: 'bando@eagle.example', level: 'P1', hireDate: '2025-12-01', note: '2025年末から' },
  { name: '山本 あいり', email: 'yamamoto@eagle.example', level: 'P1', hireDate: '2026-04-01', note: '今年4月から' },
  { name: '村山 優花', email: 'murayama@eagle.example', level: 'P1', hireDate: '2026-04-01', note: '今年4月から' },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} が設定されていません`);
  return value;
}

/** 初回ログイン用のパスワード (ADMIN画面の生成規則と同じ) */
function generateTemporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return `Eg${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}#7`;
}

async function main(): Promise<void> {
  const confirmed = process.argv.includes('--confirm');
  const admin = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: ruleRow } = await admin
    .from('evaluation_rules')
    .select('rules')
    .lte('effective_from', todayInJst())
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<{ rules: unknown }>();
  const rules = ruleRow ? evaluationRulesSchema.parse(ruleRow.rules) : DEFAULT_EVALUATION_RULES;

  console.log(`評価ルール v${rules.version} のランク別単価を使用します`);
  console.log(`対象月: ${yearMonthOf(todayInJst())}\n`);

  if (!confirmed) {
    for (const coach of COACHES) {
      console.log(`  ${coach.name} / ${coach.email} / ${coach.level} / ${coach.hireDate} (${coach.note})`);
    }
    console.log('\n--confirm を付けると実際に登録します');
    return;
  }

  const created: { name: string; email: string; password: string }[] = [];

  for (const coach of COACHES) {
    const { data: existing } = await admin.from('users').select('id').ilike('email', coach.email).maybeSingle<{ id: string }>();
    if (existing) {
      console.log(`スキップ: ${coach.email} は登録済み`);
      continue;
    }

    const password = generateTemporaryPassword();
    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      email: coach.email,
      password,
      email_confirm: true,
      user_metadata: { name: coach.name, role: 'COACH' },
    });
    if (authError || !authUser.user) throw new Error(`${coach.email}: ${authError?.message ?? '作成失敗'}`);

    const { error: profileError } = await admin
      .from('users')
      .update({ name: coach.name, role: 'COACH' })
      .eq('id', authUser.user.id);
    if (profileError) throw new Error(`${coach.email} のプロフィール更新に失敗: ${profileError.message}`);

    const { error: coachError } = await admin.from('coaches').insert({
      user_id: authUser.user.id,
      professional_level: coach.level,
      lesson_unit_price: rules.lessonUnitPrice[coach.level],
      hire_date: coach.hireDate,
    });
    if (coachError) {
      await admin.auth.admin.deleteUser(authUser.user.id);
      throw new Error(`${coach.email} のコーチ登録に失敗: ${coachError.message}`);
    }

    created.push({ name: coach.name, email: coach.email, password });
    console.log(`登録: ${coach.name} (${coach.email})`);
  }

  if (created.length > 0) {
    console.log('\n--- 初回ログイン情報 (本人へ伝えてください) ---');
    for (const c of created) console.log(`  ${c.name.padEnd(12)} ${c.email.padEnd(28)} ${c.password}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
