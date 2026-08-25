import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CoachRow, UserRow } from '@/lib/supabase/types';

export interface SessionContext {
  user: UserRow;
  coach: CoachRow | null;
}

/**
 * 未ログインなら null。画面側で分岐したい場合に使う。
 *
 * cache() により 1 リクエスト中は 1 回しか実行されない。
 * layout と page の両方が requireCoach() を呼んでも問い合わせは 1 度きりになる。
 *
 * JWT の検証は getClaims() で行う。本プロジェクトの署名鍵は非対称鍵 (ES256) のため
 * JWKS を使ってローカル検証でき、Auth サーバーへの往復が 1 回減る。
 * 失効・退職の判定は下の users.active と DB 側の RLS が引き続き担保する。
 */
export const getSessionContext = cache(async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const authUserId = claimsData?.claims?.sub;
  if (claimsError || !authUserId) return null;

  const [{ data: user }, { data: coach }] = await Promise.all([
    supabase.from('users').select('id, name, email, role, active').eq('id', authUserId).maybeSingle<UserRow>(),
    supabase
      .from('coaches')
      .select('id, user_id, professional_level, lesson_unit_price, hire_date, left_on')
      .eq('user_id', authUserId)
      .maybeSingle<CoachRow>(),
  ]);

  if (!user || !user.active) return null;

  return { user, coach: coach ?? null };
});

/** 未ログインならログイン画面へ */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) redirect('/login');
  return session;
}

export async function requireAdmin(): Promise<SessionContext> {
  const session = await requireSession();
  if (session.user.role !== 'ADMIN') redirect('/coach');
  return session;
}

/** COACH 用画面。ADMIN が誤って開いた場合は管理画面へ戻す */
export async function requireCoach(): Promise<SessionContext & { coach: CoachRow }> {
  const session = await requireSession();
  if (!session.coach) redirect(session.user.role === 'ADMIN' ? '/admin' : '/login');
  return { ...session, coach: session.coach };
}
