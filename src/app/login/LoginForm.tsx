'use client';

import { useActionState } from 'react';
import { signInAction } from '@/server/actions/authActions';
import { SubmitButton } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/FormMessage';
import { INITIAL_ACTION_STATE } from '@/server/actionResult';

export function LoginForm() {
  const [state, formAction] = useActionState(signInAction, INITIAL_ACTION_STATE);

  return (
    <form action={formAction} className="space-y-4">
      <Field label="メールアドレス" required>
        <TextInput name="email" type="email" autoComplete="email" inputMode="email" required />
      </Field>
      <Field label="パスワード" required>
        <TextInput name="password" type="password" autoComplete="current-password" required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingLabel="ログイン中…">
        ログイン
      </SubmitButton>
    </form>
  );
}
