import type { CustomerSuccessResult, ProfessionalScoreResult, SalesResult } from '../types';
import { round1 } from './interpolate';
import type { EvaluationRules } from './rules';

export function bandOf(score: number, rules: EvaluationRules): string {
  const band = rules.scoreBands.find((b) => score >= b.min && score <= b.max);
  // 上限を超える場合は最上位区分に丸める (120点上限のため通常は発生しない)
  return band?.label ?? rules.scoreBands[rules.scoreBands.length - 1]?.label ?? '';
}

/**
 * Professional Score = 顧客成果点 + 売上点 (仕様16章)。
 *
 * 顧客成果が評価不能 (対象顧客0人) の場合は 0点ではなく N/A とする。
 * 売上だけで点が付いてしまうと、顧客を持たないコーチが有利になり制度が壊れるため。
 */
export function calcProfessionalScore(
  customerSuccess: CustomerSuccessResult,
  sales: SalesResult,
  rules: EvaluationRules,
): ProfessionalScoreResult {
  if (!customerSuccess.evaluable) {
    return {
      score: null,
      band: 'N/A',
      evaluable: false,
      reason: '評価対象顧客が0名のため算出不能',
    };
  }

  const score = round1((customerSuccess.score ?? 0) + sales.score);
  return {
    score,
    band: bandOf(score, rules),
    evaluable: true,
    reason: customerSuccess.partial ? '長期または短期の評価対象が0名のため部分評価' : null,
  };
}
