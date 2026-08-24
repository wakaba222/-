import Link from 'next/link';
import { PROFESSIONAL_LEVEL_LABELS } from '@/domain/types';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/server/auth';
import { loadAdminCoaches } from '@/server/services/adminOverviewService';
import { formatDate, formatYen } from '@/lib/format';
import { NewCoachForm } from './NewCoachForm';

export default async function AdminCoachesPage() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const coaches = await loadAdminCoaches(supabase);

  const { data: customerCounts } = await supabase
    .from('customers')
    .select('current_coach_id')
    .is('deleted_at', null)
    .returns<{ current_coach_id: string | null }[]>();

  const countByCoach = new Map<string, number>();
  for (const row of customerCounts ?? []) {
    if (!row.current_coach_id) continue;
    countByCoach.set(row.current_coach_id, (countByCoach.get(row.current_coach_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="コーチ一覧" description={`${coaches.length}名`} />
        <CardBody className="py-2">
          {coaches.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500">
              コーチが登録されていません。下のフォームから登録してください。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-500">
                    <th className="py-2 pr-3 font-medium">氏名</th>
                    <th className="py-2 pr-3 font-medium">メールアドレス</th>
                    <th className="py-2 pr-3 font-medium">ランク</th>
                    <th className="py-2 pr-3 text-right font-medium">レッスン単価</th>
                    <th className="py-2 pr-3 text-right font-medium">担当顧客</th>
                    <th className="py-2 pr-3 font-medium">入社日</th>
                    <th className="py-2 font-medium">状態</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {coaches.map((coach) => (
                    <tr key={coach.id} className="hover:bg-canvas">
                      <td className="py-2.5 pr-3">
                        <Link href={`/admin/coaches/${coach.id}`} className="font-medium text-ink-900 hover:text-eagle-700">
                          {coach.users?.name ?? '(名称未設定)'}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-3 text-ink-700">{coach.users?.email ?? '—'}</td>
                      <td className="py-2.5 pr-3 text-ink-700">
                        {coach.professional_level} {PROFESSIONAL_LEVEL_LABELS[coach.professional_level]}
                      </td>
                      <td className="tabular py-2.5 pr-3 text-right">{formatYen(coach.lesson_unit_price)}</td>
                      <td className="tabular py-2.5 pr-3 text-right">{countByCoach.get(coach.id) ?? 0}名</td>
                      <td className="tabular py-2.5 pr-3 text-ink-700">{formatDate(coach.hire_date)}</td>
                      <td className="py-2.5">
                        {coach.left_on ? (
                          <Badge tone="danger">退職 ({formatDate(coach.left_on)})</Badge>
                        ) : (
                          <Badge tone="success">在籍</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="コーチを登録"
          description="ログインアカウントも同時に作成します。初回パスワードは登録後に一度だけ表示されます"
        />
        <CardBody>
          <NewCoachForm />
        </CardBody>
      </Card>

      <p className="text-xs text-ink-500">
        退職したコーチは詳細画面で退職日を設定してください。過去の評価履歴は残したまま、月次締めの対象から外れます。
      </p>
    </div>
  );
}

export const dynamic = 'force-dynamic';
