import type { SnapshotSummary } from '@/domain/types';
import { formatScore, formatYearMonth } from '@/lib/format';

/** Professional Score の最大値 */
const MAX_SCORE = 120;

/**
 * スコア推移のミニチャート。
 * 依存を増やさず、スマホでも潰れないよう単純な棒表示にしている。
 */
export function ScoreTrend({ snapshots }: { snapshots: SnapshotSummary[] }) {
  if (snapshots.length === 0) {
    return <p className="text-sm text-ink-500">確定済みの評価がまだありません。月次締めを行うと表示されます。</p>;
  }

  return (
    <ul className="space-y-2">
      {snapshots.map((snapshot) => {
        const ratio = snapshot.professionalScore === null ? 0 : Math.min(snapshot.professionalScore / MAX_SCORE, 1);
        return (
          <li key={snapshot.yearMonth} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs text-ink-500">{formatYearMonth(snapshot.yearMonth)}</span>
            <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-canvas">
              <span className="block h-full rounded-full bg-eagle-600" style={{ width: `${ratio * 100}%` }} />
            </span>
            <span className="tabular w-12 shrink-0 text-right text-sm font-semibold text-ink-900">
              {formatScore(snapshot.professionalScore)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
