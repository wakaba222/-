import { describe, expect, it } from 'vitest';
import {
  calcCustomerSuccess,
  calcLongTerm,
  calcProfessionalScore,
  calcQuarterlyBonus,
  calcSalesScore,
  calcShortTerm,
  countNeededForRate,
  DEFAULT_EVALUATION_RULES as RULES,
  evaluatePromotion,
  interpolateScore,
  isEligibleForEvaluation,
  judgeCompleteSuccess,
  aggregateSales,
  monthPeriod,
} from './index';
import { endOfMonth } from '../date';
import type {
  CustomerEvaluationInput,
  ProfessionalLevel,
  SaleEvaluationInput,
  SnapshotSummary,
} from '../types';

/** テスト用の顧客ビルダー。既定は「承認済み・スコア目標100・開始2026-01-01」 */
function customer(overrides: Partial<CustomerEvaluationInput> = {}): CustomerEvaluationInput {
  return {
    id: crypto.randomUUID(),
    name: 'テスト顧客',
    programStartDate: '2026-01-01',
    programEndDate: '2026-06-30',
    status: 'ACTIVE',
    cancelReasonCode: null,
    statusChangedOn: null,
    goalApprovalStatus: 'APPROVED',
    goalType: 'SCORE',
    targetScore: 100,
    targetDistance: null,
    completeSuccessAt: null,
    suspendedDays: 0,
    ...overrides,
  };
}

/** achieved 人が達成済みの顧客を total 人つくる */
function customers(total: number, achieved: number, achievedOn = '2026-05-20'): CustomerEvaluationInput[] {
  return Array.from({ length: total }, (_, i) =>
    customer({ completeSuccessAt: i < achieved ? achievedOn : null }),
  );
}

function sale(overrides: Partial<SaleEvaluationInput> = {}): SaleEvaluationInput {
  return {
    id: crypto.randomUUID(),
    coachId: 'coach-1',
    soldOn: '2026-05-10',
    amount: 498_000,
    refundAmount: 0,
    incentiveAmount: 10_000,
    status: 'ACTIVE',
    acquisitionSource: 'EXISTING',
    isSalesScoreTarget: true,
    ...overrides,
  };
}

function snapshot(yearMonth: string, score: number | null, longTermRate: number | null = 0.9): SnapshotSummary {
  return {
    yearMonth,
    professionalScore: score,
    longTermSuccessRate: longTermRate,
    isEvaluable: score !== null,
  };
}

// ---------------------------------------------------------------------------
// 仕様35章 必須テストケース
// ---------------------------------------------------------------------------

describe('Case 1-2: 評価対象判定 (開始4ヶ月ルール)', () => {
  // 仕様7章「開始から4ヶ月後以降」= 満4ヶ月経過。Case 1 と Case 2 を同時に満たすのはこの解釈のみ
  it('Case 1: 開始から3ヶ月は評価対象外', () => {
    const c = customer({ programStartDate: '2026-01-01' });
    expect(isEligibleForEvaluation(c, '2026-04-01', RULES)).toBe(false);
    expect(isEligibleForEvaluation(c, endOfMonth('2026-04'), RULES)).toBe(false);
  });

  it('Case 2: 開始から4ヶ月で評価対象', () => {
    const c = customer({ programStartDate: '2026-01-01' });
    expect(isEligibleForEvaluation(c, '2026-05-01', RULES)).toBe(true);
    expect(isEligibleForEvaluation(c, endOfMonth('2026-05'), RULES)).toBe(true);
  });

  it('4ヶ月目の応当日前は対象外 (2026-01-15 開始 → 2026-05-14 は3ヶ月)', () => {
    const c = customer({ programStartDate: '2026-01-15' });
    expect(isEligibleForEvaluation(c, '2026-05-14', RULES)).toBe(false);
    expect(isEligibleForEvaluation(c, '2026-05-15', RULES)).toBe(true);
  });

  it('目標がADMIN未承認なら評価対象にならない', () => {
    const c = customer({ goalApprovalStatus: 'PENDING' });
    expect(isEligibleForEvaluation(c, endOfMonth('2026-08'), RULES)).toBe(false);
  });
});

describe('Case 3: プログラム終了後の達成も完全成果に加算される', () => {
  it('6月終了・8月達成が8月時点の完全成果率に反映される', () => {
    const list = [
      customer({ status: 'COMPLETED', completeSuccessAt: '2026-08-15' }),
      customer({ status: 'COMPLETED', completeSuccessAt: null }),
    ];

    const july = calcLongTerm(list, '2026-07', RULES);
    expect(july.achievedCount).toBe(0);
    expect(july.rate).toBe(0);

    const august = calcLongTerm(list, '2026-08', RULES);
    expect(august.targetCount).toBe(2);
    expect(august.achievedCount).toBe(1);
    expect(august.rate).toBe(0.5);
  });
});

describe('Case 4-5: 長期 完全成果率の配点', () => {
  it('Case 4: 完全成果率90% → 30点', () => {
    const result = calcLongTerm(customers(10, 9), '2026-05', RULES);
    expect(result.rate).toBeCloseTo(0.9);
    expect(result.score).toBe(30);
  });

  it('Case 5: 完全成果率100% → 36点', () => {
    const result = calcLongTerm(customers(10, 10), '2026-05', RULES);
    expect(result.rate).toBe(1);
    expect(result.score).toBe(36);
  });

  it('95%は30点と36点の中間 (33点)', () => {
    const result = calcLongTerm(customers(20, 19), '2026-05', RULES);
    expect(result.score).toBe(33);
  });

  it('36点を超えることはない', () => {
    expect(interpolateScore(1.5, RULES.customerSuccess.longTerm.anchors, 36)).toBe(36);
  });
});

describe('Case 6-7: 短期 直近3ヶ月成果率の配点', () => {
  it('Case 6: 短期成果率90% → 20点', () => {
    const result = calcShortTerm(customers(10, 9, '2026-05-20'), '2026-05', RULES);
    expect(result.rate).toBeCloseTo(0.9);
    expect(result.score).toBe(20);
  });

  it('Case 7: 短期成果率100% → 24点', () => {
    const result = calcShortTerm(customers(10, 10, '2026-05-20'), '2026-05', RULES);
    expect(result.rate).toBe(1);
    expect(result.score).toBe(24);
  });

  it('期間前に達成済みの顧客は短期の分母から外れる', () => {
    const list = [
      ...customers(3, 3, '2026-01-10'), // 期間 (3-5月) より前に達成
      ...customers(2, 1, '2026-04-10'), // 期間中に1名達成、1名未達
    ];
    const result = calcShortTerm(list, '2026-05', RULES);
    expect(result.targetCount).toBe(2);
    expect(result.achievedCount).toBe(1);
    expect(result.rate).toBe(0.5);
  });
});

describe('Case 8-9: Professional Score', () => {
  it('Case 8: 顧客成果50 + 売上50 → 100点', () => {
    const list = customers(10, 9, '2026-05-20'); // 長期90%=30点 / 短期90%=20点
    const success = calcCustomerSuccess(list, '2026-05', RULES);
    expect(success.score).toBe(50);

    const sales = calcSalesScore([sale({ amount: 3_500_000, soldOn: '2026-05-10' })], '2026-05', RULES);
    expect(sales.score).toBe(50);

    const ps = calcProfessionalScore(success, sales, RULES);
    expect(ps.score).toBe(100);
    expect(ps.band).toBe('非常に高成果');
  });

  it('Case 9: 顧客成果60 + 売上60 → 120点', () => {
    const list = customers(10, 10, '2026-05-20'); // 長期100%=36点 / 短期100%=24点
    const success = calcCustomerSuccess(list, '2026-05', RULES);
    expect(success.score).toBe(60);

    const sales = calcSalesScore([sale({ amount: 5_000_000, soldOn: '2026-05-10' })], '2026-05', RULES);
    expect(sales.score).toBe(60);

    const ps = calcProfessionalScore(success, sales, RULES);
    expect(ps.score).toBe(120);
    expect(ps.band).toBe('最高評価');
  });

  it('売上200万は40点 (Professional Score 80点水準の半分)', () => {
    const sales = calcSalesScore([sale({ amount: 2_000_000, soldOn: '2026-05-10' })], '2026-05', RULES);
    expect(sales.score).toBe(40);
  });

  it('売上が基準を大きく超えても60点を超えない', () => {
    const sales = calcSalesScore([sale({ amount: 20_000_000, soldOn: '2026-05-10' })], '2026-05', RULES);
    expect(sales.score).toBe(60);
  });
});

describe('Case 10: 四半期成果ボーナス', () => {
  it('3ヶ月平均105 → 100,000円', () => {
    const result = calcQuarterlyBonus(
      [snapshot('2026-03', 100), snapshot('2026-04', 105), snapshot('2026-05', 110)],
      RULES,
    );
    expect(result.average).toBe(105);
    expect(result.amount).toBe(100_000);
  });

  it('単月120でも平均が85なら30,000円', () => {
    const result = calcQuarterlyBonus(
      [snapshot('2026-03', 120), snapshot('2026-04', 70), snapshot('2026-05', 65)],
      RULES,
    );
    expect(result.average).toBe(85);
    expect(result.amount).toBe(30_000);
  });

  it('有効月が1ヶ月以下なら支給判定しない', () => {
    const result = calcQuarterlyBonus([snapshot('2026-05', 120), snapshot('2026-04', null)], RULES);
    expect(result.status).toBe('EVALUATION_INSUFFICIENT');
    expect(result.amount).toBe(0);
  });
});

describe('Case 11: 成約ショットインセンティブ', () => {
  it('HIGH PERFORMANCE 成約で50,000円', () => {
    const list = [sale({ amount: 2_000_000, incentiveAmount: 50_000, soldOn: '2026-05-10' })];
    const aggregated = aggregateSales(list, monthPeriod('2026-05'), RULES);
    expect(aggregated.incentiveTotal).toBe(50_000);
  });

  it('キャンセルされた売上のインセンティブは加算しない', () => {
    const list = [sale({ incentiveAmount: 50_000, status: 'CANCELLED' })];
    expect(aggregateSales(list, monthPeriod('2026-05'), RULES).incentiveTotal).toBe(0);
  });
});

describe('Case 12-13: 昇格判定', () => {
  const p2Snapshots = [snapshot('2026-03', 100, 0.9), snapshot('2026-04', 100, 0.9), snapshot('2026-05', 100, 0.9)];

  it('Case 12: P2→P3 で条件が1つ不足なら昇格不可', () => {
    const result = evaluatePromotion(
      {
        level: 'P2',
        snapshots: p2Snapshots,
        behaviorStatus: 'OK',
        requirementCounts: { SENIOR_ACTIVITY: 1 }, // 必要2件に対し1件
      },
      RULES,
    );
    expect(result.status).toBe('NOT_ELIGIBLE');
    expect(result.shortfalls.map((s) => s.code)).toEqual(['SENIOR_ACTIVITY']);
  });

  it('Case 13: 全条件を満たせば昇格候補', () => {
    const result = evaluatePromotion(
      { level: 'P2', snapshots: p2Snapshots, behaviorStatus: 'OK', requirementCounts: { SENIOR_ACTIVITY: 2 } },
      RULES,
    );
    expect(result.status).toBe('CANDIDATE');
    expect(result.shortfalls).toHaveLength(0);
    expect(result.threeMonthAverage).toBe(100);
  });

  it('行動ルールNGなら他の条件を満たしても昇格不可', () => {
    const result = evaluatePromotion(
      { level: 'P2', snapshots: p2Snapshots, behaviorStatus: 'NG', requirementCounts: { SENIOR_ACTIVITY: 2 } },
      RULES,
    );
    expect(result.status).toBe('NOT_ELIGIBLE');
    expect(result.shortfalls.map((s) => s.code)).toContain('BEHAVIOR');
  });

  it('3ヶ月連続条件は1ヶ月でも下回ると未達 (平均は満たしていても)', () => {
    const result = evaluatePromotion(
      {
        level: 'P1',
        snapshots: [snapshot('2026-03', 79), snapshot('2026-04', 100), snapshot('2026-05', 100)],
        behaviorStatus: 'OK',
        requirementCounts: {},
      },
      RULES,
    );
    // 平均93点 (>=90) だが、79点の月があるため連続条件で不可
    expect(result.shortfalls.map((s) => s.code)).toEqual(['CONSECUTIVE']);
    expect(result.status).toBe('NOT_ELIGIBLE');
  });

  it('スナップショットが3ヶ月分に満たない場合は昇格不可', () => {
    const result = evaluatePromotion(
      { level: 'P1', snapshots: [snapshot('2026-05', 120)], behaviorStatus: 'OK', requirementCounts: {} },
      RULES,
    );
    expect(result.status).toBe('NOT_ELIGIBLE');
  });

  it('P3→P4 は全条件達成でもADMIN承認が必要', () => {
    const result = evaluatePromotion(
      {
        level: 'P3',
        snapshots: [snapshot('2026-03', 110, 0.95), snapshot('2026-04', 110, 0.95), snapshot('2026-05', 110, 0.95)],
        behaviorStatus: 'OK',
        requirementCounts: { OWN_BUSINESS_RESULT: 1 },
      },
      RULES,
    );
    expect(result.status).toBe('CANDIDATE_REQUIRES_APPROVAL');
  });

  it('P4は最上位のため昇格判定を行わない', () => {
    const result = evaluatePromotion(
      { level: 'P4' as ProfessionalLevel, snapshots: [], behaviorStatus: 'OK', requirementCounts: {} },
      RULES,
    );
    expect(result.status).toBe('MAX_LEVEL');
  });
});

// ---------------------------------------------------------------------------
// 仕様36章 異常系
// ---------------------------------------------------------------------------

describe('異常系: 評価対象が0人', () => {
  it('長期の対象0人は 0点ではなく N/A', () => {
    const result = calcLongTerm([customer({ programStartDate: '2026-04-01' })], '2026-05', RULES);
    expect(result.evaluable).toBe(false);
    expect(result.rate).toBeNull();
    expect(result.score).toBeNull();
  });

  it('顧客成果が評価不能なら Professional Score も N/A (売上だけで点は付かない)', () => {
    const success = calcCustomerSuccess([], '2026-05', RULES);
    const sales = calcSalesScore([sale({ amount: 5_000_000 })], '2026-05', RULES);
    const ps = calcProfessionalScore(success, sales, RULES);
    expect(ps.evaluable).toBe(false);
    expect(ps.score).toBeNull();
    expect(ps.band).toBe('N/A');
  });

  it('顧客0人でも例外にならず 0除算も起きない', () => {
    expect(() => calcCustomerSuccess([], '2026-05', RULES)).not.toThrow();
    expect(countNeededForRate(0.9, 0, 0)).toBe(0);
  });
});

describe('異常系: 顧客ステータス', () => {
  it('休会中の顧客は分母から外れる', () => {
    const list = [customer({ status: 'SUSPENDED' }), ...customers(1, 1)];
    expect(calcLongTerm(list, '2026-05', RULES).targetCount).toBe(1);
  });

  it('休会日数分だけ評価対象になる時期が後ろにずれる', () => {
    const c = customer({ programStartDate: '2026-01-01', suspendedDays: 40 });
    expect(isEligibleForEvaluation(c, '2026-05-01', RULES)).toBe(false);
    expect(isEligibleForEvaluation(c, '2026-06-11', RULES)).toBe(true);
  });

  it('自己都合解約は分母から外れ、成果不振解約は分母に残る', () => {
    const self = customer({ status: 'CANCELLED', cancelReasonCode: 'SELF' });
    const performance = customer({ status: 'CANCELLED', cancelReasonCode: 'PERFORMANCE' });
    expect(calcLongTerm([self, performance], '2026-05', RULES).targetCount).toBe(1);
  });
});

describe('異常系: 売上のキャンセル・返金・SNS経由', () => {
  it('キャンセルされた売上は0円として扱う', () => {
    const sales = calcSalesScore([sale({ amount: 3_500_000, status: 'CANCELLED' })], '2026-05', RULES);
    expect(sales.amount).toBe(0);
    expect(sales.score).toBe(0);
  });

  it('返金は売上から相殺される', () => {
    const sales = calcSalesScore(
      [sale({ amount: 3_500_000, refundAmount: 1_500_000, status: 'REFUNDED' })],
      '2026-05',
      RULES,
    );
    expect(sales.amount).toBe(2_000_000);
    expect(sales.score).toBe(40);
  });

  it('SNS経由売上は既定で売上点から除外され、別枠で集計される', () => {
    const sales = calcSalesScore(
      [
        sale({ amount: 3_500_000, acquisitionSource: 'EXISTING' }),
        sale({ amount: 5_000_000, acquisitionSource: 'COACH_SNS' }),
      ],
      '2026-05',
      RULES,
    );
    expect(sales.amount).toBe(3_500_000);
    expect(sales.score).toBe(50);
    expect(sales.coachSnsAmount).toBe(5_000_000);
  });

  it('評価対象外商品の売上は売上点に含めない', () => {
    const sales = calcSalesScore([sale({ amount: 5_000_000, isSalesScoreTarget: false })], '2026-05', RULES);
    expect(sales.amount).toBe(0);
    expect(sales.grossAmount).toBe(5_000_000);
  });

  it('対象月以外の売上は当月の点数に影響しない', () => {
    const sales = calcSalesScore([sale({ amount: 5_000_000, soldOn: '2026-04-30' })], '2026-05', RULES);
    expect(sales.amount).toBe(0);
  });
});

describe('完全達成判定', () => {
  it('スコアは目標以下で達成', () => {
    expect(judgeCompleteSuccess({ score: 98, distance: null }, { goalType: 'SCORE', targetScore: 100, targetDistance: null }, RULES)).toBe(true);
    expect(judgeCompleteSuccess({ score: 101, distance: null }, { goalType: 'SCORE', targetScore: 100, targetDistance: null }, RULES)).toBe(false);
  });

  it('飛距離は目標以上で達成', () => {
    const goal = { goalType: 'DISTANCE' as const, targetScore: null, targetDistance: 250 };
    expect(judgeCompleteSuccess({ score: null, distance: 255 }, goal, RULES)).toBe(true);
    expect(judgeCompleteSuccess({ score: null, distance: 245 }, goal, RULES)).toBe(false);
  });

  it('BOTH は両方の達成が必要 (既定)', () => {
    const goal = { goalType: 'BOTH' as const, targetScore: 100, targetDistance: 250 };
    expect(judgeCompleteSuccess({ score: 98, distance: 255 }, goal, RULES)).toBe(true);
    expect(judgeCompleteSuccess({ score: 98, distance: 240 }, goal, RULES)).toBe(false);
  });

  it('BOTH を ANY 設定にすると片方の達成で成立する', () => {
    const anyRules = {
      ...RULES,
      customerSuccess: { ...RULES.customerSuccess, bothGoalRule: 'ANY' as const },
    };
    const goal = { goalType: 'BOTH' as const, targetScore: 100, targetDistance: 250 };
    expect(judgeCompleteSuccess({ score: 98, distance: 240 }, goal, anyRules)).toBe(true);
  });
});

describe('ダッシュボードの逆算表示', () => {
  it('34/39 (87.2%) から90%まではあと2名', () => {
    expect(countNeededForRate(0.9, 34, 39)).toBe(2);
  });

  it('既に達成している場合は0名', () => {
    expect(countNeededForRate(0.9, 10, 10)).toBe(0);
  });
});
