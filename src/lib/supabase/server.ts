import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { publicEnv, requireServiceRoleKey } from '@/lib/env';

/**
 * サーバー側 Supabase クライアント。
 * ログインユーザーの JWT で接続するため、RLS がそのまま効く。
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
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
}

/**
 * RLS をバイパスするサービスロールクライアント。
 * 月次締めジョブなど、全コーチ横断で書き込む処理だけに使う。
 * リクエストのユーザー入力を混ぜないこと。
 */
export function createSupabaseServiceClient() {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, requireServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
