import { effectiveElapsedMonths, endOfMonth, todayInJst, yearMonthOf } from '@/domain/date';
import { isEligibleForEvaluation, type EvaluationRules } from '@/domain/evaluation';
import type { CustomerEvaluationInput, CustomerStatus, GoalType } from '@/domain/types';
import type { CustomerRow } from '@/lib/supabase/types';

export interface CustomerView {
  id: string;
  name: string;
  coachName: string | null;
  programStartDate: string;
  elapsedMonths: number;
  status: CustomerStatus;
  goalType: GoalType;
  goalLabel: string;
  goalApproved: boolean;
  latestLabel: string;
  isEligible: boolean;
  completeSuccess: boolean;
  completeSuccessAt: string | null;
  updatedAt: string;
  /** 対応が必要な顧客を上に出すための並び順キー (小さいほど優先) */
  attentionRank: number;
}

export function goalLabelOf(goalType: GoalType, targetScore: number | null, targetDistance: number | null): string {
  const parts: string[] = [];
  if ((goalType === 'SCORE' || goalType === 'BOTH') && targetScore !== null) parts.push(`スコア ${targetScore}`);
  if ((goalType === 'DISTANCE' || goalType === 'BOTH') && targetDistance !== null) parts.push(`${targetDistance}yd`);
  return parts.join(' / ') || '未設定';
}

function latestLabelOf(row: CustomerRow): string {
  const parts: string[] = [];
  if (row.latest_score !== null) parts.push(`スコア ${row.latest_score}`);
  if (row.latest_distance !== null) parts.push(`${row.latest_distance}yd`);
  return parts.join(' / ') || '未記録';
}

function toEvaluationInput(row: CustomerRow): CustomerEvaluationInput {
  return {
    id: row.id,
    name: row.name,
    programStartDate: row.program_start_date,
    programEndDate: row.program_end_date,
    status: row.status,
    cancelReasonCode: row.cancel_reason_code,
    statusChangedOn: row.status_changed_on,
    goalApprovalStatus: row.goal_approval_status,
    goalType: row.goal_type,
    targetScore: row.target_score,
    targetDistance: row.target_distance,
    completeSuccessAt: row.complete_success_at,
    suspendedDays: row.suspended_days,
  };
}

/**
 * 顧客一覧の表示用モデルを作る。
 * 経過月数・評価対象判定はここで一括計算し、画面側では計算させない。
 */
export function buildCustomerViews(
  rows: CustomerRow[],
  rules: EvaluationRules,
  coachNames: Map<string, string> = new Map(),
): CustomerView[] {
  const today = todayInJst();
  const asOf = endOfMonth(yearMonthOf(today));

  return rows
    .map((row) => {
      const isEligible = isEligibleForEvaluation(toEvaluationInput(row), asOf, rules);
      const needsGoalApproval = row.goal_approval_status !== 'APPROVED';
      const needsFollowUp = isEligible && !row.complete_success;

      return {
        id: row.id,
        name: row.name,
        coachName: row.current_coach_id ? (coachNames.get(row.current_coach_id) ?? null) : null,
        programStartDate: row.program_start_date,
        elapsedMonths: effectiveElapsedMonths(row.program_start_date, today, row.suspended_days),
        status: row.status,
        goalType: row.goal_type,
        goalLabel: goalLabelOf(row.goal_type, row.target_score, row.target_distance),
        goalApproved: row.goal_approval_status === 'APPROVED',
        latestLabel: latestLabelOf(row),
        isEligible,
        completeSuccess: row.complete_success,
        completeSuccessAt: row.complete_success_at,
        updatedAt: row.updated_at,
        // 目標未承認 → 評価対象で未達成 → その他 の順に出す
        attentionRank: needsGoalApproval ? 0 : needsFollowUp ? 1 : 2,
      };
    })
    .sort((a, b) => a.attentionRank - b.attentionRank || a.updatedAt.localeCompare(b.updatedAt));
}

export const CUSTOMER_VIEW_COLUMNS =
  'id, name, current_coach_id, program_start_date, program_end_date, status, status_changed_on, ' +
  'cancel_reason_code, suspended_days, start_score, target_score, start_distance, target_distance, ' +
  'goal_type, goal_approval_status, goal_approved_at, latest_score, latest_distance, ' +
  'complete_success, complete_success_at, note, updated_at';
