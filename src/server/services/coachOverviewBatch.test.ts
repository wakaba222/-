/**
 * 一括取得 (getCoachOverviews) と単体取得 (getCoachOverview) が
 * 完全に同じ評価結果を返すことを恒久的に保証する。
 *
 * 一括取得は「往復回数を減らすための取得方法の違い」でしかない。
 * Professional Score・昇格判定・売上集計が両者でずれたら、
 * ADMIN一覧とコーチ個票の数字が食い違うため、必ずここで落とす。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_EVALUATION_RULES } from '@/domain/evaluation';
import type { Db } from '@/server/repositories/evaluationRepository';
import { getCoachOverview, getCoachOverviews } from './evaluationService';

const YEAR_MONTH = '2026-06';

/** PostgREST のクエリビルダのうち、リポジトリ層が使う操作だけを再現する */
type Row = Record<string, unknown>;

interface Filter {
  kind: 'eq' | 'in' | 'is' | 'lte' | 'gte';
  column: string;
  value: unknown;
}

function matches(row: Row, filter: Filter): boolean {
  const actual = row[filter.column];
  switch (filter.kind) {
    case 'eq':
      return actual === filter.value;
    case 'in':
      return (filter.value as unknown[]).includes(actual);
    case 'is':
      return actual === filter.value || (filter.value === null && actual === undefined);
    case 'lte':
      return actual !== null && actual !== undefined && (actual as string) <= (filter.value as string);
    case 'gte':
      return actual !== null && actual !== undefined && (actual as string) >= (filter.value as string);
  }
}

function createFakeDb(tables: Record<string, Row[]>): Db {
  function builder(table: string) {
    const filters: Filter[] = [];
    const orders: { column: string; ascending: boolean }[] = [];
    let limit: number | null = null;

    function resolve(): Row[] {
      let rows = (tables[table] ?? []).filter((row) => filters.every((f) => matches(row, f)));
      for (const order of [...orders].reverse()) {
        rows = [...rows].sort((a, b) => {
          const av = String(a[order.column] ?? '');
          const bv = String(b[order.column] ?? '');
          return order.ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      return limit === null ? rows : rows.slice(0, limit);
    }

    const api = {
      select: () => api,
      eq: (column: string, value: unknown) => (filters.push({ kind: 'eq', column, value }), api),
      in: (column: string, value: unknown) => (filters.push({ kind: 'in', column, value }), api),
      is: (column: string, value: unknown) => (filters.push({ kind: 'is', column, value }), api),
      lte: (column: string, value: unknown) => (filters.push({ kind: 'lte', column, value }), api),
      gte: (column: string, value: unknown) => (filters.push({ kind: 'gte', column, value }), api),
      order: (column: string, options?: { ascending?: boolean }) => (
        orders.push({ column, ascending: options?.ascending ?? true }), api
      ),
      limit: (count: number) => ((limit = count), api),
      returns: () => api,
      maybeSingle: () => ({ then: (fn: (r: unknown) => unknown) => fn({ data: resolve()[0] ?? null, error: null }) }),
      then: (fn: (r: unknown) => unknown) => fn({ data: resolve(), error: null }),
    };
    return api;
  }

  return { from: (table: string) => builder(table) } as unknown as Db;
}

/** コーチ2名・担当変更あり・返金ありのデータを作る (評価が偏らないよう条件を混ぜる) */
function buildTables() {
  const customer = (
    id: string,
    coachId: string,
    startDate: string,
    completeSuccessAt: string | null,
  ): Row => ({
    id,
    name: id,
    current_coach_id: coachId,
    program_start_date: startDate,
    program_end_date: null,
    status: 'ACTIVE',
    status_changed_on: null,
    cancel_reason_code: null,
    suspended_days: 0,
    target_score: 100,
    target_distance: null,
    goal_type: 'SCORE',
    goal_approval_status: 'APPROVED',
    complete_success: completeSuccessAt !== null,
    complete_success_at: completeSuccessAt,
    deleted_at: null,
  });

  const sale = (id: string, coachId: string, soldOn: string, amount: number, refund: number): Row => ({
    id,
    coach_id: coachId,
    customer_id: 'c1',
    sold_on: soldOn,
    amount,
    refund_amount: refund,
    tax_amount: Math.round((amount * 0.1) / 1.1),
    payment_fee: 0,
    incentive_amount: 30000,
    payment_source: 'ROBOT_PAYMENT',
    status: refund > 0 ? 'REFUNDED' : 'ACTIVE',
    acquisition_source: 'EXISTING',
    deleted_at: null,
    products: { is_sales_score_target: true },
  });

  return {
    evaluation_rules: [
      { version: 1, effective_from: '2020-01-01', effective_to: null, rules: DEFAULT_EVALUATION_RULES, note: null },
    ],
    customers: [
      customer('c1', 'coach-a', '2025-09-01', '2026-04-10T00:00:00Z'),
      customer('c2', 'coach-a', '2025-10-01', null),
      customer('c3', 'coach-b', '2025-08-01', '2026-03-05T00:00:00Z'),
      // coach-b から coach-a へ移った顧客 (達成日時点の担当は coach-b)
      customer('c4', 'coach-a', '2025-07-01', '2026-01-20T00:00:00Z'),
    ],
    customer_coach_assignments: [
      { customer_id: 'c1', coach_id: 'coach-a', start_date: '2025-09-01', end_date: null },
      { customer_id: 'c2', coach_id: 'coach-a', start_date: '2025-10-01', end_date: null },
      { customer_id: 'c3', coach_id: 'coach-b', start_date: '2025-08-01', end_date: null },
      { customer_id: 'c4', coach_id: 'coach-b', start_date: '2025-07-01', end_date: '2026-02-28' },
      { customer_id: 'c4', coach_id: 'coach-a', start_date: '2026-03-01', end_date: null },
    ],
    sales: [
      sale('s1', 'coach-a', '2026-06-10', 550000, 0),
      sale('s2', 'coach-a', '2026-05-02', 330000, 110000),
      sale('s3', 'coach-b', '2026-06-20', 880000, 0),
      sale('s4', 'coach-b', '2026-04-15', 220000, 0),
    ],
    latest_evaluation_snapshots: [
      { coach_id: 'coach-a', year_month: '2026-03', professional_score: 101.2, long_term_success_rate: 0.9, is_evaluable: true },
      { coach_id: 'coach-a', year_month: '2026-04', professional_score: 104.5, long_term_success_rate: 0.92, is_evaluable: true },
      { coach_id: 'coach-a', year_month: '2026-05', professional_score: 108.8, long_term_success_rate: 0.95, is_evaluable: true },
      { coach_id: 'coach-b', year_month: '2026-04', professional_score: 62.0, long_term_success_rate: 0.5, is_evaluable: true },
      { coach_id: 'coach-b', year_month: '2026-05', professional_score: 71.5, long_term_success_rate: 0.6, is_evaluable: true },
    ],
    coach_behavior_statuses: [
      { id: 'b1', coach_id: 'coach-a', year_month: '2026-02', status: 'OK', note: null },
      { id: 'b2', coach_id: 'coach-a', year_month: '2026-05', status: 'WARNING', note: null },
      { id: 'b3', coach_id: 'coach-b', year_month: '2026-01', status: 'OK', note: null },
    ],
    promotion_requirement_checks: [
      { id: 'r1', coach_id: 'coach-a', requirement_code: 'SEMINAR', label: '研修', achieved_count: 2, approved_at: '2026-05-01T00:00:00Z' },
      { id: 'r2', coach_id: 'coach-a', requirement_code: 'REPORT', label: '報告', achieved_count: 5, approved_at: null },
      { id: 'r3', coach_id: 'coach-b', requirement_code: 'SEMINAR', label: '研修', achieved_count: 1, approved_at: '2026-05-01T00:00:00Z' },
    ],
    monthly_lesson_counts: [
      { id: 'l1', coach_id: 'coach-a', year_month: '2026-06', lesson_count: 80 },
      { id: 'l2', coach_id: 'coach-b', year_month: '2026-06', lesson_count: 45 },
    ],
  } satisfies Record<string, Row[]>;
}

const COACHES = [
  { id: 'coach-a', level: 'P1' as const },
  { id: 'coach-b', level: 'P2' as const },
];

describe('一括取得と単体取得の同一性', () => {
  it('コーチごとの評価結果が単体取得と完全に一致する', async () => {
    const db = createFakeDb(buildTables());
    const batch = await getCoachOverviews(db, COACHES, YEAR_MONTH);

    for (const coach of COACHES) {
      const single = await getCoachOverview(db, coach.id, coach.level, YEAR_MONTH);
      expect(batch.get(coach.id)).toEqual(single);
    }
  });

  it('Professional Score・売上集計・昇格判定が一致する', async () => {
    const db = createFakeDb(buildTables());
    const batch = await getCoachOverviews(db, COACHES, YEAR_MONTH);

    for (const coach of COACHES) {
      const single = await getCoachOverview(db, coach.id, coach.level, YEAR_MONTH);
      const both = batch.get(coach.id)!;

      expect(both.evaluation.professional.score).toBe(single.evaluation.professional.score);
      expect(both.evaluation.customerSuccess.score).toBe(single.evaluation.customerSuccess.score);
      expect(both.evaluation.sales.amount).toBe(single.evaluation.sales.amount);
      expect(both.salesBreakdown).toEqual(single.salesBreakdown);
      expect(both.promotion.status).toBe(single.promotion.status);
      expect(both.behaviorStatus).toBe(single.behaviorStatus);
      expect(both.compensation).toEqual(single.compensation);
      expect(both.customers.map((c) => c.id).sort()).toEqual(single.customers.map((c) => c.id).sort());
    }
  });

  it('テストデータが実際に値を持っている (空データで通ってしまうのを防ぐ)', async () => {
    const db = createFakeDb(buildTables());
    const batch = await getCoachOverviews(db, COACHES, YEAR_MONTH);
    const a = batch.get('coach-a')!;
    const b = batch.get('coach-b')!;

    expect(a.customers.length).toBeGreaterThan(0);
    expect(a.sales.length).toBeGreaterThan(0);
    expect(a.salesBreakdown.monthly).toBeGreaterThan(0);
    expect(a.evaluation.professional.score).not.toBeNull();
    expect(a.snapshots.length).toBe(3);
    expect(a.behaviorStatus).toBe('WARNING');
    expect(b.behaviorStatus).toBe('OK');
    expect(b.evaluation.professional.score).not.toBeNull();
  });

  it('担当変更のあった顧客は達成日時点の担当コーチ側だけに数えられる', async () => {
    const db = createFakeDb(buildTables());
    const batch = await getCoachOverviews(db, COACHES, YEAR_MONTH);

    const coachA = batch.get('coach-a')!.customers.map((c) => c.id);
    const coachB = batch.get('coach-b')!.customers.map((c) => c.id);

    // c4 は 2026-01 達成時点で coach-b の担当だったため coach-b 側に入る
    expect(coachA).not.toContain('c4');
    expect(coachB).toContain('c4');
    // 同じ顧客が2人のコーチに二重計上されない
    expect(coachA.filter((id) => coachB.includes(id))).toHaveLength(0);
  });
});
