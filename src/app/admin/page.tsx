import Link from 'next/link';
import { PROFESSIONAL_LEVEL_LABELS } from '@/domain/types';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/server/auth';
import { buildAdminCoachRows } from '@/server/services/adminOverviewService';
import { currentYearMonth } from '@/server/services/evaluationService';
import { formatManYen, formatScore, formatYearMonth } from '@/lib/format';
import { CoachTable } from './CoachTable';

export default async function AdminDashboardPage() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const yearMonth = currentYearMonth();
  const rows = await buildAdminCoachRows(supabase, yearMonth);

  const candidates = rows.filter(
    (r) => r.promotionStatus === 'CANDIDATE' || r.promotionStatus === 'CANDIDATE_REQUIRES_APPROVAL',
  );
  const totalMonthlySales = rows.reduce((sum, r) => sum + r.monthlySales, 0);
  const evaluable = rows.filter((r) => r.professionalScore !== null);
  const averageScore =
    evaluable.length === 0 ? null : evaluable.reduce((sum, r) => sum + (r.professionalScore ?? 0), 0) / evaluable.length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryTile label="コーチ数" value={`${rows.length}名`} />
        <SummaryTile label="平均 Professional Score" value={formatScore(averageScore)} />
        <SummaryTile label="今月売上 (全体)" value={formatManYen(totalMonthlySales)} />
        <SummaryTile
          label="昇格候補"
          value={`${candidates.length}名`}
          href={candidates.length > 0 ? '/admin/promotions' : undefined}
          tone={candidates.length > 0 ? 'gold' : 'neutral'}
        />
      </div>

      <Card>
        <CardHeader
          title="コーチ一覧"
          description={`${formatYearMonth(yearMonth)} 時点の速報値。確定値は月次締め後のスナップショットです`}
          action={
            <Link href="/api/export/coaches" className="text-xs text-eagle-700 underline-offset-2 hover:underline">
              CSV出力
            </Link>
          }
        />
        <CardBody className="py-2">
          <CoachTable rows={rows} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="ランク別内訳" />
        <CardBody>
          <ul className="grid gap-2 sm:grid-cols-4">
            {(['P1', 'P2', 'P3', 'P4'] as const).map((level) => (
              <li key={level} className="rounded-xl bg-canvas px-3 py-2">
                <p className="text-xs text-ink-500">
                  {level} {PROFESSIONAL_LEVEL_LABELS[level]}
                </p>
                <p className="tabular mt-1 text-lg font-semibold">
                  {rows.filter((r) => r.level === level).length}名
                </p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  href,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  href?: string;
  tone?: 'neutral' | 'gold';
}) {
  const body = (
    <div className="rounded-[--radius-card] border border-line bg-white px-4 py-3">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold text-ink-900">{value}</p>
      {tone === 'gold' ? (
        <p className="mt-1">
          <Badge tone="gold">要確認</Badge>
        </p>
      ) : null}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export const dynamic = 'force-dynamic';
