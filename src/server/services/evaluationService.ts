import {
  aggregateSales,
  calcQuarterlyBonus,
  countNeededForRate,
  estimateMonthlyCompensation,
  evaluateCoachMonth,
  evaluatePromotion,
  monthPeriod,
  rollingPeriod,
  standardRateOf,
  yearToDatePeriod,
  type CompensationEstimate,
  type EvaluationRules,
} from '@/domain/evaluation';
import { yearMonthOf, todayInJst } from '@/domain/date';
import type {
  BehaviorStatus,
  BonusResult,
  CoachEvaluationResult,
  CustomerEvaluationInput,
  ProfessionalLevel,
  PromotionResult,
  SaleEvaluationInput,
  SnapshotSummary,
  YearMonth,
} from '@/domain/types';
import {
  loadEvaluationCustomers,
  loadEvaluationRules,
  loadEvaluationSales,
  loadSnapshotSummaries,
  type Db,
} from '@/server/repositories/evaluationRepository';
import type { BehaviorStatusRow, LessonCountRow, RequirementCheckRow } from '@/lib/supabase/types';

/** 昇格・ボーナス判定に使う月数 */
const EVALUATION_WINDOW_MONTHS = 3;
/** ダッシュボードの推移グラフに出す月数 */
const TREND_MONTHS = 6;

export interface SalesBreakdown {
  monthly: number;
  quarterly: number;
  annual: number;
  coachSnsMonthly: number;
  incentiveMonthly: number;
}

export interface CoachOverview {
  coachId: string;
  yearMonth: YearMonth;
  level: ProfessionalLevel;
  rules: EvaluationRules;
  evaluation: CoachEvaluationResult;
  salesBreakdown: SalesBreakdown;
  snapshots: SnapshotSummary[];
  promotion: PromotionResult;
  bonus: BonusResult;
  compensation: CompensationEstimate;
  behaviorStatus: BehaviorStatus;
  /** 完全成果率90%まであと何名か */
  customersNeededForTarget: number;
  targetRate: number;
  customers: CustomerEvaluationInput[];
  sales: SaleEvaluationInput[];
}

export function currentYearMonth(): YearMonth {
  return yearMonthOf(todayInJst());
}

/**
 * コーチ1名分のダッシュボード用データを組み立てる。
 *
 * 「現在の速報値」も月次確定値と同じ evaluateCoachMonth を通すため、
 * 画面の数字とスナップショットの数字が食い違わない。
 */
export async function getCoachOverview(
  db: Db,
  coachId: string,
  level: ProfessionalLevel,
  yearMonth: YearMonth = currentYearMonth(),
): Promise<CoachOverview> {
  const rules = await loadEvaluationRules(db, { yearMonth });

  const [customers, sales, trendSnapshots, behaviorRow, checkRows, lessonRow] = await Promise.all([
    loadEvaluationCustomers(db, coachId),
    loadEvaluationSales(db, coachId, yearMonth),
    loadSnapshotSummaries(db, coachId, yearMonth, TREND_MONTHS),
    db
      .from('coach_behavior_statuses')
      .select('id, coach_id, year_month, status, note')
      .eq('coach_id', coachId)
      .lte('year_month', yearMonth)
      .order('year_month', { ascending: false })
      .limit(1)
      .maybeSingle<BehaviorStatusRow>(),
    db
      .from('promotion_requirement_checks')
      .select('id, coach_id, requirement_code, label, achieved_count, approved_at')
      .eq('coach_id', coachId)
      .returns<RequirementCheckRow[]>(),
    db
      .from('monthly_lesson_counts')
      .select('id, coach_id, year_month, lesson_count')
      .eq('coach_id', coachId)
      .eq('year_month', yearMonth)
      .maybeSingle<LessonCountRow>(),
  ]);

  const evaluation = evaluateCoachMonth({ coachId, level, yearMonth, customers, sales }, rules);
  // 「あと○名で90%」の基準はルールのアンカーから導出する (コードに閾値を持たない)
  const targetRate = standardRateOf(rules.customerSuccess.longTerm.anchors);

  const monthly = aggregateSales(sales, monthPeriod(yearMonth), rules);
  const quarterly = aggregateSales(sales, rollingPeriod(yearMonth, EVALUATION_WINDOW_MONTHS), rules);
  const annual = aggregateSales(sales, yearToDatePeriod(yearMonth), rules);

  const behaviorStatus: BehaviorStatus = behaviorRow.data?.status ?? 'OK';

  // 承認済みの要件のみカウントする (ADMIN承認前の自己申告を昇格条件に含めない)
  const requirementCounts: Record<string, number> = {};
  for (const row of checkRows.data ?? []) {
    if (row.approved_at !== null) requirementCounts[row.requirement_code] = row.achieved_count;
  }

  // 昇格判定は確定済みスナップショットのみで行う (速報値では判定しない)
  const promotionSnapshots = trendSnapshots.slice(-EVALUATION_WINDOW_MONTHS);
  const promotion = evaluatePromotion(
    { level, snapshots: promotionSnapshots, behaviorStatus, requirementCounts },
    rules,
  );
  const bonus = calcQuarterlyBonus(promotionSnapshots, rules);

  const compensation = estimateMonthlyCompensation(
    level,
    lessonRow.data?.lesson_count ?? null,
    monthly.incentiveTotal,
    bonus.amount,
    rules,
  );

  return {
    coachId,
    yearMonth,
    level,
    rules,
    evaluation,
    salesBreakdown: {
      monthly: monthly.amount,
      quarterly: quarterly.amount,
      annual: annual.amount,
      coachSnsMonthly: monthly.coachSnsAmount,
      incentiveMonthly: monthly.incentiveTotal,
    },
    snapshots: trendSnapshots,
    promotion,
    bonus,
    compensation,
    behaviorStatus,
    customersNeededForTarget: countNeededForRate(
      targetRate,
      evaluation.customerSuccess.longTerm.achievedCount,
      evaluation.customerSuccess.longTerm.targetCount,
    ),
    targetRate,
    customers,
    sales,
  };
}
