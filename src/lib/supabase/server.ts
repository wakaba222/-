import { createServerClient } from '@supabase/ssr';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { publicEnv, requireServiceRoleKey } from '@/lib/env';
import { createInstrumentedFetch, isPerfDebugEnabled } from '@/lib/perf';

/**
 * サーバー側 Supabase クライアント。
 * ログインユーザーの JWT で接続するため、RLS がそのまま効く。
 *
 * React の cache() で 1 リクエスト 1 インスタンスに固定している。
 * layout と page が別々に呼んでも同じクライアントを共有するため、
 * セッション確認の往復が二重に発生しない (権限判定は各画面と RLS がそのまま行う)。
 */
export const createSupabaseServerClient = cache(async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    ...(isPerfDebugEnabled() ? { global: { fetch: createInstrumentedFetch('server') } } : {}),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component からの呼び出しでは Cookie を書けない。
          // セッション更新は middleware 側で行うため、ここでは無視してよい。
        }
      },
    },
  });
});

/**
 * RLS をバイパスするサービスロールクライアント。
 * 月次締めジョブなど、全コーチ横断で書き込む処理だけに使う。
 * リクエストのユーザー入力を混ぜないこと。
 */
export function createSupabaseServiceClient() {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, requireServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(isPerfDebugEnabled() ? { global: { fetch: createInstrumentedFetch('service') } } : {}),
  });
}
