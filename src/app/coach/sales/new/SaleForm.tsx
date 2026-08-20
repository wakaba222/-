'use client';

import { useActionState, useState } from 'react';
import { todayInJst } from '@/domain/date';
import { SubmitButton } from '@/components/ui/Button';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/FormMessage';
import { INITIAL_ACTION_STATE } from '@/server/actionResult';
import { createSaleAction } from '@/server/actions/coachActions';
import { formatYen } from '@/lib/format';
import type { ProductRow } from '@/lib/supabase/types';

export function SaleForm({
  products,
  customers,
}: {
  products: ProductRow[];
  customers: { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState(createSaleAction, INITIAL_ACTION_STATE);
  const [productId, setProductId] = useState('');
  const [amount, setAmount] = useState('');

  const product = products.find((p) => p.id === productId) ?? null;

  function handleProductChange(nextProductId: string) {
    setProductId(nextProductId);
    // 商品を選んだ時点で標準価格を入れる。案件ごとの値引きは手で直せるようにする
    const next = products.find((p) => p.id === nextProductId);
    setAmount(next ? String(next.default_price) : '');
  }

  return (
    <form action={formAction} className="space-y-4">
      <Field label="顧客" hint="イベントなど顧客に紐づかない売上は空のままで構いません">
        <Select name="customerId" defaultValue="">
          <option value="">顧客なし</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="商品" required>
        <Select name="productId" value={productId} onChange={(e) => handleProductChange(e.target.value)} required>
          <option value="">選択してください</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（{formatYen(p.default_price)}）
            </option>
          ))}
        </Select>
      </Field>

      <Field label="金額" required hint="案件ごとに変更できます">
        <TextInput
          name="amount"
          type="number"
          inputMode="numeric"
          step="1"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </Field>

      {product ? (
        <p className="rounded-xl bg-canvas px-3 py-2 text-sm text-ink-700">
          成約ショットインセンティブ:{' '}
          <span className="font-semibold text-eagle-800">{formatYen(product.incentive_amount)}</span>
          {!product.is_sales_score_target ? (
            <span className="ml-2 text-xs text-ink-500">※この商品は売上点の評価対象外です</span>
          ) : null}
        </p>
      ) : null}

      <Field label="成約日" required>
        <TextInput name="soldOn" type="date" defaultValue={todayInJst()} required />
      </Field>

      <Field label="獲得経路" hint="SNS経由の新規は Professional Score の売上点から除外され、別枠で管理されます">
        <Select name="acquisitionSource" defaultValue="EXISTING">
          <option value="EXISTING">既存顧客・クロスセル</option>
          <option value="COACH_SNS">自分のSNS経由の新規</option>
          <option value="COMPANY">会社からの送客</option>
          <option value="OTHER">その他</option>
        </Select>
      </Field>

      <Field label="入金経路" hint="銀行振込は入金確認後に登録してください">
        <Select name="paymentSource" defaultValue="MANUAL">
          <option value="ROBOT_PAYMENT">Robot Payment</option>
          <option value="MOSH">MOSH</option>
          <option value="BANK_TRANSFER">銀行振込</option>
          <option value="MANUAL">その他・手入力</option>
        </Select>
      </Field>

      <Field label="備考" hint="任意">
        <TextArea name="note" rows={2} />
      </Field>

      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingLabel="登録中…">
        登録する
      </SubmitButton>
    </form>
  );
}
