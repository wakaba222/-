import { PROFESSIONAL_LEVEL_LABELS, type PromotionCondition } from '@/domain/types';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConditionList } from '@/components/ConditionList';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/server/auth';
import { loadAdminCoaches } from '@/server/services/adminOverviewService';
import { formatScore, formatYearMonth } from '@/lib/format';
import type { PromotionReviewRow, RequirementCheckRow } from '@/lib/supabase/types';
import { PromotionDecisionForm } from './PromotionDecisionForm';
import { RequirementCheckForm } from './RequirementCheckForm';

function toConditions(value: unknown): PromotionCondition[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PromotionCondition => {
    if (typeof item !== 'object' || item === null) return false;
    const candidate = item as Record<string, unknown>;
    return typeof candidate.code === 'string' && typeof candidate.met === 'boolean';
  });
}

export default async function AdminPromotionsPage() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const [{ data: reviews }, coaches, { data: checks }] = await Promise.all([
    supabase
      .from('promotion_reviews')
      .select('id, coach_id, year_month, from_level, to_level, status, three_month_avg_score, condition_results, decided_at, decision_note')
      .order('year_month', { ascending: false })
      .limit(50)
      .returns<PromotionReviewRow[]>(),
    loadAdminCoaches(supabase),
    supabase
      .from('promotion_requirement_checks')
      .select('id, coach_id, requirement_code, label, achieved_count, approved_at')
      .returns<RequirementCheckRow[]>(),
  ]);

  const coachNames = new Map(coaches.map((c) => [c.id, c.users?.name ?? '(名称未設定)']));
  const all = reviews ?? [];
  const latestByCoach = new Map<string, PromotionReviewRow>();
  for (const review of all) {
    if (!latestByCoach.has(review.coach_id)) latestByCoach.set(review.coach_id, review);
  }

  const candidates = [...latestByCoach.values()].filter(
    (r) => r.status === 'CANDIDATE' || r.status === 'CANDIDATE_REQUIRES_APPROVAL',
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="昇格候補"
          description="3ヶ月連続・3ヶ月平均・完全成果率・行動ルール・上位活動要件のAND条件を満たしたコーチ"
        />
        <CardBody className="py-0">
          {candidates.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500">現在、昇格候補はいません。</p>
          ) : (
            <ul className="divide-y divide-line">
              {candidates.map((review) => (
                <li key={review.id} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-ink-900">{coachNames.get(review.coach_id) ?? '—'}</p>
                      <p className="mt-0.5 text-sm text-ink-700">
                        {review.from_level} → {review.to_level}{' '}
                        {review.to_level ? PROFESSIONAL_LEVEL_LABELS[review.to_level] : ''}
                      </p>
                      <p className="text-xs text-ink-500">
                        {formatYearMonth(review.year_month)}時点 / 3ヶ月平均 {formatScore(review.three_month_avg_score)}
                        {review.status === 'CANDIDATE_REQUIRES_APPROVAL' ? ' / ADMIN承認必須ランク' : ''}
                      </p>
                    </div>
                    <PromotionDecisionForm reviewId={review.id} />
                  </div>
                  <div className="mt-3 rounded-xl bg-canvas px-3 py-2">
                    <ConditionList conditions={toConditions(review.condition_results)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="上位活動要件の承認" description="P3/P4 の選択評価はMVPではADMIN承認で代替します" />
        <CardBody className="py-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-500">
                  <th className="py-2 pr-3 font-medium">コーチ</th>
                  <th className="py-2 pr-3 font-medium">要件</th>
                  <th className="py-2 pr-3 font-medium">達成数</th>
                  <th className="py-2 font-medium">承認</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {coaches.map((coach) => {
                  const coachChecks = (checks ?? []).filter((c) => c.coach_id === coach.id);
                  const rows = coachChecks.length > 0 ? coachChecks : [null];
                  return rows.map((check, index) => (
                    <tr key={`${coach.id}-${check?.id ?? index}`}>
                      <td className="py-2.5 pr-3">{coach.users?.name ?? '—'}</td>
                      <td className="py-2.5 pr-3" colSpan={3}>
                        <RequirementCheckForm
                          coachId={coach.id}
                          requirementCode={check?.requirement_code ?? 'SENIOR_ACTIVITY'}
                          label={check?.label ?? '上位活動要件 (1対多数の専門性)'}
                          achievedCount={check?.achieved_count ?? 0}
                          approved={check?.approved_at !== null && check?.approved_at !== undefined}
                        />
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="判定履歴" description="直近50件" />
        <CardBody className="py-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-500">
                  <th className="py-2 pr-3 font-medium">対象月</th>
                  <th className="py-2 pr-3 font-medium">コーチ</th>
                  <th className="py-2 pr-3 font-medium">判定</th>
                  <th className="py-2 pr-3 font-medium">3ヶ月平均</th>
                  <th className="py-2 font-medium">決定日</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {all.map((review) => (
                  <tr key={review.id}>
                    <td className="py-2 pr-3">{formatYearMonth(review.year_month)}</td>
                    <td className="py-2 pr-3">{coachNames.get(review.coach_id) ?? '—'}</td>
                    <td className="py-2 pr-3">
                      {review.status === 'APPROVED' ? (
                        <Badge tone="success">承認</Badge>
                      ) : review.status === 'REJECTED' ? (
                        <Badge tone="danger">見送り</Badge>
                      ) : review.status === 'NOT_ELIGIBLE' ? (
                        <span className="text-xs text-ink-500">条件未達</span>
                      ) : (
                        <Badge tone="gold">候補</Badge>
                      )}
                    </td>
                    <td className="tabular py-2 pr-3">{formatScore(review.three_month_avg_score)}</td>
                    <td className="py-2 text-xs text-ink-500">{review.decided_at?.slice(0, 10) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export const dynamic = 'force-dynamic';
