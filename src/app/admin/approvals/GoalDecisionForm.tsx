'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/Button';
import { FormMessage } from '@/components/ui/FormMessage';
import { INITIAL_ACTION_STATE } from '@/server/actionResult';
import { decideGoalAction } from '@/server/actions/adminActions';

export function GoalDecisionForm({ customerId }: { customerId: string }) {
  const [state, formAction, isPending] = useActionState(decideGoalAction, INITIAL_ACTION_STATE);

  return (
    <div className="flex flex-col items-end gap-2">
      <form action={formAction} className="flex gap-2">
        <input type="hidden" name="customerId" value={customerId} />
        <Button type="submit" name="decision" value="REJECTED" variant="danger" disabled={isPending}>
          差し戻す
        </Button>
        <Button type="submit" name="decision" value="APPROVED" disabled={isPending}>
          承認する
        </Button>
      </form>
      <FormMessage state={state} />
    </div>
  );
}
