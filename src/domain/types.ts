import type { DateOnly, YearMonth } from './date';

export type { DateOnly, YearMonth };

export type UserRole = 'ADMIN' | 'COACH';
export type ProfessionalLevel = 'P1' | 'P2' | 'P3' | 'P4';
export type BehaviorStatus = 'OK' | 'WARNING' | 'NG';

export type GoalType = 'SCORE' | 'DISTANCE' | 'BOTH';
export type GoalApprovalStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type CustomerStatus = 'ACTIVE' | 'SUSPENDED' | 'COMPLETED' | 'CANCELLED';
export type CancelReasonCode = 'SELF' | 'PERFORMANCE' | 'OTHER';

export type AcquisitionSource = 'EXISTING' | 'COACH_SNS' | 'COMPANY' | 'OTHER';
export type PaymentSource = 'ROBOT_PAYMENT' | 'MOSH' | 'BANK_TRANSFER' | 'MANUAL';
export type SaleStatus = 'ACTIVE' | 'CANCELLED' | 'REFUNDED';

export const PROFESSIONAL_LEVELS: readonly ProfessionalLevel[] = ['P1', 'P2', 'P3', 'P4'];

export const PROFESSIONAL_LEVEL_LABELS: Record<ProfessionalLevel, string> = {
  P1: 'ASSOCIATE',
  P2: 'PROFESSIONAL',
  P3: 'SENIOR',
  P4: 'MASTER',
};

export function nextLevel(level: ProfessionalLevel): ProfessionalLevel | null {
  const index = PROFESSIONAL_LEVELS.indexOf(level);
  return PROFESSIONAL_LEVELS[index + 1] ?? null;
}

/** 評価対象の顧客 1件分の入力。DBの行ではなくドメインの入力型 */
export interface CustomerEvaluationInput {
  id: string;
  name: string;
  programStartDate: DateOnly;
  programEndDate: DateOnly | null;
  status: CustomerStatus;
  cancelReasonCode: CancelReasonCode | null;
  /** 解約・終了などで担当から外れた日 (null = 継続中) */
  statusChangedOn: DateOnly | null;
  goalApprovalStatus: GoalApprovalStatus;
  goalType: GoalType;
  targetScore: number | null;
  targetDistance: number | null;
  /** 完全達成した日 (未達成は null)。一度確定したら悪化しても取り消さない */
  completeSuccessAt: DateOnly | null;
  /** 休会していた累計日数 */
  suspendedDays: number;
}

/** 評価対象の売上 1件分の入力 */
export interface SaleEvaluationInput {
  id: string;
  coachId: string;
  soldOn: DateOnly;
  /** 売価 (gross)。売上点のアンカーはこの水準を前提に設計されている */
  amount: number;
  refundAmount: number;
  /** 消費税額。税抜運用なら0 */
  taxAmount: number;
  /** 決済手数料 */
  paymentFee: number;
  incentiveAmount: number;
  paymentSource: PaymentSource;
  status: SaleStatus;
  acquisitionSource: AcquisitionSource;
  /** 商品マスタの「売上点の評価対象か」フラグ */
  isSalesScoreTarget: boolean;
}

/** 成果記録 (完全達成判定に使う) */
export interface PerformanceRecordInput {
  id: string;
  customerId: string;
  recordedOn: DateOnly;
  score: number | null;
  distance: number | null;
}

/** 顧客の定量目標 (判定時点で有効だったもの) */
export interface GoalInput {
  goalType: GoalType;
  targetScore: number | null;
  targetDistance: number | null;
}

export interface RateResult {
  /** 評価対象が0人のときは null (= N/A)。0 とは意味が異なる */
  rate: number | null;
  targetCount: number;
  achievedCount: number;
  score: number | null;
  evaluable: boolean;
}

export interface CustomerSuccessResult {
  longTerm: RateResult;
  shortTerm: RateResult;
  score: number | null;
  evaluable: boolean;
  /** 長期・短期のどちらか一方のみ評価可能だった場合 true */
  partial: boolean;
}

export interface SalesResult {
  /** 売上点の算定に使った金額 (既定は 売価 − 返金) */
  amount: number;
  /** 評価対象外を含む総額 (表示用) */
  grossAmount: number;
  /** 税・決済手数料・返金を差し引いた純額 (報酬計算・分析の参照用) */
  netAmount: number;
  /** SNS経由売上 (既定では評価対象外。別枠表示用) */
  coachSnsAmount: number;
  incentiveTotal: number;
  score: number;
}

export interface ProfessionalScoreResult {
  score: number | null;
  band: string;
  evaluable: boolean;
  /** 評価不能の理由 (画面にそのまま出す) */
  reason: string | null;
}

export interface PromotionCondition {
  code: string;
  label: string;
  /** 表示用の現在値 (例: '94.5', '2/3ヶ月', 'OK') */
  currentLabel: string;
  /** 表示用の必要条件 (例: '100以上') */
  requiredLabel: string;
  met: boolean;
}

export type PromotionStatus =
  | 'NOT_ELIGIBLE'
  | 'CANDIDATE'
  | 'CANDIDATE_REQUIRES_APPROVAL'
  | 'MAX_LEVEL';

export interface PromotionResult {
  fromLevel: ProfessionalLevel;
  toLevel: ProfessionalLevel | null;
  status: PromotionStatus;
  conditions: PromotionCondition[];
  shortfalls: PromotionCondition[];
  threeMonthAverage: number | null;
}

export interface BonusResult {
  amount: number;
  average: number | null;
  monthsUsed: number;
  status: 'CALCULATED' | 'EVALUATION_INSUFFICIENT';
}

/** 月次スナップショットの要約 (昇格・ボーナス判定の入力) */
export interface SnapshotSummary {
  yearMonth: YearMonth;
  professionalScore: number | null;
  longTermSuccessRate: number | null;
  isEvaluable: boolean;
}

export interface CoachEvaluationInput {
  coachId: string;
  level: ProfessionalLevel;
  yearMonth: YearMonth;
  customers: CustomerEvaluationInput[];
  sales: SaleEvaluationInput[];
}

export interface CoachEvaluationResult {
  coachId: string;
  yearMonth: YearMonth;
  customerSuccess: CustomerSuccessResult;
  sales: SalesResult;
  professional: ProfessionalScoreResult;
}
