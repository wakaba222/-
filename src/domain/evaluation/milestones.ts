/**
 * 「あとどのくらいで、どんないいことがあるか」を組み立てる (表示専用)。
 *
 * 評価そのものには一切関与しない。既に算出済みの数字を入力として受け取り、
 * 「次の一歩」と「その見返り」を文言にするだけの純粋な処理。
 * 閾値・配点・金額は全てルール (EvaluationRules) から導出し、ここに数値を持たない。
 */
import type { BonusResult, ProfessionalLevel, PromotionResult } from '../types';
import { nextLevel } from '../types';
import { resolveLessonUnitPrice } from './compensation';
import { interpolateScore, round1, type Anchor } from './interpolate';
import { promotionRuleKey, type EvaluationRules } from './rules';

export type MilestoneCode = 'SALES' | 'LONG_TERM' | 'SHORT_TERM' | 'BONUS' | 'PROMOTION';

export interface Milestone {
  code: MilestoneCode;
  /** 何の話か (例: 「売上」) */
  category: string;
  /** あと何をすればよいか (例: 「あと 155万円」) */
  action: string;
  /** 「あと」の数量だけを取り出したもの (例: 「155万円」)。大きく見せる用 */
  gap: string;
  /** それで何が起きるか (例: 「売上点 +9.0点」) */
  reward: string;
  /** 目標までの進み具合 (0〜1)。バー表示に使う */
  progress: number;
  /** 進捗バーの脇に出す現在地と目標 (例: 「45万円」「200万円」) */
  progressLabel: { current: string; target: string };
  /** 既に条件を満たしているか (「あと○○」ではなく達成表示にする) */
  achieved: boolean;
  /** 補足 (任意) */
  note?: string;
}

/** 0〜1 に収める。分母0でも壊れないようにする */
function ratio(current: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.min(Math.max(current / target, 0), 1);
}

/** 次に超えるアンカーを探す。既に最大アンカーに届いていれば null */
function nextAnchorAbove(value: number, anchors: readonly Anchor[]): Anchor | null {
  const above = [...anchors].sort((a, b) => a[0] - b[0]).filter(([x]) => x > value);
  return above[0] ?? null;
}

function formatManYen(amount: number): string {
  return `${Math.round(amount / 10_000).toLocaleString('ja-JP')}万円`;
}

function formatPoint(value: number): string {
  return `${round1(value)}点`;
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

/**
 * 売上: 次の売上アンカーまでの金額と、そこで増える点数。
 * 判定に使う期間 (当月 / 直近3ヶ月) はルールの scoreBasis に従う。
 */
export function nextSalesMilestone(scoringAmount: number, rules: EvaluationRules): Milestone | null {
  const useRolling = rules.sales.scoreBasis === 'ROLLING_3M';
  const anchors = useRolling ? rules.sales.quarterly.anchors : rules.sales.monthly.anchors;
  const target = nextAnchorAbove(scoringAmount, anchors);
  if (!target) return null;

  const currentScore = interpolateScore(scoringAmount, anchors, rules.sales.max);
  const nextScore = interpolateScore(target[0], anchors, rules.sales.max);
  const gain = nextScore - currentScore;
  if (gain <= 0) return null;

  return {
    code: 'SALES',
    category: useRolling ? '直近3ヶ月の売上' : '今月の売上',
    action: `あと ${formatManYen(target[0] - scoringAmount)}`,
    gap: formatManYen(target[0] - scoringAmount),
    reward: `売上点 +${formatPoint(gain)}`,
    achieved: false,
    progress: ratio(scoringAmount, target[0]),
    progressLabel: { current: formatManYen(scoringAmount), target: formatManYen(target[0]) },
    note: `${formatManYen(target[0])} に届くと 売上点が ${formatPoint(nextScore)} になります`,
  };
}

/** 成果率を次のアンカーへ乗せるのに必要な達成人数 */
function customersNeededFor(rate: number, targetCount: number, achievedCount: number): number {
  return Math.max(0, Math.ceil(rate * targetCount) - achievedCount);
}

function rateMilestone(
  code: 'LONG_TERM' | 'SHORT_TERM',
  category: string,
  achievedCount: number,
  targetCount: number,
  anchors: readonly Anchor[],
  max: number,
): Milestone | null {
  if (targetCount <= 0) return null;

  const currentRate = achievedCount / targetCount;
  const currentScore = interpolateScore(currentRate, anchors, max);

  // 「もう1名達成する」ことで届く一番近いアンカーを探す
  for (const [rate, ] of [...anchors].sort((a, b) => a[0] - b[0])) {
    if (rate <= currentRate) continue;
    const needed = customersNeededFor(rate, targetCount, achievedCount);
    if (needed <= 0) continue;

    const reachedRate = (achievedCount + needed) / targetCount;
    const gain = interpolateScore(reachedRate, anchors, max) - currentScore;
    if (gain <= 0) continue;

    const goalCount = achievedCount + needed;
    return {
      code,
      category,
      action: `あと ${needed}名`,
      gap: `${needed}名`,
      reward: `${category}点 +${formatPoint(gain)}`,
      achieved: false,
      progress: ratio(achievedCount, goalCount),
      progressLabel: { current: `${achievedCount}名`, target: `${goalCount}名` },
      note: `達成率 ${formatPercent(currentRate)} → ${formatPercent(reachedRate)} になります`,
    };
  }
  return null;
}

/** 長期 (完全成果率) の次の一歩 */
export function nextLongTermMilestone(
  achievedCount: number,
  targetCount: number,
  rules: EvaluationRules,
): Milestone | null {
  return rateMilestone(
    'LONG_TERM',
    '長期成果',
    achievedCount,
    targetCount,
    rules.customerSuccess.longTerm.anchors,
    rules.customerSuccess.longTerm.max,
  );
}

/** 短期 (直近3ヶ月成果率) の次の一歩 */
export function nextShortTermMilestone(
  achievedCount: number,
  targetCount: number,
  rules: EvaluationRules,
): Milestone | null {
  return rateMilestone(
    'SHORT_TERM',
    '短期成果',
    achievedCount,
    targetCount,
    rules.customerSuccess.shortTerm.anchors,
    rules.customerSuccess.shortTerm.max,
  );
}

/**
 * 四半期ボーナス: 次の支給ラインまでの点数と、増える金額。
 * 判定は3ヶ月平均で行うため、単月のスコアではなく平均を入力に取る。
 */
export function nextBonusMilestone(bonus: BonusResult, rules: EvaluationRules): Milestone | null {
  const tiers = [...rules.quarterlyBonus].sort((a, b) => a.min - b.min);

  if (bonus.average === null) {
    const first = tiers.find((t) => t.amount > 0);
    if (!first) return null;
    return {
      code: 'BONUS',
      category: '四半期ボーナス',
      action: 'まず月次評価を積み上げる',
      gap: `平均 ${first.min}点`,
      reward: `${first.amount.toLocaleString('ja-JP')}円`,
      achieved: false,
      progress: 0,
      progressLabel: { current: '—', target: `${first.min}点` },
      note: '月次締めが済んだ月の平均で判定します',
    };
  }

  const next = tiers.find((t) => t.min > bonus.average!);
  if (!next) return null;
  const gain = next.amount - bonus.amount;
  if (gain <= 0) return null;

  return {
    code: 'BONUS',
    category: '四半期ボーナス',
    action: `3ヶ月平均を あと ${formatPoint(next.min - bonus.average)}`,
    gap: formatPoint(next.min - bonus.average),
    reward: `+${gain.toLocaleString('ja-JP')}円`,
    achieved: false,
    progress: ratio(bonus.average, next.min),
    progressLabel: { current: `${round1(bonus.average)}点`, target: `${next.min}点` },
    note: `3ヶ月平均が ${next.min}点 に届くと ${next.amount.toLocaleString('ja-JP')}円 になります`,
  };
}

/**
 * 昇格: 残っている条件と、昇格して得られるもの。
 *
 * レッスン単価は「コーチ個別の設定」が「ランク標準」より優先される。
 * そのため、昇格しても本人の単価が上がるとは限らない
 * (個別に高い単価が設定されている場合など)。
 * 実際に上がる場合だけ金額を示し、そうでなければ金額を約束しない。
 */
export function promotionMilestone(
  level: ProfessionalLevel,
  promotion: PromotionResult,
  rules: EvaluationRules,
  coachUnitPrice?: number | null,
): Milestone | null {
  const toLevel = nextLevel(level);
  if (toLevel === null || promotion.status === 'MAX_LEVEL') return null;

  const currentPrice = resolveLessonUnitPrice(coachUnitPrice, level, rules);
  const nextStandard = rules.lessonUnitPrice[toLevel];
  const rise = nextStandard - currentPrice;

  const reward =
    rise > 0 ? `${toLevel} 昇格・単価 +${rise.toLocaleString('ja-JP')}円` : `${toLevel} へ昇格`;

  const rule = rules.promotion[promotionRuleKey(level, toLevel)];
  const note = rule?.requiresAdminApproval ? '昇格には最終承認が必要です' : undefined;

  const total = promotion.conditions.length;
  const met = total - promotion.shortfalls.length;

  if (promotion.shortfalls.length === 0) {
    return {
      code: 'PROMOTION',
      category: '昇格',
      action: '条件を全て満たしています',
      gap: '条件クリア',
      reward,
      achieved: true,
      progress: 1,
      progressLabel: { current: `${met}件`, target: `${total}件` },
      note: note ?? '次回の月次締めで昇格候補になります',
    };
  }

  // 条件の全文は下の「昇格までの条件」に出るため、ここでは一番近い1件だけに絞る。
  // スマホで3行に折り返すと「次の一歩」として読み流せなくなるため。
  const [nearest, ...rest] = promotion.shortfalls;
  const others = rest.length > 0 ? ` ほか${rest.length}件` : '';
  const action = `${nearest!.label} を ${nearest!.requiredLabel}${others}`;

  return {
    code: 'PROMOTION',
    category: '昇格',
    action,
    gap: `${promotion.shortfalls.length}条件`,
    reward,
    achieved: false,
    progress: ratio(met, total),
    progressLabel: { current: `${met}件`, target: `${total}件` },
    note: note ?? `${nearest!.label} は現在 ${nearest!.currentLabel}`,
  };
}

export interface MilestoneInput {
  level: ProfessionalLevel;
  /** コーチ個別のレッスン単価。昇格で単価が上がるかどうかの判定に使う */
  lessonUnitPrice?: number | null;
  /** 売上点の判定に使っている期間の税抜売上 */
  salesScoringAmount: number;
  longTerm: { achievedCount: number; targetCount: number };
  shortTerm: { achievedCount: number; targetCount: number };
  bonus: BonusResult;
  promotion: PromotionResult;
}

/**
 * コーチ画面に出す「次の一歩」を、効果の大きい順に並べて返す。
 *
 * 並び順は「金額で示せるもの → 点数で示せるもの」。
 * コーチが今日から動ける行動 (成果を出す・売上をつくる) を上に置く。
 */
export function buildMilestones(input: MilestoneInput, rules: EvaluationRules): Milestone[] {
  const candidates = [
    nextLongTermMilestone(input.longTerm.achievedCount, input.longTerm.targetCount, rules),
    nextShortTermMilestone(input.shortTerm.achievedCount, input.shortTerm.targetCount, rules),
    nextSalesMilestone(input.salesScoringAmount, rules),
    nextBonusMilestone(input.bonus, rules),
    promotionMilestone(input.level, input.promotion, rules, input.lessonUnitPrice),
  ];
  return candidates.filter((m): m is Milestone => m !== null);
}
