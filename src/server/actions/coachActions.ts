'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isDateOnly, todayInJst, yearMonthOf } from '@/domain/date';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCoach, requireSession } from '@/server/auth';
import { fail, ok, type ActionResult } from '@/server/actionResult';
import { recordPerformance } from '@/server/services/performanceService';
import { registerSale } from '@/server/services/salesService';
import { formatYen } from '@/lib/format';

const dateOnly = z.string().refine(isDateOnly, '日付の形式が正しくありません');

const numericField = z
  .string()
  .transform((value) => (value.trim() === '' ? null : Number(value)))
  .refine((value) => value === null || Number.isFinite(value), '数値を入力してください');

const performanceSchema = z
  .object({
    customerId: z.string().uuid('顧客を選択してください'),
    recordedOn: dateOnly,
    score: numericField,
    distance: numericField,
    note: z.string().max(500).optional(),
  })
  .refine((value) => value.score !== null || value.distance !== null, {
    message: 'スコアまたは飛距離のいずれかを入力してください',
    path: ['score'],
  });

export async function createPerformanceRecordAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireCoach();
  const parsed = performanceSchema.safeParse({
    customerId: formData.get('customerId'),
    recordedOn: formData.get('recordedOn'),
    score: formData.get('score') ?? '',
    distance: formData.get('distance') ?? '',
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? '入力内容を確認してください');

  // 未来日の成果は受け付けない (誤入力の典型)
  if (parsed.data.recordedOn > todayInJst()) return fail('未来の日付では登録できません');

  const supabase = await createSupabaseServerClient();
  try {
    const result = await recordPerformance(supabase, {
      customerId: parsed.data.customerId,
      recordedOn: parsed.data.recordedOn,
      score: parsed.data.score,
      distance: parsed.data.distance,
      note: parsed.data.note?.trim() ? parsed.data.note : null,
      coachId: session.coach.id,
      createdBy: session.user.id,
    });

    revalidatePath('/coach');
    revalidatePath('/coach/customers');
    revalidatePath(`/coach/customers/${parsed.data.customerId}`);

    return ok(
      result.becameCompleteSuccess
        ? '🎉 目標達成として登録しました'
        : result.isCompleteSuccess
          ? '成果を登録しました (既に達成済みの顧客です)'
          : '成果を登録しました',
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : '成果の登録に失敗しました');
  }
}

const saleSchema = z.object({
  customerId: z.string().uuid().optional().or(z.literal('')),
  productId: z.string().uuid('商品を選択してください'),
  soldOn: dateOnly,
  amount: z.coerce.number().int().min(0, '金額を正しく入力してください'),
  acquisitionSource: z.enum(['EXISTING', 'COACH_SNS', 'COMPANY', 'OTHER']),
  paymentSource: z.enum(['ROBOT_PAYMENT', 'MOSH', 'BANK_TRANSFER', 'MANUAL']),
  note: z.string().max(500).optional(),
});

export async function createSaleAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireCoach();
  const parsed = saleSchema.safeParse({
    customerId: formData.get('customerId') ?? '',
    productId: formData.get('productId'),
    soldOn: formData.get('soldOn'),
    amount: formData.get('amount'),
    acquisitionSource: formData.get('acquisitionSource') ?? 'EXISTING',
    paymentSource: formData.get('paymentSource') ?? 'MANUAL',
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? '入力内容を確認してください');

  const supabase = await createSupabaseServerClient();
  try {
    const result = await registerSale(supabase, {
      coachId: session.coach.id,
      customerId: parsed.data.customerId ? parsed.data.customerId : null,
      productId: parsed.data.productId,
      soldOn: parsed.data.soldOn,
      amount: parsed.data.amount,
      acquisitionSource: parsed.data.acquisitionSource,
      paymentSource: parsed.data.paymentSource,
      note: parsed.data.note?.trim() ? parsed.data.note : null,
      createdBy: session.user.id,
    });

    revalidatePath('/coach');
    revalidatePath('/coach/sales/new');

    return ok(
      result.incentiveAmount > 0
        ? `${result.productName} 成約を登録しました (成約ショットインセン ${formatYen(result.incentiveAmount)})`
        : `${result.productName} の売上を登録しました`,
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : '売上の登録に失敗しました');
  }
}

const lessonCountSchema = z.object({
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/, '対象月の形式が正しくありません'),
  lessonCount: z.coerce.number().int().min(0, '0以上の数を入力してください').max(500),
});

export async function saveLessonCountAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireCoach();
  const parsed = lessonCountSchema.safeParse({
    yearMonth: formData.get('yearMonth') ?? yearMonthOf(todayInJst()),
    lessonCount: formData.get('lessonCount'),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? '入力内容を確認してください');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('monthly_lesson_counts').upsert(
    {
      coach_id: session.coach.id,
      year_month: parsed.data.yearMonth,
      lesson_count: parsed.data.lessonCount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'coach_id,year_month' },
  );
  if (error) return fail(`レッスン数の保存に失敗しました: ${error.message}`);

  revalidatePath('/coach');
  revalidatePath('/coach/compensation');
  return ok('レッスン数を保存しました');
}

export async function markNotificationsReadAction(): Promise<void> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', session.user.id)
    .is('read_at', null);
  revalidatePath('/coach');
  revalidatePath('/admin');
}
