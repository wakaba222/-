'use client';

import { useActionState } from 'react';
import { PROFESSIONAL_LEVEL_LABELS, PROFESSIONAL_LEVELS, type ProfessionalLevel } from '@/domain/types';
import { SubmitButton } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/FormMessage';
import { INITIAL_ACTION_STATE } from '@/server/actionResult';
import { updateCoachAction } from '@/server/actions/adminActions';

export function CoachSettingsForm({
  coachId,
  level,
  lessonUnitPrice,
  leftOn,
}: {
  coachId: string;
  level: ProfessionalLevel;
  lessonUnitPrice: number;
  leftOn: string | null;
}) {
  const [state, formAction] = useActionState(updateCoachAction, INITIAL_ACTION_STATE);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="coachId" value={coachId} />
      <div className="w-48">
        <Field label="ランク">
          <Select name="level" defaultValue={level}>
            {PROFESSIONAL_LEVELS.map((value) => (
              <option key={value} value={value}>
                {value} {PROFESSIONAL_LEVEL_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="w-40">
        <Field label="レッスン単価">
          <TextInput name="lessonUnitPrice" type="number" min="0" defaultValue={lessonUnitPrice} />
        </Field>
      </div>
      <div className="w-44">
        <Field label="退職日" hint="空欄なら在籍中">
          <TextInput name="leftOn" type="date" defaultValue={leftOn ?? ''} />
        </Field>
      </div>
      <SubmitButton variant="secondary">保存</SubmitButton>
      <div className="w-full">
        <FormMessage state={state} />
      </div>
    </form>
  );
}
