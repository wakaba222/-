'use client';

import { useActionState } from 'react';
import { PROFESSIONAL_LEVEL_LABELS, PROFESSIONAL_LEVELS } from '@/domain/types';
import { todayInJst } from '@/domain/date';
import { SubmitButton } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/FormMessage';
import type { ActionResult } from '@/server/actionResult';
import { createCoachAction, type CreatedCoachCredentials } from '@/server/actions/adminActions';

export function NewCoachForm() {
  const [state, formAction] = useActionState<ActionResult<CreatedCoachCredentials> | null, FormData>(
    createCoachAction,
    null,
  );
  const credentials = state?.ok ? state.data : undefined;

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

        {credentials ? (
          <div className="rounded-xl border border-gold-100 bg-gold-100/60 px-4 py-3">
            <p className="text-sm font-semibold text-gold-600">
              初回ログイン情報（この画面を離れると再表示できません）
            </p>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex items-baseline gap-2">
                <dt className="w-28 shrink-0 text-ink-500">メールアドレス</dt>
                <dd>
                  <code className="select-all rounded bg-white px-2 py-0.5 font-mono">{credentials.email}</code>
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="w-28 shrink-0 text-ink-500">パスワード</dt>
                <dd>
                  <code className="select-all rounded bg-white px-2 py-0.5 font-mono">{credentials.password}</code>
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-ink-500">本人へ伝え、ログイン後にパスワードの変更を依頼してください。</p>
          </div>
        ) : null}

        <SubmitButton pendingLabel="登録中…">登録する</SubmitButton>
      </div>
    </form>
  );
}
