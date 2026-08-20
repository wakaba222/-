import type { CustomerSuccessResult, ProfessionalScoreResult, SalesResult } from '../types';
import { round1 } from './interpolate';
import type { EvaluationRules } from './rules';

export function bandOf(score: number, rules: EvaluationRules): string {
  // 下限の降順に見て、最初に該当した区分を採用する。
  // 区分の境界に隙間があっても、スコアより上の区分が選ばれることはない。
  const descending = [...rules.scoreBands].sort((a, b) => b.min - a.min);
  const band = descending.find((b) => score >= b.min);
  return band?.label ?? descending[descending.length - 1]?.label ?? '';
}

/** Professional Score の満点 (顧客成果の上限 + 売上の上限)。表示のスケールに使う */
export function maxProfessionalScore(rules: EvaluationRules): number {
  return rules.customerSuccess.longTerm.max + rules.customerSuccess.shortTerm.max + rules.sales.max;
}

/**
 * 「通常期待水準」の達成率 (既定 90%)。
 * アンカーの最大点の1つ手前を通常基準とみなす。
 * ダッシュボードの「あと○名で90%」の逆算に使う。
 */
export function standardRateOf(anchors: readonly (readonly [number, number])[]): number {
  const sorted = [...anchors].sort((a, b) => a[0] - b[0]);
  return sorted[sorted.length - 2]?.[0] ?? sorted[sorted.length - 1]?.[0] ?? 0;
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
