import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCoach } from '@/server/auth';
import { loadEvaluationRules } from '@/server/repositories/evaluationRepository';
import { buildCustomerViews, CUSTOMER_VIEW_COLUMNS } from '@/server/services/customerViewService';
import { currentYearMonth } from '@/server/services/evaluationService';
import { formatDate, formatYen } from '@/lib/format';
import type { CustomerRow, PerformanceRecordRow, SaleRow } from '@/lib/supabase/types';

export default async function CoachCustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireCoach();
  const supabase = await createSupabaseServerClient();

  const [{ data: row }, rules] = await Promise.all([
    supabase.from('customers').select(CUSTOMER_VIEW_COLUMNS).eq('id', id).maybeSingle<CustomerRow>(),
    loadEvaluationRules(supabase, { yearMonth: currentYearMonth() }),
  ]);
  if (!row) notFound();

  const [view] = buildCustomerViews([row], rules);
  if (!view) notFound();

  const [{ data: records }, { data: sales }] = await Promise.all([
    supabase
      .from('performance_records')
      .select('id, customer_id, coach_id, recorded_on, score, distance, is_complete_success, note, created_at')
      .eq('customer_id', id)
      .is('deleted_at', null)
      .order('recorded_on', { ascending: false })
      .returns<PerformanceRecordRow[]>(),
    supabase
      .from('sales')
      .select('id, coach_id, customer_id, product_id, sold_on, amount, incentive_amount, acquisition_source, payment_source, status, refund_amount, tax_amount, payment_fee, net_amount, note, products(id, name, code, is_sales_score_target)')
      .eq('customer_id', id)
      .is('deleted_at', null)
      .order('sold_on', { ascending: false })
      .returns<SaleRow[]>(),
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={view.name}
          description={`${formatDate(view.programStartDate)} 開始 / 経過 ${view.elapsedMonths}ヶ月`}
          action={
            <Link href="/coach/customers" className="text-xs text-eagle-700 underline-offset-2 hover:underline">
              一覧へ
            </Link>
          }
        />
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 text-sm">
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
              <dt className="text-xs text-ink-500">達成状況</dt>
              <dd className="mt-0.5">
                {view.completeSuccess ? (
                  <Badge tone="gold">完全達成 ({formatDate(view.completeSuccessAt)})</Badge>
                ) : (
                  <span className="text-ink-700">未達</span>
                )}
              </dd>
            </div>
          </dl>
          {!view.goalApproved ? (
            <p className="mt-4 rounded-xl bg-warn-100 px-3 py-2 text-sm text-warn-600">
              目標がADMIN未承認のため、この顧客はまだ評価計算に含まれません。
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="成果履歴" description="記録は上書きされず全て残ります" />
        <CardBody className="py-0">
          {(records ?? []).length === 0 ? (
            <p className="py-4 text-sm text-ink-500">まだ記録がありません。</p>
          ) : (
            <ul className="divide-y divide-line">
              {(records ?? []).map((record) => (
                <li key={record.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="tabular text-sm text-ink-900">
                      {record.score !== null ? `スコア ${record.score}` : ''}
                      {record.score !== null && record.distance !== null ? ' / ' : ''}
                      {record.distance !== null ? `${record.distance}yd` : ''}
                    </p>
                    <p className="text-xs text-ink-500">
                      {formatDate(record.recorded_on)}
                      {record.note ? ` / ${record.note}` : ''}
                    </p>
                  </div>
                  {record.is_complete_success ? <Badge tone="gold">達成</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="売上履歴" />
        <CardBody className="py-0">
          {(sales ?? []).length === 0 ? (
            <p className="py-4 text-sm text-ink-500">まだ売上がありません。</p>
          ) : (
            <ul className="divide-y divide-line">
              {(sales ?? []).map((sale) => (
                <li key={sale.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm text-ink-900">{sale.products?.name ?? '—'}</p>
                    <p className="text-xs text-ink-500">
                      {formatDate(sale.sold_on)}
                      {sale.status !== 'ACTIVE' ? ` / ${sale.status === 'CANCELLED' ? '取消済' : `返金 ${formatYen(sale.refund_amount)}`}` : ''}
                    </p>
                  </div>
                  <span className="tabular text-sm font-semibold">{formatYen(sale.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
