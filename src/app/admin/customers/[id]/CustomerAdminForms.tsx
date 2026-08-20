'use client';

import { useActionState } from 'react';
import type { CustomerStatus } from '@/domain/types';
import { Badge } from '@/components/ui/Badge';
import { Button, SubmitButton } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { FormMessage } from '@/components/ui/FormMessage';
import { INITIAL_ACTION_STATE } from '@/server/actionResult';
import {
  deletePerformanceRecordAction,
  reassignCoachAction,
  updateCustomerStatusAction,
} from '@/server/actions/adminActions';
import { formatDate } from '@/lib/format';

interface RecordView {
  id: string;
  recordedOn: string;
  score: number | null;
  distance: number | null;
  isCompleteSuccess: boolean;
  note: string | null;
}

export function CustomerAdminForms({
  customerId,
  status,
  coaches,
  records,
}: {
  customerId: string;
  status: CustomerStatus;
  coaches: { id: string; name: string }[];
  records: RecordView[];
}) {
  const [statusState, statusAction] = useActionState(updateCustomerStatusAction, INITIAL_ACTION_STATE);
  const [assignState, assignAction] = useActionState(reassignCoachAction, INITIAL_ACTION_STATE);
  const [recordState, recordAction] = useActionState(deletePerformanceRecordAction, INITIAL_ACTION_STATE);

  return (
    <>
      <Card>
        <CardHeader title="ステータス変更" description="解約時は理由が必須です (評価分母の扱いが変わります)" />
        <CardBody>
          <form action={statusAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="customerId" value={customerId} />
            <div className="w-44">
              <Field label="ステータス">
                <Select name="status" defaultValue={status}>
                  <option value="ACTIVE">進行中</option>
                  <option value="SUSPENDED">休会</option>
                  <option value="COMPLETED">プログラム終了</option>
                  <option value="CANCELLED">解約</option>
                </Select>
              </Field>
            </div>
            <div className="w-52">
              <Field label="解約理由" hint="成果不振のみ評価分母に残ります">
                <Select name="cancelReasonCode" defaultValue="">
                  <option value="">—</option>
                  <option value="SELF">自己都合</option>
                  <option value="PERFORMANCE">成果不振</option>
                  <option value="OTHER">その他</option>
                </Select>
              </Field>
            </div>
            <div className="w-36">
              <Field label="休会日数" hint="経過月数から差し引きます">
                <TextInput name="suspendedDays" type="number" min="0" defaultValue={0} />
              </Field>
            </div>
            <SubmitButton variant="secondary">更新</SubmitButton>
            <div className="w-full">
              <FormMessage state={statusState} />
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="担当コーチ変更" description="担当履歴が残り、過去の成果は当時の担当コーチに帰属したままになります" />
        <CardBody>
          <form action={assignAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="customerId" value={customerId} />
            <div className="w-52">
              <Field label="新しい担当">
                <Select name="coachId" defaultValue="" required>
                  <option value="">選択してください</option>
                  {coaches.map((coach) => (
                    <option key={coach.id} value={coach.id}>
                      {coach.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="min-w-60 flex-1">
              <Field label="理由">
                <TextInput name="reason" maxLength={200} />
              </Field>
            </div>
            <SubmitButton variant="secondary">変更</SubmitButton>
            <div className="w-full">
              <FormMessage state={assignState} />
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="成果履歴" description="誤登録は取消できます (物理削除はされません)" />
        <CardBody className="py-0">
          {records.length === 0 ? (
            <p className="py-4 text-sm text-ink-500">まだ記録がありません。</p>
          ) : (
            <ul className="divide-y divide-line">
              {records.map((record) => (
                <li key={record.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="tabular text-sm text-ink-900">
                      {record.score !== null ? `スコア ${record.score}` : ''}
                      {record.score !== null && record.distance !== null ? ' / ' : ''}
                      {record.distance !== null ? `${record.distance}yd` : ''}
                    </p>
                    <p className="text-xs text-ink-500">
                      {formatDate(record.recordedOn)}
                      {record.note ? ` / ${record.note}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {record.isCompleteSuccess ? <Badge tone="gold">達成</Badge> : null}
                    <form action={recordAction}>
                      <input type="hidden" name="recordId" value={record.id} />
                      <input type="hidden" name="customerId" value={customerId} />
                      <Button type="submit" variant="danger" className="min-h-9 px-3 text-xs">
                        取消
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="py-2">
            <FormMessage state={recordState} />
          </div>
        </CardBody>
      </Card>
    </>
  );
}
