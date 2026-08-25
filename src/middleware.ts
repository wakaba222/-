import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { createInstrumentedFetch, isPerfDebugEnabled } from '@/lib/perf';

/**
 * Supabase のセッション Cookie を更新する。
 * Server Component からは Cookie を書けないため、更新はここで行う。
 *
 * 認可そのものは各ページの requireAdmin/requireCoach と DB の RLS が担保する。
 * middleware は「セッションを保つ」ことだけを責務にしている。
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      ...(isPerfDebugEnabled() ? { global: { fetch: createInstrumentedFetch('middleware') } } : {}),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // getClaims() は非対称署名鍵なら JWKS でローカル検証するため Auth サーバーへ出ない。
  // 期限が近い場合は内部で getSession() がリフレッシュするので、Cookie 更新の役目は変わらない。
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  // 認証を必要としない経路 (ログイン画面・cron・静的ファイル) はセッション更新の対象外。
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
