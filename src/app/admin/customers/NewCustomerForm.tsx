'use client';

import { useActionState, useState } from 'react';
import type { GoalType } from '@/domain/types';
import { todayInJst } from '@/domain/date';
import { SubmitButton } from '@/components/ui/Button';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/FormMessage';
import { INITIAL_ACTION_STATE } from '@/server/actionResult';
import { createCustomerAction } from '@/server/actions/adminActions';

export function NewCustomerForm({ coaches }: { coaches: { id: string; name: string }[] }) {
  const [state, formAction] = useActionState(createCustomerAction, INITIAL_ACTION_STATE);
  const [goalType, setGoalType] = useState<GoalType>('SCORE');

  const needsScore = goalType === 'SCORE' || goalType === 'BOTH';
  const needsDistance = goalType === 'DISTANCE' || goalType === 'BOTH';

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="氏名" required>
        <TextInput name="name" required maxLength={100} />
      </Field>
      <Field label="担当コーチ" required>
        <Select name="coachId" required defaultValue="">
          <option value="">選択してください</option>
          {coaches.map((coach) => (
            <option key={coach.id} value={coach.id}>
              {coach.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="プログラム開始日" required hint="終了予定日は自動で6ヶ月後に設定されます">
        <TextInput name="programStartDate" type="date" defaultValue={todayInJst()} required />
      </Field>
      <Field label="評価目標種別" required hint="定性的な目標のみの登録はできません">
        <Select name="goalType" value={goalType} onChange={(e) => setGoalType(e.target.value as GoalType)}>
          <option value="SCORE">スコア</option>
          <option value="DISTANCE">飛距離</option>
          <option value="BOTH">両方</option>
        </Select>
      </Field>

      {needsScore ? (
        <>
          <Field label="開始スコア">
            <TextInput name="startScore" type="number" step="0.1" inputMode="decimal" />
          </Field>
          <Field label="目標スコア" required>
            <TextInput name="targetScore" type="number" step="0.1" inputMode="decimal" />
          </Field>
        </>
      ) : null}

      {needsDistance ? (
        <>
          <Field label="開始飛距離 (yd)">
            <TextInput name="startDistance" type="number" step="0.1" inputMode="decimal" />
          </Field>
          <Field label="目標飛距離 (yd)" required>
            <TextInput name="targetDistance" type="number" step="0.1" inputMode="decimal" />
          </Field>
        </>
      ) : null}

      <div className="sm:col-span-2">
        <Field label="備考">
          <TextArea name="note" rows={2} />
        </Field>
      </div>

      <div className="sm:col-span-2 space-y-3">
        <FormMessage state={state} />
        <SubmitButton>登録する</SubmitButton>
      </div>
    </form>
  );
}
