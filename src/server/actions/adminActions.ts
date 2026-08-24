'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { addMonthsToYearMonth, isDateOnly, todayInJst, yearMonthOf } from '@/domain/date';
import { evaluationRulesSchema } from '@/domain/evaluation';
import { loadEvaluationRules } from '@/server/repositories/evaluationRepository';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/server/auth';
import { fail, ok, type ActionResult } from '@/server/actionResult';
import { closeMonth } from '@/server/services/monthlyCloseService';
import { cancelSale } from '@/server/services/salesService';
import { refreshCustomerAchievement } from '@/server/services/performanceService';

const dateOnly = z.string().refine(isDateOnly, '日付の形式が正しくありません');
const optionalNumber = z
  .string()
  .transform((v) => (v.trim() === '' ? null : Number(v)))
  .refine((v) => v === null || Number.isFinite(v), '数値を入力してください');

const customerSchema = z
  .object({
    name: z.string().min(1, '氏名を入力してください').max(100),
    coachId: z.string().uuid('担当コーチを選択してください'),
    programStartDate: dateOnly,
    goalType: z.enum(['SCORE', 'DISTANCE', 'BOTH']),
    startScore: optionalNumber,
    targetScore: optionalNumber,
    startDistance: optionalNumber,
    targetDistance: optionalNumber,
    note: z.string().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    const needsScore = value.goalType === 'SCORE' || value.goalType === 'BOTH';
    const needsDistance = value.goalType === 'DISTANCE' || value.goalType === 'BOTH';
    if (needsScore && value.targetScore === null) {
      ctx.addIssue({ code: 'custom', path: ['targetScore'], message: '目標スコアを入力してください' });
    }
    if (needsDistance && value.targetDistance === null) {
      ctx.addIssue({ code: 'custom', path: ['targetDistance'], message: '目標飛距離を入力してください' });
    }
  });

/** プログラムの標準期間 (仕様5章: 開始から6ヶ月) */
const PROGRAM_MONTHS = 6;

function addMonthsToDate(date: string, months: number): string {
  const ym = addMonthsToYearMonth(date.slice(0, 7), months);
  const day = date.slice(8, 10);
  // 応当日が存在しない月 (1/31 → 7/31 など) は月末に丸める
  const lastDay = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  return `${ym}-${String(Math.min(Number(day), lastDay)).padStart(2, '0')}`;
}

export async function createCustomerAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = customerSchema.safeParse({
    name: formData.get('name'),
    coachId: formData.get('coachId'),
    programStartDate: formData.get('programStartDate'),
    goalType: formData.get('goalType'),
    startScore: formData.get('startScore') ?? '',
    targetScore: formData.get('targetScore') ?? '',
    startDistance: formData.get('startDistance') ?? '',
    targetDistance: formData.get('targetDistance') ?? '',
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? '入力内容を確認してください');

  const supabase = await createSupabaseServerClient();
  const input = parsed.data;
  const endDate = addMonthsToDate(input.programStartDate, PROGRAM_MONTHS);

  const { data: customer, error } = await supabase
    .from('customers')
    .insert({
      name: input.name,
      current_coach_id: input.coachId,
      program_start_date: input.programStartDate,
      program_end_date: endDate,
      goal_type: input.goalType,
      start_score: input.startScore,
      target_score: input.targetScore,
      start_distance: input.startDistance,
      target_distance: input.targetDistance,
      // 目標はADMIN承認までは評価に使わない (仕様6章)
      goal_approval_status: 'PENDING',
      note: input.note?.trim() ? input.note : null,
    })
    .select('id')
    .single<{ id: string }>();
  if (error) return fail(`顧客の登録に失敗しました: ${error.message}`);

  const [{ error: goalError }, { error: assignError }] = await Promise.all([
    supabase.from('customer_goals').insert({
      customer_id: customer.id,
      goal_type: input.goalType,
      start_score: input.startScore,
      target_score: input.targetScore,
      start_distance: input.startDistance,
      target_distance: input.targetDistance,
      approval_status: 'PENDING',
      effective_from: input.programStartDate,
      created_by: session.user.id,
    }),
    supabase.from('customer_coach_assignments').insert({
      customer_id: customer.id,
      coach_id: input.coachId,
      start_date: input.programStartDate,
      created_by: session.user.id,
    }),
  ]);
  if (goalError) return fail(`目標の登録に失敗しました: ${goalError.message}`);
  if (assignError) return fail(`担当の登録に失敗しました: ${assignError.message}`);

  revalidatePath('/admin/customers');
  revalidatePath('/admin/approvals');
  return ok(`${input.name}さんを登録しました。目標の承認をお願いします`);
}

const goalDecisionSchema = z.object({
  customerId: z.string().uuid(),
  decision: z.enum(['APPROVED', 'REJECTED']),
});

export async function decideGoalAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = goalDecisionSchema.safeParse({
    customerId: formData.get('customerId'),
    decision: formData.get('decision'),
  });
  if (!parsed.success) return fail('入力内容を確認してください');

  const supabase = await createSupabaseServerClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('customers')
    .update({
      goal_approval_status: parsed.data.decision,
      goal_approved_by: session.user.id,
      goal_approved_at: parsed.data.decision === 'APPROVED' ? now : null,
    })
    .eq('id', parsed.data.customerId);
  if (error) return fail(`目標の承認に失敗しました: ${error.message}`);

  await supabase
    .from('customer_goals')
    .update({ approval_status: parsed.data.decision, approved_by: session.user.id, approved_at: now })
    .eq('customer_id', parsed.data.customerId)
    .is('superseded_at', null);

  revalidatePath('/admin/approvals');
  revalidatePath('/admin/customers');
  return ok(parsed.data.decision === 'APPROVED' ? '目標を承認しました' : '目標を差し戻しました');
}

const customerStatusSchema = z.object({
  customerId: z.string().uuid(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'COMPLETED', 'CANCELLED']),
  cancelReasonCode: z.enum(['SELF', 'PERFORMANCE', 'OTHER']).optional().or(z.literal('')),
  suspendedDays: z.coerce.number().int().min(0).max(3650).optional(),
});

export async function updateCustomerStatusAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = customerStatusSchema.safeParse({
    customerId: formData.get('customerId'),
    status: formData.get('status'),
    cancelReasonCode: formData.get('cancelReasonCode') ?? '',
    suspendedDays: formData.get('suspendedDays') ?? 0,
  });
  if (!parsed.success) return fail('入力内容を確認してください');
  if (parsed.data.status === 'CANCELLED' && !parsed.data.cancelReasonCode) {
    return fail('解約理由を選択してください (評価分母の扱いが変わります)');
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('customers')
    .update({
      status: parsed.data.status,
      status_changed_on: todayInJst(),
      cancel_reason_code: parsed.data.cancelReasonCode || null,
      suspended_days: parsed.data.suspendedDays ?? 0,
    })
    .eq('id', parsed.data.customerId);
  if (error) return fail(`ステータスの更新に失敗しました: ${error.message}`);

  revalidatePath('/admin/customers');
  return ok('顧客ステータスを更新しました');
}

const reassignSchema = z.object({
  customerId: z.string().uuid(),
  coachId: z.string().uuid('担当コーチを選択してください'),
  reason: z.string().max(200).optional(),
});

export async function reassignCoachAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = reassignSchema.safeParse({
    customerId: formData.get('customerId'),
    coachId: formData.get('coachId'),
    reason: formData.get('reason') ?? '',
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? '入力内容を確認してください');

  const supabase = await createSupabaseServerClient();
  const today = todayInJst();

  // 履歴を閉じてから新担当を追加する (customers.current_coach_id だけを書き換えない)
  const { error: closeError } = await supabase
    .from('customer_coach_assignments')
    .update({ end_date: today })
    .eq('customer_id', parsed.data.customerId)
    .is('end_date', null);
  if (closeError) return fail(`担当履歴の更新に失敗しました: ${closeError.message}`);

  const { error: insertError } = await supabase.from('customer_coach_assignments').insert({
    customer_id: parsed.data.customerId,
    coach_id: parsed.data.coachId,
    start_date: today,
    reason: parsed.data.reason?.trim() ? parsed.data.reason : null,
    created_by: session.user.id,
  });
  if (insertError) return fail(`担当の追加に失敗しました: ${insertError.message}`);

  const { error: updateError } = await supabase
    .from('customers')
    .update({ current_coach_id: parsed.data.coachId })
    .eq('id', parsed.data.customerId);
  if (updateError) return fail(`顧客の更新に失敗しました: ${updateError.message}`);

  revalidatePath('/admin/customers');
  return ok('担当コーチを変更しました');
}

const behaviorSchema = z.object({
  coachId: z.string().uuid(),
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  status: z.enum(['OK', 'WARNING', 'NG']),
  note: z.string().max(300).optional(),
});

export async function setBehaviorStatusAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = behaviorSchema.safeParse({
    coachId: formData.get('coachId'),
    yearMonth: formData.get('yearMonth') ?? yearMonthOf(todayInJst()),
    status: formData.get('status'),
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) return fail('入力内容を確認してください');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('coach_behavior_statuses').upsert(
    {
      coach_id: parsed.data.coachId,
      year_month: parsed.data.yearMonth,
      status: parsed.data.status,
      note: parsed.data.note?.trim() ? parsed.data.note : null,
      set_by: session.user.id,
    },
    { onConflict: 'coach_id,year_month' },
  );
  if (error) return fail(`行動ルールの更新に失敗しました: ${error.message}`);

  revalidatePath('/admin');
  return ok('行動ルールを更新しました');
}

const requirementSchema = z.object({
  coachId: z.string().uuid(),
  requirementCode: z.string().min(1),
  label: z.string().min(1),
  achievedCount: z.coerce.number().int().min(0).max(100),
  approved: z.enum(['true', 'false']),
});

export async function setRequirementCheckAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = requirementSchema.safeParse({
    coachId: formData.get('coachId'),
    requirementCode: formData.get('requirementCode'),
    label: formData.get('label'),
    achievedCount: formData.get('achievedCount'),
    approved: formData.get('approved') ?? 'false',
  });
  if (!parsed.success) return fail('入力内容を確認してください');

  const supabase = await createSupabaseServerClient();
  const approved = parsed.data.approved === 'true';
  const { error } = await supabase.from('promotion_requirement_checks').upsert(
    {
      coach_id: parsed.data.coachId,
      requirement_code: parsed.data.requirementCode,
      label: parsed.data.label,
      achieved_count: parsed.data.achievedCount,
      approved_by: approved ? session.user.id : null,
      approved_at: approved ? new Date().toISOString() : null,
    },
    { onConflict: 'coach_id,requirement_code' },
  );
  if (error) return fail(`要件の更新に失敗しました: ${error.message}`);

  revalidatePath('/admin/promotions');
  return ok('上位活動要件を更新しました');
}

const promotionDecisionSchema = z.object({
  reviewId: z.string().uuid(),
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(300).optional(),
});

export async function decidePromotionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = promotionDecisionSchema.safeParse({
    reviewId: formData.get('reviewId'),
    decision: formData.get('decision'),
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) return fail('入力内容を確認してください');

  const supabase = await createSupabaseServerClient();
  const { data: review, error: reviewError } = await supabase
    .from('promotion_reviews')
    .select('id, coach_id, to_level, status')
    .eq('id', parsed.data.reviewId)
    .maybeSingle<{ id: string; coach_id: string; to_level: 'P1' | 'P2' | 'P3' | 'P4' | null; status: string }>();
  if (reviewError || !review) return fail('昇格判定が見つかりません');

  const { error } = await supabase
    .from('promotion_reviews')
    .update({
      status: parsed.data.decision,
      decided_by: session.user.id,
      decided_at: new Date().toISOString(),
      decision_note: parsed.data.note?.trim() ? parsed.data.note : null,
    })
    .eq('id', parsed.data.reviewId);
  if (error) return fail(`昇格判定の更新に失敗しました: ${error.message}`);

  // 承認時のみランクを実際に更新する。単価は評価ルールのランク別単価に合わせる
  if (parsed.data.decision === 'APPROVED' && review.to_level) {
    const rules = await loadEvaluationRules(supabase, { yearMonth: yearMonthOf(todayInJst()) });
    const { error: levelError } = await supabase
      .from('coaches')
      .update({
        professional_level: review.to_level,
        lesson_unit_price: rules.lessonUnitPrice[review.to_level],
      })
      .eq('id', review.coach_id);
    if (levelError) return fail(`ランクの更新に失敗しました: ${levelError.message}`);
  }

  revalidatePath('/admin/promotions');
  revalidatePath('/admin');
  return ok(parsed.data.decision === 'APPROVED' ? '昇格を承認しました' : '昇格を見送りました');
}

const productSchema = z.object({
  id: z.string().uuid().optional().or(z.literal('')),
  code: z.string().min(1, 'コードを入力してください').max(50),
  name: z.string().min(1, '商品名を入力してください').max(100),
  defaultPrice: z.coerce.number().int().min(0),
  incentiveAmount: z.coerce.number().int().min(0),
  isSalesScoreTarget: z.enum(['true', 'false']),
  active: z.enum(['true', 'false']),
  priceIncludesTax: z.enum(['true', 'false']),
  taxRate: z.coerce.number().min(0).max(0.99),
});

export async function upsertProductAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = productSchema.safeParse({
    id: formData.get('id') ?? '',
    code: formData.get('code'),
    name: formData.get('name'),
    defaultPrice: formData.get('defaultPrice'),
    incentiveAmount: formData.get('incentiveAmount'),
    isSalesScoreTarget: formData.get('isSalesScoreTarget') ?? 'true',
    active: formData.get('active') ?? 'true',
    priceIncludesTax: formData.get('priceIncludesTax') ?? 'true',
    taxRate: formData.get('taxRate') ?? 0.1,
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? '入力内容を確認してください');

  const supabase = await createSupabaseServerClient();
  const payload = {
    code: parsed.data.code,
    name: parsed.data.name,
    default_price: parsed.data.defaultPrice,
    incentive_amount: parsed.data.incentiveAmount,
    is_sales_score_target: parsed.data.isSalesScoreTarget === 'true',
    active: parsed.data.active === 'true',
    price_includes_tax: parsed.data.priceIncludesTax === 'true',
    tax_rate: parsed.data.taxRate,
  };

  const { error } = parsed.data.id
    ? await supabase.from('products').update(payload).eq('id', parsed.data.id)
    : await supabase.from('products').insert(payload);
  if (error) return fail(`商品の保存に失敗しました: ${error.message}`);

  revalidatePath('/admin/products');
  return ok('商品マスタを保存しました');
}

const rulesSchema = z.object({
  effectiveFrom: dateOnly,
  note: z.string().max(300).optional(),
  rulesJson: z.string().min(2),
});

export async function createRulesVersionAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = rulesSchema.safeParse({
    effectiveFrom: formData.get('effectiveFrom'),
    note: formData.get('note') ?? '',
    rulesJson: formData.get('rulesJson'),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? '入力内容を確認してください');

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(parsed.data.rulesJson);
  } catch {
    return fail('JSONの形式が正しくありません');
  }

  const supabase = await createSupabaseServerClient();
  const { data: latest } = await supabase
    .from('evaluation_rules')
    .select('version')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>();

  const nextVersion = (latest?.version ?? 0) + 1;
  // version は保存側で採番するため、入力JSONの version は上書きする
  const candidate = { ...(parsedJson as Record<string, unknown>), version: nextVersion, effectiveFrom: parsed.data.effectiveFrom };
  const validated = evaluationRulesSchema.safeParse(candidate);
  if (!validated.success) {
    return fail(`評価ルールの内容が不正です: ${validated.error.issues[0]?.path.join('.')} ${validated.error.issues[0]?.message}`);
  }

  const { error } = await supabase.from('evaluation_rules').insert({
    version: nextVersion,
    effective_from: parsed.data.effectiveFrom,
    rules: validated.data,
    note: parsed.data.note?.trim() ? parsed.data.note : null,
    created_by: session.user.id,
  });
  if (error) return fail(`評価ルールの保存に失敗しました: ${error.message}`);

  revalidatePath('/admin/rules');
  return ok(`評価ルール v${nextVersion} を登録しました (過去の評価は当時のversionのまま保持されます)`);
}

const closeSchema = z.object({ yearMonth: z.string().regex(/^\d{4}-\d{2}$/) });

export async function closeMonthAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = closeSchema.safeParse({ yearMonth: formData.get('yearMonth') });
  if (!parsed.success) return fail('対象月を指定してください');

  const supabase = await createSupabaseServerClient();
  try {
    const results = await closeMonth(supabase, parsed.data.yearMonth);
    const updated = results.filter((r) => !r.skipped).length;
    const candidates = results.filter(
      (r) => r.promotionStatus === 'CANDIDATE' || r.promotionStatus === 'CANDIDATE_REQUIRES_APPROVAL',
    ).length;

    revalidatePath('/admin');
    revalidatePath('/admin/close');
    revalidatePath('/admin/promotions');

    return ok(
      `${parsed.data.yearMonth} の評価を確定しました (更新 ${updated}名 / 変更なし ${results.length - updated}名` +
        (candidates > 0 ? ` / 昇格候補 ${candidates}名` : '') +
        ')',
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : '月次締めに失敗しました');
  }
}

const saleStatusSchema = z.object({
  saleId: z.string().uuid(),
  mode: z.enum(['CANCELLED', 'REFUNDED']),
  refundAmount: z.coerce.number().int().min(0).default(0),
});

export async function updateSaleStatusAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = saleStatusSchema.safeParse({
    saleId: formData.get('saleId'),
    mode: formData.get('mode'),
    refundAmount: formData.get('refundAmount') ?? 0,
  });
  if (!parsed.success) return fail('入力内容を確認してください');

  const supabase = await createSupabaseServerClient();
  try {
    await cancelSale(supabase, parsed.data.saleId, parsed.data.mode, parsed.data.refundAmount, todayInJst());
    revalidatePath('/admin/sales');
    return ok(
      parsed.data.mode === 'CANCELLED'
        ? '売上を取消しました。対象月を再締めすると評価に反映されます'
        : '返金を登録しました。対象月を再締めすると評価に反映されます',
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : '売上の更新に失敗しました');
  }
}

const deleteRecordSchema = z.object({ recordId: z.string().uuid(), customerId: z.string().uuid() });

export async function deletePerformanceRecordAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = deleteRecordSchema.safeParse({
    recordId: formData.get('recordId'),
    customerId: formData.get('customerId'),
  });
  if (!parsed.success) return fail('入力内容を確認してください');

  const supabase = await createSupabaseServerClient();
  // 物理削除はしない。削除後は達成状況を履歴から再計算する
  const { error } = await supabase
    .from('performance_records')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', parsed.data.recordId);
  if (error) return fail(`成果記録の取消に失敗しました: ${error.message}`);

  await refreshCustomerAchievement(supabase, parsed.data.customerId);
  revalidatePath(`/admin/customers/${parsed.data.customerId}`);
  return ok('成果記録を取消しました');
}

// ---------------------------------------------------------------------------
// コーチ管理 (仕様18章: コーチ追加・編集)
// ---------------------------------------------------------------------------

const coachSchema = z.object({
  name: z.string().min(1, '氏名を入力してください').max(100),
  email: z.string().email('メールアドレスの形式が正しくありません'),
  level: z.enum(['P1', 'P2', 'P3', 'P4']),
  hireDate: dateOnly,
});

/** 初回ログイン用のパスワード。管理者が本人へ伝え、本人が変更する前提 */
function generateTemporaryPassword(): string {
  // 紛らわしい文字 (0/O/1/l/I) を除いた文字集合
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  const body = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  // 記号と数字を必ず含める (パスワードポリシー対策)
  return `Eg${body}#7`;
}

/** 登録直後に一度だけ画面へ渡す初回ログイン情報 */
export interface CreatedCoachCredentials {
  email: string;
  password: string;
}

export async function createCoachAction(
  _prev: ActionResult<CreatedCoachCredentials> | null,
  formData: FormData,
): Promise<ActionResult<CreatedCoachCredentials>> {
  await requireAdmin();
  const parsed = coachSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    level: formData.get('level'),
    hireDate: formData.get('hireDate'),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? '入力内容を確認してください');

  const { name, email, level, hireDate } = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: existing } = await supabase.from('users').select('id').ilike('email', email).maybeSingle<{ id: string }>();
  if (existing) return fail('このメールアドレスは既に登録されています');

  // ログインアカウントの作成には管理者権限が要るため、サーバー側のサービスロールで行う
  const admin = createSupabaseServiceClient();
  const password = generateTemporaryPassword();
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role: 'COACH' },
  });
  if (authError || !created.user) {
    return fail(`ログインアカウントの作成に失敗しました: ${authError?.message ?? '不明なエラー'}`);
  }

  // プロフィール行は auth のトリガが作る。ロールと氏名を確定させる
  const { error: profileError } = await admin
    .from('users')
    .update({ name, role: 'COACH' })
    .eq('id', created.user.id);
  if (profileError) return fail(`プロフィールの更新に失敗しました: ${profileError.message}`);

  const rules = await loadEvaluationRules(supabase, { yearMonth: yearMonthOf(todayInJst()) });
  const { error: coachError } = await supabase.from('coaches').insert({
    user_id: created.user.id,
    professional_level: level,
    lesson_unit_price: rules.lessonUnitPrice[level],
    hire_date: hireDate,
  });
  if (coachError) {
    // コーチ行を作れなかった場合、ログインだけ残ると不整合になるため取り消す
    await admin.auth.admin.deleteUser(created.user.id);
    return fail(`コーチの登録に失敗しました: ${coachError.message}`);
  }

  revalidatePath('/admin');
  revalidatePath('/admin/coaches');
  // パスワードは画面で一度だけ表示する。文章に混ぜるとコピーしづらいため個別に返す
  return ok(`${name}さんを登録しました`, { email, password });
}

const coachUpdateSchema = z.object({
  coachId: z.string().uuid(),
  level: z.enum(['P1', 'P2', 'P3', 'P4']),
  lessonUnitPrice: z.coerce.number().int().min(0).max(1_000_000),
  leftOn: z.string().optional(),
});

export async function updateCoachAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = coachUpdateSchema.safeParse({
    coachId: formData.get('coachId'),
    level: formData.get('level'),
    lessonUnitPrice: formData.get('lessonUnitPrice'),
    leftOn: formData.get('leftOn') ?? '',
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? '入力内容を確認してください');
  if (parsed.data.leftOn && !isDateOnly(parsed.data.leftOn)) return fail('退職日の形式が正しくありません');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('coaches')
    .update({
      professional_level: parsed.data.level,
      lesson_unit_price: parsed.data.lessonUnitPrice,
      left_on: parsed.data.leftOn ? parsed.data.leftOn : null,
    })
    .eq('id', parsed.data.coachId);
  if (error) return fail(`コーチ情報の更新に失敗しました: ${error.message}`);

  revalidatePath('/admin');
  revalidatePath(`/admin/coaches/${parsed.data.coachId}`);
  return ok('コーチ情報を更新しました');
}
