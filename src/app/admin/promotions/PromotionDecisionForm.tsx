'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/FormMessage';
import { INITIAL_ACTION_STATE } from '@/server/actionResult';
import { decidePromotionAction } from '@/server/actions/adminActions';

export function PromotionDecisionForm({ reviewId }: { reviewId: string }) {
  const [state, formAction, isPending] = useActionState(decidePromotionAction, INITIAL_ACTION_STATE);

  return (
    <div className="flex flex-col items-end gap-2">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="reviewId" value={reviewId} />
        <TextInput name="note" placeholder="決定メモ (任意)" className="min-h-11 w-48 text-sm" />
        <Button type="submit" name="decision" value="REJECTED" variant="danger" disabled={isPending}>
          見送る
        </Button>
        <Button type="submit" name="decision" value="APPROVED" disabled={isPending}>
          昇格を承認
        </Button>
      </form>
      <FormMessage state={state} />
    </div>
  );
}
