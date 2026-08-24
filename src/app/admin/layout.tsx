import type { ReactNode } from 'react';
import { AppShell, type NavItem } from '@/components/AppShell';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/server/auth';

const NAV_ITEMS: NavItem[] = [
  { href: '/admin', label: 'ダッシュボード' },
  { href: '/admin/coaches', label: 'コーチ' },
  { href: '/admin/customers', label: '顧客' },
  { href: '/admin/approvals', label: '目標承認' },
  { href: '/admin/promotions', label: '昇格審査' },
  { href: '/admin/close', label: '月次締め' },
  { href: '/admin/sales', label: '売上' },
  { href: '/admin/products', label: '商品マスタ' },
  { href: '/admin/rules', label: '評価ルール' },
  { href: '/admin/audit', label: '監査ログ' },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', session.user.id)
    .is('read_at', null);

  return (
    <AppShell role="ADMIN" userName={session.user.name} navItems={NAV_ITEMS} unreadCount={count ?? 0}>
      {children}
    </AppShell>
  );
}
