'use client';

import { useActionState } from 'react';
import type { BehaviorStatus } from '@/domain/types';
import { SubmitButton } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/FormMessage';
import { INITIAL_ACTION_STATE } from '@/server/actionResult';
import { setBehaviorStatusAction } from '@/server/actions/adminActions';

export function BehaviorStatusForm({
  coachId,
  yearMonth,
  currentStatus,
}: {
  coachId: string;
  yearMonth: string;
  currentStatus: BehaviorStatus;
}) {
  const [state, formAction] = useActionState(setBehaviorStatusAction, INITIAL_ACTION_STATE);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="coachId" value={coachId} />
      <input type="hidden" name="yearMonth" value={yearMonth} />
      <div className="w-40">
        <Field label="判定">
          <Select name="status" defaultValue={currentStatus}>
            <option value="OK">OK</option>
            <option value="WARNING">WARNING</option>
            <option value="NG">NG (昇格不可)</option>
          </Select>
        </Field>
      </div>
      <div className="min-w-60 flex-1">
        <Field label="メモ">
          <TextInput name="note" maxLength={300} />
        </Field>
      </div>
      <SubmitButton variant="secondary">保存</SubmitButton>
      <div className="w-full">
        <FormMessage state={state} />
      </div>
    </form>
  );
}
