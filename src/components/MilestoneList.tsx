import type { Milestone } from '@/domain/evaluation';

/**
 * 「あと何をすると、何が良くなるか」の一覧。
 *
 * コーチが見て次の行動が決まることが唯一の目的なので、
 * 「あと○○」を左に、「そうすると△△」を右に置き、1行で読み切れる形にする。
 */

/** 種別ごとの見た目。金額で示せるものを強く見せる */
const TONE: Record<Milestone['code'], { icon: string; accent: string }> = {
  LONG_TERM: { icon: '🎯', accent: 'text-eagle-700' },
  SHORT_TERM: { icon: '🔥', accent: 'text-eagle-700' },
  SALES: { icon: '💴', accent: 'text-eagle-700' },
  BONUS: { icon: '🎁', accent: 'text-gold-600' },
  PROMOTION: { icon: '🏅', accent: 'text-gold-600' },
};

export function MilestoneList({ milestones }: { milestones: Milestone[] }) {
  if (milestones.length === 0) {
    return (
      <p className="py-2 text-sm text-ink-500">
        現在の指標はすべて上限に達しています。この水準を維持してください。
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {milestones.map((milestone) => {
        const tone = TONE[milestone.code];
        return (
          <li key={milestone.code} className="py-3">
            <div className="flex items-start gap-3">
              <span aria-hidden className="mt-0.5 text-base leading-none">
                {tone.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-ink-500">{milestone.category}</p>
                <p className="mt-0.5 text-sm font-semibold text-ink-900">{milestone.action}</p>
                <p className={`mt-1 text-sm font-semibold ${tone.accent}`}>→ {milestone.reward}</p>
                {milestone.note ? <p className="mt-1 text-xs text-ink-500">{milestone.note}</p> : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
