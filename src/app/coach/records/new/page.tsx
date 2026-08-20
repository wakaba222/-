import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCoach } from '@/server/auth';
import { loadEvaluationRules } from '@/server/repositories/evaluationRepository';
import { currentYearMonth } from '@/server/services/evaluationService';
import type { CustomerRow } from '@/lib/supabase/types';
import { PerformanceForm, type PerformanceFormCustomer } from './PerformanceForm';

export default async function NewPerformanceRecordPage() {
  const session = await requireCoach();
  const supabase = await createSupabaseServerClient();

  const [{ data: customers }, rules] = await Promise.all([
    supabase
      .from('customers')
      .select('id, name, goal_type, target_score, target_distance, complete_success, status, program_start_date')
      .eq('current_coach_id', session.coach.id)
      .in('status', ['ACTIVE', 'COMPLETED', 'SUSPENDED'])
      .is('deleted_at', null)
      .order('name')
      .returns<
        Pick<
          CustomerRow,
          'id' | 'name' | 'goal_type' | 'target_score' | 'target_distance' | 'complete_success' | 'status' | 'program_start_date'
        >[]
      >(),
    loadEvaluationRules(supabase, { yearMonth: currentYearMonth() }),
  ]);

  const formCustomers: PerformanceFormCustomer[] = (customers ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    goalType: row.goal_type,
    targetScore: row.target_score,
    targetDistance: row.target_distance,
    completeSuccess: row.complete_success,
  }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="成果を登録" description="顧客を選んで数値を入れるだけ。達成判定は自動で表示されます" />
        <CardBody>
          <PerformanceForm customers={formCustomers} bothGoalRule={rules.customerSuccess.bothGoalRule} />
        </CardBody>
      </Card>
    </div>
  );
}
