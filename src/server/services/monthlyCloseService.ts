import { addMonthsToYearMonth, diffDays, effectiveElapsedMonths, endOfMonth, todayInJst } from '@/domain/date';
import { evaluatePromotion, type EvaluationRules } from '@/domain/evaluation';
import type { ProfessionalLevel, PromotionResult, YearMonth } from '@/domain/types';
import { loadEvaluationRules, loadSnapshotSummaries, type Db } from '@/server/repositories/evaluationRepository';
import { getCoachOverview } from './evaluationService';
import type { CoachWithUserRow, EvaluationSnapshotRow } from '@/lib/supabase/types';

const EVALUATION_WINDOW_MONTHS = 3;
/** 評価対象なのに成果更新が滞っている顧客を検知する日数 */
const STALE_CUSTOMER_DAYS = 60;
/** 「あと少しで90%」を通知する残り人数のしきい値 */
const NEAR_TARGET_REMAINING = 2;

export interface CoachCloseResult {
  coachId: string;
  coachName: string;
  yearMonth: YearMonth;
  revision: number;
  professionalScore: number | null;
  isEvaluable: boolean;
  promotionStatus: PromotionResult['status'];
  skipped: boolean;
}

interface CoachRecord {
  id: string;
  userId: string;
  name: string;
  level: ProfessionalLevel;
}

async function loadActiveCoaches(db: Db): Promise<CoachRecord[]> {
  const { data, error } = await db
    .from('coaches')
    .select('id, user_id, professional_level, lesson_unit_price, hire_date, left_on, users(id, name, email, active)')
    .is('deleted_at', null)
    .is('left_on', null)
    .returns<CoachWithUserRow[]>();
  if (error) throw new Error(`コーチの取得に失敗しました: ${error.message}`);

  return (data ?? [])
    .filter((row) => row.users?.active !== false)
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.users?.name ?? '(名称未設定)',
      level: row.professional_level,
    }));
}

/**
 * 月次締め (仕様27章)。
 *
 * スナップショットは上書きせず revision を増やして追加する。
 * 返金や成果訂正で数字が変わっても、過去に確定した評価結果は監査可能な形で残る。
 */
export async function closeMonth(db: Db, yearMonth: YearMonth): Promise<CoachCloseResult[]> {
  const rules = await loadEvaluationRules(db, { yearMonth });
  const coaches = await loadActiveCoaches(db);
  const results: CoachCloseResult[] = [];

  for (const coach of coaches) {
    const overview = await getCoachOverview(db, coach.id, coach.level, yearMonth);
    const { customerSuccess, sales, professional } = overview.evaluation;

    const { data: existing, error: existingError } = await db
      .from('evaluation_snapshots')
      .select('*')
      .eq('coach_id', coach.id)
      .eq('year_month', yearMonth)
      .order('revision', { ascending: false })
      .limit(1)
      .returns<EvaluationSnapshotRow[]>();
    if (existingError) throw new Error(`既存スナップショットの取得に失敗しました: ${existingError.message}`);

    const latest = existing?.[0];
    const nextRevision = (latest?.revision ?? 0) + 1;

    const payload = {
      coach_id: coach.id,
      year_month: yearMonth,
      revision: nextRevision,
      is_evaluable: professional.evaluable,
      long_term_success_rate: customerSuccess.longTerm.rate,
      long_term_target_count: customerSuccess.longTerm.targetCount,
      long_term_achieved_count: customerSuccess.longTerm.achievedCount,
      long_term_score: customerSuccess.longTerm.score,
      short_term_success_rate: customerSuccess.shortTerm.rate,
      short_term_target_count: customerSuccess.shortTerm.targetCount,
      short_term_achieved_count: customerSuccess.shortTerm.achievedCount,
      short_term_score: customerSuccess.shortTerm.score,
      customer_success_score: customerSuccess.score,
      sales_amount: sales.amount,
      sales_score: sales.score,
      professional_score: professional.score,
      score_band: professional.band,
      current_rank: coach.level,
      evaluation_rule_version: rules.version,
    };

    // 数字が1つも変わっていない再締めは revision を増やさない (履歴のノイズを避ける)
    const unchanged =
      latest !== undefined &&
      latest.professional_score === payload.professional_score &&
      latest.customer_success_score === payload.customer_success_score &&
      Number(latest.sales_amount) === payload.sales_amount &&
      latest.long_term_achieved_count === payload.long_term_achieved_count &&
      latest.short_term_achieved_count === payload.short_term_achieved_count &&
      latest.evaluation_rule_version === payload.evaluation_rule_version;

    if (!unchanged) {
      const { error: insertError } = await db.from('evaluation_snapshots').insert(payload);
      if (insertError) throw new Error(`スナップショットの保存に失敗しました: ${insertError.message}`);
    }

    // 締めた月を含めて昇格判定をやり直す
    const snapshots = await loadSnapshotSummaries(db, coach.id, yearMonth, EVALUATION_WINDOW_MONTHS);
    const requirementCounts = await loadApprovedRequirementCounts(db, coach.id);
    const promotion = evaluatePromotion(
      { level: coach.level, snapshots, behaviorStatus: overview.behaviorStatus, requirementCounts },
      rules,
    );

    await upsertPromotionReview(db, coach.id, yearMonth, promotion);
    await createNotifications(db, coach, overview, promotion, yearMonth, rules);

    results.push({
      coachId: coach.id,
      coachName: coach.name,
      yearMonth,
      revision: unchanged ? (latest?.revision ?? nextRevision) : nextRevision,
      professionalScore: professional.score,
      isEvaluable: professional.evaluable,
      promotionStatus: promotion.status,
      skipped: unchanged,
    });
  }

  await notifyAdmins(db, results, yearMonth);
  return results;
}

async function loadApprovedRequirementCounts(db: Db, coachId: string): Promise<Record<string, number>> {
  const { data } = await db
    .from('promotion_requirement_checks')
    .select('requirement_code, achieved_count, approved_at')
    .eq('coach_id', coachId)
    .returns<{ requirement_code: string; achieved_count: number; approved_at: string | null }[]>();

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    if (row.approved_at !== null) counts[row.requirement_code] = row.achieved_count;
  }
  return counts;
}

async function upsertPromotionReview(
  db: Db,
  coachId: string,
  yearMonth: YearMonth,
  promotion: PromotionResult,
): Promise<void> {
  // 既にADMINが承認/却下した月の判定は上書きしない (人の決定を機械が消さない)
  const { data: existing } = await db
    .from('promotion_reviews')
    .select('id, status')
    .eq('coach_id', coachId)
    .eq('year_month', yearMonth)
    .maybeSingle<{ id: string; status: string }>();

  if (existing && (existing.status === 'APPROVED' || existing.status === 'REJECTED')) return;

  const payload = {
    coach_id: coachId,
    year_month: yearMonth,
    from_level: promotion.fromLevel,
    to_level: promotion.toLevel,
    status: promotion.status === 'MAX_LEVEL' ? 'NOT_ELIGIBLE' : promotion.status,
    three_month_avg_score: promotion.threeMonthAverage,
    condition_results: promotion.conditions,
  };

  const { error } = await db.from('promotion_reviews').upsert(payload, { onConflict: 'coach_id,year_month' });
  if (error) throw new Error(`昇格判定の保存に失敗しました: ${error.message}`);
}

interface NotificationInput {
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link_url: string | null;
  dedupe_key: string;
}

async function insertNotifications(db: Db, notifications: NotificationInput[]): Promise<void> {
  if (notifications.length === 0) return;
  // 同じ通知の再生成は dedupe_key の一意制約で弾かれる
  await db.from('notifications').upsert(notifications, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
}

async function createNotifications(
  db: Db,
  coach: CoachRecord,
  overview: Awaited<ReturnType<typeof getCoachOverview>>,
  promotion: PromotionResult,
  yearMonth: YearMonth,
  rules: EvaluationRules,
): Promise<void> {
  const notifications: NotificationInput[] = [];
  const monthEnd = endOfMonth(yearMonth);

  // 今月から評価対象になった顧客を知らせる
  const newlyEligible = overview.customers.filter((customer) => {
    if (customer.goalApprovalStatus !== 'APPROVED') return false;
    const startOfPrevMonth = endOfMonth(addMonthsToYearMonth(yearMonth, -1));
    const eligibleNow = isEligibleAt(customer.programStartDate, customer.suspendedDays, monthEnd, rules);
    const eligibleBefore = isEligibleAt(customer.programStartDate, customer.suspendedDays, startOfPrevMonth, rules);
    return eligibleNow && !eligibleBefore;
  });

  for (const customer of newlyEligible) {
    notifications.push({
      user_id: coach.userId,
      type: 'CUSTOMER_ELIGIBLE',
      title: `${customer.name}さんが成果評価の対象になりました`,
      body: `プログラム開始から${rules.eligibility.minElapsedMonths}ヶ月が経過しました。成果を確認して登録してください。`,
      link_url: `/coach/customers/${customer.id}`,
      dedupe_key: `CUSTOMER_ELIGIBLE:${customer.id}`,
    });
  }

  const { longTerm } = overview.evaluation.customerSuccess;
  if (
    longTerm.evaluable &&
    overview.customersNeededForTarget > 0 &&
    overview.customersNeededForTarget <= NEAR_TARGET_REMAINING
  ) {
    notifications.push({
      user_id: coach.userId,
      type: 'NEAR_LONG_TERM_TARGET',
      title: `完全成果率${Math.round(overview.targetRate * 100)}%まであと${overview.customersNeededForTarget}名です`,
      body: `現在 ${longTerm.achievedCount}/${longTerm.targetCount}名。あと${overview.customersNeededForTarget}名の達成で基準に到達します。`,
      link_url: '/coach/customers',
      dedupe_key: `NEAR_LONG_TERM_TARGET:${yearMonth}`,
    });
  }

  if (promotion.status !== 'NOT_ELIGIBLE' && promotion.status !== 'MAX_LEVEL') {
    notifications.push({
      user_id: coach.userId,
      type: 'PROMOTION_CANDIDATE',
      title: `${promotion.toLevel} への昇格条件を満たしました`,
      body: 'ADMINの確認をお待ちください。',
      link_url: '/coach/promotion',
      dedupe_key: `PROMOTION_CANDIDATE:${yearMonth}`,
    });
  } else if (promotion.shortfalls.length === 1) {
    const [shortfall] = promotion.shortfalls;
    notifications.push({
      user_id: coach.userId,
      type: 'PROMOTION_NEAR',
      title: `${promotion.toLevel} 昇格まで残り1条件です`,
      body: `${shortfall?.label}: 現在 ${shortfall?.currentLabel} / 必要 ${shortfall?.requiredLabel}`,
      link_url: '/coach/promotion',
      dedupe_key: `PROMOTION_NEAR:${yearMonth}`,
    });
  }

  await insertNotifications(db, notifications);
}

/** 指定日時点で評価対象になっているか (通知の「今月から対象になった」判定に使う) */
function isEligibleAt(
  programStartDate: string,
  suspendedDays: number,
  asOf: string,
  rules: EvaluationRules,
): boolean {
  return effectiveElapsedMonths(programStartDate, asOf, suspendedDays) >= rules.eligibility.minElapsedMonths;
}

async function notifyAdmins(db: Db, results: CoachCloseResult[], yearMonth: YearMonth): Promise<void> {
  const { data: admins } = await db
    .from('users')
    .select('id')
    .eq('role', 'ADMIN')
    .eq('active', true)
    .returns<{ id: string }[]>();
  if (!admins || admins.length === 0) return;

  const candidates = results.filter(
    (r) => r.promotionStatus === 'CANDIDATE' || r.promotionStatus === 'CANDIDATE_REQUIRES_APPROVAL',
  );
  const staleCustomers = await countStaleCustomers(db);

  const notifications: NotificationInput[] = [];
  for (const admin of admins) {
    if (candidates.length > 0) {
      notifications.push({
        user_id: admin.id,
        type: 'ADMIN_PROMOTION_CANDIDATES',
        title: `昇格候補が${candidates.length}名います`,
        body: candidates.map((c) => c.coachName).join('、'),
        link_url: '/admin/promotions',
        dedupe_key: `ADMIN_PROMOTION_CANDIDATES:${yearMonth}`,
      });
    }
    if (staleCustomers > 0) {
      notifications.push({
        user_id: admin.id,
        type: 'ADMIN_STALE_CUSTOMERS',
        title: `成果更新が${STALE_CUSTOMER_DAYS}日以上ない評価対象顧客が${staleCustomers}名います`,
        body: '担当コーチへの確認をおすすめします。',
        link_url: '/admin/customers',
        dedupe_key: `ADMIN_STALE_CUSTOMERS:${yearMonth}`,
      });
    }
  }

  await insertNotifications(db, notifications);
}

async function countStaleCustomers(db: Db): Promise<number> {
  const today = todayInJst();
  const { data } = await db
    .from('customers')
    .select('id, updated_at, status, goal_approval_status, complete_success')
    .eq('status', 'ACTIVE')
    .eq('goal_approval_status', 'APPROVED')
    .eq('complete_success', false)
    .is('deleted_at', null)
    .returns<{ id: string; updated_at: string }[]>();

  return (data ?? []).filter((row) => diffDays(row.updated_at.slice(0, 10), today) >= STALE_CUSTOMER_DAYS).length;
}
