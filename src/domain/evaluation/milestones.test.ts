/**
 * 「あと○○で△△が良くなる」の表示内容を固定する。
 *
 * ここで出す数字は、実際の評価計算 (interpolateScore など) と同じ関数から
 * 導出していることが要点。表示だけ別の計算になっていると、
 * 「あと10万円で+2点」と言われて達成したのに点が増えない、が起きる。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_EVALUATION_RULES as RULES } from './rules';
import { interpolateScore } from './interpolate';
import {
  buildMilestones,
  nextBonusMilestone,
  nextLongTermMilestone,
  nextSalesMilestone,
  nextShortTermMilestone,
  promotionMilestone,
} from './milestones';
import type { BonusResult, PromotionResult } from '../types';

const bonusOf = (average: number | null, amount: number): BonusResult => ({
  amount,
  average,
  monthsUsed: average === null ? 0 : 3,
  status: average === null ? 'EVALUATION_INSUFFICIENT' : 'CALCULATED',
});

const promotionOf = (overrides: Partial<PromotionResult> = {}): PromotionResult => ({
  fromLevel: 'P1',
  toLevel: 'P2',
  status: 'NOT_ELIGIBLE',
  conditions: [],
  shortfalls: [],
  threeMonthAverage: null,
  ...overrides,
});

describe('売上の次の一歩', () => {
  it('次のアンカーまでの金額と、そこで増える点数を出す', () => {
    // 当月 45万円 → 次のアンカーは 200万円 (40点)
    const milestone = nextSalesMilestone(450_000, RULES);
    expect(milestone?.action).toBe('あと 155万円');

    const gain =
      interpolateScore(2_000_000, RULES.sales.monthly.anchors, RULES.sales.max) -
      interpolateScore(450_000, RULES.sales.monthly.anchors, RULES.sales.max);
    expect(milestone?.reward).toBe(`売上点 +${Math.round(gain * 10) / 10}点`);
  });

  it('示した金額に到達すると、実際に示した点数になる', () => {
    const current = 1_200_000;
    const milestone = nextSalesMilestone(current, RULES);
    // 「あと○○万円」を足した金額で計算し直すと、約束した点数と一致する
    const gapMan = Number(milestone!.action.replace(/[^\d]/g, ''));
    const reached = current + gapMan * 10_000;
    const promised = Number(milestone!.reward.replace(/[^\d.]/g, ''));
    const actual =
      interpolateScore(reached, RULES.sales.monthly.anchors, RULES.sales.max) -
      interpolateScore(current, RULES.sales.monthly.anchors, RULES.sales.max);
    expect(Math.round(actual * 10) / 10).toBe(promised);
  });

  it('最高アンカーに届いていれば、次の一歩は出さない', () => {
    expect(nextSalesMilestone(5_000_000, RULES)).toBeNull();
    expect(nextSalesMilestone(9_000_000, RULES)).toBeNull();
  });
});

describe('顧客成果の次の一歩', () => {
  it('あと何名の完全達成で何点増えるかを出す', () => {
    // 対象10名・達成8名 (80%) → 90%(9名) で 30点
    const milestone = nextLongTermMilestone(8, 10, RULES);
    expect(milestone?.action).toBe('あと 1名の完全達成');
    expect(milestone?.note).toContain('80%');
    expect(milestone?.note).toContain('90%');

    const gain =
      interpolateScore(0.9, RULES.customerSuccess.longTerm.anchors, RULES.customerSuccess.longTerm.max) -
      interpolateScore(0.8, RULES.customerSuccess.longTerm.anchors, RULES.customerSuccess.longTerm.max);
    expect(milestone?.reward).toBe(`長期成果点 +${Math.round(gain * 10) / 10}点`);
  });

  it('全員達成していれば、次の一歩は出さない', () => {
    expect(nextLongTermMilestone(10, 10, RULES)).toBeNull();
    expect(nextShortTermMilestone(6, 6, RULES)).toBeNull();
  });

  it('評価対象が0名なら出さない (0除算しない)', () => {
    expect(nextLongTermMilestone(0, 0, RULES)).toBeNull();
    expect(nextShortTermMilestone(0, 0, RULES)).toBeNull();
  });
});

describe('四半期ボーナスの次の一歩', () => {
  it('次の支給ラインまでの点数と、増える金額を出す', () => {
    // 平均85点 → 30,000円。次は90点で50,000円
    const milestone = nextBonusMilestone(bonusOf(85, 30_000), RULES);
    expect(milestone?.action).toBe('3ヶ月平均を あと 5点');
    expect(milestone?.reward).toBe('ボーナス +20,000円');
  });

  it('最高ラインに届いていれば出さない', () => {
    expect(nextBonusMilestone(bonusOf(120, 200_000), RULES)).toBeNull();
  });

  it('確定した評価がまだ無いときは、待てばよいことを示す', () => {
    const milestone = nextBonusMilestone(bonusOf(null, 0), RULES);
    expect(milestone?.action).toContain('待つ');
    expect(milestone?.reward).toContain('円');
  });
});

describe('昇格の次の一歩', () => {
  it('残っている条件と、昇格して得られるものを出す', () => {
    const milestone = promotionMilestone(
      'P1',
      promotionOf({
        shortfalls: [
          { code: 'AVG', label: '3ヶ月平均 Score', currentLabel: '85.0', requiredLabel: '90以上', met: false },
        ],
      }),
      RULES,
    );
    expect(milestone?.action).toContain('残り1条件');
    expect(milestone?.action).toContain('85.0 → 90以上');
    // P1(標準0円) → P2(標準10,000円) の差が「いいこと」として出る
    expect(milestone?.reward).toContain('P2');
    expect(milestone?.reward).toContain('10,000円');
  });

  it('個別単価が既に次ランクの標準以上なら、単価が上がるとは言わない', () => {
    // 松本さんのように P1 で個別に 12,000円 が設定されている場合、
    // P2 の標準 (10,000円) へ昇格しても単価は上がらない。嘘の期待を持たせない。
    const milestone = promotionMilestone('P1', promotionOf({ status: 'CANDIDATE' }), RULES, 12_000);
    expect(milestone?.reward).toBe('P2 へ昇格');
    expect(milestone?.reward).not.toContain('円');
  });

  it('個別単価が次ランクの標準より低ければ、その差額を示す', () => {
    const milestone = promotionMilestone('P1', promotionOf({ status: 'CANDIDATE' }), RULES, 8_000);
    expect(milestone?.reward).toContain('+2,000円');
  });

  it('条件を満たしていればその旨を出す', () => {
    const milestone = promotionMilestone('P1', promotionOf({ status: 'CANDIDATE' }), RULES);
    expect(milestone?.action).toBe('条件を全て満たしています');
  });

  it('最上位ランクなら出さない', () => {
    expect(promotionMilestone('P4', promotionOf({ status: 'MAX_LEVEL' }), RULES)).toBeNull();
  });
});

describe('一覧の組み立て', () => {
  it('該当するものだけが並ぶ', () => {
    const milestones = buildMilestones(
      {
        level: 'P1',
        salesScoringAmount: 450_000,
        longTerm: { achievedCount: 8, targetCount: 10 },
        shortTerm: { achievedCount: 5, targetCount: 6 },
        bonus: bonusOf(85, 30_000),
        promotion: promotionOf({ shortfalls: [] , status: 'CANDIDATE' }),
      },
      RULES,
    );
    expect(milestones.map((m) => m.code)).toEqual(['LONG_TERM', 'SHORT_TERM', 'SALES', 'BONUS', 'PROMOTION']);
    // どの行にも「あと何をするか」と「何が良くなるか」が入っている
    for (const m of milestones) {
      expect(m.action.length).toBeGreaterThan(0);
      expect(m.reward.length).toBeGreaterThan(0);
    }
  });

  it('全て達成済み・最上位なら空になる', () => {
    const milestones = buildMilestones(
      {
        level: 'P4',
        salesScoringAmount: 5_000_000,
        longTerm: { achievedCount: 10, targetCount: 10 },
        shortTerm: { achievedCount: 6, targetCount: 6 },
        bonus: bonusOf(120, 200_000),
        promotion: promotionOf({ status: 'MAX_LEVEL', toLevel: null }),
      },
      RULES,
    );
    expect(milestones).toEqual([]);
  });
});
