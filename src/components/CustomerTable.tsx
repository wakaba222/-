import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/format';
import type { CustomerView } from '@/server/services/customerViewService';

const STATUS_LABEL: Record<CustomerView['status'], string> = {
  ACTIVE: '進行中',
  SUSPENDED: '休会',
  COMPLETED: 'プログラム終了',
  CANCELLED: '解約',
};

export function CustomerTable({
  customers,
  basePath,
  showCoach = false,
}: {
  customers: CustomerView[];
  basePath: string;
  showCoach?: boolean;
}) {
  if (customers.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-500">該当する顧客がいません。</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-500">
            <th className="py-2 pr-3 font-medium">顧客名</th>
            {showCoach ? <th className="py-2 pr-3 font-medium">担当</th> : null}
            <th className="py-2 pr-3 font-medium">開始日</th>
            <th className="py-2 pr-3 font-medium">経過</th>
            <th className="py-2 pr-3 font-medium">目標</th>
            <th className="py-2 pr-3 font-medium">現在成果</th>
            <th className="py-2 pr-3 font-medium">評価</th>
            <th className="py-2 pr-3 font-medium">達成</th>
            <th className="py-2 font-medium">最終更新</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {customers.map((customer) => (
            <tr key={customer.id} className="hover:bg-canvas">
              <td className="py-2.5 pr-3">
                <Link href={`${basePath}/${customer.id}`} className="font-medium text-ink-900 hover:text-eagle-700">
                  {customer.name}
                </Link>
                {!customer.goalApproved ? (
                  <span className="ml-2">
                    <Badge tone="warn">目標未承認</Badge>
                  </span>
                ) : null}
                {customer.status !== 'ACTIVE' ? (
                  <span className="ml-2 text-xs text-ink-500">{STATUS_LABEL[customer.status]}</span>
                ) : null}
              </td>
              {showCoach ? <td className="py-2.5 pr-3 text-ink-700">{customer.coachName ?? '—'}</td> : null}
              <td className="tabular py-2.5 pr-3 text-ink-700">{formatDate(customer.programStartDate)}</td>
              <td className="tabular py-2.5 pr-3 text-ink-700">{customer.elapsedMonths}ヶ月</td>
              <td className="py-2.5 pr-3 text-ink-700">{customer.goalLabel}</td>
              <td className="py-2.5 pr-3 text-ink-700">{customer.latestLabel}</td>
              <td className="py-2.5 pr-3">
                {customer.isEligible ? <Badge tone="success">対象</Badge> : <Badge>対象外</Badge>}
              </td>
              <td className="py-2.5 pr-3">
                {customer.completeSuccess ? (
                  <Badge tone="gold">完全達成</Badge>
                ) : (
                  <span className="text-xs text-ink-500">未達</span>
                )}
              </td>
              <td className="tabular py-2.5 text-xs text-ink-500">{formatDate(customer.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
