import { judgeCompleteSuccess } from '@/domain/evaluation';
import type { DateOnly, GoalInput } from '@/domain/types';
import { loadEvaluationRules, type Db } from '@/server/repositories/evaluationRepository';
import type { CustomerGoalRow, CustomerRow } from '@/lib/supabase/types';
import { yearMonthOf } from '@/domain/date';

export interface RecordPerformanceInput {
  customerId: string;
  recordedOn: DateOnly;
  score: number | null;
  distance: number | null;
  note: string | null;
  coachId: string | null;
  createdBy: string;
}

export interface RecordPerformanceResult {
  recordId: string;
  isCompleteSuccess: boolean;
  /** この登録によって初めて完全達成になった場合 true */
  becameCompleteSuccess: boolean;
}

/**
 * 成果記録の登録。
 *
 * 履歴は上書きせず追加のみ。完全達成日は「達成した記録のうち最も古い日付」を採用するため、
 * 過去日付での後追い登録でも達成日が正しくなる。
 */
export async function recordPerformance(db: Db, input: RecordPerformanceInput): Promise<RecordPerformanceResult> {
  const rules = await loadEvaluationRules(db, { yearMonth: yearMonthOf(input.recordedOn) });

  const { data: customer, error: customerError } = await db
    .from('customers')
    .select('id, goal_type, target_score, target_distance, complete_success, complete_success_at, current_coach_id')
    .eq('id', input.customerId)
    .maybeSingle<Pick<CustomerRow, 'id' | 'goal_type' | 'target_score' | 'target_distance' | 'complete_success' | 'complete_success_at' | 'current_coach_id'>>();
  if (customerError) throw new Error(`顧客の取得に失敗しました: ${customerError.message}`);
  if (!customer) throw new Error('顧客が見つかりません');

  // 記録日時点で有効だった目標に対して判定する (後の目標変更で過去の達成が覆らないようにする)
  const { data: goalRows } = await db
    .from('customer_goals')
    .select('id, customer_id, goal_type, start_score, target_score, start_distance, target_distance, approval_status, effective_from, superseded_at')
    .eq('customer_id', input.customerId)
    .lte('effective_from', input.recordedOn)
    .order('effective_from', { ascending: false })
    .limit(1)
    .returns<CustomerGoalRow[]>();

  const goalRow = goalRows?.[0];
  const goal: GoalInput = goalRow
    ? { goalType: goalRow.goal_type, targetScore: goalRow.target_score, targetDistance: goalRow.target_distance }
    : { goalType: customer.goal_type, targetScore: customer.target_score, targetDistance: customer.target_distance };

  // 実際に保存される達成フラグは DB のトリガが確定させる (クライアントの申告を信用しない)。
  // ここでの判定は登録結果のメッセージ表示にのみ使う。
  const isCompleteSuccess = judgeCompleteSuccess({ score: input.score, distance: input.distance }, goal, rules);

  const { data: inserted, error: insertError } = await db
    .from('performance_records')
    .insert({
      customer_id: input.customerId,
      coach_id: input.coachId ?? customer.current_coach_id,
      goal_id: goalRow?.id ?? null,
      recorded_on: input.recordedOn,
      score: input.score,
      distance: input.distance,
      note: input.note,
      created_by: input.createdBy,
    })
    .select('id')
    .single<{ id: string }>();
  if (insertError) throw new Error(`成果の登録に失敗しました: ${insertError.message}`);

  await refreshCustomerAchievement(db, input.customerId);

  return {
    recordId: inserted.id,
    isCompleteSuccess,
    becameCompleteSuccess: isCompleteSuccess && !customer.complete_success,
  };
}

/**
 * 顧客側のキャッシュ列 (最新値・完全達成) を成果履歴から再計算する。
 *
 * customers への直接 UPDATE は ADMIN しか許可していないため、
 * DB 側の security definer 関数を通して更新する。
 * 記録の追加・訂正・取消のいずれの後にも呼べる。
 */
export async function refreshCustomerAchievement(db: Db, customerId: string): Promise<void> {
  const { error } = await db.rpc('refresh_customer_achievement', { p_customer_id: customerId });
  if (error) throw new Error(`顧客情報の更新に失敗しました: ${error.message}`);
}
