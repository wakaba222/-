'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fail, type ActionResult } from '@/server/actionResult';

const signInSchema = z.object({
  email: z.string().email('メールアドレスの形式が正しくありません'),
  password: z.string().min(1, 'パスワードを入力してください'),
});

export async function signInAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? '入力内容を確認してください');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return fail('メールアドレスまたはパスワードが正しくありません');

  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('email', parsed.data.email)
    .maybeSingle<{ role: 'ADMIN' | 'COACH' }>();

  redirect(userRow?.role === 'ADMIN' ? '/admin' : '/coach');
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
