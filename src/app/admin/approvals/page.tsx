import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/server/auth';
import { goalLabelOf } from '@/server/services/customerViewService';
import { formatDate } from '@/lib/format';
import type { CustomerRow } from '@/lib/supabase/types';
import { GoalDecisionForm } from './GoalDecisionForm';

export default async function GoalApprovalsPage() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const { data: rows } = await supabase
    .from('customers')
    .select('id, name, program_start_date, goal_type, start_score, target_score, start_distance, target_distance, goal_approval_status, current_coach_id')
    .in('goal_approval_status', ['PENDING', 'DRAFT'])
    .is('deleted_at', null)
    .order('program_start_date')
    .returns<
      Pick<
        CustomerRow,
        'id' | 'name' | 'program_start_date' | 'goal_type' | 'start_score' | 'target_score' | 'start_distance' | 'target_distance' | 'goal_approval_status' | 'current_coach_id'
      >[]
    >();

  const pending = rows ?? [];

  return (
    <Card>
      <CardHeader
        title="目標承認"
        description="承認されるまで、その顧客は評価計算に含まれません (仕様6章)"
      />
      <CardBody className="py-0">
        {pending.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-500">承認待ちの目標はありません。</p>
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((customer) => (
              <li key={customer.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="font-medium text-ink-900">{customer.name}</p>
                  <p className="mt-0.5 text-sm text-ink-700">
                    目標: {goalLabelOf(customer.goal_type, customer.target_score, customer.target_distance)}
                  </p>
                  <p className="text-xs text-ink-500">開始日 {formatDate(customer.program_start_date)}</p>
                </div>
                <GoalDecisionForm customerId={customer.id} />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export const dynamic = 'force-dynamic';
