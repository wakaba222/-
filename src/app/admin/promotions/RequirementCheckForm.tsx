'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/ui/Button';
import { Select, TextInput } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/FormMessage';
import { INITIAL_ACTION_STATE } from '@/server/actionResult';
import { setRequirementCheckAction } from '@/server/actions/adminActions';

export function RequirementCheckForm({
  coachId,
  requirementCode,
  label,
  achievedCount,
  approved,
}: {
  coachId: string;
  requirementCode: string;
  label: string;
  achievedCount: number;
  approved: boolean;
}) {
  const [state, formAction] = useActionState(setRequirementCheckAction, INITIAL_ACTION_STATE);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="coachId" value={coachId} />
      <input type="hidden" name="label" value={label} />
      <Select name="requirementCode" defaultValue={requirementCode} className="min-h-10 w-56 text-sm">
        <option value="SENIOR_ACTIVITY">上位活動要件 (P3)</option>
        <option value="OWN_BUSINESS_RESULT">本人起点の事業成果 (P4)</option>
      </Select>
      <TextInput
        name="achievedCount"
        type="number"
        min="0"
        max="100"
        defaultValue={achievedCount}
        className="min-h-10 w-20 text-sm"
      />
      <Select name="approved" defaultValue={approved ? 'true' : 'false'} className="min-h-10 w-28 text-sm">
        <option value="false">未承認</option>
        <option value="true">承認済み</option>
      </Select>
      <SubmitButton variant="secondary">保存</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
