import type { Milestone } from '@/domain/evaluation';

/**
 * 「あと何をすると、何が良くなるか」の一覧。
 *
 * コーチがスマホで一目見て次の行動が決まることが目的。
 *   ・あと「いくつ」かを一番大きく
 *   ・そのすぐ横に「そうすると何が良くなるか」
 *   ・下に進捗バーで「どこまで来ているか」
 * の3点だけに絞り、説明文は最小限にしている。
 */

const TONE: Record<Milestone['code'], { icon: string; bar: string; chip: string }> = {
  LONG_TERM: { icon: '🎯', bar: 'bg-eagle-600', chip: 'bg-eagle-50 text-eagle-800' },
  SHORT_TERM: { icon: '🔥', bar: 'bg-eagle-600', chip: 'bg-eagle-50 text-eagle-800' },
  SALES: { icon: '💴', bar: 'bg-eagle-600', chip: 'bg-eagle-50 text-eagle-800' },
  BONUS: { icon: '🎁', bar: 'bg-gold-500', chip: 'bg-gold-100 text-gold-600' },
  PROMOTION: { icon: '🏅', bar: 'bg-gold-500', chip: 'bg-gold-100 text-gold-600' },
};

export function MilestoneList({ milestones }: { milestones: Milestone[] }) {
  if (milestones.length === 0) {
    return (
      <p className="py-3 text-sm text-ink-500">
        すべての指標が上限に達しています。この水準を維持してください。
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {milestones.map((milestone) => {
        const tone = TONE[milestone.code];
        const percent = Math.round(milestone.progress * 100);

        return (
          <li key={milestone.code} className="rounded-xl border border-line bg-white p-3.5">
            {/* 見返りの文言が長いと横並びが潰れるため、入りきらなければ折り返す */}
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
                  <span aria-hidden>{tone.icon}</span>
                  {milestone.category}
                </p>
                <p className="mt-1.5 flex items-baseline gap-1.5">
                  {milestone.achieved ? (
                    <span className="text-2xl font-bold leading-none text-eagle-800">🎉 {milestone.gap}</span>
                  ) : (
                    <>
                      <span className="text-sm text-ink-500">あと</span>
                      <span className="tabular text-2xl font-bold leading-none text-ink-900">{milestone.gap}</span>
                    </>
                  )}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${tone.chip}`}>
                {milestone.reward}
              </span>
            </div>

            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-canvas" role="presentation">
                <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${percent}%` }} />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-xs text-ink-500">
                <span className="tabular">{milestone.progressLabel.current}</span>
                <span className="tabular">目標 {milestone.progressLabel.target}</span>
              </div>
            </div>

            {milestone.note ? <p className="mt-2 text-xs text-ink-500">{milestone.note}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
