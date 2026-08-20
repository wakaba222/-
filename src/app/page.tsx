import { redirect } from 'next/navigation';
import { getSessionContext } from '@/server/auth';

export default async function RootPage() {
  const session = await getSessionContext();
  if (!session) redirect('/login');
  redirect(session.user.role === 'ADMIN' ? '/admin' : '/coach');
}
