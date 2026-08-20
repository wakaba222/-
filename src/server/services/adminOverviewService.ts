import type { BehaviorStatus, ProfessionalLevel, PromotionStatus, YearMonth } from '@/domain/types';
import type { CoachWithUserRow } from '@/lib/supabase/types';
import type { Db } from '@/server/repositories/evaluationRepository';
import { currentYearMonth, getCoachOverview } from './evaluationService';

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

  const rows = await Promise.all(
    coaches.map(async (coach) => {
      const overview = await getCoachOverview(db, coach.id, coach.professional_level, yearMonth);
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
    }),
  );

  // スコアの高い順。N/A は末尾に置く
  return rows.sort((a, b) => (b.professionalScore ?? -1) - (a.professionalScore ?? -1));
}
