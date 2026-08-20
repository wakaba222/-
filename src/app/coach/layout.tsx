import type { ReactNode } from 'react';
import { AppShell, type NavItem } from '@/components/AppShell';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCoach } from '@/server/auth';

const NAV_ITEMS: NavItem[] = [
  { href: '/coach', label: 'ホーム' },
  { href: '/coach/customers', label: '担当顧客' },
  { href: '/coach/records/new', label: '成果登録' },
  { href: '/coach/sales/new', label: '売上登録' },
  { href: '/coach/promotion', label: '昇格' },
];

export default async function CoachLayout({ children }: { children: ReactNode }) {
  const session = await requireCoach();
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', session.user.id)
    .is('read_at', null);

  return (
    <AppShell role="COACH" userName={session.user.name} navItems={NAV_ITEMS} unreadCount={count ?? 0}>
      {children}
    </AppShell>
  );
}
