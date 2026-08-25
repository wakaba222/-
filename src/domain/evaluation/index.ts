import type { CoachEvaluationInput, CoachEvaluationResult } from '../types';
import { calcCustomerSuccess } from './customerSuccess';
import { calcProfessionalScore } from './professionalScore';
import { calcSalesScore } from './sales';
import type { EvaluationRules } from './rules';

export * from './interpolate';
export * from './rules';
export * from './eligibility';
export * from './customerSuccess';
export * from './sales';
export * from './professionalScore';
export * from './bonus';
export * from './promotion';

/**
 * コーチ1名・1ヶ月分の評価。
 *
 * リアルタイム表示 (ダッシュボード) と月次確定 (スナップショット) の両方が
 * 必ずこの関数を通るため、速報値と確定値の計算式がズレることがない。
 */
export function evaluateCoachMonth(input: CoachEvaluationInput, rules: EvaluationRules): CoachEvaluationResult {
  const customerSuccess = calcCustomerSuccess(input.customers, input.yearMonth, rules);
  const sales = calcSalesScore(input.sales, input.yearMonth, rules);
  const professional = calcProfessionalScore(customerSuccess, sales, rules);

  return {
    coachId: input.coachId,
    yearMonth: input.yearMonth,
    customerSuccess,
    sales,
    professional,
  };
}
export * from './attribution';
export * from './compensation';
export * from './milestones';
