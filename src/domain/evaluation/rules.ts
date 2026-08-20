import { z } from 'zod';
import type { ProfessionalLevel } from '../types';

/**
 * 評価ルール定義。
 *
 * 閾値・配点・昇格基準は全てここ (= DB の evaluation_rules.rules) にあり、
 * コード中に数値リテラルを書かない。制度変更は新 version の登録だけで完結し、
 * 過去のスナップショットは当時の version を保持するため再計算されない。
 */

const anchorSchema = z.tuple([z.number(), z.number()]);
const anchorsSchema = z
  .array(anchorSchema)
  .min(2)
  .refine((anchors) => new Set(anchors.map((a) => a[0])).size === anchors.length, {
    message: 'アンカーの入力値が重複しています',
  });

export const evaluationRulesSchema = z.object({
  version: z.number().int().positive(),
  effectiveFrom: z.string(),

  eligibility: z.object({
    /** 顧客成果の評価対象になるまでの経過月数 (仕様7章: 4ヶ月) */
    minElapsedMonths: z.number().int().min(0),
    /** ADMIN 未承認の目標は評価に使わない (仕様6章) */
    requireGoalApproved: z.boolean(),
    /** 休会期間を経過月数にカウントするか */
    countSuspendedMonths: z.boolean(),
    /** 途中解約でも分母に残す解約理由コード */
    includeCancelledReasonCodes: z.array(z.enum(['SELF', 'PERFORMANCE', 'OTHER'])),
  }),

  customerSuccess: z.object({
    /** BOTH 目標の完全達成条件。ALL = 両方達成 */
    bothGoalRule: z.enum(['ALL', 'ANY']),
    longTerm: z.object({ anchors: anchorsSchema, max: z.number().positive() }),
    shortTerm: z.object({
      windowMonths: z.number().int().positive(),
      anchors: anchorsSchema,
      max: z.number().positive(),
    }),
  }),

  sales: z.object({
    /** コーチSNS経由売上を売上点に含めるか (MVP既定: false) */
    includeCoachSns: z.boolean(),
    /** 月次スコアの算定基準。MONTHLY = 当月売上 / ROLLING_3M = 直近3ヶ月売上 */
    scoreBasis: z.enum(['MONTHLY', 'ROLLING_3M']),
    monthly: z.object({ anchors: anchorsSchema }),
    quarterly: z.object({ anchors: anchorsSchema }),
    annual: z.object({ anchors: anchorsSchema }),
    max: z.number().positive(),
  }),

  scoreBands: z
    .array(z.object({ min: z.number(), max: z.number(), label: z.string() }))
    .min(1),

  quarterlyBonus: z.array(z.object({ min: z.number(), amount: z.number().min(0) })).min(1),

  promotion: z.record(
    z.string(),
    z.object({
      consecutiveMonths: z.number().int().positive(),
      consecutiveMinScore: z.number(),
      averageMonths: z.number().int().positive(),
      averageMinScore: z.number(),
      behaviorStatusAllowed: z.array(z.enum(['OK', 'WARNING', 'NG'])).min(1),
      minLongTermRate: z.number().min(0).max(1).nullable(),
      requiredChecks: z.array(
        z.object({ code: z.string(), label: z.string(), requiredCount: z.number().int().positive() }),
      ),
      requiresAdminApproval: z.boolean(),
    }),
  ),

  lessonUnitPrice: z.object({ P1: z.number(), P2: z.number(), P3: z.number(), P4: z.number() }),
});

export type EvaluationRules = z.infer<typeof evaluationRulesSchema>;
export type PromotionRule = EvaluationRules['promotion'][string];

export function promotionRuleKey(from: ProfessionalLevel, to: ProfessionalLevel): string {
  return `${from}_TO_${to}`;
}

/**
 * v1 初期値。仕様書の数値をそのまま反映している。
 *
 * 売上のアンカーは「Professional Score 換算の 80/100/120 点水準」を
 * 売上サブスコア (最大60点) に落とし込んだ値 = 水準の 1/2 (Q1 の確定事項)。
 * 成果率のアンカーは 0% → 0点 を起点とする折れ線 (Q3 の確定事項)。
 */
export const DEFAULT_EVALUATION_RULES: EvaluationRules = {
  version: 1,
  effectiveFrom: '2026-01-01',

  eligibility: {
    minElapsedMonths: 4,
    requireGoalApproved: true,
    countSuspendedMonths: false,
    includeCancelledReasonCodes: ['PERFORMANCE'],
  },

  customerSuccess: {
    bothGoalRule: 'ALL',
    longTerm: {
      anchors: [
        [0, 0],
        [0.9, 30],
        [1.0, 36],
      ],
      max: 36,
    },
    shortTerm: {
      windowMonths: 3,
      anchors: [
        [0, 0],
        [0.9, 20],
        [1.0, 24],
      ],
      max: 24,
    },
  },

  sales: {
    includeCoachSns: false,
    scoreBasis: 'MONTHLY',
    monthly: {
      anchors: [
        [0, 0],
        [2_000_000, 40],
        [3_500_000, 50],
        [5_000_000, 60],
      ],
    },
    quarterly: {
      anchors: [
        [0, 0],
        [6_000_000, 40],
        [10_500_000, 50],
        [15_000_000, 60],
      ],
    },
    annual: {
      anchors: [
        [0, 0],
        [24_000_000, 40],
        [42_000_000, 50],
        [60_000_000, 60],
      ],
    },
    max: 60,
  },

  scoreBands: [
    { min: 0, max: 79.999, label: '基準未達' },
    { min: 80, max: 89.999, label: '基準クリア' },
    { min: 90, max: 99.999, label: '高成果' },
    { min: 100, max: 109.999, label: '非常に高成果' },
    { min: 110, max: 119.999, label: 'トップ水準' },
    { min: 120, max: 120, label: '最高評価' },
  ],

  quarterlyBonus: [
    { min: 0, amount: 0 },
    { min: 80, amount: 30_000 },
    { min: 90, amount: 50_000 },
    { min: 100, amount: 100_000 },
    { min: 110, amount: 150_000 },
    { min: 120, amount: 200_000 },
  ],

  promotion: {
    P1_TO_P2: {
      consecutiveMonths: 3,
      consecutiveMinScore: 80,
      averageMonths: 3,
      averageMinScore: 90,
      behaviorStatusAllowed: ['OK'],
      minLongTermRate: null,
      requiredChecks: [],
      requiresAdminApproval: false,
    },
    P2_TO_P3: {
      consecutiveMonths: 3,
      consecutiveMinScore: 90,
      averageMonths: 3,
      averageMinScore: 100,
      behaviorStatusAllowed: ['OK'],
      minLongTermRate: 0.9,
      requiredChecks: [{ code: 'SENIOR_ACTIVITY', label: '上位活動要件 (1対多数の専門性)', requiredCount: 2 }],
      requiresAdminApproval: false,
    },
    P3_TO_P4: {
      consecutiveMonths: 3,
      consecutiveMinScore: 100,
      averageMonths: 3,
      averageMinScore: 105,
      behaviorStatusAllowed: ['OK'],
      minLongTermRate: 0.9,
      requiredChecks: [{ code: 'OWN_BUSINESS_RESULT', label: '本人起点の事業成果', requiredCount: 1 }],
      requiresAdminApproval: true,
    },
  },

  lessonUnitPrice: { P1: 0, P2: 10_000, P3: 12_000, P4: 15_000 },
};

export function parseEvaluationRules(value: unknown): EvaluationRules {
  return evaluationRulesSchema.parse(value);
}
