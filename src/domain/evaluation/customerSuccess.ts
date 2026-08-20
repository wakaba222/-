import { addMonthsToYearMonth, endOfMonth, startOfMonth, type YearMonth } from '../date';
import type { CustomerEvaluationInput, CustomerSuccessResult, RateResult } from '../types';
import { isEligibleForEvaluation } from './eligibility';
import { interpolateScore, round1 } from './interpolate';
import type { EvaluationRules } from './rules';

const NOT_EVALUABLE: RateResult = {
  rate: null,
  targetCount: 0,
  achievedCount: 0,
  score: null,
  evaluable: false,
};

/**
 * 長期: 完全成果率 (仕様10-A)
 * 分母 = 評価対象顧客 (開始4ヶ月経過以降) / 分子 = 期末までに完全達成した顧客
 */
export function calcLongTerm(
  customers: CustomerEvaluationInput[],
  yearMonth: YearMonth,
  rules: EvaluationRules,
): RateResult {
  const asOf = endOfMonth(yearMonth);
  const targets = customers.filter((c) => isEligibleForEvaluation(c, asOf, rules));

  // 評価対象0人は 0点ではなく N/A (仕様36章: 0除算を起こさない)
  if (targets.length === 0) return NOT_EVALUABLE;

  const achieved = targets.filter((c) => c.completeSuccessAt !== null && c.completeSuccessAt <= asOf);
  const rate = achieved.length / targets.length;

  return {
    rate,
    targetCount: targets.length,
    achievedCount: achieved.length,
    score: round1(interpolateScore(rate, rules.customerSuccess.longTerm.anchors, rules.customerSuccess.longTerm.max)),
    evaluable: true,
  };
}

/**
 * 短期: 直近Nヶ月成果率 (仕様10-B)
 *
 * 分母 = 期間開始時点で「評価対象かつ未達成」だった顧客 + 期間中に新たに評価対象になった顧客
 * 分子 = そのうち期間中に完全達成した顧客
 *
 * 期間前に達成済みの顧客を分母から外すことで、
 * 「現在も成果を出し続けているか」を測る指標として機能させる。
 */
export function calcShortTerm(
  customers: CustomerEvaluationInput[],
  yearMonth: YearMonth,
  rules: EvaluationRules,
): RateResult {
  const { windowMonths, anchors, max } = rules.customerSuccess.shortTerm;
  const asOf = endOfMonth(yearMonth);
  const windowStart = startOfMonth(addMonthsToYearMonth(yearMonth, -(windowMonths - 1)));

  const targets = customers.filter((c) => {
    if (!isEligibleForEvaluation(c, asOf, rules)) return false;
    const achievedBeforeWindow = c.completeSuccessAt !== null && c.completeSuccessAt < windowStart;
    return !achievedBeforeWindow;
  });

  if (targets.length === 0) return NOT_EVALUABLE;

  const achieved = targets.filter(
    (c) => c.completeSuccessAt !== null && c.completeSuccessAt >= windowStart && c.completeSuccessAt <= asOf,
  );
  const rate = achieved.length / targets.length;

  return {
    rate,
    targetCount: targets.length,
    achievedCount: achieved.length,
    score: round1(interpolateScore(rate, anchors, max)),
    evaluable: true,
  };
}

/** 顧客成果点 = 長期 + 短期 (仕様11章) */
export function calcCustomerSuccess(
  customers: CustomerEvaluationInput[],
  yearMonth: YearMonth,
  rules: EvaluationRules,
): CustomerSuccessResult {
  const longTerm = calcLongTerm(customers, yearMonth, rules);
  const shortTerm = calcShortTerm(customers, yearMonth, rules);

  if (!longTerm.evaluable && !shortTerm.evaluable) {
    return { longTerm, shortTerm, score: null, evaluable: false, partial: false };
  }

  return {
    longTerm,
    shortTerm,
    score: round1((longTerm.score ?? 0) + (shortTerm.score ?? 0)),
    evaluable: true,
    partial: !longTerm.evaluable || !shortTerm.evaluable,
  };
}
