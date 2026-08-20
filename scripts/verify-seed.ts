/**
 * シードデータに対して評価エンジンを実際に走らせ、想定どおりの状態になるかを検証する。
 *
 * Supabase (PostgREST) を介さずローカル PostgreSQL へ直接接続するため、
 * Docker/Supabase CLI が使えない環境でも「DB → 評価 → 昇格判定」まで通しで確認できる。
 *
 *   npm run verify:seed
 */
import { Client } from 'pg';
import { addMonthsToYearMonth, todayInJst, yearMonthOf } from '@/domain/date';
import {
  DEFAULT_EVALUATION_RULES,
  evaluateCoachMonth,
  evaluatePromotion,
  calcQuarterlyBonus,
  evaluationRulesSchema,
} from '@/domain/evaluation';
import type {
  CustomerEvaluationInput,
  ProfessionalLevel,
  SaleEvaluationInput,
  SnapshotSummary,
} from '@/domain/types';

const connectionString =
  process.env.VERIFY_DATABASE_URL ?? 'postgresql://postgres@localhost:55432/eagle_test';

function toDateOnly(value: Date | string | null): string | null {
  if (value === null) return null;
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();

  const rulesResult = await client.query('select rules from evaluation_rules order by version desc limit 1');
  const rules = rulesResult.rows[0]
    ? evaluationRulesSchema.parse(rulesResult.rows[0].rules)
    : DEFAULT_EVALUATION_RULES;

  const coaches = await client.query<{ id: string; name: string; professional_level: ProfessionalLevel }>(
    `select c.id, u.name, c.professional_level
       from coaches c join users u on u.id = c.user_id
      where c.deleted_at is null and u.role = 'COACH'
      order by u.name`,
  );

  const thisMonth = yearMonthOf(todayInJst());
  const months = [2, 1, 0].map((offset) => addMonthsToYearMonth(thisMonth, -offset));
  let failures = 0;

  console.log(`評価ルール v${rules.version} / 対象月: ${months.join(', ')}\n`);

  for (const coach of coaches.rows) {
    const customerRows = await client.query(
      `select id, name, program_start_date, program_end_date, status, cancel_reason_code, status_changed_on,
              goal_approval_status, goal_type, target_score, target_distance, complete_success_at, suspended_days
         from customers where current_coach_id = $1 and deleted_at is null`,
      [coach.id],
    );

    const customers: CustomerEvaluationInput[] = customerRows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      programStartDate: toDateOnly(row.program_start_date)!,
      programEndDate: toDateOnly(row.program_end_date),
      status: row.status,
      cancelReasonCode: row.cancel_reason_code,
      statusChangedOn: toDateOnly(row.status_changed_on),
      goalApprovalStatus: row.goal_approval_status,
      goalType: row.goal_type,
      targetScore: row.target_score === null ? null : Number(row.target_score),
      targetDistance: row.target_distance === null ? null : Number(row.target_distance),
      completeSuccessAt: toDateOnly(row.complete_success_at),
      suspendedDays: row.suspended_days,
    }));

    const saleRows = await client.query(
      `select s.id, s.coach_id, s.sold_on, s.amount, s.refund_amount, s.incentive_amount, s.status,
              s.acquisition_source, p.is_sales_score_target
         from sales s join products p on p.id = s.product_id
        where s.coach_id = $1 and s.deleted_at is null`,
      [coach.id],
    );

    const sales: SaleEvaluationInput[] = saleRows.rows.map((row) => ({
      id: row.id,
      coachId: row.coach_id,
      soldOn: toDateOnly(row.sold_on)!,
      amount: Number(row.amount),
      refundAmount: Number(row.refund_amount),
      incentiveAmount: Number(row.incentive_amount),
      status: row.status,
      acquisitionSource: row.acquisition_source,
      isSalesScoreTarget: row.is_sales_score_target,
    }));

    // 直近3ヶ月分の月次評価 = 月次締めで保存されるスナップショット相当
    const snapshots: SnapshotSummary[] = months.map((yearMonth) => {
      const result = evaluateCoachMonth(
        { coachId: coach.id, level: coach.professional_level, yearMonth, customers, sales },
        rules,
      );
      return {
        yearMonth,
        professionalScore: result.professional.score,
        longTermSuccessRate: result.customerSuccess.longTerm.rate,
        isEvaluable: result.professional.evaluable,
      };
    });

    const latestMonth = months[months.length - 1]!;
    const latest = evaluateCoachMonth(
      { coachId: coach.id, level: coach.professional_level, yearMonth: latestMonth, customers, sales },
      rules,
    );

    const behavior = await client.query<{ status: 'OK' | 'WARNING' | 'NG' }>(
      `select status from coach_behavior_statuses where coach_id = $1 order by year_month desc limit 1`,
      [coach.id],
    );
    const checks = await client.query<{ requirement_code: string; achieved_count: number; approved_at: Date | null }>(
      `select requirement_code, achieved_count, approved_at from promotion_requirement_checks where coach_id = $1`,
      [coach.id],
    );
    const requirementCounts: Record<string, number> = {};
    for (const row of checks.rows) {
      if (row.approved_at !== null) requirementCounts[row.requirement_code] = row.achieved_count;
    }

    const promotion = evaluatePromotion(
      {
        level: coach.professional_level,
        snapshots,
        behaviorStatus: behavior.rows[0]?.status ?? 'OK',
        requirementCounts,
      },
      rules,
    );
    const bonus = calcQuarterlyBonus(snapshots, rules);

    const { customerSuccess, sales: salesResult, professional } = latest;
    console.log(`■ ${coach.name} (${coach.professional_level})`);
    console.log(
      `  Professional Score : ${professional.score ?? 'N/A'} (${professional.band})` +
        `  = 顧客成果 ${customerSuccess.score ?? 'N/A'} + 売上 ${salesResult.score}`,
    );
    console.log(
      `  長期 完全成果率   : ${customerSuccess.longTerm.rate === null ? 'N/A' : `${(customerSuccess.longTerm.rate * 100).toFixed(1)}%`}` +
        ` (${customerSuccess.longTerm.achievedCount}/${customerSuccess.longTerm.targetCount}名) → ${customerSuccess.longTerm.score ?? 'N/A'}点`,
    );
    console.log(
      `  短期 3ヶ月成果率  : ${customerSuccess.shortTerm.rate === null ? 'N/A' : `${(customerSuccess.shortTerm.rate * 100).toFixed(1)}%`}` +
        ` (${customerSuccess.shortTerm.achievedCount}/${customerSuccess.shortTerm.targetCount}名) → ${customerSuccess.shortTerm.score ?? 'N/A'}点`,
    );
    console.log(`  当月売上          : ¥${salesResult.amount.toLocaleString('ja-JP')} → ${salesResult.score}点`);
    console.log(`  3ヶ月推移         : ${snapshots.map((s) => s.professionalScore ?? 'N/A').join(' → ')}`);
    console.log(`  四半期ボーナス    : ¥${bonus.amount.toLocaleString('ja-JP')} (平均 ${bonus.average ?? 'N/A'})`);
    console.log(`  昇格判定          : ${promotion.status}${promotion.toLevel ? ` (→ ${promotion.toLevel})` : ''}`);
    for (const condition of promotion.conditions) {
      console.log(`    ${condition.met ? '✅' : '❌'} ${condition.label}: ${condition.currentLabel}`);
    }
    console.log('');

    // デモとして成立しているかの検証
    if (coach.name.startsWith('田中')) {
      failures += expect(promotion.status === 'CANDIDATE', '田中は昇格候補になるべき');
      failures += expect((customerSuccess.longTerm.rate ?? 0) >= 0.9, '田中の完全成果率は90%以上であるべき');
      failures += expect(bonus.amount > 0, '田中には四半期ボーナスが出るべき');
    }
    if (coach.name.startsWith('鈴木')) {
      failures += expect(professional.score === 120, `鈴木は最高評価120点になるべき (実際 ${professional.score})`);
      failures += expect(promotion.status === 'NOT_ELIGIBLE', '鈴木は事業成果要件が未承認のため昇格不可であるべき');
    }
    if (coach.name.startsWith('佐藤')) {
      failures += expect((professional.score ?? 0) < 80, '佐藤は基準未達水準であるべき');
      failures += expect(promotion.status === 'NOT_ELIGIBLE', '佐藤は昇格条件を満たさないべき');
    }
  }

  await client.end();

  if (failures > 0) {
    console.error(`\n${failures}件の想定と異なる結果があります`);
    process.exit(1);
  }
  console.log('シードデータの検証: 全て想定どおり');
}

function expect(condition: boolean, message: string): number {
  if (condition) return 0;
  console.error(`  [NG] ${message}`);
  return 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
