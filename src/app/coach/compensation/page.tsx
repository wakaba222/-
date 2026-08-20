import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCoach } from '@/server/auth';
import { currentYearMonth, getCoachOverview } from '@/server/services/evaluationService';
import { formatYearMonth, formatYen } from '@/lib/format';
import { LessonCountForm } from './LessonCountForm';

export default async function CompensationPage() {
  const session = await requireCoach();
  const supabase = await createSupabaseServerClient();
  const yearMonth = currentYearMonth();
  const overview = await getCoachOverview(supabase, session.coach.id, session.coach.professional_level, yearMonth);
  const { compensation } = overview;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`${formatYearMonth(yearMonth)} の想定報酬`}
          description="参考値です。実際の給与支払とは分離しています"
        />
        <CardBody>
          <p className="tabular text-4xl font-bold text-eagle-900">{formatYen(compensation.total)}</p>
          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-700">
                レッスン報酬 ({compensation.lessonCount ?? '未入力'} × {formatYen(compensation.lessonUnitPrice)})
              </dt>
              <dd className="tabular">{compensation.lessonReward === null ? '—' : formatYen(compensation.lessonReward)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-700">成約ショットインセンティブ</dt>
              <dd className="tabular">{formatYen(compensation.incentiveTotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-700">四半期成果ボーナス</dt>
              <dd className="tabular">{formatYen(compensation.bonusAmount)}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="今月のレッスン数" description="月1回だけ入力してください (報酬の参考値計算にのみ使用)" />
        <CardBody>
          <LessonCountForm yearMonth={yearMonth} defaultValue={compensation.lessonCount} />
        </CardBody>
      </Card>
    </div>
  );
}
