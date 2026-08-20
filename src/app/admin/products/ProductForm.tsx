'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/FormMessage';
import { INITIAL_ACTION_STATE } from '@/server/actionResult';
import { upsertProductAction } from '@/server/actions/adminActions';
import type { ProductRow } from '@/lib/supabase/types';

export function ProductForm({ product }: { product: ProductRow | null }) {
  const [state, formAction] = useActionState(upsertProductAction, INITIAL_ACTION_STATE);

  return (
    <form action={formAction} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-6">
      <input type="hidden" name="id" value={product?.id ?? ''} />
      <div className="sm:col-span-1">
        <Field label="コード" required>
          <TextInput name="code" defaultValue={product?.code ?? ''} required className="text-sm" />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="商品名" required>
          <TextInput name="name" defaultValue={product?.name ?? ''} required className="text-sm" />
        </Field>
      </div>
      <Field label="標準価格" required>
        <TextInput name="defaultPrice" type="number" min="0" defaultValue={product?.default_price ?? 0} className="text-sm" />
      </Field>
      <Field label="インセン額">
        <TextInput
          name="incentiveAmount"
          type="number"
          min="0"
          defaultValue={product?.incentive_amount ?? 0}
          className="text-sm"
        />
      </Field>
      <Field label="売上点の対象">
        <Select name="isSalesScoreTarget" defaultValue={String(product?.is_sales_score_target ?? true)} className="text-sm">
          <option value="true">対象</option>
          <option value="false">対象外</option>
        </Select>
      </Field>
      <div className="sm:col-span-6 flex flex-wrap items-center gap-3">
        <Select name="active" defaultValue={String(product?.active ?? true)} className="w-32 text-sm">
          <option value="true">有効</option>
          <option value="false">無効</option>
        </Select>
        <SubmitButton variant="secondary">{product ? '更新' : '追加'}</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
