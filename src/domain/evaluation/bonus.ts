import type { BonusResult, SnapshotSummary } from '../types';
import { round1 } from './interpolate';
import type { EvaluationRules } from './rules';

/** 平均算定に必要な最低有効月数。1ヶ月だけで四半期ボーナスを出さないための下限 */
const MIN_MONTHS_FOR_AVERAGE = 2;

export function averageScore(snapshots: SnapshotSummary[]): { average: number | null; monthsUsed: number } {
  const valid = snapshots.filter((s) => s.isEvaluable && s.professionalScore !== null);
  if (valid.length === 0) return { average: null, monthsUsed: 0 };
  const total = valid.reduce((sum, s) => sum + (s.professionalScore ?? 0), 0);
  return { average: round1(total / valid.length), monthsUsed: valid.length };
}

/**
 * 四半期成果ボーナス (仕様18章)。
 * 3ヶ月平均 Professional Score で決定し、単月では判定しない。
 */
export function calcQuarterlyBonus(snapshots: SnapshotSummary[], rules: EvaluationRules): BonusResult {
  const { average, monthsUsed } = averageScore(snapshots);

  if (average === null || monthsUsed < MIN_MONTHS_FOR_AVERAGE) {
    return { amount: 0, average, monthsUsed, status: 'EVALUATION_INSUFFICIENT' };
  }

  const tiers = [...rules.quarterlyBonus].sort((a, b) => b.min - a.min);
  const tier = tiers.find((t) => average >= t.min);

  return { amount: tier?.amount ?? 0, average, monthsUsed, status: 'CALCULATED' };
}
