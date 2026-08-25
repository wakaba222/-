import Link from 'next/link';

/**
 * 今月コーチ自身が登録した記録のまとめ。
 *
 * 「登録しても何も返ってこない」と報告が止まるため、
 * 登録した件数をそのまま見せて手応えにする。
 * 0件のときは責める文言にせず、最初の1件へ誘導する。
 */
export interface MonthlyActivitySummary {
  /** 今月登録した成果記録の件数 */
  recordCount: number;
  /** そのうち目標を達成した件数 */
  achievedCount: number;
  /** 今月登録した売上の件数 */
  saleCount: number;
  /** 今月の税抜売上 */
  salesAmount: number;
}

function formatManYen(amount: number): string {
  return `${Math.round(amount / 10_000).toLocaleString('ja-JP')}万`;
}

export function MonthlyActivity({ summary }: { summary: MonthlyActivitySummary }) {
  const nothingYet = summary.recordCount === 0 && summary.saleCount === 0;

  return (
    <section className="rounded-[--radius-card] border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-900">今月あなたが登録した記録</h2>
        {summary.achievedCount > 0 ? (
          <span className="rounded-full bg-gold-100 px-2.5 py-1 text-xs font-bold text-gold-600">
            🎉 目標達成 {summary.achievedCount}件
          </span>
        ) : null}
      </div>

      {nothingYet ? (
        <div className="mt-3 rounded-xl bg-canvas px-3 py-4 text-center">
          <p className="text-sm font-medium text-ink-700">今月はまだ登録がありません</p>
          <p className="mt-1 text-xs text-ink-500">
            レッスンの記録を1件入れるだけで、Score にすぐ反映されます
          </p>
          <Link
            href="/coach/records/new"
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-eagle-900 px-5 text-sm font-semibold text-white"
          >
            最初の成果を登録する
          </Link>
        </div>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-canvas px-3 py-3">
            <dt className="text-xs text-ink-500">成果の記録</dt>
            <dd className="tabular mt-1 text-2xl font-bold leading-none text-ink-900">
              {summary.recordCount}
              <span className="ml-0.5 text-sm font-medium text-ink-500">件</span>
            </dd>
          </div>
          <div className="rounded-xl bg-canvas px-3 py-3">
            <dt className="text-xs text-ink-500">売上</dt>
            <dd className="tabular mt-1 text-2xl font-bold leading-none text-ink-900">
              {summary.saleCount}
              <span className="ml-0.5 text-sm font-medium text-ink-500">件</span>
              <span className="ml-2 text-sm font-semibold text-ink-700">{formatManYen(summary.salesAmount)}円</span>
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
