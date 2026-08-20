import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCoach } from '@/server/auth';
import type { CustomerRow, ProductRow, SaleRow } from '@/lib/supabase/types';
import { formatDate, formatYen } from '@/lib/format';
import { SaleForm } from './SaleForm';

export default async function NewSalePage() {
  const session = await requireCoach();
  const supabase = await createSupabaseServerClient();

  const [{ data: products }, { data: customers }, { data: recentSales }] = await Promise.all([
    supabase
      .from('products')
      .select('id, code, name, default_price, incentive_amount, is_sales_score_target, active, sort_order, tax_rate, price_includes_tax')
      .eq('active', true)
      .order('sort_order')
      .returns<ProductRow[]>(),
    supabase
      .from('customers')
      .select('id, name')
      .eq('current_coach_id', session.coach.id)
      .is('deleted_at', null)
      .order('name')
      .returns<Pick<CustomerRow, 'id' | 'name'>[]>(),
    supabase
      .from('sales')
      .select('id, coach_id, customer_id, product_id, sold_on, amount, incentive_amount, acquisition_source, payment_source, status, refund_amount, tax_amount, payment_fee, net_amount, note, products(id, name, code, is_sales_score_target), customers(id, name)')
      .eq('coach_id', session.coach.id)
      .order('sold_on', { ascending: false })
      .limit(5)
      .returns<SaleRow[]>(),
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="売上を登録" description="商品を選ぶと金額が自動で入ります。案件ごとの変更も可能です" />
        <CardBody>
          <SaleForm products={products ?? []} customers={customers ?? []} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="最近の登録" description="直近5件" />
        <CardBody className="py-0">
          {(recentSales ?? []).length === 0 ? (
            <p className="py-4 text-sm text-ink-500">まだ登録がありません。</p>
          ) : (
            <ul className="divide-y divide-line">
              {(recentSales ?? []).map((sale) => (
                <li key={sale.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink-900">{sale.products?.name ?? '—'}</p>
                    <p className="text-xs text-ink-500">
                      {formatDate(sale.sold_on)} / {sale.customers?.name ?? '顧客なし'}
                      {sale.status !== 'ACTIVE' ? ` / ${sale.status === 'CANCELLED' ? '取消済' : '一部返金'}` : ''}
                    </p>
                  </div>
                  <span className="tabular shrink-0 text-sm font-semibold">{formatYen(sale.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
