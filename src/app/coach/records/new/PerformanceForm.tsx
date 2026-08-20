'use client';

import { useActionState, useMemo, useState } from 'react';
import { judgeCompleteSuccess, DEFAULT_EVALUATION_RULES } from '@/domain/evaluation';
import type { GoalType } from '@/domain/types';
import { todayInJst } from '@/domain/date';
import { SubmitButton } from '@/components/ui/Button';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/FormMessage';
import { INITIAL_ACTION_STATE } from '@/server/actionResult';
import { createPerformanceRecordAction } from '@/server/actions/coachActions';

export interface PerformanceFormCustomer {
  id: string;
  name: string;
  goalType: GoalType;
  targetScore: number | null;
  targetDistance: number | null;
  completeSuccess: boolean;
}

function goalLabel(customer: PerformanceFormCustomer): string {
  const parts: string[] = [];
  if (customer.targetScore !== null) parts.push(`スコア ${customer.targetScore} 以下`);
  if (customer.targetDistance !== null) parts.push(`飛距離 ${customer.targetDistance}yd 以上`);
  return parts.join(' / ') || '目標未設定';
}

export function PerformanceForm({
  customers,
  bothGoalRule,
}: {
  customers: PerformanceFormCustomer[];
  bothGoalRule: 'ALL' | 'ANY';
}) {
  const [state, formAction] = useActionState(createPerformanceRecordAction, INITIAL_ACTION_STATE);
  const [customerId, setCustomerId] = useState('');
  const [score, setScore] = useState('');
  const [distance, setDistance] = useState('');

  const customer = customers.find((c) => c.id === customerId) ?? null;
  const needsScore = customer?.goalType === 'SCORE' || customer?.goalType === 'BOTH';
  const needsDistance = customer?.goalType === 'DISTANCE' || customer?.goalType === 'BOTH';

  // 保存前に達成/未達を即座に返す。判定式はサーバーと同じドメイン関数を使う
  const judgement = useMemo(() => {
    if (!customer) return null;
    const scoreValue = score.trim() === '' ? null : Number(score);
    const distanceValue = distance.trim() === '' ? null : Number(distance);
    if (scoreValue === null && distanceValue === null) return null;
    if (!Number.isFinite(scoreValue ?? 0) || !Number.isFinite(distanceValue ?? 0)) return null;

    const rules = {
      ...DEFAULT_EVALUATION_RULES,
      customerSuccess: { ...DEFAULT_EVALUATION_RULES.customerSuccess, bothGoalRule },
    };
    return judgeCompleteSuccess(
      { score: scoreValue, distance: distanceValue },
      { goalType: customer.goalType, targetScore: customer.targetScore, targetDistance: customer.targetDistance },
      rules,
    );
  }, [customer, score, distance, bothGoalRule]);

  return (
    <form action={formAction} className="space-y-4">
      <Field label="顧客" required>
        <Select name="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
          <option value="">選択してください</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.completeSuccess ? '（達成済み）' : ''}
            </option>
          ))}
        </Select>
      </Field>

      {customer ? (
        <p className="rounded-xl bg-canvas px-3 py-2 text-sm text-ink-700">
          目標: <span className="font-medium text-ink-900">{goalLabel(customer)}</span>
          {customer.goalType === 'BOTH' ? (
            <span className="ml-1 text-xs text-ink-500">({bothGoalRule === 'ALL' ? '両方達成で完全成果' : 'いずれか達成で完全成果'})</span>
          ) : null}
        </p>
      ) : null}

      {(!customer || needsScore) && (
        <Field label="スコア" hint="18ホールのトータルスコア">
          <TextInput
            name="score"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={score}
            onChange={(e) => setScore(e.target.value)}
            placeholder="98"
          />
        </Field>
      )}

      {(!customer || needsDistance) && (
        <Field label="飛距離 (yd)" hint="ドライバーの平均飛距離">
          <TextInput
            name="distance"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            placeholder="250"
          />
        </Field>
      )}

      {judgement !== null ? (
        <p
          className={
            judgement
              ? 'rounded-xl bg-eagle-50 px-3 py-3 text-center text-lg font-semibold text-eagle-800'
              : 'rounded-xl bg-canvas px-3 py-3 text-center text-sm text-ink-700'
          }
        >
          {judgement ? '🎉 目標達成' : 'まだ目標に届いていません'}
        </p>
      ) : null}

      <Field label="記録日" required hint="過去の日付でも登録できます">
        <TextInput name="recordedOn" type="date" defaultValue={todayInJst()} max={todayInJst()} required />
      </Field>

      <Field label="メモ" hint="任意">
        <TextArea name="note" rows={2} placeholder="ラウンド結果など" />
      </Field>

      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingLabel="登録中…">
        登録する
      </SubmitButton>
    </form>
  );
}
