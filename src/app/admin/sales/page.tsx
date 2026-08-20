import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/server/auth';
import { loadAdminCoaches } from '@/server/services/adminOverviewService';
import { formatDate, formatYen } from '@/lib/format';
import type { SaleRow } from '@/lib/supabase/types';
import { SaleStatusForm } from './SaleStatusForm';
import Link from 'next/link';

const ACQUISITION_LABEL: Record<string, string> = {
  EXISTING: '既存・クロスセル',
  COACH_SNS: 'コーチSNS経由',
  COMPANY: '会社送客',
  OTHER: 'その他',
};

export default async function AdminSalesPage() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const [{ data: sales }, coaches] = await Promise.all([
    supabase
      .from('sales')
      .select('id, coach_id, customer_id, product_id, sold_on, amount, incentive_amount, acquisition_source, payment_source, status, refund_amount, tax_amount, payment_fee, net_amount, note, products(id, name, code, is_sales_score_target), customers(id, name)')
      .is('deleted_at', null)
      .order('sold_on', { ascending: false })
      .limit(100)
      .returns<SaleRow[]>(),
    loadAdminCoaches(supabase),
  ]);

  const coachNames = new Map(coaches.map((c) => [c.id, c.users?.name ?? '(名称未設定)']));

  return (
    <Card>
      <CardHeader
        title="売上一覧"
        description="取消・返金は行を削除せず状態として記録します。反映には対象月の再締めが必要です"
        action={
          <Link href="/api/export/sales" className="text-xs text-eagle-700 underline-offset-2 hover:underline">
            CSV出力
          </Link>
        }
      />
      <CardBody className="py-2">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-500">
                <th className="py-2 pr-3 font-medium">成約日</th>
                <th className="py-2 pr-3 font-medium">コーチ</th>
                <th className="py-2 pr-3 font-medium">顧客</th>
                <th className="py-2 pr-3 font-medium">商品</th>
                <th className="py-2 pr-3 text-right font-medium">金額</th>
                <th className="py-2 pr-3 text-right font-medium">インセン</th>
                <th className="py-2 pr-3 font-medium">経路</th>
                <th className="py-2 pr-3 font-medium">状態</th>
                <th className="py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(sales ?? []).map((sale) => (
                <tr key={sale.id}>
                  <td className="tabular py-2 pr-3">{formatDate(sale.sold_on)}</td>
                  <td className="py-2 pr-3">{coachNames.get(sale.coach_id) ?? '—'}</td>
                  <td className="py-2 pr-3">{sale.customers?.name ?? '—'}</td>
                  <td className="py-2 pr-3">
                    {sale.products?.name ?? '—'}
                    {sale.products && !sale.products.is_sales_score_target ? (
                      <span className="ml-1 text-xs text-ink-500">(評価対象外)</span>
                    ) : null}
                  </td>
                  <td className="tabular py-2 pr-3 text-right">{formatYen(sale.amount)}</td>
                  <td className="tabular py-2 pr-3 text-right">{formatYen(sale.incentive_amount)}</td>
                  <td className="py-2 pr-3 text-xs text-ink-500">{ACQUISITION_LABEL[sale.acquisition_source] ?? '—'}</td>
                  <td className="py-2 pr-3 text-xs">
                    {sale.status === 'ACTIVE'
                      ? '有効'
                      : sale.status === 'CANCELLED'
                        ? '取消済'
                        : `返金 ${formatYen(sale.refund_amount)}`}
                  </td>
                  <td className="py-2">
                    {sale.status === 'ACTIVE' ? <SaleStatusForm saleId={sale.id} maxAmount={sale.amount} /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

export const dynamic = 'force-dynamic';
