import { addMonthsToYearMonth, endOfMonth, isWithin, startOfMonth, type DateOnly, type YearMonth } from '../date';
import type { SaleEvaluationInput, SalesResult } from '../types';
import { interpolateScore, round1 } from './interpolate';
import type { EvaluationRules } from './rules';

export interface Period {
  from: DateOnly;
  to: DateOnly;
}

export function monthPeriod(yearMonth: YearMonth): Period {
  return { from: startOfMonth(yearMonth), to: endOfMonth(yearMonth) };
}

/** 直近 n ヶ月 (当月を含む) */
export function rollingPeriod(yearMonth: YearMonth, months: number): Period {
  return { from: startOfMonth(addMonthsToYearMonth(yearMonth, -(months - 1))), to: endOfMonth(yearMonth) };
}

/** 年初来 (1月1日〜当月末) */
export function yearToDatePeriod(yearMonth: YearMonth): Period {
  return { from: `${yearMonth.slice(0, 4)}-01-01`, to: endOfMonth(yearMonth) };
}

/**
 * 集計対象の売上かどうか。
 * CANCELLED は取消 (0円扱い)、REFUNDED は一部返金なので純額で集計する。
 * どちらも行自体は削除せず監査可能な状態で残す。
 */
function isCounted(sale: SaleEvaluationInput): boolean {
  return sale.status === 'ACTIVE' || sale.status === 'REFUNDED';
}

/**
 * 評価に計上する金額。キャンセル済みは 0 円として扱う (行は削除しない)。
 * 消費税・決済手数料を差し引くかどうかはルールの amountBasis に従う。
 */
export function evaluationAmount(sale: SaleEvaluationInput, rules: EvaluationRules): number {
  if (sale.status === 'CANCELLED') return 0;
  const grossMinusRefund = Math.max(0, sale.amount - sale.refundAmount);
  if (rules.sales.amountBasis !== 'NET') return grossMinusRefund;
  return Math.max(0, grossMinusRefund - sale.taxAmount - sale.paymentFee);
}

/** 純額 (売価 − 税 − 決済手数料 − 返金)。報酬計算や分析の参照用 */
export function netAmount(sale: SaleEvaluationInput): number {
  if (sale.status === 'CANCELLED') return 0;
  return Math.max(0, sale.amount - sale.taxAmount - sale.paymentFee - sale.refundAmount);
}

export function salesInPeriod(sales: SaleEvaluationInput[], period: Period): SaleEvaluationInput[] {
  return sales.filter((s) => isWithin(s.soldOn, period.from, period.to));
}

/** 売上点の対象になる売上のみを抽出 (商品マスタのフラグ + SNS経由の除外設定) */
export function scoreTargetSales(sales: SaleEvaluationInput[], rules: EvaluationRules): SaleEvaluationInput[] {
  return sales
    .filter(isCounted)
    .filter((s) => s.isSalesScoreTarget)
    .filter((s) => rules.sales.includeCoachSns || s.acquisitionSource !== 'COACH_SNS');
}

export function sumEvaluationAmount(sales: SaleEvaluationInput[], rules: EvaluationRules): number {
  return sales.reduce((total, sale) => total + evaluationAmount(sale, rules), 0);
}

/** 期間の売上集計 (点数は付けない。ダッシュボードの金額表示用) */
/**
 * 成約ショットインセンティブを支給する売上か。
 *
 * インセンティブは「成約したこと」に対する報酬なので、一部返金が出ても
 * 成約自体は残っている限り支給を維持する (既定)。
 * 取消・全額返金の場合は成約が無かったものとして支給しない。
 * 制度上の判断が変わる場合は rules.sales.incentiveOnRefund で切り替える。
 */
function hasIncentive(sale: SaleEvaluationInput, rules: EvaluationRules): boolean {
  if (sale.status === 'ACTIVE') return true;
  if (sale.status === 'CANCELLED') return false;
  if (rules.sales.incentiveOnRefund === 'FORFEIT') return false;
  return sale.amount - sale.refundAmount > 0;
}

export function aggregateSales(
  sales: SaleEvaluationInput[],
  period: Period,
  rules: EvaluationRules,
): Omit<SalesResult, 'score'> {
  const inPeriod = salesInPeriod(sales, period);
  const target = scoreTargetSales(inPeriod, rules);

  return {
    amount: sumEvaluationAmount(target, rules),
    grossAmount: sumEvaluationAmount(inPeriod.filter(isCounted), rules),
    netAmount: inPeriod.filter(isCounted).reduce((total, sale) => total + netAmount(sale), 0),
    coachSnsAmount: sumEvaluationAmount(
      inPeriod.filter((s) => isCounted(s) && s.acquisitionSource === 'COACH_SNS'),
      rules,
    ),
    incentiveTotal: inPeriod
      .filter((sale) => hasIncentive(sale, rules))
      .reduce((total, sale) => total + sale.incentiveAmount, 0),
  };
}

/**
 * 売上点 (仕様12・14・15章)。
 * 月次スコアの基準は scoreBasis で切り替える (MONTHLY = 当月 / ROLLING_3M = 直近3ヶ月)。
 */
export function calcSalesScore(
  sales: SaleEvaluationInput[],
  yearMonth: YearMonth,
  rules: EvaluationRules,
): SalesResult {
  const useRolling = rules.sales.scoreBasis === 'ROLLING_3M';
  const scoringPeriod = useRolling ? rollingPeriod(yearMonth, 3) : monthPeriod(yearMonth);
  const anchors = useRolling ? rules.sales.quarterly.anchors : rules.sales.monthly.anchors;

  const scoring = aggregateSales(sales, scoringPeriod, rules);
  // 表示上の「今月売上」は常に当月。スコア基準が3ヶ月でも金額表示は当月に揃える
  const display = useRolling ? aggregateSales(sales, monthPeriod(yearMonth), rules) : scoring;

  return {
    ...display,
    amount: display.amount,
    score: round1(interpolateScore(scoring.amount, anchors, rules.sales.max)),
  };
}
