import { PROFESSIONAL_LEVEL_LABELS } from '@/domain/types';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConditionList } from '@/components/ConditionList';
import { ScoreTrend } from '@/components/ScoreTrend';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCoach } from '@/server/auth';
import { getCoachOverview } from '@/server/services/evaluationService';
import { formatScore, formatYen } from '@/lib/format';

export default async function CoachPromotionPage() {
  const session = await requireCoach();
  const supabase = await createSupabaseServerClient();
  const overview = await getCoachOverview(supabase, session.coach.id, session.coach.professional_level);
  const { promotion, bonus } = overview;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={
            promotion.toLevel
              ? `${session.coach.professional_level} → ${promotion.toLevel} ${PROFESSIONAL_LEVEL_LABELS[promotion.toLevel]}`
              : '昇格'
          }
          description="確定済みの月次評価をもとに判定しています (速報値では判定しません)"
        />
        <CardBody>
          {promotion.status === 'MAX_LEVEL' ? (
            <p className="text-sm text-ink-700">最上位ランクです。</p>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-2">
                {promotion.status === 'NOT_ELIGIBLE' ? (
                  <Badge>残り{promotion.shortfalls.length}条件</Badge>
                ) : (
                  <Badge tone="gold">
                    全条件クリア{promotion.status === 'CANDIDATE_REQUIRES_APPROVAL' ? '（ADMIN承認待ち）' : ''}
                  </Badge>
                )}
                <span className="text-xs text-ink-500">3ヶ月平均 {formatScore(promotion.threeMonthAverage)}</span>
              </div>
              <ConditionList conditions={promotion.conditions} />
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Professional Score 推移" description="確定済みスナップショット" />
        <CardBody>
          <ScoreTrend snapshots={overview.snapshots} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="四半期成果ボーナス" description="3ヶ月平均スコアで決まります (単月では判定しません)" />
        <CardBody>
          {bonus.status === 'EVALUATION_INSUFFICIENT' ? (
            <p className="text-sm text-ink-700">
              評価が確定した月が不足しているため、まだ算定できません (現在 {bonus.monthsUsed}ヶ月分)。
            </p>
          ) : (
            <>
              <p className="tabular text-3xl font-bold text-eagle-900">{formatYen(bonus.amount)}</p>
              <p className="mt-1 text-sm text-ink-500">
                3ヶ月平均 {formatScore(bonus.average)} ({bonus.monthsUsed}ヶ月分で算定)
              </p>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
