'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/FormMessage';
import { INITIAL_ACTION_STATE } from '@/server/actionResult';
import { updateSaleStatusAction } from '@/server/actions/adminActions';
import type { SaleStatus } from '@/domain/types';

export function SaleStatusForm({
  saleId,
  maxAmount,
  status,
}: {
  saleId: string;
  maxAmount: number;
  status: SaleStatus;
}) {
  const [state, formAction, isPending] = useActionState(updateSaleStatusAction, INITIAL_ACTION_STATE);

  // 処理後は操作欄が消えるが、結果は残す。
  // 何が起きたか分からないまま画面が変わらないようにするため。
  if (status !== 'ACTIVE') {
    return <FormMessage state={state} />;
  }

  return (
    <div>
      <form action={formAction} className="flex items-center gap-1.5">
        <input type="hidden" name="saleId" value={saleId} />
        <TextInput
          name="refundAmount"
          type="number"
          min="0"
          max={maxAmount}
          defaultValue={0}
          className="min-h-9 w-24 text-xs"
          aria-label="返金額"
        />
        <Button type="submit" name="mode" value="REFUNDED" variant="secondary" className="min-h-9 px-2 text-xs" disabled={isPending}>
          返金
        </Button>
        <Button type="submit" name="mode" value="CANCELLED" variant="danger" className="min-h-9 px-2 text-xs" disabled={isPending}>
          取消
        </Button>
      </form>
      <FormMessage state={state} />
    </div>
  );
}
