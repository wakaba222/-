'use client';

import { useActionState } from 'react';
import type { EvaluationRules } from '@/domain/evaluation';
import { todayInJst } from '@/domain/date';
import { SubmitButton } from '@/components/ui/Button';
import { Field, TextArea, TextInput } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/FormMessage';
import { INITIAL_ACTION_STATE } from '@/server/actionResult';
import { createRulesVersionAction } from '@/server/actions/adminActions';

export function RulesForm({ currentRules }: { currentRules: EvaluationRules }) {
  const [state, formAction] = useActionState(createRulesVersionAction, INITIAL_ACTION_STATE);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="適用開始日" required>
          <TextInput name="effectiveFrom" type="date" defaultValue={todayInJst()} required />
        </Field>
        <Field label="メモ" hint="変更理由を残しておくと監査時に役立ちます">
          <TextInput name="note" maxLength={300} />
        </Field>
      </div>
      <Field label="ルール定義 (JSON)" required hint="保存時に形式を検証します。versionは自動採番されます">
        <TextArea name="rulesJson" rows={22} defaultValue={JSON.stringify(currentRules, null, 2)} className="font-mono text-xs" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton>新しいversionとして保存</SubmitButton>
    </form>
  );
}
