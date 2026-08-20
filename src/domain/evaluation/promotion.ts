import type {
  BehaviorStatus,
  ProfessionalLevel,
  PromotionCondition,
  PromotionResult,
  SnapshotSummary,
} from '../types';
import { nextLevel } from '../types';
import { averageScore } from './bonus';
import { round1 } from './interpolate';
import { promotionRuleKey, type EvaluationRules } from './rules';

export interface PromotionInput {
  level: ProfessionalLevel;
  /** 年月の昇順。最新月が末尾 */
  snapshots: SnapshotSummary[];
  behaviorStatus: BehaviorStatus;
  /** 上位活動要件などの承認済み件数。requirement code をキーにする */
  requirementCounts: Record<string, number>;
}

function formatPercent(rate: number | null): string {
  return rate === null ? 'N/A' : `${Math.round(rate * 1000) / 10}%`;
}

/**
 * 昇格判定 (仕様19章)。全条件の AND。
 *
 * 判定結果だけでなく「条件ごとの現在値と必要値」を返すのが要点。
 * コーチ画面はこの配列をそのまま描画し、「あと何が足りないか」を提示する。
 */
export function evaluatePromotion(input: PromotionInput, rules: EvaluationRules): PromotionResult {
  const { level, snapshots, behaviorStatus, requirementCounts } = input;
  const toLevel = nextLevel(level);

  if (toLevel === null) {
    return {
      fromLevel: level,
      toLevel: null,
      status: 'MAX_LEVEL',
      conditions: [],
      shortfalls: [],
      threeMonthAverage: null,
    };
  }

  const rule = rules.promotion[promotionRuleKey(level, toLevel)];
  if (!rule) {
    return {
      fromLevel: level,
      toLevel,
      status: 'NOT_ELIGIBLE',
      conditions: [],
      shortfalls: [],
      threeMonthAverage: null,
    };
  }

  const ascending = [...snapshots].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const consecutiveWindow = ascending.slice(-rule.consecutiveMonths);
  const averageWindow = ascending.slice(-rule.averageMonths);

  const consecutiveCleared = consecutiveWindow.filter(
    (s) => s.isEvaluable && (s.professionalScore ?? 0) >= rule.consecutiveMinScore,
  ).length;
  const consecutiveMet =
    consecutiveWindow.length === rule.consecutiveMonths && consecutiveCleared === rule.consecutiveMonths;

  const { average } = averageScore(averageWindow);
  const averageMet =
    averageWindow.length === rule.averageMonths && average !== null && average >= rule.averageMinScore;

  const latest = ascending[ascending.length - 1];
  const longTermRate = latest?.longTermSuccessRate ?? null;

  const conditions: PromotionCondition[] = [
    {
      code: 'CONSECUTIVE',
      label: `${rule.consecutiveMonths}ヶ月連続 Professional Score ${rule.consecutiveMinScore}以上`,
      currentLabel: `${consecutiveCleared}/${rule.consecutiveMonths}ヶ月`,
      requiredLabel: `${rule.consecutiveMonths}/${rule.consecutiveMonths}ヶ月`,
      met: consecutiveMet,
    },
    {
      code: 'AVERAGE',
      label: `${rule.averageMonths}ヶ月平均 Professional Score ${rule.averageMinScore}以上`,
      currentLabel: average === null ? 'N/A' : String(average),
      requiredLabel: `${rule.averageMinScore}以上`,
      met: averageMet,
    },
  ];

  if (rule.minLongTermRate !== null) {
    conditions.push({
      code: 'LONG_TERM_RATE',
      label: `完全成果率 ${formatPercent(rule.minLongTermRate)}以上`,
      currentLabel: formatPercent(longTermRate),
      requiredLabel: `${formatPercent(rule.minLongTermRate)}以上`,
      met: longTermRate !== null && longTermRate >= rule.minLongTermRate,
    });
  }

  conditions.push({
    code: 'BEHAVIOR',
    label: 'EAGLE行動ルール',
    currentLabel: behaviorStatus,
    requiredLabel: rule.behaviorStatusAllowed.join(' / '),
    // NG は昇格不可 (仕様20章)
    met: rule.behaviorStatusAllowed.includes(behaviorStatus),
  });

  for (const check of rule.requiredChecks) {
    const achieved = requirementCounts[check.code] ?? 0;
    conditions.push({
      code: check.code,
      label: check.label,
      currentLabel: `${achieved}/${check.requiredCount}`,
      requiredLabel: `${check.requiredCount}件`,
      met: achieved >= check.requiredCount,
    });
  }

  const shortfalls = conditions.filter((c) => !c.met);
  const status: PromotionResult['status'] =
    shortfalls.length > 0 ? 'NOT_ELIGIBLE' : rule.requiresAdminApproval ? 'CANDIDATE_REQUIRES_APPROVAL' : 'CANDIDATE';

  return {
    fromLevel: level,
    toLevel,
    status,
    conditions,
    shortfalls,
    threeMonthAverage: average === null ? null : round1(average),
  };
}
