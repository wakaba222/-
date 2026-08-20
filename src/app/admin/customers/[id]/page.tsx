import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/server/auth';
import { loadEvaluationRules } from '@/server/repositories/evaluationRepository';
import { loadAdminCoaches } from '@/server/services/adminOverviewService';
import { buildCustomerViews, CUSTOMER_VIEW_COLUMNS } from '@/server/services/customerViewService';
import { currentYearMonth } from '@/server/services/evaluationService';
import { formatDate } from '@/lib/format';
import type { CustomerRow, PerformanceRecordRow } from '@/lib/supabase/types';
import { CustomerAdminForms } from './CustomerAdminForms';

export default async function AdminCustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const [{ data: row }, rules, coaches] = await Promise.all([
    supabase.from('customers').select(CUSTOMER_VIEW_COLUMNS).eq('id', id).maybeSingle<CustomerRow>(),
    loadEvaluationRules(supabase, { yearMonth: currentYearMonth() }),
    loadAdminCoaches(supabase),
  ]);
  if (!row) notFound();

  const coachNames = new Map(coaches.map((c) => [c.id, c.users?.name ?? '(名称未設定)']));
  const [view] = buildCustomerViews([row], rules, coachNames);
  if (!view) notFound();

  const { data: records } = await supabase
    .from('performance_records')
    .select('id, customer_id, coach_id, recorded_on, score, distance, is_complete_success, note, created_at')
    .eq('customer_id', id)
    .is('deleted_at', null)
    .order('recorded_on', { ascending: false })
    .returns<PerformanceRecordRow[]>();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={view.name}
          description={`${formatDate(view.programStartDate)} 開始 / 経過 ${view.elapsedMonths}ヶ月 / 担当 ${view.coachName ?? '—'}`}
          action={
            <Link href="/admin/customers" className="text-xs text-eagle-700 underline-offset-2 hover:underline">
              一覧へ
            </Link>
          }
        />
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-ink-500">目標</dt>
              <dd className="mt-0.5 font-medium">{view.goalLabel}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500">現在成果</dt>
              <dd className="mt-0.5 font-medium">{view.latestLabel}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500">評価対象</dt>
              <dd className="mt-0.5">{view.isEligible ? <Badge tone="success">対象</Badge> : <Badge>対象外</Badge>}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500">達成</dt>
              <dd className="mt-0.5">
                {view.completeSuccess ? <Badge tone="gold">{formatDate(view.completeSuccessAt)}</Badge> : <span>未達</span>}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <CustomerAdminForms
        customerId={view.id}
        status={view.status}
        coaches={coaches.map((c) => ({ id: c.id, name: c.users?.name ?? '(名称未設定)' }))}
        records={(records ?? []).map((record) => ({
          id: record.id,
          recordedOn: record.recorded_on,
          score: record.score,
          distance: record.distance,
          isCompleteSuccess: record.is_complete_success,
          note: record.note,
        }))}
      />
    </div>
  );
}

export const dynamic = 'force-dynamic';
