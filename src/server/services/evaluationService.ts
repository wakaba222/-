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
  loadEvaluationCustomersByCoach,
  loadEvaluationRules,
  loadEvaluationSales,
  loadEvaluationSalesByCoach,
  loadSnapshotSummaries,
  loadSnapshotSummariesByCoach,
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
 * 1コーチ分の評価に必要な入力データ。
 * 単体取得(getCoachOverview)と一括取得(getCoachOverviews)で同じ形にそろえ、
 * 組み立て処理を共通化する。これにより一覧と個票で数字がずれない。
 */
export interface CoachOverviewSources {
  rules: EvaluationRules;
  customers: CustomerEvaluationInput[];
  sales: SaleEvaluationInput[];
  trendSnapshots: SnapshotSummary[];
  behaviorStatus: BehaviorStatus;
  /** 承認済みの昇格要件のみを集計したもの */
  requirementCounts: Record<string, number>;
  lessonCount: number | null;
}

/** 承認済みの要件だけを数える (ADMIN承認前の自己申告を昇格条件に含めない) */
function toRequirementCounts(rows: RequirementCheckRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.approved_at !== null) counts[row.requirement_code] = row.achieved_count;
  }
  return counts;
}

/**
 * 取得済みデータから CoachOverview を組み立てる純粋な処理 (I/O を持たない)。
 * 単体取得でも一括取得でもここを通るため、計算経路は 1 本に保たれる。
 */
export function assembleCoachOverview(
  coachId: string,
  level: ProfessionalLevel,
  yearMonth: YearMonth,
  sources: CoachOverviewSources,
): CoachOverview {
  const { rules, customers, sales, trendSnapshots, behaviorStatus, requirementCounts, lessonCount } = sources;

  const evaluation = evaluateCoachMonth({ coachId, level, yearMonth, customers, sales }, rules);
  // 「あと○名で90%」の基準はルールのアンカーから導出する (コードに閾値を持たない)
  const targetRate = standardRateOf(rules.customerSuccess.longTerm.anchors);

  const monthly = aggregateSales(sales, monthPeriod(yearMonth), rules);
  const quarterly = aggregateSales(sales, rollingPeriod(yearMonth, EVALUATION_WINDOW_MONTHS), rules);
  const annual = aggregateSales(sales, yearToDatePeriod(yearMonth), rules);

  // 昇格判定は確定済みスナップショットのみで行う (速報値では判定しない)
  const promotionSnapshots = trendSnapshots.slice(-EVALUATION_WINDOW_MONTHS);
  const promotion = evaluatePromotion(
    { level, snapshots: promotionSnapshots, behaviorStatus, requirementCounts },
    rules,
  );
  const bonus = calcQuarterlyBonus(promotionSnapshots, rules);

  const compensation = estimateMonthlyCompensation(
    level,
    lessonCount,
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
  // ルール取得も含めて並列化する (直列に待つと往復回数ぶん遅くなる)
  const [rules, customers, sales, trendSnapshots, behaviorRow, checkRows, lessonRow] = await Promise.all([
    loadEvaluationRules(db, { yearMonth }),
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

  return assembleCoachOverview(coachId, level, yearMonth, {
    rules,
    customers,
    sales,
    trendSnapshots,
    behaviorStatus: behaviorRow.data?.status ?? 'OK',
    requirementCounts: toRequirementCounts(checkRows.data ?? []),
    lessonCount: lessonRow.data?.lesson_count ?? null,
  });
}

/**
 * 複数コーチ分をまとめて取得する (ADMIN の一覧用)。
 *
 * コーチ数ぶん getCoachOverview を回すと 1コーチあたり 8 往復かかり、
 * 人数に比例して遅くなる。ここではテーブルごとに 1 回だけ問い合わせ、
 * 組み立ては単体取得と同じ assembleCoachOverview に渡す。
 * 取得方法を変えただけなので、評価結果は単体取得と一致する。
 */
export async function getCoachOverviews(
  db: Db,
  coaches: { id: string; level: ProfessionalLevel }[],
  yearMonth: YearMonth = currentYearMonth(),
): Promise<Map<string, CoachOverview>> {
  const result = new Map<string, CoachOverview>();
  if (coaches.length === 0) return result;

  const coachIds = coaches.map((c) => c.id);

  const [rules, customersByCoach, salesByCoach, snapshotsByCoach, behaviorRows, checkRows, lessonRows] =
    await Promise.all([
      loadEvaluationRules(db, { yearMonth }),
      loadEvaluationCustomersByCoach(db, coachIds),
      loadEvaluationSalesByCoach(db, coachIds, yearMonth),
      loadSnapshotSummariesByCoach(db, coachIds, yearMonth, TREND_MONTHS),
      db
        .from('coach_behavior_statuses')
        .select('id, coach_id, year_month, status, note')
        .in('coach_id', coachIds)
        .lte('year_month', yearMonth)
        .order('coach_id', { ascending: true })
        .order('year_month', { ascending: false })
        .returns<BehaviorStatusRow[]>(),
      db
        .from('promotion_requirement_checks')
        .select('id, coach_id, requirement_code, label, achieved_count, approved_at')
        .in('coach_id', coachIds)
        .returns<RequirementCheckRow[]>(),
      db
        .from('monthly_lesson_counts')
        .select('id, coach_id, year_month, lesson_count')
        .in('coach_id', coachIds)
        .eq('year_month', yearMonth)
        .returns<LessonCountRow[]>(),
    ]);

  // 単体取得と同じく「対象年月以前で最も新しい 1 件」を採用する
  const behaviorByCoach = new Map<string, BehaviorStatus>();
  for (const row of behaviorRows.data ?? []) {
    if (!behaviorByCoach.has(row.coach_id)) behaviorByCoach.set(row.coach_id, row.status);
  }

  const checksByCoach = new Map<string, RequirementCheckRow[]>();
  for (const row of checkRows.data ?? []) {
    const list = checksByCoach.get(row.coach_id) ?? [];
    list.push(row);
    checksByCoach.set(row.coach_id, list);
  }

  const lessonByCoach = new Map<string, number>();
  for (const row of lessonRows.data ?? []) lessonByCoach.set(row.coach_id, row.lesson_count);

  for (const coach of coaches) {
    result.set(
      coach.id,
      assembleCoachOverview(coach.id, coach.level, yearMonth, {
        rules,
        customers: customersByCoach.get(coach.id) ?? [],
        sales: salesByCoach.get(coach.id) ?? [],
        trendSnapshots: snapshotsByCoach.get(coach.id) ?? [],
        behaviorStatus: behaviorByCoach.get(coach.id) ?? 'OK',
        requirementCounts: toRequirementCounts(checksByCoach.get(coach.id) ?? []),
        lessonCount: lessonByCoach.get(coach.id) ?? null,
      }),
    );
  }

  return result;
}
