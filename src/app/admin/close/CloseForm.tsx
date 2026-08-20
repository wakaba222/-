'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/FormMessage';
import { INITIAL_ACTION_STATE } from '@/server/actionResult';
import { closeMonthAction } from '@/server/actions/adminActions';
import { formatYearMonth } from '@/lib/format';

export function CloseForm({ months, defaultMonth }: { months: string[]; defaultMonth: string }) {
  const [state, formAction] = useActionState(closeMonthAction, INITIAL_ACTION_STATE);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="w-48">
        <Field label="対象月" required>
          <Select name="yearMonth" defaultValue={defaultMonth}>
            {months.map((month) => (
              <option key={month} value={month}>
                {formatYearMonth(month)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <SubmitButton pendingLabel="計算中…">この月を締める</SubmitButton>
      <div className="w-full">
        <FormMessage state={state} />
      </div>
    </form>
  );
}
