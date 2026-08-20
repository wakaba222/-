import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { CustomerTable } from '@/components/CustomerTable';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/server/auth';
import { loadEvaluationRules } from '@/server/repositories/evaluationRepository';
import { loadAdminCoaches } from '@/server/services/adminOverviewService';
import { buildCustomerViews, CUSTOMER_VIEW_COLUMNS } from '@/server/services/customerViewService';
import { currentYearMonth } from '@/server/services/evaluationService';
import type { CustomerRow } from '@/lib/supabase/types';
import { NewCustomerForm } from './NewCustomerForm';

export default async function AdminCustomersPage() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const [{ data: rows }, rules, coaches] = await Promise.all([
    supabase.from('customers').select(CUSTOMER_VIEW_COLUMNS).is('deleted_at', null).returns<CustomerRow[]>(),
    loadEvaluationRules(supabase, { yearMonth: currentYearMonth() }),
    loadAdminCoaches(supabase),
  ]);

  const coachNames = new Map(coaches.map((c) => [c.id, c.users?.name ?? '(名称未設定)']));
  const customers = buildCustomerViews(rows ?? [], rules, coachNames);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="顧客一覧"
          description={`全${customers.length}名 / 評価対象 ${customers.filter((c) => c.isEligible).length}名`}
        />
        <CardBody className="py-2">
          <CustomerTable customers={customers} basePath="/admin/customers" showCoach />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="顧客を登録" description="登録後、目標をADMINが承認するまで評価計算には入りません" />
        <CardBody>
          <NewCustomerForm coaches={coaches.map((c) => ({ id: c.id, name: c.users?.name ?? '(名称未設定)' }))} />
        </CardBody>
      </Card>
    </div>
  );
}

export const dynamic = 'force-dynamic';
