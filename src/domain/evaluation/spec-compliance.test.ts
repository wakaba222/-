import { describe, expect, it } from 'vitest';
import {
  aggregateSales,
  bandOf,
  calcQuarterlyBonus,
  calcSalesScore,
  DEFAULT_EVALUATION_RULES as RULES,
  evaluatePromotion,
  interpolateScore,
  maxProfessionalScore,
  monthPeriod,
  netAmount,
  round1,
  standardRateOf,
  deriveTaxAmount,
  evaluationAmount,
  taxExclusiveAmount,
  taxExclusiveRefund,
} from './index';
import type { EvaluationRules } from './rules';
import type { SaleEvaluationInput, SnapshotSummary } from '../types';

/**
 * 確定済み評価制度と実装の突合。
 * 経営側が決めた数値と、実際に給与・昇格へ反映される計算結果が
 * 1円・0.1点単位で一致することを検証する。
 */

const LONG = RULES.customerSuccess.longTerm;
const SHORT = RULES.customerSuccess.shortTerm;
const SALES = RULES.sales;

function snapshot(yearMonth: string, score: number | null, longTermRate: number | null = 0.9): SnapshotSummary {
  return { yearMonth, professionalScore: score, longTermSuccessRate: longTermRate, isEvaluable: score !== null };
}

function sale(overrides: Partial<SaleEvaluationInput> = {}): SaleEvaluationInput {
  return {
    id: crypto.randomUUID(),
    coachId: 'coach-1',
    soldOn: '2026-05-10',
    amount: 1_000_000,
    refundAmount: 0,
    taxAmount: 0,
    paymentFee: 0,
    incentiveAmount: 0,
    paymentSource: 'MANUAL',
    status: 'ACTIVE',
    acquisitionSource: 'EXISTING',
    isSalesScoreTarget: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 長期・短期・売上の配点 (制度で定義された基準値との照合)
// ---------------------------------------------------------------------------

describe('長期｜完全成果率の配点', () => {
  it.each([
    [0, 0],
    [0.45, 15],
    [0.9, 30],
    [0.95, 33],
    [1.0, 36],
  ])('完全成果率 %s → %s点', (rate, expected) => {
    expect(interpolateScore(rate, LONG.anchors, LONG.max)).toBeCloseTo(expected, 5);
  });

  it('上限36点を超えない', () => {
    expect(interpolateScore(1.5, LONG.anchors, LONG.max)).toBe(36);
  });
});

describe('短期｜直近3ヶ月成果率の配点', () => {
  it.each([
    [0, 0],
    [0.45, 10],
    [0.9, 20],
    [0.95, 22],
    [1.0, 24],
  ])('短期成果率 %s → %s点', (rate, expected) => {
    expect(interpolateScore(rate, SHORT.anchors, SHORT.max)).toBeCloseTo(expected, 5);
  });

  it('上限24点を超えない', () => {
    expect(interpolateScore(1.5, SHORT.anchors, SHORT.max)).toBe(24);
  });
});

describe('売上の配点', () => {
  it.each([
    [0, 0],
    [1_000_000, 20],
    [2_000_000, 40],
    [2_750_000, 45],
    [3_500_000, 50],
    [4_250_000, 55],
    [5_000_000, 60],
    [6_000_000, 60],
  ])('月次売上 %s円 → %s点', (amount, expected) => {
    expect(interpolateScore(amount, SALES.monthly.anchors, SALES.max)).toBeCloseTo(expected, 5);
  });
});

describe('Professional Score の合成', () => {
  it('通常水準 (30 + 20 + 50) は100点', () => {
    expect(30 + 20 + 50).toBe(100);
    expect(bandOf(100, RULES)).toBe('非常に高成果');
  });

  it('最大 (36 + 24 + 60) は120点', () => {
    expect(maxProfessionalScore(RULES)).toBe(120);
    expect(bandOf(120, RULES)).toBe('最高評価');
  });

  it.each([
    [0, '基準未達'],
    [79.9, '基準未達'],
    [80, '基準クリア'],
    [89.9, '基準クリア'],
    [90, '高成果'],
    [99.9, '高成果'],
    [100, '非常に高成果'],
    [109.9, '非常に高成果'],
    [110, 'トップ水準'],
    [119.9, 'トップ水準'],
    [120, '最高評価'],
  ])('Score %s の区分は %s', (score, label) => {
    expect(bandOf(score, RULES)).toBe(label);
  });
});

// ---------------------------------------------------------------------------
// 四半期成果ボーナス
// ---------------------------------------------------------------------------

describe('四半期成果ボーナス', () => {
  it.each([
    [79, 0],
    [80, 30_000],
    [89, 30_000],
    [90, 50_000],
    [99, 50_000],
    [100, 100_000],
    [109, 100_000],
    [110, 150_000],
    [119, 150_000],
    [120, 200_000],
  ])('3ヶ月平均 %s点 → %s円', (average, expected) => {
    const result = calcQuarterlyBonus(
      [snapshot('2026-03', average), snapshot('2026-04', average), snapshot('2026-05', average)],
      RULES,
    );
    expect(result.average).toBe(average);
    expect(result.amount).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 昇格判定 (AND条件・一発成果で昇格させない)
// ---------------------------------------------------------------------------

describe('P1 → P2 の昇格', () => {
  const base = { level: 'P1' as const, behaviorStatus: 'OK' as const, requirementCounts: {} };

  it('80 / 90 / 100 (平均90) で行動OKなら昇格候補', () => {
    const result = evaluatePromotion(
      { ...base, snapshots: [snapshot('2026-03', 80), snapshot('2026-04', 90), snapshot('2026-05', 100)] },
      RULES,
    );
    expect(result.threeMonthAverage).toBe(90);
    expect(result.status).toBe('CANDIDATE');
  });

  it('1ヶ月でも79なら不可', () => {
    const result = evaluatePromotion(
      { ...base, snapshots: [snapshot('2026-03', 79), snapshot('2026-04', 100), snapshot('2026-05', 100)] },
      RULES,
    );
    expect(result.status).toBe('NOT_ELIGIBLE');
    expect(result.shortfalls.map((s) => s.code)).toContain('CONSECUTIVE');
  });

  it('平均89.9なら不可', () => {
    const result = evaluatePromotion(
      { ...base, snapshots: [snapshot('2026-03', 80), snapshot('2026-04', 89.7), snapshot('2026-05', 100)] },
      RULES,
    );
    expect(result.threeMonthAverage).toBe(89.9);
    expect(result.status).toBe('NOT_ELIGIBLE');
    expect(result.shortfalls.map((s) => s.code)).toContain('AVERAGE');
  });

  it('行動ルールNGなら不可', () => {
    const result = evaluatePromotion(
      {
        ...base,
        behaviorStatus: 'NG',
        snapshots: [snapshot('2026-03', 100), snapshot('2026-04', 100), snapshot('2026-05', 100)],
      },
      RULES,
    );
    expect(result.status).toBe('NOT_ELIGIBLE');
    expect(result.shortfalls.map((s) => s.code)).toContain('BEHAVIOR');
  });
});

describe('P2 → P3 の昇格', () => {
  const months = (rate: number) => [
    snapshot('2026-03', 100, rate),
    snapshot('2026-04', 100, rate),
    snapshot('2026-05', 100, rate),
  ];
  const base = { level: 'P2' as const, behaviorStatus: 'OK' as const, requirementCounts: { SENIOR_ACTIVITY: 2 } };

  it('100/100/100・完全成果率90%・行動OK・上位活動OKなら候補', () => {
    expect(evaluatePromotion({ ...base, snapshots: months(0.9) }, RULES).status).toBe('CANDIDATE');
  });

  it('完全成果率89.9%なら不可', () => {
    const result = evaluatePromotion({ ...base, snapshots: months(0.899) }, RULES);
    expect(result.status).toBe('NOT_ELIGIBLE');
    expect(result.shortfalls.map((s) => s.code)).toEqual(['LONG_TERM_RATE']);
  });

  it('上位活動が未達なら不可', () => {
    const result = evaluatePromotion(
      { ...base, requirementCounts: { SENIOR_ACTIVITY: 1 }, snapshots: months(0.9) },
      RULES,
    );
    expect(result.status).toBe('NOT_ELIGIBLE');
    expect(result.shortfalls.map((s) => s.code)).toEqual(['SENIOR_ACTIVITY']);
  });

  it('売上だけでは上位ランクへ上がれない (顧客成果の足切りが効く)', () => {
    // 売上満点60でも顧客成果が伴わなければ Score 100 には届かない
    const salesOnlyScore = 60 + interpolateScore(0.5, LONG.anchors, LONG.max);
    expect(salesOnlyScore).toBeLessThan(100);
  });
});

describe('評価不能(N/A)の月の扱い', () => {
  it('N/A の月は連続カウントを中断し、未達扱いにしない', () => {
    // 2月:90 → 3月:N/A → 4月:95 → 5月:92 のとき、評価可能な3ヶ月で判定する
    const result = evaluatePromotion(
      {
        level: 'P1',
        behaviorStatus: 'OK',
        requirementCounts: {},
        snapshots: [
          snapshot('2026-02', 90),
          snapshot('2026-03', null),
          snapshot('2026-04', 95),
          snapshot('2026-05', 92),
        ],
      },
      RULES,
    );
    expect(result.status).toBe('CANDIDATE');
    expect(result.threeMonthAverage).toBe(92.3);
  });

  it('評価可能な月が足りなければ昇格不可', () => {
    const result = evaluatePromotion(
      {
        level: 'P1',
        behaviorStatus: 'OK',
        requirementCounts: {},
        snapshots: [snapshot('2026-04', null), snapshot('2026-05', 120)],
      },
      RULES,
    );
    expect(result.status).toBe('NOT_ELIGIBLE');
    expect(result.shortfalls.map((s) => s.code)).toContain('CONSECUTIVE');
  });
});

// ---------------------------------------------------------------------------
// 売上の精算情報
// ---------------------------------------------------------------------------

describe('売上の精算情報', () => {
  it('純額は売価から税・決済手数料・返金を差し引く', () => {
    expect(netAmount(sale({ amount: 1_000_000, taxAmount: 90_000, paymentFee: 35_000, refundAmount: 100_000 })))
      .toBe(775_000);
  });

  it('既定では売上点は税抜売上ベース (決済手数料は引かない)', () => {
    const result = calcSalesScore([sale({ amount: 3_500_000, taxAmount: 318_181, paymentFee: 120_000 })], '2026-05', RULES);
    // 税抜 3,181,819。決済手数料 120,000 は控除しない
    expect(result.amount).toBe(3_181_819);
    expect(result.score).toBe(47.9);
    // 純額 (手数料も引いた額) は会社側の利益管理用に別途保持する
    expect(result.netAmount).toBe(3_061_819);
  });

  it('設定を GROSS_MINUS_REFUND に変えると税込の売価ベースになる', () => {
    const grossRules: EvaluationRules = { ...RULES, sales: { ...RULES.sales, amountBasis: 'GROSS_MINUS_REFUND' } };
    const result = calcSalesScore(
      [sale({ amount: 3_500_000, taxAmount: 318_181, paymentFee: 120_000 })],
      '2026-05',
      grossRules,
    );
    expect(result.amount).toBe(3_500_000);
    expect(result.score).toBe(50);
  });

  it('設定を NET に変えると純額ベースで採点される', () => {
    const netRules: EvaluationRules = { ...RULES, sales: { ...RULES.sales, amountBasis: 'NET' } };
    const result = calcSalesScore(
      [sale({ amount: 3_500_000, taxAmount: 318_181, paymentFee: 120_000 })],
      '2026-05',
      netRules,
    );
    expect(result.amount).toBe(3_061_819);
    // 保存・表示される点数は小数第1位に丸める
    expect(result.score).toBe(round1(interpolateScore(3_061_819, SALES.monthly.anchors, SALES.max)));
    expect(result.score).toBeLessThan(50); // 税・手数料の分だけ売価ベースより下がる
  });

  it('キャンセルされた売上は純額も0円', () => {
    expect(netAmount(sale({ amount: 1_000_000, status: 'CANCELLED' }))).toBe(0);
    expect(aggregateSales([sale({ status: 'CANCELLED' })], monthPeriod('2026-05'), RULES).netAmount).toBe(0);
  });
});

describe('制度の基準値がルールから導出されている', () => {
  it('「あと○名で90%」の基準はアンカーから導出される', () => {
    expect(standardRateOf(LONG.anchors)).toBe(0.9);
    expect(standardRateOf(SHORT.anchors)).toBe(0.9);
  });

  it('満点は各配点の上限の合計', () => {
    expect(maxProfessionalScore(RULES)).toBe(LONG.max + SHORT.max + SALES.max);
  });

  it('ランク別レッスン単価が制度どおり', () => {
    expect(RULES.lessonUnitPrice).toEqual({ P1: 0, P2: 10_000, P3: 12_000, P4: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// 売上Scoreの税抜化 (確定仕様)
//   Professional Score 対象売上 = 税抜売上 − 返金の税抜相当額
//   決済手数料は控除しない
// ---------------------------------------------------------------------------

describe('税込価格の商品から売上Scoreまでの一連の計算', () => {
  const TAX_RATE = 0.1;
  // 商品マスタの売価はいずれも税込 (仕様9章)
  const CATALOG = {
    RESTART: 498_000,
    BREAKTHROUGH: 899_000,
    HIGH_PERFORMANCE: 2_000_000,
  } as const;

  /** 商品マスタの売価から、DBトリガと同じ規則で売上1件を組み立てる */
  function saleOf(price: number, overrides: Partial<SaleEvaluationInput> = {}): SaleEvaluationInput {
    return sale({ amount: price, taxAmount: deriveTaxAmount(price, TAX_RATE, true), ...overrides });
  }

  it('① 税込売価から消費税を割り戻す', () => {
    expect(deriveTaxAmount(CATALOG.RESTART, TAX_RATE, true)).toBe(45_273);
    expect(deriveTaxAmount(CATALOG.BREAKTHROUGH, TAX_RATE, true)).toBe(81_727);
    expect(deriveTaxAmount(CATALOG.HIGH_PERFORMANCE, TAX_RATE, true)).toBe(181_818);
  });

  it('② 税抜売上を求める', () => {
    expect(taxExclusiveAmount(saleOf(CATALOG.RESTART))).toBe(452_727);
    expect(taxExclusiveAmount(saleOf(CATALOG.BREAKTHROUGH))).toBe(817_273);
    expect(taxExclusiveAmount(saleOf(CATALOG.HIGH_PERFORMANCE))).toBe(1_818_182);
  });

  it('③ 返金は税抜相当額に換算して控除する', () => {
    const refunded = saleOf(CATALOG.BREAKTHROUGH, { refundAmount: 400_000, status: 'REFUNDED' });
    // 400,000 × (817,273 / 899,000) = 363,636
    expect(taxExclusiveRefund(refunded)).toBe(363_636);
    expect(evaluationAmount(refunded, RULES)).toBe(453_637);
  });

  it('④ 決済手数料は売上Scoreから控除しない', () => {
    const withFee = saleOf(CATALOG.HIGH_PERFORMANCE, { paymentFee: 60_000 });
    expect(evaluationAmount(withFee, RULES)).toBe(1_818_182);
    // 会社側の利益管理に使う純額では手数料も差し引かれる
    expect(netAmount(withFee)).toBe(1_758_182);
  });

  it('⑤ 月間売上を合算して売上点を算出する', () => {
    const monthlySales = [
      saleOf(CATALOG.RESTART),
      saleOf(CATALOG.BREAKTHROUGH),
      saleOf(CATALOG.HIGH_PERFORMANCE),
    ];
    const result = calcSalesScore(monthlySales, '2026-05', RULES);

    // 452,727 + 817,273 + 1,818,182 = 3,088,182 (税抜)
    expect(result.amount).toBe(3_088_182);
    // 税込の総額も別途保持する
    expect(result.grossAmount).toBe(3_397_000);
    // 200万=40点 / 350万=50点 の区間を線形補間
    expect(result.score).toBe(47.3);
  });

  it('⑥ 返金を含む月でも合算から売上点まで通る', () => {
    const monthlySales = [
      saleOf(CATALOG.RESTART),
      saleOf(CATALOG.BREAKTHROUGH, { refundAmount: 400_000, status: 'REFUNDED' }),
      saleOf(CATALOG.HIGH_PERFORMANCE),
    ];
    const result = calcSalesScore(monthlySales, '2026-05', RULES);

    // 452,727 + 453,637 + 1,818,182 = 2,724,546
    expect(result.amount).toBe(2_724_546);
    expect(result.score).toBe(44.8);
  });

  it('⑦ 税抜価格の商品は売価がそのまま評価対象額になる', () => {
    const taxExclusiveProduct = sale({
      amount: 1_000_000,
      taxAmount: deriveTaxAmount(1_000_000, TAX_RATE, false),
    });
    expect(taxExclusiveProduct.taxAmount).toBe(0);
    expect(evaluationAmount(taxExclusiveProduct, RULES)).toBe(1_000_000);
  });

  it('⑧ 全額返金は評価対象額0円', () => {
    const fully = saleOf(CATALOG.RESTART, { refundAmount: CATALOG.RESTART, status: 'REFUNDED' });
    expect(evaluationAmount(fully, RULES)).toBe(0);
  });

  it('⑨ アンカーは税抜売上額の基準として扱われる', () => {
    // 税抜でちょうど350万を作ると50点になる
    const exact = sale({ amount: 3_850_000, taxAmount: 350_000 });
    expect(taxExclusiveAmount(exact)).toBe(3_500_000);
    expect(calcSalesScore([exact], '2026-05', RULES).score).toBe(50);
  });
});

describe('行動ルールの昇格可否 (確定仕様)', () => {
  const months = [snapshot('2026-03', 120), snapshot('2026-04', 120), snapshot('2026-05', 120)];

  it.each([
    ['OK', true],
    ['WARNING', false],
    ['NG', false],
  ])('行動ルール %s のとき昇格候補=%s', (status, expected) => {
    const result = evaluatePromotion(
      {
        level: 'P1',
        snapshots: months,
        behaviorStatus: status as 'OK' | 'WARNING' | 'NG',
        requirementCounts: {},
      },
      RULES,
    );
    expect(result.status === 'CANDIDATE').toBe(expected);
    if (!expected) expect(result.shortfalls.map((s) => s.code)).toContain('BEHAVIOR');
  });
});
