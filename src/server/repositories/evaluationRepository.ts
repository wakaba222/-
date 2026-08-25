import type { SupabaseClient } from '@supabase/supabase-js';
import { addMonthsToYearMonth, endOfMonth, startOfMonth } from '@/domain/date';
import type {
  CustomerEvaluationInput,
  SaleEvaluationInput,
  SnapshotSummary,
  YearMonth,
} from '@/domain/types';
import {
  DEFAULT_EVALUATION_RULES,
  evaluationRulesSchema,
  resolveResponsibleCoachId,
  type AssignmentPeriod,
  type EvaluationRules,
} from '@/domain/evaluation';
import type {
  CustomerRow,
  EvaluationRuleRow,
  EvaluationSnapshotRow,
  SaleRow,
} from '@/lib/supabase/types';

/** 評価に必要な売上をさかのぼる月数 (年間累計の表示に使う) */
const SALES_LOOKBACK_MONTHS = 12;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase の生成型が無い環境でも動くようにする
export type Db = SupabaseClient<any, 'public', any>;

/**
 * 対象年月に適用される評価ルールを取得する。
 * スナップショットの再計算時に「当時のルール」で再現できるよう version 指定にも対応。
 */
export async function loadEvaluationRules(
  db: Db,
  options: { yearMonth?: YearMonth; version?: number } = {},
): Promise<EvaluationRules> {
  let query = db.from('evaluation_rules').select('version, effective_from, effective_to, rules, note');

  if (options.version !== undefined) {
    query = query.eq('version', options.version);
  } else if (options.yearMonth) {
    query = query.lte('effective_from', endOfMonth(options.yearMonth));
  }

  const { data, error } = await query.order('version', { ascending: false }).limit(1).returns<EvaluationRuleRow[]>();
  if (error) throw new Error(`評価ルールの取得に失敗しました: ${error.message}`);

  const row = data?.[0];
  // 未投入の環境ではコード側の既定値で動かす (画面が真っ白になるより望ましい)
  if (!row) return DEFAULT_EVALUATION_RULES;

  const parsed = evaluationRulesSchema.safeParse(row.rules);
  if (!parsed.success) {
    throw new Error(`評価ルール v${row.version} の形式が不正です: ${parsed.error.message}`);
  }
  return parsed.data;
}

function toCustomerInput(row: CustomerRow): CustomerEvaluationInput {
  return {
    id: row.id,
    name: row.name,
    programStartDate: row.program_start_date,
    programEndDate: row.program_end_date,
    status: row.status,
    cancelReasonCode: row.cancel_reason_code,
    statusChangedOn: row.status_changed_on,
    goalApprovalStatus: row.goal_approval_status,
    goalType: row.goal_type,
    targetScore: row.target_score,
    targetDistance: row.target_distance,
    completeSuccessAt: row.complete_success_at,
    suspendedDays: row.suspended_days,
  };
}

function toSaleInput(row: SaleRow): SaleEvaluationInput {
  return {
    id: row.id,
    coachId: row.coach_id,
    soldOn: row.sold_on,
    amount: row.amount,
    refundAmount: row.refund_amount,
    taxAmount: row.tax_amount,
    paymentFee: row.payment_fee,
    incentiveAmount: row.incentive_amount,
    paymentSource: row.payment_source,
    status: row.status,
    acquisitionSource: row.acquisition_source,
    isSalesScoreTarget: row.products?.is_sales_score_target ?? true,
  };
}

const SALES_COLUMNS =
  'id, coach_id, customer_id, product_id, sold_on, amount, incentive_amount, acquisition_source, ' +
  'payment_source, status, refund_amount, tax_amount, payment_fee, net_amount, note, ' +
  'products(id, name, code, is_sales_score_target)';

const CUSTOMER_COLUMNS =
  'id, name, current_coach_id, program_start_date, program_end_date, status, status_changed_on, ' +
  'cancel_reason_code, suspended_days, start_score, target_score, start_distance, target_distance, ' +
  'goal_type, goal_approval_status, goal_approved_at, latest_score, latest_distance, ' +
  'complete_success, complete_success_at, note, updated_at';

/**
 * 評価対象の顧客を取得する。
 * 担当変更があった顧客は「達成日時点の担当コーチ」に帰属させるため、
 * 現担当だけでなく担当履歴も見て集合を決める (仕様37章)。
 */
export async function loadEvaluationCustomers(db: Db, coachId: string): Promise<CustomerEvaluationInput[]> {
  // 担当履歴と現担当顧客は互いに依存しないので並列に取る
  const [{ data: coachAssignments, error: assignmentError }, { data: currentRows, error: currentError }] =
    await Promise.all([
      db
        .from('customer_coach_assignments')
        .select('customer_id')
        .eq('coach_id', coachId)
        .returns<{ customer_id: string }[]>(),
      db
        .from('customers')
        .select(CUSTOMER_COLUMNS)
        .eq('current_coach_id', coachId)
        .is('deleted_at', null)
        .returns<CustomerRow[]>(),
    ]);
  if (assignmentError) throw new Error(`担当履歴の取得に失敗しました: ${assignmentError.message}`);
  if (currentError) throw new Error(`顧客の取得に失敗しました: ${currentError.message}`);

  const historicalIds = [...new Set((coachAssignments ?? []).map((a) => a.customer_id))];

  const byId = new Map<string, CustomerRow>();
  for (const row of currentRows ?? []) byId.set(row.id, row);

  const missingIds = historicalIds.filter((id) => !byId.has(id));
  if (missingIds.length > 0) {
    const { data: pastRows, error: pastError } = await db
      .from('customers')
      .select(CUSTOMER_COLUMNS)
      .in('id', missingIds)
      .is('deleted_at', null)
      .returns<CustomerRow[]>();
    if (pastError) throw new Error(`過去担当顧客の取得に失敗しました: ${pastError.message}`);
    for (const row of pastRows ?? []) byId.set(row.id, row);
  }

  const candidateIds = [...byId.keys()];
  if (candidateIds.length === 0) return [];

  const { data: allAssignments, error: allAssignmentError } = await db
    .from('customer_coach_assignments')
    .select('customer_id, coach_id, start_date, end_date')
    .in('customer_id', candidateIds)
    .returns<{ customer_id: string; coach_id: string; start_date: string; end_date: string | null }[]>();
  if (allAssignmentError) throw new Error(`担当履歴の取得に失敗しました: ${allAssignmentError.message}`);

  const assignmentsByCustomer = new Map<string, AssignmentPeriod[]>();
  for (const a of allAssignments ?? []) {
    const list = assignmentsByCustomer.get(a.customer_id) ?? [];
    list.push({ customerId: a.customer_id, coachId: a.coach_id, startDate: a.start_date, endDate: a.end_date });
    assignmentsByCustomer.set(a.customer_id, list);
  }

  return [...byId.values()]
    .filter((row) => {
      const responsible = resolveResponsibleCoachId(
        assignmentsByCustomer.get(row.id) ?? [],
        row.complete_success_at,
        row.current_coach_id,
      );
      return responsible === coachId;
    })
    .map(toCustomerInput);
}

/** 直近12ヶ月分の売上 (月次・3ヶ月・年間の集計を1回の取得でまかなう) */
export async function loadEvaluationSales(
  db: Db,
  coachId: string,
  yearMonth: YearMonth,
): Promise<SaleEvaluationInput[]> {
  const from = startOfMonth(addMonthsToYearMonth(yearMonth, -(SALES_LOOKBACK_MONTHS - 1)));
  const to = endOfMonth(yearMonth);

  const { data, error } = await db
    .from('sales')
    .select(SALES_COLUMNS)
    .eq('coach_id', coachId)
    .gte('sold_on', from)
    .lte('sold_on', to)
    .is('deleted_at', null)
    .returns<SaleRow[]>();
  if (error) throw new Error(`売上の取得に失敗しました: ${error.message}`);

  return (data ?? []).map(toSaleInput);
}

/** 各月の最新 revision のスナップショット (昇格・ボーナス判定の入力) */
export async function loadSnapshotSummaries(
  db: Db,
  coachId: string,
  yearMonth: YearMonth,
  months: number,
): Promise<SnapshotSummary[]> {
  const from = addMonthsToYearMonth(yearMonth, -(months - 1));

  const { data, error } = await db
    .from('latest_evaluation_snapshots')
    .select('year_month, professional_score, long_term_success_rate, is_evaluable')
    .eq('coach_id', coachId)
    .gte('year_month', from)
    .lte('year_month', yearMonth)
    .order('year_month', { ascending: true })
    .returns<Pick<EvaluationSnapshotRow, 'year_month' | 'professional_score' | 'long_term_success_rate' | 'is_evaluable'>[]>();
  if (error) throw new Error(`評価スナップショットの取得に失敗しました: ${error.message}`);

  return (data ?? []).map((row) => ({
    yearMonth: row.year_month,
    professionalScore: row.professional_score,
    longTermSuccessRate: row.long_term_success_rate,
    isEvaluable: row.is_evaluable,
  }));
}

// ---------------------------------------------------------------------------
// 一括取得 (ADMIN の一覧用)
//
// 単体版をコーチ数ぶん呼ぶとテーブルごとに人数分の往復が発生する。
// ここではテーブルごとに 1 回だけ問い合わせ、コーチ単位に振り分ける。
// 振り分け後の絞り込み条件は単体版と同じにしてあるため、結果は一致する。
// ---------------------------------------------------------------------------

/** コーチID単位の顧客一覧。単体版 loadEvaluationCustomers と同じ集合を返す */
export async function loadEvaluationCustomersByCoach(
  db: Db,
  coachIds: string[],
): Promise<Map<string, CustomerEvaluationInput[]>> {
  const result = new Map<string, CustomerEvaluationInput[]>();
  for (const id of coachIds) result.set(id, []);
  if (coachIds.length === 0) return result;

  const [{ data: coachAssignments, error: assignmentError }, { data: currentRows, error: currentError }] =
    await Promise.all([
      db
        .from('customer_coach_assignments')
        .select('customer_id, coach_id')
        .in('coach_id', coachIds)
        .returns<{ customer_id: string; coach_id: string }[]>(),
      db
        .from('customers')
        .select(CUSTOMER_COLUMNS)
        .in('current_coach_id', coachIds)
        .is('deleted_at', null)
        .returns<CustomerRow[]>(),
    ]);
  if (assignmentError) throw new Error(`担当履歴の取得に失敗しました: ${assignmentError.message}`);
  if (currentError) throw new Error(`顧客の取得に失敗しました: ${currentError.message}`);

  // コーチごとの「過去に担当した顧客ID」
  const historicalByCoach = new Map<string, Set<string>>();
  for (const id of coachIds) historicalByCoach.set(id, new Set());
  for (const a of coachAssignments ?? []) historicalByCoach.get(a.coach_id)?.add(a.customer_id);

  const byId = new Map<string, CustomerRow>();
  for (const row of currentRows ?? []) byId.set(row.id, row);

  const missingIds = [...new Set([...historicalByCoach.values()].flatMap((set) => [...set]))].filter(
    (id) => !byId.has(id),
  );
  if (missingIds.length > 0) {
    const { data: pastRows, error: pastError } = await db
      .from('customers')
      .select(CUSTOMER_COLUMNS)
      .in('id', missingIds)
      .is('deleted_at', null)
      .returns<CustomerRow[]>();
    if (pastError) throw new Error(`過去担当顧客の取得に失敗しました: ${pastError.message}`);
    for (const row of pastRows ?? []) byId.set(row.id, row);
  }

  const candidateIds = [...byId.keys()];
  if (candidateIds.length === 0) return result;

  const { data: allAssignments, error: allAssignmentError } = await db
    .from('customer_coach_assignments')
    .select('customer_id, coach_id, start_date, end_date')
    .in('customer_id', candidateIds)
    .returns<{ customer_id: string; coach_id: string; start_date: string; end_date: string | null }[]>();
  if (allAssignmentError) throw new Error(`担当履歴の取得に失敗しました: ${allAssignmentError.message}`);

  const assignmentsByCustomer = new Map<string, AssignmentPeriod[]>();
  for (const a of allAssignments ?? []) {
    const list = assignmentsByCustomer.get(a.customer_id) ?? [];
    list.push({ customerId: a.customer_id, coachId: a.coach_id, startDate: a.start_date, endDate: a.end_date });
    assignmentsByCustomer.set(a.customer_id, list);
  }

  // 達成日時点の担当コーチへ帰属させる (仕様37章)。判定は単体版と同一。
  for (const row of byId.values()) {
    const responsible = resolveResponsibleCoachId(
      assignmentsByCustomer.get(row.id) ?? [],
      row.complete_success_at,
      row.current_coach_id,
    );
    if (responsible === null) continue;
    const bucket = result.get(responsible);
    if (!bucket) continue;
    // 単体版の候補集合 = 現担当 ∪ 担当履歴。そこに含まれない顧客は数えない。
    const isCandidate = row.current_coach_id === responsible || historicalByCoach.get(responsible)?.has(row.id);
    if (isCandidate) bucket.push(toCustomerInput(row));
  }

  return result;
}

/** コーチID単位の直近12ヶ月の売上 */
export async function loadEvaluationSalesByCoach(
  db: Db,
  coachIds: string[],
  yearMonth: YearMonth,
): Promise<Map<string, SaleEvaluationInput[]>> {
  const result = new Map<string, SaleEvaluationInput[]>();
  for (const id of coachIds) result.set(id, []);
  if (coachIds.length === 0) return result;

  const from = startOfMonth(addMonthsToYearMonth(yearMonth, -(SALES_LOOKBACK_MONTHS - 1)));
  const to = endOfMonth(yearMonth);

  const { data, error } = await db
    .from('sales')
    .select(SALES_COLUMNS)
    .in('coach_id', coachIds)
    .gte('sold_on', from)
    .lte('sold_on', to)
    .is('deleted_at', null)
    .returns<SaleRow[]>();
  if (error) throw new Error(`売上の取得に失敗しました: ${error.message}`);

  for (const row of data ?? []) result.get(row.coach_id)?.push(toSaleInput(row));
  return result;
}

/** コーチID単位の確定スナップショット (年月の昇順) */
export async function loadSnapshotSummariesByCoach(
  db: Db,
  coachIds: string[],
  yearMonth: YearMonth,
  months: number,
): Promise<Map<string, SnapshotSummary[]>> {
  const result = new Map<string, SnapshotSummary[]>();
  for (const id of coachIds) result.set(id, []);
  if (coachIds.length === 0) return result;

  const from = addMonthsToYearMonth(yearMonth, -(months - 1));

  const { data, error } = await db
    .from('latest_evaluation_snapshots')
    .select('coach_id, year_month, professional_score, long_term_success_rate, is_evaluable')
    .in('coach_id', coachIds)
    .gte('year_month', from)
    .lte('year_month', yearMonth)
    .order('year_month', { ascending: true })
    .returns<
      (Pick<EvaluationSnapshotRow, 'year_month' | 'professional_score' | 'long_term_success_rate' | 'is_evaluable'> & {
        coach_id: string;
      })[]
    >();
  if (error) throw new Error(`評価スナップショットの取得に失敗しました: ${error.message}`);

  for (const row of data ?? []) {
    result.get(row.coach_id)?.push({
      yearMonth: row.year_month,
      professionalScore: row.professional_score,
      longTermSuccessRate: row.long_term_success_rate,
      isEvaluable: row.is_evaluable,
    });
  }
  return result;
}
