import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/server/auth';
import type { AuditLogRow, UserRow } from '@/lib/supabase/types';

/** 変更差分として表示する対象外の列 (更新のたびに必ず変わるため意味がない) */
const IGNORED_KEYS = new Set(['updated_at', 'created_at']);

function diffOf(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  if (!before || !after) return [];
  return Object.keys(after)
    .filter((key) => !IGNORED_KEYS.has(key))
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => `${key}: ${JSON.stringify(before[key])} → ${JSON.stringify(after[key])}`);
}

export default async function AuditLogPage() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const [{ data: logs }, { data: users }] = await Promise.all([
    supabase
      .from('audit_logs')
      .select('id, actor_user_id, entity_table, entity_id, action, before, after, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
      .returns<AuditLogRow[]>(),
    supabase.from('users').select('id, name, email, role, active').returns<UserRow[]>(),
  ]);

  const userNames = new Map((users ?? []).map((u) => [u.id, u.name]));

  return (
    <Card>
      <CardHeader title="監査ログ" description="重要操作の変更前→変更後を記録しています (直近100件)" />
      <CardBody className="py-2">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-500">
                <th className="py-2 pr-3 font-medium">日時</th>
                <th className="py-2 pr-3 font-medium">実行者</th>
                <th className="py-2 pr-3 font-medium">対象</th>
                <th className="py-2 pr-3 font-medium">操作</th>
                <th className="py-2 font-medium">変更内容</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(logs ?? []).map((log) => {
                const changes = diffOf(log.before, log.after);
                return (
                  <tr key={log.id}>
                    <td className="py-2 pr-3 text-xs text-ink-500">{log.created_at.slice(0, 16).replace('T', ' ')}</td>
                    <td className="py-2 pr-3">{log.actor_user_id ? (userNames.get(log.actor_user_id) ?? '—') : 'システム'}</td>
                    <td className="py-2 pr-3 text-ink-700">{log.entity_table}</td>
                    <td className="py-2 pr-3 text-ink-700">{log.action}</td>
                    <td className="py-2 text-xs text-ink-700">
                      {changes.length === 0 ? '—' : changes.slice(0, 4).join(' / ')}
                      {changes.length > 4 ? ` ほか${changes.length - 4}件` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

export const dynamic = 'force-dynamic';
