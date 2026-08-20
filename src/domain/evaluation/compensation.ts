import type { ProfessionalLevel } from '../types';
import type { EvaluationRules } from './rules';

export interface CompensationEstimate {
  lessonCount: number | null;
  lessonUnitPrice: number;
  lessonReward: number | null;
  incentiveTotal: number;
  bonusAmount: number;
  /** レッスン数が未入力の場合はレッスン報酬を含まない概算になる */
  total: number;
  isPartial: boolean;
}

/**
 * 月間想定報酬 (仕様39章)。
 * あくまで参考値であり、実際の給与支払システムとは分離する。
 */
export function estimateMonthlyCompensation(
  level: ProfessionalLevel,
  lessonCount: number | null,
  incentiveTotal: number,
  bonusAmount: number,
  rules: EvaluationRules,
): CompensationEstimate {
  const unitPrice = rules.lessonUnitPrice[level];
  const lessonReward = lessonCount === null ? null : lessonCount * unitPrice;

  return {
    lessonCount,
    lessonUnitPrice: unitPrice,
    lessonReward,
    incentiveTotal,
    bonusAmount,
    total: (lessonReward ?? 0) + incentiveTotal + bonusAmount,
    isPartial: lessonCount === null,
  };
}
