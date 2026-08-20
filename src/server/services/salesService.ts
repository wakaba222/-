import type { AcquisitionSource, DateOnly } from '@/domain/types';
import type { Db } from '@/server/repositories/evaluationRepository';
import type { ProductRow } from '@/lib/supabase/types';

export interface RegisterSaleInput {
  coachId: string;
  customerId: string | null;
  productId: string;
  soldOn: DateOnly;
  amount: number;
  acquisitionSource: AcquisitionSource;
  note: string | null;
  createdBy: string;
}

export interface RegisterSaleResult {
  saleId: string;
  productName: string;
  incentiveAmount: number;
}

/** PostgreSQL の一意制約違反 */
const UNIQUE_VIOLATION = '23505';

/**
 * 売上登録。
 * インセンティブ額は商品マスタの「現在値」をコピーして保存する。
 * 後日マスタを変更しても、過去に確定した支給額が変わらないようにするため。
 */
export async function registerSale(db: Db, input: RegisterSaleInput): Promise<RegisterSaleResult> {
  const { data: product, error: productError } = await db
    .from('products')
    .select('id, code, name, default_price, incentive_amount, is_sales_score_target, active, sort_order')
    .eq('id', input.productId)
    .maybeSingle<ProductRow>();
  if (productError) throw new Error(`商品の取得に失敗しました: ${productError.message}`);
  if (!product) throw new Error('商品が見つかりません');

  const { data, error } = await db
    .from('sales')
    .insert({
      coach_id: input.coachId,
      customer_id: input.customerId,
      product_id: input.productId,
      sold_on: input.soldOn,
      amount: input.amount,
      incentive_amount: product.incentive_amount,
      acquisition_source: input.acquisitionSource,
      note: input.note,
      created_by: input.createdBy,
    })
    .select('id')
    .single<{ id: string }>();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new Error('同じ顧客・商品・成約日・金額の売上が既に登録されています');
    }
    throw new Error(`売上の登録に失敗しました: ${error.message}`);
  }

  return { saleId: data.id, productName: product.name, incentiveAmount: product.incentive_amount };
}

/**
 * 売上の取消・返金 (ADMIN のみ)。
 * 行は削除せず状態遷移で表現し、監査ログに残す。
 */
export async function cancelSale(
  db: Db,
  saleId: string,
  mode: 'CANCELLED' | 'REFUNDED',
  refundAmount: number,
  statusChangedOn: DateOnly,
): Promise<void> {
  const { error } = await db
    .from('sales')
    .update({
      status: mode,
      refund_amount: mode === 'CANCELLED' ? 0 : refundAmount,
      status_changed_on: statusChangedOn,
    })
    .eq('id', saleId);
  if (error) throw new Error(`売上の更新に失敗しました: ${error.message}`);
}
