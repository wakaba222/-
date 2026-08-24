'use client';

import { useActionState } from 'react';
import { PROFESSIONAL_LEVEL_LABELS, PROFESSIONAL_LEVELS } from '@/domain/types';
import { todayInJst } from '@/domain/date';
import { SubmitButton } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/FormMessage';
import { INITIAL_ACTION_STATE } from '@/server/actionResult';
import { createCoachAction } from '@/server/actions/adminActions';

export function NewCoachForm() {
  const [state, formAction] = useActionState(createCoachAction, INITIAL_ACTION_STATE);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="氏名" required>
        <TextInput name="name" required maxLength={100} placeholder="山田 太郎" />
      </Field>
      <Field label="メールアドレス" required hint="このアドレスでログインします">
        <TextInput name="email" type="email" required placeholder="yamada@example.com" />
      </Field>
      <Field label="ランク" required hint="レッスン単価は評価ルールのランク別単価が入ります">
        <Select name="level" defaultValue="P1">
          {PROFESSIONAL_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level} {PROFESSIONAL_LEVEL_LABELS[level]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="入社日" required>
        <TextInput name="hireDate" type="date" defaultValue={todayInJst()} required />
      </Field>

      <div className="space-y-3 sm:col-span-2">
        <FormMessage state={state} />
        <SubmitButton pendingLabel="登録中…">登録する</SubmitButton>
      </div>
    </form>
  );
}
