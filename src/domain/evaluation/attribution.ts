import type { DateOnly } from '../date';

export interface AssignmentPeriod {
  customerId: string;
  coachId: string;
  startDate: DateOnly;
  /** null = 現担当 */
  endDate: DateOnly | null;
}

function covers(assignment: AssignmentPeriod, date: DateOnly): boolean {
  if (date < assignment.startDate) return false;
  return assignment.endDate === null || date <= assignment.endDate;
}

/**
 * 顧客成果をどのコーチの評価に計上するかを決める (仕様37章)。
 *
 * MVPルール:
 *   * 完全達成済み → 達成日時点の担当コーチに帰属
 *   * 未達成       → 現担当コーチに帰属
 *
 * 「達成日時点の担当」を担当履歴から解決するため、担当変更があっても
 * 過去の成果が新しい担当コーチの実績に付け替わらない。
 * 将来ルールを変える場合もこの関数だけを差し替えればよい。
 */
export function resolveResponsibleCoachId(
  assignments: AssignmentPeriod[],
  completeSuccessAt: DateOnly | null,
  currentCoachId: string | null,
): string | null {
  if (completeSuccessAt !== null) {
    const atAchievement = assignments.find((a) => covers(a, completeSuccessAt));
    if (atAchievement) return atAchievement.coachId;
    // 担当履歴が欠けている場合は現担当にフォールバックする (履歴移行前のデータ対策)
  }
  const current = assignments.find((a) => a.endDate === null);
  return current?.coachId ?? currentCoachId;
}
