/**
 * DB行の型。
 * Supabase CLI が使える環境では `npm run db:types` の生成物に置き換えられるが、
 * アプリ側は本ファイルの型のみを参照するため、参照箇所を書き換えずに移行できる。
 */
import type {
  AcquisitionSource,
  BehaviorStatus,
  CancelReasonCode,
  CustomerStatus,
  GoalApprovalStatus,
  GoalType,
  ProfessionalLevel,
  SaleStatus,
  UserRole,
} from '@/domain/types';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
}

export interface CoachRow {
  id: string;
  user_id: string;
  professional_level: ProfessionalLevel;
  lesson_unit_price: number;
  hire_date: string;
  left_on: string | null;
}

export interface CoachWithUserRow extends CoachRow {
  users: Pick<UserRow, 'id' | 'name' | 'email' | 'active'> | null;
}

export interface CustomerRow {
  id: string;
  name: string;
  current_coach_id: string | null;
  program_start_date: string;
  program_end_date: string;
  status: CustomerStatus;
  status_changed_on: string | null;
  cancel_reason_code: CancelReasonCode | null;
  suspended_days: number;
  start_score: number | null;
  target_score: number | null;
  start_distance: number | null;
  target_distance: number | null;
  goal_type: GoalType;
  goal_approval_status: GoalApprovalStatus;
  goal_approved_at: string | null;
  latest_score: number | null;
  latest_distance: number | null;
  complete_success: boolean;
  complete_success_at: string | null;
  note: string | null;
  updated_at: string;
}

export interface CustomerGoalRow {
  id: string;
  customer_id: string;
  goal_type: GoalType;
  start_score: number | null;
  target_score: number | null;
  start_distance: number | null;
  target_distance: number | null;
  approval_status: GoalApprovalStatus;
  effective_from: string;
  superseded_at: string | null;
}

export interface PerformanceRecordRow {
  id: string;
  customer_id: string;
  coach_id: string | null;
  recorded_on: string;
  score: number | null;
  distance: number | null;
  is_complete_success: boolean;
  note: string | null;
  created_at: string;
}

export interface ProductRow {
  id: string;
  code: string;
  name: string;
  default_price: number;
  incentive_amount: number;
  is_sales_score_target: boolean;
  active: boolean;
  sort_order: number;
}

export interface SaleRow {
  id: string;
  coach_id: string;
  customer_id: string | null;
  product_id: string;
  sold_on: string;
  amount: number;
  incentive_amount: number;
  acquisition_source: AcquisitionSource;
  status: SaleStatus;
  refund_amount: number;
  note: string | null;
  products?: Pick<ProductRow, 'id' | 'name' | 'code' | 'is_sales_score_target'> | null;
  customers?: Pick<CustomerRow, 'id' | 'name'> | null;
}

export interface EvaluationRuleRow {
  version: number;
  effective_from: string;
  effective_to: string | null;
  rules: unknown;
  note: string | null;
}

export interface EvaluationSnapshotRow {
  id: string;
  coach_id: string;
  year_month: string;
  revision: number;
  is_evaluable: boolean;
  long_term_success_rate: number | null;
  long_term_target_count: number;
  long_term_achieved_count: number;
  long_term_score: number | null;
  short_term_success_rate: number | null;
  short_term_target_count: number;
  short_term_achieved_count: number;
  short_term_score: number | null;
  customer_success_score: number | null;
  sales_amount: number;
  sales_score: number;
  professional_score: number | null;
  score_band: string | null;
  current_rank: ProfessionalLevel;
  evaluation_rule_version: number;
  calculated_at: string;
}

export interface PromotionReviewRow {
  id: string;
  coach_id: string;
  year_month: string;
  from_level: ProfessionalLevel;
  to_level: ProfessionalLevel | null;
  status: 'NOT_ELIGIBLE' | 'CANDIDATE' | 'CANDIDATE_REQUIRES_APPROVAL' | 'APPROVED' | 'REJECTED';
  three_month_avg_score: number | null;
  condition_results: unknown;
  decided_at: string | null;
  decision_note: string | null;
}

export interface RequirementCheckRow {
  id: string;
  coach_id: string;
  requirement_code: string;
  label: string;
  achieved_count: number;
  approved_at: string | null;
}

export interface BehaviorStatusRow {
  id: string;
  coach_id: string;
  year_month: string;
  status: BehaviorStatus;
  note: string | null;
}

export interface LessonCountRow {
  id: string;
  coach_id: string;
  year_month: string;
  lesson_count: number;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link_url: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AuditLogRow {
  id: string;
  actor_user_id: string | null;
  entity_table: string;
  entity_id: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}
