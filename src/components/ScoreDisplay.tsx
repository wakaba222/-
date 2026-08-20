import { formatScore } from '@/lib/format';
import { cn } from '@/lib/cn';

export function ScoreDisplay({
  score,
  band,
  reason,
  max,
}: {
  score: number | null;
  band: string;
  reason?: string | null;
  /** 満点。評価ルールから算出した値を渡す (コードに120を持たない) */
  max: number;
}) {
  const ratio = score === null || max <= 0 ? 0 : Math.min(score / max, 1);

  return (
    <div>
      <div className="flex items-end gap-3">
        <span className={cn('tabular text-6xl font-bold leading-none tracking-tight', score === null ? 'text-ink-300' : 'text-white')}>
          {formatScore(score)}
        </span>
        <span className="pb-1.5 text-sm text-eagle-100">/ {max}</span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full bg-gold-500 transition-[width]" style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="mt-2 text-sm font-medium text-gold-500">{band}</p>
      {reason ? <p className="mt-1 text-xs text-eagle-100/80">{reason}</p> : null}
    </div>
  );
}

/** サブスコア (顧客成果 / 売上) のバー表示 */
export function SubScoreBar({
  label,
  score,
  max,
  detail,
}: {
  label: string;
  score: number | null;
  max: number;
  detail?: string;
}) {
  const ratio = score === null ? 0 : Math.min(score / max, 1);
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-ink-700">{label}</span>
        <span className="tabular font-semibold text-ink-900">
          {formatScore(score)} <span className="text-xs font-normal text-ink-500">/ {max}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-canvas">
        <div className="h-full rounded-full bg-eagle-600" style={{ width: `${ratio * 100}%` }} />
      </div>
      {detail ? <p className="mt-1 text-xs text-ink-500">{detail}</p> : null}
    </div>
  );
}
