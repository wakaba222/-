import Link from 'next/link';
import type { ReactNode } from 'react';
import { signOutAction } from '@/server/actions/authActions';
import { cn } from '@/lib/cn';

export interface NavItem {
  href: string;
  label: string;
}

/**
 * 画面の外枠。
 * COACH はスマホ利用が中心のため下部固定ナビ、ADMIN は PC 中心のため上部ナビにする。
 */
export function AppShell({
  role,
  userName,
  navItems,
  unreadCount,
  children,
}: {
  role: 'ADMIN' | 'COACH';
  userName: string;
  navItems: NavItem[];
  unreadCount?: number;
  children: ReactNode;
}) {
  const isCoach = role === 'COACH';

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-eagle-800 bg-eagle-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Link href={isCoach ? '/coach' : '/admin'} className="flex items-baseline gap-2">
            <span className="text-xs font-semibold tracking-[0.25em] text-gold-500">EAGLE</span>
            <span className="text-sm font-medium text-white">
              {isCoach ? 'Coach Performance' : 'Admin Console'}
            </span>
          </Link>

          <div className="flex items-center gap-3">
            {unreadCount && unreadCount > 0 ? (
              <span className="rounded-full bg-gold-500 px-2 py-0.5 text-xs font-semibold text-eagle-950">
                お知らせ {unreadCount}
              </span>
            ) : null}
            <span className="hidden text-xs text-eagle-100 sm:inline">{userName}</span>
            <form action={signOutAction}>
              <button type="submit" className="text-xs text-eagle-100 underline-offset-2 hover:underline">
                ログアウト
              </button>
            </form>
          </div>
        </div>

        {!isCoach ? (
          <nav className="mx-auto max-w-7xl overflow-x-auto px-4">
            <ul className="flex gap-1 pb-1">
              {navItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="inline-block whitespace-nowrap rounded-t-lg px-3 py-2 text-sm text-eagle-100 hover:bg-eagle-800 hover:text-white"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </header>

      <main className={cn('mx-auto w-full max-w-7xl px-4 py-5', isCoach && 'max-w-2xl pb-28')}>{children}</main>

      {isCoach ? (
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 backdrop-blur">
          <ul className="mx-auto flex max-w-2xl">
            {navItems.map((item) => (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  className="flex min-h-14 flex-col items-center justify-center px-1 text-xs text-ink-700 hover:text-eagle-800"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
