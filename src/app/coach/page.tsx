import Link from 'next/link';
import { PROFESSIONAL_LEVEL_LABELS } from '@/domain/types';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ConditionList } from '@/components/ConditionList';
import { MilestoneList } from '@/components/MilestoneList';
import { MonthlyActivity, type MonthlyActivitySummary } from '@/components/MonthlyActivity';
import { ScoreDisplay, SubScoreBar } from '@/components/ScoreDisplay';
import { NotificationList } from '@/components/NotificationList';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCoach } from '@/server/auth';
import { coachRefOf, getCoachOverview } from '@/server/services/evaluationService';
import { maxProfessionalScore, monthPeriod } from '@/domain/evaluation';
import { formatManYen, formatRate, formatYearMonth, formatYen } from '@/lib/format';
import type { NotificationRow, PerformanceRecordRow } from '@/lib/supabase/types';

export default async function CoachDashboardPage() {
  const session = await requireCoach();
  const supabase = await createSupabaseServerClient();
  const overview = await getCoachOverview(supabase, coachRefOf(session.coach));

  // 今月の登録実績。「登録しても何も返ってこない」を避けるための手応え表示に使う
  const thisMonth = monthPeriod(overview.yearMonth);
  const [{ data: notifications }, { data: monthlyRecords }] = await Promise.all([
    supabase
      .from('notifications')
      .select('id, user_id, type, title, body, link_url, read_at, created_at')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(5)
      .returns<NotificationRow[]>(),
    supabase
      .from('performance_records')
      .select('id, is_complete_success')
      .eq('coach_id', session.coach.id)
      .gte('recorded_on', thisMonth.from)
      .lte('recorded_on', thisMonth.to)
      .is('deleted_at', null)
      .returns<Pick<PerformanceRecordRow, 'id' | 'is_complete_success'>[]>(),
  ]);

  const monthlySales = overview.sales.filter((sale) => sale.soldOn >= thisMonth.from && sale.soldOn <= thisMonth.to);
  const activity: MonthlyActivitySummary = {
    recordCount: (monthlyRecords ?? []).length,
    achievedCount: (monthlyRecords ?? []).filter((r) => r.is_complete_success).length,
    saleCount: monthlySales.length,
    salesAmount: overview.salesBreakdown.monthly,
  };

  const { customerSuccess, sales, professional } = overview.evaluation;
  const { longTerm, shortTerm } = customerSuccess;
  const maxCustomerScore = overview.rules.customerSuccess.longTerm.max + overview.rules.customerSuccess.shortTerm.max;
  const maxScore = maxProfessionalScore(overview.rules);

  return (
    <div className="space-y-4">
      {/* いまどうなっているか。点数より先に「何月の話か」を出す */}
      <section className="rounded-[--radius-card] bg-eagle-900 px-5 py-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">{session.user.name} さん</p>
            <p className="mt-0.5 text-xs text-eagle-100">
              ランク {session.coach.professional_level}（{PROFESSIONAL_LEVEL_LABELS[session.coach.professional_level]}）
            </p>
          </div>
          <p className="text-xs text-eagle-100">{formatYearMonth(overview.yearMonth)}の途中経過</p>
        </div>
        <div className="mt-5">
          <p className="text-xs text-eagle-100">今月の評価</p>
          <ScoreDisplay score={professional.score} band={professional.band} reason={professional.reason} max={maxScore} />
        </div>
      </section>

      {/* 今日やること。ボタンは一番押しやすい上のほうに置く */}
      <MonthlyActivity summary={activity} />

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

      <Card>
        <CardHeader title="あと少しで、こうなります" description="今の数字から、次に届くところ" />
        <CardBody className="py-3">
          <MilestoneList milestones={overview.milestones} />
        </CardBody>
      </Card>

      {/* 評価の中身。長期・短期を別カードに分けると読む場所が増えるのでここに集約する */}
      <Card>
        <CardHeader
          title="評価の中身"
          description={`お客様の成果（${maxCustomerScore}点）＋ 売上（${overview.rules.sales.max}点）＝ 満点${maxScore}点`}
        />
        <CardBody className="space-y-5">
          <div>
            <SubScoreBar
              label="お客様の成果"
              score={customerSuccess.score}
              max={maxCustomerScore}
              detail="担当したお客様が目標を達成できたか"
            />
            <dl className="mt-3 space-y-2 rounded-xl bg-canvas px-3 py-3 text-sm">
              <BreakdownRow
                term="目標を達成したお客様"
                hint="レッスン開始から4ヶ月たったお客様が対象"
                value={longTerm.evaluable ? formatRate(longTerm.rate) : 'まだ対象のお客様がいません'}
                detail={longTerm.evaluable ? `${longTerm.achievedCount}名 / ${longTerm.targetCount}名` : undefined}
              />
              <BreakdownRow
                term="最近3ヶ月の達成"
                hint="今も成果が出続けているか"
                value={shortTerm.evaluable ? formatRate(shortTerm.rate) : 'まだ対象のお客様がいません'}
                detail={shortTerm.evaluable ? `${shortTerm.achievedCount}名 / ${shortTerm.targetCount}名` : undefined}
              />
            </dl>
          </div>

          <div>
            <SubScoreBar
              label="売上"
              score={sales.score}
              max={overview.rules.sales.max}
              detail="税抜の金額で数えます（返金分は差し引き）"
            />
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <SalesFigure label="今月" value={overview.salesBreakdown.monthly} />
              <SalesFigure label="この3ヶ月" value={overview.salesBreakdown.quarterly} />
              <SalesFigure label="今年" value={overview.salesBreakdown.annual} />
            </dl>
            {overview.salesBreakdown.coachSnsMonthly > 0 ? (
              <p className="mt-3 rounded-xl bg-canvas px-3 py-2 text-xs text-ink-500">
                ご自身のSNS経由の新規 {formatYen(overview.salesBreakdown.coachSnsMonthly)} は、評価の売上には入りません（別で管理しています）
              </p>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="今月の報酬の目安" description="実際の給与計算とは別の、参考の金額です" />
        <CardBody>
          <dl className="space-y-1.5 text-sm">
            <CompensationRow
              label={`レッスン報酬（${overview.compensation.lessonCount ?? '—'}回 × ${formatYen(overview.compensation.lessonUnitPrice)}）`}
              value={overview.compensation.lessonReward}
            />
            <CompensationRow label="成約したときのインセンティブ" value={overview.compensation.incentiveTotal} />
            <CompensationRow label="3ヶ月ごとのボーナス" value={overview.compensation.bonusAmount} />
            <div className="flex items-baseline justify-between border-t border-line pt-2 text-base font-semibold">
              <dt>合計（目安）</dt>
              <dd className="tabular">{formatYen(overview.compensation.total)}</dd>
            </div>
          </dl>
          {overview.compensation.isPartial ? (
            <p className="mt-3 rounded-xl bg-gold-100 px-3 py-2 text-xs text-gold-600">
              今月のレッスン回数がまだ入っていないため、レッスン報酬は含んでいません。
              <Link href="/coach/compensation" className="ml-1 font-semibold underline underline-offset-2">
                回数を入力する
              </Link>
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={overview.promotion.toLevel ? `${overview.promotion.toLevel} へのランクアップ条件` : 'ランクアップ'}
          description="確定した月の評価をもとに見ています（今月の途中経過は含みません）"
          action={
            <Link href="/coach/promotion" className="text-xs text-eagle-700 underline-offset-2 hover:underline">
              詳しく
            </Link>
          }
        />
        <CardBody>
          {overview.promotion.status === 'CANDIDATE' || overview.promotion.status === 'CANDIDATE_REQUIRES_APPROVAL' ? (
            <p className="mb-3">
              <Badge tone="gold">
                条件を全て満たしています
                {overview.promotion.status === 'CANDIDATE_REQUIRES_APPROVAL' ? '（会社の承認待ち）' : ''}
              </Badge>
            </p>
          ) : null}
          <ConditionList conditions={overview.promotion.conditions} />
        </CardBody>
      </Card>

      <NotificationList notifications={notifications ?? []} />
    </div>
  );
}

function BreakdownRow({
  term,
  hint,
  value,
  detail,
}: {
  term: string;
  hint: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <dt className="text-sm text-ink-900">{term}</dt>
        <p className="mt-0.5 text-xs text-ink-500">{hint}</p>
      </div>
      <dd className="shrink-0 text-right">
        <span className="tabular text-base font-semibold text-ink-900">{value}</span>
        {detail ? <p className="mt-0.5 text-xs text-ink-500">{detail}</p> : null}
      </dd>
    </div>
  );
}

function SalesFigure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-canvas px-2 py-3">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="tabular mt-1 text-lg font-semibold text-ink-900">{formatManYen(value)}円</dd>
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
