import { addMonthsToYearMonth, todayInJst, yearMonthOf } from '@/domain/date';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/server/auth';
import { formatScore, formatYearMonth } from '@/lib/format';
import type { EvaluationSnapshotRow } from '@/lib/supabase/types';
import { loadAdminCoaches } from '@/server/services/adminOverviewService';
import { CloseForm } from './CloseForm';

export default async function MonthlyClosePage() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const thisMonth = yearMonthOf(todayInJst());
  const months = Array.from({ length: 6 }, (_, i) => addMonthsToYearMonth(thisMonth, -i));

  const [{ data: snapshots }, coaches] = await Promise.all([
    supabase
      .from('latest_evaluation_snapshots')
      .select('id, coach_id, year_month, revision, professional_score, is_evaluable, evaluation_rule_version, calculated_at, current_rank, sales_amount, sales_score, customer_success_score, long_term_success_rate, long_term_target_count, long_term_achieved_count, short_term_success_rate, short_term_target_count, short_term_achieved_count, long_term_score, short_term_score, score_band')
      .gte('year_month', months[months.length - 1] ?? thisMonth)
      .order('year_month', { ascending: false })
      .returns<EvaluationSnapshotRow[]>(),
    loadAdminCoaches(supabase),
  ]);

  const coachNames = new Map(coaches.map((c) => [c.id, c.users?.name ?? '(名称未設定)']));
  const rows = snapshots ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="月次締め"
          description="対象月の評価を確定し、スナップショットとして保存します。再締めしても過去のrevisionは残ります"
        />
        <CardBody>
          <CloseForm months={months} defaultMonth={addMonthsToYearMonth(thisMonth, -1)} />
          <p className="mt-4 text-xs text-ink-500">
            締めを行うと、昇格判定・四半期ボーナスの算定対象が更新され、コーチへの通知も生成されます。
            返金や成果訂正のあとに再締めすると、新しい revision として記録されます。
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="確定済みスナップショット" description="各月の最新 revision" />
        <CardBody className="py-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-500">
                  <th className="py-2 pr-3 font-medium">対象月</th>
                  <th className="py-2 pr-3 font-medium">コーチ</th>
                  <th className="py-2 pr-3 text-right font-medium">Score</th>
                  <th className="py-2 pr-3 text-right font-medium">顧客成果</th>
                  <th className="py-2 pr-3 text-right font-medium">売上点</th>
                  <th className="py-2 pr-3 text-right font-medium">rev</th>
                  <th className="py-2 pr-3 text-right font-medium">ルール</th>
                  <th className="py-2 font-medium">確定日時</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-sm text-ink-500">
                      まだ確定済みの評価がありません。
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2 pr-3">{formatYearMonth(row.year_month)}</td>
                      <td className="py-2 pr-3">{coachNames.get(row.coach_id) ?? '—'}</td>
                      <td className="tabular py-2 pr-3 text-right font-semibold">
                        {row.is_evaluable ? formatScore(row.professional_score) : 'N/A'}
                      </td>
                      <td className="tabular py-2 pr-3 text-right">{formatScore(row.customer_success_score)}</td>
                      <td className="tabular py-2 pr-3 text-right">{formatScore(row.sales_score)}</td>
                      <td className="tabular py-2 pr-3 text-right">{row.revision}</td>
                      <td className="tabular py-2 pr-3 text-right">v{row.evaluation_rule_version}</td>
                      <td className="py-2 text-xs text-ink-500">{row.calculated_at.slice(0, 16).replace('T', ' ')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export const dynamic = 'force-dynamic';
