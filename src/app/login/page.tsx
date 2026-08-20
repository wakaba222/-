import { redirect } from 'next/navigation';
import { getSessionContext } from '@/server/auth';
import { LoginForm } from './LoginForm';

export default async function LoginPage() {
  const session = await getSessionContext();
  if (session) redirect(session.user.role === 'ADMIN' ? '/admin' : '/coach');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-eagle-900 px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold tracking-[0.3em] text-gold-500">EAGLE</p>
          <h1 className="mt-2 text-xl font-semibold text-white">Coach Performance</h1>
          <p className="mt-1 text-sm text-eagle-100">評価・報酬管理システム</p>
        </div>
        <div className="rounded-[--radius-card] bg-white p-5 shadow-lg">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
