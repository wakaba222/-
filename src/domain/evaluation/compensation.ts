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
 * 実際に使うレッスン単価を決める。
 *
 * 同じランクでも人によって単価が違う運用があるため、
 * コーチ個別の単価 (coaches.lesson_unit_price) を優先する。
 * 未設定 (0 以下 / null) のときだけ、ランク別の既定単価にフォールバックする。
 */
export function resolveLessonUnitPrice(
  coachUnitPrice: number | null | undefined,
  level: ProfessionalLevel,
  rules: EvaluationRules,
): number {
  if (typeof coachUnitPrice === 'number' && coachUnitPrice > 0) return coachUnitPrice;
  return rules.lessonUnitPrice[level];
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
  coachUnitPrice?: number | null,
): CompensationEstimate {
  const unitPrice = resolveLessonUnitPrice(coachUnitPrice, level, rules);
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
