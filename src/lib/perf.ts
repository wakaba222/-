/**
 * Supabase への通信を計測するための fetch ラッパー。
 *
 * PERF_DEBUG=1 のときだけ有効になり、1リクエストあたりの
 * 「何回・どのテーブルへ・何ミリ秒」をサーバーログへ出す。
 * 通常運用では何も挟まないため、本番の実行経路には影響しない。
 */

export function isPerfDebugEnabled(): boolean {
  return process.env.PERF_DEBUG === '1';
}

/** URL から計測用の短いラベルを作る (テーブル名やRPC名が分かれば十分) */
function labelOf(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace('/rest/v1/', '').replace('/auth/v1/', 'auth:');
    const select = parsed.searchParams.get('select');
    const filters = [...parsed.searchParams.entries()]
      .filter(([key]) => !['select', 'order', 'limit', 'offset'].includes(key))
      .map(([key]) => key)
      .join(',');
    return `${path}${filters ? `?${filters}` : ''}${select && select.length > 40 ? ' [wide select]' : ''}`;
  } catch {
    return url;
  }
}

export function createInstrumentedFetch(tag: string): typeof fetch {
  let count = 0;
  let totalMs = 0;

  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const startedAt = performance.now();
    const response = await fetch(input, init);
    const elapsed = performance.now() - startedAt;

    count += 1;
    totalMs += elapsed;
    console.log(`[perf:${tag}] #${count} ${elapsed.toFixed(0)}ms ${labelOf(url)} (累計 ${totalMs.toFixed(0)}ms)`);
    return response;
  };
}
