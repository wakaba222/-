import type { BehaviorStatus, ProfessionalLevel, PromotionStatus, YearMonth } from '@/domain/types';
import type { CoachWithUserRow } from '@/lib/supabase/types';
import type { Db } from '@/server/repositories/evaluationRepository';
import { currentYearMonth, getCoachOverviews } from './evaluationService';

export interface AdminCoachRow {
  coachId: string;
  userId: string;
  name: string;
  level: ProfessionalLevel;
  professionalScore: number | null;
  scoreBand: string;
  customerSuccessScore: number | null;
  longTermRate: number | null;
  shortTermRate: number | null;
  monthlySales: number;
  quarterlySales: number;
  annualSales: number;
  customerCount: number;
  eligibleCount: number;
  achievedCount: number;
  promotionStatus: PromotionStatus;
  promotionShortfalls: number;
  behaviorStatus: BehaviorStatus;
}

export async function loadAdminCoaches(db: Db): Promise<CoachWithUserRow[]> {
  const { data, error } = await db
    .from('coaches')
    .select('id, user_id, professional_level, lesson_unit_price, hire_date, left_on, users(id, name, email, active)')
    .is('deleted_at', null)
    .returns<CoachWithUserRow[]>();
  if (error) throw new Error(`コーチの取得に失敗しました: ${error.message}`);
  return data ?? [];
}

/**
 * ADMIN ダッシュボードの一覧行。
 * 各コーチの評価はコーチ画面と同じ getCoachOverview を通すため、数字が食い違わない。
 */
export async function buildAdminCoachRows(
  db: Db,
  yearMonth: YearMonth = currentYearMonth(),
): Promise<AdminCoachRow[]> {
  const coaches = await loadAdminCoaches(db);

  // コーチ数ぶんの往復を避けるため、必要なテーブルを 1 回ずつまとめて取得する。
  // 組み立てはコーチ画面と同じ処理を通るので、一覧と個票で数字が食い違わない。
  const overviews = await getCoachOverviews(
    db,
    coaches.map((coach) => ({ id: coach.id, level: coach.professional_level })),
    yearMonth,
  );

  const rows = coaches
    .map((coach) => {
      const overview = overviews.get(coach.id);
      if (!overview) return null;
      const { customerSuccess, professional } = overview.evaluation;

      return {
        coachId: coach.id,
        userId: coach.user_id,
        name: coach.users?.name ?? '(名称未設定)',
        level: coach.professional_level,
        professionalScore: professional.score,
        scoreBand: professional.band,
        customerSuccessScore: customerSuccess.score,
        longTermRate: customerSuccess.longTerm.rate,
        shortTermRate: customerSuccess.shortTerm.rate,
        monthlySales: overview.salesBreakdown.monthly,
        quarterlySales: overview.salesBreakdown.quarterly,
        annualSales: overview.salesBreakdown.annual,
        customerCount: overview.customers.length,
        eligibleCount: customerSuccess.longTerm.targetCount,
        achievedCount: customerSuccess.longTerm.achievedCount,
        promotionStatus: overview.promotion.status,
        promotionShortfalls: overview.promotion.shortfalls.length,
        behaviorStatus: overview.behaviorStatus,
      } satisfies AdminCoachRow;
    })
    .filter((row): row is AdminCoachRow => row !== null);

  // スコアの高い順。N/A は末尾に置く
  return rows.sort((a, b) => (b.professionalScore ?? -1) - (a.professionalScore ?? -1));
}
