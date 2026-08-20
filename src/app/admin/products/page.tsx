import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/server/auth';
import type { ProductRow } from '@/lib/supabase/types';
import { ProductForm } from './ProductForm';

export default async function ProductsPage() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data: products } = await supabase
    .from('products')
    .select('id, code, name, default_price, incentive_amount, is_sales_score_target, active, sort_order, tax_rate, price_includes_tax')
    .order('sort_order')
    .returns<ProductRow[]>();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="商品マスタ"
          description="価格・成約ショットインセンティブ・売上点の評価対象かどうかを設定します"
        />
        <CardBody className="space-y-4">
          {(products ?? []).map((product) => (
            <ProductForm key={product.id} product={product} />
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="商品を追加" description="イベントなども商品として登録できます" />
        <CardBody>
          <ProductForm product={null} />
        </CardBody>
      </Card>

      <p className="text-xs text-ink-500">
        インセンティブ額の変更は今後の売上にのみ適用されます。過去の売上には成約時点の金額が保存されています。
      </p>
    </div>
  );
}

export const dynamic = 'force-dynamic';
