import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CoachRow, UserRow } from '@/lib/supabase/types';

export interface SessionContext {
  user: UserRow;
  coach: CoachRow | null;
}

/** 未ログインなら null。画面側で分岐したい場合に使う */
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const { data: user } = await supabase
    .from('users')
    .select('id, name, email, role, active')
    .eq('id', authUser.id)
    .maybeSingle<UserRow>();

  if (!user || !user.active) return null;

  const { data: coach } = await supabase
    .from('coaches')
    .select('id, user_id, professional_level, lesson_unit_price, hire_date, left_on')
    .eq('user_id', authUser.id)
    .maybeSingle<CoachRow>();

  return { user, coach: coach ?? null };
}

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
