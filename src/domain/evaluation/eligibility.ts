import { effectiveElapsedMonths, elapsedMonths, type DateOnly } from '../date';
import type { CustomerEvaluationInput, GoalInput, PerformanceRecordInput } from '../types';
import type { EvaluationRules } from './rules';

/**
 * 顧客成果の評価対象判定 (仕様7章)。
 *
 * 判定基準は「プログラム期間中かどうか」ではなく「開始から N ヶ月経過したか」。
 * これによりプログラム終了 (COMPLETED) 後も対象に残り、
 * 終了後に達成した顧客が完全成果率へ加算される (仕様9章) 。
 */
export function isEligibleForEvaluation(
  customer: CustomerEvaluationInput,
  asOf: DateOnly,
  rules: EvaluationRules,
): boolean {
  const { eligibility } = rules;

  if (eligibility.requireGoalApproved && customer.goalApprovalStatus !== 'APPROVED') return false;

  // 休会中は判定を止める (再開後に経過月数の続きから評価対象になる)
  if (customer.status === 'SUSPENDED') return false;

  if (customer.status === 'CANCELLED') {
    const reason = customer.cancelReasonCode;
    if (!reason || !eligibility.includeCancelledReasonCodes.includes(reason)) return false;
  }

  return monthsSinceStart(customer, asOf, rules) >= eligibility.minElapsedMonths;
}

/** 評価上の経過月数 (休会分を差し引くかはルール設定に従う) */
export function monthsSinceStart(
  customer: CustomerEvaluationInput,
  asOf: DateOnly,
  rules: EvaluationRules,
): number {
  if (rules.eligibility.countSuspendedMonths) {
    return elapsedMonths(customer.programStartDate, asOf);
  }
  return effectiveElapsedMonths(customer.programStartDate, asOf, customer.suspendedDays);
}

/** スコアは小さいほど良い / 飛距離は大きいほど良い */
export function meetsScoreGoal(score: number | null, target: number | null): boolean {
  if (score === null || target === null) return false;
  return score <= target;
}

export function meetsDistanceGoal(distance: number | null, target: number | null): boolean {
  if (distance === null || target === null) return false;
  return distance >= target;
}

/**
 * 完全達成判定 (仕様8章)。
 * BOTH の扱いはルール設定 (ALL / ANY) に従う。
 */
export function judgeCompleteSuccess(
  record: Pick<PerformanceRecordInput, 'score' | 'distance'>,
  goal: GoalInput,
  rules: EvaluationRules,
): boolean {
  const okScore = meetsScoreGoal(record.score, goal.targetScore);
  const okDistance = meetsDistanceGoal(record.distance, goal.targetDistance);

  switch (goal.goalType) {
    case 'SCORE':
      return okScore;
    case 'DISTANCE':
      return okDistance;
    case 'BOTH':
      return rules.customerSuccess.bothGoalRule === 'ALL' ? okScore && okDistance : okScore || okDistance;
    default:
      return false;
  }
}
