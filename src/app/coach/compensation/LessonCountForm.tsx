'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/FormMessage';
import { INITIAL_ACTION_STATE } from '@/server/actionResult';
import { saveLessonCountAction } from '@/server/actions/coachActions';

export function LessonCountForm({ yearMonth, defaultValue }: { yearMonth: string; defaultValue: number | null }) {
  const [state, formAction] = useActionState(saveLessonCountAction, INITIAL_ACTION_STATE);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="yearMonth" value={yearMonth} />
      <Field label="レッスン実施回数" required>
        <TextInput
          name="lessonCount"
          type="number"
          inputMode="numeric"
          min="0"
          max="500"
          defaultValue={defaultValue ?? ''}
          required
        />
      </Field>
      <FormMessage state={state} />
      <SubmitButton>保存する</SubmitButton>
    </form>
  );
}
