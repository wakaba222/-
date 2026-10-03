import { todayInJst } from '@/domain/date';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireCoach } from '@/server/auth';
import { DiagnosisSheet } from './DiagnosisSheet';

export default async function DiagnosisSheetPage() {
  const session = await requireCoach();
  const supabase = await createSupabaseServerClient();

  // お名前欄の入力候補。担当顧客以外の名前も自由に書けるよう、候補として出すだけにする
  const { data: customers } = await supabase
    .from('customers')
    .select('name')
    .eq('current_coach_id', session.coach.id)
    .in('status', ['ACTIVE', 'COMPLETED', 'SUSPENDED'])
    .is('deleted_at', null)
    .order('name')
    .returns<{ name: string }[]>();

  return (
    <DiagnosisSheet
      coachName={session.user.name}
      today={todayInJst()}
      customerNames={(customers ?? []).map((row) => row.name)}
    />
  );
}
