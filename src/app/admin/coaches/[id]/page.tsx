import { notFound } from 'next/navigation';
import Link from 'next/link';
import { PROFESSIONAL_LEVEL_LABELS } from '@/domain/types';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConditionList } from '@/components/ConditionList';
import { ScoreTrend } from '@/components/ScoreTrend';
import { CustomerTable } from '@/components/CustomerTable';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/server/auth';
import { getCoachOverview } from '@/server/services/evaluationService';
import { buildCustomerViews, CUSTOMER_VIEW_COLUMNS } from '@/server/services/customerViewService';
import { formatManYen, formatRate, formatScore, formatYen } from '@/lib/format';
import type { CoachWithUserRow, CustomerRow } from '@/lib/supabase/types';
import { BehaviorStatusForm } from './BehaviorStatusForm';

export default async function AdminCoachDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const { data: coach } = await supabase
    .from('coaches')
    .select('id, user_id, professional_level, lesson_unit_price, hire_date, left_on, users(id, name, email, active)')
    .eq('id', id)
    .maybeSingle<CoachWithUserRow>();
  if (!coach) notFound();

  const overview = await getCoachOverview(supabase, coach.id, coach.professional_level);

  const { data: customerRows } = await supabase
    .from('customers')
    .select(CUSTOMER_VIEW_COLUMNS)
    .eq('current_coach_id', coach.id)
    .is('deleted_at', null)
    .returns<CustomerRow[]>();

  const customers = buildCustomerViews(customerRows ?? [], overview.rules);
  const { customerSuccess, sales, professional } = overview.evaluation;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={coach.users?.name ?? '(名称未設定)'}
          description={`${coach.professional_level} ${PROFESSIONAL_LEVEL_LABELS[coach.professional_level]} / レッスン単価 ${formatYen(coach.lesson_unit_price)}`}
          action={
            <Link href="/admin" className="text-xs text-eagle-700 underline-offset-2 hover:underline">
              一覧へ
            </Link>
          }
        />
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Professional Score" value={formatScore(professional.score)} note={professional.band} />
            <Metric label="顧客成果点" value={formatScore(customerSuccess.score)} />
            <Metric
              label="完全成果率"
              value={formatRate(customerSuccess.longTerm.rate)}
              note={`${customerSuccess.longTerm.achievedCount}/${customerSuccess.longTerm.targetCount}名`}
            />
            <Metric label="短期成果率" value={formatRate(customerSuccess.shortTerm.rate)} />
            <Metric label="売上点" value={formatScore(sales.score)} />
            <Metric label="今月売上" value={formatManYen(overview.salesBreakdown.monthly)} />
            <Metric label="3ヶ月売上" value={formatManYen(overview.salesBreakdown.quarterly)} />
            <Metric label="年間売上" value={formatManYen(overview.salesBreakdown.annual)} />
          </dl>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="昇格条件" description={overview.promotion.toLevel ? `${overview.promotion.toLevel} への条件` : ''} />
          <CardBody>
            {overview.promotion.status === 'CANDIDATE' || overview.promotion.status === 'CANDIDATE_REQUIRES_APPROVAL' ? (
              <p className="mb-3">
                <Badge tone="gold">昇格候補</Badge>
              </p>
            ) : null}
            <ConditionList conditions={overview.promotion.conditions} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Score推移" description="確定済みスナップショット" />
          <CardBody>
            <ScoreTrend snapshots={overview.snapshots} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="行動ルール (EAGLE)" description="NG の場合は昇格できません" />
        <CardBody>
          <BehaviorStatusForm
            coachId={coach.id}
            yearMonth={overview.yearMonth}
            currentStatus={overview.behaviorStatus}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="担当顧客" description={`${customers.length}名`} />
        <CardBody className="py-2">
          <CustomerTable customers={customers} basePath="/admin/customers" />
        </CardBody>
      </Card>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl bg-canvas px-3 py-2">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="tabular mt-0.5 text-xl font-semibold text-ink-900">{value}</dd>
      {note ? <p className="text-xs text-ink-500">{note}</p> : null}
    </div>
  );
}

export const dynamic = 'force-dynamic';
