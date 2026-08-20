import { judgeCompleteSuccess } from '@/domain/evaluation';
import type { DateOnly, GoalInput } from '@/domain/types';
import { loadEvaluationRules, type Db } from '@/server/repositories/evaluationRepository';
import type { CustomerGoalRow, CustomerRow, PerformanceRecordRow } from '@/lib/supabase/types';
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

  const meetsScore = goal.targetScore !== null && input.score !== null && input.score <= goal.targetScore;
  const meetsDistance = goal.targetDistance !== null && input.distance !== null && input.distance >= goal.targetDistance;
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
      meets_score_goal: meetsScore,
      meets_distance_goal: meetsDistance,
      is_complete_success: isCompleteSuccess,
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
 * 顧客側のキャッシュ列 (最新値・完全達成) を履歴から再計算する。
 * 記録の追加・訂正・削除のいずれの後にも呼べるようにしてある。
 */
export async function refreshCustomerAchievement(db: Db, customerId: string): Promise<void> {
  const { data: records, error } = await db
    .from('performance_records')
    .select('id, customer_id, coach_id, recorded_on, score, distance, is_complete_success, note, created_at')
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .order('recorded_on', { ascending: true })
    .returns<PerformanceRecordRow[]>();
  if (error) throw new Error(`成果履歴の取得に失敗しました: ${error.message}`);

  const rows = records ?? [];
  const achieving = rows.filter((r) => r.is_complete_success);
  const firstAchievement = achieving[0] ?? null;
  const latest = rows[rows.length - 1] ?? null;

  const { error: updateError } = await db
    .from('customers')
    .update({
      latest_score: latest?.score ?? null,
      latest_distance: latest?.distance ?? null,
      // ラチェット: 一度達成したら以降の記録が悪化しても取り消さない
      complete_success: firstAchievement !== null,
      complete_success_at: firstAchievement?.recorded_on ?? null,
    })
    .eq('id', customerId);
  if (updateError) throw new Error(`顧客情報の更新に失敗しました: ${updateError.message}`);
}
