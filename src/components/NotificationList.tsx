import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import type { NotificationRow } from '@/lib/supabase/types';
import { markNotificationsReadAction } from '@/server/actions/coachActions';

export function NotificationList({ notifications }: { notifications: NotificationRow[] }) {
  if (notifications.length === 0) return null;
  const hasUnread = notifications.some((n) => n.read_at === null);

  return (
    <Card>
      <CardHeader
        title="お知らせ"
        action={
          hasUnread ? (
            <form action={markNotificationsReadAction}>
              <button type="submit" className="text-xs text-eagle-700 underline-offset-2 hover:underline">
                すべて既読
              </button>
            </form>
          ) : null
        }
      />
      <CardBody className="py-0">
        <ul className="divide-y divide-line">
          {notifications.map((notification) => {
            const content = (
              <>
                <p className="text-sm font-medium text-ink-900">{notification.title}</p>
                {notification.body ? <p className="mt-0.5 text-xs text-ink-500">{notification.body}</p> : null}
              </>
            );
            return (
              <li key={notification.id} className="py-3">
                <div className="flex items-start gap-2">
                  {notification.read_at === null ? (
                    <span aria-label="未読" className="mt-1.5 size-2 shrink-0 rounded-full bg-gold-500" />
                  ) : (
                    <span className="mt-1.5 size-2 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    {notification.link_url ? <Link href={notification.link_url}>{content}</Link> : content}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
