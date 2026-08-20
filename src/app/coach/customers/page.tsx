import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { CustomerTable } from '@/components/CustomerTable';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCoach } from '@/server/auth';
import { loadEvaluationRules } from '@/server/repositories/evaluationRepository';
import { buildCustomerViews, CUSTOMER_VIEW_COLUMNS } from '@/server/services/customerViewService';
import { currentYearMonth } from '@/server/services/evaluationService';
import type { CustomerRow } from '@/lib/supabase/types';

export default async function CoachCustomersPage() {
  const session = await requireCoach();
  const supabase = await createSupabaseServerClient();

  const [{ data: rows }, rules] = await Promise.all([
    supabase
      .from('customers')
      .select(CUSTOMER_VIEW_COLUMNS)
      .eq('current_coach_id', session.coach.id)
      .is('deleted_at', null)
      .returns<CustomerRow[]>(),
    loadEvaluationRules(supabase, { yearMonth: currentYearMonth() }),
  ]);

  const customers = buildCustomerViews(rows ?? [], rules);
  const eligible = customers.filter((c) => c.isEligible);
  const achieved = eligible.filter((c) => c.completeSuccess);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="担当顧客"
          description={`全${customers.length}名 / 評価対象 ${eligible.length}名 / 完全達成 ${achieved.length}名`}
        />
        <CardBody className="py-2">
          <CustomerTable customers={customers} basePath="/coach/customers" />
        </CardBody>
      </Card>
      <p className="text-xs text-ink-500">
        対応が必要な顧客 (目標未承認・評価対象で未達成) が上に表示されます。
      </p>
    </div>
  );
}
