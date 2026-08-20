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

  it('既定では売上点は売価ベース (税・手数料を引かない)', () => {
    const result = calcSalesScore([sale({ amount: 3_500_000, taxAmount: 318_181, paymentFee: 120_000 })], '2026-05', RULES);
    expect(result.amount).toBe(3_500_000);
    expect(result.score).toBe(50);
    // 純額は別途保持され、報酬計算や分析に使える
    expect(result.netAmount).toBe(3_061_819);
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
