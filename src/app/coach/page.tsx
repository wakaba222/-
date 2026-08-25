import Link from 'next/link';
import { PROFESSIONAL_LEVEL_LABELS } from '@/domain/types';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ConditionList } from '@/components/ConditionList';
import { MilestoneList } from '@/components/MilestoneList';
import { ScoreDisplay, SubScoreBar } from '@/components/ScoreDisplay';
import { maxProfessionalScore } from '@/domain/evaluation';
import { NotificationList } from '@/components/NotificationList';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCoach } from '@/server/auth';
import { coachRefOf, getCoachOverview } from '@/server/services/evaluationService';
import { formatManYen, formatRate, formatScore, formatYearMonth, formatYen } from '@/lib/format';
import type { NotificationRow } from '@/lib/supabase/types';

export default async function CoachDashboardPage() {
  const session = await requireCoach();
  const supabase = await createSupabaseServerClient();
  const overview = await getCoachOverview(supabase, coachRefOf(session.coach));

  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, user_id, type, title, body, link_url, read_at, created_at')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(5)
    .returns<NotificationRow[]>();

  const { customerSuccess, sales, professional } = overview.evaluation;
  const { longTerm, shortTerm } = customerSuccess;
  const maxCustomerScore = overview.rules.customerSuccess.longTerm.max + overview.rules.customerSuccess.shortTerm.max;

  return (
    <div className="space-y-4">
      {/* ヒーロー: 「今何点か」を最優先で見せる */}
      <section className="rounded-[--radius-card] bg-eagle-900 px-5 py-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs tracking-[0.2em] text-gold-500">{session.coach.professional_level}</p>
            <p className="text-sm font-medium text-eagle-100">
              {PROFESSIONAL_LEVEL_LABELS[session.coach.professional_level]}
            </p>
          </div>
          <p className="text-xs text-eagle-100">{formatYearMonth(overview.yearMonth)} 速報</p>
        </div>
        <div className="mt-5">
          <p className="text-xs text-eagle-100">Professional Score</p>
          <ScoreDisplay
            score={professional.score}
            band={professional.band}
            reason={professional.reason}
            max={maxProfessionalScore(overview.rules)}
          />
        </div>
      </section>

      {/* 次の一歩: 「あと何をすると何が良くなるか」を、点数の内訳より先に見せる */}
      <Card>
        <CardHeader title="次の一歩" description="あと何をすると、何が良くなるか" />
        <CardBody className="py-1">
          <MilestoneList milestones={overview.milestones} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="内訳" description="顧客成果と売上の2軸で構成されます" />
        <CardBody className="space-y-4">
          <SubScoreBar
            label="顧客成果"
            score={customerSuccess.score}
            max={maxCustomerScore}
            detail={`長期 ${formatScore(longTerm.score)} + 短期 ${formatScore(shortTerm.score)}`}
          />
          <SubScoreBar
            label="売上"
            score={sales.score}
            max={overview.rules.sales.max}
            detail={`当月の税抜売上 ${formatYen(sales.amount)}`}
          />
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader title="長期｜完全成果率" description="開始4ヶ月経過以降の顧客が対象" />
          <CardBody>
            {longTerm.evaluable ? (
              <>
                <p className="tabular text-4xl font-bold text-eagle-900">{formatRate(longTerm.rate)}</p>
                <p className="mt-1 text-sm text-ink-500">
                  完全達成 {longTerm.achievedCount}名 / 評価対象 {longTerm.targetCount}名
                </p>
                {overview.customersNeededForTarget > 0 ? (
                  <p className="mt-3 rounded-xl bg-gold-100 px-3 py-2 text-sm font-medium text-gold-600">
                    あと{overview.customersNeededForTarget}名の達成で{Math.round(overview.targetRate * 100)}%に到達します
                  </p>
                ) : (
                  <p className="mt-3 rounded-xl bg-eagle-50 px-3 py-2 text-sm font-medium text-eagle-800">
                    {Math.round(overview.targetRate * 100)}%の基準を達成しています
                  </p>
                )}
              </>
            ) : (
              <EmptyState message="評価対象の顧客がまだいません" hint="開始から4ヶ月経過した顧客が対象になります" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="短期｜直近3ヶ月成果率" description="今も成果を出し続けているかを見る指標" />
          <CardBody>
            {shortTerm.evaluable ? (
              <>
                <p className="tabular text-4xl font-bold text-eagle-900">{formatRate(shortTerm.rate)}</p>
                <p className="mt-1 text-sm text-ink-500">
                  期間内達成 {shortTerm.achievedCount}名 / 対象 {shortTerm.targetCount}名
                </p>
              </>
            ) : (
              <EmptyState message="直近3ヶ月の対象顧客がいません" hint="評価対象かつ未達成の顧客が対象です" />
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="売上" description="評価対象商品の税抜売上 (返金の税抜相当額を控除)" />
        <CardBody>
          <dl className="grid grid-cols-3 gap-3 text-center">
            <SalesFigure label="今月" value={overview.salesBreakdown.monthly} />
            <SalesFigure label="直近3ヶ月" value={overview.salesBreakdown.quarterly} />
            <SalesFigure label="年間累計" value={overview.salesBreakdown.annual} />
          </dl>
          {overview.salesBreakdown.coachSnsMonthly > 0 ? (
            <p className="mt-4 rounded-xl bg-canvas px-3 py-2 text-xs text-ink-500">
              SNS経由の新規売上 {formatYen(overview.salesBreakdown.coachSnsMonthly)} は
              Professional Score の売上点には含みません (別枠管理)
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={overview.promotion.toLevel ? `${overview.promotion.toLevel} 昇格までの条件` : '昇格'}
          description="確定済みの月次評価をもとに判定しています"
          action={
            <Link href="/coach/promotion" className="text-xs text-eagle-700 underline-offset-2 hover:underline">
              詳細
            </Link>
          }
        />
        <CardBody>
          {overview.promotion.status === 'CANDIDATE' || overview.promotion.status === 'CANDIDATE_REQUIRES_APPROVAL' ? (
            <p className="mb-3">
              <Badge tone="gold">
                昇格条件を全て満たしています
                {overview.promotion.status === 'CANDIDATE_REQUIRES_APPROVAL' ? ' (ADMIN承認待ち)' : ''}
              </Badge>
            </p>
          ) : null}
          <ConditionList conditions={overview.promotion.conditions} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="今月の想定報酬 (参考値)" description="実際の給与計算とは分離した参考表示です" />
        <CardBody>
          <dl className="space-y-1.5 text-sm">
            <CompensationRow
              label={`レッスン報酬 (${overview.compensation.lessonCount ?? '—'}回 × ${formatYen(overview.compensation.lessonUnitPrice)})`}
              value={overview.compensation.lessonReward}
            />
            <CompensationRow label="成約ショットインセンティブ" value={overview.compensation.incentiveTotal} />
            <CompensationRow label="四半期成果ボーナス (3ヶ月平均から算出)" value={overview.compensation.bonusAmount} />
            <div className="flex items-baseline justify-between border-t border-line pt-2 text-base font-semibold">
              <dt>合計 (参考)</dt>
              <dd className="tabular">{formatYen(overview.compensation.total)}</dd>
            </div>
          </dl>
          {overview.compensation.isPartial ? (
            <p className="mt-3 text-xs text-ink-500">
              レッスン数が未入力のため、レッスン報酬を除いた金額です。
              <Link href="/coach/compensation" className="ml-1 text-eagle-700 underline-offset-2 hover:underline">
                入力する
              </Link>
            </p>
          ) : null}
        </CardBody>
      </Card>

      <NotificationList notifications={notifications ?? []} />

      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/coach/records/new"
          className="flex min-h-14 items-center justify-center rounded-xl bg-eagle-900 px-4 text-sm font-semibold text-white"
        >
          成果を登録
        </Link>
        <Link
          href="/coach/sales/new"
          className="flex min-h-14 items-center justify-center rounded-xl border border-eagle-900/20 bg-white px-4 text-sm font-semibold text-eagle-900"
        >
          売上を登録
        </Link>
      </div>
    </div>
  );
}

function SalesFigure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-canvas px-2 py-3">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="tabular mt-1 text-lg font-semibold text-ink-900">{formatManYen(value)}</dd>
    </div>
  );
}

function CompensationRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-700">{label}</dt>
      <dd className="tabular text-ink-900">{value === null ? '—' : formatYen(value)}</dd>
    </div>
  );
}

function EmptyState({ message, hint }: { message: string; hint: string }) {
  return (
    <div className="rounded-xl bg-canvas px-3 py-4">
      <p className="text-sm font-medium text-ink-700">{message}</p>
      <p className="mt-1 text-xs text-ink-500">{hint}</p>
      <p className="mt-2 text-xs text-ink-500">評価対象が0名のため、この指標は N/A として扱われます。</p>
    </div>
  );
}
